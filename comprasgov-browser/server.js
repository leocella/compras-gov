'use strict';

const express = require('express');
const { chromium } = require('playwright');
const { tirarScreenshot, rasparItensPregao, lerMensagensChat, responderMensagem } = require('./comprasgov');
const { buscarItensPregaoApi, listarContratacoesRecentes } = require('./pncp-api');
const { salvar, listarRaspagens, DADOS_DIR }              = require('./storage');
const sessao = require('./sessao');

const PORT      = parseInt(process.env.PORT || '3099', 10);
const START_URL = process.env.START_URL || 'https://www.comprasnet.gov.br';
const HEADLESS  = (process.env.HEADLESS || 'false').toLowerCase() === 'true';

let browser = null;
let page    = null;
let busy    = false;

// contexto do browser autenticado (sessao.js)
let browserSessao  = null;
let contextSessao  = null;
let pageSessao     = null;
let aguardandoLogin = false;

async function bootBrowser() {
  console.log(`[boot] Lançando Chromium (headless=${HEADLESS})...`);
  browser = await chromium.launch({ headless: HEADLESS });
  // Carrega sessão salva se existir
  const ctxOpts = sessao.opcoesContextoComSessao();
  const context = await browser.newContext(ctxOpts);
  page = await context.newPage();
  await page.goto(START_URL, { waitUntil: 'domcontentloaded' });
  console.log(`[boot] Página inicial: ${page.url()}`);
}

async function shutdown(signal) {
  console.log(`\n[shutdown] Recebido ${signal}, fechando browser...`);
  try { if (browser) await browser.close(); } catch (e) { /* ignore */ }
  process.exit(0);
}

const app = express();
app.use(express.json());

app.get('/status', (req, res) => {
  res.json({
    online: true,
    browserPronto: !!page,
    url: page ? page.url() : null,
  });
});

app.get('/screenshot', async (req, res) => {
  try {
    const screenshotBase64 = await tirarScreenshot(page);
    res.json({ sucesso: true, screenshotBase64 });
  } catch (err) {
    console.error('[screenshot]', err);
    res.status(500).json({ sucesso: false, erro: err.message });
  }
});

app.post('/pregao/itens', async (req, res) => {
  const { uasg, numeroPregao } = req.body || {};
  if (!uasg)         return res.status(400).json({ erro: 'campo "uasg" obrigatório' });
  if (!numeroPregao) return res.status(400).json({ erro: 'campo "numeroPregao" obrigatório' });

  if (busy) return res.status(409).json({ erro: 'ocupado' });
  busy = true;

  try {
    const { itens, url } = await rasparItensPregao(page, uasg, numeroPregao, START_URL);
    res.json({
      sucesso: true,
      uasg: String(uasg),
      numeroPregao: String(numeroPregao),
      totalItens: itens.length,
      itens,
      url,
    });
  } catch (err) {
    console.error('[pregao/itens]', err);
    res.status(500).json({
      sucesso: false,
      erro: err.message,
      dica: 'Rode GET /screenshot para ver o estado atual da página.',
    });
  } finally {
    busy = false;
  }
});

// ─── Endpoints API REST (sem browser) ──────────────────────────────────────

/**
 * POST /api/itens
 * Body: { cnpj, ano, sequencial } OU { cnpj, ano, numeroCompra }
 * Retorna itens de um pregão via API pública PNCP — sem Playwright, sem login.
 * Exemplo:
 *   { "cnpj": "90483058000126", "ano": 2026, "sequencial": 54 }
 */
