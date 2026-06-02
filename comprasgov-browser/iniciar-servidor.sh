#!/usr/bin/env bash
#
# iniciar-servidor.sh — sobe o servidor (API :3099 + bot Telegram + agendador).
# Pré-requisito: Chrome logado via ./iniciar-chrome.sh e .env preenchido.
#
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${DIR}"

if [ ! -f .env ]; then
  echo "❌ .env não encontrado em ${DIR}. Copie/preencha antes de subir o servidor."
  exit 1
fi

if ! curl -s http://127.0.0.1:9222/json/version >/dev/null 2>&1; then
  echo "⚠️  Chrome com CDP (9222) não está no ar. Rode ./iniciar-chrome.sh e faça login primeiro."
fi

echo "Subindo servidor (node server.js)..."
exec node server.js
