# Scripts de deploy na VPS

Scripts para configurar e operar o `comprasgov-browser` numa VPS Linux.

## Pré-requisitos

VPS Ubuntu 22.04+ com:
- Google Chrome instalado
- Xvfb, x11vnc, fluxbox, xterm
- Node.js 20+

## Ordem de execução

```bash
# 1. Iniciar tela virtual + VNC server
bash scripts/start-vnc.sh

# 2. Iniciar Chrome em debug mode
bash scripts/start-chrome.sh

# 3. (do seu PC) Conectar via SSH tunnel
ssh -L 5900:localhost:5900 root@VPS_IP

# 4. (do seu PC) Abrir VNC viewer em localhost:5900
# Você verá o Chrome - faça login no ComprasGov, resolva CAPTCHA, deixe logado

# 5. Iniciar o server.js
cd /opt/comprasgov-browser/comprasgov-browser
node server.js
```

## Parar tudo

```bash
bash scripts/stop-all.sh
```

## Definir senha do VNC

Antes da primeira execução, defina a senha:

```bash
export VNC_PASS=minhaSenhaSegura
bash scripts/start-vnc.sh
```

A senha é salva em `~/.vnc_pass` e reutilizada nas próximas execuções.
