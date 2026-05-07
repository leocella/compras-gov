# Integração Lovable — Design Spec

**Data:** 2026-05-07  
**Status:** aprovado  
**Objetivo:** Expor o `server.js` publicamente na VPS via nginx + HTTPS para que o frontend Lovable do Rafael consiga receber atualizações em tempo real (SSE) e enviar ações (REST).

---

## Contexto

O `server.js` roda na porta 3099 vinculado a `127.0.0.1` (localhost). O Lovable é um app React hospedado na nuvem — ele precisa de um endpoint HTTPS público para se conectar. O n8n já está na mesma VPS (`n8n.infra-cellaflux.online`), então o `server.js` será deployado nela também, com Chrome rodando via Xvfb. O subdomínio sugerido para o servidor é `compras.infra-cellaflux.online` — pode ser qualquer subdomínio que Rafael queira criar no DNS.

---

## Arquitetura

```
Lovable (browser)
  │
  ├── GET  https://compras.infra-cellaflux.online/events?key=XXX  ← SSE permanente
  ├── GET  /status, /api/compras-alvo                              ← leitura
  └── POST /mensagens/ler, /mensagens/responder                    ← ações
         │
      [nginx + Let's Encrypt — compras.infra-cellaflux.online]
         │
      server.js :3099 (localhost)
         ├── middleware API key (header X-API-Key)
         ├── GET /events — SSE via EventEmitter interno
         ├── agendador.js → emite eventos no bus
         └── telegram.js → emite eventos no bus
```

O n8n continua responsável pelos jobs agendados. O Lovable conversa diretamente com o `server.js` via nginx — sem passar pelo n8n.

---

## Autenticação

- **REST:** header `X-API-Key: <API_KEY>` em todas as requisições
- **SSE (`/events`):** query param `?key=<API_KEY>` — necessário porque o `EventSource` nativo do browser não suporta headers customizados
- `API_KEY` fica no `.env` da VPS; nunca vai pro git
- Middleware bloqueia com `401` qualquer requisição sem key válida (exceto `/events`, que tem sua própria validação inline)

---

## EventEmitter interno (bus)

`server.js` cria um `EventEmitter` chamado `bus` e o injeta via `init()` no `agendador.js` e no `telegram.js`. Assim esses módulos emitem eventos sem acoplamento direto ao Express.

```js
const EventEmitter = require('events');
const bus = new EventEmitter();
```

---

## Endpoint SSE — `GET /events`

Mantém uma conexão HTTP persistente. O Lovable abre uma única conexão ao carregar e recebe todos os eventos enquanto estiver aberto.

```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

Formato de cada evento:
```
event: <nome_do_evento>
data: <JSON>

```

Quando o cliente desconecta, todos os listeners são removidos do bus e o heartbeat é cancelado.

---

## Eventos SSE

| Evento | Quem emite | Payload |
|--------|-----------|---------|
| `mudanca_detectada` | `agendador.js` após diff de snapshots | `{ compraId, totalMudancas, adjudicadas, posicoes, novos, removidos }` |
| `mensagem_pregoeiro` | `agendador.js` após polling do chat | `{ compraId, uasg, item, texto, urgente }` |
| `scraping_inicio` | `agendador.js` ao iniciar job diário | `{ total }` |
| `scraping_fim` | `agendador.js` ao terminar job diário | `{ comprasProcessadas, erros }` |
| `heartbeat` | `server.js` a cada 30s | `{ ts }` |

---

## Endpoints REST

Todos exigem header `X-API-Key`.

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/status` | Saúde do servidor: `online`, `browserPronto`, `sessaoAtiva`, `agendadorAtivo` |
| `GET` | `/api/compras-alvo` | Retorna o conteúdo de `compras-alvo.json` |
| `POST` | `/mensagens/ler` | Lê mensagens do chat de um pregão (já implementado) |
| `POST` | `/mensagens/responder` | Envia resposta ao pregoeiro (já implementado) |

`/api/compras-alvo` é o único endpoint novo — os demais já existem.

---

## Middleware de autenticação

Inserido antes de qualquer rota no `server.js`:

```js
app.use((req, res, next) => {
  if (req.path === '/events') return next(); // /events faz auth própria
  if (req.headers['x-api-key'] !== process.env.API_KEY)
    return res.status(401).json({ erro: 'Não autorizado' });
  next();
});
```

---

## nginx — `nginx/compras.conf`

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

---

## Variáveis de ambiente (adições ao `.env`)

```env
API_KEY=<uuid-longo-gerado-aleatoriamente>
```

Gerar com: `node -e "console.log(require('crypto').randomUUID())"`

---

## Mapa de arquivos

| Arquivo | Ação | O que muda |
|---------|------|-----------|
| `server.js` | Modificar | Criar `bus` (EventEmitter), middleware auth, endpoint `GET /events`, endpoint `GET /api/compras-alvo`, passar `bus` ao init do agendador e telegram |
| `agendador.js` | Modificar | Receber `bus` no `init()`, emitir `mudanca_detectada`, `mensagem_pregoeiro`, `scraping_inicio`, `scraping_fim` |
| `telegram.js` | Não muda | Não recebe `bus` — só lida com mensagens *do Rafael* (respostas com chaves). Eventos SSE de mensagens do pregoeiro são emitidos pelo `agendador.js` |
| `.env` | Modificar | Adicionar `API_KEY` |
| `.env.example` | Modificar | Adicionar `API_KEY=` |
| `nginx/compras.conf` | Criar | Config nginx com SSL e proxy para :3099 |

---

## Configuração no Lovable

No app Lovable, Rafael configura:
- `VITE_API_URL=https://compras.infra-cellaflux.online`
- `VITE_API_KEY=<mesma API_KEY do .env>`

Conexão SSE no Lovable:
```js
const es = new EventSource(
  `${import.meta.env.VITE_API_URL}/events?key=${import.meta.env.VITE_API_KEY}`
);
es.addEventListener('mudanca_detectada', e => { ... });
es.addEventListener('mensagem_pregoeiro', e => { ... });
```

---

## Deploy na VPS (sequência)

1. Configurar DNS: `compras.infra-cellaflux.online` → IP da VPS
2. Instalar certbot e gerar certificado Let's Encrypt
3. Copiar `nginx/compras.conf` para `/etc/nginx/sites-available/` e habilitar
4. Adicionar `API_KEY` ao `.env` na VPS
5. Reiniciar server.js (systemd ou pm2)
6. Testar: `curl -H "X-API-Key: XXX" https://compras.infra-cellaflux.online/status`

---

## O que NÃO muda

- Lógica de scraping CDP (`raspar-propostas-cdp.js`)
- Jobs cron do `agendador.js`
- Notificações Telegram (`telegram.js`)
- Todos os outros endpoints existentes
- Binding `127.0.0.1:3099` do Express (nginx é a única entrada pública)
