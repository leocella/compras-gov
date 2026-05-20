require('dotenv').config();
'use strict';

const crypto = require('crypto');
const fs   = require('fs');
const path = require('path');
const express = require('express');
const { chromium } = require('playwright');
const { chromium: chromiumStealth } = require('playwright-extra');
chromiumStealth.use(require('puppeteer-extra-plugin-stealth')());
const { tirarScreenshot, rasparItensPregao, lerMensagensChat, responderMensagem, lerPropostasPregao } = require('./comprasgov');
const { buscarItensPregaoApi, listarContratacoesRecentes } = require('./pncp-api');
const { salvar, listarRaspagens, DADOS_DIR }              = require('./storage');
const sessao = require('./sessao');
const da     = require('./dadosabertos-api');
const telegram  = require('./telegram');
const agendador = require('./agendador');
const loteEstado  = require('./lote-estado');
const { executarLote } = require('./lote-runner');

const EventEmitter = require('events');
const bus = new EventEmitter();
bus.setMaxListeners(50); // suportar múltiplos clientes SSE simultâneos

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
  const cdpUrl = process.env.CDP_URL || 'http://127.0.0.1:9222';
  console.log(`[boot] Tentando conectar ao Chrome via CDP em ${cdpUrl}...`);
  try {
    browser = await chromium.connectOverCDP(cdpUrl);
    const context = browser.contexts()[0];
    const abas = context.pages();
    
    // Tenta encontrar uma aba já em algum site de compras do governo, se não, usa a primeira aba ou cria nova
    page = abas.find(p => p.url().includes('gov.br/compras') || p.url().includes('comprasnet')) || abas[0] || await context.newPage();
    
    // Se a aba estiver vazia, navega para a URL inicial
    if (!page.url().startsWith('http')) {
      await page.goto(START_URL, { waitUntil: 'domcontentloaded' });
    }
    console.log(`[boot] Conectado ao Chrome real! Aba ativa: ${page.url()}`);
  } catch (err) {
    console.log(`[boot] CDP indisponível (${err.message}). Lançando Chromium standalone (headless=${HEADLESS})...`);
    browser = await chromium.launch({ headless: HEADLESS });
    const ctxOpts = sessao.opcoesContextoComSessao();
    const context = await browser.newContext(ctxOpts);
    page = await context.newPage();
    await page.goto(START_URL, { waitUntil: 'domcontentloaded' });
    console.log(`[boot] Página inicial standalone: ${page.url()}`);
  }
}

async function shutdown(signal) {
  console.log(`\n[shutdown] Recebido ${signal}, fechando browser...`);
  try { if (browser) await browser.close(); } catch (e) { /* ignore */ }
  process.exit(0);
}

const app = express();
app.use(express.json());

function validarKey(provided) {
  const key = process.env.API_KEY;
  if (!key || !provided || provided.length !== key.length) return false;
  return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(key));
}

app.use((req, res, next) => {
  if (req.path === '/events') return next(); // /events tem auth própria via ?key=
  const provided = req.headers['x-api-key'] || '';
  if (!validarKey(provided))
    return res.status(401).json({ erro: 'Não autorizado' });
  next();
});

app.get('/status', (req, res) => {
  res.json({
    online:          true,
    browserPronto:   !!page,
    url:             page ? page.url() : null,
    sessaoAtiva:     !!pageSessao,
    agendadorAtivo:  !!process.env.TELEGRAM_TOKEN,
  });
});

app.get('/api/compras-alvo', (req, res) => {
  try {
    const alvos = JSON.parse(fs.readFileSync(path.join(__dirname, 'compras-alvo.json'), 'utf8'));
    res.json(alvos);
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao ler compras-alvo.json: ' + err.message });
  }
});

