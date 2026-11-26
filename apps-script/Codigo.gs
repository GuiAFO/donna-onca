/**
 * Backend da Donna Onça — Google Apps Script (Web App).
 *
 * Grava em:
 *   - "Cadastro de Produtos": B=Código, C=Descrição, D=Fornecedor,
 *     E=Custo, F=Venda, G=Lucro (fórmula), K=Cor.
 *   - "<Mês> | Estoque": coluna F ("Atual") = Quantidade, na linha que
 *     espelha o produto (Estoque linha = catálogo linha - 1).
 *   - "<Mês> | Vendas" (fase 2): B:I (Data, Nome, Descrição, Quant., Forma,
 *     Conta, Status, Valor) + baixa no Estoque (Saídas += qtd, Atual -= qtd).
 *
 * Como publicar:
 *   1. Abra a planilha → menu Extensões → Apps Script.
 *   2. Cole este arquivo (substitua o conteúdo de Código.gs).
 *   3. Ajuste o TOKEN abaixo (a MESMA senha do app, em VITE_APP_TOKEN).
 *   4. Implantar → Gerenciar implantações → editar (lápis) → Nova versão → Implantar.
 */

var CONFIG = {
  SHEET_ID: '1WVhGYfsI2qRgKVqv1PdzR6JakV04nYRQ1tv8IzXGYmw',
  SHEET_NAME: 'Cadastro de Produtos',
  START_ROW: 4, // dados começam na linha 4
  TOKEN: 'TROQUE-ESTE-TOKEN', // << defina uma senha e repita no app
  FORMATO_MOEDA: '[$R$ -416]#,##0.00',
  COL_COR: 11, // coluna K no Cadastro de Produtos
  // Estoque (mensal): a linha do Estoque = linha do catálogo + OFFSET
  ESTOQUE_OFFSET: -1,
  ESTOQUE_COL_ATUAL: 6, // coluna F ("Atual")
  ESTOQUE_COL_SAIDAS: 5, // coluna E ("Saídas")
  ESTOQUE_SUFIXO: ' | Estoque ', // atenção ao espaço final no nome da aba
  MESES: ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'],
  // Vendas (mensal): aba "<Mês> | Vendas" — SEM espaço final (ao contrário do Estoque)
  VENDAS_SUFIXO: ' | Vendas',
  VENDAS_START_ROW: 4, // dados começam na linha 4
  // tabela da esquerda: B=Data, C=Nome, D=Descrição, E=Quant., F=Forma, G=Conta, H=Status, I=Valor
  VENDAS_COL_FORMA: 6, // F
  VENDAS_COL_CONTA: 7, // G
  VENDAS_COL_STATUS: 8, // H
  // Clientes (para autocomplete na venda)
  CLIENTES_SHEET: 'Cadastro de Clientes',
  CLIENTES_COL_NOME: 3, // coluna C
  CLIENTES_START_ROW: 3,
  // opções padrão caso a planilha não tenha validação nas colunas da Vendas
  OPCOES_FALLBACK: {
    formaRecebimento: ['Pix', 'Dinheiro', 'Cartão de débito', 'Cartão de crédito'],
    conta: ['Infinite'],
    status: ['Efetuado', 'Pendente'],
  },
}

function _ss() {
  return SpreadsheetApp.openById(CONFIG.SHEET_ID)
}
function _sheet() {
  return _ss().getSheetByName(CONFIG.SHEET_NAME)
}
function _abaEstoqueDoMes() {
  var nome = CONFIG.MESES[new Date().getMonth()] + CONFIG.ESTOQUE_SUFIXO
  return _ss().getSheetByName(nome)
}
function _abaVendasDoMes() {
  var nome = CONFIG.MESES[new Date().getMonth()] + CONFIG.VENDAS_SUFIXO
  return _ss().getSheetByName(nome)
}

function _json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON,
  )
}

