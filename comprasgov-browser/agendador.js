'use strict';

const cron = require('node-cron');
const fs   = require('fs');
const path = require('path');

const {
  gerarExcel,
  sleep,
  log,
} = require('./raspar-propostas-cdp');

const { lerMensagensChat, SEL_MSG } = require('./comprasgov');
const { compararSnapshots }         = require('./comparar-snapshots');
const loteEstado                    = require('./lote-estado');
const { executarLote }              = require('./lote-runner');

// ─── Configuração via .env ───────────────────────────────────────────────────

const CNPJS_RAFAEL = (process.env.CNPJ_RAFAEL || '').split(',').map(c => c.replace(/\D/g, '')).filter(c => c);
const HORA_SCRAPING = parseInt(process.env.HORA_SCRAPING || '7', 10);
const SNAPSHOTS_DIR = path.join(__dirname, 'dados', 'snapshots');

// ─── Estado interno ──────────────────────────────────────────────────────────

const mensagensVistas = new Map(); // compraId → Set<chave>

// Referências injetadas via init()
let _telegram;
let _getPage;
let _getPageSessao;
let _comprasAlvoPath;
let _bus = null;
let _isBusy = null; // () => bool: aba logada ocupada (lote/raspar/anexos em andamento)

// ─── Funções puras (exportadas para testes) ──────────────────────────────────

function gerarChaveMensagem(msg) {
  const txt = (msg.texto || '').slice(0, 50);
  return `${msg.remetente}|${msg.dataHora}|${txt}`;
}

function ehMensagemUrgente(texto, cnpjs) {
  if (!cnpjs || cnpjs.length === 0) return false;
  const txt = String(texto).toUpperCase();
  return cnpjs.some(cnpj => txt.includes(cnpj));
}

function buildDetalhes(compraId, mudancas, dataAnterior, dataAtual) {
  const linhas = [`📋 Detalhes — Compra ${compraId} (${dataAnterior} → ${dataAtual})\n`];

  for (const m of mudancas.statusMudou) {
    const emoji = m.statusAtual.toLowerCase().includes('adjudicada') ? '✅' : '🔄';
    linhas.push(`${emoji} Item ${m.item} | ${m.cnpj} | ${m.razaoSocial}`);
    linhas.push(`   ${m.statusAnterior} → ${m.statusAtual}`);
  }

  for (const m of mudancas.posicaoMudou) {
    const subiu = parseInt(m.posicaoAtual) < parseInt(m.posicaoAnterior);
    const dir = subiu ? '⬆️ subiu' : '⬇️ desceu';
    linhas.push(`${dir} Item ${m.item} | ${m.cnpj} | ${m.razaoSocial}`);
    linhas.push(`   Posição: ${m.posicaoAnterior}° → ${m.posicaoAtual}°`);
  }

  for (const m of mudancas.novosFornecedores) {
    linhas.push(`➕ Item ${m.item} | ${m.cnpj} | ${m.razaoSocial} | Pos ${m.posicao}°`);
  }

  for (const m of mudancas.removidos) {
    linhas.push(`➖ Item ${m.item} | ${m.cnpj} | ${m.razaoSocial} | Era pos ${m.posicaoAnterior}°`);
  }

  return linhas.join('\n');
}

// ─── Utilitários de data ─────────────────────────────────────────────────────

function hoje()  { return new Date().toISOString().slice(0, 10); }
function ontem() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function carregarAlvos() {
  return JSON.parse(fs.readFileSync(_comprasAlvoPath, 'utf8'));
}

// ─── Job 1: Scraping diário ──────────────────────────────────────────────────

