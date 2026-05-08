#!/bin/bash
# Inicia Google Chrome em modo debug (CDP) na porta 9222
# Pre-requisito: Xvfb + fluxbox rodando (start-vnc.sh)
# Uso: bash start-chrome.sh

set -e

# Mata Chrome anterior se houver
pkill -f "remote-debugging-port=9222" 2>/dev/null || true
sleep 1

# Cria diretório do profile se não existir
mkdir -p /opt/chrome-profile

export DISPLAY=:99

echo "[chrome] Iniciando Chrome em debug mode na porta 9222..."
nohup google-chrome \
    --remote-debugging-port=9222 \
    --user-data-dir=/opt/chrome-profile \
    --no-sandbox \
    --no-first-run \
    --disable-gpu \
    > /var/log/chrome.log 2>&1 &

sleep 3

# Verifica se subiu
if curl -s http://127.0.0.1:9222/json/version > /dev/null; then
    echo "[chrome] OK - CDP respondendo em http://127.0.0.1:9222"
    curl -s http://127.0.0.1:9222/json/version | head -5
else
    echo "[chrome] ERRO - CDP não respondeu. Veja /var/log/chrome.log"
    tail -20 /var/log/chrome.log
    exit 1
fi
