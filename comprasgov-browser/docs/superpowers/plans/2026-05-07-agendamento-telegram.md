# Agendamento Automático + Notificações Telegram — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar agendamento automático de scraping diário (07h) e polling de mensagens do pregoeiro (a cada 5 min, 08h–18h) com notificações em dois níveis via Telegram, incluindo alerta urgente quando o pregoeiro citar o CNPJ do Rafael.

**Architecture:** Dois novos módulos (`telegram.js` e `agendador.js`) inicializados pelo `server.js` no boot. `telegram.js` usa `https` nativo para envio e long-polling. `agendador.js` usa `node-cron` com dois jobs. Toda configuração via `.env` lido por `dotenv`.

**Tech Stack:** Node.js 20+, `node-cron ^3`, `dotenv ^16`, `https` nativo (já no projeto), `node:test` (já no projeto).

---

## Mapa de arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `telegram.js` | Criar | API Telegram: init, enviar, notificarMudancas, notificarPregoeiro, polling |
| `agendador.js` | Criar | Dois jobs cron + deduplicação de mensagens |
| `telegram.test.js` | Criar | Testes das funções puras do telegram.js |
| `agendador.test.js` | Criar | Testes de buildDetalhes e deduplicação |
| `.env.example` | Criar | Template de configuração (vai pro git) |
| `.env` | Criar (local) | Configuração real (não vai pro git) |
| `comparar-snapshots.js` | Modificar | Exportar `compararSnapshots` e `indexarPorItemCnpj` |
| `server.js` | Modificar | Inicializar telegram + agendador; atualizar /status |
| `package.json` | Modificar | Adicionar node-cron, dotenv; atualizar script de test |
| `.gitignore` | Modificar | Garantir .env ignorado |

---

## Setup do bot Telegram (fazer ANTES de começar o código)

1. Abrir Telegram → buscar `@BotFather`
2. Enviar `/newbot`
3. Escolher nome: ex. `ComprasGov Rafael Bot`
4. Escolher username: ex. `comprasgov_rafael_bot` (precisa terminar em `bot`)
5. Copiar o **token** exibido (formato: `123456789:ABC-DEF...`) → será o `TELEGRAM_TOKEN`
6. Enviar qualquer mensagem para o bot recém-criado (ex: `/start`)
7. Acessar no browser: `https://api.telegram.org/bot{TOKEN}/getUpdates`
8. Copiar o valor de `result[0].message.chat.id` → será o `TELEGRAM_CHAT_ID`

---

## Task 1: Dependências, .env e .gitignore

**Files:**
- Modify: `package.json`
- Modify: `.gitignore`
- Create: `.env.example`
- Create: `.env` (local, não vai pro git)

- [ ] **Step 1: Instalar dependências**

```bash
cd comprasgov-browser
npm install node-cron dotenv
```

Saída esperada: `added 2 packages` (ou similar, sem erros)

- [ ] **Step 2: Verificar package.json atualizado**

Confirmar que `dependencies` contém:
```json
"dotenv": "^16.x.x",
"node-cron": "^3.x.x"
```

- [ ] **Step 3: Atualizar script de test no package.json**

Abrir `package.json` e alterar a linha `"test"`:

```json
"test": "node --test comprasgov.test.js telegram.test.js agendador.test.js"
```

- [ ] **Step 4: Criar .env.example**

Criar arquivo `comprasgov-browser/.env.example` com o conteúdo:

```env
# Telegram Bot (obter via @BotFather)
TELEGRAM_TOKEN=123456789:ABC-DEF...
TELEGRAM_CHAT_ID=987654321

# Agendador
HORA_SCRAPING=7
CNPJ_RAFAEL=12345678000190
```

- [ ] **Step 5: Criar .env real (local)**

Criar `comprasgov-browser/.env` com os valores reais:

```env
TELEGRAM_TOKEN=<token copiado do BotFather>
TELEGRAM_CHAT_ID=<chat_id copiado de getUpdates>
HORA_SCRAPING=7
CNPJ_RAFAEL=<CNPJ da empresa do Rafael sem pontuação>
```

- [ ] **Step 6: Garantir .env no .gitignore**

Abrir `.gitignore` e verificar/adicionar:

