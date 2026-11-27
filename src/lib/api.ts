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
  linha: number // linha no "Cadastro de Produtos" (p/ achar o Estoque na venda)
}

/** Opções dos menus da venda, lidas da validação da planilha. */
export type OpcoesVenda = {
  formaRecebimento: string[]
  conta: string[]
  status: string[]
}

export type Catalogo = {
  fornecedores: string[]
  produtos: ProdutoCatalogo[]
  clientes: string[]
  opcoes: OpcoesVenda
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

/** Um item do carrinho → vira uma linha na aba "<Mês> | Vendas". */
export type ItemVenda = {
  descricao: string // produto (ex.: "Tanga Embutida M")
  quantidade: number
  valor: number | null // total da linha (preço unitário × quantidade)
  linhaCatalogo: number | null // linha do produto no catálogo → baixa no Estoque
}

/** Uma venda (carrinho) a registrar: dados comuns + itens. */
export type Venda = {
  data: string // 'YYYY-MM-DD'
  nome: string // cliente (da lista ou avulsa)
  forma: string // forma de recebimento
  conta: string
  status: string // 'Efetuado' por enquanto
  itens: ItemVenda[]
}

const OPCOES_PADRAO: OpcoesVenda = {
  formaRecebimento: ['Pix', 'Dinheiro', 'Cartão de débito', 'Cartão de crédito'],
  conta: [],
  status: ['Efetuado', 'Pendente'],
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
    clientes: data.clientes ?? [],
    opcoes: data.opcoes ?? OPCOES_PADRAO,
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

/**
 * Registra a venda inteira (todos os itens do carrinho) numa chamada só:
 * uma linha por item na aba "<Mês> | Vendas" + baixa no Estoque do mês.
 * Usa text/plain pelo mesmo motivo de salvarProdutos (evita o preflight).
 */
export async function salvarVenda(
  venda: Venda,
): Promise<{
  ok: boolean
  primeiraLinha?: number
  linhas?: number
  cliente?: string
  clienteNova?: boolean
}> {
  garantirConfig()
  const resp = await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ token: APP_TOKEN, tipo: 'vendaCarrinho', venda }),
  })
  if (!resp.ok) throw new Error(`Falha ao registrar venda (HTTP ${resp.status}).`)
  const data = (await resp.json()) as {
    ok?: boolean
    primeiraLinha?: number
    linhas?: number
    cliente?: string
    clienteNova?: boolean
    erro?: string
  }
  if (!data.ok) {
    // Script antigo (sem carrinho) cai no ramo do cadastro e não grava nada.
    if (data.erro === 'Nenhuma linha recebida.') {
      throw new Error('O servidor ainda não conhece o carrinho — atualize o Apps Script.')
    }
    throw new Error(data.erro ?? 'Não foi possível registrar a venda.')
  }
  return {
    ok: true,
    primeiraLinha: data.primeiraLinha,
    linhas: data.linhas,
    cliente: data.cliente,
    clienteNova: data.clienteNova,
  }
}
