# Design: Agendamento Automático + Notificações Telegram

**Data:** 2026-05-07  
**Projeto:** comprasgov-browser  
**Status:** Aprovado

---

## 1. Objetivo

Automatizar a raspagem diária de propostas e o monitoramento de mensagens do pregoeiro, com notificações em tempo real via Telegram para o Rafael. Elimina a necessidade de rodar scripts manualmente e garante resposta rápida quando o pregoeiro chama diretamente.

---

## 2. Escopo

### Funcionalidades entregues

1. **Agendamento interno no `server.js`** via `node-cron` — nenhum processo externo, nenhum Task Scheduler
2. **`telegram.js`** — módulo de envio + long-polling para receber respostas do Rafael
3. **`agendador.js`** — dois jobs cron: scraping diário e polling de mensagens
4. **`.env`** — configuração centralizada (token, chat_id, CNPJ, hora)
5. **Notificação em dois níveis** para mudanças de pregão (resumo → detalhe sob demanda)
6. **Alerta urgente com countdown** quando pregoeiro cita o CNPJ do Rafael

### Fora do escopo

- Interface web para visualização
- Envio automático de resposta ao pregoeiro (Rafael responde manualmente)
- Suporte a múltiplos CNPJs por pregão

---

## 3. Arquitetura

### Novos arquivos

```
comprasgov-browser/
├── telegram.js      ← API wrapper Telegram + long-polling
├── agendador.js     ← cron jobs (scraping + mensagens)
└── .env             ← configuração (não entra no git)
```

### Arquivos modificados

```
├── server.js        ← inicializa telegram + agendador após bootBrowser()
├── package.json     ← adiciona node-cron
└── .gitignore       ← garante que .env está ignorado
```

### Fluxo geral

```
server.js (boot)
  ├── bootBrowser()
  ├── telegram.init() → valida token, inicia long-polling
  ├── agendador.init()→ registra 2 jobs cron
  └── app.listen()

Job 1 — 07h todo dia:
  conectarChrome → raspar todos de compras-alvo.json
    → salvarSnapshot → compararSnapshots
      → mudanças? → telegram.notificarMudancas()

Job 2 — a cada 5min, seg-sex 08h-18h:
  lerMensagensChat por compra ativa
    → mensagem nova?
      → CNPJ do Rafael presente? → alerta URGENTE (2 min)
      → senão → alerta normal

Long-polling Telegram:
  Rafael responde chave (ex: "C4F2") → bot envia detalhes completos
```

---

## 4. Módulo `telegram.js`

### Dependências
- `https` nativo (já usado em `pncp-api.js`) — sem nova lib

### Estado interno
```js
let token = '';
let chatId = '';
let ultimoUpdateId = 0;
const detalhesMap = new Map(); // chave → texto completo
```

### API pública

```js
init(token, chatId)
  // Valida credenciais — lança Error se token/chatId ausentes

enviar(texto)
  // POST /bot{token}/sendMessage com parse_mode=HTML
  // Retorna Promise<void>

notificarMudancas(compraId, resumo, detalhes)
  // resumo: { totalMudancas, adjudicadas, posicoes, novos, removidos }
  // Gera chave curta aleatória (4 chars hex)
  // Salva detalhes no Map
  // Envia mensagem resumo com instrução de resposta

notificarPregoeiro(compraId, uasg, numItem, texto, urgente)
  // urgente=true: inclui countdown "até HH:MM" (agora + 2 min)
  // urgente=true: agenda segundo envio "⚠️ 30s restantes!" após 90s

iniciarPolling()
  // Loop getUpdates?timeout=25&offset=ultimoUpdateId+1
  // Trata reply do Rafael: se texto bate chave no Map → responde com detalhe
  // Reinicia automaticamente em erro de rede (backoff 5s)
```

### Formato das mensagens

**Resumo de mudanças:**
```
📊 <b>Compra 15838305900012026</b>
3 mudanças detectadas
• 1 adjudicada  • 2 posições alteradas

Digite <code>C4F2</code> para ver detalhes
```

**Detalhe (ao responder "C4F2"):**
```
📋 Detalhes C4F2 — 07/05/2026

Item 3 | 12.345.678/0001-90 | EMPRESA X
  Aceita → Adjudicada ✅

Item 7 | 98.765.432/0001-11 | EMPRESA Y
  3° → 1° ⬆️ subiu
```

**Alerta normal de pregoeiro:**
```
💬 <b>Pregoeiro</b> — Compra 15838305900012026 / Item 3

[texto da mensagem]
```

**Alerta URGENTE (CNPJ do Rafael presente):**
```
🚨 <b>CHAMADA DIRETA — 2 MIN PARA RESPONDER</b>
Compra 15838305900012026 / Item 3

[texto completo da mensagem do pregoeiro]

⏰ Responda até: 14:32
```

**Lembrete 90s depois:**
```
⚠️ 30 segundos restantes! Compra 15838305900012026 / Item 3
```

---

## 5. Módulo `agendador.js`

### Dependências
- `node-cron` — única nova dependência do projeto

### API pública

```js
init({ telegram, getPage, getPageSessao, comprasAlvoPath })
  // getPage: () => page  (página principal do server.js — evita referência circular)
  // getPageSessao: () => pageSessao  (sessão autenticada)
  // Registra os dois jobs cron
```

### Job 1 — Scraping diário

