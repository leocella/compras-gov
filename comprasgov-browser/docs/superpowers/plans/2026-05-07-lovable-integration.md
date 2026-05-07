# Integração Lovable — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expor o `server.js` publicamente via nginx + HTTPS com autenticação por API key e endpoint SSE para o Lovable receber eventos em tempo real.

**Architecture:** `EventEmitter` interno (`bus`) criado no `server.js` e injetado no `agendador.js` via `init()`. Endpoints `/events` (SSE) e `/api/compras-alvo` adicionados ao Express. Middleware de API key protege todas as rotas. nginx faz reverse proxy de `compras.infra-cellaflux.online → 127.0.0.1:3099`.

**Tech Stack:** Node.js 20+, Express, `events` (stdlib), nginx, certbot/Let's Encrypt.

---

## Mapa de arquivos

| Arquivo | Ação | O que muda |
|---------|------|-----------|
| `server.js` | Modificar | `EventEmitter` bus + middleware auth + `GET /events` + `GET /api/compras-alvo` + passar `bus` ao `agendador.init()` |
| `agendador.js` | Modificar | Receber `bus` no `init()`, emitir 4 tipos de evento |
| `agendador.test.js` | Modificar | Adicionar teste de `init()` com `bus` |
| `.env` | Modificar | Adicionar `API_KEY` |
| `.env.example` | Modificar | Adicionar `API_KEY=` |
| `nginx/compras.conf` | Criar | Config nginx com SSL e proxy para `:3099` |

---

## Task 1: API_KEY no .env + middleware de autenticação no server.js

**Files:**
- Modify: `.env`
- Modify: `.env.example`
- Modify: `server.js` (após linha 66 — `app.use(express.json())`)

- [ ] **Step 1: Gerar API_KEY e adicionar ao .env**

No terminal, gerar uma chave aleatória:

```bash
node -e "console.log(require('crypto').randomUUID())"
```

Copiar o resultado (ex: `a1b2c3d4-e5f6-7890-abcd-ef1234567890`) e adicionar ao `.env`:

Abrir `.env` e adicionar a linha ao final:

```
API_KEY=a1b2c3d4-e5f6-7890-abcd-ef1234567890
```

(usar o UUID gerado, não este exemplo)

- [ ] **Step 2: Adicionar API_KEY ao .env.example**

Abrir `.env.example` e adicionar ao final:

```
# Lovable integration
API_KEY=gerar-com-node-e-require-crypto-randomUUID
```

Conteúdo final do `.env.example`:

```env
# Telegram Bot (obter via @BotFather)
TELEGRAM_TOKEN=123456789:ABC-DEF...
TELEGRAM_CHAT_ID=987654321

# Agendador
HORA_SCRAPING=7
CNPJ_RAFAEL=12345678000190

# Lovable integration
API_KEY=gerar-com-node-e-require-crypto-randomUUID
```

- [ ] **Step 3: Adicionar middleware de auth no server.js**

Abrir `server.js`. Localizar a linha 66:

```js
app.use(express.json());
```

Inserir o bloco abaixo **imediatamente após** essa linha:

```js
app.use((req, res, next) => {
  if (req.path === '/events') return next(); // /events tem auth própria via ?key=
  if (req.headers['x-api-key'] !== process.env.API_KEY)
    return res.status(401).json({ erro: 'Não autorizado' });
  next();
});
```

- [ ] **Step 4: Testar middleware sem key — deve retornar 401**

```bash
node server.js &
```

Aguardar a mensagem `[boot] API rodando em http://127.0.0.1:3099`. Então:

```bash
curl -s http://127.0.0.1:3099/status
```

Saída esperada:

```json
{"erro":"Não autorizado"}
```

- [ ] **Step 5: Testar middleware com key correta — deve retornar 200**

```bash
curl -s -H "X-API-Key: SEU_UUID_AQUI" http://127.0.0.1:3099/status
```

Saída esperada:

```json
{"online":true,"browserPronto":true,...}
```

```bash
kill %1
```

- [ ] **Step 6: Commit**

```bash
git add .env.example server.js
git commit -m "feat(auth): middleware API key para todas as rotas do server.js"
```

---

## Task 2: Endpoint GET /api/compras-alvo

