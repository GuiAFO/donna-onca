/**
 * Backend da Donna Onça — Google Apps Script (Web App).
 *
 * Grava em:
 *   - "Cadastro de Produtos": B=Código, C=Descrição, D=Fornecedor,
 *     E=Custo, F=Venda, G=Lucro (fórmula), K=Cor.
 *   - "<Mês> | Estoque": coluna F ("Atual") = Quantidade, na linha que
 *     espelha o produto (Estoque linha = catálogo linha - 1).
 *   - "<Mês> | Vendas" (fase 2): B:I (Data, Nome, Descrição, Quant., Forma,
 *     Conta, Status, Valor). Saídas do Estoque é fórmula e soma sozinha; só
 *     descontamos o "Atual" quando ele foi digitado à mão.
 *   - "Cadastro de Clientes" (coluna C): cliente nova da venda é cadastrada
 *     automaticamente (a coluna Nome da Vendas só aceita nomes de lá).
 *   - Fiado: produtos em S:V da Vendas do mês, parcelas em K:Q da Vendas do
 *     mês de cada vencimento, e a cliente na coluna B da aba "Fiados".
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
  ESTOQUE_COL_SAIDAS: 5, // coluna E ("Saídas") — fórmula dela; só leitura
  ESTOQUE_SUFIXO: ' | Estoque ', // atenção ao espaço final no nome da aba
  MESES: ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'],
  // Vendas (mensal): aba "<Mês> | Vendas" — SEM espaço final (ao contrário do Estoque)
  VENDAS_SUFIXO: ' | Vendas',
  VENDAS_START_ROW: 4, // dados começam na linha 4
  // tabela da esquerda: B=Data, C=Nome, D=Descrição, E=Quant., F=Forma, G=Conta, H=Status, I=Valor
  VENDAS_COL_FORMA: 6, // F
  VENDAS_COL_CONTA: 7, // G
  VENDAS_COL_STATUS: 8, // H
  // Fiado (na mesma aba "<Mês> | Vendas")
  FIADO_COL_PARCELAS: 11, // K: K=Data(vencimento) L=Nome M=Parcela N=Status O=Forma P=Conta Q=Valor
  FIADO_COL_SAIDAS: 19, // S: S=Data T=Nome U=Qnt. V=Descrição (saída de estoque do fiado)
  FIADOS_SHEET: 'Fiados', // painel por cliente; nomes na coluna B
  FIADOS_START_ROW: 7,
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
    // Carrinho (fase 2.1): vários itens na mesma venda, gravados num bloco só.
    if (body.tipo === 'vendaCarrinho') {
      return registrarCarrinho(body.venda || {})
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

  // Baixa de estoque: só no "Atual" digitado à mão (ver _baixarAtualDigitado)
  var estoqueInfo = null
  if (v.linhaCatalogo) {
    var estoque = _abaEstoqueDoMes()
    if (estoque) estoqueInfo = _baixarAtualDigitado(estoque, Number(v.linhaCatalogo), qtd)
  }

  SpreadsheetApp.flush()
  return _json({ ok: true, linhaVenda: r, estoque: estoqueInfo })
}

/**
 * Carrinho: grava todos os itens de uma venda em linhas seguidas da aba
 * "<Mês> | Vendas" (B:I) e dá baixa no Estoque de cada produto do catálogo.
 * v = { data, nome, forma, conta, status,
 *       itens: [{ descricao, quantidade, valor, linhaCatalogo }] }
 */
