# PROJECT_SNAPSHOT — RAFAEL_PRIMO

> Snapshot gerado para sincronização entre instâncias do Claude. Somente leitura — nenhum arquivo do projeto foi modificado.

---

## 1. METADADOS GERAIS

- **Caminho absoluto da raiz:** `C:\Users\leo-p\OneDrive\Documentos\RAFAEL_PRIMO`
- **Data/hora da geração:** 2026-05-13 (gerado pouco após 15:00 GMT-3 de 2026-05-12)
- **Branch atual:** `main`
- **Último commit:** `5cdf1f2` — `feat(telegram): responder pregoeiro via Telegram com confirmação e dry-run` — 2026-05-08 08:59:38 -0300 (leocella)
- **Mudanças não commitadas?** Sim. Há **7 arquivos não rastreados** (nenhum modificado/deletado):

```
?? comprasgov-browser/get-chat-selectors.js
?? comprasgov-browser/parse-html.js
?? comprasgov-browser/server_pid.txt
?? comprasgov-browser/test2.js
?? comprasgov-browser/test3.js
?? comprasgov-browser/test_output.txt
?? pncp_swagger.json
```

> A maioria desses arquivos são scripts de recon/parse pontuais e artefatos de runtime (`server_pid.txt`, `test_output.txt`). Provavelmente devem ser ou deletados ou adicionados ao `.gitignore` (`*.txt`, `*_pid.txt`).

---

## 2. ESTRUTURA DE PASTAS

`tree` não está disponível no ambiente. Listagem manual equivalente:

### Raiz (`RAFAEL_PRIMO/`)

```
RAFAEL_PRIMO/
├── .claude/
│   └── settings.local.json
├── .git/
├── .gitignore
├── .mcp.json                                                  (gitignored)
├── CLAUDE.md
├── claude.json                                                (gitignored — contém JWT n8n)
├── create_workflow.js                                         (gitignored)
├── create_workflow.py                                         (gitignored)
├── EXCEL01.jpeg
├── EXCELL02.jpeg
├── GPT - Com switch caminhos - Verificação e Novo Produto GEMINI (5).json
├── manual-tecnico-comprasgov.docx
├── PLANILHA.jpeg
├── pncp_swagger.json                                          (untracked)
├── Resultados_CN_90004_2026_INST.FED.DE EDUC.TEC BAHIA_CAMPUS SALVADOR.xlsx
├── Resultados_CN_90005_2026_FUNDAÇÃO INSTITUTO DE EDUCAÇÃO DE BARUERI-SP.xlsx
├── Resultados_CN_90005_MODELO_EXCELL_RASPAGEM.xlsx
├── WhatsApp Image 2026-04-08 at 10.40.44.jpeg
├── comprasgov-browser/   (ver abaixo)
└── docs/
    └── superpowers/
        ├── plans/
        │   └── 2026-04-28-comprasgov-raspagem-itens.md
        └── specs/
            └── 2026-04-28-comprasgov-raspagem-itens-design.md
```

### Subpasta `comprasgov-browser/` (depth 4)

```
comprasgov-browser/
├── .env                              (gitignored — variáveis sensíveis)
├── .env.example
├── agendador.js
├── agendador.test.js
├── chrome-debug-profile/             (perfil Chrome — diretório com ~50 subpastas/arquivos
│                                      gerados pelo Chromium, ex.: Default, GraphiteDawnCache,
│                                      Local State, etc.)
├── comparar-snapshots.js
├── compras-alvo.json
├── comprasgov.js
├── comprasgov.test.js
├── dadosabertos-api.js
├── dados/
│   ├── 90483058000126_2026_54_2026-04-29T18-40-00.json
│   ├── chat-live-dump.html
│   ├── chat-open-dump.html
│   ├── itens.csv
│   ├── mensagens_92611506000192025.json
│   ├── pregoes_dadosabertos.csv
│   ├── Propostas_16030405900012026_2026-05-04T13-31-18.xlsx
│   ├── Propostas_16030405900012026_2026-05-04T13-34-33.xlsx
│   ├── Propostas_16030405900012026_2026-05-05.xlsx
│   ├── propostas_debug_16030405900012026_2026-05-04T13-31-18.json
│   ├── propostas_debug_16030405900012026_2026-05-04T13-34-33.json
│   ├── recon_16030405900012026.json
│   ├── recon_detalhes_16030405900012026.json
│   ├── recon-atual.html
│   ├── Resultados_CN_16030405900012026_RASPAGEM.xlsx
│   └── snapshots/
│       ├── relatorio_16030405900012026_2026-05-04_vs_2026-05-05.txt
│       ├── snapshot_16030405900012026_2026-05-04.json
│       ├── snapshot_16030405900012026_2026-05-05.json
│       └── snapshot_16030405900012026_2026-05-07.json
├── docs/
│   ├── ARQUITETURA.md
│   ├── LOVABLE-PROMPT.md
│   └── superpowers/
│       ├── plans/
│       │   ├── 2026-04-30-rodada2-login-mensagens-propostas.md
│       │   ├── 2026-05-07-agendamento-telegram.md
│       │   └── 2026-05-07-lovable-integration.md
│       └── specs/
│           ├── 2026-04-30-rodada2-login-mensagens-propostas-design.md
│           ├── 2026-05-07-agendamento-telegram-design.md
│           └── 2026-05-07-lovable-integration-design.md
├── get-chat-selectors.js             (untracked)
├── install.bat
├── intercept.log                     (gitignored *.log)
├── monitorar-lote.bat
├── nginx/
│   └── compras.conf
├── node_modules/                     (gitignored)
├── package-lock.json
├── package.json
├── parse-html.js                     (untracked)
├── pncp-api.js
├── raspar-dadosabertos.js
├── raspar-diario.bat
├── raspar-lote.js
├── raspar-propostas-cdp.js
├── raspar-propostas-spa.js
├── recon-html.js
├── recon-spa.js
├── scripts/
│   ├── install-cloudflared.sh
│   ├── README.md
│   ├── recon-seletores-resposta.md
│   ├── setup-tunnel.sh
│   ├── start-chrome.sh
│   ├── start-vnc.sh
│   └── stop-all.sh
├── server.js
├── server.log                        (gitignored *.log)
├── server_pid.txt                    (untracked)
├── sessao.js
├── sessions/                         (gitignored)
│   └── session.json
├── smoke-api.js
├── storage.js
├── telegram.js
├── telegram.test.js
├── test_output.txt                   (untracked)
├── test2.js                          (untracked)
├── test3.js                          (untracked)
├── teste-agendador.js
└── teste-chat-cdp.js
```

