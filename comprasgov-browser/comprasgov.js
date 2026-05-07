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
  urlChat: 'https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/seguro/fornecedor/acompanhamento-compra?compra=',
  botaoChatAbrir: '.icones-mensagens, app-botao-mensagens-da-compra',
  linhasMensagens: '.mensagem-card',
  colMsgRemetente: '.mensagens-remetente',
  colMsgDataHora: '.mensagens-data',
  colMsgTexto: '.mensagens-texto',
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
async function lerMensagensChat(page, compraId) {
  const targetUrl = SEL_MSG.urlChat + compraId;
  
  if (!page.url().includes(compraId)) {
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForTimeout(5000); // Aguardar o SPA carregar
  }

  if (page.url().includes('login')) {
    throw new Error('Sessão expirada — faça login via POST /sessao/iniciar');
  }

  // Se não houver mensagens visíveis, tenta clicar no botão
  const domHasCards = await page.$eval('body', el => el.innerHTML.includes('mensagem-card')).catch(() => false);
  if (!domHasCards) {
    const btnIcon = await page.$(SEL_MSG.botaoChatAbrir);
    if (btnIcon) {
      await btnIcon.click({ force: true });
      await page.waitForTimeout(3000);
    } else {
      // Se não tem botão e não tem cards, retorna vazio
      return { mensagens: [], url: page.url(), total: 0 };
    }
  }

  const mensagens = await page.$$eval(SEL_MSG.linhasMensagens, (cards, sel) => {
    return cards.map(c => {
      const header = c.querySelector('.cabecalho-mensagem');
      const remetente = header ? (header.querySelector(sel.colMsgRemetente)?.innerText?.trim() || '') : '';
      const dataHora = c.querySelector(sel.colMsgDataHora)?.innerText?.trim() || '';
      const textoElem = c.querySelector(sel.colMsgTexto);
      const texto = textoElem ? textoElem.innerText?.trim() : c.innerText?.trim();
      return { remetente, dataHora, texto };
    }).filter(m => m.texto);
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