function registrarCarrinho(v) {
  var itens = v.itens || []
  if (!itens.length) return _json({ ok: false, erro: 'Carrinho vazio.' })

  var vsh = _abaVendasDoMes()
  if (!vsh) return _json({ ok: false, erro: 'Aba de vendas do mês não encontrada.' })

  var data = _parseData(v.data)
  var nome = String(v.nome || '').trim()
  if (!nome) return _json({ ok: false, erro: 'Preencha o nome da cliente.' })

  // ---- 1) Conferir TUDO antes de gravar qualquer coisa ----
  // As colunas da Vendas têm validação estrita: um valor fora da lista faz o
  // setValues parar no meio (gravando só parte da linha). Por isso conferimos
  // aqui e usamos sempre o texto EXATO que a planilha aceita.
  var catalogo = _descricoesCatalogo()
  var foraDoCatalogo = []
  for (var c = 0; c < itens.length; c++) {
    var exata = _acharNaLista(catalogo, itens[c].descricao)
    if (exata === null) foraDoCatalogo.push(String(itens[c].descricao || '(sem nome)'))
    else itens[c].descricao = exata
  }
  if (foraDoCatalogo.length) {
    return _json({
      ok: false,
      erro: 'Produto fora do catálogo: ' + foraDoCatalogo.join(', ') + '. Cadastre antes de vender.',
    })
  }
  var forma = _conferirOpcao(vsh, CONFIG.VENDAS_COL_FORMA, v.forma, 'Forma de recebimento')
  var conta = _conferirOpcao(vsh, CONFIG.VENDAS_COL_CONTA, v.conta, 'Conta')
  var status = _conferirOpcao(vsh, CONFIG.VENDAS_COL_STATUS, v.status || 'Efetuado', 'Status')
  if (forma.erro || conta.erro || status.erro) {
    return _json({ ok: false, erro: forma.erro || conta.erro || status.erro })
  }

  // Fiado: confere as parcelas também antes de gravar qualquer coisa
  var plano = null
  if (v.fiado) {
    plano = _conferirParcelas(v.fiado.parcelas, itens)
    if (plano.erro) return _json({ ok: false, erro: plano.erro })
  }

  // ---- 2) Cliente: usa a da lista ou cadastra a nova ----
  var cliente = _acharOuCadastrarCliente(nome)

  if (plano) {
    return _registrarFiado(vsh, data, cliente, itens, plano, forma.valor, conta.valor)
  }

  var linhas = []
  var baixas = {} // linhaCatalogo -> qtd total (o mesmo produto pode aparecer 2x)
  for (var i = 0; i < itens.length; i++) {
    var it = itens[i]
    var qtd = _numOuVazio(it.quantidade)
    if (qtd === '' || qtd === 0) qtd = 1
    linhas.push([
      data,
      cliente.nome,
      it.descricao,
      qtd,
      forma.valor,
      conta.valor,
      status.valor,
      _numOuVazio(it.valor),
    ])
    if (it.linhaCatalogo) {
      var k = String(Number(it.linhaCatalogo))
      baixas[k] = (baixas[k] || 0) + qtd
    }
  }

  // ---- 3) B:I de uma vez, num bloco de linhas livres seguidas ----
  var r = _proximoBlocoVendaVazio(vsh, linhas.length)
  var falta = r + linhas.length - 1 - vsh.getMaxRows()
  if (falta > 0) vsh.insertRowsAfter(vsh.getMaxRows(), falta)
  var bloco = vsh.getRange(r, 2, linhas.length, 8)
  try {
    bloco.setValues(linhas)
  } catch (errGravar) {
    // não deixa linha pela metade: limpa só os valores (mantém validação/formato)
    bloco.clearContent()
    return _json({ ok: false, erro: 'A planilha recusou a venda: ' + String(errGravar) })
  }
  vsh.getRange(r, 9, linhas.length, 1).setNumberFormat(CONFIG.FORMATO_MOEDA)

  // Baixa de estoque: só no "Atual" digitado à mão (ver _baixarAtualDigitado)
  var estoqueInfo = []
  var estoque = _abaEstoqueDoMes()
  if (estoque) {
    for (var key in baixas) {
      var info = _baixarAtualDigitado(estoque, Number(key), baixas[key])
      if (info) estoqueInfo.push(info)
    }
  }

  SpreadsheetApp.flush()
  return _json({
    ok: true,
    primeiraLinha: r,
    linhas: linhas.length,
    estoque: estoqueInfo,
    cliente: cliente.nome,
    clienteNova: cliente.nova,
  })
}

/**
 * Venda FIADA — usa as duas tabelas que a planilha já tem para isso:
 *   - "Saídas do estoque | Fiado" (S:V = Data, Nome, Qnt., Descrição) na aba do
 *     mês da venda. A fórmula de Saídas do Estoque já soma essa tabela (U/V).
 *   - "Cadastro de parcelas fiado" (K:Q = Data, Nome, Parcela, Status, Forma,
 *     Conta, Valor) na aba do MÊS DO VENCIMENTO de cada parcela. A coluna K
 *     guarda o vencimento (o "Valor em atraso" do painel usa K < hoje).
 * Não grava na tabela B:I — senão a receita e a saída de estoque contariam 2x.
 */
