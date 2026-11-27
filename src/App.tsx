import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import CampoVoz from './components/CampoVoz'
// Scanner carregado sob demanda: o ZXing (maior dependência) só baixa ao escanear.
const Scanner = lazy(() => import('./components/Scanner'))
import { interpretarLeitura } from './lib/barcode'
import {
  listProdutos,
  salvarProdutos,
  type Catalogo,
  type LinhaParaSalvar,
  type ProdutoCatalogo,
} from './lib/api'
import { TAMANHOS_PADRAO, parseValor, stripTamanho, formatBRL } from './lib/format'
import TelaVenda from './components/TelaVenda'

const FORNECEDOR_PADRAO = 'Valentina Moda Intima'

export default function App() {
  const [catalogo, setCatalogo] = useState<Catalogo>({
    fornecedores: [],
    produtos: [],
    clientes: [],
    opcoes: { formaRecebimento: [], conta: [], status: ['Efetuado', 'Pendente'] },
  })
  const [erroCatalogo, setErroCatalogo] = useState<string | null>(null)

  const [aba, setAba] = useState<'cadastrar' | 'vender'>('cadastrar')
  const [scannerAberto, setScannerAberto] = useState(false)

  // campos do formulário
  const [codigo, setCodigo] = useState('')
  const [descricaoBase, setDescricaoBase] = useState('')
  const [fornecedor, setFornecedor] = useState(FORNECEDOR_PADRAO)
  const [custo, setCusto] = useState('')
  const [venda, setVenda] = useState('')
  const [cor, setCor] = useState('')
  const [quantidade, setQuantidade] = useState('')
  const [tamanhos, setTamanhos] = useState<string[]>([])
  const [tamanhoExtra, setTamanhoExtra] = useState('')
  const [leituraCrua, setLeituraCrua] = useState<string | null>(null)

  const [salvando, setSalvando] = useState(false)
  const [sucesso, setSucesso] = useState<string | null>(null)
  const [erroSalvar, setErroSalvar] = useState<string | null>(null)

  // carrega o catálogo (fornecedores + sugestão de preço); tolera falha
  useEffect(() => {
    listProdutos()
      .then(setCatalogo)
      .catch((e: Error) => setErroCatalogo(e.message))
  }, [])

  const fornecedores = useMemo(() => {
    const s = new Set<string>([FORNECEDOR_PADRAO, ...catalogo.fornecedores])
    for (const p of catalogo.produtos) if (p.fornecedor) s.add(p.fornecedor)
    return [...s].filter(Boolean).sort()
  }, [catalogo])

  // produtos já cadastrados com o código atual
  const existentes: ProdutoCatalogo[] = useMemo(
    () => (codigo ? catalogo.produtos.filter((p) => String(p.codigo) === String(codigo)) : []),
    [codigo, catalogo],
  )

  function preencherPorCodigo(cod: string) {
    const achados = catalogo.produtos.filter((p) => String(p.codigo) === String(cod))
    if (achados.length === 0) return
    const ult = achados[achados.length - 1]
    setDescricaoBase(stripTamanho(ult.descricao))
    if (ult.fornecedor) setFornecedor(ult.fornecedor)
    if (ult.custo != null) setCusto(String(ult.custo).replace('.', ','))
    if (ult.venda != null) setVenda(String(ult.venda).replace('.', ','))
    if (ult.cor) setCor(ult.cor)
  }

  function aoDetectar(code: string) {
    const { ref, cru } = interpretarLeitura(code)
    setLeituraCrua(cru)
    setScannerAberto(false)
    setSucesso(null)
    setErroSalvar(null)
    if (ref) {
      setCodigo(ref)
      preencherPorCodigo(ref)
    }
  }

  function alternarTamanho(t: string) {
    setTamanhos((atual) =>
      atual.includes(t) ? atual.filter((x) => x !== t) : [...atual, t],
    )
  }

  function adicionarTamanhoExtra() {
    const t = tamanhoExtra.trim().toUpperCase()
    if (t && !tamanhos.includes(t)) setTamanhos((a) => [...a, t])
    setTamanhoExtra('')
  }

  // linhas que serão gravadas (uma por tamanho, ou uma só se não houver tamanho)
  const linhas: LinhaParaSalvar[] = useMemo(() => {
    const base = descricaoBase.trim()
    if (!base || !codigo.trim()) return []
    const cst = parseValor(custo)
    const vnd = parseValor(venda)
    const fnc = fornecedor.trim()
    const cr = cor.trim()
    const digitos = quantidade.replace(/[^\d]/g, '')
    const qtd = digitos ? parseInt(digitos, 10) : null
    const comum = { codigo: codigo.trim(), fornecedor: fnc, custo: cst, venda: vnd, cor: cr, quantidade: qtd }
    if (tamanhos.length === 0) {
      return [{ ...comum, descricao: base }]
    }
    return tamanhos.map((t) => ({ ...comum, descricao: `${base} ${t}`.trim() }))
  }, [codigo, descricaoBase, fornecedor, custo, venda, cor, quantidade, tamanhos])

  // avisos de duplicado (código + descrição idêntica já existe no catálogo)
  const duplicados = useMemo(
    () =>
      linhas
        .filter((l) =>
          catalogo.produtos.some(
            (p) =>
              String(p.codigo) === l.codigo &&
              p.descricao.toLowerCase().trim() === l.descricao.toLowerCase().trim(),
          ),
        )
        .map((l) => l.descricao),
    [linhas, catalogo],
  )

  function limpar(manterFornecedor = true) {
    setCodigo('')
    setDescricaoBase('')
    setCusto('')
    setVenda('')
    setCor('')
    setQuantidade('')
    setTamanhos([])
    setTamanhoExtra('')
    setLeituraCrua(null)
    if (!manterFornecedor) setFornecedor(FORNECEDOR_PADRAO)
  }

  async function aoSalvar() {
    setErroSalvar(null)
    setSucesso(null)
    if (linhas.length === 0) {
      setErroSalvar('Preencha ao menos o Código e a Descrição.')
      return
    }
    setSalvando(true)
    try {
      const r = await salvarProdutos(linhas)
      // atualiza o catálogo local para sugestões/duplicados seguirem corretos
      setCatalogo((c) => ({
        ...c,
        produtos: [
          ...c.produtos,
          ...linhas.map((l) => ({
            codigo: l.codigo,
            descricao: l.descricao,
            fornecedor: l.fornecedor,
            custo: l.custo,
            venda: l.venda,
            cor: l.cor,
            linha: 0,
          })),
        ],
      }))
      setSucesso(
        r.inseridas > 1
          ? `${r.inseridas} itens cadastrados! ✨`
          : 'Produto cadastrado! ✨',
      )
      limpar(true)
    } catch (e) {
      setErroSalvar((e as Error).message)
    } finally {
      setSalvando(false)
    }
  }

  const podeSalvar = linhas.length > 0 && !salvando

  return (
    <div className="mx-auto min-h-full max-w-md px-4 pb-28 pt-5">
      {/* Cabeçalho da marca */}
      <header className="mb-5 flex items-center gap-3">
        <img src="icone.svg" alt="" className="h-11 w-11 rounded-xl2" />
        <div>
          <h1 className="font-marca text-2xl leading-none text-grafite">Donna Onça</h1>
          <p className="text-sm text-grafite/60">Cadastro rápido de produtos</p>
        </div>
      </header>

      {erroCatalogo && (
        <p className="mb-4 rounded-xl2 bg-tawny/10 px-4 py-3 text-sm text-tawny">
          Catálogo não carregou (autocomplete e sugestões ficam limitados): {erroCatalogo}
        </p>
      )}

      {/* Alternância Cadastrar | Vender */}
      <div className="mb-4 grid grid-cols-2 gap-1 rounded-xl2 bg-white p-1 shadow-card">
        <button
          type="button"
          onClick={() => setAba('cadastrar')}
          className={`rounded-xl2 py-2 text-sm font-medium transition ${
            aba === 'cadastrar' ? 'bg-rose text-white' : 'text-grafite/60'
          }`}
        >
          Cadastrar
        </button>
        <button
          type="button"
          onClick={() => setAba('vender')}
          className={`rounded-xl2 py-2 text-sm font-medium transition ${
            aba === 'vender' ? 'bg-rose text-white' : 'text-grafite/60'
          }`}
        >
          Vender
        </button>
      </div>

      {aba === 'vender' && (
        <TelaVenda
          catalogo={catalogo}
          onClienteNova={(nome) =>
            setCatalogo((c) =>
              c.clientes.includes(nome) ? c : { ...c, clientes: [...c.clientes, nome] },
            )
          }
        />
      )}

      {aba === 'cadastrar' && (
        <>
      {/* Botão escanear */}
      <button onClick={() => setScannerAberto(true)} className="btn-primario mb-3">
        <span className="text-xl">📷</span> Escanear código de barras
      </button>

      {leituraCrua && (
        <p className="mb-4 text-center text-xs text-grafite/50">
          Código de barras lido: {leituraCrua}
        </p>
      )}

      {/* Formulário */}
      <div className="space-y-4 rounded-xl2 bg-white p-4 shadow-card">
        <div>
          <label className="rotulo" htmlFor="codigo">
            Código (referência)
          </label>
          <input
            id="codigo"
            className="campo"
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            onBlur={() => codigo && preencherPorCodigo(codigo)}
            inputMode="numeric"
            placeholder="ex.: 1212"
          />
          {existentes.length > 0 && (
            <p className="mt-1 text-xs text-rose-deep">
              Já cadastrado ({existentes.length}{' '}
              {existentes.length === 1 ? 'tamanho' : 'tamanhos'}): repondo item conhecido.
            </p>
          )}
        </div>

        <CampoVoz
          label="Descrição (sem o tamanho)"
          value={descricaoBase}
          onChange={setDescricaoBase}
          placeholder="ex.: Tanga Embutida"
        />

        <CampoVoz
          label="Cor"
          value={cor}
          onChange={setCor}
          placeholder="ex.: Preta"
          autoCapitalize="words"
        />

        {/* Tamanhos */}
        <div>
          <span className="rotulo">Tamanhos</span>
          <div className="flex flex-wrap gap-2">
            {TAMANHOS_PADRAO.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => alternarTamanho(t)}
                className={`chip ${tamanhos.includes(t) ? 'chip-on' : 'chip-off'}`}
              >
                {t}
              </button>
            ))}
            {tamanhos
              .filter((t) => !TAMANHOS_PADRAO.includes(t as (typeof TAMANHOS_PADRAO)[number]))
              .map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => alternarTamanho(t)}
                  className="chip chip-on"
                >
                  {t} ✕
                </button>
              ))}
          </div>
          <div className="mt-2 flex gap-2">
            <input
              className="campo flex-1 py-2"
              value={tamanhoExtra}
              onChange={(e) => setTamanhoExtra(e.target.value)}
              placeholder="outro tamanho (ex.: EG, 46, Único)"
              autoCapitalize="characters"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  adicionarTamanhoExtra()
                }
              }}
            />
            <button type="button" onClick={adicionarTamanhoExtra} className="btn-secundario">
              Add
            </button>
          </div>
          <p className="mt-1 text-xs text-grafite/50">
            Escolha um ou vários — cada tamanho vira uma linha na planilha.
          </p>
        </div>

        <div>
          <label className="rotulo" htmlFor="fornecedor">
            Fornecedor
          </label>
          <input
            id="fornecedor"
            className="campo"
            value={fornecedor}
            onChange={(e) => setFornecedor(e.target.value)}
            list="lista-fornecedores"
            autoCapitalize="words"
          />
          <datalist id="lista-fornecedores">
            {fornecedores.map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="rotulo" htmlFor="custo">
              Valor custo
            </label>
            <input
              id="custo"
              className="campo"
              value={custo}
              onChange={(e) => setCusto(e.target.value)}
              inputMode="decimal"
              placeholder="21,50"
            />
          </div>
          <div>
            <label className="rotulo" htmlFor="venda">
              Valor venda
            </label>
            <input
              id="venda"
              className="campo"
              value={venda}
              onChange={(e) => setVenda(e.target.value)}
              inputMode="decimal"
              placeholder="22,00"
            />
          </div>
        </div>

        {parseValor(custo) != null && parseValor(venda) != null && (
          <p className="text-xs text-grafite/50">
            Lucro: {formatBRL((parseValor(venda) ?? 0) - (parseValor(custo) ?? 0))}
          </p>
        )}

        <div>
          <label className="rotulo" htmlFor="quantidade">
            Quantidade (estoque)
          </label>
          <input
            id="quantidade"
            className="campo"
            value={quantidade}
            onChange={(e) => setQuantidade(e.target.value)}
            inputMode="numeric"
            placeholder="ex.: 3"
          />
          <p className="mt-1 text-xs text-grafite/50">
            Vai para a coluna “Atual” do Estoque do mês
            {tamanhos.length > 1 ? ' (a mesma quantidade para cada tamanho)' : ''}.
          </p>
        </div>

        {duplicados.length > 0 && (
          <p className="rounded-xl2 bg-tawny/10 px-3 py-2 text-xs text-tawny">
            Atenção: já existe na planilha → {duplicados.join(', ')}. Salvar vai criar outra linha.
          </p>
        )}
      </div>

      {/* Mensagens */}
      {erroSalvar && (
        <p className="mt-4 rounded-xl2 bg-rose/10 px-4 py-3 text-sm text-rose-deep">{erroSalvar}</p>
      )}
      {sucesso && (
        <p className="mt-4 rounded-xl2 bg-rose-soft/40 px-4 py-3 text-sm font-medium text-rose-deep">
          {sucesso}
        </p>
      )}

      <div className="mt-4 flex items-center justify-between">
        <button onClick={() => limpar(false)} className="text-sm text-grafite/50 underline">
          Limpar tudo
        </button>
        <span className="text-xs text-grafite/40">
          {linhas.length > 0
            ? `${linhas.length} ${linhas.length === 1 ? 'linha' : 'linhas'} a salvar`
            : ''}
        </span>
      </div>

      {/* Barra fixa de salvar */}
      <div className="fixed inset-x-0 bottom-0 border-t border-rose-soft/50 bg-creme/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto max-w-md">
          <button onClick={aoSalvar} disabled={!podeSalvar} className="btn-primario">
            {salvando ? 'Salvando…' : 'Salvar na planilha'}
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
      )}
    </div>
  )
}
