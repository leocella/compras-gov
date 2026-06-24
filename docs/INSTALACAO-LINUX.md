# Instalação da Solução ComprasGov em Linux — Guia Passo a Passo

> **Para quem é este guia:** Rafael ou qualquer pessoa instalando o sistema de
> automação do ComprasGov numa máquina Linux do zero.
>
> **O que o sistema faz:** Conecta no Chrome do Rafael (já logado no ComprasGov),
> raspa propostas de pregões, lê mensagens do pregoeiro e envia tudo pelo Telegram.

---

## Pré-requisitos

- Linux Ubuntu 20.04+ ou Debian 11+ (64 bits)
- Acesso ao terminal com sudo
- Conexão à internet
- O bot do Telegram já criado (token em mãos)
- Seu CNPJ e Chat ID do Telegram

---

## Parte 1 — Instalar dependências do sistema

### 1.1 Atualizar pacotes

```bash
sudo apt update && sudo apt upgrade -y
```

### 1.2 Instalar Node.js 20

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

Confirmar versão (precisa ser 20 ou maior):

```bash
node --version
# Deve mostrar: v20.x.x ou superior
```

### 1.3 Instalar Google Chrome

> **Importante:** use o Google Chrome real, não o Chromium. O ComprasGov bloqueia
> o Chromium com CAPTCHA.

```bash
# Baixar o instalador .deb
wget -O /tmp/chrome.deb "https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb"

# Instalar
sudo apt install -y /tmp/chrome.deb

# Confirmar
google-chrome --version
# Deve mostrar: Google Chrome 12x.x.x.x
```

### 1.4 Instalar git

```bash
sudo apt install -y git
```

---

## Parte 2 — Obter o código do projeto

### Opção A — Clonar via GitHub (se o repositório for privado, precisará de acesso)

```bash
cd /opt
sudo git clone https://github.com/SEU_USUARIO/RAFAEL_PRIMO.git comprasgov-projeto
sudo chown -R $USER:$USER /opt/comprasgov-projeto
```

### Opção B — Copiar os arquivos manualmente (via scp/rsync)

Se alguém enviou os arquivos por outro meio, coloque a pasta `comprasgov-browser/`
dentro de `/opt/comprasgov-browser/`. A estrutura final deve ficar:

```
/opt/comprasgov-browser/
├── server.js
├── comprasgov.js
├── raspar-propostas-cdp.js
├── lote-runner.js
├── lote-estado.js
├── agendador.js
├── telegram.js
├── package.json
├── compras-alvo.json
├── iniciar-chrome.sh
├── iniciar-servidor.sh
├── raspar-lote.sh
└── dados/   (criado automaticamente)
```

Para copiar de outra máquina via SCP (rodar no computador de origem):

```bash
scp -r /caminho/para/comprasgov-browser rafael@IP_DA_MAQUINA:/opt/comprasgov-browser
```

---

## Parte 3 — Instalar dependências Node.js

```bash
cd /opt/comprasgov-browser
npm install
```

Aguardar finalizar (pode demorar 1-2 minutos). Vai criar a pasta `node_modules/`.

---

## Parte 4 — Configurar variáveis de ambiente (.env)

Criar o arquivo `.env` a partir do exemplo:

```bash
cd /opt/comprasgov-browser
cp .env.example .env
nano .env
```

Preencher cada variável:

```env
# Token do bot Telegram (pegar com o @BotFather)
TELEGRAM_TOKEN=123456789:ABC-DEFxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Chat ID do Telegram (seu ID pessoal — use @userinfobot para descobrir)
# Para múltiplos recebedores separe por vírgula: 111111111,222222222
TELEGRAM_CHAT_ID=987654321

# Horário do scraping diário automático (número da hora, 0-23)
HORA_SCRAPING=7

# Seu CNPJ (usado para detectar mensagens urgentes do pregoeiro)
# Para múltiplos CNPJs separe por vírgula: 12345678000190,98765432000100
CNPJ_RAFAEL=12345678000190

# Chave de autenticação da API REST (gerar uma aleatória)
API_KEY=cole-aqui-uma-chave-secreta
```

