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
