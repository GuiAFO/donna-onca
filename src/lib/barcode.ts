// Utilidades de código de barras (EAN-13) para o cadastro Donna Onça.
//
// Padrão observado nas etiquetas da Valentina Moda Íntima:
//   7000000 | 01212 | 9
//   prefixo   ref     dígito verificador
// O código de barras embute a "Ref" impressa na etiqueta (ex.: Ref 1212).

const PREFIXO_VALENTINA = '7000000'

/** Mantém só os dígitos de uma string lida pelo leitor. */
export function somenteDigitos(code: string): string {
  return (code || '').replace(/\D/g, '')
}

/** Calcula o dígito verificador EAN-13 a partir dos 12 primeiros dígitos. */
export function digitoVerificadorEan13(doze: string): number | null {
  if (!/^\d{12}$/.test(doze)) return null
  let soma = 0
  for (let i = 0; i < 12; i++) {
    const d = doze.charCodeAt(i) - 48
    soma += i % 2 === 0 ? d : d * 3
  }
  return (10 - (soma % 10)) % 10
}

/** Valida um EAN-13 completo (13 dígitos + verificador correto). */
export function ean13Valido(code: string): boolean {
  const d = somenteDigitos(code)
  if (!/^\d{13}$/.test(d)) return false
  const esperado = digitoVerificadorEan13(d.slice(0, 12))
  return esperado !== null && esperado === d.charCodeAt(12) - 48
}

/**
 * Deriva a referência (Código da planilha) a partir do EAN-13.
 * Retorna a ref sem zeros à esquerda (ex.: "1212"), ou null se o código
 * não seguir o padrão conhecido — nesse caso a pessoa digita/dita o Código.
 */
export function refFromEan(code: string): string | null {
  const d = somenteDigitos(code)
  if (d.length !== 13) return null
  if (!d.startsWith(PREFIXO_VALENTINA)) return null
  const campoRef = d.slice(7, 12) // posições 7..11 (5 dígitos)
  const ref = String(parseInt(campoRef, 10))
  return ref === 'NaN' ? null : ref
}

/**
 * Resultado amigável de uma leitura: a ref sugerida (se houver) e o
 * número cru, para a tela sempre ter o que mostrar.
 */
export function interpretarLeitura(code: string): { ref: string | null; cru: string } {
  const cru = somenteDigitos(code) || code
  return { ref: refFromEan(code), cru }
}