---

## 3. STACK E DEPENDÊNCIAS

### 3.1 `comprasgov-browser/package.json`

- **Caminho:** `comprasgov-browser/package.json`
- **Versão do Node declarada:** `>=20.0.0` (engines.node)
- **Tipo:** CommonJS (sem `"type": "module"`)
- **Privado:** `true`

**dependencies** (com versão exata instalada, conforme `package-lock.json`):

| Pacote | declarado | instalado |
|---|---|---|
| dotenv | ^16.6.1 | 16.6.1 |
| exceljs | ^4.4.0 | 4.4.0 |
| express | ^4.19.2 | 4.22.1 |
| node-cron | ^3.0.3 | 3.0.3 |
| playwright | ^1.47.0 | 1.59.1 |
| playwright-extra | ^4.3.6 | 4.3.6 |
| puppeteer-extra-plugin-stealth | ^2.11.2 | 2.11.2 |

**devDependencies:** _não encontrado_ (nenhuma dev-dep declarada — testes usam `node:test` nativo).

**scripts:**

```json
{
  "start": "node server.js",
  "test":  "node --test comprasgov.test.js telegram.test.js agendador.test.js"
}
```

### 3.2 `tsconfig.json`

_Não encontrado._ Projeto é JavaScript puro (CommonJS).

### 3.3 Python (raiz do repositório)

- **Arquivo:** `create_workflow.py` (336 linhas; gitignored por conter chave do n8n)
- **Sem `requirements.txt`** — usa apenas stdlib (`urllib`, `json`), conforme documentado no CLAUDE.md.

### 3.4 Outros gerenciadores / containers

- `Dockerfile` — **não encontrado**
- `docker-compose.yml` — **não encontrado**
- `stack.yml` — **não encontrado**
- `pnpm-lock.yaml` / `yarn.lock` — **não encontrado** (apenas npm)

---

## 4. CONFIGURAÇÃO E SEGREDOS

### 4.1 `.env.example` (`comprasgov-browser/.env.example`)

Variáveis presentes (apenas nomes):

- `TELEGRAM_TOKEN`
- `TELEGRAM_CHAT_ID`
- `HORA_SCRAPING`
- `CNPJ_RAFAEL`
- `TELEGRAM_RESPONDER_DRY_RUN`
- `API_KEY`

### 4.2 `.env` (`comprasgov-browser/.env`)

Existe (203 bytes, mod. 2026-05-07). Variáveis encontradas (apenas nomes, valores omitidos):

- `TELEGRAM_TOKEN`
- `TELEGRAM_CHAT_ID`
- `HORA_SCRAPING`
- `CNPJ_RAFAEL`
- `API_KEY`

> O `.env` está gitignored. `TELEGRAM_RESPONDER_DRY_RUN` está no `.env.example` mas não no `.env` atual — comportamento default no código é falsy (auto), mas no `.env.example` está explicitamente `true` (recomendado).

### 4.3 Outros arquivos de configuração na raiz

- `claude.json` — gitignored, contém JWT do n8n em texto puro (documentado como intencional no CLAUDE.md).
- `.mcp.json` — gitignored, configuração ativa do MCP `n8n-mcp` com a mesma chave.
- `create_workflow.{js,py}` — gitignored, ambos referenciam a mesma chave do n8n.
- `.claude/settings.local.json` — configuração local do Claude Code.

### 4.4 ⚠️ Alerta: segredo commitado por engano

**`comprasgov-browser/docs/ARQUITETURA.md` contém um UUID de API key real** em pelo menos duas linhas de exemplo `curl` (linhas que mostram `X-API-Key: <UUID>` em `http://127.0.0.1:3099/status` e `https://compras.infra-cellaflux.online/status`). Esse arquivo **está commitado** (não está no `.gitignore`) e foi adicionado no commit `66b6209` (2026-05-08). Recomenda-se rotacionar essa chave e substituir o valor pelo placeholder `<api_key>` no markdown.

