# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# CLAUDE.md — Projeto Rafael (RAFAEL_PRIMO)

## ⚠️ ATENÇÃO: Esta pasta tem DOIS projetos distintos. Não misture.

---

## PROJETO 1 — n8n Automation (já existente, não mexa sem avisar)

Responsável: Rafael
Status: **EM PRODUÇÃO** — workflows rodando em `https://n8n.infra-cellaflux.online`

### Arquivos existentes do n8n (não modificar sem avisar):
- `claude.json` → configuração MCP **legada** (servidor `@n8n/mcp-server`). Não é usada pelo Claude Code; mantida só como referência histórica.
- `.mcp.json` → configuração MCP **ativa** (servidor `n8n-mcp` via `npx`). É esta que o Claude Code carrega.
- `create_workflow.js` / `create_workflow.py` → scripts equivalentes (Node.js puro e Python stdlib) que **criam e ativam** o workflow "Pesquisa de Itens de Licitação - Claude" via API REST do n8n. Use um ou o outro, não os dois.
- `GPT - Com switch caminhos - Verificação e Novo Produto GEMINI (5).json` → export JSON de um workflow mais antigo/maior (com lógica de switch por marca: `SEM_MARCA`, `UMA_OBRIGATORIA`, `DUAS_OBRIGATORIAS`, etc.). Serve como referência — o estado vivo está no n8n, não neste arquivo.
- `manual-tecnico-comprasgov.docx` → manual técnico do ComprasGov (referência para o Projeto 2). Use o MCP do Google Drive ou abra externamente; não é lido por scripts.
- `EXCEL01.jpeg`, `EXCELL02.jpeg`, `PLANILHA.jpeg`, `WhatsApp Image 2026-04-08 at 10.40.44.jpeg` → referências visuais do fluxo.

### Sobre as chaves de API neste repositório:
As chaves do n8n estão em texto puro em `.mcp.json`, `claude.json`, `create_workflow.js` e `create_workflow.py`. **Isso é intencional** — é tooling de produção do Rafael, rodando local, sem repositório git público. Não "consertar" movendo para `.env` sem avisar.

### Comandos comuns:

```bash
# Criar e ativar o workflow simplificado "Pesquisa de Itens" no n8n (escolha 1):
node create_workflow.js
python create_workflow.py

# O MCP do n8n é carregado automaticamente pelo Claude Code via .mcp.json.
# Para testar manualmente:
npx -y n8n-mcp
```

Não há `package.json`, `npm test`, lint ou build — os scripts `create_workflow.*` usam apenas a stdlib (`https` no Node, `urllib` no Python) e o n8n vive em VPS remota.

### Regras para trabalhar no n8n (via MCP `n8n-mcp`):
1. SEMPRE verificar templates antes de criar do zero (`search_nodes`)
2. Validar nodes: `validate_node(mode='minimal')` → `validate_node(mode='full')` antes de salvar
3. NUNCA confiar nos valores padrão — configurar todos os parâmetros explicitamente
4. Executar tools em paralelo quando independentes
5. Só responder APÓS todas as tools completarem

### Conexão n8n:
- URL: `https://n8n.infra-cellaflux.online/api/v1`
- MCP ativo: `n8n-mcp` via `.mcp.json`

### Arquitetura do workflow "Pesquisa de Itens de Licitação - Claude":

Pipeline linear com loop de batches (definido em `create_workflow.js`):

```
Trigger Manual
  → Ler Itens da Planilha (Google Sheets)
    → Loop Sobre Itens (splitInBatches)
      → Preparar Dados e Prompt (Code: monta prompt PT-BR para Claude)
        → Chamar Claude API (HTTP POST → api.anthropic.com, modelo claude-sonnet-4-6)
          → Processar Resposta Claude (Code: parseia JSON, trata erro)
            → Escrever Resultado na Planilha (Google Sheets update por row_number)
              → Aguardar 2 Segundos (rate-limit)
                ↺ volta ao Loop
```

Pontos importantes que ficam escondidos no código:
- **Credencial Google Sheets** é referenciada por ID fixo (`L30NSsRolrpgchHa`) — precisa existir no n8n antes de rodar.
- **Spreadsheet alvo:** `1vzLS1Y7KxRiy4OAauvWYB_YIdJckUgFRHJj1qi4KBnA` ("Teste comunicação", aba `Itens` / gid=0).
- **Chave Anthropic é placeholder** (`SUA_CHAVE_ANTHROPIC_AQUI`) — substituída manualmente no n8n após criação, não pelos scripts.
- **`continueOnFail: true`** no node "Chamar Claude API" — erros viram linha "ERRO: …" na planilha, fluxo continua.

### Schema esperado na planilha (aba `Itens`):

O node "Preparar Dados e Prompt" lê por nome de coluna **OU** por letra (fallback):

