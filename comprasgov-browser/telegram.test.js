'use strict';

const { test } = require('node:test');
const assert   = require('node:assert');

// Isolar o módulo para cada teste (evitar estado compartilhado)
function loadFresh() {
  delete require.cache[require.resolve('./telegram')];
  return require('./telegram');
}

test('init lança erro se token ausente', () => {
  const t = loadFresh();
  assert.throws(() => t.init('', '123'), /TELEGRAM_TOKEN/);
});

test('init lança erro se chatId ausente', () => {
  const t = loadFresh();
  assert.throws(() => t.init('tok', ''), /TELEGRAM_CHAT_ID/);
});

test('init não lança se token e chatId presentes', () => {
  const t = loadFresh();
  assert.doesNotThrow(() => t.init('tok:abc', '999'));
});

test('notificarMudancas gera chave de 4 chars e armazena detalhes', async () => {
  const t = loadFresh();
  t.init('tok:abc', '999');

  const enviados = [];
  // Monkey-patch enviar para não fazer HTTP real
  t._setEnviarFn((txt) => { enviados.push(txt); return Promise.resolve(); });

  await t.notificarMudancas('COMPRA123', {
    totalMudancas: 2,
    adjudicadas: 1,
    posicoes: 1,
    novos: 0,
    removidos: 0,
  }, 'Detalhe completo aqui');

  assert.strictEqual(enviados.length, 1);
  // A mensagem deve conter uma chave de 4 chars hex maiúsculos
  const match = enviados[0].match(/<code>([0-9A-F]{4})<\/code>/);
  assert.ok(match, 'Chave de 4 chars não encontrada na mensagem');

  // Simular Rafael respondendo com a chave
  const chave = match[1];
  const detalhe = await t._responderChave(chave);
  assert.strictEqual(detalhe, 'Detalhe completo aqui');
});

test('_responderChave retorna null para chave inexistente', async () => {
  const t = loadFresh();
  t.init('tok:abc', '999');
  const r = await t._responderChave('XXXX');
  assert.strictEqual(r, null);
});

// ─── Responder pregoeiro via Telegram ────────────────────────────────────────

test('_gerarCallbackId produz 8 chars hex maiúsculos', () => {
  const t = loadFresh();
  for (let i = 0; i < 50; i++) {
    const id = t._gerarCallbackId();
    assert.match(id, /^[0-9A-F]{8}$/, `id "${id}" não é 8 hex maiúsculo`);
  }
});

test('_formatarPreview inclui MODO TESTE em dry-run', () => {
  const t = loadFresh();
  process.env.TELEGRAM_RESPONDER_DRY_RUN = 'true';
  const ctx = { compraId: '12345', uasg: '158383', item: '7' };
  const preview = t._formatarPreview(ctx, 'minha resposta');
  assert.ok(preview.includes('MODO TESTE'), 'tag de dry-run ausente');
  assert.ok(preview.includes('12345'), 'compraId ausente');
  assert.ok(preview.includes('7'), 'item ausente');
  assert.ok(preview.includes('minha resposta'), 'texto ausente');
});

test('_formatarPreview inclui MODO AUTO quando dry-run desligado', () => {
  const t = loadFresh();
  process.env.TELEGRAM_RESPONDER_DRY_RUN = 'false';
  const ctx = { compraId: 'C1', uasg: 'U1', item: '3' };
  const preview = t._formatarPreview(ctx, 'texto');
  assert.ok(preview.includes('MODO AUTO'), 'tag de auto ausente');
  assert.ok(!preview.includes('MODO TESTE'), 'não deveria ter tag de teste');
});

test('_registrarContextoPregoeiro armazena e respeita limite LRU', () => {
  const t = loadFresh();
  // Limpa estado entre testes (módulo recarregado, mapa vazio)
  for (let i = 0; i < 250; i++) {
    t._registrarContextoPregoeiro(i, { compraId: `C${i}`, uasg: 'U', item: String(i) });
  }
  // Limite é 200 — primeiras 50 entradas (0..49) devem ter sido despejadas
  assert.strictEqual(t._pregoeiroContexto.size, 200);
  assert.ok(!t._pregoeiroContexto.has(0), 'entrada antiga deveria ter sido despejada');
  assert.ok(!t._pregoeiroContexto.has(49), 'entrada antiga deveria ter sido despejada');
  assert.ok(t._pregoeiroContexto.has(50), 'entrada 50 deveria estar presente');
  assert.ok(t._pregoeiroContexto.has(249), 'última entrada deveria estar presente');
});

