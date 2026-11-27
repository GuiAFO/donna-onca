import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { interpretarLeitura } from '../lib/barcode'
import { parseValor, formatBRL } from '../lib/format'
import { salvarVenda, type Catalogo, type ProdutoCatalogo, type Venda } from '../lib/api'
import { dataCurta, montarParcelas, somarMeses } from '../lib/fiado'

// Mesmo Scanner do cadastro, carregado sob demanda.
const Scanner = lazy(() => import('./Scanner'))

/** Um item no carrinho (na tela). Vira uma linha na aba Vendas. */
type ItemCarrinho = {
  id: string
  descricao: string
  precoUnit: string // campo editável, ex.: "21,50"
  quantidade: number
  linhaCatalogo: number | null // null = fora do catálogo (sem baixa no estoque)
}

const CHAVE_RASCUNHO = 'donna-onca:carrinho'

function hojeISO() {
  const d = new Date()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

// número -> string "21,50" para o campo editável
function paraCampo(n: number) {
  return n.toFixed(2).replace('.', ',')
}

function totalItem(it: ItemCarrinho) {
  const p = parseValor(it.precoUnit)
  return p == null ? null : p * it.quantidade
}

// Rascunho do carrinho no aparelho: se o app fechar no meio da venda, nada se perde.
function lerRascunho(): { itens: ItemCarrinho[]; nome: string } {
  try {
    const raw = localStorage.getItem(CHAVE_RASCUNHO)
    if (raw) {
      const r = JSON.parse(raw)
      if (Array.isArray(r.itens)) return { itens: r.itens, nome: String(r.nome ?? '') }
    }
  } catch {
    /* sem armazenamento — segue vazio */
  }
  return { itens: [], nome: '' }
}

export default function TelaVenda({
  catalogo,
  onClienteNova,
}: {
  catalogo: Catalogo
  onClienteNova?: (nome: string) => void
}) {
  const [rascunho] = useState(lerRascunho)

  // carrinho
  const [itens, setItens] = useState<ItemCarrinho[]>(rascunho.itens)

  // "adicionar produto"
  const [codigo, setCodigo] = useState('')
  const [descricao, setDescricao] = useState('')
  const [produtoSel, setProdutoSel] = useState<ProdutoCatalogo | null>(null)
  const [preco, setPreco] = useState('')
  const [adicionado, setAdicionado] = useState<string | null>(null)

  // dados da venda
  const [nome, setNome] = useState(rascunho.nome)
  const [forma, setForma] = useState('')
  const [conta, setConta] = useState('')
  const [data, setData] = useState(hojeISO())

  // fiado
  const [modo, setModo] = useState<'avista' | 'fiado'>('avista')
  const [nParcelas, setNParcelas] = useState(2)
  const [primeiroVenc, setPrimeiroVenc] = useState(() => somarMeses(hojeISO(), 1))
  const [entrada, setEntrada] = useState(false)

  const [scannerAberto, setScannerAberto] = useState(false)
  const [leituraCrua, setLeituraCrua] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [sucesso, setSucesso] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  // pré-seleciona forma/conta com a 1ª opção da planilha quando o catálogo chega
  useEffect(() => {
    setForma((f) => f || catalogo.opcoes.formaRecebimento[0] || '')
    setConta((c) => c || catalogo.opcoes.conta[0] || '')
  }, [catalogo])

  // guarda o rascunho a cada mudança
  useEffect(() => {
    try {
      if (itens.length || nome) {
        localStorage.setItem(CHAVE_RASCUNHO, JSON.stringify({ itens, nome }))
      } else {
        localStorage.removeItem(CHAVE_RASCUNHO)
      }
    } catch {
      /* sem armazenamento — ok */
    }
  }, [itens, nome])

  // some o aviso "adicionado" depois de um tempinho
  useEffect(() => {
    if (!adicionado) return
    const t = setTimeout(() => setAdicionado(null), 2500)
    return () => clearTimeout(t)
  }, [adicionado])

  // produtos que casam com o código atual (um por tamanho)
  const porCodigo = useMemo(
    () => (codigo ? catalogo.produtos.filter((p) => String(p.codigo) === String(codigo)) : []),
    [codigo, catalogo],
  )

  // Catálogo sem "linha" = o Apps Script publicado ainda é a versão antiga (só cadastro).
  const servidorDesatualizado =
    catalogo.produtos.length > 0 && catalogo.produtos[0].linha == null

  const pecas = itens.reduce((s, it) => s + it.quantidade, 0)
  const total = itens.reduce((s, it) => s + (totalItem(it) ?? 0), 0)
  const semPreco = itens.some((it) => totalItem(it) == null)
  // rascunho antigo pode ter item digitado à mão; a planilha não aceita
  const foraDoCatalogo = itens.some((it) => it.linhaCatalogo == null)

  // A coluna Nome da Vendas só aceita clientes do "Cadastro de Clientes".
  // Se o nome não está lá, o servidor cadastra antes de gravar a venda.
  const clienteDaLista = useMemo(() => {
    const n = nome.trim().toLowerCase()
    return n ? (catalogo.clientes.find((c) => c.trim().toLowerCase() === n) ?? null) : null
  }, [nome, catalogo])
  const clienteNova = nome.trim() !== '' && clienteDaLista == null

  // servidor antigo ignoraria as parcelas e gravaria como à vista
  const servidorSabeFiado = (catalogo.versao ?? 0) >= 3
  const fiado = modo === 'fiado' && servidorSabeFiado
  const comEntrada = fiado && entrada && nParcelas > 1
  const parcelas = useMemo(
    () => (fiado ? montarParcelas(total, nParcelas, primeiroVenc, data, comEntrada) : []),
    [fiado, total, nParcelas, primeiroVenc, data, comEntrada],
  )
  // forma/conta só valem para o que é pago agora: à vista ou a entrada do fiado
  const pedeFormaConta = !fiado || comEntrada

  // ---------- carrinho ----------

  function adicionarAoCarrinho(desc: string, precoUnit: string, linha: number) {
    // Texto EXATO do catálogo (até espaço no fim): a coluna Descrição da Vendas
    // só aceita itens do catálogo, e a fórmula de Saídas casa por esse texto.
    const d = desc
    if (!d.trim()) return
    setItens((atual) => {
      // mesmo produto de novo → só soma a quantidade
      const i = atual.findIndex((it) => it.linhaCatalogo === linha)
      if (i >= 0) {
        const copia = [...atual]
        copia[i] = { ...copia[i], quantidade: copia[i].quantidade + 1 }
        return copia
      }
      return [
        ...atual,
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          descricao: d,
          precoUnit,
          quantidade: 1,
          linhaCatalogo: linha,
        },
      ]
    })
    setAdicionado(d)
    setSucesso(null)
    setErro(null)
    // limpa a área de "adicionar" para o próximo produto
    setCodigo('')
    setDescricao('')
    setProdutoSel(null)
    setPreco('')
    setLeituraCrua(null)
  }

  function adicionarDoCatalogo(p: ProdutoCatalogo) {
    adicionarAoCarrinho(p.descricao, p.venda != null ? paraCampo(p.venda) : '', p.linha)
  }

  function mudarQtd(id: string, delta: number) {
    setItens((atual) =>
      atual.map((it) =>
        it.id === id ? { ...it, quantidade: Math.max(1, it.quantidade + delta) } : it,
      ),
    )
  }

  function mudarPreco(id: string, v: string) {
    setItens((atual) => atual.map((it) => (it.id === id ? { ...it, precoUnit: v } : it)))
  }

  function remover(id: string) {
    setItens((atual) => atual.filter((it) => it.id !== id))
  }

  function esvaziar() {
    if (itens.length && !window.confirm('Esvaziar o carrinho?')) return
    setItens([])
    setNome('')
    setSucesso(null)
    setErro(null)
  }

  // ---------- adicionar produto ----------

  function aoMudarDescricao(v: string) {
    setDescricao(v)
    const achado =
      catalogo.produtos.find(
        (p) => p.descricao.toLowerCase().trim() === v.toLowerCase().trim(),
      ) ?? null
    setProdutoSel(achado)
    if (achado?.venda != null) setPreco(paraCampo(achado.venda))
  }

  function aoAdicionarBuscado() {
    if (produtoSel) adicionarAoCarrinho(produtoSel.descricao, preco, produtoSel.linha)
  }

  function aoDetectar(code: string) {
    const { ref, cru } = interpretarLeitura(code)
    setLeituraCrua(cru)
    setScannerAberto(false)
    setSucesso(null)
    setErro(null)
    if (!ref) return
    const achados = catalogo.produtos.filter((p) => String(p.codigo) === String(ref))
    if (achados.length === 1) {
      adicionarDoCatalogo(achados[0]) // caminho rápido: um só tamanho → direto pro carrinho
    } else {
      setCodigo(ref) // vários tamanhos (ou nenhum) → ela escolhe abaixo
    }
  }

  // ---------- registrar ----------

  const podeRegistrar =
    itens.length > 0 &&
    !semPreco &&
    !foraDoCatalogo &&
    (!fiado || primeiroVenc !== '') &&
    !(modo === 'fiado' && !servidorSabeFiado) && // nunca cai em "à vista" por engano
    nome.trim() !== '' &&
    !salvando &&
    !servidorDesatualizado

  async function aoRegistrar() {
    setErro(null)
    setSucesso(null)
    if (!itens.length) return setErro('O carrinho está vazio.')
    if (nome.trim() === '') return setErro('Preencha o nome da cliente.')
    if (semPreco) return setErro('Tem item sem preço no carrinho.')
    if (foraDoCatalogo) return setErro('Tire do carrinho o item que não está no catálogo.')
    setSalvando(true)
    try {
      const venda: Venda = {
        data,
        nome: clienteDaLista ?? nome.trim(), // nome exato da lista, quando já existe
        forma: pedeFormaConta ? forma : '',
        conta: pedeFormaConta ? conta : '',
        status: 'Efetuado',
        itens: itens.map((it) => ({
          descricao: it.descricao,
          quantidade: it.quantidade,
          valor: totalItem(it),
          linhaCatalogo: it.linhaCatalogo,
        })),
        ...(fiado ? { fiado: { parcelas } } : {}),
      }
      const r = await salvarVenda(venda)
      if (r.clienteNova && r.cliente) onClienteNova?.(r.cliente)
      const pc = `${pecas} ${pecas === 1 ? 'peça' : 'peças'} · ${formatBRL(total)}`
      setSucesso(
        (fiado
          ? `Fiado registrado! ${pc} em ${nParcelas}x ✨`
          : `Venda registrada! ${pc} ✨`) +
          (r.clienteNova ? ` ${r.cliente} foi cadastrada como cliente.` : ''),
      )
      setItens([])
      setNome('')
      setModo('avista')
      setEntrada(false)
    } catch (e) {
      setErro((e as Error).message)
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="pb-24">
      {servidorDesatualizado && (
        <p className="mb-3 rounded-xl2 bg-rose/10 px-4 py-3 text-sm text-rose-deep">
          O servidor (Apps Script) ainda está na versão antiga, então as vendas não podem
          ser registradas. Publique a versão nova em Implantar → Gerenciar implantações.
        </p>
      )}

      <button onClick={() => setScannerAberto(true)} className="btn-primario mb-3">
        <span className="text-xl">📷</span> Escanear produto
      </button>

      {leituraCrua && (
        <p className="mb-3 text-center text-xs text-grafite/50">
          Código de barras lido: {leituraCrua}
        </p>
      )}

      {adicionado && (
        <p className="mb-3 rounded-xl2 bg-rose-soft/40 px-4 py-2 text-center text-sm font-medium text-rose-deep">
          ＋ {adicionado} no carrinho
        </p>
      )}

      {/* ---------- Adicionar produto ---------- */}
      <div className="space-y-4 rounded-xl2 bg-white p-4 shadow-card">
        <div>
          <label className="rotulo" htmlFor="venda-codigo">
            Código (referência)
          </label>
          <input
            id="venda-codigo"
            className="campo"
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            inputMode="numeric"
            placeholder="ex.: 1212"
          />
          {codigo !== '' && porCodigo.length > 0 && (
            <>
              <p className="mt-2 text-xs text-grafite/60">Toque para pôr no carrinho:</p>
              <div className="mt-1 flex flex-wrap gap-2">
                {porCodigo.map((p) => (
                  <button
                    key={p.linha}
                    type="button"
                    onClick={() => adicionarDoCatalogo(p)}
                    className="chip chip-off"
                  >
                    {p.descricao}
                    {p.venda != null && (
                      <span className="ml-1 text-grafite/50">{formatBRL(p.venda)}</span>
                    )}
                  </button>
                ))}
              </div>
            </>
          )}
          {codigo !== '' && porCodigo.length === 0 && (
            <p className="mt-1 text-xs text-tawny">
              Código não está no catálogo — cadastre o produto na aba Cadastrar primeiro.
            </p>
          )}
        </div>

        <div>
          <label className="rotulo" htmlFor="venda-descricao">
            Ou busque o produto
          </label>
          <input
            id="venda-descricao"
            className="campo"
            value={descricao}
            onChange={(e) => aoMudarDescricao(e.target.value)}
            list="lista-produtos-venda"
            placeholder="buscar pelo nome"
            autoCapitalize="words"
          />
          <datalist id="lista-produtos-venda">
            {catalogo.produtos.map((p) => (
              <option key={p.linha} value={p.descricao} />
            ))}
          </datalist>
          {descricao.trim() !== '' && !produtoSel && (
            <p className="mt-1 text-xs text-tawny">
              Não está no catálogo — escolha um da lista ou cadastre na aba Cadastrar.
            </p>
          )}
        </div>

        {produtoSel && (
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <label className="rotulo" htmlFor="venda-preco">
                Preço (un.)
              </label>
              <input
                id="venda-preco"
                className="campo"
                value={preco}
                onChange={(e) => setPreco(e.target.value)}
                inputMode="decimal"
                placeholder="0,00"
              />
            </div>
            <button
              type="button"
              onClick={aoAdicionarBuscado}
              className="btn-secundario shrink-0 px-5"
            >
              ＋ Adicionar
            </button>
          </div>
        )}
      </div>

      {/* ---------- Carrinho ---------- */}
      <div className="mt-4 rounded-xl2 bg-white p-4 shadow-card">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-semibold text-grafite">
            🛍️ Carrinho
            {pecas > 0 && (
              <span className="ml-1 font-normal text-grafite/50">
                · {pecas} {pecas === 1 ? 'peça' : 'peças'}
              </span>
            )}
          </h2>
          {itens.length > 0 && (
            <button onClick={esvaziar} className="text-xs text-grafite/50 underline">
              Esvaziar
            </button>
          )}
        </div>

        {itens.length === 0 ? (
          <p className="py-4 text-center text-sm text-grafite/40">
            Escaneie ou busque os produtos para ir montando a venda.
          </p>
        ) : (
          <ul className="divide-y divide-rose-soft/40">
            {itens.map((it) => {
              const t = totalItem(it)
              return (
                <li key={it.id} className="py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium text-grafite">{it.descricao}</p>
                      {it.linhaCatalogo == null && (
                        <p className="text-xs text-tawny">fora do catálogo — remova</p>
                      )}
                    </div>
                    <button
                      onClick={() => remover(it.id)}
                      aria-label={`Remover ${it.descricao}`}
                      className="-mr-2 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-lg text-grafite/40 active:bg-rose/10"
                    >
                      🗑️
                    </button>
                  </div>

                  <div className="mt-1 flex items-center gap-3">
                    {/* quantidade */}
                    <div className="flex items-center rounded-full border border-rose-soft">
                      <button
                        onClick={() => mudarQtd(it.id, -1)}
                        disabled={it.quantidade <= 1}
                        aria-label="Diminuir"
                        className="flex h-11 w-11 items-center justify-center text-xl text-rose-deep disabled:text-grafite/20"
                      >
                        −
                      </button>
                      <span className="w-6 text-center font-semibold">{it.quantidade}</span>
                      <button
                        onClick={() => mudarQtd(it.id, +1)}
                        aria-label="Aumentar"
                        className="flex h-11 w-11 items-center justify-center text-xl text-rose-deep"
                      >
                        +
                      </button>
                    </div>

                    {/* preço unitário (editável p/ desconto) */}
                    <div className="flex items-center gap-1 text-sm text-grafite/60">
                      <span>×</span>
                      <input
                        className="campo w-20 px-2 py-2 text-center"
                        value={it.precoUnit}
                        onChange={(e) => mudarPreco(it.id, e.target.value)}
                        inputMode="decimal"
                        placeholder="0,00"
                        aria-label={`Preço de ${it.descricao}`}
                      />
                    </div>

                    <span
                      className={`ml-auto font-semibold ${t == null ? 'text-tawny' : 'text-grafite'}`}
                    >
                      {t == null ? 'sem preço' : formatBRL(t)}
                    </span>
                  </div>
                </li>
              )
            })}
          </ul>
        )}

        {itens.length > 0 && (
          <div className="mt-2 flex items-baseline justify-between border-t border-rose-soft/60 pt-3">
            <span className="text-sm text-grafite/60">Total</span>
            <span className="font-marca text-2xl font-semibold text-rose-deep">
              {formatBRL(total)}
            </span>
          </div>
        )}
      </div>

      {/* ---------- Dados da venda ---------- */}
      <div className="mt-4 space-y-4 rounded-xl2 bg-white p-4 shadow-card">
        {/* À vista | Fiado */}
        <div className="grid grid-cols-2 gap-1 rounded-xl2 bg-creme p-1">
          {(['avista', 'fiado'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setModo(m)}
              aria-pressed={modo === m}
              className={`rounded-xl2 py-2 text-sm font-medium transition ${
                modo === m ? 'bg-rose text-white' : 'text-grafite/60'
              }`}
            >
              {m === 'avista' ? 'À vista' : 'Fiado'}
            </button>
          ))}
        </div>
        {modo === 'fiado' && !servidorSabeFiado && (
          <p className="rounded-xl2 bg-rose/10 px-3 py-2 text-sm text-rose-deep">
            O servidor (Apps Script) ainda não sabe gravar fiado. Publique a versão nova em
            Implantar → Gerenciar implantações. Até lá, só venda à vista.
          </p>
        )}

        <div>
          <label className="rotulo" htmlFor="venda-cliente">
            Cliente
          </label>
          <input
            id="venda-cliente"
            className="campo"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            list="lista-clientes"
            placeholder="buscar ou digitar (avulsa)"
            autoCapitalize="words"
          />
          <datalist id="lista-clientes">
            {catalogo.clientes.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          {clienteNova && (
            <p className="mt-1 text-xs text-tawny">
              Cliente nova — vai ser cadastrada no Cadastro de Clientes junto com a venda.
            </p>
          )}
        </div>

        {fiado && (
          <div className="space-y-3 rounded-xl2 border border-rose-soft/60 p-3">
            <div className="flex items-center justify-between">
              <span className="rotulo mb-0">Parcelas</span>
              <div className="flex items-center rounded-full border border-rose-soft">
                <button
                  type="button"
                  onClick={() => setNParcelas((n) => Math.max(1, n - 1))}
                  disabled={nParcelas <= 1}
                  aria-label="Menos parcelas"
                  className="flex h-11 w-11 items-center justify-center text-xl text-rose-deep disabled:text-grafite/20"
                >
                  −
                </button>
                <span className="w-8 text-center font-semibold">{nParcelas}x</span>
                <button
                  type="button"
                  onClick={() => setNParcelas((n) => Math.min(12, n + 1))}
                  disabled={nParcelas >= 12}
                  aria-label="Mais parcelas"
                  className="flex h-11 w-11 items-center justify-center text-xl text-rose-deep disabled:text-grafite/20"
                >
                  +
                </button>
              </div>
            </div>

            {nParcelas > 1 && (
              <label className="flex min-h-[44px] items-center gap-3 text-sm text-grafite">
                <input
                  type="checkbox"
                  checked={entrada}
                  onChange={(e) => setEntrada(e.target.checked)}
                  className="h-5 w-5 accent-rose"
                />
                1ª parcela paga hoje (entrada)
              </label>
            )}

            <div>
              <label className="rotulo" htmlFor="venda-venc">
                {comEntrada ? 'Vencimento da 2ª parcela' : 'Vencimento da 1ª parcela'}
              </label>
              <input
                id="venda-venc"
                type="date"
                className="campo"
                value={primeiroVenc}
                onChange={(e) => setPrimeiroVenc(e.target.value)}
              />
              <p className="mt-1 text-xs text-grafite/50">As outras vencem no mesmo dia dos meses seguintes.</p>
            </div>

            {itens.length > 0 && primeiroVenc && (
              <ul className="divide-y divide-rose-soft/40 text-sm">
                {parcelas.map((p, i) => (
                  <li key={i} className="flex items-center justify-between py-2">
                    <span className="text-grafite/70">
                      {i + 1}/{nParcelas} · {dataCurta(p.vencimento)}
                    </span>
                    <span className="flex items-center gap-2">
                      {p.paga && (
                        <span className="rounded-full bg-rose-soft/50 px-2 py-0.5 text-xs text-rose-deep">
                          paga hoje
                        </span>
                      )}
                      <span className="font-semibold text-grafite">{formatBRL(p.valor)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {pedeFormaConta && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="rotulo" htmlFor="venda-forma">
              {fiado ? 'Forma da entrada' : 'Forma de recebimento'}
            </label>
            <select
              id="venda-forma"
              className="campo"
              value={forma}
              onChange={(e) => setForma(e.target.value)}
            >
              {catalogo.opcoes.formaRecebimento.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="rotulo" htmlFor="venda-conta">
              Conta
            </label>
            <select
              id="venda-conta"
              className="campo"
              value={conta}
              onChange={(e) => setConta(e.target.value)}
            >
              <option value="">—</option>
              {catalogo.opcoes.conta.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </div>
        </div>
        )}

        <div>
          <label className="rotulo" htmlFor="venda-data">
            Data
          </label>
          <input
            id="venda-data"
            type="date"
            className="campo"
            value={data}
            onChange={(e) => setData(e.target.value)}
          />
        </div>
      </div>

      {erro && (
        <p className="mt-4 rounded-xl2 bg-rose/10 px-4 py-3 text-sm text-rose-deep">{erro}</p>
      )}
      {sucesso && (
        <p className="mt-4 rounded-xl2 bg-rose-soft/40 px-4 py-3 text-sm font-medium text-rose-deep">
          {sucesso}
        </p>
      )}

      {/* Barra fixa de registrar */}
      <div className="fixed inset-x-0 bottom-0 border-t border-rose-soft/50 bg-creme/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto max-w-md">
          <button onClick={aoRegistrar} disabled={!podeRegistrar} className="btn-primario">
            {salvando
              ? 'Registrando…'
              : `${fiado ? 'Registrar fiado' : 'Registrar venda'}${
                  itens.length ? ` · ${formatBRL(total)}` : ''
                }`}
          </button>
        </div>
      </div>

      {scannerAberto && (
        <Suspense
          fallback={
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-grafite/95 text-white">
              Abrindo a câmera…
            </div>
          }
        >
          <Scanner onDetect={aoDetectar} onClose={() => setScannerAberto(false)} />
        </Suspense>
      )}
    </div>
  )
}