| Letra | Nome da coluna         | Conteúdo                                                  |
|-------|------------------------|-----------------------------------------------------------|
| A     | Número da compra       | Identificador do pregão                                   |
| B     | Data Disputa           | Data do pregão                                            |
| C     | Item                   | Número do item dentro do pregão                           |
| D     | Descrição              | Texto do edital — entra direto no prompt                  |
| E     | Marca obrigatória      | Vazia ou marca única / múltiplas separadas por `;`        |
| F     | Marca de preferência   | Vazia ou marca única / múltiplas separadas por `;`        |
| —     | row_number             | Coluna técnica do n8n, usada como chave de update         |
| —     | Resultado Claude       | Saída — preenchida pelo workflow                          |
| —     | Status                 | `Processado` ou `Erro` — preenchida pelo workflow         |

> Workflow legado (`GPT - Com switch caminhos…json`) usa **outro layout** (Item=A, Descrição=B, Obrigatória=C, Preferência=D) e separa marcas por `;` para escolher entre 6 caminhos lógicos. Não confundir com o simplificado acima.

---

## PROJETO 2 — ComprasGov Automation (em desenvolvimento)

Responsável: Leo (desenvolvimento) + Rafael (cliente/usuário)
Status: **RASPAGEM + LOTE + TELEGRAM IMPLEMENTADOS** — raspagem de propostas via CDP (Chrome logado do Rafael), execução em lote com retomada, bot Telegram com `/responder`, `/retomar` e `/raspar`. Validação ao vivo recorrente com o Rafael.

Histórico das abordagens (importante para não repetir caminhos já descartados):
- **Raspagem HTML descartada:** o portal `cnetmobile.estaleiro.serpro.gov.br` tem reCAPTCHA agressivo que bloqueia XHR mesmo com browser headed. Confirmado em recon (3 rodadas).
- **API pública PNCP/DadosAbertos** (`pncp-api.js`, `dadosabertos-api.js`): dados de contratações sem login/CAPTCHA — bom para listar pregões/itens do edital, mas **não** traz as propostas dos concorrentes.
- **Raspagem de propostas via CDP é a abordagem viva:** `raspar-propostas-cdp.js` conecta no Chrome **real e já logado** do Rafael (porta 9222) e raspa as propostas item a item pela rota logada `/seguro/fornecedor/` (reCAPTCHA estável, sessão persiste). Login é sempre manual.
- **Mensagens ao pregoeiro:** fluxo de dupla confirmação (preenche o campo → screenshot → usuário confirma no Telegram → envia). Spec: `docs/superpowers/specs/2026-05-20-resposta-pregoeiro-dupla-confirmacao-design.md`.
- **Raspagem avulsa de itens:** comando `/raspar` no Telegram. Spec: `docs/superpowers/specs/2026-05-26-comprasgov-raspar-itens-avulso-telegram-design.md`.
- Specs/plans anteriores: `docs/superpowers/specs/` e `docs/superpowers/plans/` (rodada de raspagem de itens 2026-04-28; arquitetura em `comprasgov-browser/docs/ARQUITETURA.md`).

### O que este projeto faz:
Automação do portal ComprasGov (comprasnet.gov.br). Um servidor Node.js local (porta 3099)
conecta-se via CDP ao Chrome **já logado** do Rafael para: (1) raspar as propostas dos itens
de um pregão e gerar Excel; (2) ler mensagens do chat do pregão e responder ao pregoeiro com
dupla confirmação. O operador comanda tudo pelo **Telegram**; o agendador roda raspagem diária
e polling de mensagens. O n8n do Rafael pode chamar os endpoints REST públicos (PNCP).

Referência técnica do portal: `manual-tecnico-comprasgov.docx` (na raiz). Arquitetura detalhada:
`comprasgov-browser/docs/ARQUITETURA.md`.

### Stack:
- **Runtime:** Node.js 20+
- **Automação:** Playwright conectado via **CDP** ao Chrome real do usuário (`connectOverCDP('http://127.0.0.1:9222')`) — não sobe browser próprio, reusa a sessão logada.
- **Servidor:** Express.js (porta 3099, apenas localhost)
- **Bot:** Telegram via long-polling (`telegram.js`)
- **Agendador:** node-cron (`agendador.js`)
- **Excel:** ExcelJS
- **APIs públicas:** PNCP (`pncp-api.js`), DadosAbertos ComprasNet (`dadosabertos-api.js`)
- **Tela virtual (VPS):** Xvfb + x11vnc (apenas na VPS, não no local)

