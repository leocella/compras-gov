'use strict';

const express = require('express');
const { chromium } = require('playwright');
const { tirarScreenshot, rasparItensPregao } = require('./comprasgov');
const { buscarItensPregaoApi, listarContratacoesRecentes } = require('./pncp-api');
const { salvar, listarRaspagens, DADOS_DIR }              = require('./storage');

const PORT      = parseInt(process.env.PORT || '3099', 10);
const START_URL = process.env.START_URL || 'https://www.comprasnet.gov.br';
const HEADLESS  = (process.env.HEADLESS || 'false').toLowerCase() === 'true';

let browser = null;
let page    = null;
let busy    = false;

async function bootBrowser() {
  console.log(`[boot] Lançando Chromium (headless=${HEADLESS})...`);
  browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext({ viewport: null });
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