> Valor não reproduzido aqui propositadamente.

---

## 5. CÓDIGO EXISTENTE — INVENTÁRIO

Todos os arquivos JS/PY fora de `node_modules`. Tabela ordenada por pasta.

### 5.1 Raiz (`./`)

| Arquivo | Linhas | Principais exports / símbolos públicos | Descrição (1 linha) |
|---|---:|---|---|
| `create_workflow.js` | 337 | (script CLI, sem `module.exports`) — `getCredentialId`, `createWorkflow`, `activateWorkflow` | Cria e ativa via API REST do n8n o workflow "Pesquisa de Itens de Licitação - Claude" usando apenas `https` da stdlib. |
| `create_workflow.py` | 336 | equivalente Python (urllib stdlib) | Mesma função do `create_workflow.js`, escolha de runtime. |

### 5.2 `comprasgov-browser/` (raiz da subpasta)

| Arquivo | Linhas | Principais exports | Descrição |
|---|---:|---|---|
| `server.js` | 738 | (executável; sem exports) — Express app | Servidor Express na porta 3099 (bind 127.0.0.1) que orquestra browser via CDP, expõe endpoints REST + SSE, inicia `telegram` e `agendador` no boot. |
| `comprasgov.js` | 300 | `extrairMarcas`, `parsearLinhasPropostas`, `parseValorProposta`, `tirarScreenshot`, `rasparItensPregao`, `lerMensagensChat`, `responderMensagem`, `lerPropostasPregao`, `SEL`, `SEL_MSG`, `SEL_PROP` | Lógica Playwright + parsing pure-function para itens, mensagens do chat e propostas do pregão. `SEL_MSG`/`SEL_PROP` ainda têm campos com **RECON_NEEDED**. |
| `pncp-api.js` | 184 | `buscarItensPregaoApi`, `buscarItensPorSequencial`, `buscarContratacoesPorOrgao`, `listarContratacoesRecentes`, `resolverSequencial` | Cliente HTTP (stdlib `https`) para a API pública do PNCP (`pncp.gov.br/api/pncp/v1` e `/api/consulta/v1`), sem browser, sem login. |
| `dadosabertos-api.js` | 344 | `listarPregoes`, `buscarPregaoPorId`, `listarItensPregao`, `buscarItemPregaoPorId`, `listarContratos`, `buscarContratoPorId`, `listarItensContratos`, `listarUasg`, `listarOrgaos`, `pesquisarPrecoMaterial`, `pesquisarPrecoMaterialDetalhe`, `listarContratacoesPNCP`, `listarItensContratacoesPNCP` | Cliente HTTP para `dadosabertos.compras.gov.br` (legado SIASG + contratos + UASG + preços + PNCP 14.133), sem login. |
| `sessao.js` | 123 | `abrirLogin`, `verificarLoginConcluido`, `salvarSessao`, `opcoesContextoComSessao`, `detectarSessaoAtiva`, `apagarSessao`, `sessionExists`, `SESSION_FILE`, `LOGIN_URL` | Gerencia sessão autenticada do ComprasNet legado via `storageState`; login é sempre manual (CAPTCHA Gov.br). |
| `storage.js` | 144 | `salvar`, `listarRaspagens`, `DADOS_DIR` | Persiste raspagens em `dados/{cnpj}_{ano}_{seq}_{ts}.json` + CSV acumulado `dados/itens.csv` (RFC 4180). |
| `agendador.js` | 265 | `init`, `buildDetalhes`, `gerarChaveMensagem`, `ehMensagemUrgente`, `jobScrapingDiario`, `jobMensagensPregoeiro` | Dois jobs cron: scraping diário (`HORA_SCRAPING` h) e polling de mensagens (a cada 5 min, 08h-18h seg-sex) com comparação de snapshots e notificação Telegram. |
| `telegram.js` | 392 | `init`, `enviar`, `notificarMudancas`, `notificarPregoeiro`, `iniciarPolling`, `pararPolling`, `setResponderCallback` (+ internos para testes) | Long-polling do Bot API. Suporta multichat, reply-to-message, inline keyboard de confirmação para resposta ao pregoeiro (dry-run/auto). |
| `comparar-snapshots.js` | 345 | `compararSnapshots`, `indexarPorItemCnpj`, `listarSnapshots` | Compara dois snapshots JSON de propostas e gera relatório de mudanças (status, posição, novos/removidos). |
| `raspar-propostas-cdp.js` | 638 | `conectarChrome`, `navegarParaItemSPA`, `extrairDadosPaginaAtual`, `expandirCardsECapturarDetalhes`, `reconDetalhes`, `gerarExcel`, `salvarSnapshot`, `hoje`, `sleep`, `log` | Conecta ao Chrome via CDP (`:9222`), itera itens da SPA do ComprasGov (`pushState`), extrai propostas e exporta Excel + snapshot JSON. |
| `raspar-lote.js` | 115 | (script CLI, sem exports) | Lê `compras-alvo.json` e roda `raspar-propostas-cdp` em sequência para cada compra. |
| `raspar-propostas-spa.js` | 112 | (script CLI) | Versão alternativa: usa `playwright-extra` + stealth + `launchPersistentContext`, intercepta XHR e gera CSV de propostas. |
| `raspar-dadosabertos.js` | 70 | (script CLI) | Smoke / coleta exemplo do `dadosabertos-api` (lista pregões 2023-01-01 a 2023-01-10). |
| `recon-spa.js` | 60 | (script CLI) | Conecta ao Chrome via CDP e inspeciona se há `.mensagem-card` na aba `acompanhamento-compra`; tenta abrir painel de mensagens. |
| `recon-html.js` | 15 | (script CLI) | Conecta CDP e dumpa `.mensagem-card` outerHTML para stdout. |
| `smoke-api.js` | 66 | (script CLI) | Smoke standalone para `pncp-api`: lista pregões recentes + busca itens de pregão fixo. |
| `sessao.js` (já listado) |  |  |  |
| `teste-agendador.js` | 58 | (script CLI) | Inicia `agendador` conectado ao Chrome CDP, executa `jobMensagensPregoeiro` manualmente, dispara notificação Telegram fake. |
| `teste-chat-cdp.js` | 96 | (script CLI) | Conecta CDP e roda `lerMensagensChat` em uma aba de `acompanhamento-compra` aberta. |
| `comprasgov.test.js` | 91 | `node:test` | 8+ testes unitários para `extrairMarcas`, `parseValorProposta`, `parsearLinhasPropostas`. |
| `telegram.test.js` | 134 | `node:test` | Testes para `init`, `notificarMudancas`, `_formatarPreview`, `_registrarContextoPregoeiro`, `setResponderCallback`. |
| `agendador.test.js` | 129 | `node:test` | Testes para `buildDetalhes`, `gerarChaveMensagem`, `ehMensagemUrgente`, init com/sem bus. |
| `get-chat-selectors.js` | 38 | (script CLI, **untracked**) | Recon: clica em `.icones-mensagens`, dumpa HTML em `dados/chat-open-dump.html` e lista textareas/buttons/file-inputs. |
| `parse-html.js` | 23 | (script CLI, **untracked**) | Parseia `dados/recon-atual.html` listando textareas, inputs, buttons via regex. |
| `test2.js` | 16 | (script CLI, **untracked**) | Parseia `dados/chat-live-dump.html` listando inputs / textareas. |
| `test3.js` | 19 | (script CLI, **untracked**) | Quase idêntico ao `parse-html.js` (filtros adicionais). |

