'use strict';

const { test } = require('node:test');
const assert   = require('node:assert');

// Carrega lote-runner com o módulo raspar-propostas-cdp "stubado": sleep vira
// no-op (testes rápidos) e log fica silencioso. verificarSessao (comprasgov.js)
// e lote-estado carregam de verdade — só dependem do `page` fake abaixo.
function loadFresh() {
  const cdpPath = require.resolve('./raspar-propostas-cdp');
  require.cache[cdpPath] = {
    id: cdpPath, filename: cdpPath, loaded: true,
    exports: {
      extrairDadosPaginaAtual: async () => { throw new Error('extrair não deveria ser chamado neste teste'); },
      gerarExcel:   async () => '/tmp/fake.xlsx',
      salvarSnapshot: () => {},
      sleep:        async () => {},
      log:          () => {},
      conectarChrome: async () => { throw new Error('conectarChrome não usado aqui'); },
    },
  };
  delete require.cache[require.resolve('./lote-runner')];
  return require('./lote-runner');
}

// Igual ao loadFresh, mas também stuba lote-estado com uma implementação em
// memória (não escreve no dados/lote-estado.json real durante o teste).
function loadFreshComEstado() {
  const cdpPath = require.resolve('./raspar-propostas-cdp');
  require.cache[cdpPath] = {
    id: cdpPath, filename: cdpPath, loaded: true,
    exports: {
      extrairDadosPaginaAtual: async () => { throw new Error('extrair não deveria ser chamado neste teste'); },
      gerarExcel: async () => '/tmp/fake.xlsx',
      salvarSnapshot: () => {},
      sleep: async () => {},
      log: () => {},
      conectarChrome: async () => { throw new Error('conectarChrome não usado aqui'); },
    },
  };
  const estado = { pendentes: [], concluidas: [], falhas: [], status: 'rodando' };
  const estadoPath = require.resolve('./lote-estado');
  require.cache[estadoPath] = {
    id: estadoPath, filename: estadoPath, loaded: true,
    exports: {
      STATUS: { RODANDO: 'rodando', PAUSADO: 'pausado_sessao_expirada', CONCLUIDO: 'concluido' },
      iniciarLote: (ids) => { estado.pendentes = ids.slice(); estado.status = 'rodando'; },
      marcarRodando: () => { estado.status = 'rodando'; },
      marcarFalha: (id, motivo) => { estado.falhas.push({ compraId: id, motivo }); estado.pendentes = estado.pendentes.filter(x => x !== id); },
      marcarConcluida: (id) => { estado.concluidas.push(id); estado.pendentes = estado.pendentes.filter(x => x !== id); },
      marcarPausa: (motivo) => { estado.status = 'pausado_sessao_expirada'; estado.motivo = motivo; },
      marcarConcluido: () => { estado.status = 'concluido'; },
      obterEstado: () => ({
        compras_pendentes: estado.pendentes, compras_concluidas: estado.concluidas,
        compras_falhas: estado.falhas, status: estado.status,
      }),
      _estado: estado,
    },
  };
  delete require.cache[require.resolve('./lote-runner')];
  return { lote: require('./lote-runner'), estado };
}

// Page fake com redirects roteados por compraId, simulando o portal:
//   comprasBounceIds → goto cai na LISTA /compras (bounce, sessão ainda válida)
//   loginIds         → goto cai no SSO gov.br (sessão REALMENTE caiu)
function fakePageRedirect(startUrl, opts = {}) {
  let _url = startUrl;
  const calls = [];
  const COMPRAS = 'https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/seguro/fornecedor/compras?compra=';
  const LOGIN = 'https://sso.acesso.gov.br/login';
  const hit = (u, ids) => (ids || []).some(id => u.includes(id));
  return {
    _calls: calls,
    url() { return _url; },
    async goto(u) {
      calls.push({ m: 'goto', u });
      if (hit(u, opts.loginIds)) { _url = LOGIN; return; }
      if (hit(u, opts.comprasBounceIds)) { _url = COMPRAS; return; }
      _url = u;
    },
    async reload() { calls.push({ m: 'reload' }); },
    async evaluate(fn) {
      const src = String(fn);
      if (src.includes('temAlvo')) return { temAlvo: _url.includes('/item/'), captchaVisivel: false };
      return '';
    },
  };
}

// _sessaoCaiu: distingue perda real de sessão (pausar) de fim/inacessibilidade
// de compra (pular). URLs reais do portal ComprasGov.
const fakeUrl = (u) => ({ url: () => u });
const SES_INV = { valida: false, motivo: 'Página sem componente da compra (provável redirect/expiração)' };

test('_sessaoCaiu: acesso-nao-autorizado é fim de compra, NÃO sessão caída', () => {
  const lote = require('./lote-runner');
  assert.equal(
    lote._sessaoCaiu(fakeUrl('https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/acesso-nao-autorizado'), SES_INV),
    false,
  );
});

