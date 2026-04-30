# Rodada 2 — Login Manual + Mensagens + Propostas (Legado) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar recon ao vivo do portal legado `comprasnet.gov.br` e as funções de leitura/resposta de mensagens e raspagem de propostas, todas operando sobre uma sessão autenticada via Playwright.

**Architecture:** Fase 1 adiciona endpoints de recon ao servidor Express existente (operam sobre `pageSessao`). Fase 2 é um checkpoint manual onde o Rafael loga e executamos o recon para capturar o HTML real das páginas. Fase 3 preenche os seletores descobertos e implementa as funções de scraping com a função pura `parsearLinhasPropostas` (testável sem browser).

**Tech Stack:** Node.js 20+, Express, Playwright, `node --test` (runner nativo), `node:assert`

---

## Mapa de arquivos

| Arquivo | O que muda |
|---|---|
| `server.js` | +`POST /recon/navegar`, +`GET /recon/html`, estende `GET /screenshot?sessao=1`, +`POST /pregao/propostas` |
| `comprasgov.js` | +`SEL_PROP`, +`parsearLinhasPropostas`, +`parseValorProposta`, +`lerPropostasPregao`; corrige `SEL_MSG`, `lerMensagensChat`, `responderMensagem` |
| `comprasgov.test.js` | +testes para `parsearLinhasPropostas` e `parseValorProposta` |

---

## Task 1 — Endpoints de recon no `server.js`

**Files:**
- Modify: `server.js` (após o bloco de endpoints de sessão, ~linha 422)

### Contexto

`pageSessao` é a variável global que guarda a página autenticada (criada por `POST /sessao/iniciar`).
`dados/` já existe no projeto. O helper `fs` e `path` ainda não estão importados em `server.js` — adicionar.

- [ ] **Passo 1: Adicionar `require('fs')` e `require('path')` no topo de `server.js`**

Abrir `server.js`. As primeiras linhas são:
```js
'use strict';

const express = require('express');
const { chromium } = require('playwright');
```

Adicionar logo abaixo de `'use strict';`:
```js
const fs   = require('fs');
const path = require('path');
```

- [ ] **Passo 2: Estender `GET /screenshot` para suportar `?sessao=1`**

Localizar o handler atual (em torno da linha 53):
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

Substituir por:
```js
app.get('/screenshot', async (req, res) => {
  const alvo = req.query.sessao === '1' ? pageSessao : page;
  if (!alvo) {
    return res.status(503).json({ sucesso: false, erro: req.query.sessao === '1'
      ? 'Sem sessão ativa — chame POST /sessao/iniciar'
      : 'Browser principal não iniciado' });
  }
  try {
    const screenshotBase64 = await tirarScreenshot(alvo);
    res.json({ sucesso: true, screenshotBase64 });
  } catch (err) {
    console.error('[screenshot]', err);
    res.status(500).json({ sucesso: false, erro: err.message });
  }
});
```

- [ ] **Passo 3: Adicionar bloco de endpoints de recon após o bloco de endpoints de sessão**

Logo após o handler `POST /sessao/encerrar` (~linha 422), inserir:

```js
// ───────────────────────────────────────────────────────────────────────────
// Endpoints de RECON — navegação e dump HTML da sessão autenticada
// ───────────────────────────────────────────────────────────────────────────

/**
 * POST /recon/navegar
 * Body: { url: string }
 * Navega pageSessao para a URL informada. Usar para explorar o portal após login.
 */
app.post('/recon/navegar', async (req, res) => {
  const { url } = req.body || {};
  if (!url)      return res.status(400).json({ erro: 'campo "url" obrigatório' });
  if (!pageSessao) return res.status(401).json({ erro: 'Sem sessão ativa — chame POST /sessao/iniciar' });

  try {
    await pageSessao.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    res.json({ sucesso: true, url: pageSessao.url() });
  } catch (err) {
    console.error('[recon/navegar]', err.message);
    res.status(500).json({ sucesso: false, erro: err.message });
  }
});

/**
 * GET /recon/html
 * Salva o HTML completo da página atual de pageSessao em dados/recon-<timestamp>.html
 * e retorna o caminho do arquivo. Usar após /recon/navegar.
 */
app.get('/recon/html', async (req, res) => {
  if (!pageSessao) return res.status(401).json({ erro: 'Sem sessão ativa — chame POST /sessao/iniciar' });

  try {
    const html      = await pageSessao.content();
    const arquivo   = path.join(__dirname, 'dados', `recon-${Date.now()}.html`);
    fs.writeFileSync(arquivo, html, 'utf8');
    console.log(`[recon/html] Salvo: ${arquivo} (${html.length} bytes)`);
    res.json({ sucesso: true, arquivo, bytes: html.length, urlCapturada: pageSessao.url() });
  } catch (err) {
    console.error('[recon/html]', err.message);
    res.status(500).json({ sucesso: false, erro: err.message });
  }
});
```