app.post('/api/itens', async (req, res) => {
  const { cnpj, ano, sequencial, numeroCompra } = req.body || {};

  if (!cnpj)  return res.status(400).json({ erro: 'campo "cnpj" obrigatório' });
  if (!ano)   return res.status(400).json({ erro: 'campo "ano" obrigatório' });
  if (!sequencial && !numeroCompra)
    return res.status(400).json({ erro: 'informe "sequencial" ou "numeroCompra"' });

  try {
    const cnpjLimpo = String(cnpj).replace(/\D/g, '');
    const itens = await buscarItensPregaoApi({ cnpj, ano, sequencial, numeroCompra });

    // Persistir em disco (JSON + CSV)
    const meta    = { cnpj: cnpjLimpo, ano: String(ano), sequencial, numeroCompra };
    const salvo   = salvar(meta, itens);
    console.log(`[api/itens] Salvo: ${salvo.json}`);

    res.json({
      sucesso: true,
      cnpj: cnpjLimpo,
      ano: String(ano),
      sequencial: sequencial ? String(sequencial) : undefined,
      numeroCompra: numeroCompra ? String(numeroCompra) : undefined,
      totalItens: itens.length,
      itens,
      fonte: 'PNCP REST API (sem browser)',
      arquivos: {
        json: salvo.json,
        csv:  salvo.csv,
      },
    });
  } catch (err) {
    console.error('[api/itens]', err.message);
    res.status(500).json({ sucesso: false, erro: err.message });
  }
});

/**
 * GET /api/raspagens
 * Lista todos os arquivos JSON salvos em dados/.
 */
app.get('/api/raspagens', (req, res) => {
  try {
    const lista = listarRaspagens();
    res.json({
      sucesso: true,
      pastaArquivos: DADOS_DIR,
      total: lista.length,
      raspagens: lista,
    });
  } catch (err) {
    res.status(500).json({ sucesso: false, erro: err.message });
  }
});

/**
 * GET /api/contratacoes
 * Query: dataInicial, dataFinal, modalidade, pagina, tamanhoPagina
 * Lista pregões publicados no PNCP num intervalo de datas.
 * Exemplo: GET /api/contratacoes?dataInicial=20260420&dataFinal=20260429
 */
app.get('/api/contratacoes', async (req, res) => {
  const { dataInicial, dataFinal, modalidade, pagina, tamanhoPagina } = req.query;
  try {
    const resultado = await listarContratacoesRecentes({
      dataInicial,
      dataFinal,
      modalidade: modalidade ? Number(modalidade) : 6,
      pagina:     pagina     ? Number(pagina)     : 1,
      tamanhoPagina: tamanhoPagina ? Number(tamanhoPagina) : 20,
    });
    res.json({ sucesso: true, ...resultado });
  } catch (err) {
    console.error('[api/contratacoes]', err.message);
    res.status(500).json({ sucesso: false, erro: err.message });
  }
});

// ───────────────────────────────────────────────────────────────────────────
// Endpoints de SESSÃO (login manual + storageState)
// ───────────────────────────────────────────────────────────────────────────

/**
 * POST /sessao/iniciar
 * Abre uma janela do Chrome na tela de login do ComprasNet.
 * O Rafael faz o login manualmente. Chame GET /sessao/status para verificar.
 */
app.post('/sessao/iniciar', async (req, res) => {
  try {
    // Se já existe sessão autenticada, avisar
    if (pageSessao && await sessao.detectarSessaoAtiva(pageSessao)) {
      return res.json({ aguardando: false, jaLogado: true, sessaoSalva: sessao.sessionExists() });
    }

    // Criar novo contexto de sessão (limpo, sem storageState anterior)
    if (browserSessao) {
      try { await browserSessao.close(); } catch { /* ignore */ }
    }
    browserSessao = await require('playwright').chromium.launch({ headless: false });
    contextSessao = await browserSessao.newContext({ viewport: null });
    pageSessao    = await contextSessao.newPage();
    aguardandoLogin = true;

    const info = await sessao.abrirLogin(pageSessao);
    res.json({ ...info, instrucao: 'Faça o login na janela aberta. Chame GET /sessao/status para verificar.' });
  } catch (err) {
    console.error('[sessao/iniciar]', err.message);
    res.status(500).json({ sucesso: false, erro: err.message });
  }
});

/**
 * GET /sessao/status
 * Verifica se o login foi concluído. Quando sim, salva a sessão em disco.
 */
app.get('/sessao/status', async (req, res) => {
  if (!pageSessao) {
    return res.json({ logado: false, sessaoSalva: sessao.sessionExists(), motivo: 'Login não iniciado — chame POST /sessao/iniciar' });
  }

  try {
    const logado = await sessao.verificarLoginConcluido(pageSessao);

    if (logado && aguardandoLogin) {
      // Salvar sessão na primeira detecção
      await sessao.salvarSessao(contextSessao);
      aguardandoLogin = false;
      console.log('[sessao/status] Login detectado — sessão salva.');
    }

    res.json({
      logado,
      sessaoSalva: sessao.sessionExists(),
      urlAtual: pageSessao.url(),
    });
  } catch (err) {
    res.status(500).json({ sucesso: false, erro: err.message });
  }
});

