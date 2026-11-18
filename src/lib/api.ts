// Comunicação com o backend (Google Apps Script publicado como Web App).
//
// Config via variáveis de ambiente do Vite (ver .env.example):
//   VITE_APPS_SCRIPT_URL  -> URL .../exec do Apps Script
//   VITE_APP_TOKEN        -> token compartilhado (igual ao do script)

export const APPS_SCRIPT_URL: string = import.meta.env.VITE_APPS_SCRIPT_URL ?? ''
export const APP_TOKEN: string = import.meta.env.VITE_APP_TOKEN ?? ''

export type ProdutoCatalogo = {
  codigo: string
  descricao: string
  fornecedor: string
  custo: number | null
  venda: number | null
  cor: string
}

export type Catalogo = {
  fornecedores: string[]
  produtos: ProdutoCatalogo[]
}

export type LinhaParaSalvar = {
  codigo: string
  descricao: string // já com o tamanho embutido (ex.: "Tanga Embutida M")
  fornecedor: string
  custo: number | null
  venda: number | null
  cor: string
  quantidade: number | null // vai para "Atual" do Estoque do mês
}

function garantirConfig() {
  if (!APPS_SCRIPT_URL) {
    throw new Error(
      'Endereço do servidor não configurado (VITE_APPS_SCRIPT_URL). Veja o README.',
    )
  }
}

/** Lê o catálogo atual (para autocomplete de fornecedor e sugestão de preço). */
export async function listProdutos(): Promise<Catalogo> {
  garantirConfig()
  const url = `${APPS_SCRIPT_URL}?token=${encodeURIComponent(APP_TOKEN)}`
  const resp = await fetch(url, { method: 'GET' })
  if (!resp.ok) throw new Error(`Falha ao ler catálogo (HTTP ${resp.status}).`)
  const data = (await resp.json()) as Partial<Catalogo> & { erro?: string }
  if (data.erro) throw new Error(data.erro)
  return {
    fornecedores: data.fornecedores ?? [],
    produtos: data.produtos ?? [],
  }
}

/**
 * Grava uma ou mais linhas na aba "Cadastro de Produtos".
 * Usa Content-Type text/plain de propósito: torna a requisição "simples"
 * e evita o preflight OPTIONS (que o Apps Script não responde bem).
 */
export async function salvarProdutos(
  linhas: LinhaParaSalvar[],
): Promise<{ ok: boolean; inseridas: number }> {
  garantirConfig()
  const resp = await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ token: APP_TOKEN, linhas }),
  })
  if (!resp.ok) throw new Error(`Falha ao salvar (HTTP ${resp.status}).`)
  const data = (await resp.json()) as { ok?: boolean; inseridas?: number; erro?: string }
  if (!data.ok) throw new Error(data.erro ?? 'Não foi possível salvar.')
  return { ok: true, inseridas: data.inseridas ?? linhas.length }
}
