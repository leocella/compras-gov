# Resposta ao Pregoeiro — Dupla Confirmação Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar fluxo de dupla confirmação (preencher → screenshot → enviar) para respostas ao pregoeiro via Telegram, com timeout 10min, race detection e resiliência a reboot.

**Architecture:** Adiciona 5 primitivas em `comprasgov.js` (preencher, enviar, limpar, capturar screenshot, obter assinatura msgs), refatora `telegram.js` para fluxo de 2 etapas com novo Map de pendentes + 3 callbacks + persistência em JSON, e troca o registro de callback em `server.js` por 3 callbacks novos + cleanup no boot.

**Tech Stack:** Node.js 20+, Playwright, Telegram Bot API, `node:test` + `node:assert` para testes unitários.

**Spec:** `docs/superpowers/specs/2026-05-20-resposta-pregoeiro-dupla-confirmacao-design.md` (commit b7635f7)

**File Structure:**

```
comprasgov-browser/
├── comprasgov.js           # MODIFY: +5 funções primitivas; remover dryRun de responderMensagem
├── comprasgov.test.js      # MODIFY: testes para _calcularAssinaturaMsgs
├── telegram.js             # MODIFY: novo Map, 3 callbacks, 3 handlers, _postPhoto, _solicitarPreenchimento, persistência, roteamento
├── telegram.test.js        # MODIFY: testes do novo fluxo (mocks)
├── server.js               # MODIFY: trocar setResponderCallback pelos 3 novos + boot cleanup
├── .env.example            # MODIFY: remover TELEGRAM_RESPONDER_DRY_RUN
└── dados/
    ├── respostas-pregoeiro.log     # MODIFY: passa a registrar campo `evento`
    └── preenchidos-pendentes.json  # CREATE em runtime: Map serializado
```

---

## Task 1: comprasgov.js — função pura `_calcularAssinaturaMsgs`

**Files:**
- Modify: `comprasgov-browser/comprasgov.js`
- Test: `comprasgov-browser/comprasgov.test.js`

Função pura que recebe array de mensagens e retorna sha1 truncado. Será usada para detectar race condition (nova msg do pregoeiro entre etapas).

- [ ] **Step 1: Escrever o teste falhando**

Adicione no final de `comprasgov-browser/comprasgov.test.js`:

```js
const { _calcularAssinaturaMsgs } = require('./comprasgov');

test('_calcularAssinaturaMsgs retorna null para array vazio', () => {
  assert.strictEqual(_calcularAssinaturaMsgs([]), null);
  assert.strictEqual(_calcularAssinaturaMsgs(null), null);
  assert.strictEqual(_calcularAssinaturaMsgs(undefined), null);
});

test('_calcularAssinaturaMsgs ignora mensagens próprias (do Rafael)', () => {
  const msgs = [
    { propria: true,  dataHora: '2026-05-20 10:00', texto: 'minha resposta' },
    { propria: false, dataHora: '2026-05-20 10:01', texto: 'msg do pregoeiro' },
  ];
  const sigComProprias    = _calcularAssinaturaMsgs(msgs);
  const sigSemProprias    = _calcularAssinaturaMsgs(msgs.filter(m => !m.propria));
  assert.strictEqual(sigComProprias, sigSemProprias);
});

test('_calcularAssinaturaMsgs muda quando pregoeiro adiciona nova mensagem', () => {
  const msgs1 = [{ propria: false, dataHora: '10:00', texto: 'A' }];
  const msgs2 = [
    { propria: false, dataHora: '10:00', texto: 'A' },
    { propria: false, dataHora: '10:05', texto: 'B' },
  ];
  assert.notStrictEqual(_calcularAssinaturaMsgs(msgs1), _calcularAssinaturaMsgs(msgs2));
});

test('_calcularAssinaturaMsgs é determinística para o mesmo input', () => {
  const msgs = [{ propria: false, dataHora: '10:00', texto: 'oi' }];
  assert.strictEqual(_calcularAssinaturaMsgs(msgs), _calcularAssinaturaMsgs(msgs));
});

test('_calcularAssinaturaMsgs retorna hex de 16 chars', () => {
  const sig = _calcularAssinaturaMsgs([{ propria: false, dataHora: 'x', texto: 'y' }]);
  assert.match(sig, /^[0-9a-f]{16}$/);
});
```

- [ ] **Step 2: Rodar para ver falhar**

```bash
cd comprasgov-browser && npm test 2>&1 | tail -20
```

Esperado: 5 testes novos FAIL com `TypeError: _calcularAssinaturaMsgs is not a function`.

- [ ] **Step 3: Implementar a função em `comprasgov.js`**

No topo do arquivo, adicione o import (logo após `'use strict';`):

```js
const crypto = require('crypto');
```

Adicione a função antes da seção `// ---- responderMensagem ----` (linha ~223):

```js
// ---------------------------------------------------------------------------
// _calcularAssinaturaMsgs — função pura: sha1(JSON) das mensagens do pregoeiro
// (filtra propria=true). Usada em race detection entre etapas do fluxo de
// resposta com dupla confirmação. Retorna null para input vazio.
// ---------------------------------------------------------------------------
function _calcularAssinaturaMsgs(msgs) {
  if (!Array.isArray(msgs) || msgs.length === 0) return null;
  const doPregoeiro = msgs.filter(m => m && m.propria === false)
                          .map(m => ({ dataHora: m.dataHora || '', texto: m.texto || '' }));
  if (doPregoeiro.length === 0) return null;
  return crypto.createHash('sha1').update(JSON.stringify(doPregoeiro)).digest('hex').slice(0, 16);
}
```

E adicione `_calcularAssinaturaMsgs` ao `module.exports` no final do arquivo (procure pelo bloco que já exporta `extrairMarcas`, `responderMensagem` etc).

- [ ] **Step 4: Rodar testes para verificar PASS**

```bash
cd comprasgov-browser && npm test 2>&1 | tail -15
```

Esperado: todos os testes passam (incluindo os 5 novos).

- [ ] **Step 5: Commit**