### 5.3 `comprasgov-browser/scripts/` (bash, não-código-fonte)

| Arquivo | Descrição |
|---|---|
| `install-cloudflared.sh` | Instala `cloudflared` na VPS. |
| `setup-tunnel.sh` | Configura o Cloudflare Tunnel para `compras.infra-cellaflux.online`. |
| `start-vnc.sh` | Sobe Xvfb + x11vnc + fluxbox (display `:99`, porta 5900). |
| `start-chrome.sh` | Sobe Google Chrome com `--remote-debugging-port=9222` e `--user-data-dir=/opt/chrome-profile`. |
| `stop-all.sh` | Mata Chrome / x11vnc / fluxbox / Xvfb. |
| `README.md` | Manual de uso na VPS. |
| `recon-seletores-resposta.md` | Roteiro para preencher `SEL_MSG.linkResponder`/`campoResposta`/`botaoEnviar`. |

---

## 6. INTEGRAÇÕES JÁ IMPLEMENTADAS

### 6.1 Playwright
- **Instalado:** sim — `playwright@1.59.1` + `playwright-extra@4.3.6` + `puppeteer-extra-plugin-stealth@2.11.2`.
- **Modo principal:** conexão via CDP (`chromium.connectOverCDP('http://127.0.0.1:9222')`) — controla um Chrome real iniciado fora do processo Node (fundamental para passar o reCAPTCHA do SERPRO).
- **Fallback:** `chromium.launch({ headless })` se CDP estiver indisponível (`server.js:54`).
- **Portais automatizados:**
  - `www.comprasnet.gov.br` — fluxo de login manual (`sessao.js`)
  - `cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/...` — SPA Angular: leitura de mensagens (`.mensagem-card`) e raspagem de propostas item-a-item via `pushState`.
  - URL inicial padrão: `START_URL=https://www.comprasnet.gov.br`.

### 6.2 ComprasGov / ComprasNet
- **Browser (Playwright):** `comprasgov.js`, `sessao.js`, `raspar-propostas-cdp.js`, `raspar-propostas-spa.js`, `raspar-lote.js`, `recon-spa.js`, `recon-html.js`, `get-chat-selectors.js`, `teste-chat-cdp.js`, `agendador.js`, `server.js` (endpoints `/pregao/itens`, `/pregao/propostas`, `/mensagens/ler`, `/mensagens/responder`, `/sessao/*`, `/recon/*`).
- **API REST pública sem browser:**
  - **PNCP** (`pncp-api.js`, server `/api/itens`, `/api/contratacoes`) → endpoints em `https://pncp.gov.br/api/pncp/v1` e `/api/consulta/v1`.
  - **dadosabertos** (`dadosabertos-api.js`, server `/legado/*`, `/pesquisa/*`) → `https://dadosabertos.compras.gov.br/modulo-*`.