```
.env
dados/
sessions/
*.log
```

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json .gitignore .env.example
git commit -m "chore: adicionar node-cron + dotenv + .env.example"
```

---

## Task 2: Exportar compararSnapshots do comparar-snapshots.js

**Files:**
- Modify: `comparar-snapshots.js` (linha 339 — final do arquivo)

`agendador.js` precisará chamar `compararSnapshots` diretamente. Hoje esse arquivo não exporta nada além do `main()` implícito.

- [ ] **Step 1: Adicionar module.exports ao comparar-snapshots.js**

No final do arquivo `comparar-snapshots.js`, substituir a última linha (`main();`) por:

```js
if (require.main === module) {
  main();
}

module.exports = { compararSnapshots, indexarPorItemCnpj, listarSnapshots };
```

- [ ] **Step 2: Verificar que o script ainda funciona standalone**

```bash
node comparar-snapshots.js --help
```

Saída esperada: exibe o texto de uso sem erros.

- [ ] **Step 3: Commit**

```bash
git add comparar-snapshots.js
git commit -m "refactor: exportar compararSnapshots para uso em agendador"
```

---

## Task 3: telegram.js — módulo completo

**Files:**
- Create: `comprasgov-browser/telegram.js`
- Create: `comprasgov-browser/telegram.test.js`

- [ ] **Step 1: Criar telegram.test.js com testes das funções puras**

Criar `comprasgov-browser/telegram.test.js`:

```js
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
```

- [ ] **Step 2: Rodar testes — devem falhar (telegram.js não existe ainda)**

```bash
cd comprasgov-browser
node --test telegram.test.js
```

Saída esperada: erro `Cannot find module './telegram'`

- [ ] **Step 3: Criar telegram.js**

Criar `comprasgov-browser/telegram.js`:

```js
'use strict';

const https = require('https');

let _token  = '';
let _chatId = '';
let _polling = false;
let _ultimoUpdateId = 0;
const _detalhesMap = new Map();

// Permite monkey-patch nos testes
let _enviarFn = null;

function init(token, chatId) {
  if (!token)  throw new Error('[telegram] TELEGRAM_TOKEN não definido no .env');
  if (!chatId) throw new Error('[telegram] TELEGRAM_CHAT_ID não definido no .env');
  _token  = token;
  _chatId = String(chatId);
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
  const r = await _post('sendMessage', {
    chat_id:    _chatId,
    text:       texto,
    parse_mode: 'HTML',
  });
  if (!r.ok) console.error('[telegram] Falha ao enviar:', JSON.stringify(r).slice(0, 200));
}