### Estrutura atual (pasta `comprasgov-browser/`):
```
comprasgov-browser/
├── server.js                ← Express :3099 + ciclo de vida do Chrome (CDP) + endpoints + boot do Telegram/agendador
├── comprasgov.js            ← lógica Playwright: objeto SEL, extrairMarcas, verificarSessao, fluxo de resposta ao pregoeiro
├── raspar-propostas-cdp.js  ← motor de raspagem de propostas via CDP + gerarExcel + salvarSnapshot (núcleo vivo)
├── lote-runner.js           ← executarLote (varredura completa) + rasparItensEspecificos (avulso /raspar)
├── lote-estado.js           ← persistência de progresso do lote (dados/lote-estado.json), status RODANDO/PAUSADO/...
├── raspar-lote.js           ← CLI: dispara um lote a partir de compras-alvo.json
├── agendador.js             ← node-cron: scraping diário (HORA_SCRAPING) + polling de mensagens (5min, 08-18h, seg-sex)
├── telegram.js              ← bot long-polling: /responder, /retomar, /raspar + dupla confirmação + envio de Excel
├── pncp-api.js              ← API REST pública PNCP (sem browser, sem login)
├── dadosabertos-api.js      ← API DadosAbertos ComprasNet (sem browser, sem login)
├── compras-alvo.json        ← lista de compras a raspar no lote (uasg, tipo, numero, compraId, totalItens)
├── comprasgov.test.js / telegram.test.js / agendador.test.js / raspar-propostas-cdp.test.js  ← testes (node --test)
├── dados/                   ← saídas: Excel (Resultados_CN_*.xlsx), snapshots, logs, lote-estado.json
├── docs/ARQUITETURA.md      ← arquitetura detalhada
├── *.bat                    ← install.bat, raspar-diario.bat, monitorar-lote.bat (abrem Chrome c/ CDP e rodam)
└── package.json / package-lock.json
```

> ⚠️ `npm test` **trava** por causa do `agendador.test.js` (cron mantém o event loop aberto). Para verificar mudanças, rode os arquivos direto, ex.:
> `node --test comprasgov.test.js telegram.test.js raspar-propostas-cdp.test.js`

### Comandos do bot Telegram:
```
/responder <compraId> <item> <texto>  → resposta ao pregoeiro com dupla confirmação (preenche → screenshot → confirma → envia)
/retomar                              → retoma o lote pausado (compras pendentes de compras-alvo.json)
/raspar <compraId> <itens>            → raspa só os itens pedidos (ex: 3,5,7 ou 3-7) → Excel só com eles
```
Todos usam a aba **logada** do Chrome (`/comprasnet-web/seguro/`). `/raspar` recusa se um lote estiver RODANDO (aba é compartilhada).

### API do servidor (porta 3099, bind 127.0.0.1):
```
GET  /status            → { online, browserPronto, url }
GET  /screenshot        → PNG da página atual (debug)
GET  /api/compras-alvo  → conteúdo de compras-alvo.json
GET  /api/raspagens     → Excels já gerados em dados/
POST /api/itens         → { cnpj, ano, sequencial|numeroCompra } → itens (REST público, sem browser)
GET  /api/contratacoes  → ?dataInicial&dataFinal&pagina → lista pregões (REST público, sem browser)
POST /pregao/itens      → { uasg, numeroPregao } via Playwright   ⚠️ bloqueado por CAPTCHA (legado)
```

### Nomes de Excel gerados (em `dados/`):
```
Resultados_CN_<compraId>_RASPAGEM.xlsx              ← lote / raspagem completa
Resultados_CN_<compraId>_ITENS_<n>-<n>_<ts>.xlsx    ← raspagem avulsa via /raspar (não sobrescreve o do lote)
```

### Arquitetura de comunicação:
```
Telegram (Rafael) ─┐
n8n/Lovable webhook ┼→ server.js (localhost:3099) → Playwright/CDP → Chrome logado do Rafael → ComprasGov
agendador (cron) ──┘
```

### Regras para trabalhar no Playwright/CDP:
1. **Login é sempre manual** — nunca automatizar login (Gov.br tem CAPTCHA/certificado).
2. **Conectar, não subir browser** — usa `connectOverCDP('http://127.0.0.1:9222')` no Chrome real já logado do Rafael. Não usar `storageState` nem browser headless próprio: a sessão vive no Chrome do usuário.
3. **Rota logada** — raspar pela rota `/comprasnet-web/seguro/fornecedor/` (reCAPTCHA estável); a rota `/public/` cai por hCaptcha.
4. **Não atropelar a aba compartilhada** — lote e `/raspar` usam a mesma aba logada; respeitar o lock e o status do lote.
5. **Desenvolver local primeiro**, depois VPS.
6. **Pasta `comprasgov-browser/`** é isolada — não criar arquivos deste projeto fora dela.

### Workflow de desenvolvimento:
```
1. Abrir Chrome com CDP + fazer login manual:
   chrome.exe --remote-debugging-port=9222 --user-data-dir="C:\temp\chrome-debug-rafael"
   (atalhos: comprasgov-browser/raspar-diario.bat, monitorar-lote.bat)
2. node server.js                 ← sobe o servidor + bot + agendador (precisa do .env)
3. testar pelo Telegram (/raspar, /retomar, /responder) ou curl localhost:3099/...
4. node --test <arquivos>         ← roda os testes (ver aviso do npm test acima)
```

