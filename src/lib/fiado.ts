// Cálculo das parcelas do fiado (puro, sem tela).
import type { ParcelaFiado } from './api'

/** Soma k meses a uma data 'YYYY-MM-DD'. Dia 31 em mês curto vira o último dia. */
export function somarMeses(iso: string, k: number): string {
  const [a, m, d] = iso.split('-').map(Number)
  const alvo = new Date(a, m - 1 + k, 1)
  const ultimoDia = new Date(alvo.getFullYear(), alvo.getMonth() + 1, 0).getDate()
  const dia = Math.min(d, ultimoDia)
  const mm = String(alvo.getMonth() + 1).padStart(2, '0')
  const dd = String(dia).padStart(2, '0')
  return `${alvo.getFullYear()}-${mm}-${dd}`
}

/** '2026-12-27' -> '27/12' */
export function dataCurta(iso: string): string {
  const [, m, d] = iso.split('-')
  return `${d}/${m}`
}

/**
 * Divide o total em n parcelas mensais.
 * - Os centavos que sobram da divisão vão para a última parcela
 *   (ex.: R$ 100,00 em 3x = 33,33 + 33,33 + 33,34), então a soma bate exato.
 * - Com entrada: a 1ª parcela vence (e é paga) na data da venda e as demais
 *   começam em `primeiroVenc`. Sem entrada: todas começam em `primeiroVenc`.
 */
export function montarParcelas(
  total: number,
  n: number,
  primeiroVenc: string,
  dataVenda: string,
  entrada: boolean,
): ParcelaFiado[] {
  const centavos = Math.round(total * 100)
  const base = Math.floor(centavos / n)
  const resto = centavos - base * n
  const out: ParcelaFiado[] = []
  for (let i = 0; i < n; i++) {
    const valor = (base + (i === n - 1 ? resto : 0)) / 100
    const paga = entrada && i === 0
    const vencimento = paga
      ? dataVenda
      : somarMeses(primeiroVenc, entrada ? i - 1 : i)
    out.push({ vencimento, valor, paga })
  }
  return out
}