- [ ] **Passo 4: Verificar que `dados/` existe no disco**

```bash
ls dados/
```

Esperado: pasta existe (criada pela rodada anterior). Se não existir:
```bash
mkdir dados
```

- [ ] **Passo 5: Reiniciar o servidor e testar os guards sem sessão**

```bash
# Terminal 1
node server.js
```

```bash
# Terminal 2 — deve retornar 401
curl -s -X POST http://localhost:3099/recon/navegar \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com"}' | node -e "process.stdin|>require('fs').createReadStream|>console.log" 
```

Forma mais simples:
```bash
curl -s -X POST http://localhost:3099/recon/navegar \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com"}'
```
Esperado: `{"erro":"Sem sessão ativa — chame POST /sessao/iniciar"}`

```bash
curl -s http://localhost:3099/recon/html
```
Esperado: `{"erro":"Sem sessão ativa — chame POST /sessao/iniciar"}`

- [ ] **Passo 6: Commit**

```bash
git add server.js
git commit -m "feat(recon): endpoints /recon/navegar, /recon/html e screenshot?sessao=1"
```

---

## Task 2 — Funções puras de parsing em `comprasgov.js` (com testes)

**Files:**
- Modify: `comprasgov.js`
- Modify: `comprasgov.test.js`

### Contexto

`lerPropostasPregao` precisará transformar linhas de uma tabela HTML em objetos estruturados.
Extraímos essa lógica como funções puras (`parseValorProposta` e `parsearLinhasPropostas`) — testáveis sem browser, seguindo o mesmo padrão de `extrairMarcas`.

- [ ] **Passo 1: Escrever os testes que devem falhar primeiro**

Abrir `comprasgov.test.js`. Na linha 3, o require atual é:
```js
const { extrairMarcas } = require('./comprasgov');
```
Substituir por:
```js
const { extrairMarcas, parsearLinhasPropostas, parseValorProposta } = require('./comprasgov');
```

Adicionar ao final do arquivo (antes do último `\n`):

// --- parseValorProposta ---

test('parseValorProposta converte "R$ 1.250,99" em 1250.99', () => {
  assert.strictEqual(parseValorProposta('R$ 1.250,99'), 1250.99);
});

test('parseValorProposta retorna null para string vazia', () => {
  assert.strictEqual(parseValorProposta(''), null);
});

test('parseValorProposta retorna null para texto sem número', () => {
  assert.strictEqual(parseValorProposta('---'), null);
});

// --- parsearLinhasPropostas ---

test('parsearLinhasPropostas mapeia linha completa', () => {
  const linhas = [['1', 'Empresa Ltda', '12.345.678/0001-90', 'R$ 500,00', 'Classificada', 'HP']];
  const r = parsearLinhasPropostas(linhas);
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].item, '1');
  assert.strictEqual(r[0].fornecedor, 'Empresa Ltda');
  assert.strictEqual(r[0].cnpj, '12.345.678/0001-90');
  assert.strictEqual(r[0].valorProposta, 500);
  assert.strictEqual(r[0].situacao, 'Classificada');
  assert.strictEqual(r[0].marca, 'HP');
});

test('parsearLinhasPropostas filtra linhas sem fornecedor e sem item', () => {
  const linhas = [['', '', '', '', '', '']];
  const r = parsearLinhasPropostas(linhas);
  assert.strictEqual(r.length, 0);
});

