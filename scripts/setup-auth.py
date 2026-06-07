#!/usr/bin/env python3
"""One-shot: fix auth URLs + enable Google if credentials exist in .env."""

from __future__ import annotations

import importlib.util
import os
import sys
import urllib.error
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


def main() -> None:
    env_mod = load_module("supabase_env", ROOT / "scripts" / "supabase_env.py")
    token = env_mod.load_management_token()
    dotenv = env_mod.load_dotenv()

    if not token:
        print(
            "Falta SUPABASE_ACCESS_TOKEN en .env o en el entorno.\n"
            "Créalo en https://supabase.com/dashboard/account/tokens\n"
            "Añade a .env: SUPABASE_ACCESS_TOKEN=sbp_...\n\n"
            "Mientras tanto, usa: npm run dev (incluye redirect :3000 → :5173 para magic links).",
            file=sys.stderr,
        )
        sys.exit(1)

    urls_mod = load_module("configure_auth_urls", ROOT / "scripts" / "configure-auth-urls.py")
    lan_ip = os.environ.get("LAN_IP", "").strip() or None
    try:
        result = urls_mod.configure_auth_urls(token, lan_ip=lan_ip)
        prev = result.get("previous_site_url")
        print(f"✓ Site URL: {result['site_url']}" + (f" (antes: {prev})" if prev else ""))
        print(f"✓ Redirect URLs: {result['redirect_count']} entradas")
    except urllib.error.HTTPError as exc:
        print(f"✗ Auth URLs ({exc.code}): {exc.read().decode()}", file=sys.stderr)
        sys.exit(1)

    client_id = dotenv.get("GOOGLE_OAUTH_CLIENT_ID", "").strip()
    client_secret = dotenv.get("GOOGLE_OAUTH_CLIENT_SECRET", "").strip()
    if client_id and client_secret:
        google_mod = load_module("configure_google_auth", ROOT / "scripts" / "configure-google-auth.py")
        try:
            google_mod.configure_google(token, client_id, client_secret, lan_ip=lan_ip)
            print("✓ Google OAuth activado")
        except urllib.error.HTTPError as exc:
            print(f"✗ Google ({exc.code}): {exc.read().decode()}", file=sys.stderr)
    else:
        print(
            "○ Google: añade GOOGLE_OAUTH_CLIENT_ID y GOOGLE_OAUTH_CLIENT_SECRET a .env "
            "y vuelve a ejecutar este script."
        )

    print("\nListo. Pide un magic link nuevo en http://localhost:5173/#intercambiar")


if __name__ == "__main__":
    main()
