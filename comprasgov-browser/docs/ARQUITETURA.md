# ComprasGov Automation — Arquitetura e Operação

> **Para Rafael:** este documento explica o sistema completo de automação que monitora seus pregões no ComprasGov e te avisa pelo Telegram + alimenta um dashboard em tempo real.

---

## 1. O que o sistema faz

1. **Monitora as compras** que estão na sua lista de alvos (`compras-alvo.json`) automaticamente
2. **Faz scraping diário** às 7h da manhã, comparando com o dia anterior para detectar:
   - Itens adjudicados
   - Mudanças de posição entre fornecedores
   - Novos fornecedores
   - Fornecedores removidos
3. **Lê mensagens do pregoeiro** a cada 5 minutos (08h-18h, dias úteis)
4. **Notifica via Telegram** dois níveis de alerta:
   - Resumo de mudanças (com chave para ver detalhes sob demanda)
   - **🚨 ALERTA URGENTE** quando o pregoeiro cita o seu CNPJ — você tem 2 minutos para responder
5. **Expõe API HTTPS pública** para o frontend Lovable consumir os mesmos eventos em tempo real

---

## 2. Arquitetura

```
┌─────────────────────────────────────────────────────────────┐
│  Lovable (browser do Rafael)                                │
│  - Dashboard de compras                                     │
│  - Chat de mensagens do pregoeiro                           │
└────────────┬────────────────────────────────────────────────┘
             │ HTTPS + header X-API-Key
             ▼
┌─────────────────────────────────────────────────────────────┐
│  Cloudflare Edge — compras.infra-cellaflux.online           │
│  - SSL automático (Let's Encrypt via Cloudflare)            │
│  - DNS via CNAME para o Tunnel                              │
└────────────┬────────────────────────────────────────────────┘
             │ Tunnel QUIC (saindo da VPS)
             ▼
┌─────────────────────────────────────────────────────────────┐
│  VPS Hostinger (72.60.2.102) — ubuntu 24.04                 │
│                                                             │
│  ┌─ cloudflared (systemd) ──────────────────────────────┐   │
│  │  Faz tunnel para o Cloudflare                       │   │
│  └─────────────┬───────────────────────────────────────┘   │
│                │ http://127.0.0.1:3099                      │
│                ▼                                            │
│  ┌─ server.js (Node.js / Express) ──────────────────────┐   │
│  │  - Middleware API key                               │   │
│  │  - REST: /status, /api/compras-alvo, /mensagens/*   │   │
│  │  - SSE: /events                                     │   │
│  │  - EventEmitter interno (bus)                       │   │
│  └─────────────┬───────────────────────────────────────┘   │
│                │ ┌───────────────────────────────────┐     │
│                │ │ agendador.js (jobs cron)          │     │
│                │ │ - 07h: scraping diário            │     │
│                │ │ - */5min: polling de mensagens    │     │
│                │ └───────────────────────────────────┘     │
│                │ ┌───────────────────────────────────┐     │
│                │ │ telegram.js (long-polling)        │     │
│                │ │ - notifica mudanças               │     │
│                │ │ - alerta urgente (CNPJ)           │     │
│                │ └───────────────────────────────────┘     │
│                │ CDP                                        │
│                ▼                                            │
│  ┌─ Google Chrome (Xvfb) ───────────────────────────────┐   │
│  │  --remote-debugging-port=9222                       │   │
│  │  --user-data-dir=/opt/chrome-profile (sessão!)      │   │
│  └─────────────┬───────────────────────────────────────┘   │
│                │                                            │
│                │ HTTPS                                      │
└────────────────┼───────────────────────────────────────────┘
                 ▼
       ComprasGov / SERPRO
```

**Fora do diagrama, em paralelo:** x11vnc na porta 5900 permite acesso remoto à tela virtual do Xvfb (para Rafael fazer login manual e resolver CAPTCHA quando necessário).

---

## 3. Por que cada escolha

### 3.1 Chrome real + Xvfb (em vez de Chromium headless)