### Variáveis de ambiente (`comprasgov-browser/.env`):
```
TELEGRAM_TOKEN, TELEGRAM_CHAT_ID   ← bot (CHAT_ID aceita múltiplos separados por vírgula)
HORA_SCRAPING                      ← hora do scraping diário (cron)
CNPJ_RAFAEL                        ← usado p/ detectar mensagens urgentes e nas APIs públicas
API_KEY                            ← auth dos endpoints REST
TELEGRAM_RESPONDER_DRY_RUN         ← legado (fluxo de dupla confirmação já é a salvaguarda)
```

### Deploy na VPS:
Pull + restart manual em `/opt/comprasgov-browser` (sem systemd). Login manual no Chrome da VPS via VNC.

### Setup no notebook Linux (máquina central do Rafael):
O código é portável (usa `path.join`/`__dirname`, sem nada de Windows). Como o
notebook tem tela, NÃO precisa de Xvfb/VNC — abre o Chrome normal na área de
trabalho. Passos (scripts `.sh` já prontos na pasta, equivalentes aos `.bat`):

```bash
# 1. Node 20+ e dependências (NÃO precisa baixar browser do Playwright — conecta no Chrome real via CDP)
cd comprasgov-browser && npm install

# 2. Instalar Google Chrome (Debian/Ubuntu): baixe o .deb e: sudo apt install ./google-chrome-stable_current_amd64.deb

# 3. Copiar/preencher .env (TELEGRAM_TOKEN, TELEGRAM_CHAT_ID, HORA_SCRAPING, CNPJ_RAFAEL, API_KEY)
#    e compras-alvo.json (as compras do lote).

# 4. Tornar os scripts executáveis (uma vez)
chmod +x iniciar-chrome.sh iniciar-servidor.sh raspar-lote.sh

# 5. Abrir Chrome com CDP + LOGIN MANUAL no gov.br/ComprasGov
./iniciar-chrome.sh        # abre Chrome :9222, perfil em ./chrome-debug-profile (login persiste)

# 6a. Subir o bot+agendador (produção):
./iniciar-servidor.sh      # = node server.js
# 6b. OU rodar um lote manual agora:
./raspar-lote.sh                 # lote completo (compras-alvo.json)
./raspar-lote.sh --retomar       # retoma lote pausado (após relogar)
./raspar-lote.sh --apenas <id>,<id>
```

Lote de ~30 compras é só botar os 30 no `compras-alvo.json` e rodar — processa
sequencial, manda Excel por compra no Telegram, pula compras inacessíveis e
**pausa salvando o progresso** se a sessão cair (reloga → `/retomar`). Pode levar
horas (cada item ~15-20s por causa da expansão p/ marca/modelo).

---

## Separação de responsabilidades — resumo rápido

| Pergunta | Resposta |
|----------|----------|
| Mexer nos workflows n8n? | Use o MCP `n8n-mcp` (carregado via `.mcp.json`). Ignore `claude.json` (legado). |
| Recriar o workflow simplificado do zero? | `node create_workflow.js` ou `python create_workflow.py` |
| Criar/editar o servidor de raspagem? | Trabalhe **apenas** dentro da pasta `comprasgov-browser/` |
| Testar o raspador? | **Local primeiro**, com Chrome logado via CDP (9222), depois VPS. `node --test` (não `npm test` — trava no agendador) |
| Mexer no lote / raspagem avulsa? | Núcleo em `lote-runner.js`; estado em `lote-estado.js`; alvos em `compras-alvo.json` |
| Subir algo na VPS? | Só após validação local completa (pull + restart em `/opt/comprasgov-browser`) |
| Dúvida sobre lógica de switch por marca? | Consultar `GPT - Com switch caminhos...json` (export do workflow grande em produção) |
| Dúvida sobre o portal ComprasGov? | `manual-tecnico-comprasgov.docx` |

---

## Contexto do projeto (para o Claude entender o negócio)

Rafael tem uma empresa de licitações. Ele acompanha pregões eletrônicos no ComprasGov, onde
precisa (1) raspar as propostas dos concorrentes para montar planilhas e (2) ler mensagens do
chat do pregão e responder ao pregoeiro. Hoje faz tudo manualmente. O objetivo é automatizar
isso reusando o Chrome logado dele (via CDP), operado pelo Telegram e por um agendador, com o
n8n/Lovable para orquestração e interface.

O n8n atual já processa itens de licitação via Claude/GPT/Gemini e preenche planilhas.
Este novo módulo Playwright é uma adição — não substitui nada do que já existe.