- **Status documentado no CLAUDE.md:** raspagem HTML descartada (CAPTCHA agressivo); API REST funciona. Browser permanece apenas para login e leitura/resposta de mensagens do chat — seletores `SEL_MSG.linkResponder/campoResposta/botaoEnviar` e `SEL_PROP.*` ainda **pendentes de recon**.

### 6.3 Supabase
- **Não encontrado.** Nenhum import, nenhum `.from(` que indique cliente Supabase. Não há cliente configurado nem tabelas referenciadas.

### 6.4 Telegram Bot
- **Biblioteca:** nenhuma biblioteca de terceiros — implementação direta via `https.request` para `api.telegram.org/bot<TOKEN>/<metodo>` em `telegram.js`. (`grammy`/`telegraf`/`node-telegram-bot-api` ausentes.)
- **Bot configurado:** `TELEGRAM_TOKEN` e `TELEGRAM_CHAT_ID` no `.env`. Long-polling iniciado no boot do `server.js` quando `TELEGRAM_TOKEN` está presente.
- **Recursos:**
  - `notificarMudancas` (resumo de mudanças com chave de 4 chars para ver detalhes sob demanda)
  - `notificarPregoeiro` com alerta urgente (CNPJ do Rafael) + countdown de 2 min
  - Resposta via reply-to-message → inline-keyboard de confirmação (✅ Confirmar / ❌ Cancelar)
  - Slash command `/responder <compraId> <texto>`
  - Modo `dry-run` (preenche o form e não submete — flag `TELEGRAM_RESPONDER_DRY_RUN`)

### 6.5 BullMQ / Redis
- **Não encontrado.** Sem `bullmq`, `redis`, `ioredis`. O agendamento usa **`node-cron@3.0.3`** em-process (`agendador.js`).

### 6.6 Express / API
**Base:** `comprasgov-browser/server.js`, bind `127.0.0.1:3099`, auth via header `X-API-Key` (timing-safe) — exceto `/events` que aceita `?key=` em query.

| Método | Rota | Arquivo:linha |
|---|---|---|
| GET  | `/status` | `server.js:87` |
| GET  | `/api/compras-alvo` | `server.js:97` |
| GET  | `/events` (SSE) | `server.js:106` |
| GET  | `/screenshot` | `server.js:137` |
| POST | `/pregao/itens` | `server.js:153` (browser, bloqueado por CAPTCHA) |
| POST | `/api/itens` | `server.js:192` (PNCP REST, sem browser) |
| GET  | `/api/raspagens` | `server.js:233` |
| GET  | `/api/contratacoes` | `server.js:253` |
| GET  | `/legado/pregoes` | `server.js:282` |
| GET  | `/legado/pregao` | `server.js:297` |
| GET  | `/legado/itens-pregao` | `server.js:314` |
| GET  | `/legado/item-pregao` | `server.js:328` |
| GET  | `/legado/contratos` | `server.js:344` |
| GET  | `/legado/itens-contratos` | `server.js:359` |
| GET  | `/legado/uasg` | `server.js:375` |
| GET  | `/legado/orgaos` | `server.js:390` |
| GET  | `/pesquisa/preco-material` | `server.js:407` |
| GET  | `/pesquisa/preco-material-detalhe` | `server.js:422` |
| POST | `/sessao/iniciar` | `server.js:442` |
| GET  | `/sessao/status` | `server.js:509` |
| POST | `/sessao/encerrar` | `server.js:538` |
| POST | `/recon/navegar` | `server.js:569` |
| GET  | `/recon/html` | `server.js:588` |
| POST | `/mensagens/ler` | `server.js:614` |
| POST | `/mensagens/responder` | `server.js:645` |
| POST | `/pregao/propostas` | `server.js:671` |

### 6.7 Docker
- `Dockerfile` — **não encontrado**
- `docker-compose.yml` / `stack.yml` — **não encontrado**

Toda a operação acontece nativamente (Chrome + Node) na VPS Ubuntu 24.04, sem containers (decisão documentada em `docs/ARQUITETURA.md §3.3`).

---

## 7. BANCO DE DADOS

- Pasta `migrations/` ou similar — **não encontrado.**
- Schema (Prisma, Drizzle, SQL) — **não encontrado.**
- Não há banco relacional no projeto: persistência é 100% em arquivo:
  - `comprasgov-browser/dados/*.json` (raspagens por pregão)
  - `comprasgov-browser/dados/itens.csv` (append-only, RFC 4180)
  - `comprasgov-browser/dados/snapshots/snapshot_<compraId>_<YYYY-MM-DD>.json` (input do agendador para comparação)
  - `comprasgov-browser/dados/respostas-pregoeiro.log` (audit log JSONL — criado on-demand pelo `comprasgov.js:_logResposta`)
  - `comprasgov-browser/sessions/session.json` (storageState do Playwright)
  - `comprasgov-browser/compras-alvo.json` (lista de pregões monitorados — 11 entradas no momento)

> O n8n em produção do Rafael usa Google Sheets (`1vzLS1Y7KxRiy4OAauvWYB_YIdJckUgFRHJj1qi4KBnA`) como tabela. Este snapshot é só do repositório local.

---

## 8. TESTES

- **Framework:** `node --test` (test runner nativo do Node 20+) + `node:assert`. Sem jest/vitest/playwright-test.
- **Arquivos de teste (3):**
  - `comprasgov-browser/comprasgov.test.js`
  - `comprasgov-browser/telegram.test.js`
  - `comprasgov-browser/agendador.test.js`