```bash
cd C:/Users/leo-p/OneDrive/Documentos/RAFAEL_PRIMO
git add comprasgov-browser/comprasgov.js comprasgov-browser/comprasgov.test.js
git commit -m "feat(comprasgov): assinatura sha1 de mensagens do pregoeiro para race detection"
```

---

## Task 2: comprasgov.js — `obterUltimaAssinaturaMsg`

**Files:**
- Modify: `comprasgov-browser/comprasgov.js`

Wrapper async que chama `lerMensagensItem` e devolve a assinatura. Sem teste unitário (depende de browser real — validado no smoke test §13).

- [ ] **Step 1: Implementar a função em `comprasgov.js`**

Adicione logo após `_calcularAssinaturaMsgs`:

```js
// ---------------------------------------------------------------------------
// obterUltimaAssinaturaMsg — lê o chat e devolve a assinatura sha1 das msgs
// do pregoeiro. Usada em duas situações:
//   1. ao preencher (etapa 1) — captura baseline
//   2. ao enviar (etapa 2)    — re-captura e compara com baseline
// ---------------------------------------------------------------------------
async function obterUltimaAssinaturaMsg(page, compraId, item) {
  const { mensagens } = await lerMensagensItem(page, compraId, item);
  return _calcularAssinaturaMsgs(mensagens);
}
```

E adicione `obterUltimaAssinaturaMsg` ao `module.exports`.

- [ ] **Step 2: Verificar que a suíte de testes ainda passa**

```bash
cd comprasgov-browser && npm test 2>&1 | tail -10
```

Esperado: mesma quantidade de PASS, zero FAIL.

- [ ] **Step 3: Commit**

```bash
cd C:/Users/leo-p/OneDrive/Documentos/RAFAEL_PRIMO
git add comprasgov-browser/comprasgov.js
git commit -m "feat(comprasgov): obterUltimaAssinaturaMsg wrapper para race detection"
```

---

## Task 3: comprasgov.js — `preencherSemEnviar`, `enviarPreenchido`, `limparCampo`

**Files:**
- Modify: `comprasgov-browser/comprasgov.js`

Três funções que manipulam o form do chat sem submeter. Sem teste unitário — validadas no smoke test §13.

- [ ] **Step 1: Implementar as 3 funções em `comprasgov.js`**

Adicione logo após `obterUltimaAssinaturaMsg`:

```js
// ---------------------------------------------------------------------------
// preencherSemEnviar — navega, digita o texto no campo de resposta, NÃO clica
// Enviar. Captura assinatura da última mensagem do pregoeiro como baseline
// para race detection na etapa 2.
// ---------------------------------------------------------------------------
async function preencherSemEnviar(page, compraId, item, texto) {
  if (!compraId) throw new Error('preencherSemEnviar: compraId obrigatório');
  if (!item)     throw new Error('preencherSemEnviar: item obrigatório');
  if (!texto)    throw new Error('preencherSemEnviar: texto obrigatório');
  if (!SEL_MSG.campoResposta) throw new Error('SEL_MSG.campoResposta vazio');

  const targetUrl = SEL_MSG.urlChatItem
    .replace('{item}',  String(item))
    .replace('{compra}', String(compraId));

  if (!page.url().includes(`/item/${item}`) || !page.url().includes(compraId)) {
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForTimeout(3000);
  }
  if (page.url().includes('login')) {
    throw new Error('Sessão expirada — relogar via VNC');
  }

  await page.waitForSelector(SEL_MSG.campoResposta, { timeout: 10_000 });
  await page.fill(SEL_MSG.campoResposta, texto);

  // Captura assinatura ANTES de retornar (mesmo page, mesma URL)
  const lastMessageSig = await obterUltimaAssinaturaMsg(page, compraId, item);
  const preenchidoEm   = new Date().toISOString();

  _logResposta({ ts: preenchidoEm, evento: 'preenchido', compraId, item, texto, lastMessageSig });
  return { url: page.url(), lastMessageSig, preenchidoEm };
}

// ---------------------------------------------------------------------------
// enviarPreenchido — clica o botão Enviar do portal. Assume campo já preenchido
// (por preencherSemEnviar). Não navega — usa a página atual.
// ---------------------------------------------------------------------------
async function enviarPreenchido(page, compraId, item) {
  if (!SEL_MSG.botaoEnviar) throw new Error('SEL_MSG.botaoEnviar vazio');
  await page.waitForSelector(SEL_MSG.botaoEnviar, { timeout: 10_000 });
  await page.click(SEL_MSG.botaoEnviar);
  await page.waitForLoadState('networkidle');
  const enviadoEm = new Date().toISOString();
  _logResposta({ ts: enviadoEm, evento: 'enviado', compraId, item });
  return { enviadoEm, url: page.url() };
}

// ---------------------------------------------------------------------------
// limparCampo — esvazia o campo de resposta. Idempotente: não erra se já
// vazio ou se a página atual não tem o seletor.
// ---------------------------------------------------------------------------
async function limparCampo(page, compraId, item, motivo = 'manual') {
  if (!SEL_MSG.campoResposta) return { limpoEm: new Date().toISOString(), notado: 'sem-seletor' };
  try {
    const el = await page.$(SEL_MSG.campoResposta);
    if (el) {
      await page.fill(SEL_MSG.campoResposta, '');
    }
  } catch (e) {
    // ignora — pode ter saído da página, etc
  }
  const limpoEm = new Date().toISOString();
  _logResposta({ ts: limpoEm, evento: 'cancelado', modo: motivo, compraId, item });
  return { limpoEm };
}
```

Adicione `preencherSemEnviar`, `enviarPreenchido`, `limparCampo` ao `module.exports`.

- [ ] **Step 2: Verificar que a suíte de testes ainda passa**

```bash
cd comprasgov-browser && npm test 2>&1 | tail -10
```

Esperado: mesma quantidade de PASS.

- [ ] **Step 3: Commit**

```bash
cd C:/Users/leo-p/OneDrive/Documentos/RAFAEL_PRIMO
git add comprasgov-browser/comprasgov.js
git commit -m "feat(comprasgov): preencherSemEnviar, enviarPreenchido, limparCampo primitives"
```