O ComprasGov (`cnetmobile.estaleiro.serpro.gov.br`) usa reCAPTCHA agressivo que bloqueia Chromium e qualquer browser flagged como bot. Foi confirmado em 3 rodadas de reconhecimento que:
- Chromium (mesmo com stealth) → bloqueado
- Chrome real headless → bloqueado
- Chrome real **com tela** + sessão persistente → passa

A solução é usar Chrome real numa "tela virtual" (Xvfb) com perfil de usuário persistente em `/opt/chrome-profile`. A sessão (cookies, login) fica salva e reutilizada entre restarts.

### 3.2 Conexão via CDP (porta 9222)

O `server.js` controla o Chrome via Chrome DevTools Protocol. Isso permite:
- Reaproveitar a sessão de login que Rafael fez manualmente
- Não precisar relogar a cada scraping
- Server.js e Chrome são processos separados — cada um pode reiniciar sem afetar o outro

### 3.3 Cloudflare Tunnel (em vez de nginx + certbot)

A VPS já tinha o stack completo do n8n (n8n, Supabase, Evolution API, Postgres, Redis...) atrás do Traefik, ocupando as portas 80 e 443. Três opções foram consideradas:

| Opção | Prós | Contras |
|-------|------|---------|
| Containerizar e adicionar ao Swarm | "Do jeito certo" do stack | Chrome dentro de container fica complexo |
| nginx + certbot direto | Simples em VPS limpa | Conflito de portas com Traefik |
| **Cloudflare Tunnel** (escolhido) | Sem conflito, SSL automático, suporta SSE | Depende do Cloudflare estar online |

O Tunnel é uma conexão **saindo da VPS** para a Cloudflare via QUIC — não precisa abrir porta nenhuma na VPS. Cloudflare provê SSL automático e roteia `compras.infra-cellaflux.online` direto para `localhost:3099`.

### 3.4 API key com `crypto.timingSafeEqual`

Como a URL fica pública na internet, todas as rotas exigem o header `X-API-Key`. A comparação usa `crypto.timingSafeEqual` para evitar ataques de timing (descobrir a chave caractere por caractere medindo tempos de resposta).

Para o endpoint SSE `/events`, a chave vai como query param (`?key=`) porque o `EventSource` do browser não suporta headers customizados.

### 3.5 EventEmitter `bus` + SSE

O Lovable precisa de atualizações em tempo real. Em vez de o frontend ficar "pingando" a API a cada X segundos (polling), o servidor empurra os eventos:
- `agendador.js` detecta uma mudança → emite no `bus`
- `bus` notifica todos os clientes SSE conectados
- Browser recebe via `EventSource` e atualiza a UI

Heartbeat a cada 30s mantém a conexão TCP viva mesmo sem eventos.

### 3.6 Multichat Telegram

Tanto o Leo quanto o Rafael recebem todas as notificações (`TELEGRAM_CHAT_ID=5864649682,8640295107`). Os dois CNPJs do Rafael (`1189761000150,53211921000160`) são monitorados em paralelo para detecção de mensagens urgentes.

---

## 4. Componentes em produção

### 4.1 VPS

- **Provedor:** Hostinger
- **IP:** `72.60.2.102`
- **Sistema:** Ubuntu 24.04 LTS
- **Acesso SSH:** via Termius

### 4.2 Domínio

- **Registrar/DNS:** Cloudflare
- **Domínio raiz:** `infra-cellaflux.online`
- **Subdomínio criado:** `compras.infra-cellaflux.online` → CNAME para Cloudflare Tunnel

### 4.3 Software instalado na VPS

| Componente | Versão | Função |
|------------|--------|--------|
| Node.js | 24.14.1 | runtime do `server.js` |
| Google Chrome | 148.0.7778.96 | browser real para scraping |
| Xvfb | (apt) | tela virtual |
| x11vnc | (apt) | servidor VNC |
| fluxbox | (apt) | window manager leve |
| cloudflared | 2026.3.0 | Cloudflare Tunnel |
| nginx | 1.24.0 | (instalado mas não usado — Traefik domina 80/443) |

### 4.4 Diretórios na VPS