function _registrarFiado(vsh, data, cliente, itens, plano, forma, conta) {
  var gravados = [] // ranges já escritos, para desfazer se algo falhar

  try {
    // ---- produtos → S:V da aba do mês ----
    var prod = []
    var baixas = {}
    for (var i = 0; i < itens.length; i++) {
      var it = itens[i]
      var qtd = _numOuVazio(it.quantidade)
      if (qtd === '' || qtd === 0) qtd = 1
      prod.push([data, cliente.nome, qtd, it.descricao])
      if (it.linhaCatalogo) {
        var k = String(Number(it.linhaCatalogo))
        baixas[k] = (baixas[k] || 0) + qtd
      }
    }
    var rp = _proximoBlocoVazio(vsh, CONFIG.FIADO_COL_SAIDAS, prod.length)
    _garantirLinhas(vsh, rp + prod.length - 1)
    var blocoProd = vsh.getRange(rp, CONFIG.FIADO_COL_SAIDAS, prod.length, 4)
    gravados.push(blocoProd)
    blocoProd.setValues(prod)

    // ---- parcelas → K:Q da aba do mês do vencimento ----
    var n = plano.parcelas.length
    var porAba = {} // nome da aba -> [linhas]
    for (var p = 0; p < n; p++) {
      var pc = plano.parcelas[p]
      var nomeAba = CONFIG.MESES[pc.vencimento.getMonth()] + CONFIG.VENDAS_SUFIXO
      if (!porAba[nomeAba]) porAba[nomeAba] = []
      porAba[nomeAba].push([
        pc.vencimento,
        cliente.nome,
        p + 1 + '/' + n, // a coluna tem formato "d/m": "2/3" aparece como 2/3
        pc.paga ? 'Efetuado' : 'Pendente',
        pc.paga ? forma : '', // forma/conta só quando já foi paga (entrada)
        pc.paga ? conta : '',
        pc.valor,
      ])
    }
    var abas = []
    for (var nomeA in porAba) {
      var sh = _ss().getSheetByName(nomeA)
      var lin = porAba[nomeA]
      var rk = _proximoBlocoVazio(sh, CONFIG.FIADO_COL_PARCELAS, lin.length)
      _garantirLinhas(sh, rk + lin.length - 1)
      var blocoParc = sh.getRange(rk, CONFIG.FIADO_COL_PARCELAS, lin.length, 7)
      gravados.push(blocoParc)
      blocoParc.setValues(lin)
      sh.getRange(rk, CONFIG.FIADO_COL_PARCELAS + 6, lin.length, 1).setNumberFormat(
        CONFIG.FORMATO_MOEDA,
      )
      abas.push({ aba: nomeA, primeiraLinha: rk, parcelas: lin.length })
    }

    // ---- cliente na aba "Fiados" (lá a lista é digitada à mão) ----
    var fiadosInfo = _garantirClienteNosFiados(cliente.nome)

    // ---- baixa de estoque: igual à venda à vista ----
    var estoqueInfo = []
    var estoque = _abaEstoqueDoMes()
    if (estoque) {
      for (var key in baixas) {
        var info = _baixarAtualDigitado(estoque, Number(key), baixas[key])
        if (info) estoqueInfo.push(info)
      }
    }

    SpreadsheetApp.flush()
    return _json({
      ok: true,
      fiado: true,
      primeiraLinha: rp,
      linhas: prod.length,
      parcelas: n,
      abas: abas,
      fiados: fiadosInfo,
      estoque: estoqueInfo,
      cliente: cliente.nome,
      clienteNova: cliente.nova,
    })
  } catch (err) {
    // desfaz o que já foi escrito (só valores; mantém validação e formato)
    for (var g = 0; g < gravados.length; g++) {
      try {
        gravados[g].clearContent()
      } catch (ignore) {}
    }
    return _json({ ok: false, erro: 'A planilha recusou o fiado: ' + String(err) })
  }
}

/**
 * Confere o plano de parcelas: datas válidas, valores > 0, aba do mês existe
 * e a soma bate com o total do carrinho. Devolve { parcelas } ou { erro }.
 */