Para gerar uma API_KEY aleatória:

```bash
node -e "const crypto = require('crypto'); console.log(crypto.randomUUID())"
```

Salvar e sair: `Ctrl+O`, `Enter`, `Ctrl+X`.

---

## Parte 5 — Configurar as compras a monitorar

Editar o arquivo `compras-alvo.json`:

```bash
nano /opt/comprasgov-browser/compras-alvo.json
```

Cada entrada tem esse formato:

```json
[
  {
    "uasg": "158383",
    "tipo": "Pregão",
    "numero": "900012026",
    "compraId": "15838305900012026",
    "totalItens": "auto"
  }
]
```

**Como montar o `compraId`:** 6 dígitos da UASG + 2 dígitos da modalidade + 9 dígitos
do número. Modalidades: `05` = Pregão, `06` = Dispensa.

Exemplo: UASG `158383`, Pregão número `900012026` → `15838305900012026`

---

## Parte 6 — Tornar os scripts executáveis

```bash
cd /opt/comprasgov-browser
chmod +x iniciar-chrome.sh iniciar-servidor.sh raspar-lote.sh
```

---

## Parte 7 — Abrir o Chrome e fazer login

> Esta etapa é **obrigatória e manual**. O sistema nunca faz login sozinho
> (gov.br tem certificado digital e CAPTCHA).

### Se a máquina tem tela (modo desktop normal):

```bash
cd /opt/comprasgov-browser
./iniciar-chrome.sh
```

Uma janela do Chrome vai abrir. **Faça login manualmente no ComprasGov:**

1. Acesse: `https://www.comprasnet.gov.br/comprasnet-web/seguro/fornecedor/inicio`
2. Clique em **Entrar com gov.br**
3. Faça o login com seu CPF e senha (ou certificado digital)
4. Confirme que chegou na área logada (aparece seu nome/empresa)
5. Deixe o Chrome **aberto** (não feche)

### Se a máquina NÃO tem tela (servidor/VPS headless):

É necessário criar uma tela virtual:

```bash
# Instalar Xvfb e x11vnc (tela virtual + VNC)
sudo apt install -y xvfb x11vnc fluxbox

# Iniciar tela virtual na porta :1
Xvfb :1 -screen 0 1280x800x24 &
export DISPLAY=:1

# Iniciar window manager leve
DISPLAY=:1 fluxbox &

# Iniciar VNC para visualizar a tela remotamente (sem senha, apenas local)
x11vnc -display :1 -nopw -listen localhost -xkb &

# Agora abrir o Chrome na tela virtual
DISPLAY=:1 google-chrome --remote-debugging-port=9222 \
  --user-data-dir=/opt/comprasgov-browser/chrome-debug-profile \
  --no-first-run --no-default-browser-check &
```

**Para visualizar a tela remotamente e fazer login:**

No seu computador (Windows/Mac), abra um túnel SSH:

```bash
ssh -L 5900:localhost:5900 rafael@IP_DA_MAQUINA
```

Depois abra um **cliente VNC** (ex: TightVNC Viewer, RealVNC, ou VNC Viewer) e
conecte em `localhost:5900`. Vai aparecer a janela do Chrome — faça o login.

---

## Parte 8 — Verificar que o CDP está ativo

Após o Chrome abrir (e ANTES de subir o servidor), confirmar:

```bash
curl http://127.0.0.1:9222/json/version
```

Resposta esperada (algo assim):

```json
{
  "Browser": "Chrome/124.0.6367.155",
  "webSocketDebuggerUrl": "ws://127.0.0.1:9222/devtools/browser/...",
  ...
}
```

Se não responder, o Chrome não está com a porta CDP aberta — rode `./iniciar-chrome.sh`
novamente.

---

## Parte 9 — Subir o servidor