**Files:**
- Modify: `server.js` (após o endpoint `GET /status`, que termina na linha 76)

- [ ] **Step 1: Adicionar endpoint ao server.js**

Localizar no `server.js` o bloco do `/status` (termina em `});` na linha 76). Inserir **imediatamente após** esse bloco:

```js
app.get('/api/compras-alvo', (req, res) => {
  try {
    const alvos = JSON.parse(fs.readFileSync(path.join(__dirname, 'compras-alvo.json'), 'utf8'));
    res.json(alvos);
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao ler compras-alvo.json: ' + err.message });
  }
});
```

- [ ] **Step 2: Testar o endpoint**

```bash
node server.js &
```

```bash
curl -s -H "X-API-Key: SEU_UUID_AQUI" http://127.0.0.1:3099/api/compras-alvo
```

Saída esperada: array JSON com os objetos de `compras-alvo.json` (ex: `[{"compraId":"...","uasg":"...","numero":"..."}]`).

```bash
kill %1
```

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "feat(api): endpoint GET /api/compras-alvo"
```

---

## Task 3: EventEmitter bus + endpoint GET /events SSE

**Files:**
- Modify: `server.js` (topo do arquivo + após `GET /api/compras-alvo`)

- [ ] **Step 1: Adicionar EventEmitter ao topo do server.js**

Localizar no `server.js` as linhas de require (linhas 4-16). Após a linha `const agendador = require('./agendador');` (linha 16), inserir:

```js
const EventEmitter = require('events');
const bus = new EventEmitter();
bus.setMaxListeners(50); // suportar múltiplos clientes SSE simultâneos
```

- [ ] **Step 2: Adicionar endpoint GET /events ao server.js**

Localizar o endpoint `GET /api/compras-alvo` adicionado na Task 2. Inserir **imediatamente após** ele:

```js
app.get('/events', (req, res) => {
  const key = req.query.key || req.headers['x-api-key'];
  if (key !== process.env.API_KEY) return res.status(401).end();

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (event, data) =>
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  const handlers = {
    mudanca_detectada:  d => send('mudanca_detectada', d),
    mensagem_pregoeiro: d => send('mensagem_pregoeiro', d),
    scraping_inicio:    d => send('scraping_inicio', d),
    scraping_fim:       d => send('scraping_fim', d),
  };

  Object.entries(handlers).forEach(([e, h]) => bus.on(e, h));
  const hb = setInterval(() => send('heartbeat', { ts: Date.now() }), 30_000);

  req.on('close', () => {
    Object.entries(handlers).forEach(([e, h]) => bus.off(e, h));
    clearInterval(hb);
  });
});
```

- [ ] **Step 3: Testar SSE — conexão deve abrir e receber heartbeat**

```bash
node server.js &
```

```bash
curl -N "http://127.0.0.1:3099/events?key=SEU_UUID_AQUI"
```

Aguardar 30 segundos. Saída esperada (a cada 30s):

```
event: heartbeat
data: {"ts":1746624000000}
```

(`Ctrl+C` para cancelar o curl, depois `kill %1`)

- [ ] **Step 4: Testar que /events sem key retorna 401**

```bash
node server.js &
curl -s http://127.0.0.1:3099/events
```

Saída esperada: conexão fechada imediatamente com status 401.

```bash
kill %1
```

- [ ] **Step 5: Commit**

```bash
git add server.js
git commit -m "feat(sse): EventEmitter bus + endpoint GET /events com heartbeat"
```

---

## Task 4: agendador.js — receber bus no init() e emitir 4 eventos

**Files:**
- Modify: `agendador.js`
- Modify: `agendador.test.js`

- [ ] **Step 1: Escrever teste para init() com bus em agendador.test.js**

Abrir `agendador.test.js`. Adicionar ao final do arquivo:

```js
// ─── bus de eventos ──────────────────────────────────────────────────────────

test('init aceita parâmetro bus sem lançar erro', () => {
  const { init } = loadFresh();
  const EventEmitter = require('events');
  const mockBus = new EventEmitter();
  assert.doesNotThrow(() => init({
    telegram:        { enviar: () => {}, notificarMudancas: () => {}, notificarPregoeiro: () => {} },
    getPage:         () => null,
    getPageSessao:   () => null,
    comprasAlvoPath: './compras-alvo.json',
    bus:             mockBus,
  }));
});

