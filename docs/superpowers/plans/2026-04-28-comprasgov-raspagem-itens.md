# ComprasGov Raspagem de Itens — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Servidor Node.js local que expõe `POST /pregao/itens` para raspar itens públicos de um pregão do ComprasGov via Playwright, sem login.

**Architecture:** Express em 127.0.0.1:3099 + uma instância Chromium compartilhada (não-headless local) + lógica Playwright isolada em `comprasgov.js` com seletores centralizados em um objeto `SEL`. Mutex global garante uma raspagem por vez.

**Tech Stack:** Node.js 20+, Express 4.x, Playwright 1.x (Chromium).

**Spec:** `docs/superpowers/specs/2026-04-28-comprasgov-raspagem-itens-design.md`

**Notas operacionais:**
- A pasta `RAFAEL_PRIMO/` **não é um repositório git**. Os passos pulam `git commit`. Se quiser commits, rode `git init` antes de começar — não está no plano.
- TDD reduzido: o spec não pede suite automatizada. O único pedaço com teste unitário é a função pura `extrairMarcas` (regex). Tudo o mais é validado por smoke test com `curl`.
- Validação dos endpoints que tocam o browser exige um pregão real conhecido (UASG + número). Se você não tiver um à mão, peça ao Rafael antes da Task 6.

---

## File Structure

Tudo dentro de `comprasgov-browser/` na raiz do repo (`C:/Users/leo-p/OneDrive/Documentos/RAFAEL_PRIMO/comprasgov-browser/`):

| Arquivo | Responsabilidade |
|---------|-------------------|
| `package.json` | Manifesto + scripts + deps `express` e `playwright` |
| `.gitignore` | Ignora `node_modules/` e `sessions/` (sessions é só pra rodadas futuras) |
| `comprasgov.js` | Objeto `SEL`, função pura `extrairMarcas`, e três funções async que recebem `page`: `getStatus`, `rasparItensPregao`, `tirarScreenshot` |
| `comprasgov.test.js` | Testes unitários **somente** de `extrairMarcas` (puro JS, sem browser) |
| `server.js` | Express, ciclo de vida do Chromium, mutex, três endpoints (`/status`, `/screenshot`, `/pregao/itens`) |

Fora desta pasta: atualização final do `CLAUDE.md` (Task 7) refletindo o nome `comprasgov-browser/` e o escopo da rodada 1 implementado.

---

### Task 1: Scaffold do projeto

**Files:**
- Create: `comprasgov-browser/package.json`
- Create: `comprasgov-browser/.gitignore`

- [ ] **Step 1: Criar `comprasgov-browser/package.json`**

```json
{
  "name": "comprasgov-browser",
  "version": "0.1.0",
  "private": true,
  "description": "Servidor local que expõe API HTTP para raspar dados públicos do ComprasGov via Playwright.",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "test": "node --test comprasgov.test.js"
  },
  "dependencies": {
    "express": "^4.19.2",
    "playwright": "^1.47.0"
  }
}
```

- [ ] **Step 2: Criar `comprasgov-browser/.gitignore`**

```gitignore
node_modules/
sessions/
*.log
```

- [ ] **Step 3: Instalar dependências**

```bash
cd comprasgov-browser
npm install
npx playwright install chromium
```

Saída esperada: `npm install` cria `node_modules/` sem erro; `playwright install` baixa o Chromium (pode demorar 1-2 min na primeira vez).

- [ ] **Step 4: Verificar instalação**

```bash
node -e "require('express'); require('playwright'); console.log('ok')"
```

Saída esperada: `ok`

---

### Task 2: `comprasgov.js` — `extrairMarcas` (TDD, função pura)

Esta é a única peça com teste automatizado: regex sobre a descrição de um item para extrair `marcaObrigatoria` e `marcaPreferencia`.

**Files:**
- Create: `comprasgov-browser/comprasgov.test.js`
- Create: `comprasgov-browser/comprasgov.js`

- [ ] **Step 1: Escrever os testes (vão falhar)**

