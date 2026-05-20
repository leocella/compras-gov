#!/usr/bin/env node
'use strict';

/**
 * raspar-lote.js — CLI standalone para rodar o lote manualmente.
 *
 * Lê comprasgov-browser/compras-alvo.json e executa via lote-runner.js
 * (mesma lógica usada pelo agendador). Suporta:
 *
 *   --retomar   processa apenas as compras pendentes do último lote
 *   --apenas <compraId>[,<compraId>...]
 *               processa só as compras informadas (filtra a lista alvo)
 *
 * Exit codes:
 *   0  → sucesso ou pausa graciosa (sessão expirou — não é erro)
 *   1  → erro fatal (Chrome não conecta, JSON corrompido, etc)
 */

const path = require('path');
// Carrega .env pelo caminho absoluto — funciona mesmo se rodado de outro cwd
require('dotenv').config({ path: path.join(__dirname, '.env') });

const fs = require('fs');
const { conectarChrome, log } = require('./raspar-propostas-cdp');
const { executarLote }        = require('./lote-runner');
const loteEstado              = require('./lote-estado');

let telegram = null;
if (process.env.TELEGRAM_TOKEN && process.env.TELEGRAM_CHAT_ID) {
  telegram = require('./telegram');
  telegram.init(process.env.TELEGRAM_TOKEN, process.env.TELEGRAM_CHAT_ID);
}

function parseArgs(argv) {
  const out = { retomar: false, apenas: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--retomar') out.retomar = true;
    else if (a === '--apenas') out.apenas = (argv[++i] || '').split(',').map(s => s.trim()).filter(Boolean);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const alvoPath = path.join(__dirname, 'compras-alvo.json');
  if (!fs.existsSync(alvoPath)) {
    console.error(`[raspar-lote] ${alvoPath} não encontrado`);
    process.exit(1);
  }

  const todosAlvos = JSON.parse(fs.readFileSync(alvoPath, 'utf8'));
  let alvosFiltrados = todosAlvos;
  let iniciarNovo    = true;

  if (args.retomar) {
    const estado = loteEstado.obterEstado();
    if (!estado) {
      console.error('[raspar-lote] --retomar mas não há lote anterior em dados/lote-estado.json');
      process.exit(1);
    }
    if (estado.status !== loteEstado.STATUS.PAUSADO) {
      console.error(`[raspar-lote] --retomar mas lote está em status="${estado.status}" (esperado: pausado_sessao_expirada)`);
      process.exit(1);
    }
    const pendentes = new Set(estado.compras_pendentes);
    alvosFiltrados  = todosAlvos.filter(a => pendentes.has(String(a.compraId)));
    iniciarNovo     = false;
    log(`[raspar-lote] Retomando lote: ${alvosFiltrados.length} compra(s) pendente(s)`);
  } else if (args.apenas && args.apenas.length) {
    const set = new Set(args.apenas);
    alvosFiltrados = todosAlvos.filter(a => set.has(String(a.compraId)));
    log(`[raspar-lote] Filtro --apenas: ${alvosFiltrados.length} compra(s) selecionada(s)`);
  } else {
    log(`[raspar-lote] Lote completo: ${alvosFiltrados.length} compras`);
  }

  if (alvosFiltrados.length === 0) {
    console.error('[raspar-lote] Nenhuma compra a processar — saindo.');
    process.exit(0);
  }

  let browser;
  try {
    const conn = await conectarChrome();
    browser = conn.browser;
    let page = conn.page;

    // Força seleção da aba LOGADA (/seguro/fornecedor/) se existir.
    // O conectarChrome pode pegar comprasnet/intro/gov.br/compras (qualquer aba de "compras"),
    // mas o lote precisa da aba autenticada do SPA.
    const todasAbas = browser.contexts().flatMap(c => c.pages());
    const logada = todasAbas.find(p => p.url().includes('cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/seguro/'));
    if (logada && logada !== page) {
      log(`[raspar-lote] Trocando aba: ${page.url().slice(0, 60)} → ${logada.url().slice(0, 60)}`);
      page = logada;
    } else if (!logada) {
      log(`[raspar-lote] ⚠️ Nenhuma aba em /seguro/fornecedor/ aberta — o goto pode redirecionar pra login`);
    }

    const resultado = await executarLote({
      alvos:       alvosFiltrados,
      page,
      telegram,
      iniciarNovo,
    });

    if (resultado.pausado) {
      log(`[raspar-lote] Lote PAUSADO: ${resultado.motivo}`);
      log(`[raspar-lote] Use /retomar no Telegram (ou rode --retomar) após relogar.`);
      // Exit 0: pausa é estado esperado, não erro
      process.exit(0);
    }

    const e = resultado.estado;
    log(`[raspar-lote] CONCLUÍDO: ${e.compras_concluidas.length} sucesso(s), ${e.compras_falhas.length} falha(s)`);
    process.exit(0);
  } catch (err) {
    console.error('[raspar-lote] erro fatal:', err.message);
    process.exit(1);
  } finally {
    if (browser) {
      try { await browser.close(); } catch { /* ignore */ }
    }
  }
}

main();