/** GET: devolve o catálogo (fornecedores + produtos) para autocomplete e sugestão de preço. */
function doGet(e) {
  try {
    var token = e && e.parameter ? e.parameter.token : ''
    if (token !== CONFIG.TOKEN) return _json({ erro: 'Token inválido.' })

    var sh = _sheet()
    var ultima = sh.getLastRow()
    var produtos = []
    if (ultima >= CONFIG.START_ROW) {
      var n = ultima - CONFIG.START_ROW + 1
      // B..K = Código, Descrição, Fornecedor, Custo, Venda, Lucro, (atacado H/I/J), Cor
      var vals = sh.getRange(CONFIG.START_ROW, 2, n, 10).getValues()
      for (var i = 0; i < vals.length; i++) {
        var cod = vals[i][0]
        var desc = vals[i][1]
        // pula linhas sem Descrição: vazias OU placeholders do template
        if (desc === '') continue
        produtos.push({
          codigo: cod === '' ? '' : String(cod),
          descricao: String(desc),
          fornecedor: vals[i][2] === '' ? '' : String(vals[i][2]),
          custo: vals[i][3] === '' ? null : Number(vals[i][3]),
          venda: vals[i][4] === '' ? null : Number(vals[i][4]),
          cor: vals[i][9] === '' ? '' : String(vals[i][9]), // coluna K
          linha: CONFIG.START_ROW + i, // linha no catálogo (p/ achar o Estoque na venda)
        })
      }
    }

    // Fornecedores: tabela lateral (coluna L) + distintos da coluna D
    var fornecedores = {}
    for (var j = 0; j < produtos.length; j++) {
      if (produtos[j].fornecedor) fornecedores[produtos[j].fornecedor] = true
    }
    if (ultima >= CONFIG.START_ROW) {
      var col = sh.getRange(CONFIG.START_ROW, 12, ultima - CONFIG.START_ROW + 1, 1).getValues()
      for (var k = 0; k < col.length; k++) {
        var f = col[k][0]
        if (f !== '') fornecedores[String(f)] = true
      }
    }

    // Clientes (para autocomplete na venda)
    var clientes = []
    var cs = _ss().getSheetByName(CONFIG.CLIENTES_SHEET)
    if (cs && cs.getLastRow() >= CONFIG.CLIENTES_START_ROW) {
      var cv = cs
        .getRange(
          CONFIG.CLIENTES_START_ROW,
          CONFIG.CLIENTES_COL_NOME,
          cs.getLastRow() - CONFIG.CLIENTES_START_ROW + 1,
          1,
        )
        .getValues()
      for (var ci = 0; ci < cv.length; ci++) {
        if (cv[ci][0] !== '') clientes.push(String(cv[ci][0]))
      }
    }

    // Opções dos menus da venda: lê a validação da própria planilha (com fallback)
    var vsh = _abaVendasDoMes()
    var opcoes = {
      formaRecebimento:
        (vsh && _opcoesValidacao(vsh, CONFIG.VENDAS_START_ROW, CONFIG.VENDAS_COL_FORMA)) ||
        CONFIG.OPCOES_FALLBACK.formaRecebimento,
      conta:
        (vsh && _opcoesValidacao(vsh, CONFIG.VENDAS_START_ROW, CONFIG.VENDAS_COL_CONTA)) ||
        CONFIG.OPCOES_FALLBACK.conta,
      status:
        (vsh && _opcoesValidacao(vsh, CONFIG.VENDAS_START_ROW, CONFIG.VENDAS_COL_STATUS)) ||
        CONFIG.OPCOES_FALLBACK.status,
    }

    return _json({
      fornecedores: Object.keys(fornecedores),
      produtos: produtos,
      clientes: clientes,
      opcoes: opcoes,
    })
  } catch (err) {
    return _json({ erro: String(err) })
  }
}

/**
 * POST (text/plain): { token, linhas: [{codigo,descricao,fornecedor,custo,venda,cor,quantidade}] }
 * Grava cada linha no catálogo (B:G + K=Cor) e a quantidade no "Atual" do Estoque do mês.
 */