---

## Task 4: comprasgov.js — `capturarScreenshotChat`

**Files:**
- Modify: `comprasgov-browser/comprasgov.js`

Screenshot recortado: bounding box do form + N últimas mensagens visíveis, com fallback para viewport completo.

- [ ] **Step 1: Implementar a função em `comprasgov.js`**

Adicione logo após `limparCampo`:

```js
// ---------------------------------------------------------------------------
// capturarScreenshotChat — recorta o screenshot na união dos bounding boxes
// das últimas N mensagens + o form de resposta. Fallback: viewport inteiro
// se a união ultrapassar a viewport (evita screenshot gigante). Retorna Buffer
// PNG — quem chamar (telegram.js) envia direto via sendPhoto, sem gravar em disco.
// ---------------------------------------------------------------------------
async function capturarScreenshotChat(page, opts = {}) {
  const nMsgs = opts.nMsgs ?? 3;

  try {
    const clip = await page.evaluate(({ cardSel, formSel, n }) => {
      const cards = Array.from(document.querySelectorAll(cardSel)).slice(-n);
      const form  = document.querySelector(formSel);
      const els = [...cards, form].filter(Boolean);
      if (els.length === 0) return null;
      const rects = els.map(e => e.getBoundingClientRect());
      const top    = Math.min(...rects.map(r => r.top));
      const left   = Math.min(...rects.map(r => r.left));
      const right  = Math.max(...rects.map(r => r.right));
      const bottom = Math.max(...rects.map(r => r.bottom));
      const PADDING = 12;
      return {
        x: Math.max(0, Math.floor(left  - PADDING)),
        y: Math.max(0, Math.floor(top   - PADDING)),
        width:  Math.ceil((right  - left)   + 2 * PADDING),
        height: Math.ceil((bottom - top)    + 2 * PADDING),
      };
    }, { cardSel: SEL_MSG.cardMsgItem, formSel: SEL_MSG.campoResposta, n: nMsgs });

    const viewport = page.viewportSize() || { width: 1280, height: 720 };
    const fits = clip
      && clip.width  > 0 && clip.height > 0
      && clip.width  <= viewport.width
      && clip.height <= viewport.height;

    if (fits) {
      return page.screenshot({ type: 'png', clip });
    }
  } catch (e) {
    // cai pro fallback abaixo
  }
  return page.screenshot({ type: 'png', fullPage: false });
}
```

Adicione `capturarScreenshotChat` ao `module.exports`.

- [ ] **Step 2: Verificar suíte de testes**

```bash
cd comprasgov-browser && npm test 2>&1 | tail -10
```

Esperado: mesma quantidade de PASS.

- [ ] **Step 3: Commit**

```bash
cd C:/Users/leo-p/OneDrive/Documentos/RAFAEL_PRIMO
git add comprasgov-browser/comprasgov.js
git commit -m "feat(comprasgov): capturarScreenshotChat com bounding box + fallback viewport"
```

---

## Task 5: telegram.js — `_postPhoto` (multipart sendPhoto a partir de Buffer)

**Files:**
- Modify: `comprasgov-browser/telegram.js`

Helper para enviar Buffer PNG via sendPhoto. Espelha `_postMultipart` (linha ~128) que hoje só lê de filePath.

- [ ] **Step 1: Implementar em `telegram.js`**

Adicione logo após `_postMultipart` (depois da linha que fecha essa função, ~ linha 184):

```js
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
```

- [ ] **Step 2: Verificar suíte ainda passa**

```bash
cd comprasgov-browser && npm test 2>&1 | tail -10
```

Esperado: mesma quantidade de PASS.

- [ ] **Step 3: Commit**

```bash
cd C:/Users/leo-p/OneDrive/Documentos/RAFAEL_PRIMO
git add comprasgov-browser/telegram.js
git commit -m "feat(telegram): _postPhoto envia Buffer PNG via sendPhoto"
```

---

## Task 6: telegram.js — persistência `dados/preenchidos-pendentes.json`

**Files:**
- Modify: `comprasgov-browser/telegram.js`
- Test: `comprasgov-browser/telegram.test.js`

Helpers `_persistirPreenchidos()` e `_carregarPreenchidos()` para salvar/restaurar o Map (sem `timeoutId`, que não serializa).

- [ ] **Step 1: Escrever os testes falhando**

Adicione no final de `telegram.test.js`:

```js
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
```

- [ ] **Step 2: Rodar para ver falhar**

```bash
cd comprasgov-browser && npm test 2>&1 | tail -15
```

Esperado: 2 testes novos FAIL com `_setPreenchidosFile is not a function` ou `_preenchidosPendentes is undefined`.

- [ ] **Step 3: Implementar em `telegram.js`**

Adicione no topo do arquivo, logo após a linha `const _pendentesConfirmacao = new Map();` (~ linha 21):

```js
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
```

E exporte os três no `module.exports` (final do arquivo, junto com os outros):

```js
  _preenchidosPendentes,
  _setPreenchidosFile,
  _persistirPreenchidos,
  _carregarPreenchidos,
```

- [ ] **Step 4: Rodar testes para verificar PASS**

```bash
cd comprasgov-browser && npm test 2>&1 | tail -15
```

Esperado: todos PASS, incluindo os 2 novos.

- [ ] **Step 5: Commit**

```bash
cd C:/Users/leo-p/OneDrive/Documentos/RAFAEL_PRIMO
git add comprasgov-browser/telegram.js comprasgov-browser/telegram.test.js
git commit -m "feat(telegram): persistência de preenchidos-pendentes.json (sem timeoutId)"
```

---

## Task 7: telegram.js — callbacks `setPreencherCallback`, `setEnviarPreenchidoCallback`, `setLimparCampoCallback` + `_solicitarPreenchimento`

**Files:**
- Modify: `comprasgov-browser/telegram.js`
- Test: `comprasgov-browser/telegram.test.js`

