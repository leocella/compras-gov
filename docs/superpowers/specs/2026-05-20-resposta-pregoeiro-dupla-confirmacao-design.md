# Design — Resposta ao pregoeiro com dupla confirmação via Telegram

**Data:** 2026-05-20
**Projeto:** RAFAEL_PRIMO / Projeto 2 — ComprasGov Browser Automation
**Autor:** Leo + Claude

---

## 1. Contexto e motivação

O sistema atual permite responder mensagens do pregoeiro via Telegram através
de dois caminhos:

- **Comando** `/responder <compraId> <texto>` no chat do bot.
- **Reply** a uma notificação recebida via `notificarPregoeiro`.

Em ambos os casos, `telegram.js` exibe um preview com botão **✅ Confirmar /
❌ Cancelar**. Quando o Rafael confirma, o servidor chama
`comprasgov.js:responderMensagem`. O comportamento depende da env
`TELEGRAM_RESPONDER_DRY_RUN`:

- `true` (default no `.env`): texto é digitado no campo mas **nunca** é
  submetido — Rafael revisa via VNC e clica enviar manualmente.
- `false`: bot clica enviar direto após Confirmar.

**Problema:** o caminho `false` permite envio acidental (clique errado no
Telegram), e o caminho `true` exige Rafael sempre acessar VNC — perdendo a
agilidade do Telegram. Como o chat com o pregoeiro é **canal oficial com órgão
público**, qualquer erro tem consequência reputacional/contratual real.

**Objetivo:** evoluir o fluxo para **dupla confirmação com prova visual**,
mantendo agilidade do Telegram sem abrir mão de garantias contra envio
acidental.

## 2. Escopo

**Dentro do escopo:**

- Novo fluxo de duas etapas no Telegram: preencher → screenshot → enviar.
- Funções primitivas em `comprasgov.js`: preencher sem enviar, capturar
  screenshot recortado, enviar campo já preenchido, limpar campo, obter
  assinatura da última mensagem do pregoeiro.
- Estado em memória dos preenchidos pendentes com timeout de 10 min.
- Persistência leve em `dados/preenchidos-pendentes.json` para recuperar de
  reboots do server sem deixar campo preenchido pendurado.
- Detecção de race condition (nova mensagem do pregoeiro entre etapas) com
  aviso não-bloqueante.
- Auditoria expandida em `dados/respostas-pregoeiro.log`.

**Fora do escopo:**

- Comando `/raspagem <compraId> <itens>` (pausado — outra rodada).
- Notificação de chegada de novas mensagens (já existe via `notificarPregoeiro`).
- Leitura de histórico longo do chat (já existe via `lerMensagensPregao`).
- UI Lovable / dashboard externo.
- Mudança no comportamento do `/retomar` ou em `executarLote`.

## 3. Fluxo

```
[Pregoeiro envia mensagem] OU [/responder <compraId> <texto>]
   ↓
ETAPA 1 — Bot envia preview de texto + botão [✏️ Preencher no chat]
   ↓ (Rafael clica Preencher)
Playwright: navega para item N do compraId, page.fill(campo, texto)
   — NÃO clica Enviar
   ↓
Captura assinatura da última mensagem do pregoeiro (sha1 de texto+ts)
Captura screenshot recortado (form + 3 últimas mensagens)
   ↓
ETAPA 2 — Bot envia screenshot + botões [🚀 ENVIAR AGORA] [❌ Cancelar+Limpar]
   ↓ Agenda setTimeout 10 min → ao expirar, limpa campo + edita msg do bot
   ↓
   ├─ Rafael clica "Enviar":
   │   1. Re-lê assinatura da última msg do pregoeiro
   │   2. Se mudou: anexa "⚠️ Nova msg do pregoeiro chegou — enviando mesmo
   │      assim" na confirmação final (não bloqueia)
   │   3. Playwright clica botão Enviar do portal
   │   4. Bot edita mensagem: "✅ Enviado às HH:MM"
   │   5. Cancela timeout pendente
   │
   ├─ Rafael clica "Cancelar+Limpar":
   │   1. Playwright limpa o campo (page.fill(sel, ''))
   │   2. Bot edita mensagem: "❌ Cancelado — campo limpo"
   │   3. Cancela timeout pendente
   │
   └─ Timeout 10 min sem ação:
       1. Playwright limpa o campo
       2. Bot edita mensagem: "⏰ Expirou após 10 min — campo limpo"
```

## 4. Mudanças por arquivo

### 4.1 `comprasgov.js` — novas primitivas

Funções adicionadas (a função `responderMensagem` legacy permanece exportada
para fallback/CLI mas não é mais usada pelo Telegram — o ramo `if (dryRun)`
internamente pode ser removido junto com a env aposentada na §7):

