# Prompt para o Lovable

> **Como usar:** copie o bloco abaixo e cole no Lovable. Ele vai gerar um app React conectado à API de monitoramento de pregões.

---

## Prompt completo (copie a partir daqui)

Quero construir um dashboard de monitoramento de pregões eletrônicos do ComprasGov. O backend já existe e está hospedado em `https://compras.infra-cellaflux.online` com autenticação por API key.

### Requisitos da aplicação

**Tela 1 — Dashboard de compras**

Lista todas as compras que estão sendo monitoradas. Para cada compra, mostra:
- Identificador da compra (compraId)
- UASG e número do pregão
- Última mudança detectada (se houver)
- Total de mudanças do dia (com badge colorido)
- Botão "Abrir chat" que leva para a Tela 2

**Tela 2 — Chat de mensagens do pregoeiro**

Para uma compra específica, mostra:
- Histórico de mensagens trocadas no chat do pregão
- Caixa de input para enviar resposta ao pregoeiro
- Indicador visual quando chega mensagem nova (destaque vermelho se for **urgente** — quando o pregoeiro cita o CNPJ do usuário)

**Tela 3 — Notificações em tempo real**

Sino/badge no header que mostra contagem de eventos não lidos. Ao clicar, abre dropdown com as últimas notificações:
- 📊 Mudanças detectadas
- 💬 Mensagens do pregoeiro (normais)
- 🚨 Mensagens urgentes (destacadas em vermelho)
- ⏱️ Scraping diário iniciado/concluído

### Configuração

Variáveis de ambiente necessárias:
```
VITE_API_URL=https://compras.infra-cellaflux.online
VITE_API_KEY=<api_key_fornecida_separadamente>
```

A API key NÃO deve ser commitada no código. Use `.env.local` e adicione ao `.gitignore`.

### Endpoints da API

**Base URL:** `https://compras.infra-cellaflux.online`
**Auth:** Header `X-API-Key: <VITE_API_KEY>` em todas as chamadas REST. Para SSE, usa `?key=<VITE_API_KEY>` na URL.

#### REST

**GET `/status`**
Retorna o estado do servidor.
```json
{
  "online": true,
  "browserPronto": true,
  "url": "https://cnetmobile.estaleiro.serpro.gov.br/...",
  "sessaoAtiva": false,
  "agendadorAtivo": true
}
```

**GET `/api/compras-alvo`**
Lista as compras monitoradas.
```json
[
  {
    "compraId": "15838305900012026",
    "uasg": "158383",
    "numero": "00001/2026",
    "tipo": "pregao_eletronico",
    "totalItens": 25
  }
]
```

**POST `/mensagens/ler`**
Lê o histórico de mensagens do chat de um pregão.
```json
// Request body:
{ "compraId": "15838305900012026" }

// Response:
{
  "sucesso": true,
  "mensagens": [
    {
      "remetente": "Pregoeiro",
      "dataHora": "2026-05-08 14:30",
      "texto": "Empresa CNPJ XXX, por favor informe a marca",
      "item": "3"
    }
  ]
}
```

**POST `/mensagens/responder`**
Envia resposta ao pregoeiro.
```json
// Request body:
{ "compraId": "15838305900012026", "mensagem": "Marca: XYZ" }

// Response:
{ "sucesso": true }
```

#### SSE — `GET /events?key=<API_KEY>`

Conexão persistente que empurra eventos em tempo real. Use `EventSource` do browser.

**Eventos:**

| Evento | Quando dispara | Payload |
|--------|----------------|---------|
| `mudanca_detectada` | Agendador detectou mudança numa compra | `{ compraId, totalMudancas, adjudicadas, posicoes, novos, removidos }` |
| `mensagem_pregoeiro` | Polling encontrou mensagem nova | `{ compraId, uasg, item, texto, urgente }` |
| `scraping_inicio` | Job diário começou | `{ total }` |
| `scraping_fim` | Job diário terminou | `{ comprasProcessadas }` |
| `heartbeat` | A cada 30s (manter conexão viva) | `{ ts }` |

