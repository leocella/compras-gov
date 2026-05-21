'use strict';

const https = require('https');
const fs    = require('fs');
const path  = require('path');

let _token  = '';
let _chatId = [];
let _polling = false;
let _ultimoUpdateId = 0;
const _detalhesMap = new Map();

// Mapeia message_id de notificação do pregoeiro -> contexto da compra,
// para que respostas via reply-to-message saibam para qual pregão enviar.
// LRU simples: limitado a MAX_CONTEXTO entradas.
const _pregoeiroContexto = new Map();
const MAX_CONTEXTO = 200;

// Mapeia callbackId (8 chars) -> {compraId, uasg, item, texto, previewMsgId},
// usado pelo fluxo de confirmação com inline keyboard.
const _pendentesConfirmacao = new Map();

// Novo fluxo: Map<callbackId, { compraId, uasg, item, texto, chatId,
//   etapa1MsgId, etapa2MsgId, preenchidoEm, lastMessageSig, timeoutId }>
const _preenchidosPendentes = new Map();

// Caminho do arquivo de persistência (configurável p/ testes)
let _preenchidosFile = path.join(__dirname, 'dados', 'preenchidos-pendentes.json');
function _setPreenchidosFile(p) { _preenchidosFile = p; }

function _persistirPreenchidos() {
  const obj = {};
  for (const [k, v] of _preenchidosPendentes.entries()) {
    const { timeoutId, ...semHandle } = v;
    obj[k] = semHandle;
  }
  try {
    fs.mkdirSync(path.dirname(_preenchidosFile), { recursive: true });
    fs.writeFileSync(_preenchidosFile, JSON.stringify(obj, null, 2), 'utf8');
  } catch (e) {
    console.error('[telegram] falha ao persistir preenchidos:', e.message);
  }
}

function _carregarPreenchidos() {
  if (!fs.existsSync(_preenchidosFile)) return {};
  try {
    return JSON.parse(fs.readFileSync(_preenchidosFile, 'utf8'));
  } catch (e) {
    console.error('[telegram] preenchidos-pendentes.json corrompido:', e.message);
    return {};
  }
}

// Callback injetado pelo server.js para executar o envio ao pregoeiro
// quando o usuário confirma via Telegram. Recebe (ctx, texto) e
// retorna o resultado da chamada a responderMensagem.
let _onResponderPregoeiro = null;

// Callback injetado pelo server.js para retomar lote pausado.
// Recebe (chatId) opcionalmente e retorna string (mensagem para o user).
let _onRetomar = null;

// Callbacks do novo fluxo de dupla confirmação
let _onPreencher          = null;
let _onEnviarPreenchido   = null;
let _onLimparCampo        = null;
function setPreencherCallback(fn)          { _onPreencher = fn; }
function setEnviarPreenchidoCallback(fn)   { _onEnviarPreenchido = fn; }
function setLimparCampoCallback(fn)        { _onLimparCampo = fn; }
function _getPreencherCallback()           { return _onPreencher; }
function _getEnviarPreenchidoCallback()    { return _onEnviarPreenchido; }
function _getLimparCampoCallback()         { return _onLimparCampo; }

// Permite monkey-patch nos testes
let _enviarFn = null;
let _postFn   = null;
function _setPostFn(fn) { _postFn = fn; }

function init(token, chatId) {
  if (!token)  throw new Error('[telegram] TELEGRAM_TOKEN não definido no .env');
  if (!chatId) throw new Error('[telegram] TELEGRAM_CHAT_ID não definido no .env');
  _token  = token;
  _chatId = String(chatId).split(',').map(id => id.trim()).filter(id => id);
}

function _setEnviarFn(fn) { _enviarFn = fn; }

function setResponderCallback(fn) { _onResponderPregoeiro = fn; }
function setRetomarCallback(fn)   { _onRetomar = fn; }

function _registrarContextoPregoeiro(messageId, ctx) {
  if (!messageId) return;
  if (_pregoeiroContexto.size >= MAX_CONTEXTO) {
    const primeira = _pregoeiroContexto.keys().next().value;
    _pregoeiroContexto.delete(primeira);
  }
  _pregoeiroContexto.set(messageId, ctx);
}

