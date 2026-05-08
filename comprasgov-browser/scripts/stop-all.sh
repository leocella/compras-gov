#!/bin/bash
# Para todos os serviços: Chrome, x11vnc, fluxbox, Xvfb

echo "[stop] Parando Chrome..."
pkill -f "remote-debugging-port=9222" 2>/dev/null || true

echo "[stop] Parando x11vnc..."
pkill x11vnc 2>/dev/null || true

echo "[stop] Parando fluxbox..."
pkill fluxbox 2>/dev/null || true

echo "[stop] Parando Xvfb..."
pkill -f "Xvfb :99" 2>/dev/null || true

sleep 1
echo "[stop] Tudo parado."
