#!/usr/bin/env python3
"""Diagnóstico rápido: .env, backend, frontend."""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load_env() -> dict[str, str]:
    out: dict[str, str] = {}
    for path in (ROOT / ".env", ROOT / "frontend" / ".env"):
        if not path.is_file():
            continue
        for line in path.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            sep = "=" if "=" in line else (":" if ":" in line else None)
            if not sep:
                continue
            k, v = line.split(sep, 1)
            out[k.strip()] = v.strip()
    return out


def ok(msg: str) -> None:
    print(f"  ✓ {msg}")


def warn(msg: str) -> None:
    print(f"  ⚠ {msg}")


def fail(msg: str) -> None:
    print(f"  ✗ {msg}")


def main() -> None:
    print("Panini Intercambios — check-setup\n")
    env = load_env()
    issues = 0

    # --- .env raíz ---
    print("1) .env (backend)")
    url = env.get("SUPABASE_URL", "")
    anon = env.get("SUPABASE_ANON_KEY", "")
    service = env.get("SUPABASE_SERVICE_ROLE_KEY", "")
    jwt_secret = env.get("SUPABASE_JWT_SECRET", "")

    if url:
        ok(f"SUPABASE_URL = {url}")
    else:
        fail("Falta SUPABASE_URL")
        issues += 1

    if anon and not anon.startswith("PEGAR") and len(anon) > 40:
        ok("SUPABASE_ANON_KEY configurada")
    else:
        fail("SUPABASE_ANON_KEY falta o es placeholder")
        issues += 1

    if service and not service.startswith("PEGAR") and len(service) > 40:
        ok("SUPABASE_SERVICE_ROLE_KEY configurada (backend valida login con esto)")
    else:
        fail("SUPABASE_SERVICE_ROLE_KEY falta — Dashboard → API → service_role → Reveal")
        issues += 1

    jwt_secret = env.get("SUPABASE_JWT_SECRET", "")
    if jwt_secret and jwt_secret == service:
        warn("SUPABASE_JWT_SECRET = service_role (ya no hace falta; puedes borrar esa línea)")
    elif jwt_secret and not jwt_secret.startswith("PEGAR"):
        ok("SUPABASE_JWT_SECRET presente (opcional, ya no se usa)")

    # --- frontend .env ---
    print("\n2) frontend/.env")
    fe_url = env.get("VITE_SUPABASE_URL", "")
    fe_anon = env.get("VITE_SUPABASE_ANON_KEY", "")
    fe_api = env.get("VITE_API_URL", "http://localhost:8000")
    if fe_url and fe_anon:
        ok("VITE_SUPABASE_* configuradas")
    else:
        fail("Faltan VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY en frontend/.env")
        issues += 1
    ok(f"VITE_API_URL = {fe_api}")

    # --- backend health ---
    print("\n3) Backend (http://127.0.0.1:8000/health)")
    try:
        with urllib.request.urlopen("http://127.0.0.1:8000/health", timeout=3) as res:
            data = json.loads(res.read().decode())
        if data.get("status") == "ok":
            ok("Backend corriendo y configurado")
        else:
            warn(f"Backend corriendo pero degraded: {data.get('supabase', {}).get('errors')}")
            issues += 1
    except urllib.error.URLError:
        fail("Backend NO está corriendo")
        print("      Arranca: ./scripts/dev.sh")
        issues += 1

    # --- venv ---
    print("\n4) Python venv")
    venv_uvicorn = ROOT / "backend" / ".venv" / "bin" / "uvicorn"
    if venv_uvicorn.is_file():
        ok("backend/.venv existe")
    else:
        warn("backend/.venv no existe — ./scripts/dev.sh lo crea al primer uso")

    # --- resumen ---
    print("\n" + "—" * 50)
    if issues:
        print(f"❌ {issues} problema(s). Arregla lo de arriba y vuelve a correr:")
        print("   python3 scripts/check-setup.py")
        print("\nArranque local (2 terminales):")
        print("   Terminal 1:  ./scripts/dev.sh")
        print("   Terminal 2:  cd frontend && npm run dev")
        print("\nSolo álbum + login (sin backend): cd frontend && npm run dev")
        sys.exit(1)

    print("✅ Todo listo. Arranque:")
    print("   Terminal 1:  ./scripts/dev.sh")
    print("   Terminal 2:  cd frontend && npm run dev")
    print("   App:         http://localhost:5173")


if __name__ == "__main__":
    main()