- **Script:** `npm test` → `node --test comprasgov.test.js telegram.test.js agendador.test.js`
- **Resultado da execução agora:**
  - Total: **37 testes** — **36 pass / 1 fail**
  - Os 11 testes individuais de `agendador.test.js` passam (`✔`), mas o arquivo como um todo é marcado como `✖ test failed` (~32 s). A causa provável é um handle pendente do `node-cron` agendado pelo `init` impedindo o processo de encerrar — não é falha de assert. Vale converter o `init` para retornar handles canceláveis ou usar `--test-force-exit`.

---

## 9. DEPLOY E INFRAESTRUTURA

- **Não há referência a `infraCella`** literalmente, mas há referência ao domínio **`infra-cellaflux.online`** (Cloudflare DNS) em:
  - `comprasgov-browser/nginx/compras.conf` — vhost para `compras.infra-cellaflux.online` (porta 443) → `proxy_pass http://127.0.0.1:3099` com tuning para SSE. **Não usado em produção** (Traefik domina 80/443; o tráfego entra via Cloudflare Tunnel direto).
  - `comprasgov-browser/scripts/setup-tunnel.sh` — config do `cloudflared`.
  - `comprasgov-browser/docs/ARQUITETURA.md` e `LOVABLE-PROMPT.md` — manual de operação.
- **Dockerfile:** não existe. Nenhum build de imagem.
- **VPS (Hostinger, 72.60.2.102, Ubuntu 24.04):** Node 24.14.1 + Chrome 148 + Xvfb + x11vnc + fluxbox + cloudflared 2026.3.0. Tudo `bash` script + processos manuais (sem systemd ainda — documentado como "rodada futura").
- **Documentação de deploy:**
  - `comprasgov-browser/docs/ARQUITETURA.md` (manual de operação completo)
  - `comprasgov-browser/scripts/README.md` (passos na VPS)
- **README.md** na raiz — **não encontrado** (o `CLAUDE.md` faz esse papel).

---

## 10. README E DOCUMENTAÇÃO

### 10.1 README.md na raiz
**Não encontrado.** O `CLAUDE.md` (11.4 KB) cumpre o papel de README do projeto.

### 10.2 Documentos .md existentes

```
CLAUDE.md
comprasgov-browser/docs/ARQUITETURA.md
comprasgov-browser/docs/LOVABLE-PROMPT.md
comprasgov-browser/scripts/README.md
comprasgov-browser/scripts/recon-seletores-resposta.md
comprasgov-browser/docs/superpowers/plans/2026-04-30-rodada2-login-mensagens-propostas.md
comprasgov-browser/docs/superpowers/plans/2026-05-07-agendamento-telegram.md
comprasgov-browser/docs/superpowers/plans/2026-05-07-lovable-integration.md
comprasgov-browser/docs/superpowers/specs/2026-04-30-rodada2-login-mensagens-propostas-design.md
comprasgov-browser/docs/superpowers/specs/2026-05-07-agendamento-telegram-design.md
comprasgov-browser/docs/superpowers/specs/2026-05-07-lovable-integration-design.md
docs/superpowers/plans/2026-04-28-comprasgov-raspagem-itens.md
docs/superpowers/specs/2026-04-28-comprasgov-raspagem-itens-design.md
```

### 10.3 Seções (títulos) do `CLAUDE.md`

- `CLAUDE.md — Projeto Rafael (RAFAEL_PRIMO)`
- `⚠️ ATENÇÃO: Esta pasta tem DOIS projetos distintos. Não misture.`
- `PROJETO 1 — n8n Automation (já existente, não mexa sem avisar)`
  - `Arquivos existentes do n8n (não modificar sem avisar):`
  - `Sobre as chaves de API neste repositório:`
  - `Comandos comuns:`
  - `Regras para trabalhar no n8n (via MCP n8n-mcp):`
  - `Conexão n8n:`
  - `Arquitetura do workflow "Pesquisa de Itens de Licitação - Claude":`
  - `Schema esperado na planilha (aba Itens):`
- `PROJETO 2 — ComprasGov Automation (em desenvolvimento)`
  - `O que este projeto faz`, `Stack`, `Estrutura atual`, `API do servidor`, `Arquitetura de comunicação`, `Regras para trabalhar no Playwright`, `Workflow de desenvolvimento`, `Login na VPS`
- `Separação de responsabilidades — resumo rápido`
- `Contexto do projeto (para o Claude entender o negócio)`

### 10.4 Seções do `comprasgov-browser/docs/ARQUITETURA.md`

- `1. O que o sistema faz` · `2. Arquitetura` · `3. Por que cada escolha` (Chrome real + Xvfb, CDP, Cloudflare Tunnel, API key timing-safe, SSE, multichat) · `4. Componentes em produção` (VPS, domínio, software, diretórios) · `5. Como operar` (subir, VNC, verificar, parar) · `6. Endpoints da API pública`.

### 10.5 TODO / FIXME / ⚠️ — top 10 ocorrências

Não há `TODO`/`FIXME`/`HACK` literais. Há **14 marcações `⚠️`** no código, todas relacionadas a estado conhecido (CAPTCHA, RECON_NEEDED, seletores incompletos):

