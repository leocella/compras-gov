'use strict';

const https = require('https');

let _token  = '';
let _chatId = [];
let _polling = false;
let _ultimoUpdateId = 0;
const _detalhesMap = new Map();

// Permite monkey-patch nos testes
let _enviarFn = null;

function init(token, chatId) {
  if (!token)  throw new Error('[telegram] TELEGRAM_TOKEN não definido no .env');
  if (!chatId) throw new Error('[telegram] TELEGRAM_CHAT_ID não definido no .env');
  _token  = token;
  _chatId = String(chatId).split(',').map(id => id.trim()).filter(id => id);
}

function _setEnviarFn(fn) { _enviarFn = fn; }

function _post(metodo, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req  = https.request({
      hostname: 'api.telegram.org',
      path:     `/bot${_token}/${metodo}`,
      method:   'POST',
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let raw = '';
      res.on('data', c => { raw += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch { resolve({ ok: false, raw }); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function _get(metodo, query = '') {
  return new Promise((resolve, reject) => {
    const req = https.get(
      `https://api.telegram.org/bot${_token}/${metodo}${query}`,
      (res) => {
        let raw = '';
        res.on('data', c => { raw += c; });
        res.on('end', () => {
          try { resolve(JSON.parse(raw)); }
          catch { resolve({ ok: false, raw }); }
        });
      }
    );
    req.on('error', reject);
  });
}

async function enviar(texto) {
  if (!_token) throw new Error('[telegram] Não inicializado — chame init() primeiro');
  if (_enviarFn) return _enviarFn(texto);
  
  for (const id of _chatId) {
    const r = await _post('sendMessage', {
      chat_id:    id,
      text:       texto,
      parse_mode: 'HTML',
    });
    if (!r.ok) console.error(`[telegram] Falha ao enviar para ${id}:`, JSON.stringify(r).slice(0, 200));
  }
}

function _gerarChave() {
  return Math.random().toString(16).slice(2, 6).toUpperCase().padStart(4, '0');
}

async function notificarMudancas(compraId, resumo, detalhes) {
  const chave = _gerarChave();
  _detalhesMap.set(chave, detalhes);

  const partes = [];
  if (resumo.adjudicadas) partes.push(`• ${resumo.adjudicadas} adjudicada(s)`);
  if (resumo.posicoes)    partes.push(`• ${resumo.posicoes} posição(ões) alterada(s)`);
  if (resumo.novos)       partes.push(`• ${resumo.novos} novo(s) fornecedor(es)`);
  if (resumo.removidos)   partes.push(`• ${resumo.removidos} removido(s)`);

  const texto = [
    `📊 <b>Compra ${compraId}</b>`,
    `${resumo.totalMudancas} mudança(s) detectada(s)`,
    partes.join('  '),
    ``,
    `Digite <code>${chave}</code> para ver detalhes`,
  ].join('\n');

  await enviar(texto);
}

async function notificarPregoeiro(compraId, uasg, numItem, texto, urgente = false) {
  if (urgente) {
    const limite = new Date();
    limite.setMinutes(limite.getMinutes() + 2);
    const hhmm = limite.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    await enviar([
      `🚨 <b>CHAMADA DIRETA — 2 MIN PARA RESPONDER</b>`,
      `Compra ${compraId} / Item ${numItem}`,
      ``,
      texto,
      ``,
      `⏰ Responda até: ${hhmm}`,
    ].join('\n'));

    setTimeout(async () => {
      try {
        await enviar(`⚠️ 30 segundos restantes! Compra ${compraId} / Item ${numItem}`);
      } catch (e) {
        console.error('[telegram] Erro no lembrete urgente:', e.message);
      }
    }, 90_000);

  } else {
    await enviar([
      `💬 <b>Pregoeiro</b> — Compra ${compraId} / Item ${numItem}`,
      ``,
      texto,
    ].join('\n'));
  }
}

async function _responderChave(chave) {
  if (!_detalhesMap.has(chave)) return null;
  const detalhe = _detalhesMap.get(chave);
  _detalhesMap.delete(chave);
  return detalhe;
}

async function iniciarPolling() {
  if (_polling) return;
  _polling = true;
  console.log('[telegram] Iniciando long-polling...');

  const loop = async () => {
    while (_polling) {
      try {
        const r = await _get('getUpdates', `?timeout=25&offset=${_ultimoUpdateId + 1}`);
        if (r.ok && r.result && r.result.length > 0) {
          for (const update of r.result) {
            _ultimoUpdateId = update.update_id;
            const msg = update.message || update.channel_post;
            if (!msg || !msg.text) continue;

            const chave = msg.text.trim().toUpperCase();
            const detalhe = await _responderChave(chave);
            if (detalhe) {
              await enviar(detalhe);
            }
          }
        }
      } catch (err) {
        console.error('[telegram] Erro no polling:', err.message);
        await new Promise(r => setTimeout(r, 5_000));
      }
    }
  };

  loop().catch(err => console.error('[telegram] Loop encerrado:', err.message));
}

function pararPolling() { _polling = false; }

module.exports = {
  init,
  enviar,
  notificarMudancas,
  notificarPregoeiro,
  iniciarPolling,
  pararPolling,
  // internos expostos para testes
  _setEnviarFn,
  _responderChave,
};
