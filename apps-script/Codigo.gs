/**
 * Backend da Donna Onça — Google Apps Script (Web App).
 *
 * Como publicar:
 *   1. Abra a planilha → menu Extensões → Apps Script.
 *   2. Cole este arquivo (substitua o conteúdo de Código.gs).
 *   3. Ajuste o TOKEN abaixo (invente uma senha e use a MESMA no app, em VITE_APP_TOKEN).
 *   4. Implantar → Nova implantação → tipo "App da Web":
 *        - Executar como: Eu (a dona da planilha)
 *        - Quem tem acesso: Qualquer pessoa
 *   5. Copie a URL que termina em /exec e use no app (VITE_APPS_SCRIPT_URL).
 *   (Ao mudar o código, faça "Gerenciar implantações" → editar → nova versão.)
 */

var CONFIG = {
  SHEET_ID: '1WVhGYfsI2qRgKVqv1PdzR6JakV04nYRQ1tv8IzXGYmw',
  SHEET_NAME: 'Cadastro de Produtos',
  START_ROW: 4, // dados começam na linha 4
  TOKEN: 'TROQUE-ESTE-TOKEN', // << defina uma senha e repita no app
  FORMATO_MOEDA: '[$R$ -416]#,##0.00',
}

function _sheet() {
  return SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName(CONFIG.SHEET_NAME)
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
      // B..F = Código, Descrição, Fornecedor, Custo, Venda
      var vals = sh.getRange(CONFIG.START_ROW, 2, n, 5).getValues()
      for (var i = 0; i < vals.length; i++) {
        var cod = vals[i][0]
        var desc = vals[i][1]
        if (cod === '' && desc === '') continue
        produtos.push({
          codigo: cod === '' ? '' : String(cod),
          descricao: desc === '' ? '' : String(desc),
          fornecedor: vals[i][2] === '' ? '' : String(vals[i][2]),
          custo: vals[i][3] === '' ? null : Number(vals[i][3]),
          venda: vals[i][4] === '' ? null : Number(vals[i][4]),
        })
      }
    }

    // Fornecedores: tabela lateral (coluna L) + distintos da coluna D
    var fornecedores = {}
    for (var j = 0; j < produtos.length; j++) {
      if (produtos[j].fornecedor) fornecedores[produtos[j].fornecedor] = true
    }
    var ultimaL = sh.getLastRow()
    if (ultimaL >= CONFIG.START_ROW) {
      var col = sh.getRange(CONFIG.START_ROW, 12, ultimaL - CONFIG.START_ROW + 1, 1).getValues()
      for (var k = 0; k < col.length; k++) {
        var f = col[k][0]
        if (f !== '') fornecedores[String(f)] = true
      }
    }

    return _json({ fornecedores: Object.keys(fornecedores), produtos: produtos })
  } catch (err) {
    return _json({ erro: String(err) })
  }
}

/** POST: grava 1+ linhas em B:G. Corpo (text/plain): { token, linhas: [{codigo,descricao,fornecedor,custo,venda}] } */
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
    var linhas = body.linhas || []
    if (!linhas.length) return _json({ ok: false, erro: 'Nenhuma linha recebida.' })

    var sh = _sheet()
    var primeira = _proximaLinhaVazia(sh)

    for (var i = 0; i < linhas.length; i++) {
      var r = primeira + i
      var l = linhas[i]
      var cod = _ehNumero(l.codigo) ? Number(l.codigo) : String(l.codigo || '')
      var custo = l.custo === null || l.custo === undefined || l.custo === '' ? '' : Number(l.custo)
      var venda = l.venda === null || l.venda === undefined || l.venda === '' ? '' : Number(l.venda)

      // B:F = Código, Descrição, Fornecedor, Custo, Venda
      sh.getRange(r, 2, 1, 5).setValues([[cod, String(l.descricao || ''), String(l.fornecedor || ''), custo, venda]])
      // G = Lucro (fórmula, igual às linhas existentes)
      sh.getRange(r, 7).setFormula('=SUM(F' + r + '-E' + r + ')')
      // mantém o formato de moeda nas células de valor
      sh.getRange(r, 5, 1, 3).setNumberFormat(CONFIG.FORMATO_MOEDA)
    }
    SpreadsheetApp.flush()
    return _json({ ok: true, inseridas: linhas.length, primeiraLinha: primeira })
  } catch (err) {
    return _json({ ok: false, erro: String(err) })
  } finally {
    lock.releaseLock()
  }
}

/** Primeira linha sem Código (coluna B) a partir de START_ROW. */
function _proximaLinhaVazia(sh) {
  var max = sh.getMaxRows()
  var n = max - CONFIG.START_ROW + 1
  var col = sh.getRange(CONFIG.START_ROW, 2, n, 1).getValues()
  for (var i = 0; i < col.length; i++) {
    if (col[i][0] === '' || col[i][0] === null) return CONFIG.START_ROW + i
  }
  // nenhuma vazia: acrescenta ao final
  return max + 1
}

function _ehNumero(v) {
  return v !== '' && v !== null && v !== undefined && /^\d+$/.test(String(v))
}

/** Teste manual no editor do Apps Script (não afeta o app). */
function _teste() {
  var out = doPost({
    postData: {
      contents: JSON.stringify({
        token: CONFIG.TOKEN,
        linhas: [{ codigo: '9999', descricao: 'TESTE APP (apagar) M', fornecedor: 'Teste', custo: 1.5, venda: 2 }],
      }),
    },
  })
  Logger.log(out.getContent())
}
