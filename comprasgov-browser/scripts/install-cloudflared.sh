#!/bin/bash
# Instala cloudflared (Cloudflare Tunnel) na VPS

set -e

cd /tmp

URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb"

echo "[1/3] Baixando cloudflared..."
wget -O cloudflared.deb "$URL"

echo "[2/3] Instalando cloudflared..."
dpkg -i cloudflared.deb

echo "[3/3] Verificando instalação..."
cloudflared --version
