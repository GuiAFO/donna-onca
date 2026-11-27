import { useEffect, useMemo, useState } from 'react'
import { formatBRL } from '../lib/format'
import { dataLonga, hojeISO } from '../lib/fiado'
import {
  listParcelas,
  receberParcelas,
  type Catalogo,
  type ParcelaPendente,
} from '../lib/api'

/** Chave única de uma parcela: aba + linha. */
const chave = (p: ParcelaPendente) => `${p.aba}#${p.linha}`

type Grupo = { nome: string; parcelas: ParcelaPendente[]; total: number; atraso: number }

export default function TelaReceber({ catalogo }: { catalogo: Catalogo }) {
  const [parcelas, setParcelas] = useState<ParcelaPendente[] | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erroLista, setErroLista] = useState<string | null>(null)

  const [busca, setBusca] = useState('')
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set())
  const [forma, setForma] = useState('')
  const [conta, setConta] = useState('')

  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [sucesso, setSucesso] = useState<string | null>(null)

  const hoje = hojeISO()

  function carregar() {
    setCarregando(true)
    setErroLista(null)
    listParcelas()
      .then((ps) => {
        setParcelas(ps)
        // tira da seleção o que não está mais pendente
        setMarcadas((m) => new Set([...m].filter((k) => ps.some((p) => chave(p) === k))))
      })
      .catch((e: Error) => setErroLista(e.message))
      .finally(() => setCarregando(false))
  }
  useEffect(carregar, [])

  // padrões dos menus (quando o catálogo chega)
  useEffect(() => {
    setForma((f) => f || catalogo.opcoes.formaRecebimento[0] || '')
    setConta((c) => c || catalogo.opcoes.conta[0] || '')
  }, [catalogo.opcoes])

  // agrupa por cliente, na ordem da parcela mais antiga de cada uma
  const grupos: Grupo[] = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    const mapa = new Map<string, Grupo>()
    for (const p of parcelas ?? []) {
      if (termo && !p.nome.toLowerCase().includes(termo)) continue
      const g = mapa.get(p.nome) ?? { nome: p.nome, parcelas: [], total: 0, atraso: 0 }
      g.parcelas.push(p)
      g.total += p.valor
      if (p.vencimento && p.vencimento < hoje) g.atraso += p.valor
      mapa.set(p.nome, g)
    }
    return [...mapa.values()]
  }, [parcelas, busca, hoje])

  const resumo = useMemo(() => {
    let total = 0
    let atraso = 0
    for (const p of parcelas ?? []) {
      total += p.valor
      if (p.vencimento && p.vencimento < hoje) atraso += p.valor
    }
    return { total, atraso }
  }, [parcelas, hoje])

  const selecionadas = useMemo(
    () => (parcelas ?? []).filter((p) => marcadas.has(chave(p))),
    [parcelas, marcadas],
  )
  const totalSelecionado = selecionadas.reduce((s, p) => s + p.valor, 0)

  function alternar(p: ParcelaPendente) {
    setSucesso(null)
    setErro(null)
    setMarcadas((m) => {
      const n = new Set(m)
      const k = chave(p)
      if (n.has(k)) n.delete(k)
      else n.add(k)
      return n
    })
  }

  function marcarTodas(g: Grupo) {
    setSucesso(null)
    setErro(null)
    setMarcadas((m) => {
      const n = new Set(m)
      const todas = g.parcelas.every((p) => n.has(chave(p)))
      for (const p of g.parcelas) {
        if (todas) n.delete(chave(p))
        else n.add(chave(p))
      }
      return n
    })
  }

  async function aoReceber() {
    if (!selecionadas.length) return
    setSalvando(true)
    setErro(null)
    setSucesso(null)
    try {
      const r = await receberParcelas(selecionadas, forma, conta)
      const recebidas = new Set(selecionadas.map(chave))
      setParcelas((ps) => (ps ?? []).filter((p) => !recebidas.has(chave(p))))
      setMarcadas(new Set())
      setSucesso(
        `Recebido! ${r.recebidas} ${r.recebidas === 1 ? 'parcela' : 'parcelas'} · ${formatBRL(
          r.total || totalSelecionado,
        )} ✨`,
      )
    } catch (e) {
      setErro((e as Error).message)
    } finally {
      setSalvando(false)
    }
  }

  const podeReceber = selecionadas.length > 0 && !!forma && !salvando

  return (
    <>
      {/* Resumo */}
      <div className="mb-4 grid grid-cols-2 gap-3">
        <div className="rounded-xl2 bg-white p-4 shadow-card">
          <p className="text-xs text-grafite/50">A receber</p>
          <p className="text-lg font-semibold text-grafite">{formatBRL(resumo.total)}</p>
        </div>
        <div className="rounded-xl2 bg-white p-4 shadow-card">
          <p className="text-xs text-grafite/50">Em atraso</p>
          <p
            className={`text-lg font-semibold ${
              resumo.atraso > 0 ? 'text-tawny' : 'text-grafite'
            }`}
          >
            {formatBRL(resumo.atraso)}
          </p>
        </div>
      </div>

      <div className="mb-4 flex gap-2">
        <input
          className="campo flex-1"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="buscar cliente"
          aria-label="Buscar cliente"
          autoCapitalize="words"
        />
        <button
          type="button"
          onClick={carregar}
          disabled={carregando}
          className="btn-secundario shrink-0"
        >
          {carregando ? '…' : 'Atualizar'}
        </button>
      </div>

      {carregando && parcelas === null && (
        <p
          role="status"
          className="mb-4 flex items-center gap-2 rounded-xl2 bg-rose-soft/30 px-4 py-3 text-sm text-rose-deep"
        >
          <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-rose-deep/30 border-t-rose-deep" />
          Buscando parcelas pendentes…
        </p>
      )}
      {erroLista && (
        <div className="mb-4 rounded-xl2 bg-tawny/10 px-4 py-3 text-sm text-tawny">
          <p>{erroLista}</p>
          <button onClick={carregar} className="mt-2 font-semibold underline">
            Tentar de novo
          </button>
        </div>
      )}

      {parcelas !== null && grupos.length === 0 && (
        <p className="rounded-xl2 bg-white px-4 py-6 text-center text-sm text-grafite/60 shadow-card">
          {busca.trim() ? 'Nenhuma parcela pendente para essa busca.' : 'Nenhuma parcela pendente. 🎉'}
        </p>
      )}

      {/* Clientes */}
      <div className="space-y-3">
        {grupos.map((g) => {
          const todas = g.parcelas.every((p) => marcadas.has(chave(p)))
          return (
            <section key={g.nome} className="rounded-xl2 bg-white p-4 shadow-card">
              <div className="mb-2 flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold text-grafite">{g.nome.trim()}</h2>
                  <p className="text-xs text-grafite/50">
                    {formatBRL(g.total)} pendente
                    {g.atraso > 0 && (
                      <span className="text-tawny"> · {formatBRL(g.atraso)} em atraso</span>
                    )}
                  </p>
                </div>
                {g.parcelas.length > 1 && (
                  <button
                    type="button"
                    onClick={() => marcarTodas(g)}
                    className="min-h-[44px] shrink-0 px-2 text-sm text-rose-deep underline"
                  >
                    {todas ? 'desmarcar' : 'marcar todas'}
                  </button>
                )}
              </div>
              <ul className="divide-y divide-rose-soft/40">
                {g.parcelas.map((p) => {
                  const on = marcadas.has(chave(p))
                  const atrasada = !!p.vencimento && p.vencimento < hoje
                  const venceHoje = p.vencimento === hoje
                  return (
                    <li key={chave(p)}>
                      <label className="flex min-h-[48px] cursor-pointer items-center gap-3 py-2">
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => alternar(p)}
                          className="h-5 w-5 shrink-0 accent-rose"
                        />
                        <span className="flex-1 text-sm">
                          <span className="text-grafite">Parcela {p.parcela}</span>
                          <span className="block text-xs text-grafite/50">
                            vence {p.vencimento ? dataLonga(p.vencimento) : '—'}
                          </span>
                        </span>
                        {atrasada && (
                          <span className="rounded-full bg-tawny/15 px-2 py-0.5 text-xs text-tawny">
                            atrasada
                          </span>
                        )}
                        {venceHoje && (
                          <span className="rounded-full bg-rose-soft/50 px-2 py-0.5 text-xs text-rose-deep">
                            vence hoje
                          </span>
                        )}
                        <span className="font-semibold text-grafite">{formatBRL(p.valor)}</span>
                      </label>
                    </li>
                  )
                })}
              </ul>
            </section>
          )
        })}
      </div>

      {/* Como recebeu */}
      {selecionadas.length > 0 && (
        <div className="mt-4 grid grid-cols-2 gap-3 rounded-xl2 bg-white p-4 shadow-card">
          <div>
            <label className="rotulo" htmlFor="receber-forma">
              Forma de recebimento
            </label>
            <select
              id="receber-forma"
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
            <label className="rotulo" htmlFor="receber-conta">
              Conta
            </label>
            <select
              id="receber-conta"
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

      {erro && (
        <p className="mt-4 rounded-xl2 bg-rose/10 px-4 py-3 text-sm text-rose-deep">{erro}</p>
      )}
      {sucesso && (
        <p className="mt-4 rounded-xl2 bg-rose-soft/40 px-4 py-3 text-sm font-medium text-rose-deep">
          {sucesso}
        </p>
      )}

      {/* Barra fixa */}
      <div className="fixed inset-x-0 bottom-0 border-t border-rose-soft/50 bg-creme/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto max-w-md">
          <button onClick={aoReceber} disabled={!podeReceber} className="btn-primario">
            {salvando
              ? 'Registrando…'
              : selecionadas.length
                ? `Receber ${selecionadas.length} ${
                    selecionadas.length === 1 ? 'parcela' : 'parcelas'
                  } · ${formatBRL(totalSelecionado)}`
                : 'Marque as parcelas recebidas'}
          </button>
        </div>
      </div>
    </>
  )
}