function doPost(e) {
  var lock = LockService.getScriptLock()
  try {
    lock.waitLock(20000)
  } catch (ignore) {
    return _json({ ok: false, erro: 'Servidor ocupado, tente de novo.' })
  }
  try {
    var body = JSON.parse(e.postData.contents)
    if (!body || body.token !== CONFIG.TOKEN) {
      return _json({ ok: false, erro: 'Token inválido.' })
    }

    // Venda rápida (fase 2): grava na aba Vendas do mês e dá baixa no estoque.
    if (body.tipo === 'venda') {
      return registrarVenda(body.venda || {})
    }

    var linhas = body.linhas || []
    if (!linhas.length) return _json({ ok: false, erro: 'Nenhuma linha recebida.' })

    var sh = _sheet()
    var estoque = _abaEstoqueDoMes()
    var primeira = _proximaLinhaVazia(sh)

    for (var i = 0; i < linhas.length; i++) {
      var r = primeira + i
      var l = linhas[i]
      var cod = _ehNumero(l.codigo) ? Number(l.codigo) : String(l.codigo || '')
      var custo = _numOuVazio(l.custo)
      var venda = _numOuVazio(l.venda)

      // B:F = Código, Descrição, Fornecedor, Custo, Venda
      sh.getRange(r, 2, 1, 5).setValues([[cod, String(l.descricao || ''), String(l.fornecedor || ''), custo, venda]])
      // G = Lucro (fórmula, igual às linhas existentes)
      sh.getRange(r, 7).setFormula('=SUM(F' + r + '-E' + r + ')')
      // formato de moeda nas células de valor
      sh.getRange(r, 5, 1, 3).setNumberFormat(CONFIG.FORMATO_MOEDA)
      // K = Cor
      sh.getRange(r, CONFIG.COL_COR).setValue(String(l.cor || ''))

      // Quantidade -> "Atual" do Estoque do mês (linha espelhada = r + OFFSET)
      var qtd = _numOuVazio(l.quantidade)
      if (estoque && qtd !== '' && qtd !== 0) {
        estoque.getRange(r + CONFIG.ESTOQUE_OFFSET, CONFIG.ESTOQUE_COL_ATUAL).setValue(qtd)
      }
    }
    SpreadsheetApp.flush()
    return _json({
      ok: true,
      inseridas: linhas.length,
      primeiraLinha: primeira,
      estoque: estoque ? estoque.getName() : null,
    })
  } catch (err) {
    return _json({ ok: false, erro: String(err) })
  } finally {
    lock.releaseLock()
  }
}

/** Primeira linha sem Descrição (coluna C) a partir de START_ROW.
    A coluna B (Código) deste template vem pré-preenchida com números
    sequenciais nas linhas não usadas, então a Descrição é o sinal
    confiável de "linha livre". */
function _proximaLinhaVazia(sh) {
  var max = sh.getMaxRows()
  var n = max - CONFIG.START_ROW + 1
  var col = sh.getRange(CONFIG.START_ROW, 3, n, 1).getValues()
  for (var i = 0; i < col.length; i++) {
    if (col[i][0] === '' || col[i][0] === null) return CONFIG.START_ROW + i
  }
  return max + 1
}

function _ehNumero(v) {
  return v !== '' && v !== null && v !== undefined && /^\d+$/.test(String(v))
}

function _numOuVazio(v) {
  if (v === '' || v === null || v === undefined) return ''
  var n = Number(v)
  return isNaN(n) ? '' : n
}

/**
 * Venda rápida: grava uma linha na aba "<Mês> | Vendas" (tabela da esquerda, B:I)
 * e dá baixa no Estoque do mês (Saídas += qtd, Atual -= qtd) na linha espelhada.
 * v = { data, nome, descricao, quantidade, forma, conta, status, valor, linhaCatalogo }
 */