async function jobScrapingDiario() {
  log('[agendador] Iniciando scraping diário...');

  const page = _getPage();
  if (!page) {
    await _telegram.enviar('⚠️ Chrome offline — scraping diário cancelado');
    return;
  }

  // Não pisa em lote pausado pendente — pede /retomar
  const estadoAnterior = loteEstado.obterEstado();
  if (estadoAnterior && estadoAnterior.status === loteEstado.STATUS.PAUSADO) {
    await _telegram.enviar(
      `⏸️ <b>Scraping diário NÃO iniciado</b> — há lote anterior pausado.\n` +
      `Compras pendentes: ${estadoAnterior.compras_pendentes.length}\n` +
      `Mande <code>/retomar</code> pra continuar ou apague <code>dados/lote-estado.json</code> pra começar novo.`
    );
    log('[agendador] Lote anterior pausado — abortando scraping diário.');
    return;
  }

  let alvos;
  try {
    alvos = carregarAlvos();
  } catch (err) {
    log(`[agendador] Erro ao ler compras-alvo.json: ${err.message}`);
    return;
  }
  if (_bus) _bus.emit('scraping_inicio', { total: alvos.length });

  // Delega o loop para o lote-runner compartilhado (mesma lógica do /retomar e do CLI)
  const resultado = await executarLote({
    alvos,
    page,
    telegram: _telegram,
    iniciarNovo: true,
  });

  // Para cada compra concluída, faz a comparação com o snapshot de ontem
  // e envia notificação + Excel das mudanças (comportamento original do agendador).
  const estadoFinal = loteEstado.obterEstado();
  const concluidas  = estadoFinal?.compras_concluidas ?? [];
  for (const compraId of concluidas) {
    try {
      const alvo = alvos.find(a => String(a.compraId) === String(compraId));
      const snapshotHojePath = path.join(SNAPSHOTS_DIR, `snapshot_${compraId}_${hoje()}.json`);
      if (!fs.existsSync(snapshotHojePath)) continue;
      const resultadosHoje = JSON.parse(fs.readFileSync(snapshotHojePath, 'utf8'));
      await _compararENotificar(compraId, resultadosHoje, alvo);
    } catch (err) {
      log(`[agendador] Erro na comparação de ${compraId}: ${err.message}`);
    }
  }

  if (_bus) {
    _bus.emit('scraping_fim', {
      pausado:    resultado.pausado,
      concluidas: concluidas.length,
      falhas:     estadoFinal?.compras_falhas?.length ?? 0,
    });
  }
  log(`[agendador] Scraping diário finalizado — pausado=${resultado.pausado}, concluidas=${concluidas.length}.`);
}

async function _compararENotificar(compraId, resultadosHoje, alvo) {
  const arquivoOntem = path.join(SNAPSHOTS_DIR, `snapshot_${compraId}_${ontem()}.json`);
  const arquivoHoje  = path.join(SNAPSHOTS_DIR, `snapshot_${compraId}_${hoje()}.json`);

  if (!fs.existsSync(arquivoOntem)) {
    log(`[agendador] Sem snapshot de ontem para ${compraId} — comparação pulada.`);
    return;
  }

  const anterior = JSON.parse(fs.readFileSync(arquivoOntem, 'utf8'));
  const atual    = JSON.parse(fs.readFileSync(arquivoHoje,  'utf8'));
  const mudancas = compararSnapshots(anterior, atual);

  if (mudancas.resumo.totalMudancas === 0) return;

  const resumo = {
    totalMudancas: mudancas.resumo.totalMudancas,
    adjudicadas:   mudancas.statusMudou.filter(m => m.statusAtual.toLowerCase().includes('adjudicada')).length,
    posicoes:      mudancas.posicaoMudou.length,
    novos:         mudancas.novosFornecedores.length,
    removidos:     mudancas.removidos.length,
  };

  const detalhes = buildDetalhes(compraId, mudancas, ontem(), hoje());
  await _telegram.notificarMudancas(compraId, resumo, detalhes);

  // Gera e envia Excel da raspagem do dia (só para compras com mudança)
  try {
    const xlsxPath = await gerarExcel(resultadosHoje, compraId);
    const tipoCompra = alvo?.tipo ? `${alvo.tipo} ${alvo.numero}` : compraId;
    const caption = `📎 <b>Raspagem ${hoje()}</b> — ${tipoCompra}\n${resumo.totalMudancas} mudança(s) detectada(s)`;
    await _telegram.enviarDocumento(xlsxPath, caption);
    log(`[agendador] Excel enviado via Telegram: ${path.basename(xlsxPath)}`);
  } catch (err) {
    log(`[agendador] Erro ao gerar/enviar Excel de ${compraId}: ${err.message}`);
  }

  if (_bus) _bus.emit('mudanca_detectada', { compraId, ...resumo });
}