1. `comprasgov.js:21` — `⚠️ RECON_NEEDED: todos os valores de SEL_MSG precisam ser confirmados ao vivo`
2. `comprasgov.js:41` — `⚠️ RECON_NEEDED: preencher SEL_PROP após Task 4 (recon manual)`
3. `comprasgov.js:144` — `⚠️ Seletores em SEL_MSG precisam de recon ao vivo para funcionar`
4. `comprasgov.js:251` — `⚠️ SEL_PROP precisa ser preenchido após recon (Task 4)`
5. `comprasgov.js:272` — erro lançado `Seletores de propostas não encontrados (⚠️ RECON_NEEDED)`
6. `agendador.js:95` — `⚠️ Chrome offline — scraping diário cancelado`
7. `raspar-lote.js:42` — `⚠️ URL atual não parece ser ComprasGov`
8. `raspar-lote.js:77` — `⚠️ Item X não retornou descrição. Considerado fim da compra`
9. `raspar-lote.js:97` — `⚠️ Nenhum dado capturado. Verifique se a compra existe ou se precisa resolver Captcha`
10. `raspar-propostas-cdp.js:220` — `⚠️ Nenhum seletor de accordion encontrado`

---

## 11. ÚLTIMAS ATIVIDADES NO GIT

### 11.1 Últimos 10 commits (mais recente primeiro)

| hash | data | autor | mensagem |
|---|---|---|---|
| `5cdf1f2` | 2026-05-08 08:59 | leocella | feat(telegram): responder pregoeiro via Telegram com confirmação e dry-run |
| `66b6209` | 2026-05-08 07:27 | leocella | docs: arquitetura completa + prompt para integrar via Lovable |
| `eed9673` | 2026-05-08 07:13 | leocella | feat(scripts): setup do Cloudflare Tunnel para compras.infra-cellaflux.online |
| `54b825c` | 2026-05-08 07:07 | leocella | feat(scripts): instalar cloudflared |
| `8a23729` | 2026-05-08 06:54 | leocella | feat(scripts): VNC exposto publicamente em 0.0.0.0 para teste |
| `0beb5e7` | 2026-05-08 06:46 | leocella | feat(scripts): scripts de deploy na VPS (Xvfb + VNC + Chrome debug) |
| `71d7408` | 2026-05-07 22:17 | leocella | fix(nginx): adicionar proxy_http_version 1.1 para SSE funcionar corretamente |
| `d7101e9` | 2026-05-07 22:02 | leocella | feat(nginx): config reverse proxy para comprasgov-browser com SSE |
| `1325294` | 2026-05-07 21:52 | leocella | feat(server): conectar bus ao agendador no boot para eventos SSE |
| `a1eea06` | 2026-05-07 21:36 | leocella | feat(agendador): emitir eventos SSE no bus para mudancas, mensagens e scraping |

### 11.2 Arquivos mais modificados nos últimos 30 dias (top 10)

| ocorrências | arquivo |
|---:|---|
| 18 | `comprasgov-browser/server.js` |
| 8  | `comprasgov-browser/comprasgov.js` |
| 5  | `comprasgov-browser/package-lock.json` |
| 5  | `comprasgov-browser/package.json` |
| 4  | `comprasgov-browser/raspar-propostas-cdp.js` |
| 4  | `comprasgov-browser/.gitignore` |
| 3  | `comprasgov-browser/telegram.js` |
| 3  | `comprasgov-browser/agendador.test.js` |
| 3  | `comprasgov-browser/agendador.js` |
| 3  | `comprasgov-browser/.env.example` |

### 11.3 Branches

- Locais: `main` (única)
- Remotas: `origin/main` (e `origin/HEAD -> origin/main`)

---

## 12. PROBLEMAS ENCONTRADOS

1. **Segredo commitado em documentação:** `comprasgov-browser/docs/ARQUITETURA.md` contém uma `X-API-Key` (UUID) real em comandos `curl` de exemplo (`§5.3`). O `.gitignore` cobre `.env`, mas não o markdown. → **Recomendado:** rotacionar a chave e substituir pelo placeholder `<api_key>`.
2. **`pncp_swagger.json` na raiz não rastreado** (75 KB) — provavelmente referência baixada manualmente; decidir se entra para `docs/` ou para o `.gitignore`.
3. **Cinco arquivos `.js` "soltos" não rastreados em `comprasgov-browser/`** (`get-chat-selectors.js`, `parse-html.js`, `test2.js`, `test3.js`) são recon ad-hoc e parecem candidatos a apagar ou consolidar. `test2.js`/`test3.js` têm nomes confusos por serem capturados pelo glob `comprasgov.test.js`/`telegram.test.js`/`agendador.test.js` do script `test`. Confusão potencial: alguém pode achar que são testes.
4. **`server_pid.txt` e `test_output.txt` na pasta** — runtime artifacts. Adicionar `*_pid.txt` e `*_output.txt` ao `.gitignore` (já existe `*.log`, mas não cobre estes).
5. **`agendador.test.js` deixa o processo aberto:** todos os 11 asserts passam mas o test runner reporta o arquivo como `✖` por causa de `cron.schedule` no `init` que não é cancelado. → ou destruir tasks ao final do teste ou rodar com `--test-force-exit`.
6. **`SEL_MSG.linkResponder / campoResposta / botaoEnviar`** vazios — endpoint `POST /mensagens/responder` lança erro de configuração até o recon (`scripts/recon-seletores-resposta.md`) ser executado ao vivo.
7. **`SEL_PROP.*`** todos vazios — endpoint `POST /pregao/propostas` lança `RECON_NEEDED` (Task 4 do plano de rodada 2). Há um caminho alternativo funcional via `raspar-propostas-cdp.js` (CDP direto, sem `server.js`).
8. **`POST /pregao/itens`** funcional só em teoria — bloqueado por CAPTCHA do `cnetmobile.estaleiro.serpro.gov.br` mesmo em browser headed (3 rodadas de recon confirmaram). Caminho preferencial é `/api/itens` (PNCP REST).
9. **`raspar-propostas-spa.js`** cria `chrome_perfil_robo/` na raiz da subpasta (não previsto no `.gitignore`) — risco de commit acidental.
10. **Possível dependência implícita** entre `agendador.js` e `raspar-propostas-cdp.js` — o agendador usa `extrairDadosPaginaAtual`, `navegarParaItemSPA`, `salvarSnapshot` do módulo CDP, mas isso só é claro lendo `agendador.js:8-14`. O CLAUDE.md descreve `raspar-propostas-cdp.js` como CLI; ele também é biblioteca.