/**
 * POST /sessao/encerrar
 * Fecha o browser de sessão e apaga o arquivo session.json.
 */
app.post('/sessao/encerrar', async (req, res) => {
  try {
    if (browserSessao) {
      await browserSessao.close();
      browserSessao = null;
      contextSessao = null;
      pageSessao    = null;
    }
    sessao.apagarSessao();
    aguardandoLogin = false;
    res.json({ sucesso: true, mensagem: 'Sessão encerrada e arquivo apagado.' });
  } catch (err) {
    res.status(500).json({ sucesso: false, erro: err.message });
  }
});

// ───────────────────────────────────────────────────────────────────────────
// Endpoints de MENSAGENS (requer sessão logada + recon de seletores)
// ───────────────────────────────────────────────────────────────────────────

/**
 * POST /mensagens/ler
 * Body: { uasg, numeroPregao }
 * Lê mensagens do chat de um pregão. Requer sessão ativa (POST /sessao/iniciar primeiro).
 * ⚠️ Seletores em SEL_MSG precisam de recon ao vivo.
 */
app.post('/mensagens/ler', async (req, res) => {
  const { uasg, numeroPregao } = req.body || {};
  if (!uasg)         return res.status(400).json({ erro: 'campo "uasg" obrigatório' });
  if (!numeroPregao) return res.status(400).json({ erro: 'campo "numeroPregao" obrigatório' });
  if (!pageSessao)   return res.status(401).json({ erro: 'Sem sessão ativa — chame POST /sessao/iniciar primeiro' });

  if (busy) return res.status(409).json({ erro: 'ocupado' });
  busy = true;

  try {
    const resultado = await lerMensagensChat(pageSessao, uasg, numeroPregao);
    res.json({ sucesso: true, uasg: String(uasg), numeroPregao: String(numeroPregao), ...resultado });
  } catch (err) {
    console.error('[mensagens/ler]', err.message);
    res.status(500).json({
      sucesso: false,
      erro: err.message,
      dica: 'Use GET /screenshot (adicione ?sessao=1 para screenshot da janela de sessão) para inspecionar.',
    });
  } finally {
    busy = false;
  }
});

/**
 * POST /mensagens/responder
 * Body: { uasg, numeroPregao, texto }
 * Envia uma resposta no chat de um pregão.
 * ⚠️ Seletores em SEL_MSG precisam de recon ao vivo.
 */
app.post('/mensagens/responder', async (req, res) => {
  const { uasg, numeroPregao, texto } = req.body || {};
  if (!uasg)         return res.status(400).json({ erro: 'campo "uasg" obrigatório' });
  if (!numeroPregao) return res.status(400).json({ erro: 'campo "numeroPregao" obrigatório' });
  if (!texto)        return res.status(400).json({ erro: 'campo "texto" obrigatório' });
  if (!pageSessao)   return res.status(401).json({ erro: 'Sem sessão ativa — chame POST /sessao/iniciar primeiro' });

  if (busy) return res.status(409).json({ erro: 'ocupado' });
  busy = true;

  try {
    const resultado = await responderMensagem(pageSessao, uasg, numeroPregao, texto);
    res.json({ sucesso: true, uasg: String(uasg), numeroPregao: String(numeroPregao), texto, ...resultado });
  } catch (err) {
    console.error('[mensagens/responder]', err.message);
    res.status(500).json({ sucesso: false, erro: err.message });
  } finally {
    busy = false;
  }
});

// ───────────────────────────────────────────────────────────────────────────

(async () => {
  await bootBrowser();
  app.listen(PORT, '127.0.0.1', () => {
    console.log(`[boot] API rodando em http://127.0.0.1:${PORT}`);
  });
})().catch((err) => {
  console.error('[fatal] Falha no boot:', err);
  process.exit(1);
});

process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
