#!/usr/bin/env bash
# Regenera JSON/SQL y muestra instrucciones para Supabase
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
python3 backend/scripts/generate_catalog.py
python3 backend/scripts/seed_stickers.py
echo ""
echo "→ Pega el contenido de supabase/seed/panini_2026_full.sql en:"
echo "  https://supabase.com/dashboard/project/htpfymxjfsvyvskfirjq/sql/new"
echo ""
echo "O pide al agente con MCP: ejecutar panini_2026_full.sql"