Substitui o fluxo `_solicitarConfirmacao` por `_solicitarPreenchimento` que cria entrada em `_preenchidosPendentes` e envia mensagem da etapa 1 com botão `p:`.

- [ ] **Step 1: Escrever testes falhando**

Adicione em `telegram.test.js`:

```js
test('setters armazenam callbacks dos 3 estágios', () => {
  const t = loadFresh();
  const f1 = () => {}, f2 = () => {}, f3 = () => {};
  t.setPreencherCallback(f1);
  t.setEnviarPreenchidoCallback(f2);
  t.setLimparCampoCallback(f3);
  // exposição via getters internos (vamos adicioná-los)
  assert.strictEqual(t._getPreencherCallback(), f1);
  assert.strictEqual(t._getEnviarPreenchidoCallback(), f2);
  assert.strictEqual(t._getLimparCampoCallback(), f3);
});

test('_solicitarPreenchimento cria entrada em _preenchidosPendentes e envia msg etapa 1', async () => {
  const t = loadFresh();
  t.init('tok:abc', '999');
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
```

- [ ] **Step 2: Rodar para falhar**

```bash
cd comprasgov-browser && npm test 2>&1 | tail -15
```

Esperado: FAIL — funções não existem.

- [ ] **Step 3: Implementar em `telegram.js`**

(a) Adicione no topo, junto com os outros callbacks (~linha 30):

```js
let _onPreencher          = null;
let _onEnviarPreenchido   = null;
let _onLimparCampo        = null;
let _postFn               = null; // monkey-patch p/ testes

function setPreencherCallback(fn)          { _onPreencher = fn; }
function setEnviarPreenchidoCallback(fn)   { _onEnviarPreenchido = fn; }
function setLimparCampoCallback(fn)        { _onLimparCampo = fn; }
function _getPreencherCallback()           { return _onPreencher; }
function _getEnviarPreenchidoCallback()    { return _onEnviarPreenchido; }
function _getLimparCampoCallback()         { return _onLimparCampo; }
function _setPostFn(fn)                    { _postFn = fn; }
```

(b) Modifique `_post` para usar o mock se setado. Substitua a linha `function _post(metodo, payload) {` por:

```js
function _post(metodo, payload) {
  if (_postFn) return _postFn(metodo, payload);
  return new Promise((resolve, reject) => {
```

(c) Adicione `_solicitarPreenchimento` logo após `_solicitarConfirmacao` (~linha 345):

```js
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
```

(d) Exporte tudo no `module.exports`:

```js
  setPreencherCallback,
  setEnviarPreenchidoCallback,
  setLimparCampoCallback,
  _getPreencherCallback,
  _getEnviarPreenchidoCallback,
  _getLimparCampoCallback,
  _setPostFn,
  _solicitarPreenchimento,
```

- [ ] **Step 4: Rodar testes**

```bash
cd comprasgov-browser && npm test 2>&1 | tail -15
```

Esperado: todos PASS.

- [ ] **Step 5: Commit**

```bash
cd C:/Users/leo-p/OneDrive/Documentos/RAFAEL_PRIMO
git add comprasgov-browser/telegram.js comprasgov-browser/telegram.test.js
git commit -m "feat(telegram): callbacks dos 3 estágios + _solicitarPreenchimento (etapa 1)"
```

---

## Task 8: telegram.js — handlers `_processarPreencher`, `_processarEnviar`, `_processarLimpar` + timeout 10min

**Files:**
- Modify: `comprasgov-browser/telegram.js`
- Test: `comprasgov-browser/telegram.test.js`

Os 3 handlers que respondem aos botões. `_processarPreencher` agenda timeout de 10 minutos via `setTimeout` que dispara `_processarLimpar(callbackId, 'timeout-10min')` se Rafael não confirmar nem cancelar antes.

- [ ] **Step 1: Escrever os testes**

Adicione em `telegram.test.js`:

```js
test('_processarPreencher chama _onPreencher e envia screenshot via _postPhoto', async () => {
  const t = loadFresh();
  t.init('tok:abc', '999');

  // Setup: criar entrada via _solicitarPreenchimento
  let postCalls = [];
  t._setPostFn(async (m, p) => { postCalls.push({ m, p }); return { ok: true, result: { message_id: 1 } }; });
  await t._solicitarPreenchimento({ compraId: 'C1', uasg: 'U1', item: '11' }, 'olá', 999);
  const cbId = [...t._preenchidosPendentes.keys()][0];

  // Mock do callback _onPreencher
  t.setPreencherCallback(async (ctx, texto) => {
    assert.strictEqual(ctx.compraId, 'C1');
    assert.strictEqual(texto, 'olá');
    return { lastMessageSig: 'sig123', screenshotBuffer: Buffer.from('PNG_FAKE') };
  });

  // Mock _postPhoto
  const photoCalls = [];
  t._setPostPhotoFn(async (chatId, buf, caption) => {
    photoCalls.push({ chatId, len: buf.length, caption });
    return { ok: true, result: { message_id: 2 } };
  });

  await t._processarPreencher(cbId);

  assert.strictEqual(photoCalls.length, 1);
  assert.strictEqual(photoCalls[0].chatId, '999');
  const p = t._preenchidosPendentes.get(cbId);
  assert.strictEqual(p.lastMessageSig, 'sig123');
  assert.strictEqual(p.etapa2MsgId, 2);
  assert.ok(p.timeoutId, 'timeoutId deveria ter sido agendado');
  clearTimeout(p.timeoutId);
});

test('_processarEnviar chama _onEnviarPreenchido e edita msg de confirmação', async () => {
  const t = loadFresh();
  t.init('tok:abc', '999');
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

test('_processarLimpar chama _onLimparCampo e edita msg', async () => {
  const t = loadFresh();
  t.init('tok:abc', '999');
  const cbId = 'TESTABCD';
  const handle = setTimeout(()=>{ throw new Error('timeout não cancelado'); }, 100);
  t._preenchidosPendentes.set(cbId, {
    compraId: 'C1', item: '11', chatId: 999, etapa2MsgId: 2, timeoutId: handle,
  });
  let limparCalled = false;
  t.setLimparCampoCallback(async (ctx, motivo) => { limparCalled = true; return {}; });
  t._setPostFn(async () => ({ ok: true }));

  await t._processarLimpar(cbId, 'manual');

  assert.ok(limparCalled);
  assert.strictEqual(t._preenchidosPendentes.has(cbId), false);
  // setTimeout cancelado: aguardar > 100ms sem throw
  await new Promise(r => setTimeout(r, 150));
});
```

