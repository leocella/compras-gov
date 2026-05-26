'use strict';

const { test } = require('node:test');
const assert   = require('node:assert');

const { _nomeArquivoExcel } = require('./raspar-propostas-cdp');

test('_nomeArquivoExcel sem sufixo mantém _RASPAGEM (retrocompatível)', () => {
  assert.equal(
    _nomeArquivoExcel('15838305900012026'),
    'Resultados_CN_15838305900012026_RASPAGEM.xlsx',
  );
});

test('_nomeArquivoExcel com sufixo usa o sufixo informado', () => {
  assert.equal(
    _nomeArquivoExcel('15838305900012026', 'ITENS_3-5-7_1700000000000'),
    'Resultados_CN_15838305900012026_ITENS_3-5-7_1700000000000.xlsx',
  );
});