function _post(metodo, payload) {
  if (_postFn) return _postFn(metodo, payload);
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

async function enviar(texto, opts = {}) {
  if (!_token) throw new Error('[telegram] Não inicializado — chame init() primeiro');
  if (_enviarFn) return _enviarFn(texto, opts);

  let primeiroMessageId = null;

  for (const id of _chatId) {
    const payload = {
      chat_id:    id,
      text:       texto,
      parse_mode: 'HTML',
    };
    if (opts.reply_markup) payload.reply_markup = opts.reply_markup;

    const r = await _post('sendMessage', payload);
    if (!r.ok) {
      console.error(`[telegram] Falha ao enviar para ${id}:`, JSON.stringify(r).slice(0, 200));
    } else if (primeiroMessageId === null) {
      primeiroMessageId = r.result?.message_id ?? null;
    }
  }

  return primeiroMessageId;
}

function _gerarChave() {
  return Math.random().toString(16).slice(2, 6).toUpperCase().padStart(4, '0');
}

// ─── Upload de documento (sendDocument, multipart/form-data) ────────────────
function _postMultipart(metodo, chatId, filePath, caption) {
  return new Promise((resolve, reject) => {
    const fileBuf  = fs.readFileSync(filePath);
    const fileName = path.basename(filePath);
    const boundary = '----comprasgov' + Date.now().toString(36);
    const CRLF     = '\r\n';

    const head1 =
      `--${boundary}${CRLF}` +
      `Content-Disposition: form-data; name="chat_id"${CRLF}${CRLF}` +
      `${chatId}${CRLF}`;

    const headCaption = caption ? (
      `--${boundary}${CRLF}` +
      `Content-Disposition: form-data; name="caption"${CRLF}${CRLF}` +
      `${caption}${CRLF}` +
      `--${boundary}${CRLF}` +
      `Content-Disposition: form-data; name="parse_mode"${CRLF}${CRLF}` +
      `HTML${CRLF}`
    ) : '';

    const headFile =
      `--${boundary}${CRLF}` +
      `Content-Disposition: form-data; name="document"; filename="${fileName}"${CRLF}` +
      `Content-Type: application/octet-stream${CRLF}${CRLF}`;

    const tail = `${CRLF}--${boundary}--${CRLF}`;

    const body = Buffer.concat([
      Buffer.from(head1, 'utf8'),
      Buffer.from(headCaption, 'utf8'),
      Buffer.from(headFile, 'utf8'),
      fileBuf,
      Buffer.from(tail, 'utf8'),
    ]);

    const req = https.request({
      hostname: 'api.telegram.org',
      path:     `/bot${_token}/${metodo}`,
      method:   'POST',
      headers: {
        'Content-Type':   `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
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

// _postPhoto — envia Buffer PNG via sendPhoto (multipart manual).
// Diferente de _postMultipart, NÃO lê do disco — recebe o Buffer pronto.
function _postPhoto(chatId, buffer, caption) {
  return new Promise((resolve, reject) => {
    const boundary = '----comprasgov_' + Date.now().toString(16);
    const head = (name, extra = '') =>
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"${extra}\r\n\r\n`;

    const parts = [];
    parts.push(Buffer.from(head('chat_id') + String(chatId) + '\r\n'));
    if (caption) {
      parts.push(Buffer.from(head('caption') + caption + '\r\n'));
      parts.push(Buffer.from(head('parse_mode') + 'HTML' + '\r\n'));
    }
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="chat.png"\r\n` +
      `Content-Type: image/png\r\n\r\n`
    ));
    parts.push(buffer);
    parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));

    const body = Buffer.concat(parts);
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${_token}/sendPhoto`,
      method: 'POST',
      headers: {
        'Content-Type':   `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
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

async function enviarDocumento(filePath, caption) {
  if (!_token) throw new Error('[telegram] Não inicializado — chame init() primeiro');
  if (!fs.existsSync(filePath)) throw new Error(`Arquivo não encontrado: ${filePath}`);

  let primeiroMessageId = null;
  for (const id of _chatId) {
    const r = await _postMultipart('sendDocument', id, filePath, caption);
    if (!r.ok) {
      console.error(`[telegram] Falha sendDocument para ${id}:`, JSON.stringify(r).slice(0, 200));
    } else if (primeiroMessageId === null) {
      primeiroMessageId = r.result?.message_id ?? null;
    }
  }
  return primeiroMessageId;
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

async function notificarSessaoExpirada(motivo, comprasPendentes = []) {
  const hhmm = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const linhas = [
    `🔒 <b>Sessão expirou</b> às ${hhmm}`,
    `Motivo: ${motivo || 'não especificado'}`,
    `Compras pendentes: <b>${comprasPendentes.length}</b>`,
  ];
  if (comprasPendentes.length) {
    const amostra = comprasPendentes.slice(0, 10).map(id => `• ${id}`).join('\n');
    linhas.push('', amostra);
    if (comprasPendentes.length > 10) linhas.push(`<i>… e mais ${comprasPendentes.length - 10}</i>`);
  }
  linhas.push(
    '',
    '<b>Como retomar:</b>',
    '1. Acesse a VPS via VNC',
    '2. Refaça login no Chrome (resolva CAPTCHA)',
    '3. Mande <code>/retomar</code> aqui',
  );
  return enviar(linhas.join('\n'));
}

async function notificarPregoeiro(compraId, uasg, numItem, texto, urgente = false) {
  let messageId;

  if (urgente) {
    const limite = new Date();
    limite.setMinutes(limite.getMinutes() + 2);
    const hhmm = limite.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    messageId = await enviar([
      `🚨 <b>CHAMADA DIRETA — 2 MIN PARA RESPONDER</b>`,
      `Compra ${compraId} / Item ${numItem}`,
      ``,
      texto,
      ``,
      `⏰ Responda até: ${hhmm}`,
      ``,
      `<i>Responda essa mensagem com o texto da resposta para enviar ao pregoeiro.</i>`,
    ].join('\n'));

    setTimeout(async () => {
      try {
        await enviar(`⚠️ 30 segundos restantes! Compra ${compraId} / Item ${numItem}`);
      } catch (e) {
        console.error('[telegram] Erro no lembrete urgente:', e.message);
      }
    }, 90_000);

  } else {
    messageId = await enviar([
      `💬 <b>Pregoeiro</b> — Compra ${compraId} / Item ${numItem}`,
      ``,
      texto,
      ``,
      `<i>Responda essa mensagem para enviar resposta ao pregoeiro.</i>`,
    ].join('\n'));
  }

  _registrarContextoPregoeiro(messageId, { compraId, uasg, item: numItem });
}

async function _responderChave(chave) {
  if (!_detalhesMap.has(chave)) return null;
  const detalhe = _detalhesMap.get(chave);
  _detalhesMap.delete(chave);
  return detalhe;
}

function _gerarCallbackId() {
  // 8 chars hex, suficiente para evitar colisão dentro da janela de pendentes
  return Math.random().toString(16).slice(2, 10).padStart(8, '0').toUpperCase();
}

function _formatarPreview(ctx, texto) {
  const dryRun = process.env.TELEGRAM_RESPONDER_DRY_RUN === 'true';
  const modoTag = dryRun
    ? '🧪 <b>MODO TESTE (dry-run)</b> — só escreve no form, você clica enviar via VNC'
    : '⚠️ <b>MODO AUTO</b> — confirmando, será enviado direto ao pregoeiro';

  return [
    `📝 <b>Confirmar envio?</b>`,
    modoTag,
    ``,
    `Para: Compra ${ctx.compraId} / Item ${ctx.item}`,
    `Texto: ${texto}`,
  ].join('\n');
}

async function _editarMensagem(chatId, messageId, novoTexto) {
  if (!chatId || !messageId) return;
  await _post('editMessageText', {
    chat_id:    chatId,
    message_id: messageId,
    text:       novoTexto,
    parse_mode: 'HTML',
  });
}

async function _solicitarConfirmacao(ctx, texto, chatId) {
  const callbackId = _gerarCallbackId();
  _pendentesConfirmacao.set(callbackId, { ...ctx, texto, previewMsgId: null, chatId });

  const r = await _post('sendMessage', {
    chat_id:    chatId,
    text:       _formatarPreview(ctx, texto),
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [[
        { text: '✅ Confirmar', callback_data: `c:${callbackId}` },
        { text: '❌ Cancelar',  callback_data: `x:${callbackId}` },
      ]],
    },
  });

  if (r.ok) {
    const pendente = _pendentesConfirmacao.get(callbackId);
    if (pendente) pendente.previewMsgId = r.result.message_id;
  } else {
    _pendentesConfirmacao.delete(callbackId);
    console.error('[telegram] Falha ao enviar preview:', JSON.stringify(r).slice(0, 200));
  }
}

// Etapa 1 do fluxo de dupla confirmação: envia preview do texto com botão
// "✏️ Preencher no chat". Quando confirmado, _processarPreencher digita no
// form do portal (sem enviar) e dispara a etapa 2 com screenshot.
async function _solicitarPreenchimento(ctx, texto, chatId) {
  const callbackId = _gerarCallbackId();
  _preenchidosPendentes.set(callbackId, {
    compraId: ctx.compraId, uasg: ctx.uasg, item: ctx.item,
    texto, chatId,
    etapa1MsgId: null, etapa2MsgId: null,
    preenchidoEm: null, lastMessageSig: null,
    timeoutId: null,
  });

  const r = await _post('sendMessage', {
    chat_id: chatId,
    text: [
      `📝 <b>Texto a enviar</b>`,
      `Compra ${ctx.compraId} / Item ${ctx.item}`,
      ``,
      `<i>${texto}</i>`,
    ].join('\n'),
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [[
        { text: '✏️ Preencher no chat', callback_data: `p:${callbackId}` },
        { text: '❌ Cancelar',           callback_data: `x:${callbackId}` },
      ]],
    },
  });

  if (r.ok) {
    const p = _preenchidosPendentes.get(callbackId);
    if (p) p.etapa1MsgId = r.result.message_id;
    _persistirPreenchidos();
  } else {
    _preenchidosPendentes.delete(callbackId);
    console.error('[telegram] Falha na etapa 1:', JSON.stringify(r).slice(0, 200));
  }
}

async function _processarCallbackQuery(cb) {
  const data = cb.data || '';
  const sep  = data.indexOf(':');
  if (sep < 0) {
    await _post('answerCallbackQuery', { callback_query_id: cb.id });
    return;
  }
  const acao       = data.slice(0, sep);
  const callbackId = data.slice(sep + 1);

  const pendente = _pendentesConfirmacao.get(callbackId);
  if (!pendente) {
    await _post('answerCallbackQuery', { callback_query_id: cb.id, text: 'Pedido expirou' });
    return;
  }
  _pendentesConfirmacao.delete(callbackId);

  const chatId    = cb.message?.chat?.id ?? pendente.chatId;
  const previewId = pendente.previewMsgId;

  if (acao === 'x') {
    await _editarMensagem(chatId, previewId, '❌ Cancelado');
    await _post('answerCallbackQuery', { callback_query_id: cb.id });
    return;
  }

  if (acao !== 'c') {
    await _post('answerCallbackQuery', { callback_query_id: cb.id });
    return;
  }

  await _post('answerCallbackQuery', { callback_query_id: cb.id, text: 'Enviando...' });

  if (!_onResponderPregoeiro) {
    await _editarMensagem(chatId, previewId, '❌ Erro: callback de envio não configurado');
    return;
  }

  try {
    const resultado = await _onResponderPregoeiro(
      { compraId: pendente.compraId, uasg: pendente.uasg, item: pendente.item },
      pendente.texto,
    );
    const hhmm = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const modo = resultado?.modo === 'dry-run'
      ? `✅ Preenchido (dry-run) às ${hhmm} — revise e envie via VNC`
      : `✅ Enviado às ${hhmm}`;
    await _editarMensagem(chatId, previewId, modo);
  } catch (err) {
    console.error('[telegram] Erro ao executar envio:', err.message);
    await _editarMensagem(chatId, previewId, `❌ Erro: ${err.message}`);
  }
}

async function _processarSlashRetomar(chatId) {
  if (!_onRetomar) {
    await _post('sendMessage', {
      chat_id: chatId,
      text:    '❌ /retomar não configurado neste servidor',
    });
    return;
  }
  try {
    const resposta = await _onRetomar(chatId);
    await _post('sendMessage', {
      chat_id:    chatId,
      text:       resposta || '(sem resposta do callback)',
      parse_mode: 'HTML',
    });
  } catch (err) {
    console.error('[telegram] erro no /retomar:', err.message);
    await _post('sendMessage', {
      chat_id: chatId,
      text:    `❌ Erro ao retomar: ${err.message}`,
    });
  }
}

async function _processarSlashResponder(texto, chatId) {
  const m = texto.match(/^\/responder\s+(\S+)\s+([\s\S]+)$/);
  if (!m) {
    await _post('sendMessage', {
      chat_id: chatId,
      text:    'Uso: /responder <compraId> <texto>',
    });
    return;
  }
  const [, compraId, respTexto] = m;
  await _solicitarConfirmacao(
    { compraId, uasg: '?', item: '?' },
    respTexto.trim(),
    chatId,
  );
}

async function iniciarPolling() {
  if (_polling) return;
  _polling = true;
  console.log('[telegram] Iniciando long-polling...');

  const loop = async () => {
    while (_polling) {
      try {
        const r = await _get('getUpdates', `?timeout=25&offset=${_ultimoUpdateId + 1}&allowed_updates=${encodeURIComponent('["message","callback_query","channel_post"]')}`);
        if (r.ok && r.result && r.result.length > 0) {
          for (const update of r.result) {
            _ultimoUpdateId = update.update_id;

            // 1) Botão inline pressionado (confirmar/cancelar)
            if (update.callback_query) {
              await _processarCallbackQuery(update.callback_query);
              continue;
            }

            const msg = update.message || update.channel_post;
            if (!msg || !msg.text) continue;

            const texto = msg.text.trim();
            const chatId = msg.chat?.id;

            // 2) Slash command /responder <compraId> <texto>
            if (texto.startsWith('/responder ') || texto === '/responder') {
              await _processarSlashResponder(texto, chatId);
              continue;
            }

            // 2b) Slash command /retomar (sem args) — retoma lote pausado
            if (texto === '/retomar' || texto.startsWith('/retomar ')) {
              await _processarSlashRetomar(chatId);
              continue;
            }

            // 3) Reply em mensagem do bot (notificação de pregoeiro)
            const replyId = msg.reply_to_message?.message_id;
            if (replyId && _pregoeiroContexto.has(replyId)) {
              const ctx = _pregoeiroContexto.get(replyId);
              await _solicitarConfirmacao(ctx, texto, chatId);
              continue;
            }

            // 4) Chave de detalhe (comportamento existente)
            const chave = texto.toUpperCase();
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
  enviarDocumento,
  notificarMudancas,
  notificarPregoeiro,
  notificarSessaoExpirada,
  iniciarPolling,
  pararPolling,
  setResponderCallback,
  setRetomarCallback,
  setPreencherCallback,
  setEnviarPreenchidoCallback,
  setLimparCampoCallback,
  // internos expostos para testes
  _getPreencherCallback,
  _getEnviarPreenchidoCallback,
  _getLimparCampoCallback,
  _setPostFn,
  _solicitarPreenchimento,
  _setEnviarFn,
  _responderChave,
  _registrarContextoPregoeiro,
  _processarSlashResponder,
  _processarSlashRetomar,
  _processarCallbackQuery,
  _solicitarConfirmacao,
  _formatarPreview,
  _gerarCallbackId,
  _pregoeiroContexto,
  _pendentesConfirmacao,
  _preenchidosPendentes,
  _setPreenchidosFile,
  _persistirPreenchidos,
  _carregarPreenchidos,
};