- [ ] **Step 2: Rodar para falhar**

```bash
cd comprasgov-browser && npm test 2>&1 | tail -20
```

Esperado: FAIL (`_processarPreencher is not a function`, etc).

- [ ] **Step 3: Implementar em `telegram.js`**

(a) Adicione no topo o monkey-patch de `_postPhoto`:

```js
let _postPhotoFn = null;
function _setPostPhotoFn(fn) { _postPhotoFn = fn; }
```

E modifique `_postPhoto` no início:

```js
function _postPhoto(chatId, buffer, caption) {
  if (_postPhotoFn) return _postPhotoFn(chatId, buffer, caption);
  return new Promise((resolve, reject) => {
```

(b) Adicione os handlers logo após `_solicitarPreenchimento`:

```js
const TIMEOUT_PREENCHIDO_MS = 10 * 60 * 1000; // 10 min

async function _processarPreencher(callbackId) {
  const pend = _preenchidosPendentes.get(callbackId);
  if (!pend) return;
  if (!_onPreencher) {
    await _post('sendMessage', { chat_id: pend.chatId, text: '❌ _onPreencher não configurado' });
    _preenchidosPendentes.delete(callbackId);
    _persistirPreenchidos();
    return;
  }

  try {
    const r = await _onPreencher(
      { compraId: pend.compraId, uasg: pend.uasg, item: pend.item },
      pend.texto,
    );
    pend.lastMessageSig = r.lastMessageSig;
    pend.preenchidoEm   = r.preenchidoEm || new Date().toISOString();

    const caption = [
      `📝 <b>Pronto para enviar</b>`,
      `Compra ${pend.compraId} / Item ${pend.item}`,
      `Texto preenchido no campo. Confirme o envio:`,
    ].join('\n');

    const photoResp = await _postPhoto(pend.chatId, r.screenshotBuffer, caption);
    if (photoResp.ok) {
      pend.etapa2MsgId = photoResp.result.message_id;
    }
    // Botões na própria foto NÃO suportados → mandamos msg separada com botões
    const botoes = await _post('sendMessage', {
      chat_id: pend.chatId,
      text: '⬇️ Ação:',
      reply_markup: {
        inline_keyboard: [[
          { text: '🚀 ENVIAR AGORA',     callback_data: `s:${callbackId}` },
          { text: '❌ Cancelar + Limpar', callback_data: `l:${callbackId}` },
        ]],
      },
    });
    if (botoes.ok && !pend.etapa2MsgId) {
      pend.etapa2MsgId = botoes.result.message_id;
    }

    pend.timeoutId = setTimeout(
      () => { _processarLimpar(callbackId, 'timeout-10min').catch(()=>{}); },
      TIMEOUT_PREENCHIDO_MS,
    );
    _persistirPreenchidos();
  } catch (err) {
    await _post('sendMessage', { chat_id: pend.chatId, text: `❌ Erro ao preencher: ${err.message}` });
    _preenchidosPendentes.delete(callbackId);
    _persistirPreenchidos();
  }
}

async function _processarEnviar(callbackId) {
  const pend = _preenchidosPendentes.get(callbackId);
  if (!pend) return;
  if (pend.timeoutId) clearTimeout(pend.timeoutId);

  if (!_onEnviarPreenchido) {
    await _post('sendMessage', { chat_id: pend.chatId, text: '❌ _onEnviarPreenchido não configurado' });
    _preenchidosPendentes.delete(callbackId);
    _persistirPreenchidos();
    return;
  }

  try {
    const r = await _onEnviarPreenchido(
      { compraId: pend.compraId, uasg: pend.uasg, item: pend.item },
      pend.lastMessageSig,
    );
    const hhmm = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    let texto = `✅ Enviado às ${hhmm}`;
    if (r.houveNovaMsg) {
      texto = `⚠️ Nova msg do pregoeiro chegou entre etapas\n${texto}`;
    }
    if (pend.etapa2MsgId) {
      await _post('editMessageText', {
        chat_id: pend.chatId, message_id: pend.etapa2MsgId,
        text: texto, parse_mode: 'HTML',
      });
    } else {
      await _post('sendMessage', { chat_id: pend.chatId, text: texto, parse_mode: 'HTML' });
    }
  } catch (err) {
    await _post('sendMessage', { chat_id: pend.chatId, text: `❌ Erro ao enviar: ${err.message}` });
  } finally {
    _preenchidosPendentes.delete(callbackId);
    _persistirPreenchidos();
  }
}

async function _processarLimpar(callbackId, motivo = 'manual') {
  const pend = _preenchidosPendentes.get(callbackId);
  if (!pend) return;
  if (pend.timeoutId) clearTimeout(pend.timeoutId);

  if (_onLimparCampo) {
    try {
      await _onLimparCampo({ compraId: pend.compraId, uasg: pend.uasg, item: pend.item }, motivo);
    } catch (e) {
      console.error('[telegram] erro ao limpar campo:', e.message);
    }
  }

  const texto = motivo === 'timeout-10min'
    ? '⏰ Expirou após 10 min — campo limpo automaticamente'
    : '❌ Cancelado — campo limpo';
  if (pend.etapa2MsgId) {
    await _post('editMessageText', {
      chat_id: pend.chatId, message_id: pend.etapa2MsgId, text: texto,
    }).catch(()=>{});
  } else {
    await _post('sendMessage', { chat_id: pend.chatId, text: texto }).catch(()=>{});
  }

  _preenchidosPendentes.delete(callbackId);
  _persistirPreenchidos();
}
```

(c) Exporte no `module.exports`:

