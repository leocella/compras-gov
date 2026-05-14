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
// Seletores do chat de mensagens — ComprasNet (cnetmobile.estaleiro.serpro.gov.br)
// Confirmados via recon ao vivo em 2026-05-14.
// ---------------------------------------------------------------------------
const SEL_MSG = {
  // URL geral do drawer (read-only, todas mensagens da compra)
  urlChat: 'https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/seguro/fornecedor/acompanhamento-compra?compra=',

  // URL por item — chat com form de resposta (read + write)
  // Template: substituir {item} e {compra}
  urlChatItem: 'https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/seguro/fornecedor/acompanhamento-compra/item/{item}?compra={compra}',

  // Drawer global (visualização agregada)
  botaoChatAbrir:  'app-botao-mensagens-da-compra',
  linhasMensagens: 'app-mensagens-da-compra .mensagem-card',
  colMsgRemetente: '.mensagens-remetente',
  colMsgItem:      '.mensagens-item a',
  colMsgDataHora:  '.mensagens-data small',
  colMsgTexto:     '.mensagens-texto',

  // Chat por item (textarea + botão Enviar)
  cardMsgItem:     'app-mensagens-chat .cp-mensagens-compra',
  propriaMarker:   '.propria',
  campoResposta:   'app-mensagens-chat textarea[placeholder="Nova mensagem"]',
  botaoEnviar:     'app-mensagens-chat button[primary]',
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
// lerMensagensChat — drawer global da compra (read-only). Requer sessão logada.
// Retorna mensagens com campo `item` extraído do link .mensagens-item.
// ---------------------------------------------------------------------------
async function lerMensagensChat(page, compraId) {
  const targetUrl = SEL_MSG.urlChat + compraId;

  if (!page.url().includes(compraId)) {
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForTimeout(5000); // aguarda o SPA carregar
  }

  if (page.url().includes('login')) {
    throw new Error('Sessão expirada — faça login via POST /sessao/iniciar');
  }

  // Se o drawer não estiver aberto, clica no ícone de mensagens
  const domHasCards = await page.$eval('body', el => el.innerHTML.includes('mensagem-card')).catch(() => false);
  if (!domHasCards) {
    const btnIcon = await page.$(SEL_MSG.botaoChatAbrir);
    if (btnIcon) {
      await btnIcon.click({ force: true });
      await page.waitForTimeout(3000);
    } else {
      return { mensagens: [], url: page.url(), total: 0 };
    }
  }

  const mensagens = await page.$$eval(SEL_MSG.linhasMensagens, (cards, sel) => {
    return cards.map(c => {
      const header = c.querySelector('.cabecalho-mensagem');
      const remetente = header ? (header.querySelector(sel.colMsgRemetente)?.innerText?.trim() || '') : '';
      const itemRaw = c.querySelector(sel.colMsgItem)?.innerText?.trim() || '';
      const item = (itemRaw.match(/\d+/) || [''])[0]; // "Item 17" → "17"
      const dataHora = c.querySelector(sel.colMsgDataHora)?.innerText?.trim() || '';
      const textoElem = c.querySelector(sel.colMsgTexto);
      const texto = textoElem ? textoElem.innerText?.trim() : c.innerText?.trim();
      return { remetente, item, dataHora, texto };
    }).filter(m => m.texto);
  }, SEL_MSG);

  return { mensagens, url: page.url(), total: mensagens.length };
}

// ---------------------------------------------------------------------------
// lerMensagensItem — chat da página do item específico (read).
// Estrutura diferente do drawer: cada msg é .cp-mensagens-compra; sem
// .mensagens-remetente — distingue "própria" por classe CSS .propria.
// ---------------------------------------------------------------------------
async function lerMensagensItem(page, compraId, item) {
  const targetUrl = SEL_MSG.urlChatItem
    .replace('{item}',  String(item))
    .replace('{compra}', String(compraId));

  if (!page.url().includes(`/item/${item}`) || !page.url().includes(compraId)) {
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForTimeout(5000);
  }

  if (page.url().includes('login')) {
    throw new Error('Sessão expirada — faça login via POST /sessao/iniciar');
  }

  const mensagens = await page.$$eval(SEL_MSG.cardMsgItem, (cards, sel) => {
    return cards.map(c => ({
      propria:  c.classList.contains(sel.propriaMarker.replace('.', '')),
      dataHora: c.querySelector(sel.colMsgDataHora)?.innerText?.trim() || '',
      texto:    c.querySelector(sel.colMsgTexto)?.innerText?.trim() || '',
    })).filter(m => m.texto);
  }, SEL_MSG);

  return { mensagens, url: page.url(), total: mensagens.length, item: String(item) };
}

// ---------------------------------------------------------------------------
// responderMensagem — envia (ou só preenche, em dry-run) resposta ao pregoeiro
//
// Em dry-run, o texto é digitado no campo mas NUNCA é submetido — o usuário
// revisa via VNC e clica enviar manualmente. Default vem de
// process.env.TELEGRAM_RESPONDER_DRY_RUN.
//
// Toda invocação é registrada em dados/respostas-pregoeiro.log para auditoria
// (chat com órgão público).
// ---------------------------------------------------------------------------
const fs   = require('fs');
const path = require('path');
const LOG_RESPOSTAS = path.join(__dirname, 'dados', 'respostas-pregoeiro.log');

function _logResposta(entrada) {
  try {
    fs.mkdirSync(path.dirname(LOG_RESPOSTAS), { recursive: true });
    fs.appendFileSync(
      LOG_RESPOSTAS,
      JSON.stringify({ ts: new Date().toISOString(), ...entrada }) + '\n',
    );
  } catch (e) {
    console.error('[responderMensagem] Falha ao logar:', e.message);
  }
}

async function responderMensagem(page, compraId, item, texto, opts = {}) {
  if (!compraId) throw new Error('responderMensagem: compraId obrigatório');
  if (!item)     throw new Error('responderMensagem: item obrigatório (número do item)');
  if (!texto)    throw new Error('responderMensagem: texto obrigatório');

  const dryRun = opts.dryRun ?? (process.env.TELEGRAM_RESPONDER_DRY_RUN === 'true');

  if (!SEL_MSG.campoResposta || !SEL_MSG.botaoEnviar) {
    const erro = 'SEL_MSG.campoResposta ou SEL_MSG.botaoEnviar vazio';
    _logResposta({ compraId, item, texto, modo: dryRun ? 'dry-run' : 'auto', erro });
    throw new Error(erro);
  }

  // Navega para a página do item — o form de resposta só existe nesse contexto
  const targetUrl = SEL_MSG.urlChatItem
    .replace('{item}',  String(item))
    .replace('{compra}', String(compraId));

  try {
    if (!page.url().includes(`/item/${item}`) || !page.url().includes(compraId)) {
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForTimeout(3000);
    }

    if (page.url().includes('login')) {
      throw new Error('Sessão expirada — faça login via POST /sessao/iniciar');
    }

    await page.waitForSelector(SEL_MSG.campoResposta, { timeout: 10_000 });
    await page.fill(SEL_MSG.campoResposta, texto);

    if (dryRun) {
      _logResposta({ compraId, item, texto, modo: 'dry-run', preenchido: true });
      return { sucesso: true, modo: 'dry-run', preenchido: true, enviadoEm: null, url: page.url() };
    }

    await page.click(SEL_MSG.botaoEnviar);
    await page.waitForLoadState('networkidle');
    const enviadoEm = new Date().toISOString();
    _logResposta({ compraId, item, texto, modo: 'auto', enviadoEm });
    return { sucesso: true, modo: 'auto', enviadoEm, url: page.url() };
  } catch (e) {
    _logResposta({ compraId, item, texto, modo: dryRun ? 'dry-run' : 'auto', erro: e.message });
    throw new Error(
      `Erro ao ${dryRun ? 'preencher' : 'enviar'} resposta no item ${item} da compra ${compraId}. ` +
      `Use GET /screenshot?sessao=1 para inspecionar. Erro: ${e.message}`,
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
  lerMensagensItem,
  responderMensagem,
  lerPropostasPregao,
  SEL,
  SEL_MSG,
  SEL_PROP,
};