test('_registrarContextoPregoeiro ignora messageId nulo', () => {
  const t = loadFresh();
  const sizeAntes = t._pregoeiroContexto.size;
  t._registrarContextoPregoeiro(null, { compraId: 'X' });
  t._registrarContextoPregoeiro(undefined, { compraId: 'X' });
  assert.strictEqual(t._pregoeiroContexto.size, sizeAntes);
});

test('notificarPregoeiro registra contexto após enviar', async () => {
  const t = loadFresh();
  t.init('tok:abc', '999');

  // Mock que simula retorno do message_id da API Telegram
  let mockMessageId = 9001;
  t._setEnviarFn(() => Promise.resolve(mockMessageId++));

  await t.notificarPregoeiro('COMPRA-X', '158383', '5', 'Pergunta do pregoeiro', false);

  assert.ok(t._pregoeiroContexto.has(9001), 'contexto não foi registrado para o message_id retornado');
  const ctx = t._pregoeiroContexto.get(9001);
  assert.deepStrictEqual(ctx, { compraId: 'COMPRA-X', uasg: '158383', item: '5' });
});

test('setResponderCallback armazena a função para uso futuro', () => {
  const t = loadFresh();
  let chamado = false;
  t.setResponderCallback(() => { chamado = true; });
  // Apenas verificar que não lança erro — execução real é via callback_query
  assert.strictEqual(chamado, false, 'callback não deve ser invocado só pelo setter');
});

test('_persistirPreenchidos grava o Map sem timeoutId', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const t = loadFresh();
  t.init('tok:abc', '999');

  const tmpFile = path.join(require('node:os').tmpdir(), `preench-${Date.now()}.json`);
  t._setPreenchidosFile(tmpFile);

  t._preenchidosPendentes.set('AAA', {
    compraId: 'C1', item: '11', texto: 'olá',
    timeoutId: setTimeout(()=>{}, 60_000),
    lastMessageSig: 'abc',
  });
  t._persistirPreenchidos();
  const conteudo = JSON.parse(fs.readFileSync(tmpFile, 'utf8'));
  assert.strictEqual(conteudo.AAA.compraId, 'C1');
  assert.strictEqual(conteudo.AAA.texto, 'olá');
  assert.strictEqual(conteudo.AAA.timeoutId, undefined);

  // cleanup
  clearTimeout(t._preenchidosPendentes.get('AAA').timeoutId);
  fs.unlinkSync(tmpFile);
});

test('_carregarPreenchidos lê e devolve objeto vazio se arquivo não existe', () => {
  const path = require('node:path');
  const t = loadFresh();
  t.init('tok:abc', '999');
  t._setPreenchidosFile(path.join(require('node:os').tmpdir(), `inexistente-${Date.now()}.json`));
  const r = t._carregarPreenchidos();
  assert.deepStrictEqual(r, {});
});

test('setters armazenam callbacks dos 3 estágios', () => {
  const t = loadFresh();
  const f1 = () => {}, f2 = () => {}, f3 = () => {};
  t.setPreencherCallback(f1);
  t.setEnviarPreenchidoCallback(f2);
  t.setLimparCampoCallback(f3);
  assert.strictEqual(t._getPreencherCallback(), f1);
  assert.strictEqual(t._getEnviarPreenchidoCallback(), f2);
  assert.strictEqual(t._getLimparCampoCallback(), f3);
});

test('_solicitarPreenchimento cria entrada em _preenchidosPendentes e envia msg etapa 1', async () => {
  const path = require('node:path');
  const t = loadFresh();
  t.init('tok:abc', '999');
  t._setPreenchidosFile(path.join(require('node:os').tmpdir(), `pp-${Date.now()}.json`));

  const posts = [];
  t._setPostFn(async (metodo, payload) => {
    posts.push({ metodo, payload });
    return { ok: true, result: { message_id: 42 } };
  });

  await t._solicitarPreenchimento({ compraId: 'C1', uasg: 'U1', item: '11' }, 'texto', 999);

  assert.strictEqual(posts.length, 1);
  assert.strictEqual(posts[0].metodo, 'sendMessage');
  assert.ok(posts[0].payload.reply_markup.inline_keyboard[0][0].callback_data.startsWith('p:'));
  assert.strictEqual(t._preenchidosPendentes.size, 1);
});

