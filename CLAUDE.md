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
Status: **RODADA 1 IMPLEMENTADA, com pivot em curso.**

- Pasta `comprasgov-browser/` criada com server Express + Playwright (`/status`, `/screenshot`, `/pregao/itens` com mutex e validação 400/409). 8 testes unitários passando para `extrairMarcas`.
- **Raspagem HTML descartada:** o portal `cnetmobile.estaleiro.serpro.gov.br` tem reCAPTCHA agressivo que bloqueia XHR mesmo com browser headed. Confirmado em recon (3 rodadas).
- **Pivot ativo:** rodada 1 vai usar a API REST oficial **Dadosabertos** (`https://dadosabertos.compras.gov.br`) — endpoint `/modulo-contratacoes/2.1_consultarItensContratacoes_PNCP_14133_Id` para itens de uma compra (Lei 14.133/2021). Sem CAPTCHA, contrato estável, ~200ms por chamada.
- **Playwright fica para a rodada 2** (mensagens com login no chat de pregão — esse caso exige browser real).
- Spec rodada 1: `docs/superpowers/specs/2026-04-28-comprasgov-raspagem-itens-design.md`
- Plan rodada 1: `docs/superpowers/plans/2026-04-28-comprasgov-raspagem-itens.md`

### O que este projeto faz:
Automação do portal ComprasGov (comprasnet.gov.br) via Playwright. Um servidor Node.js local
(porta 3099) controla um Chrome, lê mensagens de pregões e envia respostas via API REST.
O n8n do Rafael chama esse servidor via webhook interno.

Referência técnica do portal: `manual-tecnico-comprasgov.docx` (na raiz).

### Stack:
- **Runtime:** Node.js 20+
- **Automação:** Playwright (browser Chromium)
- **Servidor:** Express.js (porta 3099, apenas localhost)
- **Tela virtual (VPS):** Xvfb + x11vnc (apenas na VPS, não no local)
- **Gerenciador de processo (VPS):** systemd

### Estrutura atual (pasta `comprasgov-browser/`):
```
comprasgov-browser/
├── server.js              ← Express + ciclo de vida Chromium + endpoints
├── comprasgov.js          ← lógica Playwright + objeto SEL + extrairMarcas
├── comprasgov.test.js     ← 8 testes unitários (extrairMarcas)
├── package.json           ← deps: express, playwright (Node 20+)
├── .gitignore             ← node_modules/, sessions/, *.log
├── package-lock.json
└── (futuro) setup.sh + sessions/  ← rodada 3 (VPS)
```

### API do servidor (porta 3099, bind 127.0.0.1):
```
GET  /status        → { online, browserPronto, url }                    ✅ implementado
GET  /screenshot    → PNG base64 da página atual (debug)                ✅ implementado
POST /pregao/itens  → { uasg, numeroPregao } → itens                    ⚠️ implementado, raspagem bloqueada (CAPTCHA) — pivot pra API
POST /mensagens/ler       → (rodada 2: precisa de login)                ⏳ pendente
POST /mensagens/responder → (rodada 2: precisa de login)                ⏳ pendente
```

### Arquitetura de comunicação:
```
Lovable (web) → n8n webhook (internet) → browser/server.js (localhost:3099) → Playwright → Chrome → ComprasGov
```

### Regras para trabalhar no Playwright:
1. **Desenvolver local primeiro** — sempre `headless: false` durante desenvolvimento
2. **Usar codegen para capturar seletores:** `npx playwright codegen https://comprasnet.gov.br`
3. **Login é manual** — nunca automatizar login (Gov.br tem CAPTCHA/certificado)
4. **Salvar sessão** via `storageState` após login manual para reutilizar
5. **Só migrar para VPS** quando o script funcionar 100% local
6. **Pasta `browser/`** é isolada — não criar arquivos fora dela para este projeto

### Workflow de desenvolvimento:
```
1. npx playwright codegen <url>   ← captura cliques e gera código
2. node browser/server.js         ← testa o servidor local
3. curl POST localhost:3099/...   ← valida os endpoints
4. scp browser/ user@VPS:/tmp/    ← migra só quando validado
5. bash setup.sh                  ← instala na VPS
```

### Login na VPS (após migração):
```bash
ssh -L 5900:localhost:5900 user@IP-DA-VPS
# conecta VNC no localhost:5900
# faz login manual no ComprasGov
# sessão fica salva em /opt/comprasgov-session/
```

---

## Separação de responsabilidades — resumo rápido

| Pergunta | Resposta |
|----------|----------|
| Mexer nos workflows n8n? | Use o MCP `n8n-mcp` (carregado via `.mcp.json`). Ignore `claude.json` (legado). |
| Recriar o workflow simplificado do zero? | `node create_workflow.js` ou `python create_workflow.py` |
| Criar/editar o servidor Playwright? | Trabalhe **apenas** dentro da pasta `browser/` (ainda não existe — criar) |
| Testar o Playwright? | **Local primeiro**, headless: false, depois VPS |
| Subir algo na VPS? | Só após validação local completa |
| Dúvida sobre lógica de switch por marca? | Consultar `GPT - Com switch caminhos...json` (export do workflow grande em produção) |
| Dúvida sobre o portal ComprasGov? | `manual-tecnico-comprasgov.docx` |

---

## Contexto do projeto (para o Claude entender o negócio)

Rafael tem uma empresa de licitações. Ele acompanha pregões eletrônicos no ComprasGov,
onde precisa ler mensagens do chat do pregão e responder ao pregoeiro. Hoje faz tudo
manualmente. O objetivo é automatizar essa leitura e resposta via Playwright, controlado
pelo n8n que já usa, com uma interface web (Lovable) para o Rafael operar.

O n8n atual já processa itens de licitação via Claude/GPT/Gemini e preenche planilhas.
Este novo módulo Playwright é uma adição — não substitui nada do que já existe.