```js
// Navega para /item/N?compra=X, preenche o campo (sem submeter),
// captura assinatura da última mensagem do pregoeiro.
async function preencherSemEnviar(page, compraId, item, texto, opts = {})
  → { url, lastMessageSig, preenchidoEm }

// Assinatura usada para race detection entre etapas.
// Implementação: sha1(JSON.stringify(msgs)) onde msgs é o array retornado
// por lerMensagensPregao(page, item) filtrado por remetente=pregoeiro,
// pegando { texto, ts } de cada uma. Qualquer nova mensagem do pregoeiro
// muda a assinatura.
async function obterUltimaAssinaturaMsg(page, compraId, item)
  → string (sha1 hex 16 chars) | null

// Screenshot recortado: união do bounding box do form com os bounding boxes
// das N últimas mensagens visíveis. Se a união ultrapassar viewport, faz
// fallback para screenshot do viewport inteiro. Buffer PNG retornado
// (NÃO grava em disco — telegram.js envia direto).
async function capturarScreenshotChat(page, opts = { nMsgs: 3 })
  → Buffer

// Clica botão Enviar do portal — assume campo já preenchido.
// Espera networkidle e retorna timestamp do envio.
async function enviarPreenchido(page, compraId, item)
  → { enviadoEm, url }

// Limpa o campo (page.fill(sel, '')).
// Idempotente — não erra se campo já vazio ou se já saiu da página.
async function limparCampo(page, compraId, item)
  → { limpoEm }
```

Todas as funções usam o objeto `SEL_MSG` existente. Nenhum seletor novo
precisa ser descoberto — o recon de 2026-05-14 (memória
`comprasgov-chat-recon`) já validou os necessários.

### 4.2 `telegram.js` — novo fluxo de 2 etapas

**Estrutura:**

- Novo Map: `_preenchidosPendentes: Map<callbackId, PreenchidoPendente>`
- Tipo:

  ```ts
  PreenchidoPendente = {
    compraId, uasg, item, texto,
    chatId, etapa1MsgId, etapa2MsgId,
    preenchidoEm,           // ISO timestamp
    lastMessageSig,         // sha1 capturada ao preencher
    timeoutId,              // handle do setTimeout 10min
  }
  ```

**Prefixos de `callback_data`:**

| Prefixo | Etapa | Ação |
|---|---|---|
| `p:<id>` | 1 | Preencher (substitui `c:` atual) |
| `x:<id>` | 1 | Cancelar (antes de preencher) |
| `s:<id>` | 2 | Send / enviar agora |
| `l:<id>` | 2 | Limpar campo (cancelar após preencher) |

**Funções renomeadas/novas:**

- `_solicitarPreenchimento(ctx, texto, chatId)` — substitui
  `_solicitarConfirmacao`. Mesma assinatura de antes, só muda o callback
  prefix e o texto dos botões.
- `_processarPreencher(callbackId)` — handler de `p:<id>`. Chama
  `_onPreencher` (callback registrado pelo server), recebe `{ lastMessageSig,
  screenshotBuffer }`, envia screenshot via `sendPhoto`, cria
  `_preenchidosPendentes[callbackId]` com a etapa 2, agenda timeout 10min.
- `_processarEnviar(callbackId)` — handler de `s:<id>`. Chama `_onEnviar`
  com a assinatura original; recebe `{ enviadoEm, houveNovaMsg }`; edita
  msg da etapa 2 com confirmação.
- `_processarLimpar(callbackId, motivo)` — handler de `l:<id>` e do timeout.
  Chama `_onLimparCampo`; edita msg da etapa 2.

**Novos callbacks expostos:**

```js
setPreencherCallback(fn)        // async (ctx, texto) → { lastMessageSig, screenshotBuffer }
setEnviarPreenchidoCallback(fn) // async (ctx, lastSigOriginal) → { enviadoEm, houveNovaMsg }
setLimparCampoCallback(fn)      // async (ctx, motivo) → { limpoEm }
```

(Os callbacks antigos `setResponderCallback` ficam por compatibilidade mas
deixam de ser invocados pelo novo fluxo. Pode ser removido em rodada futura.)

### 4.3 `server.js` — registro dos 3 callbacks

Substitui o `telegram.setResponderCallback(...)` atual por:

```js
telegram.setPreencherCallback(async (ctx, texto) => {
  if (!pageSessao) throw new Error('Sessão pageSessao não ativa');
  if (!ctx.item || ctx.item === '?') throw new Error('Item ausente');
  const r = await preencherSemEnviar(pageSessao, ctx.compraId, ctx.item, texto);
  const buf = await capturarScreenshotChat(pageSessao);
  return { lastMessageSig: r.lastMessageSig, screenshotBuffer: buf,
           preenchidoEm: r.preenchidoEm };
});

telegram.setEnviarPreenchidoCallback(async (ctx, sigOriginal) => {
  const sigAtual = await obterUltimaAssinaturaMsg(pageSessao, ctx.compraId, ctx.item);
  const houveNovaMsg = sigAtual && sigOriginal && sigAtual !== sigOriginal;
  const r = await enviarPreenchido(pageSessao, ctx.compraId, ctx.item);
  return { enviadoEm: r.enviadoEm, houveNovaMsg };
});

telegram.setLimparCampoCallback(async (ctx, motivo) => {
  return limparCampo(pageSessao, ctx.compraId, ctx.item);
});
```