```js
  _setPostPhotoFn,
  _processarPreencher,
  _processarEnviar,
  _processarLimpar,
```

- [ ] **Step 4: Rodar testes**

```bash
cd comprasgov-browser && npm test 2>&1 | tail -20
```

Esperado: todos PASS.

- [ ] **Step 5: Commit**

```bash
cd C:/Users/leo-p/OneDrive/Documentos/RAFAEL_PRIMO
git add comprasgov-browser/telegram.js comprasgov-browser/telegram.test.js
git commit -m "feat(telegram): handlers das 2 etapas + timeout 10min para limpar campo"
```

---

## Task 9: telegram.js — roteamento `p:`/`s:`/`l:` no `_processarCallbackQuery` + trocar `/responder` para usar `_solicitarPreenchimento`

**Files:**
- Modify: `comprasgov-browser/telegram.js`

Conecta os botões dos novos handlers ao polling loop, e troca o entry point.

- [ ] **Step 1: Modificar `_processarCallbackQuery` em `telegram.js`**

Localize a função (~ linha 347). Logo após `const acao = data.slice(0, sep);` (e ANTES do `_pendentesConfirmacao.get(callbackId)`), adicione:

```js
  // Novo fluxo de dupla confirmação
  if (acao === 'p') {
    await _post('answerCallbackQuery', { callback_query_id: cb.id, text: 'Preenchendo...' });
    await _processarPreencher(callbackId);
    return;
  }
  if (acao === 's') {
    await _post('answerCallbackQuery', { callback_query_id: cb.id, text: 'Enviando...' });
    await _processarEnviar(callbackId);
    return;
  }
  if (acao === 'l') {
    await _post('answerCallbackQuery', { callback_query_id: cb.id, text: 'Limpando...' });
    await _processarLimpar(callbackId, 'manual');
    return;
  }
```

- [ ] **Step 2: Trocar `_processarSlashResponder` para usar `_solicitarPreenchimento`**

Localize a função (~ linha 425). Substitua a chamada final por:

```js
async function _processarSlashResponder(texto, chatId) {
  const m = texto.match(/^\/responder\s+(\S+)\s+(\S+)\s+([\s\S]+)$/);
  if (!m) {
    await _post('sendMessage', {
      chat_id: chatId,
      text:    'Uso: /responder <compraId> <item> <texto>',
    });
    return;
  }
  const [, compraId, item, respTexto] = m;
  await _solicitarPreenchimento({ compraId, uasg: '?', item }, respTexto.trim(), chatId);
}
```

(Observação: a versão original aceita 2 args sem item. A nova exige `<item>` porque o novo fluxo navega para `/item/{N}`. Documente o breaking change no commit.)

- [ ] **Step 3: Trocar o ramo reply-to-message em `iniciarPolling` para usar `_solicitarPreenchimento`**

Localize o trecho (~ linha 480):

```js
            // 3) Reply em mensagem do bot (notificação de pregoeiro)
            const replyId = msg.reply_to_message?.message_id;
            if (replyId && _pregoeiroContexto.has(replyId)) {
              const ctx = _pregoeiroContexto.get(replyId);
              await _solicitarConfirmacao(ctx, texto, chatId);
              continue;
            }
```

Substitua `_solicitarConfirmacao` por `_solicitarPreenchimento`:

```js
              await _solicitarPreenchimento(ctx, texto, chatId);
```

- [ ] **Step 4: Rodar a suíte completa**

```bash
cd comprasgov-browser && npm test 2>&1 | tail -10
```

Esperado: todos PASS.

- [ ] **Step 5: Commit**

```bash
cd C:/Users/leo-p/OneDrive/Documentos/RAFAEL_PRIMO
git add comprasgov-browser/telegram.js
git commit -m "feat(telegram): roteia p/s/l no callback + /responder exige <item> no novo fluxo"
```

---

## Task 10: server.js — registra os 3 callbacks + boot cleanup de preenchidos pendentes

**Files:**
- Modify: `comprasgov-browser/server.js`

Substitui `telegram.setResponderCallback(...)` pelos 3 novos. Adiciona cleanup no boot que limpa campos preenchidos antes do server matar/reiniciar.

- [ ] **Step 1: Modificar `server.js` — substituir o setResponderCallback**

Localize o bloco (~ linha 708):

```js
      telegram.setResponderCallback(async (ctx, texto) => {
        if (!pageSessao) {
          throw new Error('Sessão pageSessao não ativa — chame POST /sessao/iniciar primeiro');
        }
        if (!ctx.item || ctx.item === '?') {
          throw new Error('Item da mensagem não identificado — contexto incompleto, responda manualmente via VNC');
        }
        return responderMensagem(pageSessao, ctx.compraId, ctx.item, texto);
      });
```

Substitua **todo** esse bloco por:

```js
      // Novo fluxo dupla confirmação: preencher → screenshot → enviar
      telegram.setPreencherCallback(async (ctx, texto) => {
        if (!pageSessao) throw new Error('Sessão pageSessao não ativa');
        if (!ctx.item || ctx.item === '?') throw new Error('Item ausente — uso: /responder <compraId> <item> <texto>');
        const r   = await preencherSemEnviar(pageSessao, ctx.compraId, ctx.item, texto);
        const buf = await capturarScreenshotChat(pageSessao);
        return { lastMessageSig: r.lastMessageSig, screenshotBuffer: buf, preenchidoEm: r.preenchidoEm };
      });

      telegram.setEnviarPreenchidoCallback(async (ctx, sigOriginal) => {
        if (!pageSessao) throw new Error('Sessão pageSessao não ativa');
        const sigAtual = await obterUltimaAssinaturaMsg(pageSessao, ctx.compraId, ctx.item);
        const houveNovaMsg = !!(sigAtual && sigOriginal && sigAtual !== sigOriginal);
        if (houveNovaMsg) {
          // registrar como race-detected antes de enviar
          require('./comprasgov')._logRespostaRaceDetected?.({ compraId: ctx.compraId, item: ctx.item, sigOrig: sigOriginal, sigNovo: sigAtual });
        }
        const r = await enviarPreenchido(pageSessao, ctx.compraId, ctx.item);
        return { enviadoEm: r.enviadoEm, houveNovaMsg };
      });

      telegram.setLimparCampoCallback(async (ctx, motivo) => {
        if (!pageSessao) return { limpoEm: new Date().toISOString(), notado: 'sem-sessao' };
        return limparCampo(pageSessao, ctx.compraId, ctx.item, motivo);
      });
```

