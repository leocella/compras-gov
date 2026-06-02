'use strict';

const { test } = require('node:test');
const assert   = require('node:assert');
const path     = require('node:path');

const { _cnpjDigits, _sanitizeNome, _pastaAnexos } = require('./anexos-runner');

test('_cnpjDigits remove pontuação do CNPJ', () => {
  assert.equal(_cnpjDigits('51.566.738/0001-51'), '51566738000151');
  assert.equal(_cnpjDigits('51566738000151'), '51566738000151');
  assert.equal(_cnpjDigits(''), '');
});

test('_sanitizeNome mantém nome válido e troca caracteres proibidos do filesystem', () => {
  assert.equal(_sanitizeNome('Habilitacao GSMIRANDA LTDA 29092025.zip'), 'Habilitacao GSMIRANDA LTDA 29092025.zip');
  assert.equal(_sanitizeNome('arq<>:"/\\|?*.pdf'), 'arq_________.pdf');
});

test('_sanitizeNome lida com nome vazio/nulo', () => {
  assert.equal(_sanitizeNome(''), 'arquivo');
  assert.equal(_sanitizeNome(null), 'arquivo');
});

test('_pastaAnexos monta dados/anexos/<compraId>/item_<n>/<cnpjDigits>', () => {
  const p = _pastaAnexos('92611506000192025', 1, '51.566.738/0001-51');
  const esperadoSuffix = path.join('dados', 'anexos', '92611506000192025', 'item_1', '51566738000151');
  assert.ok(p.endsWith(esperadoSuffix), `esperava terminar com ${esperadoSuffix}, veio ${p}`);
  assert.ok(path.isAbsolute(p), 'deve ser caminho absoluto');
});