test('parsearLinhasPropostas aceita valor null/undefined em campos opcionais', () => {
  const linhas = [['2', 'Fornecedor X', '', '', '', '']];
  const r = parsearLinhasPropostas(linhas);
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].valorProposta, null);
  assert.strictEqual(r[0].marca, '');
});
```

- [ ] **Passo 2: Rodar os testes — devem falhar porque as funções não existem**

```bash
node --test comprasgov.test.js
```

Esperado: erro `TypeError: parsearLinhasPropostas is not a function` (ou similar).

- [ ] **Passo 3: Implementar `parseValorProposta` e `parsearLinhasPropostas` em `comprasgov.js`**

Localizar a função `extrairMarcas` (~linha 49). Inserir antes dela:

```js
// ---------------------------------------------------------------------------
// parseValorProposta — converte string monetária em número (ex: "R$ 1.250,99" → 1250.99)
// ---------------------------------------------------------------------------
function parseValorProposta(s) {
  if (!s) return null;
  const limpo = s.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
  const n = parseFloat(limpo);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// parsearLinhasPropostas — função pura: array de arrays de strings → array de objetos
// Cada elemento de `linhas` é [item, fornecedor, cnpj, valor, situacao, marca]
// ---------------------------------------------------------------------------
function parsearLinhasPropostas(linhas) {
  return linhas
    .map((r) => ({
      item:          r[0] || '',
      fornecedor:    r[1] || '',
      cnpj:          r[2] || '',
      valorProposta: parseValorProposta(r[3]),
      situacao:      r[4] || '',
      marca:         r[5] || '',
    }))
    .filter((p) => p.fornecedor || p.item);
}
```

Localizar o `module.exports` no final de `comprasgov.js` e substituir por:
```js
module.exports = {
  extrairMarcas,
  parsearLinhasPropostas,
  parseValorProposta,
  tirarScreenshot,
  rasparItensPregao,
  lerMensagensChat,
  responderMensagem,
  SEL,
  SEL_MSG,
};
```
(Note: `lerPropostasPregao` e `SEL_PROP` são adicionados ao `module.exports` no Task 3.)

- [ ] **Passo 4: Rodar os testes — devem passar todos**

```bash
node --test comprasgov.test.js
```

Esperado: todos os testes passando (os 8 anteriores + os 5 novos = 13 testes).

- [ ] **Passo 5: Commit**

```bash
git add comprasgov.js comprasgov.test.js
git commit -m "feat(parsing): parseValorProposta + parsearLinhasPropostas com 5 testes"
```

---

## Task 3 — `SEL_PROP`, `lerPropostasPregao` e `POST /pregao/propostas`

**Files:**
- Modify: `comprasgov.js`
- Modify: `server.js`

### Contexto

Os valores de `SEL_PROP` ficarão como strings vazias neste passo — serão preenchidos no **Task 5** após o recon manual (Task 4). O código da função já estará correto; apenas os seletores precisarão de ajuste.

- [ ] **Passo 1: Adicionar `SEL_PROP` em `comprasgov.js`**

Localizar o bloco `SEL_MSG` (~linha 26). Logo abaixo dele, adicionar:

```js
// ---------------------------------------------------------------------------
// Seletores de propostas — portal legado (comprasnet.gov.br)
// ⚠️ RECON_NEEDED: preencher após Task 4 (recon manual)
// ---------------------------------------------------------------------------
const SEL_PROP = {
  urlPropostas:    '',  // ← recon: URL da página de consulta de propostas para fornecedor
  campoUasg:       '',  // ← recon
  campoNumero:     '',  // ← recon
  botaoBuscar:     '',  // ← recon
  linhasPropostas: '',  // ← recon: seletor das linhas da tabela de propostas
};
```

- [ ] **Passo 2: Implementar `lerPropostasPregao` em `comprasgov.js`**

Localizar a função `responderMensagem` (~linha 153). Adicionar após ela:

```js
// ---------------------------------------------------------------------------
// lerPropostasPregao — requer sessão logada
// ⚠️ SEL_PROP precisa ser preenchido após recon (Task 4)
// ---------------------------------------------------------------------------
async function lerPropostasPregao(page, uasg, numeroPregao) {
  if (!SEL_PROP.urlPropostas) {
    throw new Error('SEL_PROP não configurado — execute o recon (Task 4) e preencha os seletores');
  }

  await page.goto(SEL_PROP.urlPropostas, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForLoadState('networkidle');

  if (page.url().includes('login')) {
    throw new Error('Sessão expirada — faça login via POST /sessao/iniciar');
  }

  try {
    await page.fill(SEL_PROP.campoUasg, String(uasg));
    await page.fill(SEL_PROP.campoNumero, String(numeroPregao));
    await page.click(SEL_PROP.botaoBuscar);
    await page.waitForLoadState('networkidle');
  } catch (e) {
    throw new Error(
      `Seletores de propostas não encontrados (⚠️ RECON_NEEDED). ` +
      `Use GET /recon/html para inspecionar. Erro: ${e.message}`
    );
  }

  const rawLinhas = await page.$$eval(SEL_PROP.linhasPropostas, (rows) => {
    return rows.map((r) => {
      const cols = Array.from(r.querySelectorAll('td'));
      return cols.map((c) => c.textContent.trim());
    });
  });

  const propostas = parsearLinhasPropostas(rawLinhas);
  return { propostas, total: propostas.length, url: page.url() };
}
```

Adicionar `lerPropostasPregao` e `SEL_PROP` ao `module.exports`:

```js
module.exports = {
  extrairMarcas,
  parsearLinhasPropostas,
  parseValorProposta,
  tirarScreenshot,
  rasparItensPregao,
  lerMensagensChat,
  responderMensagem,
  lerPropostasPregao,
  SEL,
  SEL_MSG,
  SEL_PROP,
};
```

- [ ] **Passo 3: Adicionar `lerPropostasPregao` ao `require` no topo de `server.js`**

Localizar linha 5:
```js
const { tirarScreenshot, rasparItensPregao, lerMensagensChat, responderMensagem } = require('./comprasgov');
```

Substituir por:
```js
const { tirarScreenshot, rasparItensPregao, lerMensagensChat, responderMensagem, lerPropostasPregao } = require('./comprasgov');
```

- [ ] **Passo 4: Adicionar `POST /pregao/propostas` no `server.js`**

Localizar o handler `POST /mensagens/responder` (~linha 464). Adicionar após ele:

```js
/**
 * POST /pregao/propostas
 * Body: { uasg, numeroPregao }
 * Raspa propostas de um pregão. Requer sessão ativa (POST /sessao/iniciar primeiro).
 * SEL_PROP deve estar preenchido (Task 4 do plano de implementação).
 */
app.post('/pregao/propostas', async (req, res) => {
  const { uasg, numeroPregao } = req.body || {};
  if (!uasg)         return res.status(400).json({ erro: 'campo "uasg" obrigatório' });
  if (!numeroPregao) return res.status(400).json({ erro: 'campo "numeroPregao" obrigatório' });
  if (!pageSessao)   return res.status(401).json({ erro: 'Sem sessão ativa — chame POST /sessao/iniciar primeiro' });

  if (busy) return res.status(409).json({ erro: 'ocupado' });
  busy = true;

  try {
    const resultado = await lerPropostasPregao(pageSessao, uasg, numeroPregao);
    res.json({
      sucesso: true,
      uasg: String(uasg),
      numeroPregao: String(numeroPregao),
      totalPropostas: resultado.total,
      propostas: resultado.propostas,
      url: resultado.url,
    });
  } catch (err) {
    console.error('[pregao/propostas]', err.message);
    res.status(500).json({ sucesso: false, erro: err.message });
  } finally {
    busy = false;
  }
});
```

- [ ] **Passo 5: Verificar guards do novo endpoint (sem sessão ativa)**

```bash
node server.js
```

```bash
curl -s -X POST http://localhost:3099/pregao/propostas \
  -H "Content-Type: application/json" \
  -d '{"uasg":"160304","numeroPregao":"00001/2026"}'
```
Esperado: `{"erro":"Sem sessão ativa — chame POST /sessao/iniciar primeiro"}`

```bash
curl -s -X POST http://localhost:3099/pregao/propostas \
  -H "Content-Type: application/json" \
  -d '{"numeroPregao":"00001/2026"}'
```
Esperado: `{"erro":"campo \"uasg\" obrigatório"}`

- [ ] **Passo 6: Commit**

```bash
git add comprasgov.js server.js
git commit -m "feat(propostas): SEL_PROP + lerPropostasPregao + POST /pregao/propostas"
```

---

## Task 4 — RECON MANUAL (checkpoint humano — não automatizável)

**Files:** Nenhum arquivo de código alterado neste passo.

> Este passo requer que o Rafael execute os comandos manualmente com o servidor rodando.
> O objetivo é capturar o HTML real das páginas de mensagens e propostas do `comprasnet.gov.br`.

- [ ] **Passo 1: Iniciar o servidor**

```bash
node server.js
```

- [ ] **Passo 2: Abrir a janela de login**

```bash
curl -s -X POST http://localhost:3099/sessao/iniciar \
  -H "Content-Type: application/json"
```

Uma janela do Chrome abrirá em `comprasnet.gov.br/seguro/loginPortal.asp`.

- [ ] **Passo 3: Fazer o login manualmente na janela aberta**

Inserir usuário e senha do Rafael. Aguardar redirecionamento para área logada.

- [ ] **Passo 4: Verificar que o login foi detectado e a sessão foi salva**

```bash
curl -s http://localhost:3099/sessao/status
```

Esperado: `{"logado":true,"sessaoSalva":true,...}`

- [ ] **Passo 5: Navegar para a página de mensagens e capturar HTML**

```bash
curl -s -X POST http://localhost:3099/recon/navegar \
  -H "Content-Type: application/json" \
  -d '{"url":"https://www.comprasnet.gov.br/livre/fornecedor/mensagem/consultarMensagemFornecedor.asp"}'
```

Se redirecionar para login, a URL está errada — ver screenshot para descobrir a URL correta:
```bash
curl -s "http://localhost:3099/screenshot?sessao=1" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));require('fs').writeFileSync('/tmp/tela.png',Buffer.from(d.screenshotBase64,'base64'));console.log('Salvo: /tmp/tela.png')"
```

Capturar o HTML:
```bash
curl -s http://localhost:3099/recon/html
```

Esperado: `{"sucesso":true,"arquivo":"...dados/recon-<timestamp>.html","bytes":...}`

- [ ] **Passo 6: Inspecionar o HTML de mensagens e anotar os seletores**

Abrir o arquivo `dados/recon-<timestamp>.html` no browser ou num editor.

Procurar por:
- Campo de UASG → anotar `name` ou `id` do `<input>`
- Campo de número do pregão → anotar `name` ou `id`
- Botão de busca → anotar `type`, `value` ou `id`
- Tabela de resultados → anotar classe ou `id` da `<table>` ou `<tbody>`
- Colunas remetente / data / texto → anotar índice `nth-child`
- Link/botão "Responder" → anotar seletor

- [ ] **Passo 7: Navegar para a página de propostas e capturar HTML**

Navegar para a área do fornecedor que lista propostas. A URL exata depende da versão do portal — tentar:
```bash
curl -s -X POST http://localhost:3099/recon/navegar \
  -H "Content-Type: application/json" \
  -d '{"url":"https://www.comprasnet.gov.br/livre/fornecedor/propostas/consultarPropostaFornecedor.asp"}'