function _conferirParcelas(lista, itens) {
  lista = lista || []
  if (!lista.length) return { erro: 'Fiado sem parcelas.' }
  if (lista.length > 12) return { erro: 'No máximo 12 parcelas.' }
  var total = 0
  for (var i = 0; i < itens.length; i++) total += Number(_numOuVazio(itens[i].valor)) || 0
  var soma = 0
  var out = []
  for (var p = 0; p < lista.length; p++) {
    var pc = lista[p]
    if (!pc || !/^\d{4}-\d{2}-\d{2}$/.test(String(pc.vencimento))) {
      return { erro: 'Parcela ' + (p + 1) + ' sem data de vencimento.' }
    }
    var valor = Number(_numOuVazio(pc.valor))
    if (!(valor > 0)) return { erro: 'Parcela ' + (p + 1) + ' sem valor.' }
    var venc = _parseData(pc.vencimento)
    var aba = CONFIG.MESES[venc.getMonth()] + CONFIG.VENDAS_SUFIXO
    if (!_ss().getSheetByName(aba)) return { erro: 'Aba "' + aba + '" não encontrada.' }
    soma += valor
    out.push({ vencimento: venc, valor: Math.round(valor * 100) / 100, paga: !!pc.paga })
  }
  if (Math.abs(soma - total) > 0.01) {
    return { erro: 'A soma das parcelas não bate com o total da venda.' }
  }
  return { parcelas: out }
}

/** Inclui a cliente na coluna B da aba "Fiados" (a partir da linha 7), se faltar. */
function _garantirClienteNosFiados(nome) {
  var fs = _ss().getSheetByName(CONFIG.FIADOS_SHEET)
  if (!fs) return null
  var max = fs.getMaxRows()
  var col = fs.getRange(CONFIG.FIADOS_START_ROW, 2, max - CONFIG.FIADOS_START_ROW + 1, 1).getValues()
  var livre = -1
  for (var i = 0; i < col.length; i++) {
    var v = col[i][0]
    if (v === '' || v === null) {
      if (livre < 0) livre = CONFIG.FIADOS_START_ROW + i
    } else if (String(v) === nome) {
      return { linha: CONFIG.FIADOS_START_ROW + i, nova: false }
    }
  }
  if (livre < 0) return null // lista cheia: não mexe (as fórmulas vão até a 1002)
  fs.getRange(livre, 2).setValue(nome)
  return { linha: livre, nova: true }
}

/** Primeira linha (a partir da 4) com n células vazias seguidas na coluna col. */
function _proximoBlocoVazio(sh, col, n) {
  var max = sh.getMaxRows()
  var total = max - CONFIG.VENDAS_START_ROW + 1
  var vals = sh.getRange(CONFIG.VENDAS_START_ROW, col, total, 1).getValues()
  var seguidas = 0
  for (var i = 0; i < vals.length; i++) {
    if (vals[i][0] === '' || vals[i][0] === null) {
      seguidas++
      if (seguidas === n) return CONFIG.VENDAS_START_ROW + i - n + 1
    } else {
      seguidas = 0
    }
  }
  return CONFIG.VENDAS_START_ROW + vals.length - seguidas
}

/** Cria linhas no fim da aba se ultimaLinha passar do tamanho atual. */
function _garantirLinhas(sh, ultimaLinha) {
  var falta = ultimaLinha - sh.getMaxRows()
  if (falta > 0) sh.insertRowsAfter(sh.getMaxRows(), falta)
}

/** Descrições do catálogo (coluna C), exatamente como estão na planilha. */
function _descricoesCatalogo() {
  var sh = _sheet()
  var ultima = sh.getLastRow()
  if (ultima < CONFIG.START_ROW) return []
  var col = sh.getRange(CONFIG.START_ROW, 3, ultima - CONFIG.START_ROW + 1, 1).getValues()
  var out = []
  for (var i = 0; i < col.length; i++) if (col[i][0] !== '') out.push(String(col[i][0]))
  return out
}

/**
 * Procura s na lista: primeiro o texto exato; se não achar, ignora
 * maiúsculas e espaços nas pontas. Devolve o texto EXATO da lista (ou null).
 */