Conteúdo completo de `comprasgov-browser/comprasgov.test.js`:

```js
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
```

- [ ] **Step 2: Rodar os testes — confirmar que falham**

```bash
cd comprasgov-browser
npm test
```

Esperado: erro tipo `Cannot find module './comprasgov'` ou `extrairMarcas is not a function`.

- [ ] **Step 3: Criar `comprasgov-browser/comprasgov.js` mínimo (só pra fazer os testes passarem)**

Conteúdo inicial:

```js
'use strict';

function extrairMarcas(descricao) {
  const out = { marcaObrigatoria: '', marcaPreferencia: '' };
  if (!descricao || typeof descricao !== 'string') return out;

  const reObrig = /marca\s+obrigat[óo]ria\s*[:\-]\s*([^\n.;]+)/i;
  const rePref  = /marca\s+de\s+prefer[êe]ncia\s*[:\-]\s*([^\n.;]+)/i;

  const mO = descricao.match(reObrig);
  const mP = descricao.match(rePref);

  if (mO) out.marcaObrigatoria = mO[1].trim();
  if (mP) out.marcaPreferencia = mP[1].trim();
  return out;
}

module.exports = { extrairMarcas };
```

- [ ] **Step 4: Rodar os testes — confirmar que passam**

```bash
npm test
```

Esperado: `# pass 6 # fail 0`.

---

### Task 3: `server.js` — boot do browser + `/status`

Servidor mínimo que sobe o Chromium, abre `START_URL`, e responde `/status`. Sem `/pregao/itens` ainda.

**Files:**
- Create: `comprasgov-browser/server.js`

- [ ] **Step 1: Criar `comprasgov-browser/server.js`**

```js
'use strict';

const express = require('express');
const { chromium } = require('playwright');

const PORT      = parseInt(process.env.PORT || '3099', 10);
const START_URL = process.env.START_URL || 'https://www.comprasnet.gov.br';
const HEADLESS  = (process.env.HEADLESS || 'false').toLowerCase() === 'true';

let browser = null;
let page    = null;

async function bootBrowser() {
  console.log(`[boot] Lançando Chromium (headless=${HEADLESS})...`);
  browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext({ viewport: null });
  page = await context.newPage();
  await page.goto(START_URL, { waitUntil: 'domcontentloaded' });
  console.log(`[boot] Página inicial: ${page.url()}`);
}

async function shutdown(signal) {
  console.log(`\n[shutdown] Recebido ${signal}, fechando browser...`);
  try { if (browser) await browser.close(); } catch (e) { /* ignore */ }
  process.exit(0);
}

const app = express();
app.use(express.json());

app.get('/status', (req, res) => {
  res.json({
    online: true,
    browserPronto: !!page,
    url: page ? page.url() : null,
  });
});

(async () => {
  await bootBrowser();
  app.listen(PORT, '127.0.0.1', () => {
    console.log(`[boot] API rodando em http://127.0.0.1:${PORT}`);
  });
})().catch((err) => {
  console.error('[fatal] Falha no boot:', err);
  process.exit(1);
});

process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
```

- [ ] **Step 2: Subir o servidor**

```bash
cd comprasgov-browser
node server.js
```

Esperado: janela do Chrome abre visivelmente, navega para `https://www.comprasnet.gov.br`, e o terminal imprime:
```
[boot] Lançando Chromium (headless=false)...
[boot] Página inicial: https://www.comprasnet.gov.br/...
[boot] API rodando em http://127.0.0.1:3099
```

- [ ] **Step 3: Smoke test do `/status` em outro terminal**

```bash
curl http://localhost:3099/status
```

Esperado: JSON tipo `{"online":true,"browserPronto":true,"url":"https://www.comprasnet.gov.br/..."}`.

- [ ] **Step 4: Encerrar com Ctrl+C — confirmar shutdown limpo**

Esperado: terminal imprime `[shutdown] Recebido SIGINT, fechando browser...` e a janela do Chrome fecha.

---

### Task 4: `/screenshot` endpoint