function _gerarChave() {
  return Math.random().toString(16).slice(2, 6).toUpperCase();
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
```

- [ ] **Step 4: Rodar testes — devem passar**

```bash
node --test telegram.test.js
```

Saída esperada:
```
✔ init lança erro se token ausente
✔ init lança erro se chatId ausente
✔ init não lança se token e chatId presentes
✔ notificarMudancas gera chave de 4 chars e armazena detalhes
✔ _responderChave retorna null para chave inexistente
```

- [ ] **Step 5: Commit**

```bash
git add telegram.js telegram.test.js
git commit -m "feat(telegram): módulo de notificações Telegram com long-polling"
```

---

## Task 4: agendador.js — buildDetalhes + testes

**Files:**
- Create: `comprasgov-browser/agendador.test.js`
- Create: `comprasgov-browser/agendador.js` (parcial — só buildDetalhes e deduplicação)

- [x] **Step 1: Criar agendador.test.js**

Criar `comprasgov-browser/agendador.test.js`:

```js
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
```

- [x] **Step 2: Rodar testes — devem falhar (agendador.js não existe)**

```bash
node --test agendador.test.js
```

Saída esperada: erro `Cannot find module './agendador'`

- [x] **Step 3: Criar agendador.js com as funções puras**

Criar `comprasgov-browser/agendador.js`:

```js
'use strict';

const cron = require('node-cron');
const fs   = require('fs');
const path = require('path');

const {
  navegarParaItemSPA,
  extrairDadosPaginaAtual,
  salvarSnapshot,
  sleep,
  log,
} = require('./raspar-propostas-cdp');

const { lerMensagensChat, SEL_MSG } = require('./comprasgov');
const { compararSnapshots }         = require('./comparar-snapshots');

// ─── Configuração via .env ───────────────────────────────────────────────────

const CNPJ_RAFAEL   = (process.env.CNPJ_RAFAEL   || '').replace(/\D/g, '');
const HORA_SCRAPING = parseInt(process.env.HORA_SCRAPING || '7', 10);
const SNAPSHOTS_DIR = path.join(__dirname, 'dados', 'snapshots');

// ─── Estado interno ──────────────────────────────────────────────────────────

const mensagensVistas = new Map(); // compraId → Set<chave>

// Referências injetadas via init()
let _telegram;
let _getPage;
let _getPageSessao;
let _comprasAlvoPath;

// ─── Funções puras (exportadas para testes) ──────────────────────────────────

function gerarChaveMensagem(msg) {
  const txt = (msg.texto || '').slice(0, 50);
  return `${msg.remetente}|${msg.dataHora}|${txt}`;
}

function ehMensagemUrgente(texto, cnpjRafael) {
  if (!cnpjRafael) return false;
  return String(texto).includes(cnpjRafael);
}

function buildDetalhes(compraId, mudancas, dataAnterior, dataAtual) {
  const linhas = [`📋 Detalhes — Compra ${compraId} (${dataAnterior} → ${dataAtual})\n`];

  for (const m of mudancas.statusMudou) {
    const emoji = m.statusAtual.toLowerCase().includes('adjudicada') ? '✅' : '🔄';
    linhas.push(`${emoji} Item ${m.item} | ${m.cnpj} | ${m.razaoSocial}`);
    linhas.push(`   ${m.statusAnterior} → ${m.statusAtual}`);
  }

  for (const m of mudancas.posicaoMudou) {
    const subiu = parseInt(m.posicaoAtual) < parseInt(m.posicaoAnterior);
    const dir = subiu ? '⬆️ subiu' : '⬇️ desceu';
    linhas.push(`${dir} Item ${m.item} | ${m.cnpj} | ${m.razaoSocial}`);
    linhas.push(`   Posição: ${m.posicaoAnterior}° → ${m.posicaoAtual}°`);
  }

  for (const m of mudancas.novosFornecedores) {
    linhas.push(`➕ Item ${m.item} | ${m.cnpj} | ${m.razaoSocial} | Pos ${m.posicao}°`);
  }

  for (const m of mudancas.removidos) {
    linhas.push(`➖ Item ${m.item} | ${m.cnpj} | ${m.razaoSocial} | Era pos ${m.posicaoAnterior}°`);
  }

  return linhas.join('\n');
}

// ─── Utilitários de data ─────────────────────────────────────────────────────

function hoje()  { return new Date().toISOString().slice(0, 10); }
function ontem() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function carregarAlvos() {
  return JSON.parse(fs.readFileSync(_comprasAlvoPath, 'utf8'));
}

// ─── Job 1: Scraping diário ──────────────────────────────────────────────────

async function jobScrapingDiario() {
  log('[agendador] Iniciando scraping diário...');

  const page = _getPage();
  if (!page) {
    await _telegram.enviar('⚠️ Chrome offline — scraping diário cancelado');
    return;
  }

  let alvos;
  try {
    alvos = carregarAlvos();
  } catch (err) {
    log(`[agendador] Erro ao ler compras-alvo.json: ${err.message}`);
    return;
  }

  for (let i = 0; i < alvos.length; i++) {
    const alvo     = alvos[i];
    const compraId = alvo.compraId;
    log(`[agendador] [${i + 1}/${alvos.length}] Compra ${compraId}`);

    const resultados = [];
    let itemAtual = 1;

    try {
      while (itemAtual <= 200) {
        if (itemAtual === 1) {
          const url = `https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/public/compras/acompanhamento-compra/item/1?compra=${compraId}`;
          if (!page.url().includes(compraId)) {
            await page.goto(url);
            await sleep(5000);
          }
        } else {
          await navegarParaItemSPA(page, compraId, itemAtual);
        }

        const dados = await extrairDadosPaginaAtual(page, itemAtual);
        if (!dados || !dados.dadosItem || !dados.dadosItem.descricao) break;

        resultados.push(dados);
        itemAtual++;
        await sleep(3000);
      }

      if (resultados.length === 0) {
        log(`[agendador] Compra ${compraId}: nenhum item extraído.`);
        continue;
      }

      salvarSnapshot(resultados, compraId);
      await _compararENotificar(compraId, resultados);

    } catch (err) {
      log(`[agendador] Erro na compra ${compraId}: ${err.message}`);
    }

    if (i < alvos.length - 1) await sleep(5000);
  }

  log('[agendador] Scraping diário concluído.');
}

async function _compararENotificar(compraId) {
  const arquivoOntem = path.join(SNAPSHOTS_DIR, `snapshot_${compraId}_${ontem()}.json`);
  const arquivoHoje  = path.join(SNAPSHOTS_DIR, `snapshot_${compraId}_${hoje()}.json`);

  if (!fs.existsSync(arquivoOntem)) {
    log(`[agendador] Sem snapshot de ontem para ${compraId} — comparação pulada.`);
    return;
  }

  const anterior = JSON.parse(fs.readFileSync(arquivoOntem, 'utf8'));
  const atual    = JSON.parse(fs.readFileSync(arquivoHoje,  'utf8'));
  const mudancas = compararSnapshots(anterior, atual);

  if (mudancas.resumo.totalMudancas === 0) return;

  const resumo = {
    totalMudancas: mudancas.resumo.totalMudancas,
    adjudicadas:   mudancas.statusMudou.filter(m => m.statusAtual.toLowerCase().includes('adjudicada')).length,
    posicoes:      mudancas.posicaoMudou.length,
    novos:         mudancas.novosFornecedores.length,
    removidos:     mudancas.removidos.length,
  };

  const detalhes = buildDetalhes(compraId, mudancas, ontem(), hoje());
  await _telegram.notificarMudancas(compraId, resumo, detalhes);
}

// ─── Job 2: Polling mensagens do pregoeiro ───────────────────────────────────

async function jobMensagensPregoeiro() {
  if (!SEL_MSG.campoChatUasg) {
    log('[agendador] SEL_MSG não configurado — polling de mensagens pulado.');
    return;
  }

  const pageSessao = _getPageSessao();
  if (!pageSessao) return;

  let alvos;
  try { alvos = carregarAlvos(); } catch { return; }

  for (const alvo of alvos) {
    const { compraId, uasg, numero } = alvo;
    try {
      const { mensagens } = await lerMensagensChat(pageSessao, uasg, numero);

      if (!mensagensVistas.has(compraId)) mensagensVistas.set(compraId, new Set());
      const vistas = mensagensVistas.get(compraId);

      for (const msg of mensagens) {
        const chave = gerarChaveMensagem(msg);
        if (vistas.has(chave)) continue;
        vistas.add(chave);

        const urgente = ehMensagemUrgente(msg.texto, CNPJ_RAFAEL);
        await _telegram.notificarPregoeiro(compraId, uasg, msg.item || '?', msg.texto, urgente);
      }
    } catch (err) {
      log(`[agendador] Erro ao ler mensagens de ${compraId}: ${err.message}`);
    }
  }
}

// ─── Inicialização ───────────────────────────────────────────────────────────

function init({ telegram, getPage, getPageSessao, comprasAlvoPath }) {
  _telegram        = telegram;
  _getPage         = getPage;
  _getPageSessao   = getPageSessao;
  _comprasAlvoPath = comprasAlvoPath;

  // Job 1: scraping diário
  cron.schedule(`0 ${HORA_SCRAPING} * * *`, jobScrapingDiario, {
    timezone: 'America/Sao_Paulo',
  });

  // Job 2: polling mensagens (a cada 5 min, seg-sex 08h-18h)
  cron.schedule('*/5 8-18 * * 1-5', jobMensagensPregoeiro, {
    timezone: 'America/Sao_Paulo',
  });

  // Reset de mensagens vistas às 08h de dias úteis
  cron.schedule('0 8 * * 1-5', () => {
    mensagensVistas.clear();
    log('[agendador] mensagensVistas resetado para o novo dia.');
  }, { timezone: 'America/Sao_Paulo' });

  log(`[agendador] Jobs registrados:`);
  log(`  • Scraping diário: ${HORA_SCRAPING}h`);
  log(`  • Polling mensagens: a cada 5min (08h-18h, seg-sex)`);
}

module.exports = {
  init,
  buildDetalhes,
  gerarChaveMensagem,
  ehMensagemUrgente,
  // exposto para testes de integração
  jobScrapingDiario,
  jobMensagensPregoeiro,
};
```

- [ ] **Step 4: Rodar testes — devem passar**

```bash
node --test agendador.test.js
```

Saída esperada:
```
✔ buildDetalhes: formata mudança de status
✔ buildDetalhes: formata mudança de posição com direção
✔ buildDetalhes: formata novo fornecedor
✔ gerarChaveMensagem é determinística
✔ gerarChaveMensagem difere para mensagens diferentes
✔ ehMensagemUrgente detecta CNPJ no texto
✔ ehMensagemUrgente retorna false quando CNPJ ausente
✔ ehMensagemUrgente retorna false quando CNPJ_RAFAEL vazio
```

- [ ] **Step 5: Commit**

```bash
git add agendador.js agendador.test.js
git commit -m "feat(agendador): jobs cron de scraping e polling com deduplicação"
```

---

## Task 5: Integração no server.js + /status atualizado

**Files:**
- Modify: `server.js` (linhas 1-17 e após bootBrowser, e endpoint /status)

- [x] **Step 1: Adicionar dotenv no topo do server.js**

Inserir como **primeira linha** do `server.js` (antes de qualquer require):

```js
require('dotenv').config();
```

- [x] **Step 2: Adicionar requires de telegram e agendador no server.js**

Após as linhas de require existentes (após linha `const da = require('./dadosabertos-api');`), adicionar:

```js
const telegram  = require('./telegram');
const agendador = require('./agendador');
```

- [x] **Step 3: Atualizar endpoint GET /status para incluir agendadorAtivo**

Substituir o handler do `/status`:

```js
app.get('/status', (req, res) => {
  res.json({
    online:          true,
    browserPronto:   !!page,
    url:             page ? page.url() : null,
    sessaoAtiva:     !!pageSessao,
    agendadorAtivo:  !!process.env.TELEGRAM_TOKEN,
  });
});
```

- [x] **Step 4: Inicializar telegram e agendador após bootBrowser**

No bloco `(async () => { ... })()`, substituir:

```js
(async () => {
  await bootBrowser();
  app.listen(PORT, '127.0.0.1', () => {
    console.log(`[boot] API rodando em http://127.0.0.1:${PORT}`);
  });
})().catch((err) => {
  console.error('[fatal] Falha no boot:', err);
  process.exit(1);
});
```

Por:

```js
(async () => {
  await bootBrowser();

  if (process.env.TELEGRAM_TOKEN) {
    try {
      telegram.init(process.env.TELEGRAM_TOKEN, process.env.TELEGRAM_CHAT_ID);
      telegram.iniciarPolling();
      agendador.init({
        telegram,
        getPage:        () => page,
        getPageSessao:  () => pageSessao,
        comprasAlvoPath: path.join(__dirname, 'compras-alvo.json'),
      });
      console.log('[boot] Telegram + agendador inicializados.');
    } catch (err) {
      console.error('[boot] Telegram desabilitado:', err.message);
    }
  } else {
    console.log('[boot] TELEGRAM_TOKEN não definido — agendador desabilitado.');
  }

  app.listen(PORT, '127.0.0.1', () => {
    console.log(`[boot] API rodando em http://127.0.0.1:${PORT}`);
  });
})().catch((err) => {
  console.error('[fatal] Falha no boot:', err);
  process.exit(1);
});
```

- [x] **Step 5: Testar boot SEM .env (agendador deve ser desabilitado sem crash)**

```bash
cd comprasgov-browser
# Renomear temporariamente o .env
mv .env .env.bak
node server.js &
sleep 3
curl -s http://127.0.0.1:3099/status
```

Saída esperada:
```json
{"online":true,"browserPronto":true,"url":"...","sessaoAtiva":false,"agendadorAtivo":false}
```

Console deve conter: `[boot] TELEGRAM_TOKEN não definido — agendador desabilitado.`

```bash
# Restaurar .env
mv .env.bak .env
kill %1
```

- [x] **Step 6: Testar boot COM .env (agendador deve inicializar)**

```bash
node server.js &
sleep 3
curl -s http://127.0.0.1:3099/status
```

Saída esperada:
```json
{"online":true,"browserPronto":true,"url":"...","sessaoAtiva":false,"agendadorAtivo":true}
```

Console deve conter: `[boot] Telegram + agendador inicializados.`

```bash
kill %1
```

- [x] **Step 7: Rodar todos os testes**

```bash
node --test comprasgov.test.js telegram.test.js agendador.test.js
```

Saída esperada: todos os testes passando (13 total).

- [x] **Step 8: Commit**

```bash
git add server.js
git commit -m "feat(server): integrar telegram + agendador no boot com flag agendadorAtivo em /status"
```

---

## Task 6: Teste manual end-to-end do Telegram

Esta task valida o fluxo real com o bot Telegram criado no BotFather.

**Pré-requisito:** `.env` com `TELEGRAM_TOKEN` e `TELEGRAM_CHAT_ID` reais, bot configurado.

- [ ] **Step 1: Iniciar o servidor**

```bash
node server.js
```

Console deve mostrar: `[telegram] Iniciando long-polling...`

- [ ] **Step 2: Testar envio direto via endpoint curl**

Criar um endpoint temporário de teste (ou usar curl para chamar o módulo diretamente):

```bash
node -e "
require('dotenv').config();
const t = require('./telegram');
t.init(process.env.TELEGRAM_TOKEN, process.env.TELEGRAM_CHAT_ID);
t.enviar('🤖 Teste de conectividade — sistema online!').then(() => { console.log('Enviado!'); process.exit(0); });
"
```

Verificar: mensagem chegou no Telegram do Rafael.

- [ ] **Step 3: Testar notificarMudancas + resposta com chave**

```bash
node -e "
require('dotenv').config();
const t = require('./telegram');
t.init(process.env.TELEGRAM_TOKEN, process.env.TELEGRAM_CHAT_ID);
t.iniciarPolling();
t.notificarMudancas('15838305900012026', {
  totalMudancas: 2, adjudicadas: 1, posicoes: 1, novos: 0, removidos: 0
}, 'Detalhe: Item 3 | EMPRESA X | Aceita → Adjudicada ✅').then(() => {
  console.log('Mensagem enviada. Responda com a chave no Telegram para testar o detalhe.');
});
"
```

- No Telegram: copiar a chave `XXXX` da mensagem e responder com ela
- Verificar: bot responde com os detalhes completos

- [ ] **Step 4: Testar notificarPregoeiro urgente**

Criar arquivo temporário `_teste_urgente.js`:

```js
require('dotenv').config();
const t    = require('./telegram');
const cnpj = process.env.CNPJ_RAFAEL || '12345678000190';
t.init(process.env.TELEGRAM_TOKEN, process.env.TELEGRAM_CHAT_ID);
t.notificarPregoeiro(
  '15838305900012026', '158383', '3',
  `Empresa ${cnpj}, por favor informe a marca do item 3.`,
  true
).then(() => {
  console.log('Alerta urgente enviado. Aguardando lembrete em 90s...');
});
```

```bash
node _teste_urgente.js
```

Apagar após o teste:

```bash
del _teste_urgente.js
```

- Verificar: mensagem urgente chegou com o countdown "⏰ Responda até: HH:MM"
- Aguardar 90s e verificar: lembrete "⚠️ 30 segundos restantes!" chegou

- [ ] **Step 5: Commit final**

```bash
git add .
git commit -m "feat: agendamento automático + notificações Telegram completo"
```

---

## Checklist de cobertura do spec

| Requisito do spec | Task que cobre |
|---|---|
| telegram.js: init + enviar | Task 3 |
| telegram.js: notificarMudancas com chave | Task 3 |
| telegram.js: long-polling + responder chave | Task 3 |
| telegram.js: notificarPregoeiro urgente + countdown 90s | Task 3 |
| agendador.js: buildDetalhes | Task 4 |
| agendador.js: gerarChaveMensagem + ehMensagemUrgente | Task 4 |
| agendador.js: Job 1 scraping diário (getPage, sem reconectar CDP) | Task 4 |
| agendador.js: Job 2 polling 5min com guard SEL_MSG | Task 4 |
| agendador.js: reset mensagensVistas às 08h | Task 4 |
| .env com todas as variáveis | Task 1 |
| .gitignore com .env | Task 1 |
| comparar-snapshots exporta compararSnapshots | Task 2 |
| server.js inicializa condicionalmente | Task 5 |
| /status inclui agendadorAtivo | Task 5 |
| Boot sem .env não crasha | Task 5 |
| Teste manual Telegram end-to-end | Task 6 |
