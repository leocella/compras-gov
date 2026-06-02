#!/usr/bin/env bash
#
# raspar-lote.sh — roda o lote manualmente (lê compras-alvo.json).
# Pré-requisito: Chrome logado via ./iniciar-chrome.sh.
#
# Exemplos:
#   ./raspar-lote.sh                       # lote completo (compras-alvo.json)
#   ./raspar-lote.sh --retomar             # retoma o lote pausado (pendentes)
#   ./raspar-lote.sh --apenas 158383...,160046...   # só essas compras
#
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${DIR}"

if ! curl -s http://127.0.0.1:9222/json/version >/dev/null 2>&1; then
  echo "⚠️  Chrome com CDP (9222) não está no ar. Rode ./iniciar-chrome.sh e faça login primeiro."
fi

exec node raspar-lote.js "$@"
