# Raspagem de itens avulsos via Telegram (`/raspar`) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar um comando Telegram `/raspar <compraId> <itens>` que raspa apenas os itens pedidos de um pregão e devolve um Excel só com eles.

**Architecture:** Função isolada `rasparItensEspecificos()` em `lote-runner.js` que reusa o motor de extração existente (`navegarParaItemGoto`, `recuperarCompra`, `extrairDadosPaginaAtual`, `verificarSessao`, `gerarExcel`) sobre a aba logada do Chrome. O Telegram parseia o comando e delega a um callback registrado pelo `server.js`, espelhando o padrão já usado por `/retomar`. Não toca em `lote-estado.json`.

**Tech Stack:** Node.js 20+, Playwright (CDP no Chrome do usuário), ExcelJS, `node:test` para testes unitários.

**Spec:** `docs/superpowers/specs/2026-05-26-comprasgov-raspar-itens-avulso-telegram-design.md`

---

## Estrutura de arquivos

| Arquivo | Responsabilidade | Ação |
|---------|------------------|------|
| `comprasgov-browser/raspar-propostas-cdp.js` | Extração + geração de Excel | Modificar: `gerarExcel` aceita `opts.sufixo`; extrair helper puro `_nomeArquivoExcel` |
| `comprasgov-browser/raspar-propostas-cdp.test.js` | Teste do nome do Excel | Criar |
| `comprasgov-browser/package.json` | Script de teste | Modificar: incluir o novo arquivo de teste |
| `comprasgov-browser/telegram.js` | Bot: parsing, callback, handler | Modificar: `_parseItens`, `_onRaspar`/`setRasparCallback`, `_processarSlashRaspar`, handler no polling, exports |
| `comprasgov-browser/telegram.test.js` | Testes do parser e do roteamento | Modificar: adicionar testes |
| `comprasgov-browser/lote-runner.js` | Motor de raspagem | Modificar: adicionar `rasparItensEspecificos`, exportar |
| `comprasgov-browser/server.js` | Fiação do callback + lock | Modificar: registrar `setRasparCallback`, lock `_avulsaEmAndamento` |

Diretório de trabalho dos comandos: `comprasgov-browser/`.

---

## Task 1: `gerarExcel` aceita sufixo (nome distinto pro avulso)

**Files:**
- Modify: `comprasgov-browser/raspar-propostas-cdp.js` (função `gerarExcel`, ~341-450; bloco `module.exports`, ~628)
- Test: `comprasgov-browser/raspar-propostas-cdp.test.js` (criar)
- Modify: `comprasgov-browser/package.json` (script `test`)

- [ ] **Step 1: Escrever o teste que falha**

Criar `comprasgov-browser/raspar-propostas-cdp.test.js`:

