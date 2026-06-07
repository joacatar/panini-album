#!/usr/bin/env python3
"""Sync Supabase API keys into .env files via Management API."""

from __future__ import annotations

import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROJECT_REF = os.environ.get("SUPABASE_PROJECT_REF", "htpfymxjfsvyvskfirjq")
API_BASE = "https://api.supabase.com/v1"


class ApiError(Exception):
    def __init__(self, code: int, path: str, body: str) -> None:
        self.code = code
        self.path = path
        self.body = body
        super().__init__(f"HTTP {code} on {path}")


def load_token() -> str:
    import importlib.util

    spec = importlib.util.spec_from_file_location("supabase_env", ROOT / "scripts" / "supabase_env.py")
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    token = mod.load_management_token()
    if token:
        return token
    print(
        "No Supabase access token found.\n"
        "1. Open https://supabase.com/dashboard/account/tokens\n"
        "2. Add SUPABASE_ACCESS_TOKEN=sbp_... to .env\n"
        "3. python3 scripts/sync-supabase-env.py",
        file=sys.stderr,
    )
    sys.exit(1)


def api_get(path: str, token: str) -> object:
    req = urllib.request.Request(
        f"{API_BASE}{path}",
        headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            return json.loads(res.read().decode())
    except urllib.error.HTTPError as exc:
        body = ""
        try:
            body = exc.read().decode()
        except Exception:
            pass
        raise ApiError(exc.code, path, body) from exc


def print_403_help() -> None:
    print(
        "\n❌ 403 Forbidden — tu SUPABASE_ACCESS_TOKEN no puede leer secretos del proyecto.\n"
        "\nCausas comunes:"
        "\n  • Token “fine-grained” sin permiso api_gateway_keys_read / secrets:read"
        "\n  • Token de otra cuenta u organización"
        "\n  • Token revocado o expirado"
        "\n\nOpción A — nuevo token con permisos:"
        "\n  1. https://supabase.com/dashboard/account/tokens"
        "\n  2. Create token → marca acceso al proyecto htpfymxjfsvyvskfirjq"
        "\n     (o usa “All projects” / permisos que incluyan API keys / secrets)"
        "\n  3. En .env: SUPABASE_ACCESS_TOKEN=sbp_..."
        "\n  4. Vuelve a correr: python3 scripts/sync-supabase-env.py"
        "\n\nOpción B — manual (2 min, sin Management API):"
        "\n  Dashboard → Project Settings → API"
        "\n  https://supabase.com/dashboard/project/htpfymxjfsvyvskfirjq/settings/api"
        "\n  Copia en .env (raíz):"
        "\n    SUPABASE_SERVICE_ROLE_KEY=eyJ...  (Reveal service_role)"
        "\n    SUPABASE_JWT_SECRET=...           (JWT Settings → JWT Secret)"
        "\n  Reinicia el backend (uvicorn)."
        "\n  Verifica: curl http://127.0.0.1:8000/health"
    )


def fetch_api_keys(token: str) -> list:
    """Try reveal=true first, then legacy endpoint."""
    paths = [
        f"/projects/{PROJECT_REF}/api-keys?reveal=true",
        f"/projects/{PROJECT_REF}/api-keys/legacy",
    ]
    last_err: ApiError | None = None
    for path in paths:
        try:
            data = api_get(path, token)
            if isinstance(data, list):
                return data
            if isinstance(data, dict):
                for key in ("keys", "api_keys", "legacy_keys"):
                    if isinstance(data.get(key), list):
                        return data[key]
        except ApiError as exc:
            last_err = exc
            if exc.code != 403:
                raise
    if last_err:
        raise last_err
    return []


def pick_service_key(keys: list) -> str | None:
    for key in keys:
        name = (key.get("name") or "").lower()
        typ = (key.get("type") or "").lower()
        if typ == "secret" and key.get("api_key"):
            return key["api_key"]
        if name == "service_role" and key.get("api_key"):
            return key["api_key"]
        if typ == "legacy" and name == "service_role" and key.get("api_key"):
            return key["api_key"]
    for key in keys:
        if key.get("api_key") and (key.get("type") or "").lower() in {"secret", "legacy"}:
            if "service" in (key.get("name") or "").lower():
                return key["api_key"]
    return None


def pick_anon_key(keys: list) -> str | None:
    for key in keys:
        name = (key.get("name") or "").lower()
        typ = (key.get("type") or "").lower()
        if name == "anon" and key.get("api_key"):
            return key["api_key"]
        if typ == "publishable" and key.get("api_key"):
            return key["api_key"]
    return None


def update_env_file(path: Path, updates: dict[str, str]) -> None:
    lines = path.read_text().splitlines() if path.is_file() else []
    seen = set()
    out = []
    for line in lines:
        if "=" not in line or line.strip().startswith("#"):
            out.append(line)
            continue
        key, _ = line.split("=", 1)
        key = key.strip()
        if key in updates:
            out.append(f"{key}={updates[key]}")
            seen.add(key)
        else:
            out.append(line)
    for key, value in updates.items():
        if key not in seen:
            out.append(f"{key}={value}")
    path.write_text("\n".join(out).rstrip() + "\n")


def add_mobile_redirect(token: str, lan_ip: str | None) -> None:
    if not lan_ip:
        return
    mobile_url = f"http://{lan_ip}:5173/**"
    try:
        auth = api_get(f"/projects/{PROJECT_REF}/config/auth", token)
    except ApiError as exc:
        print(f"Warning: could not read auth config ({exc.code})", file=sys.stderr)
        return
    allow = auth.get("uri_allow_list") or ""
    entries = [e.strip() for e in re.split(r"[\n,]", allow) if e.strip()]
    if mobile_url in entries:
        return
    entries.append(mobile_url)
    payload = json.dumps({"uri_allow_list": "\n".join(entries)}).encode()
    req = urllib.request.Request(
        f"{API_BASE}/projects/{PROJECT_REF}/config/auth",
        data=payload,
        method="PATCH",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30):
            print(f"Added mobile redirect: {mobile_url}")
    except urllib.error.HTTPError as exc:
        print(f"Warning: could not update auth redirects ({exc.code})", file=sys.stderr)


def configure_auth_urls_from_script(token: str, lan_ip: str | None = None) -> None:
    import importlib.util

    spec = importlib.util.spec_from_file_location(
        "configure_auth_urls_mod",
        ROOT / "scripts" / "configure-auth-urls.py",
    )
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    result = mod.configure_auth_urls(token, lan_ip=lan_ip)
    prev = result.get("previous_site_url")
    if prev and prev.rstrip("/") != result["site_url"]:
        print(f"Auth Site URL: {prev} → {result['site_url']}")


def main() -> None:
    token = load_token()
    try:
        keys = fetch_api_keys(token)
    except ApiError as exc:
        if exc.code == 403:
            print_403_help()
            if exc.body:
                print(f"\nRespuesta API: {exc.body[:500]}")
            sys.exit(1)
        print(f"Error API {exc.code}: {exc.path}", file=sys.stderr)
        if exc.body:
            print(exc.body[:500], file=sys.stderr)
        sys.exit(1)

    if not keys:
        print("No API keys returned.", file=sys.stderr)
        sys.exit(1)

    service_key = pick_service_key(keys)
    anon_key = pick_anon_key(keys)
    if not service_key:
        print("Could not find service_role / secret key in Management API response.", file=sys.stderr)
        sys.exit(1)

    jwt_secret = ""
    jwt_err = None
    try:
        postgrest = api_get(f"/projects/{PROJECT_REF}/postgrest", token)
        jwt_secret = (postgrest or {}).get("jwt_secret") or ""
    except ApiError as exc:
        jwt_err = f"postgrest API ({exc.code})"
    if not jwt_secret:
        print(
            "Warning: could not fetch JWT secret automatically."
            + (f" ({jwt_err})" if jwt_err else "")
            + "\nPaste manually from Supabase Dashboard → Project Settings → API → JWT Secret"
            + " into SUPABASE_JWT_SECRET in .env",
            file=sys.stderr,
        )

    url = f"https://{PROJECT_REF}.supabase.co"
    root_updates = {
        "SUPABASE_URL": url,
        "SUPABASE_SERVICE_ROLE_KEY": service_key,
    }
    if anon_key:
        root_updates["SUPABASE_ANON_KEY"] = anon_key
    if jwt_secret:
        root_updates["SUPABASE_JWT_SECRET"] = jwt_secret

    fe_updates = {
        "VITE_SUPABASE_URL": url,
    }
    if anon_key:
        fe_updates["VITE_SUPABASE_ANON_KEY"] = anon_key

    lan_ip = os.environ.get("LAN_IP", "").strip()
    if lan_ip:
        root_updates["CORS_ORIGINS"] = (
            f"http://localhost:5173,http://127.0.0.1:5173,http://{lan_ip}:5173"
        )
        fe_updates["VITE_API_URL"] = f"http://{lan_ip}:8000"

    update_env_file(ROOT / ".env", root_updates)
    update_env_file(ROOT / "frontend" / ".env", fe_updates)
    add_mobile_redirect(token, lan_ip or None)
    try:
        configure_auth_urls_from_script(token, lan_ip or None)
    except ApiError as exc:
        print(f"Warning: could not fix auth URLs ({exc.code})", file=sys.stderr)
    except Exception as exc:
        print(f"Warning: auth URL sync skipped ({exc})", file=sys.stderr)

    print("Updated .env and frontend/.env with Supabase keys.")
    if jwt_secret:
        print("✓ SUPABASE_JWT_SECRET synced")
    else:
        print("⚠ Pegar SUPABASE_JWT_SECRET a mano en .env")
    if lan_ip:
        print(f"Phone URL: http://{lan_ip}:5173")
        print(f"API URL:   http://{lan_ip}:8000")
    print("Restart backend: uvicorn app.main:app --app-dir backend --reload --host 0.0.0.0 --port 8000")


if __name__ == "__main__":
    main()