app.get('/events', (req, res) => {
  const key = req.query.key || req.headers['x-api-key'];
  if (!validarKey(key)) return res.status(401).end();

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (event, data) => {
    if (res.writableEnded) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const handlers = {
    mudanca_detectada:  d => send('mudanca_detectada', d),
    mensagem_pregoeiro: d => send('mensagem_pregoeiro', d),
    scraping_inicio:    d => send('scraping_inicio', d),
    scraping_fim:       d => send('scraping_fim', d),
  };

  Object.entries(handlers).forEach(([e, h]) => bus.on(e, h));
  const hb = setInterval(() => send('heartbeat', { ts: Date.now() }), 30_000);

  req.on('close', () => {
    Object.entries(handlers).forEach(([e, h]) => bus.off(e, h));
    clearInterval(hb);
  });
});

app.get('/screenshot', async (req, res) => {
  const alvo = req.query.sessao === '1' ? pageSessao : page;
  if (!alvo) {
    return res.status(503).json({ sucesso: false, erro: req.query.sessao === '1'
      ? 'Sem sessão ativa — chame POST /sessao/iniciar'
      : 'Browser principal não iniciado' });
  }
  try {
    const screenshotBase64 = await tirarScreenshot(alvo);
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
// Endpoints DADOSABERTOS (dadosabertos.compras.gov.br)
// Cobertura: pregões legado, itens c/ vencedor, contratos, UASG, preços
// ───────────────────────────────────────────────────────────────────────────

/**
 * GET /legado/pregoes
 * Lista pregões do sistema legado (SIASG/ComprasNet).
 * Query obrigatória: dt_data_edital_inicial, dt_data_edital_final (YYYY-MM-DD)
 * Opcional: co_uasg, co_orgao, numero, pertence14133 (true/false)
 * Exemplo: /legado/pregoes?co_uasg=150229&dt_data_edital_inicial=2026-01-01&dt_data_edital_final=2026-04-30
 */
app.get('/legado/pregoes', async (req, res) => {
  try {
    const r = await da.listarPregoes(req.query);
    res.json({ sucesso: true, fonte: 'dadosabertos.compras.gov.br', ...r });
  } catch (err) {
    console.error('[legado/pregoes]', err.message);
    res.status(err.message.includes('obrigat') ? 400 : 500).json({ sucesso: false, erro: err.message });
  }
});

/**
 * GET /legado/pregao
 * Busca pregão específico por id_compra (ID interno SIASG).
 * Query: id_compra* (obrigatório)
 */
app.get('/legado/pregao', async (req, res) => {
  try {
    const r = await da.buscarPregaoPorId(req.query);
    res.json({ sucesso: true, fonte: 'dadosabertos.compras.gov.br', ...r });
  } catch (err) {
    console.error('[legado/pregao]', err.message);
    res.status(err.message.includes('obrigat') ? 400 : 500).json({ sucesso: false, erro: err.message });
  }
});

/**
 * GET /legado/itens-pregao
 * Lista itens de pregão com resultado (vencedor, valor homologado, fornecedor).
 * Query obrigatória: dt_hom_inicial, dt_hom_final (YYYY-MM-DD)
 * Opcional: co_uasg, fornecedor_vencedor (CNPJ), decreto_7174 (S/N)
 * Exemplo: /legado/itens-pregao?co_uasg=150229&dt_hom_inicial=2026-01-01&dt_hom_final=2026-04-30
 */
app.get('/legado/itens-pregao', async (req, res) => {
  try {
    const r = await da.listarItensPregao(req.query);
    res.json({ sucesso: true, fonte: 'dadosabertos.compras.gov.br', ...r });
  } catch (err) {
    console.error('[legado/itens-pregao]', err.message);
    res.status(err.message.includes('obrigat') ? 400 : 500).json({ sucesso: false, erro: err.message });
  }
});

/**
 * GET /legado/item-pregao
 * Busca item específico por id_compra e (opcional) id_compra_item.
 */
app.get('/legado/item-pregao', async (req, res) => {
  try {
    const r = await da.buscarItemPregaoPorId(req.query);
    res.json({ sucesso: true, fonte: 'dadosabertos.compras.gov.br', ...r });
  } catch (err) {
    console.error('[legado/item-pregao]', err.message);
    res.status(err.message.includes('obrigat') ? 400 : 500).json({ sucesso: false, erro: err.message });
  }
});

/**
 * GET /legado/contratos
 * Lista contratos por órgão e vigência.
 * Query obrigatória: dataVigenciaInicialMin, dataVigenciaInicialMax (YYYY-MM-DD)
 * Opcional: codigoUnidadeGestora, niFornecedor, numeroContrato
 */
app.get('/legado/contratos', async (req, res) => {
  try {
    const r = await da.listarContratos(req.query);
    res.json({ sucesso: true, fonte: 'dadosabertos.compras.gov.br', ...r });
  } catch (err) {
    console.error('[legado/contratos]', err.message);
    res.status(err.message.includes('obrigat') ? 400 : 500).json({ sucesso: false, erro: err.message });
  }
});

/**
 * GET /legado/itens-contratos
 * Lista itens de contratos.
 * Query obrigatória: dataVigenciaInicialMin, dataVigenciaInicialMax (YYYY-MM-DD)
 */
app.get('/legado/itens-contratos', async (req, res) => {
  try {
    const r = await da.listarItensContratos(req.query);
    res.json({ sucesso: true, fonte: 'dadosabertos.compras.gov.br', ...r });
  } catch (err) {
    console.error('[legado/itens-contratos]', err.message);
    res.status(err.message.includes('obrigat') ? 400 : 500).json({ sucesso: false, erro: err.message });
  }
});

/**
 * GET /legado/uasg
 * Informações de uma UASG.
 * Opcional: codigoUasg, cnpjCpfOrgao, siglaUf, statusUasg (default: Ativa)
 * Exemplo: /legado/uasg?codigoUasg=150229
 */
app.get('/legado/uasg', async (req, res) => {
  try {
    const r = await da.listarUasg(req.query);
    res.json({ sucesso: true, fonte: 'dadosabertos.compras.gov.br', ...r });
  } catch (err) {
    console.error('[legado/uasg]', err.message);
    res.status(500).json({ sucesso: false, erro: err.message });
  }
});

/**
 * GET /legado/orgaos
 * Lista órgãos.
 * Opcional: cnpjCpfOrgao, codigoOrgao, statusOrgao (default: Ativo)
 */
app.get('/legado/orgaos', async (req, res) => {
  try {
    const r = await da.listarOrgaos(req.query);
    res.json({ sucesso: true, fonte: 'dadosabertos.compras.gov.br', ...r });
  } catch (err) {
    console.error('[legado/orgaos]', err.message);
    res.status(500).json({ sucesso: false, erro: err.message });
  }
});

/**
 * GET /pesquisa/preco-material
 * Pesquisa preços praticados por item do catálogo de materiais (CATMAT).
 * Query obrigatória: codigoItemCatalogo (código CATMAT)
 * Opcional: codigoUasg, estado, dataCompraInicio, dataCompraFim
 * Exemplo: /pesquisa/preco-material?codigoItemCatalogo=244258&estado=BA
 */
app.get('/pesquisa/preco-material', async (req, res) => {
  try {
    const r = await da.pesquisarPrecoMaterial(req.query);
    res.json({ sucesso: true, fonte: 'dadosabertos.compras.gov.br', ...r });
  } catch (err) {
    console.error('[pesquisa/preco-material]', err.message);
    res.status(err.message.includes('obrigat') ? 400 : 500).json({ sucesso: false, erro: err.message });
  }
});

/**
 * GET /pesquisa/preco-material-detalhe
 * Histórico detalhado de compras de um item de material.
 * Query obrigatória: codigoItemCatalogo
 */
app.get('/pesquisa/preco-material-detalhe', async (req, res) => {
  try {
    const r = await da.pesquisarPrecoMaterialDetalhe(req.query);
    res.json({ sucesso: true, fonte: 'dadosabertos.compras.gov.br', ...r });
  } catch (err) {
    console.error('[pesquisa/preco-material-detalhe]', err.message);
    res.status(err.message.includes('obrigat') ? 400 : 500).json({ sucesso: false, erro: err.message });
  }
});

// ───────────────────────────────────────────────────────────────────────────
// Endpoints de SESSÃO (login manual + storageState)
// ───────────────────────────────────────────────────────────────────────────

/**
 * POST /sessao/iniciar
 * Conecta via CDP (Chrome DevTools Protocol) a uma janela do Chrome real do usuário.
 * O Chrome deve ser iniciado previamente com: --remote-debugging-port=9222
 * O Rafael faz o login manualmente. Chame GET /sessao/status para verificar.
 */
app.post('/sessao/iniciar', async (req, res) => {
  try {
    // Se já existe sessão autenticada, avisar
    if (pageSessao && await sessao.detectarSessaoAtiva(pageSessao)) {
      return res.json({ aguardando: false, jaLogado: true, sessaoSalva: sessao.sessionExists() });
    }

    // Conectar ao Chrome real já aberto pelo usuário via CDP (aproveitar se bootBrowser já conectou)
    const cdpUrl = process.env.CDP_URL || 'http://127.0.0.1:9222';
    try {
      if (!browserSessao || !browserSessao.isConnected()) {
        // Tenta usar a conexão principal se existir
        if (browser && browser.isConnected() && browser.contexts().length > 0) {
          browserSessao = browser;
        } else {
          browserSessao = await chromium.connectOverCDP(cdpUrl);
        }
      }
    } catch (err) {
      return res.status(500).json({
        sucesso: false,
        erro: `Não foi possível conectar ao Chrome via CDP em ${cdpUrl}. Inicie seu navegador com a flag --remote-debugging-port=9222. Detalhe: ${err.message}`
      });
    }

    // Usar o primeiro contexto (default) do Chrome do usuário
    contextSessao = browserSessao.contexts()[0];
    
    // Buscar aba que tenha comprasnet ou pncp/gov.br/compras
    const abas = contextSessao.pages();
    pageSessao = abas.find(p => p.url().includes('comprasnet') || p.url().includes('gov.br/compras'));
    
    if (pageSessao) {
      try { await pageSessao.bringToFront(); } catch { /* ignore */ }
      
      // Verifica se a aba encontrada JÁ ESTÁ logada
      const logado = await sessao.verificarLoginConcluido(pageSessao);
      if (logado && !pageSessao.url().includes('login')) {
        // Já está logado! Salvar a sessão e retornar
        await sessao.salvarSessao(contextSessao);
        aguardandoLogin = false;
        return res.json({ aguardando: false, jaLogado: true, sessaoSalva: true, url: pageSessao.url() });
      } else {
        // Está na tela de login (ou em outra tela não logada do comprasnet)
        aguardandoLogin = true;
        const info = await sessao.abrirLogin(pageSessao);
        return res.json({ ...info, instrucao: 'Faça o login na aba encontrada. Chame GET /sessao/status para verificar.' });
      }
    }

    // Se não encontrou nenhuma aba relacionada ao ComprasNet, cria uma nova e navega
    pageSessao = await contextSessao.newPage();
    aguardandoLogin = true;
    const info = await sessao.abrirLogin(pageSessao);
    try { await pageSessao.bringToFront(); } catch { /* ignore */ }

    res.json({ ...info, instrucao: 'Faça o login na nova aba aberta no seu Chrome. Chame GET /sessao/status para verificar.' });
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
 * Desconecta do browser de sessão e apaga o arquivo session.json.
 */
app.post('/sessao/encerrar', async (req, res) => {
  try {
    if (browserSessao) {
      // Fecha a aba de sessão criada, para manter limpo o Chrome do usuário
      if (pageSessao && !pageSessao.isClosed()) {
        try { await pageSessao.close(); } catch { /* ignore */ }
      }
      // Desconecta do CDP (não fecha o browser do usuário)
      try { await browserSessao.close(); } catch { /* ignore */ }
      
      browserSessao = null;
      contextSessao = null;
      pageSessao    = null;
    }
    sessao.apagarSessao();
    aguardandoLogin = false;
    res.json({ sucesso: true, mensagem: 'Sessão encerrada (desconectado do CDP) e arquivo apagado.' });
  } catch (err) {
    res.status(500).json({ sucesso: false, erro: err.message });
  }
});

// ───────────────────────────────────────────────────────────────────────────
// Endpoints de RECON — navegação e dump HTML da sessão autenticada
// ───────────────────────────────────────────────────────────────────────────

/**
 * POST /recon/navegar
 * Body: { url: string }
 * Navega pageSessao para a URL informada. Usar para explorar o portal após login.
 */
app.post('/recon/navegar', async (req, res) => {
  const { url } = req.body || {};
  if (!url)      return res.status(400).json({ erro: 'campo "url" obrigatório' });
  if (!pageSessao) return res.status(401).json({ erro: 'Sem sessão ativa — chame POST /sessao/iniciar' });

  try {
    await pageSessao.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    res.json({ sucesso: true, url: pageSessao.url() });
  } catch (err) {
    console.error('[recon/navegar]', err.message);
    res.status(500).json({ sucesso: false, erro: err.message });
  }
});

/**
 * GET /recon/html
 * Salva o HTML completo da página atual de pageSessao em dados/recon-<timestamp>.html
 * e retorna o caminho do arquivo. Usar após /recon/navegar.
 */
app.get('/recon/html', async (req, res) => {
  if (!pageSessao) return res.status(401).json({ erro: 'Sem sessão ativa — chame POST /sessao/iniciar' });

  try {
    const html      = await pageSessao.content();
    const arquivo   = path.join(__dirname, 'dados', `recon-${Date.now()}.html`);
    fs.mkdirSync(path.dirname(arquivo), { recursive: true });
    fs.writeFileSync(arquivo, html, 'utf8');
    console.log(`[recon/html] Salvo: ${arquivo} (${html.length} bytes)`);
    res.json({ sucesso: true, arquivo, bytes: html.length, urlCapturada: pageSessao.url() });
  } catch (err) {
    console.error('[recon/html]', err.message);
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
 * Body: { compraId, item, texto, dryRun? }
 * Envia (ou só preenche, em dry-run) uma resposta no chat de um item específico.
 * Em dry-run o texto é digitado mas não submetido — usuário valida via VNC.
 */
app.post('/mensagens/responder', async (req, res) => {
  const { compraId, item, texto, dryRun } = req.body || {};
  if (!compraId)   return res.status(400).json({ erro: 'campo "compraId" obrigatório' });
  if (!item)       return res.status(400).json({ erro: 'campo "item" obrigatório (número do item)' });
  if (!texto)      return res.status(400).json({ erro: 'campo "texto" obrigatório' });
  if (!pageSessao) return res.status(401).json({ erro: 'Sem sessão ativa — chame POST /sessao/iniciar primeiro' });

  if (busy) return res.status(409).json({ erro: 'ocupado' });
  busy = true;

  try {
    const resultado = await responderMensagem(pageSessao, compraId, item, texto, { dryRun });
    res.json({ sucesso: true, compraId: String(compraId), item: String(item), texto, ...resultado });
  } catch (err) {
    console.error('[mensagens/responder]', err.message);
    res.status(500).json({ sucesso: false, erro: err.message });
  } finally {
    busy = false;
  }
});

/**
 * POST /pregao/propostas
 * Body: { uasg, numeroPregao }
 * Raspa propostas de um pregão. Requer sessão ativa (POST /sessao/iniciar primeiro).
 * SEL_PROP deve estar preenchido (Task 4 do plano de implementação).
 */
app.post('/pregao/propostas', async (req, res) => {
  const { uasg, numeroPregao } = req.body || {};
  if (!uasg)         return res.status(400).json({ erro: 'campo "uasg" obrigatório' });
  if (!numeroPregao) return res.status(400).json({ erro: 'campo "numeroPregao" obrigatório' });
  if (!pageSessao)   return res.status(401).json({ erro: 'Sem sessão ativa — chame POST /sessao/iniciar primeiro' });

  if (busy) return res.status(409).json({ erro: 'ocupado' });
  busy = true;

  try {
    const resultado = await lerPropostasPregao(pageSessao, uasg, numeroPregao);
    res.json({
      sucesso: true,
      uasg: String(uasg),
      numeroPregao: String(numeroPregao),
      totalPropostas: resultado.total,
      propostas: resultado.propostas,
      url: resultado.url,
    });
  } catch (err) {
    console.error('[pregao/propostas]', err.message);
    res.status(500).json({ sucesso: false, erro: err.message });
  } finally {
    busy = false;
  }
});

// ───────────────────────────────────────────────────────────────────────────

(async () => {
  await bootBrowser();

  if (process.env.TELEGRAM_TOKEN) {
    try {
      telegram.init(process.env.TELEGRAM_TOKEN, process.env.TELEGRAM_CHAT_ID);
      telegram.setResponderCallback(async (ctx, texto) => {
        if (!pageSessao) {
          throw new Error('Sessão pageSessao não ativa — chame POST /sessao/iniciar primeiro');
        }
        if (!ctx.item || ctx.item === '?') {
          throw new Error('Item da mensagem não identificado — contexto incompleto, responda manualmente via VNC');
        }
        return responderMensagem(pageSessao, ctx.compraId, ctx.item, texto);
      });

      // /retomar via Telegram → retoma lote pausado usando aba logada do Chrome
      telegram.setRetomarCallback(async () => {
        const estado = loteEstado.obterEstado();
        if (!estado) return '❓ Nenhum lote anterior (sem dados/lote-estado.json).';
        if (estado.status === loteEstado.STATUS.RODANDO) {
          return '⏳ Lote já está rodando, aguarde concluir ou pausar.';
        }
        if (estado.status !== loteEstado.STATUS.PAUSADO) {
          return `ℹ️ Lote não está pausado (status atual: <code>${estado.status}</code>).`;
        }

        const todosAlvos = JSON.parse(fs.readFileSync(path.join(__dirname, 'compras-alvo.json'), 'utf8'));
        const pendentes = new Set(estado.compras_pendentes);
        const alvos = todosAlvos.filter(a => pendentes.has(String(a.compraId)));
        if (alvos.length === 0) {
          return '⚠️ Lote pausado mas nenhuma das pendentes consta em <code>compras-alvo.json</code>.';
        }

        // Encontra a aba LOGADA do SPA (mesma heurística do raspar-lote)
        const todasAbas = browser ? browser.contexts().flatMap(c => c.pages()) : [];
        const pageLogada = todasAbas.find(p => p.url().includes('cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/seguro/'));
        if (!pageLogada) {
          return '⚠️ Nenhuma aba em <code>/seguro/fornecedor/</code> aberta no Chrome.\nFaça login + abra uma compra-alvo e mande /retomar de novo.';
        }

        // Fire-and-forget: não bloqueia a resposta do bot
        executarLote({ alvos, page: pageLogada, telegram, iniciarNovo: false })
          .catch(err => console.error('[retomar] erro no executarLote:', err.message));

        return `🔄 <b>Retomando lote</b>: ${alvos.length} compra(s) pendente(s). Notificações de progresso aqui.`;
      });
      telegram.iniciarPolling();
      agendador.init({
        telegram,
        getPage:        () => page,
        getPageSessao:  () => pageSessao,
        comprasAlvoPath: path.join(__dirname, 'compras-alvo.json'),
        bus,
      });
      const dryRun = process.env.TELEGRAM_RESPONDER_DRY_RUN === 'true';
      console.log(`[boot] Telegram + agendador inicializados. Responder pregoeiro: ${dryRun ? 'DRY-RUN (seguro)' : 'AUTO (envia direto)'}`);
    } catch (err) {
      console.error('[boot] Telegram desabilitado:', err.message);
    }
  } else {
    console.log('[boot] TELEGRAM_TOKEN não definido — agendador desabilitado.');
  }

  app.listen(PORT, '127.0.0.1', () => {
    console.log(`[boot] API rodando em http://127.0.0.1:${PORT}`);
  });
})().catch((err) => {
  console.error('[fatal] Falha no boot:', err);
  process.exit(1);
});

process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
