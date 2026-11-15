// Formatação e parsing auxiliares.

export const TAMANHOS_PADRAO = ['PP', 'P', 'M', 'G', 'GG', 'XG'] as const

const TOKENS_TAMANHO = new Set([
  'PP', 'P', 'M', 'G', 'GG', 'XG', 'XGG', 'U', 'UN', 'UNI', 'UNICO', 'ÚNICO',
  '36', '38', '40', '42', '44', '46', '48',
])

/** Remove o tamanho do fim de uma descrição ("Tanga Levanta Bumbum GG" -> "Tanga Levanta Bumbum"). */
export function stripTamanho(desc: string): string {
  const partes = (desc || '').trim().split(/\s+/)
  if (partes.length > 1) {
    const ultimo = partes[partes.length - 1].toUpperCase()
    if (TOKENS_TAMANHO.has(ultimo)) partes.pop()
  }
  return partes.join(' ').trim()
}

/** Converte texto digitado ("21,50", "R$ 21.50", "22") em número, ou null. */
export function parseValor(s: string): number | null {
  if (s == null) return null
  let t = String(s).trim().replace(/[R$\s]/gi, '')
  if (!t) return null
  if (t.includes(',')) {
    // vírgula é decimal; pontos são milhar
    t = t.replace(/\./g, '').replace(',', '.')
  }
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

/** Formata número como moeda brasileira. */
export function formatBRL(n: number | null): string {
  if (n == null) return ''
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}