- [ ] **Step 2: Adicionar imports no topo do server.js**

Localize onde `comprasgov` é importado (deve estar em algum `require('./comprasgov')`) e adicione os 4 nomes novos:

```js
const {
  // ...os já existentes (responderMensagem, lerMensagensChat, etc)
  preencherSemEnviar,
  enviarPreenchido,
  limparCampo,
  obterUltimaAssinaturaMsg,
  capturarScreenshotChat,
} = require('./comprasgov');
```

(Se não houver destructuring, ajuste o estilo existente — pode ser `comprasgov.preencherSemEnviar`.)

- [ ] **Step 3: Adicionar cleanup no boot**

Logo após `telegram.iniciarPolling();` (~ linha 749), adicione:

```js
      // Boot cleanup: limpa campos preenchidos pendentes (resiliência a reboot)
      const pendentes = telegram._carregarPreenchidos();
      const keys = Object.keys(pendentes);
      if (keys.length > 0) {
        console.log(`[boot] ${keys.length} preenchidos pendentes — limpando campos por segurança`);
        for (const k of keys) {
          const p = pendentes[k];
          if (pageSessao) {
            try {
              await limparCampo(pageSessao, p.compraId, p.item, 'boot-cleanup');
            } catch (e) {
              console.error(`[boot] falha ao limpar ${p.compraId}/${p.item}: ${e.message}`);
            }
          }
        }
        try {
          require('fs').unlinkSync(path.join(__dirname, 'dados', 'preenchidos-pendentes.json'));
        } catch { /* ignora se não conseguir */ }
        await telegram.enviar(`🔄 Server reiniciado — ${keys.length} preenchimento(s) pendente(s) foram limpos por segurança`);
      }
```

- [ ] **Step 4: Smoke local — só syntax check**

```bash
cd comprasgov-browser && node --check server.js 2>&1
```

Esperado: sem output (ou só warning), exit 0.

- [ ] **Step 5: Rodar a suíte de testes (não deve quebrar)**

```bash
cd comprasgov-browser && npm test 2>&1 | tail -10
```

Esperado: todos PASS.

- [ ] **Step 6: Commit**

```bash
cd C:/Users/leo-p/OneDrive/Documentos/RAFAEL_PRIMO
git add comprasgov-browser/server.js
git commit -m "feat(server): registra callbacks do fluxo de dupla confirmação + boot cleanup"
```

---

## Task 11: comprasgov.js — aposentar `TELEGRAM_RESPONDER_DRY_RUN`

**Files:**
- Modify: `comprasgov-browser/comprasgov.js`
- Modify: `comprasgov-browser/.env.example`

O novo fluxo é estritamente mais seguro. Remove o branch dry-run.

- [ ] **Step 1: Simplificar `responderMensagem` em `comprasgov.js`**

Localize a função (~ linha 249). Substitua todo o corpo (mantendo a assinatura `function responderMensagem(page, compraId, item, texto, opts = {})`) por:

```js
async function responderMensagem(page, compraId, item, texto, opts = {}) {
  if (!compraId) throw new Error('responderMensagem: compraId obrigatório');
  if (!item)     throw new Error('responderMensagem: item obrigatório (número do item)');
  if (!texto)    throw new Error('responderMensagem: texto obrigatório');
  if (!SEL_MSG.campoResposta || !SEL_MSG.botaoEnviar) {
    throw new Error('SEL_MSG.campoResposta ou SEL_MSG.botaoEnviar vazio');
  }

  const targetUrl = SEL_MSG.urlChatItem
    .replace('{item}',  String(item))
    .replace('{compra}', String(compraId));

  try {
    if (!page.url().includes(`/item/${item}`) || !page.url().includes(compraId)) {
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForTimeout(3000);
    }
    if (page.url().includes('login')) {
      throw new Error('Sessão expirada — relogar via VNC');
    }

    await page.waitForSelector(SEL_MSG.campoResposta, { timeout: 10_000 });
    await page.fill(SEL_MSG.campoResposta, texto);
    await page.click(SEL_MSG.botaoEnviar);
    await page.waitForLoadState('networkidle');
    const enviadoEm = new Date().toISOString();
    _logResposta({ ts: enviadoEm, evento: 'enviado', compraId, item, texto, modo: 'legacy-auto' });
    return { sucesso: true, enviadoEm, url: page.url() };
  } catch (e) {
    _logResposta({ ts: new Date().toISOString(), evento: 'erro', compraId, item, texto, erro: e.message });
    throw new Error(`Erro ao enviar resposta no item ${item} da compra ${compraId}: ${e.message}`);
  }
}
```

- [ ] **Step 2: Remover linha do `.env.example`**

```bash
cd comprasgov-browser
grep -v "TELEGRAM_RESPONDER_DRY_RUN" .env.example > .env.example.tmp && mv .env.example.tmp .env.example
```

Verifique:

```bash
grep DRY_RUN .env.example || echo "(removido com sucesso)"
```

Esperado: `(removido com sucesso)`.

- [ ] **Step 3: Rodar a suíte**

```bash
cd comprasgov-browser && npm test 2>&1 | tail -10
```

Esperado: todos PASS.

- [ ] **Step 4: Commit**

```bash
cd C:/Users/leo-p/OneDrive/Documentos/RAFAEL_PRIMO
git add comprasgov-browser/comprasgov.js comprasgov-browser/.env.example
git commit -m "refactor(comprasgov): aposenta TELEGRAM_RESPONDER_DRY_RUN (fluxo novo já é mais seguro)"
```

---

## Task 12: comprasgov.js — `_logRespostaRaceDetected` helper para auditoria