```

Verificar com screenshot se chegou na página certa. Capturar HTML:
```bash
curl -s http://localhost:3099/recon/html
```

- [ ] **Passo 8: Inspecionar o HTML de propostas e anotar os seletores**

Mesma lógica do passo 6: campo UASG, campo número, botão, tabela, colunas.

---

## Task 5 — Preencher `SEL_MSG` e `SEL_PROP` com seletores reais

**Files:**
- Modify: `comprasgov.js`

> Este passo usa os seletores descobertos no Task 4. Substituir os valores `''` pelos seletores reais.

- [ ] **Passo 1: Atualizar `SEL_MSG` com os seletores reais de mensagens**

No `comprasgov.js`, localizar o objeto `SEL_MSG` (~linha 26). Substituir pelos valores descobertos no recon.

Exemplo (valores ilustrativos — substituir pelos reais do HTML):
```js
const SEL_MSG = {
  urlChat:         'https://www.comprasnet.gov.br/livre/fornecedor/mensagem/consultarMensagemFornecedor.asp',
  campoChatUasg:   'input[name="co_uasg"]',
  campoChatNumero: 'input[name="numprp"]',
  botaoChatBuscar: 'input[type="submit"][value="Consultar"]',
  linhasMensagens: '#resultado tbody tr',
  colMsgRemetente: 'td:nth-child(1)',
  colMsgDataHora:  'td:nth-child(2)',
  colMsgTexto:     'td:nth-child(3)',
  linkResponder:   'a:has-text("Responder")',
  campoResposta:   'textarea[name="ds_mensagem"]',
  botaoEnviar:     'input[type="submit"][value="Enviar"]',
};
```

**Substituir pelos valores REAIS encontrados no HTML do recon.**

- [ ] **Passo 2: Atualizar `SEL_PROP` com os seletores reais de propostas**

Mesmo processo para `SEL_PROP`:
```js
const SEL_PROP = {
  urlPropostas:    'https://www.comprasnet.gov.br/livre/fornecedor/propostas/...',  // URL real
  campoUasg:       'input[name="co_uasg"]',         // seletor real
  campoNumero:     'input[name="numprp"]',           // seletor real
  botaoBuscar:     'input[type="submit"][value="..."]',  // seletor real
  linhasPropostas: 'table.resultado tbody tr',       // seletor real
};
```

**Substituir pelos valores REAIS encontrados no HTML do recon.**

- [ ] **Passo 3: Commit com os seletores confirmados**

```bash
git add comprasgov.js
git commit -m "fix(seletores): SEL_MSG e SEL_PROP preenchidos com seletores reais do recon"
```

---

## Task 6 — Corrigir `lerMensagensChat` e `responderMensagem`

**Files:**
- Modify: `comprasgov.js`

### Contexto

As funções já estão implementadas mas `$$eval` usa `SEL_MSG` como argumento passado ao contexto do browser. Após preencher `SEL_MSG`, precisamos validar que a extração das colunas está correta.

- [ ] **Passo 1: Verificar a extração de colunas em `lerMensagensChat`**

A função atual (~linha 114) usa:
```js
const mensagens = await page.$$eval(SEL_MSG.linhasMensagens, (rows, sel) => {
    const txt = (el, q) => { const n = el.querySelector(q); return n ? n.textContent.trim() : ''; };
    return rows
      .map((r) => ({
        remetente: txt(r, sel.colMsgRemetente),
        dataHora:  txt(r, sel.colMsgDataHora),
        texto:     txt(r, sel.colMsgTexto),
      }))
      .filter((m) => m.texto);
  }, SEL_MSG);
