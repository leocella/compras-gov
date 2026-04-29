# Design — ComprasGov: raspagem pública de itens de pregão

**Data:** 2026-04-28
**Projeto:** RAFAEL_PRIMO / Projeto 2 — ComprasGov Browser Automation
**Rodada:** 1 de N (raspagem pública sem login)
**Autor:** Leo + Claude

---

## 1. Contexto e motivação

Rafael tem uma empresa de licitações. Hoje, para alimentar o workflow do n8n
(`Pesquisa de Itens de Licitação - Claude`), ele digita à mão na planilha
`Teste comunicação` (Google Sheets) os itens de cada pregão que está
acompanhando: número da compra, data da disputa, número do item, descrição,
marcas obrigatórias e preferenciais. Isso é repetitivo e propenso a erro.

A automação Playwright (Projeto 2) tem dois objetivos finais:

1. **Raspar dados públicos** dos pregões no ComprasGov (sem login) — ataca a
   dor de digitação manual.
2. **Ler/responder mensagens do chat de pregão** (com login) — automatiza
   o atendimento ao pregoeiro.

Esta spec cobre **somente o objetivo 1, rodada 1**. Mensagens com login
ficam para uma rodada futura, em outra spec.

## 2. Escopo desta rodada

**Dentro do escopo:**

- Servidor Node.js local (`server.js` + `comprasgov.js` + `package.json`).
- Endpoint para raspar todos os itens de um pregão público específico, dado
  UASG + número do pregão.
- Endpoints auxiliares mínimos: `/status` (saúde) e `/screenshot` (debug).
- Chromium não-headless local (`headless: false`) para o desenvolvedor poder
  ver o que está acontecendo.

**Fora do escopo:**

- Login no ComprasGov / sessão persistente.
- Endpoints de mensagens (`/mensagens/ler`, `/mensagens/responder`).
- Refresh automático de página.
- `setup.sh` para a VPS.
- Workflow n8n (`comprasgov-workflow.json`).
- Cliente Lovable / qualquer UI.
- Testes automatizados (a primeira validação é manual via `curl`).

Tudo no "fora do escopo" entra em rodadas futuras, com spec própria.

## 3. Estrutura de arquivos

```
comprasgov-browser/
├── server.js          # Express + ciclo de vida do browser + endpoints
├── comprasgov.js      # Lógica Playwright + objeto SEL com seletores
├── package.json       # deps: express, playwright
└── .gitignore         # ignora node_modules/ e (futuro) sessions/
```

`server.js` não conhece HTML/seletores. `comprasgov.js` não conhece Express.
Essa separação permite ajustar seletores via VNC sem mexer no servidor e,
mais tarde, exercitar `comprasgov.js` em testes isolados.

## 4. Configuração (env vars com defaults sensatos)

| Variável         | Default                          | Quando mudar                                |
|------------------|----------------------------------|---------------------------------------------|
| `PORT`           | `3099`                           | Conflito de porta local                     |
| `START_URL`      | `https://www.comprasnet.gov.br`  | Se descobrir URL de busca mais direta       |
| `HEADLESS`       | `false`                          | Na VPS (headless via Xvfb)                  |

Sem `.env`, sem `dotenv` — leitura direta de `process.env` com `||` para
default. YAGNI.

## 5. Endpoints HTTP

Todos bind em `127.0.0.1:3099` (nunca `0.0.0.0`). JSON in/out. Sem auth
(localhost only).

### 5.1 `GET /status`

Resposta:

```json
{ "online": true, "browserPronto": true }
```

`browserPronto = false` durante o boot (antes do `chromium.launch` resolver)
ou se o browser tiver caído.

### 5.2 `POST /pregao/itens`

Body:

```json
{ "uasg": "158125", "numeroPregao": "90148/2025" }
```

Resposta de sucesso:

```json
{
  "sucesso": true,
  "uasg": "158125",
  "numeroPregao": "90148/2025",
  "totalItens": 3,
  "itens": [
    {
      "numero": "1",
      "descricao": "Caneta esferográfica azul, ponta fina...",
      "quantidade": 100,
      "unidade": "UN",
      "valorEstimado": 1.50,
      "marcaObrigatoria": "BIC",
      "marcaPreferencia": ""
    }
  ],
  "url": "https://www.comprasnet.gov.br/..."
}
```

Campos não extraídos vêm como `""` (strings) ou `null` (números). Não
inventar valores.

Erros:

- `400` — falta `uasg` ou `numeroPregao` no body.
- `409` — outra raspagem em andamento (mutex).
- `500` — exceção do Playwright (timeout, seletor não encontrado).
  Resposta: `{ sucesso: false, erro: "<mensagem>" }`.

### 5.3 `GET /screenshot`

Resposta:

```json
{ "sucesso": true, "screenshotBase64": "iVBORw0KGgo..." }
```

PNG da página atual. Útil para depuração quando uma raspagem retorna `[]`.

## 6. Ciclo de vida do browser

No boot do `server.js`:

1. `chromium.launch({ headless: HEADLESS })` — uma instância única, compartilhada.
2. `browser.newContext()` → `context.newPage()` → navega para `START_URL`.
3. Liga o Express em `127.0.0.1:PORT`.
4. `process.on('SIGINT'/'SIGTERM')` → fecha browser e sai com código 0.

**Sem** `launchPersistentContext` nesta rodada (não há sessão pra preservar).
**Sem** refresh automático.

**Mutex:** `let busy = false` global. Cada handler de `/pregao/itens`:

```js
if (busy) return res.status(409).json({ erro: "ocupado" });
busy = true;
try { /* raspagem */ } finally { busy = false; }
```