**Files:**
- Modify: `comprasgov-browser/comprasgov.js`

Helper trivial usado em server.js (Task 10) para gravar race detection no log.

- [ ] **Step 1: Adicionar em `comprasgov.js`**

Logo após `_logResposta` (~ linha 247):

```js
function _logRespostaRaceDetected({ compraId, item, sigOrig, sigNovo }) {
  _logResposta({ ts: new Date().toISOString(), evento: 'race-detected', compraId, item, sigOrig, sigNovo });
}
```

E adicione `_logRespostaRaceDetected` ao `module.exports`.

- [ ] **Step 2: Rodar testes**

```bash
cd comprasgov-browser && npm test 2>&1 | tail -10
```

Esperado: todos PASS.

- [ ] **Step 3: Commit**

```bash
cd C:/Users/leo-p/OneDrive/Documentos/RAFAEL_PRIMO
git add comprasgov-browser/comprasgov.js
git commit -m "feat(comprasgov): _logRespostaRaceDetected helper para auditoria"
```

---

## Task 13: Smoke test manual (checklist da §8 do spec)

**Files:**
- None (validação manual)

Pré-requisitos: Chrome rodando com CDP na 9222 + sessão logada no portal + `pageSessao` ativa (`POST /sessao/iniciar`).

- [ ] **Step 1: Subir o server**

```bash
cd C:/Users/leo-p/OneDrive/Documentos/RAFAEL_PRIMO/comprasgov-browser
node server.js > /tmp/server-novo.log 2>&1 &
sleep 3
curl -s http://127.0.0.1:3099/status
```

Esperado: `{"online": true, ...}`

- [ ] **Step 2: Caminho feliz**

No Telegram, envie:

```
/responder 15833106900092026 1 mensagem teste do fluxo novo
```

Esperado:
1. Bot responde com etapa 1 (texto + botões "Preencher" / "Cancelar")
2. Clique "Preencher" → bot envia screenshot + msg com botões "ENVIAR" / "Cancelar+Limpar"
3. Clique "ENVIAR" → bot edita pra "✅ Enviado às HH:MM"
4. Confirme via VNC: mensagem aparece no chat do pregão

- [ ] **Step 3: Cancelar etapa 1**

```
/responder 15833106900092026 1 mensagem que vai cancelar
```

Clique "Cancelar" antes de preencher. Esperado: msg do bot vira "❌ Cancelado". Via VNC: campo vazio.

- [ ] **Step 4: Cancelar etapa 2 (Cancelar+Limpar)**

Repita o /responder, clique "Preencher", veja screenshot, depois clique "Cancelar + Limpar". Esperado: msg vira "❌ Cancelado — campo limpo". Via VNC: campo vazio.

- [ ] **Step 5: Timeout 10 min**

Repita /responder → clique "Preencher" → não faça nada por 10 minutos. Esperado: msg vira "⏰ Expirou após 10 min — campo limpo automaticamente". Via VNC: campo vazio.

(Atalho para testar mais rápido: temporariamente reduza `TIMEOUT_PREENCHIDO_MS` em `telegram.js` Task 8 para `30 * 1000` e reverta após o teste.)

- [ ] **Step 6: Race condition**

Repita /responder → clique "Preencher". Via VNC, simule nova mensagem do pregoeiro (use outro browser logado como pregoeiro, ou pause aqui se não tiver acesso). Clique "ENVIAR". Esperado: msg final mostra "⚠️ Nova msg do pregoeiro chegou entre etapas\n✅ Enviado às HH:MM".

- [ ] **Step 7: Resiliência a reboot**

```bash
/responder 15833106900092026 1 teste reboot
```

Clique "Preencher" no Telegram. ANTES de clicar Enviar:

```bash
kill $(cat /tmp/server-novo.pid 2>/dev/null) || pkill -f "node server.js"
sleep 2
node server.js > /tmp/server-novo.log 2>&1 &
sleep 3
```

Esperado: bot envia `🔄 Server reiniciado — 1 preenchimento(s) pendente(s) foram limpos por segurança`. Via VNC: campo vazio. Arquivo `dados/preenchidos-pendentes.json` não existe mais.

- [ ] **Step 8: Auditoria — conferir log**

```bash
tail -20 C:/Users/leo-p/OneDrive/Documentos/RAFAEL_PRIMO/comprasgov-browser/dados/respostas-pregoeiro.log
```

Esperado: linhas JSON com campo `evento` distinto para cada etapa (`preenchido`, `enviado`, `cancelado`, `race-detected`, etc).

- [ ] **Step 9: Reverter mock do timeout (se foi reduzido para teste)**

Confira `TIMEOUT_PREENCHIDO_MS = 10 * 60 * 1000` em `telegram.js`.

- [ ] **Step 10: Commit final (se houver ajustes)**

Só commitar se houver mudanças adicionais durante o smoke test (ex: bug fix).

---

## Self-Review

Spec coverage:
- §1 motivação — não precisa task ✓
- §2 escopo — todas as inclusões cobertas, exclusões respeitadas ✓
- §3 fluxo — coberto por Tasks 7, 8, 9 ✓
- §4.1 primitivas comprasgov.js — Tasks 1, 2, 3, 4 ✓
- §4.2 telegram.js Map + handlers + callbacks — Tasks 6, 7, 8, 9 ✓
- §4.3 server.js callbacks — Task 10 ✓
- §4.4 logging com evento — coberto inline em Tasks 1, 3, 11, 12 ✓
- §4.5 preenchidos-pendentes.json + boot cleanup — Tasks 6, 10 ✓
- §5 race condition — Task 10 (server.js detecta) + Task 12 (log) ✓
- §6 timeout 10min — Task 8 (setTimeout) ✓
- §7 aposentadoria dry-run — Task 11 ✓
- §8 testes manuais — Task 13 ✓

Placeholder scan: nenhum TBD/TODO; todos os steps têm código ou comando concreto.

Type consistency: `compraId`, `item`, `texto`, `lastMessageSig`, `screenshotBuffer`, `preenchidoEm` consistentes entre Tasks 1-12.
