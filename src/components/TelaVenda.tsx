import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { interpretarLeitura } from '../lib/barcode'
import { parseValor, formatBRL } from '../lib/format'
import { salvarVenda, type Catalogo, type ProdutoCatalogo, type Venda } from '../lib/api'

// Mesmo Scanner do cadastro, carregado sob demanda.
const Scanner = lazy(() => import('./Scanner'))

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

export default function TelaVenda({ catalogo }: { catalogo: Catalogo }) {
  const [codigo, setCodigo] = useState('')
  const [descricao, setDescricao] = useState('')
  const [produtoSel, setProdutoSel] = useState<ProdutoCatalogo | null>(null)
  const [quantidade, setQuantidade] = useState('1')
  const [valor, setValor] = useState('')
  const [valorEditado, setValorEditado] = useState(false)
  const [nome, setNome] = useState('')
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

  const qtdNum = Math.max(1, parseInt(quantidade.replace(/[^\d]/g, ''), 10) || 1)

  // produtos que casam com o código atual (um por tamanho)
  const porCodigo = useMemo(
    () => (codigo ? catalogo.produtos.filter((p) => String(p.codigo) === String(codigo)) : []),
    [codigo, catalogo],
  )

  function sugerirValor(p: ProdutoCatalogo | null, q: number) {
    if (!valorEditado && p && p.venda != null) setValor(paraCampo(p.venda * q))
  }

  function selecionarProduto(p: ProdutoCatalogo) {
    setProdutoSel(p)
    setDescricao(p.descricao)
    if (p.codigo) setCodigo(String(p.codigo))
    sugerirValor(p, qtdNum)
  }

  function aoMudarDescricao(v: string) {
    setDescricao(v)
    const achado =
      catalogo.produtos.find(
        (p) => p.descricao.toLowerCase().trim() === v.toLowerCase().trim(),
      ) ?? null
    setProdutoSel(achado)
    sugerirValor(achado, qtdNum)
  }

  function aoMudarQtd(v: string) {
    setQuantidade(v)
    const q = Math.max(1, parseInt(v.replace(/[^\d]/g, ''), 10) || 1)
    sugerirValor(produtoSel, q)
  }

  function resolverPorCodigo(cod: string) {
    const achados = catalogo.produtos.filter((p) => String(p.codigo) === String(cod))
    if (achados.length === 1) selecionarProduto(achados[0])
  }

  function aoDetectar(code: string) {
    const { ref, cru } = interpretarLeitura(code)
    setLeituraCrua(cru)
    setScannerAberto(false)
    setSucesso(null)
    setErro(null)
    if (ref) {
      setCodigo(ref)
      resolverPorCodigo(ref)
    }
  }

  function limpar() {
    setCodigo('')
    setDescricao('')
    setProdutoSel(null)
    setQuantidade('1')
    setValor('')
    setValorEditado(false)
    setNome('')
    setLeituraCrua(null)
  }

  const podeRegistrar =
    descricao.trim() !== '' && nome.trim() !== '' && parseValor(valor) != null && !salvando

  async function aoRegistrar() {
    setErro(null)
    setSucesso(null)
    if (descricao.trim() === '' || nome.trim() === '') {
      setErro('Preencha ao menos o produto e a cliente.')
      return
    }
    setSalvando(true)
    try {
      const venda: Venda = {
        data,
        nome: nome.trim(),
        descricao: descricao.trim(),
        quantidade: qtdNum,
        forma,
        conta,
        status: 'Efetuado',
        valor: parseValor(valor),
        linhaCatalogo: produtoSel?.linha ?? null,
      }
      await salvarVenda(venda)
      setSucesso('Venda registrada! ✨')
      limpar()
    } catch (e) {
      setErro((e as Error).message)
    } finally {
      setSalvando(false)
    }
  }

  return (
    <>
      <button onClick={() => setScannerAberto(true)} className="btn-primario mb-3">
        <span className="text-xl">📷</span> Escanear código de barras
      </button>

      {leituraCrua && (
        <p className="mb-4 text-center text-xs text-grafite/50">
          Código de barras lido: {leituraCrua}
        </p>
      )}

      <div className="space-y-4 rounded-xl2 bg-white p-4 shadow-card">
        {/* Produto por código */}
        <div>
          <label className="rotulo" htmlFor="venda-codigo">
            Código (referência)
          </label>
          <input
            id="venda-codigo"
            className="campo"
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            onBlur={() => codigo && resolverPorCodigo(codigo)}
            inputMode="numeric"
            placeholder="ex.: 1212"
          />
          {porCodigo.length > 1 && (
            <>
              <p className="mt-2 text-xs text-grafite/60">Escolha o tamanho:</p>
              <div className="mt-1 flex flex-wrap gap-2">
                {porCodigo.map((p) => (
                  <button
                    key={p.linha}
                    type="button"
                    onClick={() => selecionarProduto(p)}
                    className={`chip ${
                      produtoSel?.linha === p.linha ? 'chip-on' : 'chip-off'
                    }`}
                  >
                    {p.descricao}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Produto (descrição) */}
        <div>
          <label className="rotulo" htmlFor="venda-descricao">
            Produto
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
          {produtoSel ? (
            <p className="mt-1 text-xs text-grafite/50">
              {produtoSel.venda != null ? `Preço ${formatBRL(produtoSel.venda)} · ` : ''}baixa
              automática no estoque.
            </p>
          ) : (
            descricao.trim() !== '' && (
              <p className="mt-1 text-xs text-tawny">
                Produto fora do catálogo — a venda entra, mas sem baixa no estoque.
              </p>
            )
          )}
        </div>

        {/* Quantidade + Valor */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="rotulo" htmlFor="venda-qtd">
              Quantidade
            </label>
            <input
              id="venda-qtd"
              className="campo"
              value={quantidade}
              onChange={(e) => aoMudarQtd(e.target.value)}
              inputMode="numeric"
              placeholder="1"
            />
          </div>
          <div>
            <label className="rotulo" htmlFor="venda-valor">
              Valor
            </label>
            <input
              id="venda-valor"
              className="campo"
              value={valor}
              onChange={(e) => {
                setValor(e.target.value)
                setValorEditado(true)
              }}
              inputMode="decimal"
              placeholder="0,00"
            />
          </div>
        </div>

        {/* Cliente */}
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

        {/* Forma de recebimento + Conta */}
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

        {/* Data */}
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

      <div className="mt-4 flex items-center justify-between">
        <button onClick={limpar} className="text-sm text-grafite/50 underline">
          Limpar
        </button>
        <span className="text-xs text-grafite/40">
          {parseValor(valor) != null ? `Total ${formatBRL(parseValor(valor) ?? 0)}` : ''}
        </span>
      </div>

      {/* Barra fixa de registrar */}
      <div className="fixed inset-x-0 bottom-0 border-t border-rose-soft/50 bg-creme/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto max-w-md">
          <button onClick={aoRegistrar} disabled={!podeRegistrar} className="btn-primario">
            {salvando ? 'Registrando…' : 'Registrar venda'}
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
    </>
  )
}
