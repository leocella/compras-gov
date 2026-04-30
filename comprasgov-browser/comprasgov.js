'use strict';

// ---------------------------------------------------------------------------
// Seletores — busca pública (sem login)
// ---------------------------------------------------------------------------
const SEL = {
  campoUasg:        'input[name*="uasg" i], input[id*="uasg" i]',
  campoNumero:      'input[name*="numero" i], input[id*="numero" i]',
  botaoBuscar:      'button:has-text("Pesquisar"), button:has-text("Buscar")',
  linkItens:        'a:has-text("itens"), a[href*="itens"]',
  linhasItens:      'table tbody tr',
  colNumero:        'td:nth-child(1)',
  colDescricao:     'td:nth-child(2)',
  colQuantidade:    'td:nth-child(3)',
  colUnidade:       'td:nth-child(4)',
  colValorEstimado: 'td:nth-child(5)',
};

// ---------------------------------------------------------------------------
// Seletores do chat de mensagens — ComprasNet legado (comprasnet.gov.br)
// ⚠️ RECON_NEEDED: todos os valores abaixo precisam ser confirmados ao vivo
//   via DevTools / Playwright codegen após login manual do Rafael.
//   Procedure: POST /sessao/iniciar → logar → GET /screenshot → inspecionar HTML.
// ---------------------------------------------------------------------------
const SEL_MSG = {
  // URL base do chat de mensagens do fornecedor (⚠️ confirmar após login)
  urlChat: 'https://www.comprasnet.gov.br/livre/fornecedor/mensagem/consultarMensagemFornecedor.asp',

  // Formulário de busca de mensagens
  campoChatUasg:   'input[name="co_uasg"], input[id="co_uasg"]',         // ⚠️ RECON
  campoChatNumero: 'input[name="numprp"], input[id="numprp"]',            // ⚠️ RECON
  botaoChatBuscar: 'input[type="submit"][value*="Consultar"], input[type="submit"][value*="Buscar"]', // ⚠️ RECON

  // Tabela de mensagens
  linhasMensagens: 'table.tabela-resultado tbody tr, #tabelaMensagens tbody tr', // ⚠️ RECON
  colMsgRemetente: 'td:nth-child(1)',                                     // ⚠️ RECON
  colMsgDataHora:  'td:nth-child(2)',                                     // ⚠️ RECON
  colMsgTexto:     'td:nth-child(3)',                                     // ⚠️ RECON

  // Resposta
  linkResponder:  'a:has-text("Responder"), input[value*="Responder"]',   // ⚠️ RECON
  campoResposta:  'textarea[name*="msg"], textarea[name*="texto"], textarea[id*="resposta"]', // ⚠️ RECON
  botaoEnviar:    'input[type="submit"][value*="Enviar"], button:has-text("Enviar")', // ⚠️ RECON
};

// ---------------------------------------------------------------------------
// Seletores de propostas — portal legado (comprasnet.gov.br)
// ⚠️ RECON_NEEDED: preencher após Task 4 (recon manual)
// ---------------------------------------------------------------------------
const SEL_PROP = {
  urlPropostas:    '',  // ← recon: URL da página de consulta de propostas para fornecedor
  campoUasg:       '',  // ← recon
  campoNumero:     '',  // ← recon
  botaoBuscar:     '',  // ← recon
  linhasPropostas: '',  // ← recon: seletor das linhas da tabela de propostas
};