### Código de referência para conectar

```js
const API_URL = import.meta.env.VITE_API_URL;
const API_KEY = import.meta.env.VITE_API_KEY;

// Helper para chamadas REST com auth
async function apiCall(path, options = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'X-API-Key': API_KEY,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

// Conexão SSE para eventos em tempo real
function connectEvents(onEvent) {
  const es = new EventSource(`${API_URL}/events?key=${API_KEY}`);

  es.addEventListener('mudanca_detectada', (e) => {
    onEvent('mudanca_detectada', JSON.parse(e.data));
  });

  es.addEventListener('mensagem_pregoeiro', (e) => {
    onEvent('mensagem_pregoeiro', JSON.parse(e.data));
  });

  es.addEventListener('scraping_inicio', (e) => {
    onEvent('scraping_inicio', JSON.parse(e.data));
  });

  es.addEventListener('scraping_fim', (e) => {
    onEvent('scraping_fim', JSON.parse(e.data));
  });

  es.addEventListener('heartbeat', () => {
    // ignore — só mantém conexão viva
  });

  es.onerror = (err) => {
    console.error('SSE error:', err);
    // EventSource reconecta sozinho
  };

  return es;
}

// Exemplos de uso
const compras = await apiCall('/api/compras-alvo');
const status = await apiCall('/status');
const mensagens = await apiCall('/mensagens/ler', {
  method: 'POST',
  body: JSON.stringify({ compraId: '15838305900012026' }),
});
```

### Stack técnica sugerida

- **React** (Vite)
- **TanStack Query** (React Query) para chamadas REST com cache
- **Tailwind CSS** + **shadcn/ui** para componentes
- **react-router-dom** para navegação entre Tela 1 e Tela 2
- **lucide-react** para ícones (sino, badges, etc.)

### Estado global

Use Context API ou Zustand para guardar:
- Lista de compras carregada
- Eventos recebidos via SSE (últimos 50)
- Notificações não lidas (contagem)
- Conexão SSE ativa (status)

### Detalhes de UX

- **Tema escuro** por padrão (Rafael trabalha em horário comercial, mas o dashboard pode ficar aberto direto)
- **Notificação sonora** opcional para mensagens urgentes (toggle no header)
- **Persistir notificações no localStorage** (não perder ao recarregar)
- **Indicador de conexão SSE** no rodapé (verde = conectado, amarelo = reconectando, vermelho = offline)
- **Refresh manual** com botão no header que rebusca `/api/compras-alvo`

### Comportamentos importantes

1. **Eventos urgentes** (`mensagem_pregoeiro` com `urgente: true`) devem aparecer em modal cheio, não só no dropdown — Rafael tem 2 minutos para responder
2. **Reconexão SSE** automática se cair (`EventSource` já faz isso, só logar)
3. **Erros de API** mostrar toast com mensagem de erro, não tela em branco
4. **Loading states** em todas as chamadas (skeletons em listas, spinners em ações)

Construa essa aplicação completa. Comece pela Tela 1 (Dashboard) com a lista de compras e a conexão SSE estabelecida. Depois evolua para as outras telas.

---

## Como passar a API key para o Rafael

⚠️ **Não cole a API key no prompt acima** — o Lovable pode commitar em repo público.

Quando o app estiver pronto:
1. No painel do Lovable, vai em **Settings → Environment Variables**
2. Adiciona:
   - `VITE_API_URL` = `https://compras.infra-cellaflux.online`
   - `VITE_API_KEY` = (a chave gerada na VPS — pergunte para mim ou veja em `.env` da VPS)
3. Faz redeploy

Se Rafael precisar regenerar a API key:
```bash
# Na VPS:
node -e "console.log(require('crypto').randomUUID())"
# Atualiza o valor de API_KEY em /opt/comprasgov-browser/comprasgov-browser/.env
# Reinicia o server.js
```

E atualiza no Lovable também.
