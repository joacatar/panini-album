#!/usr/bin/env python3
"""Set email/password for a Supabase user (needs service_role in .env)."""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROJECT_REF = os.environ.get("SUPABASE_PROJECT_REF", "htpfymxjfsvyvskfirjq")


def load_dotenv() -> dict[str, str]:
    out: dict[str, str] = {}
    for path in (ROOT / ".env",):
        if not path.is_file():
            continue
        for line in path.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, val = line.split("=", 1)
            out[key.strip()] = val.strip()
    return out


def main() -> None:
    dotenv = load_dotenv()
    url = dotenv.get("SUPABASE_URL", f"https://{PROJECT_REF}.supabase.co").rstrip("/")
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", dotenv.get("SUPABASE_SERVICE_ROLE_KEY", ""))
    email = os.environ.get("AUTH_EMAIL", dotenv.get("DEV_AUTH_EMAIL", "joacatar@gmail.com"))
    password = os.environ.get("AUTH_PASSWORD", dotenv.get("DEV_AUTH_PASSWORD", ""))

    if not service_key or "PEGAR" in service_key:
        print(
            "Falta SUPABASE_SERVICE_ROLE_KEY real en .env\n"
            "Dashboard → Project Settings → API → service_role\n"
            "O: python3 scripts/sync-supabase-env.py (con SUPABASE_ACCESS_TOKEN)",
            file=sys.stderr,
        )
        sys.exit(1)

    if not password or len(password) < 8:
        print("Define contraseña (mín. 8 caracteres): AUTH_PASSWORD=TuClave123 python3 scripts/set-user-password.py", file=sys.stderr)
        sys.exit(1)

    # Find user id
    req = urllib.request.Request(
        f"{url}/auth/v1/admin/users?email={urllib.parse.quote(email)}",
        headers={"Authorization": f"Bearer {service_key}", "apikey": service_key},
    )

    with urllib.request.urlopen(req, timeout=30) as res:
        users = json.loads(res.read()).get("users", [])

    if not users:
        print(f"No existe usuario {email}. Créalo en la app con «Crear cuenta».", file=sys.stderr)
        sys.exit(1)

    user_id = users[0]["id"]
    payload = json.dumps({"password": password, "email_confirm": True}).encode()
    req = urllib.request.Request(
        f"{url}/auth/v1/admin/users/{user_id}",
        data=payload,
        method="PUT",
        headers={
            "Authorization": f"Bearer {service_key}",
            "apikey": service_key,
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            res.read()
    except urllib.error.HTTPError as exc:
        print(f"Error ({exc.code}): {exc.read().decode()}", file=sys.stderr)
        sys.exit(1)

    print(f"✓ Contraseña actualizada para {email}")
    print("Entra en la app: Intercambiar → correo + contraseña → Entrar")


if __name__ == "__main__":
    main()