```javascript
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
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `cd comprasgov-browser && node --test raspar-propostas-cdp.test.js`
Expected: FAIL — `_nomeArquivoExcel` não é exportado (`undefined is not a function`).

- [ ] **Step 3: Implementar o helper e usar em `gerarExcel`**

Em `raspar-propostas-cdp.js`, adicionar o helper puro logo antes de `async function gerarExcel`:

```javascript
function _nomeArquivoExcel(compraId, sufixo) {
  return `Resultados_CN_${compraId}_${sufixo || 'RASPAGEM'}.xlsx`;
}
```

Mudar a assinatura de `gerarExcel` para aceitar `opts` e usar o helper. Trocar:

```javascript
async function gerarExcel(resultados, compraId) {
```
por:
```javascript
async function gerarExcel(resultados, compraId, opts = {}) {
```

E trocar a linha que monta o nome (atualmente `const nome = \`Resultados_CN_${compraId}_RASPAGEM.xlsx\`;`) por:

```javascript
  const nome = _nomeArquivoExcel(compraId, opts.sufixo);
```

No `module.exports` de `raspar-propostas-cdp.js`, adicionar `_nomeArquivoExcel` à lista (junto de `gerarExcel`):

```javascript
  gerarExcel,
  _nomeArquivoExcel,
```

- [ ] **Step 4: Incluir o novo teste no script `test`**

Em `comprasgov-browser/package.json`, trocar a linha do script `test`:

```json
    "test": "node --test comprasgov.test.js telegram.test.js agendador.test.js"
```
por:
```json
    "test": "node --test comprasgov.test.js telegram.test.js agendador.test.js raspar-propostas-cdp.test.js"
```

- [ ] **Step 5: Rodar os testes e confirmar que passam**

Run: `cd comprasgov-browser && node --test raspar-propostas-cdp.test.js`
Expected: PASS (2 testes).

Run (regressão geral): `cd comprasgov-browser && npm test`
Expected: PASS — todos os testes existentes + os 2 novos.

- [ ] **Step 6: Commit**

```bash
git add comprasgov-browser/raspar-propostas-cdp.js comprasgov-browser/raspar-propostas-cdp.test.js comprasgov-browser/package.json
git commit -m "feat(comprasgov): gerarExcel aceita sufixo p/ nome de arquivo distinto"
```

---

## Task 2: parser de itens `_parseItens` (telegram.js)

**Files:**
- Modify: `comprasgov-browser/telegram.js` (adicionar função + export)
- Test: `comprasgov-browser/telegram.test.js`

- [ ] **Step 1: Escrever os testes que falham**

Adicionar ao final de `comprasgov-browser/telegram.test.js`:

```javascript
test('_parseItens aceita lista simples', () => {
  const t = loadFresh();
  assert.deepEqual(t._parseItens('3,5,7'), [3, 5, 7]);
});

test('_parseItens expande intervalo', () => {
  const t = loadFresh();
  assert.deepEqual(t._parseItens('3-7'), [3, 4, 5, 6, 7]);
});

test('_parseItens combina lista e intervalo, ordenado e sem duplicar', () => {
  const t = loadFresh();
  assert.deepEqual(t._parseItens('1-3,5,8'), [1, 2, 3, 5, 8]);
  assert.deepEqual(t._parseItens('3,3,5'), [3, 5]);
});

test('_parseItens rejeita entradas inválidas', () => {
  const t = loadFresh();
  assert.throws(() => t._parseItens(''), /vazia/i);
  assert.throws(() => t._parseItens('abc'), /inválido/i);
  assert.throws(() => t._parseItens('7-3'), /invertido/i);
  assert.throws(() => t._parseItens('0'), /faixa/i);
  assert.throws(() => t._parseItens('201'), /faixa/i);
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd comprasgov-browser && node --test telegram.test.js`
Expected: FAIL — `t._parseItens is not a function`.

- [ ] **Step 3: Implementar `_parseItens`**

Em `telegram.js`, adicionar a função (perto dos outros helpers, antes de `iniciarPolling`):

```javascript
function _parseItens(spec) {
  if (typeof spec !== 'string' || !spec.trim()) {
    throw new Error('Lista de itens vazia. Ex: 3,5,7 ou 3-7');
  }
  const out = new Set();
  for (const parte of spec.split(',')) {
    const p = parte.trim();
    if (!p) continue;
    const range = p.match(/^(\d+)-(\d+)$/);
    if (range) {
      const ini = parseInt(range[1], 10);
      const fim = parseInt(range[2], 10);
      if (ini > fim) throw new Error(`Intervalo invertido: ${p}`);
      for (let n = ini; n <= fim; n++) out.add(n);
    } else if (/^\d+$/.test(p)) {
      out.add(parseInt(p, 10));
    } else {
      throw new Error(`Item inválido: "${p}"`);
    }
  }
  const itens = [...out].sort((a, b) => a - b);
  if (itens.length === 0) throw new Error('Nenhum item válido informado.');
  for (const n of itens) {
    if (n < 1 || n > 200) throw new Error(`Item fora da faixa 1-200: ${n}`);
  }
  return itens;
}
```

Adicionar `_parseItens` ao `module.exports` (junto dos internos expostos para teste):

```javascript
  _parseItens,
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `cd comprasgov-browser && node --test telegram.test.js`
Expected: PASS — incluindo os 4 novos testes de `_parseItens`.

- [ ] **Step 5: Commit**

```bash
git add comprasgov-browser/telegram.js comprasgov-browser/telegram.test.js
git commit -m "feat(telegram): _parseItens (lista+intervalos) para /raspar"
```

---

## Task 3: `rasparItensEspecificos` (lote-runner.js)

**Files:**
- Modify: `comprasgov-browser/lote-runner.js` (adicionar função + export)

Esta função dirige o browser (CDP) e é validada no teste ao vivo (Task 6) — não há teste unitário (depende do Chrome logado). O código abaixo é completo.

- [ ] **Step 1: Implementar `rasparItensEspecificos`**

Em `lote-runner.js`, adicionar a função antes do `module.exports`:

```javascript
/**
 * Raspagem AVULSA de itens específicos de um pregão (disparada via /raspar no
 * Telegram). Reusa o motor do lote mas NÃO mexe em lote-estado (não é retomável)
 * e gera um Excel com nome distinto (sufixo ITENS_…) pra não sobrescrever o
 * Excel completo do lote.
 *
 * @returns {Promise<{itensOk: number[], itensVazios: number[]}>}
 */
async function rasparItensEspecificos({ page, compraId, itens, telegram = null }) {
  if (!page) throw new Error('lote-runner: page obrigatória');
  if (!Array.isArray(itens) || itens.length === 0) {
    throw new Error('lote-runner: itens deve ser array não vazio');
  }

  const ses = await verificarSessao(page);
  if (!ses.valida) {
    log(`[raspar-avulso] sessão inválida: ${ses.motivo}`);
    if (telegram) {
      try { await telegram.enviar(`⚠️ Sessão expirada (${ses.motivo}). Faça login no Chrome e mande /raspar de novo.`); }
      catch (e) { log(`[raspar-avulso] falha ao notificar sessão: ${e.message}`); }
    }
    return { itensOk: [], itensVazios: itens.slice() };
  }

  const resultados  = [];
  const itensOk     = [];
  const itensVazios = [];

  for (const n of itens) {
    try {
      let nav = await navegarParaItemGoto(page, compraId, n);
      if (!nav.ok && nav.motivo === 'compra_nao_encontrada') {
        const rec = await recuperarCompra(page, compraId);
        if (rec.ok) nav = await navegarParaItemGoto(page, compraId, n);
      }
      if (!nav.ok) {
        log(`[raspar-avulso] item ${n} inacessível (${nav.motivo})`);
        itensVazios.push(n);
        await sleep(DELAY_ITEM);
        continue;
      }
      const dados = await extrairDadosPaginaAtual(page, n);
      if (!dados || !dados.dadosItem || !dados.dadosItem.descricao) {
        log(`[raspar-avulso] item ${n} sem dados`);
        itensVazios.push(n);
      } else {
        resultados.push(dados);
        itensOk.push(n);
        log(`[raspar-avulso] item ${n}: ${dados.propostas.length} proposta(s)`);
      }
    } catch (err) {
      log(`[raspar-avulso] erro no item ${n}: ${err.message}`);
      itensVazios.push(n);
    }
    await sleep(DELAY_ITEM);
  }

  if (resultados.length === 0) {
    if (telegram) {
      try { await telegram.enviar(`❌ Nenhum dos itens pedidos (${itens.join(', ')}) retornou dados para ${compraId}.`); }
      catch (e) { log(`[raspar-avulso] falha ao notificar vazio: ${e.message}`); }
    }
    return { itensOk, itensVazios };
  }

  const sufixo = `ITENS_${itensOk.join('-')}_${Date.now()}`;
  let xlsxPath = null;
  try {
    xlsxPath = await gerarExcel(resultados, compraId, { sufixo });
  } catch (err) {
    log(`[raspar-avulso] falha ao gerar Excel: ${err.message}`);
    if (telegram) {
      try { await telegram.enviar(`❌ Erro ao gerar Excel: ${err.message}`); }
      catch (e) { log(`[raspar-avulso] falha ao notificar erro de Excel: ${e.message}`); }
    }
    return { itensOk, itensVazios };
  }

  if (telegram && xlsxPath) {
    let legenda = `📎 <b>${compraId}</b> — itens ${itensOk.join(', ')} raspado(s)`;
    if (itensVazios.length > 0) legenda += `\n⚠️ sem dados: ${itensVazios.join(', ')}`;
    try { await telegram.enviarDocumento(xlsxPath, legenda); }
    catch (err) { log(`[raspar-avulso] falha ao enviar Excel: ${err.message}`); }
  }

  return { itensOk, itensVazios };
}
```

- [ ] **Step 2: Exportar a função**

No `module.exports` de `lote-runner.js`, adicionar (junto de `executarLote`):

```javascript
  executarLote,
  rasparItensEspecificos,
```

- [ ] **Step 3: Sanity check de sintaxe + export**

Run: `cd comprasgov-browser && node -e "const m=require('./lote-runner'); if(typeof m.rasparItensEspecificos!=='function') throw new Error('não exportado'); console.log('OK: rasparItensEspecificos exportada');"`
Expected: imprime `OK: rasparItensEspecificos exportada` (sem erro de sintaxe/require).

- [ ] **Step 4: Rodar a suíte (garante que nada quebrou)**

Run: `cd comprasgov-browser && npm test`
Expected: PASS — suíte inteira segue verde.

- [ ] **Step 5: Commit**

```bash
git add comprasgov-browser/lote-runner.js
git commit -m "feat(comprasgov): rasparItensEspecificos p/ raspagem avulsa de itens"
```

---

## Task 4: comando `/raspar` no bot (telegram.js)

**Files:**
- Modify: `comprasgov-browser/telegram.js` (callback `_onRaspar`/`setRasparCallback`, `_processarSlashRaspar`, handler no polling, exports)
- Test: `comprasgov-browser/telegram.test.js`

- [ ] **Step 1: Escrever os testes que falham**

Adicionar ao final de `comprasgov-browser/telegram.test.js`:

```javascript
test('_processarSlashRaspar chama callback com compraId e itens parseados', async () => {
  const t = loadFresh();
  t.init('tok:abc', '999');
  t._setPostFn(() => Promise.resolve({ ok: true }));
  let recebido = null;
  t.setRasparCallback((args) => { recebido = args; return Promise.resolve('ok'); });

  await t._processarSlashRaspar('/raspar 15838305900012026 3,5,7', 999);

  assert.deepEqual(recebido, { compraId: '15838305900012026', itens: [3, 5, 7] });
});

test('_processarSlashRaspar rejeita compraId com != 17 dígitos', async () => {
  const t = loadFresh();
  t.init('tok:abc', '999');
  const posts = [];
  t._setPostFn((metodo, payload) => { posts.push(payload); return Promise.resolve({ ok: true }); });
  let chamou = false;
  t.setRasparCallback(() => { chamou = true; return Promise.resolve('ok'); });

  await t._processarSlashRaspar('/raspar 123 3,5', 999);

  assert.equal(chamou, false);
  assert.match(posts[0].text, /17 dígitos/);
});

test('_processarSlashRaspar responde uso quando faltam args', async () => {
  const t = loadFresh();
  t.init('tok:abc', '999');
  const posts = [];
  t._setPostFn((metodo, payload) => { posts.push(payload); return Promise.resolve({ ok: true }); });

  await t._processarSlashRaspar('/raspar', 999);

  assert.match(posts[0].text, /Uso: \/raspar/);
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd comprasgov-browser && node --test telegram.test.js`
Expected: FAIL — `t._processarSlashRaspar is not a function` / `t.setRasparCallback is not a function`.

- [ ] **Step 3: Implementar callback, handler e processamento**

Em `telegram.js`, adicionar o callback junto dos outros (perto de `let _onRetomar = null;`):

```javascript
// Callback injetado pelo server.js para raspagem avulsa de itens (/raspar).
// Recebe ({ compraId, itens }, chatId) e retorna string (mensagem para o user).
let _onRaspar = null;
function setRasparCallback(fn) { _onRaspar = fn; }
function _getRasparCallback()  { return _onRaspar; }
```

Adicionar a função de processamento (perto de `_processarSlashResponder`):

```javascript
async function _processarSlashRaspar(texto, chatId) {
  const m = texto.match(/^\/raspar\s+(\S+)\s+([\s\S]+)$/);
  if (!m) {
    await _post('sendMessage', {
      chat_id: chatId,
      text:    'Uso: /raspar <compraId> <itens>  (ex: /raspar 15838305900012026 3,5,7)',
    });
    return;
  }
  const compraId = m[1];
  if (!/^\d{17}$/.test(compraId)) {
    await _post('sendMessage', {
      chat_id: chatId,
      text:    `❌ compraId deve ter 17 dígitos. Recebi: ${compraId}`,
    });
    return;
  }
  let itens;
  try {
    itens = _parseItens(m[2]);
  } catch (err) {
    await _post('sendMessage', { chat_id: chatId, text: `❌ ${err.message}` });
    return;
  }
  if (!_onRaspar) {
    await _post('sendMessage', { chat_id: chatId, text: '❌ /raspar não configurado neste servidor' });
    return;
  }
  try {
    const resposta = await _onRaspar({ compraId, itens }, chatId);
    await _post('sendMessage', { chat_id: chatId, text: resposta || '(sem resposta)', parse_mode: 'HTML' });
  } catch (err) {
    await _post('sendMessage', { chat_id: chatId, text: `❌ Erro ao raspar: ${err.message}` });
  }
}
```

No loop de polling de `iniciarPolling`, adicionar o handler logo após o bloco `/retomar` (depois do `if (texto === '/retomar' ...) { ... continue; }`):

```javascript
            // 2c) Slash command /raspar <compraId> <itens> — raspagem avulsa
            if (texto.startsWith('/raspar ') || texto === '/raspar') {
              await _processarSlashRaspar(texto, chatId);
              continue;
            }
```

No `module.exports`, adicionar:

```javascript
  setRasparCallback,
  _getRasparCallback,
  _processarSlashRaspar,
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `cd comprasgov-browser && node --test telegram.test.js`
Expected: PASS — incluindo os 3 novos testes de `_processarSlashRaspar`.

- [ ] **Step 5: Commit**

```bash
git add comprasgov-browser/telegram.js comprasgov-browser/telegram.test.js
git commit -m "feat(telegram): comando /raspar roteia p/ callback de raspagem avulsa"
```

---

## Task 5: fiação no server.js (callback + lock)

**Files:**
- Modify: `comprasgov-browser/server.js` (import do lote-runner ~22; registro do callback após o bloco `setRetomarCallback`, ~769)

Sem teste unitário (integração com browser + Telegram; validado ao vivo na Task 6).

- [ ] **Step 1: Importar `rasparItensEspecificos`**

Em `server.js`, trocar a linha do import do lote-runner (atualmente `const { executarLote } = require('./lote-runner');`) por:

```javascript
const { executarLote, rasparItensEspecificos } = require('./lote-runner');
```

- [ ] **Step 2: Registrar o callback `/raspar` com lock**

Em `server.js`, logo após o fechamento do bloco `telegram.setRetomarCallback(async () => { ... });` e ANTES de `telegram.iniciarPolling();`, inserir:

```javascript
      // /raspar via Telegram → raspa itens específicos de um pregão na aba logada
      let _avulsaEmAndamento = false;
      telegram.setRasparCallback(async ({ compraId, itens }) => {
        const estado = loteEstado.obterEstado();
        if (estado && estado.status === loteEstado.STATUS.RODANDO) {
          return '⏳ Lote rodando agora; aguarde concluir/pausar antes de raspar itens avulsos.';
        }
        if (_avulsaEmAndamento) {
          return '⏳ Já há uma raspagem avulsa em andamento.';
        }

        const todasAbas = browser ? browser.contexts().flatMap(c => c.pages()) : [];
        const pageLogada = todasAbas.find(p => p.url().includes('cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/seguro/'));
        if (!pageLogada) {
          return '⚠️ Nenhuma aba em <code>/seguro/fornecedor/</code> aberta no Chrome.\nFaça login + abra uma compra e mande /raspar de novo.';
        }

        _avulsaEmAndamento = true;
        rasparItensEspecificos({ page: pageLogada, compraId, itens, telegram })
          .catch(err => console.error('[raspar] erro:', err.message))
          .finally(() => { _avulsaEmAndamento = false; });

        return `🔍 <b>Raspando</b> itens ${itens.join(', ')} de <code>${compraId}</code>… resultado chega aqui.`;
      });
```

- [ ] **Step 3: Sanity check de sintaxe**

Run: `cd comprasgov-browser && node -e "require('./server.js')" ` — se o server tentar subir e travar, use Ctrl+C; o objetivo é só confirmar que não há erro de sintaxe no require. Alternativa sem efeitos colaterais:
Run: `cd comprasgov-browser && node --check server.js`
Expected: sem saída (sintaxe OK).

- [ ] **Step 4: Rodar a suíte completa**

Run: `cd comprasgov-browser && npm test`
Expected: PASS — suíte inteira verde.

- [ ] **Step 5: Commit**

```bash
git add comprasgov-browser/server.js
git commit -m "feat(server): registra callback /raspar (itens avulsos) com lock"
```

---

## Task 6: validação ao vivo (Chrome logado do Rafael)

**Files:** nenhum (validação operacional).

Pré-requisitos: Chrome aberto com CDP na porta 9222, login manual no ComprasGov, uma compra-alvo aberta em `/seguro/fornecedor/`, server rodando (`npm start`) com `TELEGRAM_TOKEN` configurado.

- [ ] **Step 1: Caminho feliz**

No Telegram, enviar: `/raspar <compraId real> 1,2`
Expected: bot responde "🔍 Raspando itens 1, 2 de …" e em seguida envia um Excel `Resultados_CN_<id>_ITENS_1-2_<ts>.xlsx` com os 2 itens. Confirmar que o Excel completo do lote (`..._RASPAGEM.xlsx`), se existir, **não** foi sobrescrito.

- [ ] **Step 2: Item inexistente**

Enviar: `/raspar <compraId real> 999`
Expected: bot responde "❌ Nenhum dos itens pedidos (999) retornou dados…" e NÃO gera Excel.

- [ ] **Step 3: Entrada inválida**

Enviar: `/raspar 123 3,5` (compraId curto) e `/raspar abc` (sem itens).
Expected: mensagens de erro claras (17 dígitos / uso), sem disparar raspagem.

- [ ] **Step 4: Mutex com lote**

Com um lote em andamento (status RODANDO), enviar `/raspar <id> 1`.
Expected: bot recusa com "⏳ Lote rodando agora…".

- [ ] **Step 5: Validar o lote em si (pedido original)**

Disparar o lote normalmente (CLI `node raspar-lote.js` ou via cron/`/retomar`) com as compras-alvo reais e observar: progresso no Telegram, Excel por compra concluída, e ausência de falso positivo de sessão expirada. Anotar qualquer comportamento estranho para corrigir na hora.

---

## Self-Review (preenchido pelo autor do plano)

**1. Cobertura do spec:**
- Parser de itens (lista+intervalos, dedup, faixa 1-200) → Task 2 ✅
- Handler `/raspar` + validação compraId 17 dígitos + roteamento → Task 4 ✅
- Callback no server com recusa por lote rodando + lock + aba logada → Task 5 ✅
- `rasparItensEspecificos` (sessão, loop, itensVazios, sem snapshot, sem lote-estado) → Task 3 ✅
- Excel com nome distinto (sufixo) sem sobrescrever `_RASPAGEM` → Task 1 ✅
- Testes unitários (parser, nome do Excel, roteamento) → Tasks 1,2,4 ✅
- Validação ao vivo (comando novo + lote) → Task 6 ✅

**2. Placeholders:** nenhum — todo passo de código mostra o código completo.

**3. Consistência de tipos/nomes:**
- `_nomeArquivoExcel(compraId, sufixo)` definido na Task 1, usado em `gerarExcel(resultados, compraId, opts)` com `opts.sufixo`; `rasparItensEspecificos` (Task 3) chama `gerarExcel(resultados, compraId, { sufixo })` — consistente.
- `setRasparCallback`/`_onRaspar` recebem `({ compraId, itens }, chatId)`: Task 4 (`_processarSlashRaspar` envia `{ compraId, itens }`) e Task 5 (callback desestrutura `{ compraId, itens }`) — consistente.
- `_parseItens` retorna `number[]`; usado como `itens` em todo o fluxo — consistente.
- `loteEstado.STATUS.RODANDO` e `loteEstado.obterEstado()` já existem (usados hoje no `/retomar`).
