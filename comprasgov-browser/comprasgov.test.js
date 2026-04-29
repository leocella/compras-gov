const { test } = require('node:test');
const assert = require('node:assert');
const { extrairMarcas } = require('./comprasgov');

test('extrai marca obrigatória explícita', () => {
  const r = extrairMarcas('Caneta esferográfica azul. Marca obrigatória: BIC.');
  assert.strictEqual(r.marcaObrigatoria, 'BIC');
  assert.strictEqual(r.marcaPreferencia, '');
});

test('extrai marca de preferência explícita', () => {
  const r = extrairMarcas('Papel A4 75g. Marca de preferência: Chamex');
  assert.strictEqual(r.marcaObrigatoria, '');
  assert.strictEqual(r.marcaPreferencia, 'Chamex');
});

test('extrai ambas marcas no mesmo texto', () => {
  const r = extrairMarcas('Item X. Marca obrigatória: Acme. Marca de preferência: Beta.');
  assert.strictEqual(r.marcaObrigatoria, 'Acme');
  assert.strictEqual(r.marcaPreferencia, 'Beta');
});

test('é case-insensitive e ignora acento em "obrigatoria"', () => {
  const r = extrairMarcas('xyz. MARCA OBRIGATORIA: ZetaCorp.');
  assert.strictEqual(r.marcaObrigatoria, 'ZetaCorp');
});

test('retorna strings vazias quando não há marca', () => {
  const r = extrairMarcas('Apenas uma descrição comum sem marcas.');
  assert.strictEqual(r.marcaObrigatoria, '');
  assert.strictEqual(r.marcaPreferencia, '');
});

test('aceita entrada vazia ou nula', () => {
  assert.deepStrictEqual(extrairMarcas(''),   { marcaObrigatoria: '', marcaPreferencia: '' });
  assert.deepStrictEqual(extrairMarcas(null), { marcaObrigatoria: '', marcaPreferencia: '' });
});

test('aceita em-dash e en-dash como separador', () => {
  const r1 = extrairMarcas('Item. Marca obrigatória — BIC.');
  assert.strictEqual(r1.marcaObrigatoria, 'BIC');
  const r2 = extrairMarcas('Item. Marca de preferência – Chamex.');
  assert.strictEqual(r2.marcaPreferencia, 'Chamex');
});

test('trunca no ponto-e-vírgula: captura apenas primeira marca', () => {
  const r = extrairMarcas('Marca obrigatória: BIC; Compactor.');
  assert.strictEqual(r.marcaObrigatoria, 'BIC');
});
