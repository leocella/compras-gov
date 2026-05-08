#!/bin/bash
# Configura Cloudflare Tunnel para expor server.js (localhost:3099) em
# https://compras.infra-cellaflux.online via HTTPS automático.
#
# Pré-requisitos:
#   - cloudflared instalado e autenticado (cloudflared tunnel login)
#   - tunnel "comprasgov" criado (cloudflared tunnel create comprasgov)

set -e

TUNNEL_NAME="comprasgov"
TUNNEL_UUID="5cc8abce-2598-4358-abdf-a96e4ae9d5e4"
HOSTNAME="compras.infra-cellaflux.online"
LOCAL_PORT="3099"

mkdir -p /root/.cloudflared

echo "[1/3] Criando /root/.cloudflared/config.yml..."
cat > /root/.cloudflared/config.yml <<EOF
tunnel: ${TUNNEL_UUID}
credentials-file: /root/.cloudflared/${TUNNEL_UUID}.json

ingress:
  - hostname: ${HOSTNAME}
    service: http://localhost:${LOCAL_PORT}
  - service: http_status:404
EOF

echo "[2/3] Configurando DNS (cria CNAME ${HOSTNAME} -> ${TUNNEL_UUID}.cfargotunnel.com)..."
cloudflared tunnel route dns ${TUNNEL_NAME} ${HOSTNAME}

echo "[3/3] Configuração pronta!"
echo ""
echo "Para rodar o tunnel manualmente (teste rápido):"
echo "  cloudflared tunnel run ${TUNNEL_NAME}"
echo ""
echo "Para instalar como serviço systemd (rodar permanente):"
echo "  cloudflared service install"
echo "  systemctl start cloudflared"
echo "  systemctl enable cloudflared"