**Files:**
- Modify: `comprasgov-browser/server.js`
- Modify: `comprasgov-browser/comprasgov.js`

- [ ] **Step 1: Adicionar `tirarScreenshot` em `comprasgov.js`**

Acrescentar ao final do arquivo, antes do `module.exports`:

```js
async function tirarScreenshot(page) {
  const buf = await page.screenshot({ type: 'png', fullPage: false });
  return buf.toString('base64');
}
```

E atualizar a linha de export para:

```js
module.exports = { extrairMarcas, tirarScreenshot };
```

- [ ] **Step 2: Adicionar handler `/screenshot` em `server.js`**

Acrescentar logo abaixo do require do Playwright:

```js
const { tirarScreenshot } = require('./comprasgov');
```

E acrescentar o handler logo abaixo do handler `/status`:

```js
app.get('/screenshot', async (req, res) => {
  try {
    const screenshotBase64 = await tirarScreenshot(page);
    res.json({ sucesso: true, screenshotBase64 });
  } catch (err) {
    console.error('[screenshot]', err);
    res.status(500).json({ sucesso: false, erro: err.message });
  }
});
```

- [ ] **Step 3: Reiniciar servidor e testar**

```bash
node server.js
# em outro terminal:
curl -s http://localhost:3099/screenshot | node -e "let s='';process.stdin.on('data',c=>s+=c).on('end',()=>{const j=JSON.parse(s);require('fs').writeFileSync('tela.png',Buffer.from(j.screenshotBase64,'base64'));console.log('salvo: tela.png');})"
```

Esperado: arquivo `comprasgov-browser/tela.png` criado contendo o screenshot da página atual. Abra para confirmar visualmente.

---

### Task 5: `comprasgov.js` — `rasparItensPregao` + `SEL`

Implementa a navegação e extração. Não dá pra testar com `npm test` (precisa do browser); validação será via `curl` na Task 6.

**Files:**
- Modify: `comprasgov-browser/comprasgov.js`

- [ ] **Step 1: Adicionar objeto `SEL` no topo do arquivo (logo após `'use strict';`)**

```js
const SEL = {
  campoUasg:        'input[name*="uasg" i], input[id*="uasg" i]',
  campoNumero:      'input[name*="numero" i], input[id*="numero" i]',
  botaoBuscar:      'button:has-text("Pesquisar"), button:has-text("Buscar")',
  linkItens:        'a:has-text("itens"), a[href*="itens"]',
  linhasItens:      'table tbody tr',
  colNumero:        'td:nth-child(1)',
  colDescricao:     'td:nth-child(2)',
  colQuantidade:    'td:nth-child(3)',
  colUnidade:       'td:nth-child(4)',
  colValorEstimado: 'td:nth-child(5)',
};
```

- [ ] **Step 2: Adicionar `rasparItensPregao` antes do `module.exports`**

```js
async function rasparItensPregao(page, uasg, numeroPregao, startUrl) {
  await page.goto(startUrl, { waitUntil: 'domcontentloaded' });

  await page.fill(SEL.campoUasg, String(uasg));
  await page.fill(SEL.campoNumero, String(numeroPregao));
  await page.click(SEL.botaoBuscar);
  await page.waitForLoadState('networkidle');

  await page.click(SEL.linkItens);
  await page.waitForLoadState('networkidle');

  const linhas = await page.$$eval(SEL.linhasItens, (rows, sel) => {
    const txt = (el, q) => {
      const n = el.querySelector(q);
      return n ? n.textContent.trim() : '';
    };
    const num = (s) => {
      if (!s) return null;
      const limpo = s.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
      const n = parseFloat(limpo);
      return Number.isFinite(n) ? n : null;
    };
    return rows.map((r) => ({
      numero:        txt(r, sel.colNumero),
      descricao:     txt(r, sel.colDescricao),
      quantidade:    num(txt(r, sel.colQuantidade)),
      unidade:       txt(r, sel.colUnidade),
      valorEstimado: num(txt(r, sel.colValorEstimado)),
    }));
  }, SEL);

  const itens = linhas
    .filter((l) => l.numero || l.descricao)
    .map((l) => ({ ...l, ...extrairMarcas(l.descricao) }));

  return { itens, url: page.url() };
}
```

