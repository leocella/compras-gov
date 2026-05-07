'use strict';

const { test } = require('node:test');
const assert   = require('node:assert');

function loadFresh() {
  // agendador usa node-cron na init, aqui só testamos funções puras exportadas
  delete require.cache[require.resolve('./agendador')];
  return require('./agendador');
}

// ─── buildDetalhes ───────────────────────────────────────────────────────────

test('buildDetalhes: formata mudança de status', () => {
  const { buildDetalhes } = loadFresh();
  const mudancas = {
    statusMudou: [{
      item: 3, cnpj: '12.345.678/0001-90',
      razaoSocial: 'EMPRESA X LTDA',
      statusAnterior: 'Aceita', statusAtual: 'Adjudicada',
    }],
    posicaoMudou: [], novosFornecedores: [], removidos: [],
    resumo: { totalMudancas: 1 },
  };
  const txt = buildDetalhes('COMP123', mudancas, '2026-05-06', '2026-05-07');
  assert.ok(txt.includes('EMPRESA X LTDA'), 'razão social ausente');
  assert.ok(txt.includes('Aceita → Adjudicada'), 'transição de status ausente');
  assert.ok(txt.includes('✅'), 'emoji adjudicada ausente');
});

test('buildDetalhes: formata mudança de posição com direção', () => {
  const { buildDetalhes } = loadFresh();
  const mudancas = {
    statusMudou: [],
    posicaoMudou: [{
      item: 7, cnpj: '98.765.432/0001-11',
      razaoSocial: 'FORNECEDOR Y',
      posicaoAnterior: '3', posicaoAtual: '1',
    }],
    novosFornecedores: [], removidos: [],
    resumo: { totalMudancas: 1 },
  };
  const txt = buildDetalhes('COMP123', mudancas, '2026-05-06', '2026-05-07');
  assert.ok(txt.includes('FORNECEDOR Y'), 'razão social ausente');
  assert.ok(txt.includes('3° → 1°'), 'posições ausentes');
  assert.ok(txt.includes('⬆️'), 'emoji subiu ausente');
});

test('buildDetalhes: formata novo fornecedor', () => {
  const { buildDetalhes } = loadFresh();
  const mudancas = {
    statusMudou: [], posicaoMudou: [],
    novosFornecedores: [{
      item: 2, cnpj: '11.222.333/0001-44',
      razaoSocial: 'NOVA EMPRESA SA', posicao: '2',
    }],
    removidos: [],
    resumo: { totalMudancas: 1 },
  };
  const txt = buildDetalhes('COMP123', mudancas, '2026-05-06', '2026-05-07');
  assert.ok(txt.includes('➕'), 'emoji novo ausente');
  assert.ok(txt.includes('NOVA EMPRESA SA'), 'razão social ausente');
});

// ─── Deduplicação de mensagens ───────────────────────────────────────────────

test('gerarChaveMensagem é determinística', () => {
  const { gerarChaveMensagem } = loadFresh();
  const msg = { remetente: 'Pregoeiro', dataHora: '14:30', texto: 'Qual é a marca?' };
  const c1 = gerarChaveMensagem(msg);
  const c2 = gerarChaveMensagem(msg);
  assert.strictEqual(c1, c2);
});

test('gerarChaveMensagem difere para mensagens diferentes', () => {
  const { gerarChaveMensagem } = loadFresh();
  const m1 = { remetente: 'Pregoeiro', dataHora: '14:30', texto: 'Mensagem A' };
  const m2 = { remetente: 'Pregoeiro', dataHora: '14:30', texto: 'Mensagem B' };
  assert.notStrictEqual(gerarChaveMensagem(m1), gerarChaveMensagem(m2));
});

test('ehMensagemUrgente detecta CNPJ no texto', () => {
  const { ehMensagemUrgente } = loadFresh();
  assert.strictEqual(
    ehMensagemUrgente('Empresa 12345678000190 por favor informe a marca', '12345678000190'),
    true
  );
});

test('ehMensagemUrgente retorna false quando CNPJ ausente', () => {
  const { ehMensagemUrgente } = loadFresh();
  assert.strictEqual(
    ehMensagemUrgente('Por favor informe a marca do item 3', '12345678000190'),
    false
  );
});

test('ehMensagemUrgente retorna false quando CNPJ_RAFAEL vazio', () => {
  const { ehMensagemUrgente } = loadFresh();
  assert.strictEqual(
    ehMensagemUrgente('qualquer texto', ''),
    false
  );
});