test('_sessaoCaiu: compra-nao-encontrada e /compras NÃO são sessão caída', () => {
  const lote = require('./lote-runner');
  assert.equal(lote._sessaoCaiu(fakeUrl('https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/compra-nao-encontrada'), SES_INV), false);
  assert.equal(lote._sessaoCaiu(fakeUrl('https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/seguro/fornecedor/compras?compra='), SES_INV), false);
});

test('_sessaoCaiu: redirect pro SSO/login É sessão caída', () => {
  const lote = require('./lote-runner');
  assert.equal(lote._sessaoCaiu(fakeUrl('https://sso.acesso.gov.br/login'), { valida: false, motivo: 'Redirecionado pro gov.br SSO (sessão expirou)' }), true);
});

test('executarLote PAUSA em queda de internet (resumível, não marca tudo falha)', async () => {
  const { lote, estado } = loadFreshComEstado();
  const page = {
    url: () => GENERICA,
    goto: async () => { throw new Error('page.goto: net::ERR_INTERNET_DISCONNECTED at https://cnetmobile...'); },
    reload: async () => {},
    evaluate: async () => ({}),
  };
  const r = await lote.executarLote({
    alvos: [{ compraId: '11111111111111111' }, { compraId: '22222222222222222' }],
    page, telegram: null, iniciarNovo: true,
  });
  assert.equal(r.pausado, true, 'queda de rede deve PAUSAR (não falhar tudo e seguir)');
  assert.ok(estado.falhas.length < 2, 'não deve marcar as compras como falha numa queda de rede');
});

test('executarLote PULA compra que quica pra /compras (não pausa o lote)', async () => {
  const { lote, estado } = loadFreshComEstado();
  const page = fakePageRedirect(GENERICA, { comprasBounceIds: ['16004605900202025'] });
  const r = await lote.executarLote({
    alvos: [{ compraId: '16004605900202025', tipo: 'Pregão', numero: '90020' }],
    page, telegram: null, iniciarNovo: true,
  });
  assert.equal(r.pausado, false, 'bounce pra /compras não deveria pausar o lote');
  assert.ok(estado.falhas.some(f => f.compraId === '16004605900202025'),
    'compra inacessível deveria virar falha (pulada), não pausa');
});

test('executarLote PAUSA quando a sessão realmente cai (redirect pro SSO)', async () => {
  const { lote, estado } = loadFreshComEstado();
  const page = fakePageRedirect(GENERICA, { loginIds: ['16004605900202025'] });
  const r = await lote.executarLote({
    alvos: [{ compraId: '16004605900202025', tipo: 'Pregão', numero: '90020' }],
    page, telegram: null, iniciarNovo: true,
  });
  assert.equal(r.pausado, true, 'perda real de sessão (SSO) deve pausar o lote');
});

// Page fake: mantém a URL atual e roteia page.evaluate pela fonte da callback.
// - verificarSessao avalia uma função que menciona `temAlvo` → devolvemos
//   { temAlvo, captchaVisivel }, com temAlvo true só quando há uma compra
//   aberta (URL contém "/item/").
// - navegarParaItemGoto avalia o cabeçalho do item → devolvemos string vazia,
//   o que faz nav.ok=false (cabecalho_mismatch) e evita chamar extrair.
function fakePage(startUrl) {
  let _url = startUrl;
  const calls = [];
  return {
    _calls: calls,
    url() { return _url; },
    async goto(u) { calls.push({ m: 'goto', u }); _url = u; },
    async reload() { calls.push({ m: 'reload' }); },
    async evaluate(fn) {
      const src = String(fn);
      if (src.includes('temAlvo')) {
        return { temAlvo: _url.includes('/item/'), captchaVisivel: false };
      }
      return '';
    },
  };
}

const GENERICA = 'https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/seguro/fornecedor/compras?compra=';

test('rasparItensEspecificos navega pra compra ANTES de verificar a sessão', async () => {
  const lote = loadFresh();
  const page = fakePage(GENERICA);            // aba na tela genérica, sem compra aberta
  const msgs = [];
  const telegram = { enviar: async (t) => { msgs.push(t); }, enviarDocumento: async () => {} };

  await lote.rasparItensEspecificos({ page, compraId: '12006005900352026', itens: [1], telegram });

  // No bug, verificarSessao rodava na página genérica (temAlvo=false) e abortava
  // ANTES de qualquer navegação. O fix navega primeiro, então deve haver goto.
  assert.ok(
    page._calls.some(c => c.m === 'goto'),
    'esperava navegação (goto) pra compra antes de decidir a sessão',
  );
  // E não deve reportar "sessão expirada" — a sessão é válida após navegar.
  assert.ok(
    !msgs.some(m => /sess[aã]o expirada/i.test(m)),
    `não esperava msg de sessão expirada; recebi: ${JSON.stringify(msgs)}`,
  );
});
