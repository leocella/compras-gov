'use strict';

const { test } = require('node:test');
const assert   = require('node:assert');

const { _nomeArquivoExcel, parsearCardProposta } = require('./raspar-propostas-cdp');

// ---------------------------------------------------------------------------
// parsearCardProposta — parser puro de UM card de proposta (sumário + detalhe
// expandido). Fixtures vêm dos dumps reais de recon do ComprasGov.
// ---------------------------------------------------------------------------

// Card EXPANDIDO (após clicar "Mostrar proposta do item"): traz Marca/Fabricante,
// Modelo/Versão e os valores no formato "unitário | total".
const CARD_EXPANDIDO = [
  '54.793.517/0001-04',
  'ME/EPP',
  'Inabilitada',
  'MAX-FER TOOLS COMERCIAL LTDA',
  'SP',
  'Chat',
  'Proposta',
  'Motivo da inabilitação',
  'O fornecedor não enviou documentação pendente.',
  'Valor proposta (unitário | total)',
  'R$ 610,7900 |',
  'R$ 4.886,3200',
  'Valor ofertado (unitário | total)',
  'R$ 355,0800 | R$ 2.840,6400',
  'Valor negociado (unitário | total)',
  '-',
  'Quantidade ofertada',
  '8',
  'Marca/Fabricante',
  'MOTOMIL',
  'Modelo/Versão',
  'TMD-300',
].join('\n');

// Card COLAPSADO (sem expandir): só sumário, rótulos antes dos valores, sem marca.
const CARD_COLAPSADO = [
  '54.152.070/0001-94',
  'ME/EPP',
  'Equidade de gênero (Ouro)',
  'Programa de integridade',
  'FERRAMENTAS E PNEUMATICOS 1001 LTDA',
  'MG',
  'Valor ofertado (unitário)',
  'Valor negociado (unitário)',
  'R$ 380,0000',
  '-',
].join('\n');

test('parsearCardProposta extrai marca e modelo de um card expandido', () => {
  const p = parsearCardProposta(CARD_EXPANDIDO);
  assert.equal(p.marca, 'MOTOMIL');
  assert.equal(p.modelo, 'TMD-300');
  assert.equal(p.fabricante, 'MOTOMIL');
});

test('parsearCardProposta pega o valor OFERTADO unitário (não o proposta) no card expandido', () => {
  const p = parsearCardProposta(CARD_EXPANDIDO);
  assert.equal(p.valorOfertado, 'R$ 355,0800');
  assert.equal(p.valorNegociado, ''); // "-" → vazio
});

test('parsearCardProposta extrai identificação do card expandido', () => {
  const p = parsearCardProposta(CARD_EXPANDIDO);
  assert.equal(p.cnpj, '54.793.517/0001-04');
  assert.equal(p.porte, 'ME/EPP');
  assert.equal(p.status, 'Inabilitada');
  assert.equal(p.razaoSocial, 'MAX-FER TOOLS COMERCIAL LTDA');
  assert.equal(p.uf, 'SP');
});

test('parsearCardProposta lida com card colapsado (sem marca/modelo) sem quebrar', () => {
  const p = parsearCardProposta(CARD_COLAPSADO);
  assert.equal(p.cnpj, '54.152.070/0001-94');
  assert.equal(p.porte, 'ME/EPP');
  assert.equal(p.razaoSocial, 'FERRAMENTAS E PNEUMATICOS 1001 LTDA');
  assert.equal(p.uf, 'MG');
  assert.equal(p.valorOfertado, 'R$ 380,0000'); // fallback: 1º R$ do bloco
  assert.equal(p.marca, '');
  assert.equal(p.modelo, '');
});

test('parsearCardProposta captura valor negociado quando existe', () => {
  const card = [
    '11.111.111/0001-11',
    'ME/EPP',
    'Aceita e habilitada',
    'EMPRESA TESTE LTDA',
    'RJ',
    'Valor ofertado (unitário | total)',
    'R$ 100,0000 | R$ 800,0000',
    'Valor negociado (unitário | total)',
    'R$ 95,5000 | R$ 764,0000',
    'Marca/Fabricante',
    'ACME',
    'Modelo/Versão',
    'X1',
  ].join('\n');
  const p = parsearCardProposta(card);
  assert.equal(p.valorOfertado, 'R$ 100,0000');
  assert.equal(p.valorNegociado, 'R$ 95,5000');
  assert.equal(p.status, 'Aceita e habilitada');
});

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
