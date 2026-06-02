#!/usr/bin/env bash
#
# iniciar-chrome.sh — abre o Chrome com CDP (porta 9222) e perfil de debug
# persistente. Equivalente Linux do raspar-diario.bat (parte do Chrome).
#
# Uso:
#   ./iniciar-chrome.sh
#   Depois faça LOGIN MANUAL no ComprasGov (gov.br) na janela que abrir.
#   O perfil fica salvo em ./chrome-debug-profile (login persiste entre execuções).
#
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PERFIL="${DIR}/chrome-debug-profile"

# Acha o binário do Chrome/Chromium instalado.
CHROME="$(command -v google-chrome || command -v google-chrome-stable \
  || command -v chromium || command -v chromium-browser || true)"
if [ -z "${CHROME}" ]; then
  echo "❌ Chrome/Chromium não encontrado. Instale o google-chrome-stable."
  echo "   Ex (Debian/Ubuntu): baixe o .deb em https://www.google.com/chrome/ e:"
  echo "   sudo apt install ./google-chrome-stable_current_amd64.deb"
  exit 1
fi

echo "Fechando instâncias antigas com CDP na 9222 (se houver)..."
pkill -f "remote-debugging-port=9222" 2>/dev/null || true
sleep 2

echo "Abrindo ${CHROME} com CDP :9222 (perfil: ${PERFIL})..."
"${CHROME}" --remote-debugging-port=9222 --user-data-dir="${PERFIL}" >/dev/null 2>&1 &
sleep 3

if curl -s http://127.0.0.1:9222/json/version >/dev/null 2>&1; then
  echo "✅ CDP ativo em http://127.0.0.1:9222"
else
  echo "⚠️  CDP ainda não respondeu — aguarde alguns segundos e cheque http://127.0.0.1:9222/json/version"
fi

echo ""
echo "👉 Agora FAÇA LOGIN no ComprasGov nessa janela do Chrome (rota /seguro/fornecedor/)."
echo "   Depois rode: ./iniciar-servidor.sh   (bot+agendador)   ou   ./raspar-lote.sh"