test('_processarPreencher chama _onPreencher e envia screenshot via _postPhoto', async () => {
  const path = require('node:path');
  const t = loadFresh();
  t.init('tok:abc', '999');
  t._setPreenchidosFile(path.join(require('node:os').tmpdir(), `pp-${Date.now()}.json`));

  t._setPostFn(async () => ({ ok: true, result: { message_id: 1 } }));
  await t._solicitarPreenchimento({ compraId: 'C1', uasg: 'U1', item: '11' }, 'olá', 999);
  const cbId = [...t._preenchidosPendentes.keys()][0];

  t.setPreencherCallback(async (ctx, texto) => {
    assert.strictEqual(ctx.compraId, 'C1');
    assert.strictEqual(texto, 'olá');
    return { lastMessageSig: 'sig123', screenshotBuffer: Buffer.from('PNG_FAKE') };
  });

  const photoCalls = [];
  t._setPostPhotoFn(async (chatId, buf, caption) => {
    photoCalls.push({ chatId, len: buf.length, caption });
    return { ok: true, result: { message_id: 2 } };
  });

  await t._processarPreencher(cbId);

  assert.strictEqual(photoCalls.length, 1);
  assert.strictEqual(photoCalls[0].chatId, 999);
  const p = t._preenchidosPendentes.get(cbId);
  assert.strictEqual(p.lastMessageSig, 'sig123');
  assert.strictEqual(p.etapa2MsgId, 2);
  assert.ok(p.timeoutId, 'timeoutId deveria ter sido agendado');
  clearTimeout(p.timeoutId);
});

test('_processarEnviar chama _onEnviarPreenchido e edita msg de confirmação', async () => {
  const path = require('node:path');
  const t = loadFresh();
  t.init('tok:abc', '999');
  t._setPreenchidosFile(path.join(require('node:os').tmpdir(), `pp-${Date.now()}.json`));
  const cbId = 'TESTABCD';
  t._preenchidosPendentes.set(cbId, {
    compraId: 'C1', uasg: 'U', item: '11', texto: 'oi',
    chatId: 999, etapa1MsgId: 1, etapa2MsgId: 2,
    preenchidoEm: '2026-05-20T17:00:00Z',
    lastMessageSig: 'sigOrig',
    timeoutId: setTimeout(()=>{}, 60_000),
  });
  t.setEnviarPreenchidoCallback(async (ctx, sigOriginal) => {
    assert.strictEqual(sigOriginal, 'sigOrig');
    return { enviadoEm: '2026-05-20T17:01:00Z', houveNovaMsg: false };
  });
  const posts = [];
  t._setPostFn(async (m, p) => { posts.push({ m, p }); return { ok: true }; });

  await t._processarEnviar(cbId);

  assert.ok(posts.some(c => c.m === 'editMessageText' && c.p.message_id === 2),
    'deveria ter editado a msg da etapa 2');
  assert.strictEqual(t._preenchidosPendentes.has(cbId), false, 'pendente removido após enviar');
});

test('_processarLimpar chama _onLimparCampo, cancela timeout e edita msg', async () => {
  const path = require('node:path');
  const t = loadFresh();
  t.init('tok:abc', '999');
  t._setPreenchidosFile(path.join(require('node:os').tmpdir(), `pp-${Date.now()}.json`));
  const cbId = 'TESTABCD';
  const handle = setTimeout(()=>{ throw new Error('timeout não cancelado'); }, 100);
  t._preenchidosPendentes.set(cbId, {
    compraId: 'C1', item: '11', chatId: 999, etapa2MsgId: 2, timeoutId: handle,
  });
  let limparCalled = false;
  t.setLimparCampoCallback(async () => { limparCalled = true; return {}; });
  t._setPostFn(async () => ({ ok: true }));

  await t._processarLimpar(cbId, 'manual');

  assert.ok(limparCalled);
  assert.strictEqual(t._preenchidosPendentes.has(cbId), false);
  await new Promise(r => setTimeout(r, 150));
});