function registrarVenda(v) {
  var vsh = _abaVendasDoMes()
  if (!vsh) return _json({ ok: false, erro: 'Aba de vendas do mês não encontrada.' })

  var r = _proximaLinhaVendaVazia(vsh)
  var qtd = _numOuVazio(v.quantidade)
  if (qtd === '' || qtd === 0) qtd = 1
  var valor = _numOuVazio(v.valor)
  var status = String(v.status || 'Efetuado')

  // B:I = Data, Nome, Descrição, Quant., Forma de recebimento, Conta, Status, Valor
  vsh.getRange(r, 2, 1, 8).setValues([
    [
      _parseData(v.data),
      String(v.nome || ''),
      String(v.descricao || ''),
      qtd,
      String(v.forma || ''),
      String(v.conta || ''),
      status,
      valor,
    ],
  ])
  if (valor !== '') vsh.getRange(r, 9).setNumberFormat(CONFIG.FORMATO_MOEDA)

  // Baixa de estoque (linha espelhada = linha do catálogo + OFFSET)
  var estoqueInfo = null
  if (v.linhaCatalogo) {
    var estoque = _abaEstoqueDoMes()
    if (estoque) {
      var er = Number(v.linhaCatalogo) + CONFIG.ESTOQUE_OFFSET
      var saidasCell = estoque.getRange(er, CONFIG.ESTOQUE_COL_SAIDAS)
      var atualCell = estoque.getRange(er, CONFIG.ESTOQUE_COL_ATUAL)
      var saidas = Number(saidasCell.getValue()) || 0
      var atual = Number(atualCell.getValue()) || 0
      saidasCell.setValue(saidas + qtd)
      atualCell.setValue(atual - qtd)
      estoqueInfo = { linha: er, saidas: saidas + qtd, atual: atual - qtd }
    }
  }

  SpreadsheetApp.flush()
  return _json({ ok: true, linhaVenda: r, estoque: estoqueInfo })
}

/** Primeira linha livre da aba de Vendas (coluna B = Data), a partir de VENDAS_START_ROW. */
function _proximaLinhaVendaVazia(sh) {
  var max = sh.getMaxRows()
  var n = max - CONFIG.VENDAS_START_ROW + 1
  var col = sh.getRange(CONFIG.VENDAS_START_ROW, 2, n, 1).getValues()
  for (var i = 0; i < col.length; i++) {
    if (col[i][0] === '' || col[i][0] === null) return CONFIG.VENDAS_START_ROW + i
  }
  return max + 1
}

/** Converte 'YYYY-MM-DD' em Date; sem data válida, usa hoje. */
function _parseData(s) {
  if (s && /^\d{4}-\d{2}-\d{2}$/.test(String(s))) {
    var p = String(s).split('-')
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]))
  }
  return new Date()
}

/** Lê as opções de uma lista de validação (ou null se não houver). */
function _opcoesValidacao(sh, row, col) {
  try {
    var dv = sh.getRange(row, col).getDataValidation()
    if (!dv) return null
    var vals = dv.getCriteriaValues()
    if (!vals || !vals.length) return null
    var v0 = vals[0]
    if (Object.prototype.toString.call(v0) === '[object Array]') {
      return v0.map(String).filter(function (s) {
        return s !== ''
      })
    }
    if (v0 && typeof v0.getValues === 'function') {
      var out = []
      var rows = v0.getValues()
      for (var i = 0; i < rows.length; i++) {
        if (rows[i][0] !== '') out.push(String(rows[i][0]))
      }
      return out.length ? out : null
    }
  } catch (e) {}
  return null
}

/** Teste manual de venda no editor (não afeta o app). linhaCatalogo:0 não mexe no estoque. */
function _testeVenda() {
  var out = registrarVenda({
    data: '',
    nome: 'TESTE (apagar)',
    descricao: 'Tanga Embutida',
    quantidade: 1,
    forma: 'Pix',
    conta: 'Infinite',
    status: 'Efetuado',
    valor: 20,
    linhaCatalogo: 0,
  })
  Logger.log(out.getContent())
}

/** Teste manual no editor do Apps Script (não afeta o app). */
function _teste() {
  var out = doPost({
    postData: {
      contents: JSON.stringify({
        token: CONFIG.TOKEN,
        linhas: [
          {
            codigo: '9999',
            descricao: 'TESTE APP (apagar) M',
            fornecedor: 'Teste',
            custo: 1.5,
            venda: 2,
            cor: 'Preta',
            quantidade: 3,
          },
        ],
      }),
    },
  })
  Logger.log(out.getContent())
}
