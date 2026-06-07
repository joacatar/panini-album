#!/usr/bin/env bash
# Arranca backend + frontend juntos (Ctrl+C para los dos).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "🔍 Verificando configuración…"
if ! python3 scripts/check-setup.py; then
  echo ""
  echo "Corrige los errores arriba antes de continuar."
  exit 1
fi

cleanup() {
  if [ -n "${BACKEND_PID:-}" ] && kill -0 "$BACKEND_PID" 2>/dev/null; then
    kill "$BACKEND_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

echo ""
echo "🚀 Backend en segundo plano…"
./scripts/dev.sh &
BACKEND_PID=$!
sleep 1.5

echo "🌐 Frontend…"
echo "   App: http://localhost:5173"
echo "   API: http://localhost:8000/docs"
echo ""

cd "$ROOT/frontend"
exec npm run dev
