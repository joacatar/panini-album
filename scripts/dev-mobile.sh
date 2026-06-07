#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

LAN_IP="${LAN_IP:-$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)}"
if [ -z "$LAN_IP" ]; then
  echo "No LAN IP found. Connect to Wi‑Fi and retry, or set LAN_IP=..."
  exit 1
fi

export LAN_IP
export AUTH_REDIRECT_TO="http://${LAN_IP}:5173"
export CORS_ORIGINS="http://localhost:5173,http://127.0.0.1:5173,http://${LAN_IP}:5173,http://${LAN_IP}:5174"
export VITE_API_URL="http://${LAN_IP}:8000"

if [ -f .env ]; then set -a; source .env; set +a; fi
export VITE_API_URL="http://${LAN_IP}:8000"

if lsof -tiTCP:5173 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "ℹ️  Puerto 5173 ya en uso — Vite usará 5174 si hace falta."
  echo "   Si el teléfono no carga, prueba ambas URLs abajo."
  echo ""
fi

echo "════════════════════════════════════════════"
echo "  📱 Teléfono (misma Wi‑Fi):"
echo "     http://${LAN_IP}:5173"
echo "     http://${LAN_IP}:5174   (si Vite cambia de puerto)"
echo "  💻 Mac: http://localhost:5173"
echo "════════════════════════════════════════════"
echo ""

cd "$ROOT/frontend"
exec npm run dev:host
