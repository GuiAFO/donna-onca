import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { interpretarLeitura } from '../lib/barcode'
import { parseValor, formatBRL } from '../lib/format'
import { salvarVenda, type Catalogo, type ProdutoCatalogo, type Venda } from '../lib/api'

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

export default function TelaVenda({ catalogo }: { catalogo: Catalogo }) {
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

  const pecas = itens.reduce((s, it) => s + it.quantidade, 0)
  const total = itens.reduce((s, it) => s + (totalItem(it) ?? 0), 0)
  const semPreco = itens.some((it) => totalItem(it) == null)

  // ---------- carrinho ----------

  function adicionarAoCarrinho(desc: string, precoUnit: string, linha: number | null) {
    // Do catálogo: texto EXATO (até espaço no fim), porque a fórmula de Saídas do
    // Estoque casa a venda pela Descrição. Digitado à mão: pode aparar.
    const d = linha != null ? desc : desc.trim()
    if (!d.trim()) return
    setItens((atual) => {
      // mesmo produto de novo → só soma a quantidade
      const i = atual.findIndex((it) =>
        linha != null
          ? it.linhaCatalogo === linha
          : it.linhaCatalogo == null && it.descricao.toLowerCase() === d.toLowerCase(),
      )
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

  function aoAdicionarManual() {
    if (produtoSel) {
      adicionarAoCarrinho(produtoSel.descricao, preco, produtoSel.linha)
    } else {
      adicionarAoCarrinho(descricao, preco, null)
    }
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

  const podeRegistrar = itens.length > 0 && !semPreco && nome.trim() !== '' && !salvando

  async function aoRegistrar() {
    setErro(null)
    setSucesso(null)
    if (!itens.length) return setErro('O carrinho está vazio.')
    if (nome.trim() === '') return setErro('Preencha o nome da cliente.')
    if (semPreco) return setErro('Tem item sem preço no carrinho.')
    setSalvando(true)
    try {
      const venda: Venda = {
        data,
        nome: nome.trim(),
        forma,
        conta,
        status: 'Efetuado',
        itens: itens.map((it) => ({
          descricao: it.descricao,
          quantidade: it.quantidade,
          valor: totalItem(it),
          linhaCatalogo: it.linhaCatalogo,
        })),
      }
      await salvarVenda(venda)
      setSucesso(
        `Venda registrada! ${pecas} ${pecas === 1 ? 'peça' : 'peças'} · ${formatBRL(total)} ✨`,
      )
      setItens([])
      setNome('')
    } catch (e) {
      setErro((e as Error).message)
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="pb-24">
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
              Código não está no catálogo — digite o produto abaixo.
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
            placeholder="buscar ou digitar"
            autoCapitalize="words"
          />
          <datalist id="lista-produtos-venda">
            {catalogo.produtos.map((p) => (
              <option key={p.linha} value={p.descricao} />
            ))}
          </datalist>
          {descricao.trim() !== '' && !produtoSel && (
            <p className="mt-1 text-xs text-tawny">
              Fora do catálogo — entra na venda, mas sem baixa no estoque.
            </p>
          )}
        </div>

        {descricao.trim() !== '' && (
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
              onClick={aoAdicionarManual}
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
                        <p className="text-xs text-tawny">sem baixa no estoque</p>
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
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="rotulo" htmlFor="venda-forma">
              Forma de recebimento
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
              : itens.length
                ? `Registrar venda · ${formatBRL(total)}`
                : 'Registrar venda'}
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