test('init sem bus não lança erro (bus opcional)', () => {
  const { init } = loadFresh();
  assert.doesNotThrow(() => init({
    telegram:        { enviar: () => {}, notificarMudancas: () => {}, notificarPregoeiro: () => {} },
    getPage:         () => null,
    getPageSessao:   () => null,
    comprasAlvoPath: './compras-alvo.json',
  }));
});
```

- [ ] **Step 2: Rodar testes — devem falhar**

```bash
node --test agendador.test.js
```

Saída esperada: os 2 novos testes falham com erro indicando que `init` não aceita `bus`.

- [ ] **Step 3: Adicionar variável _bus ao agendador.js**

Localizar no `agendador.js` o bloco de variáveis internas (linha 29-32):

```js
// Referências injetadas via init()
let _telegram;
let _getPage;
let _getPageSessao;
let _comprasAlvoPath;
```

Substituir por:

```js
// Referências injetadas via init()
let _telegram;
let _getPage;
let _getPageSessao;
let _comprasAlvoPath;
let _bus = null;
```

- [ ] **Step 4: Modificar init() para aceitar e armazenar bus**

Localizar a função `init()` (linha 224):

```js
function init({ telegram, getPage, getPageSessao, comprasAlvoPath }) {
  _telegram        = telegram;
  _getPage         = getPage;
  _getPageSessao   = getPageSessao;
  _comprasAlvoPath = comprasAlvoPath;
```

Substituir por:

```js
function init({ telegram, getPage, getPageSessao, comprasAlvoPath, bus }) {
  _telegram        = telegram;
  _getPage         = getPage;
  _getPageSessao   = getPageSessao;
  _comprasAlvoPath = comprasAlvoPath;
  _bus             = bus || null;
```

- [ ] **Step 5: Rodar testes — devem passar**

```bash
node --test agendador.test.js
```

Saída esperada: todos os testes passando, incluindo os 2 novos.

- [ ] **Step 6: Emitir scraping_inicio em jobScrapingDiario**

Localizar em `agendador.js` o bloco onde `alvos` é carregado (linhas 98-103):

```js
  let alvos;
  try {
    alvos = carregarAlvos();
  } catch (err) {
    log(`[agendador] Erro ao ler compras-alvo.json: ${err.message}`);
    return;
  }
```

Substituir por:

```js
  let alvos;
  try {
    alvos = carregarAlvos();
  } catch (err) {
    log(`[agendador] Erro ao ler compras-alvo.json: ${err.message}`);
    return;
  }
  if (_bus) _bus.emit('scraping_inicio', { total: alvos.length });
```

- [ ] **Step 7: Emitir scraping_fim em jobScrapingDiario**

Localizar a última linha de `jobScrapingDiario` (linha 149):

```js
  log('[agendador] Scraping diário concluído.');
}
```

Substituir por:

```js
  if (_bus) _bus.emit('scraping_fim', { comprasProcessadas: alvos.length });
  log('[agendador] Scraping diário concluído.');
}
```

- [ ] **Step 8: Emitir mudanca_detectada em _compararENotificar**

Localizar em `agendador.js` a linha 176:

```js
  await _telegram.notificarMudancas(compraId, resumo, detalhes);
}
```

Substituir por:

```js
  await _telegram.notificarMudancas(compraId, resumo, detalhes);
  if (_bus) _bus.emit('mudanca_detectada', { compraId, ...resumo });
}
```

- [ ] **Step 9: Emitir mensagem_pregoeiro em jobMensagensPregoeiro**

Localizar em `agendador.js` as linhas 212-213:

```js
          const urgente = ehMensagemUrgente(msg.texto, CNPJS_RAFAEL);
          await _telegram.notificarPregoeiro(compraId, uasg, msg.item || '?', msg.texto, urgente);
```

Substituir por:

```js
          const urgente = ehMensagemUrgente(msg.texto, CNPJS_RAFAEL);
          await _telegram.notificarPregoeiro(compraId, uasg, msg.item || '?', msg.texto, urgente);
          if (_bus) _bus.emit('mensagem_pregoeiro', { compraId, uasg, item: msg.item || '?', texto: msg.texto, urgente });