// ---------------------------------------------------------------------------
// parseValorProposta — converte string monetária em número (ex: "R$ 1.250,99" → 1250.99)
// ---------------------------------------------------------------------------
function parseValorProposta(s) {
  if (!s) return null;
  const limpo = s.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(/,/g, '.');
  const n = parseFloat(limpo);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// parsearLinhasPropostas — função pura: array de arrays de strings → array de objetos
// Cada elemento de `linhas` é [item, fornecedor, cnpj, valor, situacao, marca]
// ---------------------------------------------------------------------------
function parsearLinhasPropostas(linhas) {
  return linhas
    .map((r) => ({
      item:          r[0] || '',
      fornecedor:    r[1] || '',
      cnpj:          r[2] || '',
      valorProposta: parseValorProposta(r[3]),
      situacao:      r[4] || '',
      marca:         r[5] || '',
    }))
    .filter((p) => p.fornecedor || p.item);
}

// ---------------------------------------------------------------------------
// extrairMarcas — função pura, testável sem browser
// ---------------------------------------------------------------------------
function extrairMarcas(descricao) {
  const out = { marcaObrigatoria: '', marcaPreferencia: '' };
  if (!descricao || typeof descricao !== 'string') return out;

  const reObrig = /marca\s+obrigat[óo]ria\s*[:\-–—]\s*([^\n.;]+)/i;
  const rePref  = /marca\s+de\s+prefer[êe]ncia\s*[:\-–—]\s*([^\n.;]+)/i;

  const mO = descricao.match(reObrig);
  const mP = descricao.match(rePref);

  if (mO) out.marcaObrigatoria = mO[1].trim();
  if (mP) out.marcaPreferencia = mP[1].trim();
  return out;
}

// ---------------------------------------------------------------------------
// tirarScreenshot — debug visual
// ---------------------------------------------------------------------------
async function tirarScreenshot(page) {
  const buf = await page.screenshot({ type: 'png', fullPage: false });
  return buf.toString('base64');
}

// ---------------------------------------------------------------------------
// rasparItensPregao — busca pública sem login (bloqueada por CAPTCHA no mobile)
// ---------------------------------------------------------------------------
async function rasparItensPregao(page, uasg, numeroPregao, startUrl) {
  await page.goto(startUrl, { waitUntil: 'domcontentloaded' });

  await page.fill(SEL.campoUasg, String(uasg));
  await page.fill(SEL.campoNumero, String(numeroPregao));
  await page.click(SEL.botaoBuscar);
  await page.waitForLoadState('networkidle');

  await page.click(SEL.linkItens);
  await page.waitForLoadState('networkidle');

  const linhas = await page.$$eval(SEL.linhasItens, (rows, sel) => {
    const txt = (el, q) => { const n = el.querySelector(q); return n ? n.textContent.trim() : ''; };
    const num = (s) => {
      if (!s) return null;
      const limpo = s.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
      const n = parseFloat(limpo);
      return Number.isFinite(n) ? n : null;
    };
    return rows.map((r) => ({
      numero:        txt(r, sel.colNumero),
      descricao:     txt(r, sel.colDescricao),
      quantidade:    num(txt(r, sel.colQuantidade)),
      unidade:       txt(r, sel.colUnidade),
      valorEstimado: num(txt(r, sel.colValorEstimado)),
    }));
  }, SEL);

  const itens = linhas
    .filter((l) => l.numero || l.descricao)
    .map((l) => ({ ...l, ...extrairMarcas(l.descricao) }));

  return { itens, url: page.url() };
}

// ---------------------------------------------------------------------------
// lerMensagensChat — requer sessão logada
// ⚠️ Seletores em SEL_MSG precisam de recon ao vivo para funcionar
// ---------------------------------------------------------------------------
async function lerMensagensChat(page, uasg, numeroPregao) {
  await page.goto(SEL_MSG.urlChat, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForLoadState('networkidle');

  if (page.url().includes('login')) {
    throw new Error('Sessão expirada — faça login via POST /sessao/iniciar');
  }

  try {
    await page.fill(SEL_MSG.campoChatUasg, String(uasg));
    await page.fill(SEL_MSG.campoChatNumero, String(numeroPregao));
    await page.click(SEL_MSG.botaoChatBuscar);
    await page.waitForLoadState('networkidle');
  } catch (e) {
    throw new Error(
      `Seletores do chat precisam de recon (⚠️). ` +
      `Use GET /screenshot para ver o estado da página. ` +
      `Erro: ${e.message}`
    );
  }

  const mensagens = await page.$$eval(SEL_MSG.linhasMensagens, (rows, sel) => {
    const txt = (el, q) => { const n = el.querySelector(q); return n ? n.textContent.trim() : ''; };
    return rows
      .map((r) => ({
        remetente: txt(r, sel.colMsgRemetente),
        dataHora:  txt(r, sel.colMsgDataHora),
        texto:     txt(r, sel.colMsgTexto),
      }))
      .filter((m) => m.texto);
  }, SEL_MSG);

  return { mensagens, url: page.url(), total: mensagens.length };
}

// ---------------------------------------------------------------------------
// responderMensagem — requer sessão logada
// ⚠️ Seletores em SEL_MSG precisam de recon ao vivo para funcionar
// ---------------------------------------------------------------------------
async function responderMensagem(page, uasg, numeroPregao, texto) {
  await lerMensagensChat(page, uasg, numeroPregao);

  try {
    await page.click(SEL_MSG.linkResponder);
    await page.waitForLoadState('domcontentloaded');
    await page.fill(SEL_MSG.campoResposta, texto);
    await page.click(SEL_MSG.botaoEnviar);
    await page.waitForLoadState('networkidle');
    return { enviado: true, url: page.url() };
  } catch (e) {
    throw new Error(
      `Erro ao responder (⚠️ seletores precisam de recon). ` +
      `Use GET /screenshot para inspecionar. ` +
      `Erro: ${e.message}`
    );
  }
}

// ---------------------------------------------------------------------------
// lerPropostasPregao — requer sessão logada
// ⚠️ SEL_PROP precisa ser preenchido após recon (Task 4)
// ---------------------------------------------------------------------------
async function lerPropostasPregao(page, uasg, numeroPregao) {
  if (!SEL_PROP.urlPropostas || !SEL_PROP.linhasPropostas) {
    throw new Error('SEL_PROP não configurado — execute o recon (Task 4) e preencha os seletores');
  }

  await page.goto(SEL_PROP.urlPropostas, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForLoadState('networkidle');

  if (page.url().includes('login')) {
    throw new Error('Sessão expirada — faça login via POST /sessao/iniciar');
  }

  try {
    await page.fill(SEL_PROP.campoUasg, String(uasg));
    await page.fill(SEL_PROP.campoNumero, String(numeroPregao));
    await page.click(SEL_PROP.botaoBuscar);
    await page.waitForLoadState('networkidle');
  } catch (e) {
    throw new Error(
      `Seletores de propostas não encontrados (⚠️ RECON_NEEDED). ` +
      `Use GET /recon/html para inspecionar. Erro: ${e.message}`
    );
  }

  const rawLinhas = await page.$$eval(SEL_PROP.linhasPropostas, (rows) => {
    return rows.map((r) => {
      const cols = Array.from(r.querySelectorAll('td'));
      return cols.map((c) => c.textContent.trim());
    });
  });

  const propostas = parsearLinhasPropostas(rawLinhas);
  return { propostas, total: propostas.length, url: page.url() };
}

module.exports = {
  extrairMarcas,
  parsearLinhasPropostas,
  parseValorProposta,
  tirarScreenshot,
  rasparItensPregao,
  lerMensagensChat,
  responderMensagem,
  lerPropostasPregao,
  SEL,
  SEL_MSG,
  SEL_PROP,
};