```
Schedule: '0 {HORA_SCRAPING} * * *'  (default: 7 = 07:00)

1. Carrega compras-alvo.json
2. page = getPage()
   → null: telegram.enviar("⚠️ Chrome offline — scraping cancelado") + return
   ⚠️ NÃO chama conectarChrome() — reutiliza a conexão CDP já ativa do server.js
3. Para cada compra:
   a. Navega para item 1 via page.goto (primeira compra) ou pushState (demais)
      usando as funções de raspar-propostas-cdp.js: navegarParaItemSPA, extrairDadosPaginaAtual
   b. Extrai todos os itens até falhar descrição (mesmo critério do raspar-lote.js)
   c. salvarSnapshot(resultados, compraId)
   d. Carrega snapshot de ontem (se existir)
   e. compararSnapshots(ontem, hoje) → se mudanças → notificarMudancas()
   f. Erro na compra → loga, continua próxima
4. Não fecha o browser (pertence ao server.js)
```

### Job 2 — Polling mensagens do pregoeiro

⚠️ **Pré-requisito:** os seletores em `SEL_MSG` (comprasgov.js) estão marcados como `RECON_NEEDED`.
O Job 2 só funciona depois de completar o recon manual e preencher `SEL_MSG` com valores reais.
A implementação deve incluir um guard: se `SEL_MSG.campoChatUasg === ''`, o job pula e loga aviso.

```
Schedule: '*/5 8-18 * * 1-5'

Estado:
  mensagensVistas: Map<compraId, Set<string>>
  chave de deduplicação: `${remetente}|${dataHora}|${texto.slice(0,50)}`
  Reset diário: cron '0 8 * * 1-5' limpa todos os Sets

1. Guard: SEL_MSG preenchido? → senão loga "[agendador] SEL_MSG não configurado" + return
2. pageSessao = getPageSessao()
   → null: pula silenciosamente
3. Para cada compra em compras-alvo.json:
   a. lerMensagensChat(pageSessao, uasg, numeroPregao)
      retorna { mensagens: [{remetente, dataHora, texto}], total }
   b. Para cada mensagem retornada:
      → chave = `${remetente}|${dataHora}|${texto.slice(0,50)}`
      → já no Set? pula
      → adiciona ao Set
      → CNPJ_RAFAEL presente no texto?
          → notificarPregoeiro(..., urgente=true)
          → senão → notificarPregoeiro(..., urgente=false)
```

---

## 6. Configuração `.env`

```env
# Telegram Bot
TELEGRAM_TOKEN=123456:ABC-DEF...
TELEGRAM_CHAT_ID=987654321

# Agendador
HORA_SCRAPING=7
CNPJ_RAFAEL=12345678000190
```

### Como criar o bot Telegram (guia para o plano)

1. Abrir Telegram → buscar `@BotFather`
2. Enviar `/newbot` → escolher nome e username
3. Copiar o **token** → `TELEGRAM_TOKEN`
4. Enviar uma mensagem para o bot criado
5. Acessar `https://api.telegram.org/bot{TOKEN}/getUpdates`
6. Copiar `message.chat.id` → `TELEGRAM_CHAT_ID`

---

## 7. Integração no `server.js`

Inserir após `bootBrowser()`, antes de `app.listen()`:

```js
require('dotenv').config();
const telegram  = require('./telegram');
const agendador = require('./agendador');

if (process.env.TELEGRAM_TOKEN) {
  telegram.init(process.env.TELEGRAM_TOKEN, process.env.TELEGRAM_CHAT_ID);
  telegram.iniciarPolling();
  agendador.init({
    telegram,
    getPage:       () => page,
    getPageSessao: () => pageSessao,
    comprasAlvoPath: path.join(__dirname, 'compras-alvo.json'),
  });
  console.log('[boot] Telegram + agendador inicializados.');
} else {
  console.log('[boot] TELEGRAM_TOKEN não definido — agendador desabilitado.');
}
```

O bloco é condicional: se `.env` não existir, o servidor sobe normalmente sem agendador.

Adicionar `dotenv` ao `package.json`.

---

## 8. Tratamento de erros

| Cenário | Comportamento |
|---|---|
| Chrome offline no Job 1 | Notifica Telegram + desiste naquele dia |
| Compra específica falha no Job 1 | Loga + continua próxima compra |
| Sem sessão ativa no Job 2 | Pula silenciosamente |
| Erro de rede no Telegram | Loga + tenta novamente na próxima execução |
| Long-polling cai | Reinicia com backoff de 5s |
| Token inválido | Lança erro no boot, servidor não sobe agendador |

---

## 9. Dependências novas

| Pacote | Versão | Motivo |
|---|---|---|
| `node-cron` | `^3.0.0` | Agendamento dos dois jobs |
| `dotenv` | `^16.0.0` | Leitura do `.env` |

Telegram: sem lib — usa `https` nativo já presente no projeto.

---

## 10. Testes manuais sugeridos

1. `TELEGRAM_TOKEN` inválido → servidor avisa e desabilita agendador (não crasha)
2. `GET /status` com agendador ativo → retorna campo `agendadorAtivo: true`
3. Job 1 com Chrome offline → mensagem de aviso chega no Telegram
4. Job 2 com mensagem contendo CNPJ → alerta urgente + lembrete 90s depois
5. Rafael responde chave → bot responde com detalhes corretos