```

- [ ] **Step 10: Rodar todos os testes**

```bash
node --test comprasgov.test.js telegram.test.js agendador.test.js
```

Saída esperada: todos os testes passando (sem falhas — o número exato depende dos testes já existentes no agendador.test.js).

- [ ] **Step 11: Commit**

```bash
git add agendador.js agendador.test.js
git commit -m "feat(agendador): emitir eventos SSE no bus para mudancas, mensagens e scraping"
```

---

## Task 5: Conectar bus no boot do server.js + verificação final

**Files:**
- Modify: `server.js` (bloco de boot, linha 648-653)

- [ ] **Step 1: Passar bus ao agendador.init() no boot**

Localizar no `server.js` o bloco `agendador.init({...})` (linhas 648-653):

```js
      agendador.init({
        telegram,
        getPage:        () => page,
        getPageSessao:  () => pageSessao,
        comprasAlvoPath: path.join(__dirname, 'compras-alvo.json'),
      });
```

Substituir por:

```js
      agendador.init({
        telegram,
        getPage:        () => page,
        getPageSessao:  () => pageSessao,
        comprasAlvoPath: path.join(__dirname, 'compras-alvo.json'),
        bus,
      });
```

- [ ] **Step 2: Rodar todos os testes**

```bash
node --test comprasgov.test.js telegram.test.js agendador.test.js
```

Saída esperada: todos os testes passando sem falhas.

- [ ] **Step 3: Teste de smoke — iniciar o servidor e verificar /status + /events**

```bash
node server.js &
```

Testar status com auth:

```bash
curl -s -H "X-API-Key: SEU_UUID_AQUI" http://127.0.0.1:3099/status
```

Saída esperada: `{"online":true,"browserPronto":true,...,"agendadorAtivo":true}`

Testar SSE em background (5 segundos):

```bash
timeout 5 curl -N "http://127.0.0.1:3099/events?key=SEU_UUID_AQUI" || true
```

Saída esperada: conexão abre e fecha sem erro (heartbeat só vem após 30s, mas a conexão deve ser estável).

```bash
kill %1
```

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "feat(server): conectar bus ao agendador no boot para eventos SSE"
```

---

## Task 6: nginx config + instruções de deploy na VPS

**Files:**
- Create: `nginx/compras.conf`