- [ ] **Step 3: Atualizar a linha de export**

```js
module.exports = { extrairMarcas, tirarScreenshot, rasparItensPregao, SEL };
```

- [ ] **Step 4: Confirmar que os testes unitários ainda passam**

```bash
cd comprasgov-browser
npm test
```

Esperado: `# pass 6 # fail 0` (não regrediu).

---

### Task 6: `server.js` — `/pregao/itens` com mutex e validação

**Files:**
- Modify: `comprasgov-browser/server.js`

- [ ] **Step 1: Importar `rasparItensPregao`**

Substituir a linha:
```js
const { tirarScreenshot } = require('./comprasgov');
```
por:
```js
const { tirarScreenshot, rasparItensPregao } = require('./comprasgov');
```

- [ ] **Step 2: Adicionar mutex global (logo após as variáveis `let browser/page`)**

```js
let busy = false;
```

- [ ] **Step 3: Adicionar handler `/pregao/itens` (abaixo do `/screenshot`)**

```js
app.post('/pregao/itens', async (req, res) => {
  const { uasg, numeroPregao } = req.body || {};
  if (!uasg)         return res.status(400).json({ erro: 'campo "uasg" obrigatório' });
  if (!numeroPregao) return res.status(400).json({ erro: 'campo "numeroPregao" obrigatório' });

  if (busy) return res.status(409).json({ erro: 'ocupado' });
  busy = true;

  try {
    const { itens, url } = await rasparItensPregao(page, uasg, numeroPregao, START_URL);
    res.json({
      sucesso: true,
      uasg: String(uasg),
      numeroPregao: String(numeroPregao),
      totalItens: itens.length,
      itens,
      url,
    });
  } catch (err) {
    console.error('[pregao/itens]', err);
    res.status(500).json({
      sucesso: false,
      erro: err.message,
      dica: 'Rode GET /screenshot para ver o estado atual da página.',
    });
  } finally {
    busy = false;
  }
});
```

- [ ] **Step 4: Smoke test — campos faltando (validação)**

```bash
node server.js
# em outro terminal:
curl -s -X POST http://localhost:3099/pregao/itens -H "Content-Type: application/json" -d '{}'
curl -s -X POST http://localhost:3099/pregao/itens -H "Content-Type: application/json" -d '{"uasg":"123"}'
```

Esperado:
```
{"erro":"campo \"uasg\" obrigatório"}
{"erro":"campo \"numeroPregao\" obrigatório"}
```

- [ ] **Step 5: Smoke test — raspagem com pregão real**

Substitua `<UASG>` e `<NUM>` por valores reais (peça ao Rafael um pregão público conhecido):

```bash
curl -s -X POST http://localhost:3099/pregao/itens \
  -H "Content-Type: application/json" \
  -d '{"uasg":"<UASG>","numeroPregao":"<NUM>"}' | node -e "let s='';process.stdin.on('data',c=>s+=c).on('end',()=>console.log(JSON.stringify(JSON.parse(s),null,2)))"
```

Resultados possíveis:
- **Ideal:** `sucesso: true`, `totalItens > 0`, itens com `numero` e `descricao` preenchidos. ✅
- **Comum na 1ª execução:** `totalItens: 0` ou erro 500 — significa que algum seletor de `SEL` em `comprasgov.js` está errado para o HTML real do ComprasGov. Vá para o Step 6.
- **Erro de timeout:** o `START_URL` provavelmente não é a URL da tela de busca. Olhe a janela do Chrome aberta; se ela parou em uma home institucional, descubra a URL real da busca pública e exporte `START_URL=<url>` antes de subir o servidor.

- [ ] **Step 6 (condicional): Ajuste de seletores via DevTools**

