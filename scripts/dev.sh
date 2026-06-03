#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ -f .env ]; then set -a; source .env; set +a; fi

echo "API: http://localhost:${API_PORT:-8000}"
cd "$ROOT/backend"
. .venv/bin/activate 2>/dev/null || { python3 -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt -q; }
exec uvicorn app.main:app --reload --host "${API_HOST:-0.0.0.0}" --port "${API_PORT:-8000}"