- [ ] **Step 1: Criar diretório nginx/**

```bash
mkdir nginx
```

- [ ] **Step 2: Criar nginx/compras.conf**

Criar o arquivo `nginx/compras.conf` com o conteúdo:

```nginx
server {
    listen 80;
    server_name compras.infra-cellaflux.online;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name compras.infra-cellaflux.online;

    ssl_certificate     /etc/letsencrypt/live/compras.infra-cellaflux.online/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/compras.infra-cellaflux.online/privkey.pem;

    location / {
        proxy_pass         http://127.0.0.1:3099;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;

        # SSE: desabilitar buffering para flush imediato
        proxy_buffering    off;
        proxy_cache        off;
        proxy_read_timeout 3600s;
    }
}
```

> **Nota:** Substituir `compras.infra-cellaflux.online` pelo subdomínio real que Rafael criar no DNS. O padrão sugerido é este mas pode ser qualquer subdomínio.

- [ ] **Step 3: Commit**

```bash
git add nginx/compras.conf
git commit -m "feat(nginx): config reverse proxy para comprasgov-browser com SSE"
```

- [ ] **Step 4: Deploy na VPS — configurar DNS**

No painel DNS do domínio `infra-cellaflux.online` (ou onde estiver registrado), criar:

```
Tipo: A
Nome: compras
Valor: <IP da VPS>
TTL: 300
```

Aguardar propagação (alguns minutos). Verificar:

```bash
nslookup compras.infra-cellaflux.online
```

- [ ] **Step 5: Deploy na VPS — instalar certbot e gerar certificado**

SSH na VPS:

```bash
ssh usuario@IP-DA-VPS
```

Instalar certbot (se não estiver instalado):

```bash
sudo apt update && sudo apt install -y certbot python3-certbot-nginx
```

Gerar certificado:

```bash
sudo certbot --nginx -d compras.infra-cellaflux.online
```

Seguir as instruções interativas (e-mail, aceitar termos). O certbot irá editar automaticamente a config nginx para o domínio.

- [ ] **Step 6: Deploy na VPS — configurar nginx**

Copiar o arquivo de config:

```bash
sudo cp nginx/compras.conf /etc/nginx/sites-available/compras
sudo ln -s /etc/nginx/sites-available/compras /etc/nginx/sites-enabled/compras
sudo nginx -t
sudo systemctl reload nginx
```

- [ ] **Step 7: Deploy na VPS — adicionar API_KEY ao .env da VPS**

```bash
# Gerar nova API_KEY na VPS (ou usar a mesma gerada localmente)
node -e "console.log(require('crypto').randomUUID())"

# Adicionar ao .env
echo "API_KEY=UUID_GERADO_AQUI" >> /caminho/para/comprasgov-browser/.env
```

- [ ] **Step 8: Reiniciar o server.js na VPS**

Se estiver usando systemd:

```bash
sudo systemctl restart comprasgov-browser
```

Se estiver usando pm2:

```bash
pm2 restart server
```

Se estiver rodando manualmente:

```bash
kill $(cat server_pid.txt)
nohup node server.js > server.log 2>&1 &
```

- [ ] **Step 9: Verificar HTTPS funcionando**

```bash
curl -s -H "X-API-Key: SEU_UUID_AQUI" https://compras.infra-cellaflux.online/status
```

Saída esperada:

```json
{"online":true,"browserPronto":true,"url":"...","sessaoAtiva":false,"agendadorAtivo":true}
```

- [ ] **Step 10: Configurar no Lovable**

No projeto Lovable do Rafael, definir as variáveis de ambiente:

```
VITE_API_URL=https://compras.infra-cellaflux.online
VITE_API_KEY=UUID_GERADO_AQUI
```

Código de exemplo para o componente React no Lovable que conecta ao SSE:

```js
const API_URL = import.meta.env.VITE_API_URL;
const API_KEY = import.meta.env.VITE_API_KEY;

// Conexão SSE (abre ao montar o componente)
const es = new EventSource(`${API_URL}/events?key=${API_KEY}`);

es.addEventListener('mudanca_detectada', (e) => {
  const data = JSON.parse(e.data);
  console.log('Mudança:', data.compraId, data.totalMudancas, 'mudanças');
});

es.addEventListener('mensagem_pregoeiro', (e) => {
  const data = JSON.parse(e.data);
  console.log(data.urgente ? '🚨 URGENTE' : '💬', data.compraId, data.texto);
});

es.addEventListener('heartbeat', () => { /* conexão viva */ });

// Chamar /status
fetch(`${API_URL}/status`, {
  headers: { 'X-API-Key': API_KEY }
}).then(r => r.json()).then(console.log);

// Responder mensagem do pregoeiro
fetch(`${API_URL}/mensagens/responder`, {
  method: 'POST',
  headers: { 'X-API-Key': API_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ compraId: '...', mensagem: 'Texto da resposta' }),
}).then(r => r.json()).then(console.log);
```

---

## Checklist de cobertura do spec

| Requisito | Task |
|-----------|------|
| API key middleware (header X-API-Key) | Task 1 |
| API key via ?key= para SSE (EventSource não suporta headers) | Task 3 |
| GET /api/compras-alvo | Task 2 |
| EventEmitter bus interno | Task 3 |
| GET /events com heartbeat a cada 30s | Task 3 |
| Desregistrar handlers quando cliente desconecta | Task 3 |
| bus.setMaxListeners(50) para múltiplos clientes | Task 3 |
| agendador emite scraping_inicio | Task 4 |
| agendador emite scraping_fim | Task 4 |
| agendador emite mudanca_detectada | Task 4 |
| agendador emite mensagem_pregoeiro | Task 4 |
| bus injetado no agendador.init() no boot | Task 5 |
| telegram.js não muda | — |
| server.js continua bind em 127.0.0.1 | — (não alterado) |
| nginx config com proxy_buffering off para SSE | Task 6 |
| SSL Let's Encrypt | Task 6 |
| DNS compras.infra-cellaflux.online | Task 6 |
| Configuração no Lovable (VITE_API_URL, VITE_API_KEY) | Task 6 |
