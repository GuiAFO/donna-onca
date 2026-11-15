# Donna Onça — Cadastro rápido de produtos

Web app (PWA) para cadastrar produtos da revenda **pela câmera do iPhone**: escaneia o
código de barras da etiqueta, confirma/dita os dados e grava direto na planilha do Google,
na aba **Cadastro de Produtos**. Sem app de loja, sem IA e **sem gravar fotos** — o código
de barras é lido no próprio aparelho.

- **Frontend:** Vite + React + TypeScript + Tailwind (estático, GitHub Pages).
- **Leitor:** `@zxing/browser` (EAN-13) rodando no navegador.
- **Backend:** Google Apps Script (Web App) ligado à planilha, que acrescenta as linhas.

## Como funciona o cadastro

| Etiqueta | Coluna na planilha |
|---|---|
| `Ref: 1212` (ou código de barras) | **B — Código** |
| nome + tamanho (ex.: "Tanga Embutida M") | **C — Descrição** |
| marca | **D — Fornecedor** |
| digitado | **E — Valor Custo** / **F — Valor Venda** |
| — | **G — Lucro** (fórmula `=SUM(F-E)`, recriada pelo script) |

Cada tamanho vira uma linha. Se o código já existir, o app sugere descrição, fornecedor e
últimos preços (modo reposição).

## Setup (uma vez)

### 1) Backend — Google Apps Script
1. Abra a planilha → **Extensões → Apps Script**.
2. Substitua o conteúdo por [`apps-script/Codigo.gs`](apps-script/Codigo.gs).
3. Em `CONFIG.TOKEN`, troque `TROQUE-ESTE-TOKEN` por uma senha sua (anote).
4. **Implantar → Nova implantação → App da Web**: _Executar como_ **Eu**; _Quem tem acesso_ **Qualquer pessoa**.
5. Copie a **URL** que termina em `/exec`.
6. (Opcional) Rode a função `_teste` uma vez para autorizar os acessos e conferir que grava.

### 2) Frontend — local
```bash
npm install
cp .env.example .env.local   # preencha VITE_APPS_SCRIPT_URL (a /exec) e VITE_APP_TOKEN (a mesma senha)
npm run dev
```

### 3) Publicar no GitHub Pages
1. Crie um repositório chamado **`donna-onca`** e suba este projeto.
2. Em **Settings → Secrets and variables → Actions**, crie os secrets:
   - `VITE_APPS_SCRIPT_URL` = a URL `/exec`
   - `VITE_APP_TOKEN` = a senha (igual à do script)
3. Em **Settings → Pages**, _Source_ = **GitHub Actions**.
4. `git push` na branch `main` → a Action builda e publica em
   `https://<seu-usuario>.github.io/donna-onca/`.

> Se o nome do repositório for diferente de `donna-onca`, ajuste `base` em `vite.config.ts`.

## Segurança (uso pessoal)
O endpoint do Apps Script é público e o token fica embutido no app publicado — serve para
deter escrita casual, não é segredo forte. Para uso pessoal de revenda é aceitável. Se quiser
mais proteção, mantenha o repositório privado (GitHub Pages em repo privado exige plano pago)
ou adicione um PIN na tela antes de habilitar o salvamento.

## Fora do escopo desta versão
Venda rápida (lançar na aba de Vendas, fiado, baixa de estoque) e controle de quantidade —
ficam para uma fase 2.

Guia de uso para o dia a dia: [`GUIA.md`](GUIA.md).