```

Este padrão é correto — passa `SEL_MSG` como segundo argumento para que os seletores estejam disponíveis no contexto do browser. Nenhuma mudança de código necessária aqui; apenas verificar que `SEL_MSG` tem os valores corretos após o Task 5.

- [ ] **Passo 2: Testar `lerMensagensChat` com um pregão real**

Com o servidor rodando e sessão ativa:
```bash
curl -s -X POST http://localhost:3099/mensagens/ler \
  -H "Content-Type: application/json" \
  -d '{"uasg":"SEU_UASG","numeroPregao":"SEU_NUMERO"}'
```

Esperado: `{"sucesso":true,"mensagens":[...],"total":N,...}`

Se `total: 0` mas a página tem mensagens, revisar os seletores `colMsgRemetente`, `colMsgDataHora`, `colMsgTexto` e o índice `nth-child`.

- [ ] **Passo 3: Testar `responderMensagem` (opcional — com cuidado)**

> ⚠️ Este teste envia uma mensagem real no pregão. Usar apenas em pregão de teste ou após confirmação do Rafael.

```bash
curl -s -X POST http://localhost:3099/mensagens/responder \
  -H "Content-Type: application/json" \
  -d '{"uasg":"SEU_UASG","numeroPregao":"SEU_NUMERO","texto":"Mensagem de teste."}'
```

Esperado: `{"sucesso":true,"enviado":true,...}`

- [ ] **Passo 4: Testar `lerPropostasPregao` com um pregão real**

```bash
curl -s -X POST http://localhost:3099/pregao/propostas \
  -H "Content-Type: application/json" \
  -d '{"uasg":"SEU_UASG","numeroPregao":"SEU_NUMERO"}'
```

Esperado: `{"sucesso":true,"propostas":[...],"totalPropostas":N,...}`

- [ ] **Passo 5: Commit final**

```bash
git add comprasgov.js
git commit -m "feat(rodada2): lerMensagensChat + responderMensagem + lerPropostasPregao operacionais"
```

---

## Resumo das tasks e dependências

```
Task 1 (recon endpoints)       ─┐
Task 2 (parsing + testes)       ├─ podem rodar em qualquer ordem
Task 3 (lerPropostasPregao)    ─┘

Task 4 (RECON MANUAL)          ← depende de Task 1 estar no servidor

Task 5 (preencher seletores)   ← depende de Task 4
Task 6 (teste e2e)             ← depende de Task 5
```