Se Step 5 falhou:
1. Na janela do Chrome controlado pelo Playwright, abra DevTools (F12).
2. Inspecione o campo de UASG, o de número, o botão "Pesquisar", o link/aba "Itens", e a tabela de itens.
3. Atualize o objeto `SEL` em `comprasgov-browser/comprasgov.js`.
4. Reinicie `node server.js` e repita Step 5 até `totalItens > 0`.

Não passe pra Task 7 enquanto não conseguir um retorno com itens reais.

- [ ] **Step 7: Smoke test — mutex (409 em paralelo)**

Em três terminais quase simultâneos:

```bash
# terminal A
curl -s -X POST http://localhost:3099/pregao/itens -H "Content-Type: application/json" -d '{"uasg":"<UASG>","numeroPregao":"<NUM>"}' &
# terminal B (imediatamente):
curl -s -X POST http://localhost:3099/pregao/itens -H "Content-Type: application/json" -d '{"uasg":"<UASG>","numeroPregao":"<NUM>"}'
```

Esperado: a segunda chamada responde `{"erro":"ocupado"}` (HTTP 409) enquanto a primeira ainda está processando.

---

### Task 7: Atualizar `CLAUDE.md` (Projeto 2 — status)

**Files:**
- Modify: `CLAUDE.md` (seção PROJETO 2)

- [ ] **Step 1: Trocar nome de pasta no CLAUDE.md**

No bloco de árvore de arquivos da seção PROJETO 2, substituir:

```
browser/
├── server.js          ← servidor Express + lógica Playwright
├── package.json       ← dependências: playwright, express
├── setup.sh           ← script de instalação para a VPS
└── sessions/          ← pasta de sessão do Chrome (gitignore)
```

por:

```
comprasgov-browser/        ← rodada 1: raspagem pública implementada
├── server.js              ← Express + ciclo de vida do Chromium + endpoints
├── comprasgov.js          ← lógica Playwright + objeto SEL com seletores
├── comprasgov.test.js     ← testes unitários de extrairMarcas
├── package.json           ← deps: express, playwright
├── .gitignore
└── (futuro) setup.sh + sessions/  ← rodadas seguintes
```

- [ ] **Step 2: Atualizar a tabela "API do servidor"**

Substituir:

```
POST /mensagens/ler       → { "numeroPregao": "90148/2025" }
POST /mensagens/responder → { "numeroPregao": "...", "texto": "..." }
GET  /status              → health check
```

por:

```
GET  /status              → health check + estado do browser
POST /pregao/itens        → { "uasg": "...", "numeroPregao": "..." }   (rodada 1: ✅ implementado)
GET  /screenshot          → PNG base64 da página atual
POST /mensagens/ler       → (rodada 2: pendente)
POST /mensagens/responder → (rodada 2: pendente)
```

- [ ] **Step 3: Atualizar a linha de status**

Trocar:
```
Status: **DESENVOLVIMENTO LOCAL** — ainda não está na VPS
```
por:
```
Status: **DESENVOLVIMENTO LOCAL — rodada 1 (raspagem pública) implementada.** Mensagens com login e migração para VPS ainda pendentes.
```

- [ ] **Step 4: Adicionar referência ao spec e plan**

Logo abaixo da linha de status, acrescentar:
```
- Spec rodada 1: `docs/superpowers/specs/2026-04-28-comprasgov-raspagem-itens-design.md`
- Plan rodada 1: `docs/superpowers/plans/2026-04-28-comprasgov-raspagem-itens.md`
```

---

## Critério de "pronto"

Rodada 1 está concluída quando:

1. `cd comprasgov-browser && npm test` → 6 testes passando.
2. `node server.js` sobe sem erro, abre Chrome visível, navega para `START_URL`.
3. `curl /status` → `{"online":true,"browserPronto":true,"url":"..."}`.
4. `curl /screenshot` → PNG válido salvo no disco.
5. `curl -X POST /pregao/itens` com um pregão real conhecido → `totalItens > 0` com `numero` e `descricao` preenchidos para todos os itens.
6. CLAUDE.md atualizado refletindo o nome `comprasgov-browser/` e o estado da rodada 1.
