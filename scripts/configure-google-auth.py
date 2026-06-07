#!/usr/bin/env python3
"""Enable Google OAuth on the hosted Supabase project via Management API."""

from __future__ import annotations

import importlib.util
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROJECT_REF = os.environ.get("SUPABASE_PROJECT_REF", "htpfymxjfsvyvskfirjq")
API_BASE = "https://api.supabase.com/v1"
CALLBACK = f"https://{PROJECT_REF}.supabase.co/auth/v1/callback"
DASHBOARD_GOOGLE = (
    f"https://supabase.com/dashboard/project/{PROJECT_REF}/auth/providers?provider=Google"
)
GOOGLE_CONSOLE = "https://console.cloud.google.com/apis/credentials"


def _env_mod():
    spec = importlib.util.spec_from_file_location("supabase_env", ROOT / "scripts" / "supabase_env.py")
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


def load_token() -> str:
    token = _env_mod().load_management_token()
    if token:
        return token
    print("Falta SUPABASE_ACCESS_TOKEN en .env — ver scripts/setup-auth.py", file=sys.stderr)
    sys.exit(1)


def api_request(method: str, path: str, token: str, body: dict | None = None) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        f"{API_BASE}{path}",
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
            **({"Content-Type": "application/json"} if body is not None else {}),
        },
    )
    with urllib.request.urlopen(req, timeout=30) as res:
        raw = res.read().decode()
        return json.loads(raw) if raw else {}


def configure_google(
    token: str,
    client_id: str,
    client_secret: str,
    lan_ip: str | None = None,
) -> None:
    auth = api_request("GET", f"/projects/{PROJECT_REF}/config/auth", token)
    allow = auth.get("uri_allow_list") or ""
    entries = [e.strip() for e in allow.replace(",", "\n").splitlines() if e.strip()]
    defaults = [
        "http://localhost:5173",
        "http://localhost:5173/**",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:5173/**",
        "http://localhost:3000",
        "http://localhost:3000/**",
    ]
    if lan_ip:
        defaults.extend([f"http://{lan_ip}:5173", f"http://{lan_ip}:5173/**"])
    for url in defaults:
        if url not in entries:
            entries.append(url)

    patch = {
        "external_google_enabled": True,
        "external_google_client_id": client_id,
        "external_google_secret": client_secret,
        "site_url": "http://localhost:5173",
        "uri_allow_list": "\n".join(entries),
    }
    api_request("PATCH", f"/projects/{PROJECT_REF}/config/auth", token, patch)


def main() -> None:
    dotenv = _env_mod().load_dotenv()
    client_id = (
        os.environ.get("GOOGLE_OAUTH_CLIENT_ID", "").strip()
        or dotenv.get("GOOGLE_OAUTH_CLIENT_ID", "").strip()
    )
    client_secret = (
        os.environ.get("GOOGLE_OAUTH_CLIENT_SECRET", "").strip()
        or dotenv.get("GOOGLE_OAUTH_CLIENT_SECRET", "").strip()
    )

    if not client_id or not client_secret:
        print(
            "Google OAuth no está configurado.\n\n"
            f"1. {GOOGLE_CONSOLE}\n"
            f"   Redirect URI: {CALLBACK}\n"
            "2. .env → GOOGLE_OAUTH_CLIENT_ID + GOOGLE_OAUTH_CLIENT_SECRET\n"
            "3. python3 scripts/setup-auth.py\n\n"
            f"Manual: {DASHBOARD_GOOGLE}",
            file=sys.stderr,
        )
        sys.exit(1)

    token = load_token()
    try:
        configure_google(token, client_id, client_secret)
    except urllib.error.HTTPError as exc:
        print(f"Error ({exc.code}): {exc.read().decode()}", file=sys.stderr)
        sys.exit(1)

    print("Google OAuth activado.")
    print(f"Google Cloud redirect: {CALLBACK}")


if __name__ == "__main__":
    main()