```bash
cd /opt/comprasgov-browser
./iniciar-servidor.sh
```

Deve aparecer no terminal:

```
Subindo servidor (node server.js)...
[server] Servidor rodando em http://127.0.0.1:3099
[server] Telegram bot iniciado
[server] Agendador iniciado
[browser] Conectado ao Chrome via CDP
```

Testar que o servidor está OK em outro terminal:

```bash
curl http://127.0.0.1:3099/status
```

Resposta esperada:

```json
{
  "online": true,
  "browserPronto": true
}
```

---

## Parte 10 — Testar pelos comandos do Telegram

Com o servidor rodando, envie comandos para o bot no Telegram:

### Ver status

Envie `/status` — o bot deve responder com o estado atual do sistema.

### Raspar itens avulsos

```
/raspar 15838305900012026 1,2,3
```

Substitua pelo `compraId` e os números dos itens que quer raspar.
O bot vai confirmar, raspar e enviar o Excel por Telegram em alguns minutos.

### Rodar o lote completo (todas as compras do compras-alvo.json)

```
/retomar
```

Ou via terminal:

```bash
cd /opt/comprasgov-browser
./raspar-lote.sh
```

### Responder ao pregoeiro

```
/responder 15838305900012026 1 Prezado pregoeiro, conforme solicitado...
```

O sistema vai preencher a mensagem, tirar um screenshot, enviar para você confirmar
no Telegram antes de enviar de verdade.

---

## Referência rápida — comandos do dia a dia

| O que fazer | Comando |
|-------------|---------|
| Subir Chrome | `./iniciar-chrome.sh` |
| Subir servidor+bot | `./iniciar-servidor.sh` |
| Checar CDP ativo | `curl http://127.0.0.1:9222/json/version` |
| Checar servidor | `curl http://127.0.0.1:3099/status` |
| Lote completo | `./raspar-lote.sh` |
| Retomar lote pausado | `./raspar-lote.sh --retomar` |
| Só algumas compras | `./raspar-lote.sh --apenas ID1,ID2` |
| Ver logs em tempo real | `./iniciar-servidor.sh` (logs saem no terminal) |

---

## Problemas comuns

### "CDP ainda não respondeu"

O Chrome demorou pra abrir. Aguarde 10 segundos e cheque:

```bash
curl http://127.0.0.1:9222/json/version
```

Se não funcionar, rode `./iniciar-chrome.sh` de novo.

### "Sessão expirada" / "precisa relogar"

O ComprasGov deslogou (acontece depois de horas ou dias parado). Solução:

1. Abra a janela do Chrome (ou conecte via VNC)
2. Faça login manual novamente
3. Envie `/retomar` no Telegram se tinha um lote pausado

### O servidor para sozinho

Se você fechou o terminal, o servidor parou. Para manter rodando sem precisar deixar
o terminal aberto:

```bash
# Instalar o pm2 (gerenciador de processos)
sudo npm install -g pm2

# Subir com pm2
cd /opt/comprasgov-browser
pm2 start server.js --name comprasgov
pm2 save
pm2 startup   # gera o comando pra auto-iniciar no boot — copie e rode
```

Depois ver logs:

```bash
pm2 logs comprasgov
pm2 status
```

### "Erro de permissão" nos scripts .sh

```bash
chmod +x /opt/comprasgov-browser/*.sh
```

---

## Estrutura de arquivos gerados

Após a primeira raspagem, os arquivos ficam em:

```
/opt/comprasgov-browser/dados/
├── Resultados_CN_<compraId>_RASPAGEM.xlsx     ← Excel do lote completo
├── Resultados_CN_<compraId>_ITENS_x-y_*.xlsx ← Excel de raspagem avulsa (/raspar)
├── lote-estado.json                           ← progresso do lote (retomada)
└── snapshots/                                 ← histórico para detectar mudanças
```

---

*Documento gerado em 2026-06-24. Versão do projeto: 0.1.0*