function _acharNaLista(lista, s) {
  var alvo = String(s === null || s === undefined ? '' : s)
  for (var i = 0; i < lista.length; i++) if (lista[i] === alvo) return lista[i]
  var norm = alvo.trim().toLowerCase()
  if (!norm) return null
  for (var j = 0; j < lista.length; j++) {
    if (String(lista[j]).trim().toLowerCase() === norm) return lista[j]
  }
  return null
}

/** Confere um valor contra a lista de validação da coluna (se houver). Vazio passa. */
function _conferirOpcao(vsh, col, valor, rotulo) {
  var v = String(valor === null || valor === undefined ? '' : valor)
  if (v === '') return { valor: '' }
  var lista = _opcoesValidacao(vsh, CONFIG.VENDAS_START_ROW, col)
  if (!lista) return { valor: v }
  var exata = _acharNaLista(lista, v)
  if (exata === null) return { erro: rotulo + ' "' + v + '" não está na lista da planilha.' }
  return { valor: exata }
}

/**
 * A coluna Nome da Vendas só aceita clientes do "Cadastro de Clientes".
 * Se a cliente já existe, devolve o nome EXATO de lá (até espaço no fim);
 * se não, grava o nome na primeira linha com Nome vazio (o COD já vem pronto).
 */
function _acharOuCadastrarCliente(nome) {
  var cs = _ss().getSheetByName(CONFIG.CLIENTES_SHEET)
  if (!cs) throw new Error('Aba "' + CONFIG.CLIENTES_SHEET + '" não encontrada.')
  var max = cs.getMaxRows()
  var col = cs
    .getRange(CONFIG.CLIENTES_START_ROW, CONFIG.CLIENTES_COL_NOME, max - CONFIG.CLIENTES_START_ROW + 1, 1)
    .getValues()

  var existentes = []
  var livre = -1
  for (var i = 0; i < col.length; i++) {
    if (col[i][0] === '' || col[i][0] === null) {
      if (livre < 0) livre = CONFIG.CLIENTES_START_ROW + i
    } else {
      existentes.push(String(col[i][0]))
    }
  }
  var achada = _acharNaLista(existentes, nome)
  if (achada !== null) return { nome: achada, nova: false }

  if (livre < 0) {
    cs.insertRowsAfter(max, 1)
    livre = max + 1
  }
  cs.getRange(livre, CONFIG.CLIENTES_COL_NOME).setValue(nome)
  SpreadsheetApp.flush() // a validação da Vendas precisa enxergar o nome novo
  return { nome: nome, nova: true, linha: livre }
}

/**
 * A aba Estoque já dá baixa sozinha: "Saídas" é fórmula que soma as vendas
 * do mês pela Descrição, e "Atual" é fórmula (mês anterior + Entradas − Saídas).
 * Por isso NUNCA escrevemos em Saídas. A única exceção é quando ela digitou a
 * contagem por cima da fórmula do "Atual": aí o número não se mexe sozinho e
 * descontamos a quantidade vendida. Se for fórmula, não tocamos.
 */
function _baixarAtualDigitado(estoque, linhaCatalogo, qtd) {
  var er = linhaCatalogo + CONFIG.ESTOQUE_OFFSET
  var atualCell = estoque.getRange(er, CONFIG.ESTOQUE_COL_ATUAL)
  if (atualCell.getFormula() !== '') return { linha: er, atual: 'fórmula' }
  var atual = Number(atualCell.getValue()) || 0
  atualCell.setValue(atual - qtd)
  return { linha: er, atual: atual - qtd }
}

/** Primeira linha a partir da qual há n linhas livres seguidas (coluna B = Data). */
function _proximoBlocoVendaVazio(sh, n) {
  var max = sh.getMaxRows()
  var total = max - CONFIG.VENDAS_START_ROW + 1
  var col = sh.getRange(CONFIG.VENDAS_START_ROW, 2, total, 1).getValues()
  var seguidas = 0
  for (var i = 0; i < col.length; i++) {
    if (col[i][0] === '' || col[i][0] === null) {
      seguidas++
      if (seguidas === n) return CONFIG.VENDAS_START_ROW + i - n + 1
    } else {
      seguidas = 0
    }
  }
  // sem bloco livre suficiente: começa no fim (quem chama cria as linhas que faltarem)
  return CONFIG.VENDAS_START_ROW + col.length - seguidas
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