`/status` e `/screenshot` não respeitam mutex (são leituras instantâneas e
não navegam).

## 7. `comprasgov.js` — interface

```js
async function getStatus(page);
// → { browserPronto: boolean }

async function rasparItensPregao(page, uasg, numeroPregao);
// → { itens: [...], url: string }

async function tirarScreenshot(page);
// → string (base64 PNG)

const SEL = { /* ver §8 */ };
```

Funções recebem `page` como primeiro argumento — não conhecem o browser
nem o servidor. Testáveis isoladamente quando quisermos.

## 8. Seletores (`SEL`) — chute informado

```js
const SEL = {
  // tela de busca pública
  campoUasg:    'input[name*="uasg" i], input[id*="uasg" i]',
  campoNumero:  'input[name*="numero" i], input[id*="numero" i]',
  botaoBuscar:  'button:has-text("Pesquisar"), button:has-text("Buscar")',

  // navegação até a lista de itens
  linkItens:    'a:has-text("itens"), a[href*="itens"]',

  // tabela de itens
  linhasItens:  'table tr, [class*="item"]',
  colNumero:        'td:nth-child(1)',
  colDescricao:     'td:nth-child(2)',
  colQuantidade:    'td:nth-child(3)',
  colUnidade:       'td:nth-child(4)',
  colValorEstimado: 'td:nth-child(5)',
};
```

Estes são chutes baseados nas convenções típicas de portais governamentais
brasileiros — **não há garantia** de que funcionam de primeira. A primeira
execução real provavelmente vai exigir 1-3 ajustes via DevTools. Por isso
todos vivem em um único objeto no topo do arquivo.

Marca obrigatória / preferência: estas tipicamente vivem na descrição do
item, não em colunas separadas. A função vai tentar regex simples sobre
`descricao` (ex.: `/marca obrigat[óo]ria:\s*([^\n.]+)/i`) e, se não casar,
deixa string vazia.

## 9. Fluxo de `rasparItensPregao(page, uasg, numero)`

1. `page.goto(START_URL)` (idempotente — se já está lá, é instantâneo).
2. `page.fill(SEL.campoUasg, uasg)`.
3. `page.fill(SEL.campoNumero, numero)`.
4. `page.click(SEL.botaoBuscar)` → `page.waitForLoadState('networkidle')`.
5. `page.click(SEL.linkItens)` → `page.waitForLoadState('networkidle')`.
6. `page.$$eval(SEL.linhasItens, ...)` → mapeia cada linha para o shape
   da §5.2 (com fallback `""` / `null` por campo).
7. Pós-processo em JS: para cada item, regex sobre `descricao` para extrair
   `marcaObrigatoria` e `marcaPreferencia`.
8. Retorna `{ itens, url: page.url() }`.

Timeouts: defaults do Playwright (30s). Não customizar nesta rodada.

## 10. Tratamento de erros

| Situação                         | Comportamento                              |
|----------------------------------|--------------------------------------------|
| Body sem `uasg` ou `numeroPregao`| `400` `{ erro: "campo X obrigatório" }`    |
| Raspagem concorrente             | `409` `{ erro: "ocupado" }`                |
| Timeout do Playwright            | `500` + `console.error` com stack          |
| Seletor não encontrado           | `500` + sugestão de rodar `/screenshot`    |
| Pregão inexistente               | `200` `{ sucesso: true, totalItens: 0, … }` (não é erro do servidor) |

## 11. Testes manuais (sem suite automatizada nesta rodada)

```bash
cd comprasgov-browser
npm install
npx playwright install chromium
node server.js
# Em outro terminal:
curl http://localhost:3099/status
curl -X POST http://localhost:3099/pregao/itens \
  -H "Content-Type: application/json" \
  -d '{"uasg":"158125","numeroPregao":"90148/2025"}'
curl http://localhost:3099/screenshot | node -e "let s='';process.stdin.on('data',c=>s+=c).on('end',()=>require('fs').writeFileSync('tela.png',Buffer.from(JSON.parse(s).screenshotBase64,'base64')))"
```

Critério de "funcionou": com Chrome aberto, ver navegação acontecendo na tela
e receber JSON com `totalItens > 0` para um pregão real conhecido. Se vier
`totalItens: 0`, abrir DevTools no Chrome controlado, ajustar `SEL.linhasItens`
e tentar de novo.

## 12. Riscos conhecidos

- **Seletores especulativos.** A primeira execução real vai precisar de
  ajuste. Mitigação: tudo centralizado em `SEL`, fácil de editar.
- **ComprasGov pode mudar HTML.** Sem mitigação proativa nesta rodada — se
  quebrar, ajusta seletor.
- **Anti-bot do portal.** Se houver rate limiting ou CAPTCHA, vamos
  descobrir só na primeira execução. Pode ser preciso adicionar `waitForTimeout`
  entre passos (não vamos preventivamente).
- **OneDrive + node_modules.** A pasta está dentro do OneDrive. `node_modules`
  com milhares de arquivos pode ser lento de sincronizar. Mitigação: `.gitignore`
  + se virar problema, mover o projeto pra fora do OneDrive.

## 13. Próximas rodadas (não fazem parte desta)

- **Rodada 2:** login + sessão persistente (`launchPersistentContext`,
  `userDataDir`, refresh 10 min) + endpoints `/mensagens/ler` e `/mensagens/responder`.
- **Rodada 3:** `setup.sh` para a VPS (Xvfb, x11vnc, systemd) + workflow
  n8n para integrar.
- **Rodada 4:** integração da raspagem com a planilha do Projeto 1 (escrever
  `itens` direto no Google Sheets em vez de o Rafael digitar).