### 4.4 `dados/respostas-pregoeiro.log` — auditoria expandida

Cada linha JSON ganha o campo `evento`:

```json
{"ts":"2026-05-20T17:30:00Z","evento":"preenchido","compraId":"...","item":"11","texto":"...","lastMessageSig":"abc123"}
{"ts":"2026-05-20T17:32:15Z","evento":"enviado","compraId":"...","item":"11","houveNovaMsg":false}
{"ts":"2026-05-20T17:35:00Z","evento":"cancelado","compraId":"...","item":"11","modo":"manual"}
{"ts":"2026-05-20T17:40:00Z","evento":"cancelado","compraId":"...","item":"11","modo":"timeout-10min"}
{"ts":"2026-05-20T17:50:00Z","evento":"race-detected","compraId":"...","item":"11","sigOrig":"abc","sigNovo":"def"}
```

### 4.5 `dados/preenchidos-pendentes.json` — resiliência a reboot

Sempre que `_preenchidosPendentes` for modificado, persiste o estado completo
no arquivo. No boot do `server.js`:

1. Lê o arquivo.
2. Para cada pendente, chama `limparCampo(pageSessao, compraId, item)`.
3. Apaga o arquivo.
4. Envia ao Telegram: `🔄 Server reiniciado — N preenchimentos pendentes
   foram limpos por segurança`.

Caso `pageSessao` não esteja disponível no boot (sessão expirou), grava aviso
em log e mantém o arquivo (próxima boot tentará de novo).

## 5. Race condition (nova msg do pregoeiro entre etapas)

**Detecção:** ao preencher (etapa 1), captura `lastMessageSig`. Ao enviar
(etapa 2), recaptura e compara.

**Comportamento:** se mudou, **avisa mas não bloqueia** (decisão validada
no brainstorming). A mensagem de confirmação final fica:

```
⚠️ Nova mensagem do pregoeiro chegou entre o preencher e o enviar
✅ Enviado às 17:32 (assinatura original: abc123, atual: def456)
```

Registrado também no log com evento `race-detected`.

## 6. Timeout 10 min

Implementado via `setTimeout` no `_processarPreencher`. Ao disparar:

1. Chama `_onLimparCampo(ctx, 'timeout-10min')`.
2. Edita mensagem da etapa 2: `⏰ Expirou após 10 min — campo limpo
   automaticamente`.
3. Remove `callbackId` de `_preenchidosPendentes`.
4. Persiste o Map (item 4.5).

Cancelado se Rafael clicar Enviar ou Cancelar antes.

## 7. Aposentadoria do `TELEGRAM_RESPONDER_DRY_RUN`

A env perde sentido — o novo fluxo já é mais seguro que ela (preencher é
sempre sem enviar, e enviar exige confirmação explícita com screenshot).

**Decisão:** remover a env e o código `if (dryRun) { ... }` em
`comprasgov.js:responderMensagem`. Documentar no commit que o novo fluxo é
estritamente mais seguro.

(Se em uso futuro for desejado um "modo paranoico" onde a etapa 2 nunca tem
botão Enviar ativo — força VNC sempre — pode ser introduzido como nova env
em rodada futura, separadamente.)

## 8. Testes manuais (validação)

Executados após implementação, antes de declarar concluído:

1. **Caminho feliz:** `/responder <compraId> <item> texto` → clicar
   Preencher → ver screenshot no Telegram → clicar Enviar → confirmar via
   VNC que mensagem foi enviada e aparece no chat.
2. **Cancelar etapa 1:** clicar Cancelar antes de preencher → nada acontece
   no portal, msg do bot vira "❌ Cancelado".
3. **Cancelar etapa 2:** clicar Preencher → clicar Cancelar+Limpar → ver
   via VNC que o campo voltou a vazio.
4. **Timeout:** clicar Preencher → não fazer nada por 10 min → ver via VNC
   que campo foi limpo + msg do bot virou "⏰ Expirou".
5. **Race condition:** clicar Preencher → no VNC, simular nova mensagem do
   pregoeiro (envio manual de outro usuário) → clicar Enviar → ver aviso
   "⚠️ Nova msg" na confirmação.
6. **Resiliência a reboot:** clicar Preencher → matar `server.js` →
   `node server.js` de novo → ver msg "🔄 Server reiniciado — pendentes
   limpos" + campo vazio via VNC.

## 9. Mudanças não-funcionais

- **Sem dependências novas:** tudo usa Playwright + APIs Telegram já em uso.
- **Sem migração:** não há estado antigo a converter; `dados/preenchidos-pendentes.json`
  começa vazio.
- **Backward compat:** `responderMensagem` (legacy) continua funcionando para
  qualquer caller externo (não é usado mais pelo Telegram, mas exportado).