```
/opt/comprasgov-browser/        ← repositório clonado do GitHub
└── comprasgov-browser/         ← projeto Node.js (server.js, agendador.js, etc.)
    ├── .env                    ← credenciais (NÃO COMMITAR)
    ├── compras-alvo.json       ← lista de compras monitoradas
    ├── dados/snapshots/        ← snapshots diários (input do agendador)
    ├── scripts/                ← scripts de operação
    └── nginx/compras.conf      ← config nginx (não usada na VPS)

/opt/chrome-profile/            ← perfil Chrome com sessão ComprasGov
/etc/cloudflared/config.yml     ← config do Cloudflare Tunnel
/root/.cloudflared/             ← credenciais do Tunnel
```

---

## 5. Como operar (manual de uso)

### 5.1 Subir tudo do zero (após reboot, por exemplo)

```bash
# 1. Tela virtual + VNC
bash /opt/comprasgov-browser/comprasgov-browser/scripts/start-vnc.sh

# 2. Chrome em debug mode (já com sessão salva)
bash /opt/comprasgov-browser/comprasgov-browser/scripts/start-chrome.sh

# 3. Server.js
cd /opt/comprasgov-browser/comprasgov-browser
node server.js
```

> ⚠️ Itens 1 e 2 não são serviços systemd ainda — vão precisar ser configurados como tal numa próxima rodada.

### 5.2 Conectar via VNC para resolver CAPTCHA

1. No PC, instalar [TightVNC Viewer](https://www.tightvnc.com/download.php) ou similar
2. Conectar em `72.60.2.102:5900`
3. Senha: `comprasgov2026` (ou a que foi configurada)
4. Vai aparecer a tela do Chrome — fazer login no ComprasGov, resolver CAPTCHA, deixar logado

### 5.3 Verificar se está tudo OK

```bash
# Status do server.js (na VPS)
curl -H "X-API-Key: a554b7f8-534c-4a26-84de-661e4ed80ece" http://127.0.0.1:3099/status

# Status do Cloudflare Tunnel
systemctl status cloudflared

# Logs do tunnel
journalctl -u cloudflared -n 30 --no-pager

# Acesso público (do PC)
curl -H "X-API-Key: a554b7f8-534c-4a26-84de-661e4ed80ece" https://compras.infra-cellaflux.online/status
```

Resposta esperada:
```json
{
  "online": true,
  "browserPronto": true,
  "url": "https://cnetmobile.estaleiro.serpro.gov.br/...",
  "sessaoAtiva": false,
  "agendadorAtivo": true
}
```

### 5.4 Parar tudo

```bash
bash /opt/comprasgov-browser/comprasgov-browser/scripts/stop-all.sh
# (mata Chrome, x11vnc, fluxbox, Xvfb)

# Server.js: Ctrl+C ou kill no PID
# cloudflared: systemctl stop cloudflared
```

---

## 6. Endpoints da API pública

**Base URL:** `https://compras.infra-cellaflux.online`
**Autenticação:** Header `X-API-Key: <api_key>` (ou `?key=` em `/events`)

### REST

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/status` | Saúde do servidor |
| `GET` | `/api/compras-alvo` | Lista das compras monitoradas |
| `POST` | `/mensagens/ler` | Lê mensagens do chat de um pregão |
| `POST` | `/mensagens/responder` | Envia resposta ao pregoeiro |

### SSE

| Endpoint | Eventos |
|----------|---------|
| `GET /events?key=<API_KEY>` | `mudanca_detectada`, `mensagem_pregoeiro`, `scraping_inicio`, `scraping_fim`, `heartbeat` |

---

## 7. Próximos passos

- [ ] Configurar `server.js` como serviço systemd (auto-restart)
- [ ] Configurar Chrome + Xvfb como serviço systemd
- [ ] Frontend Lovable consumindo a API (`docs/LOVABLE-PROMPT.md`)
- [ ] Backup automático do `/opt/chrome-profile` (perder sessão = relogar manualmente)
- [ ] Monitoramento de saúde (alerta no Telegram se algum componente cair)
