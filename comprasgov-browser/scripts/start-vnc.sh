#!/bin/bash
# Inicia Xvfb (tela virtual) + fluxbox (window manager) + x11vnc (servidor VNC)
# Uso: bash start-vnc.sh
# Depois conecta do PC: ssh -L 5900:localhost:5900 root@VPS_IP
# E abre VNC viewer em localhost:5900 (senha definida em ~/.vnc_pass)

set -e

# Mata processos anteriores se existirem
pkill -f "Xvfb :99" 2>/dev/null || true
pkill fluxbox 2>/dev/null || true
pkill x11vnc 2>/dev/null || true
sleep 1

# Cria senha do VNC se não existir
if [ ! -f ~/.vnc_pass ]; then
    echo "[setup] Criando senha do VNC..."
    x11vnc -storepasswd "${VNC_PASS:-comprasgov2026}" ~/.vnc_pass
fi

# Inicia Xvfb na display :99
echo "[1/3] Iniciando Xvfb na display :99..."
Xvfb :99 -screen 0 1280x800x24 > /var/log/xvfb.log 2>&1 &
sleep 2

export DISPLAY=:99

# Inicia fluxbox
echo "[2/3] Iniciando fluxbox..."
fluxbox > /var/log/fluxbox.log 2>&1 &
sleep 1

# Inicia x11vnc
echo "[3/3] Iniciando x11vnc na porta 5900..."
x11vnc -display :99 -rfbauth ~/.vnc_pass -forever -shared -bg -o /var/log/x11vnc.log

echo ""
echo "VNC pronto na porta 5900."
echo ""
echo "Para conectar do seu PC:"
echo "  1. Abra um terminal local e rode: ssh -L 5900:localhost:5900 root@$(hostname -I | awk '{print $1}')"
echo "  2. Abra um VNC viewer (TightVNC, RealVNC) em: localhost:5900"
echo "  3. Senha: a que você definiu (default: comprasgov2026)"