// ─── Job 2: Polling mensagens do pregoeiro ───────────────────────────────────

async function jobMensagensPregoeiro() {
  // Não disputa a aba logada com lote/raspagem/anexos em andamento.
  if (_isBusy && _isBusy()) {
    log('[agendador] aba ocupada (lote/raspar/anexos) — polling de mensagens adiado.');
    return;
  }

  if (!SEL_MSG.urlChat) {
    log('[agendador] SEL_MSG não configurado — polling de mensagens pulado.');
    return;
  }

  const pageSessao = _getPageSessao();
  if (!pageSessao) {
    log('[agendador] sem página logada — polling de mensagens pulado.');
    return;
  }

  let alvos;
  try { alvos = carregarAlvos(); } catch { return; }

  for (const alvo of alvos) {
    const { compraId, uasg, numero } = alvo;
    try {
      const { mensagens } = await lerMensagensChat(pageSessao, compraId);

      let isFirstRun = false;
      if (!mensagensVistas.has(compraId)) {
        mensagensVistas.set(compraId, new Set());
        isFirstRun = true; // Se é a primeira vez rodando, não vamos espamar o Telegram
      }
      const vistas = mensagensVistas.get(compraId);

      for (const msg of mensagens) {
        const chave = gerarChaveMensagem(msg);
        if (vistas.has(chave)) continue;
        vistas.add(chave);

        // Só notifica se NÃO for a primeira rodada (assim pegamos apenas mensagens realmente NOVAS)
        if (!isFirstRun) {
          const urgente = ehMensagemUrgente(msg.texto, CNPJS_RAFAEL);
          await _telegram.notificarPregoeiro(compraId, uasg, msg.item || '?', msg.texto, urgente);
          if (_bus) _bus.emit('mensagem_pregoeiro', { compraId, uasg, item: msg.item || '?', texto: msg.texto, urgente });
        }
      }
    } catch (err) {
      log(`[agendador] Erro ao ler mensagens de ${compraId}: ${err.message}`);
    }
  }
}

// ─── Inicialização ───────────────────────────────────────────────────────────

function init({ telegram, getPage, getPageSessao, comprasAlvoPath, bus, isBusy }) {
  _telegram        = telegram;
  _getPage         = getPage;
  _getPageSessao   = getPageSessao;
  _comprasAlvoPath = comprasAlvoPath;
  _bus             = bus || null;
  _isBusy          = isBusy || null;

  // Job 1: scraping diário
  cron.schedule(`0 ${HORA_SCRAPING} * * *`, jobScrapingDiario, {
    timezone: 'America/Sao_Paulo',
  });

  // Job 2: polling mensagens (a cada 5 min, seg-sex 08h-18h)
  cron.schedule('*/5 8-18 * * 1-5', jobMensagensPregoeiro, {
    timezone: 'America/Sao_Paulo',
  });

  // Reset de mensagens vistas às 08h de dias úteis
  cron.schedule('0 8 * * 1-5', () => {
    mensagensVistas.clear();
    log('[agendador] mensagensVistas resetado para o novo dia.');
  }, { timezone: 'America/Sao_Paulo' });

  log(`[agendador] Jobs registrados:`);
  log(`  • Scraping diário: ${HORA_SCRAPING}h`);
  log(`  • Polling mensagens: a cada 5min (08h-18h, seg-sex)`);
}

module.exports = {
  init,
  buildDetalhes,
  gerarChaveMensagem,
  ehMensagemUrgente,
  // exposto para testes de integração
  jobScrapingDiario,
  jobMensagensPregoeiro,
};