> Nenhum `npm install --dry-run` ou `tsc --noEmit` foi executado (sem TypeScript no projeto; `npm install` exigiria conexão e tempo). `npm test` foi rodado — resultado em §8.

---

## 13. RESUMO EXECUTIVO

- **O projeto é dois sistemas distintos compartilhando o mesmo diretório.** (1) Tooling do n8n em produção (gerenciado pelo MCP `n8n-mcp`, arquivos `claude.json`, `.mcp.json`, `create_workflow.{js,py}` — todos gitignored) e (2) `comprasgov-browser/`, um servidor Node/Express + Playwright para automatizar o ComprasGov.
- **O que está pronto e funcionando** (comprasgov-browser):
  - Cliente REST do PNCP (`pncp-api.js`) e do `dadosabertos.compras.gov.br` (`dadosabertos-api.js`) — 100% sem browser, sem CAPTCHA. Exposto via `/api/itens`, `/api/contratacoes`, `/legado/*`, `/pesquisa/*` com auth `X-API-Key` (timing-safe).
  - Bot Telegram (long-polling puro `https`): notifica resumo de mudanças, alerta urgente quando o CNPJ é citado pelo pregoeiro (countdown 2 min), responde via reply-to-message com inline-keyboard de confirmação e suporte a dry-run.
  - Agendador (`node-cron`): scraping diário 07h + polling de mensagens a cada 5 min em horário comercial.
  - Snapshot diário + diff (`comparar-snapshots.js`) — formato JSON, comparação por (item, CNPJ), notifica mudança de status/posição/entradas/saídas.
  - Conexão CDP ao Chrome real (porta 9222) com perfil persistente — única forma confirmada de passar o reCAPTCHA do SERPRO.
  - SSE (`/events`) com 5 tipos de evento conectados ao `bus` interno (heartbeat 30 s).
  - Cloudflare Tunnel + nginx (config pronta, não usada — Tunnel resolve sozinho).
- **O que está pela metade:**
  - **Resposta ao pregoeiro:** o fluxo Telegram → server existe, mas `SEL_MSG.linkResponder/campoResposta/botaoEnviar` ainda **vazios** — depende de recon ao vivo (roteiro em `scripts/recon-seletores-resposta.md`).
  - **Leitura de propostas via endpoint** (`POST /pregao/propostas`): `SEL_PROP` todo vazio. Existe caminho alternativo funcional via CLI (`raspar-propostas-cdp.js`).
  - **Suites de teste**: 36/37 passam; `agendador.test.js` deixa o processo aberto por causa de `cron.schedule` não cancelado.
  - **Operação na VPS:** scripts manuais, sem systemd ainda.
- **O que ainda não foi começado:**
  - Banco de dados (tudo em arquivo JSON/CSV — Supabase referenciado em conversas mas sem código).
  - BullMQ/Redis para filas (atualmente `node-cron` in-process).
  - Frontend Lovable (apenas prompt em `LOVABLE-PROMPT.md`).
  - Containerização (`Dockerfile` ainda não existe).
  - Testes E2E com browser real (cobertura atual é apenas funções puras).
- **Maiores riscos / dívidas técnicas:**
  - **Segredo (API key) commitado em `docs/ARQUITETURA.md`** — rotacionar.
  - 7 arquivos novos não rastreados, alguns são lixo de recon e poluem a árvore.
  - Estado do CAPTCHA do SERPRO é frágil — depende de o Rafael deixar a sessão logada no Chrome da VPS via VNC; qualquer reboot exige re-login manual.
  - Acoplamento implícito: `agendador.js` importa funções do `raspar-propostas-cdp.js`, que é tanto CLI quanto biblioteca — vale extrair as funções compartilhadas para um módulo dedicado.
  - `node-cron` em-process: se o `server.js` cair, os jobs param. Sem retry/persistência de state — recuperação manual.
