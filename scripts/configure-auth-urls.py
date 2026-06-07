#!/usr/bin/env python3
"""Fix Supabase Auth Site URL + redirect allowlist (magic link / OAuth)."""

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
DEFAULT_SITE = os.environ.get("SUPABASE_SITE_URL", "http://localhost:5173").rstrip("/")


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
        "Falta SUPABASE_ACCESS_TOKEN.\n"
        "1. https://supabase.com/dashboard/account/tokens\n"
        "2. Añade SUPABASE_ACCESS_TOKEN=sbp_... al .env\n"
        "3. python3 scripts/setup-auth.py",
        file=sys.stderr,
    )
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


def parse_allow_list(raw: str) -> list[str]:
    return [e.strip() for e in re.split(r"[\n,]", raw or "") if e.strip()]


def build_allow_list(existing: list[str], site_url: str, lan_ip: str | None) -> list[str]:
    entries = list(existing)
    defaults = [
        site_url,
        f"{site_url}/**",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:5173/**",
        "http://localhost:5173",
        "http://localhost:5173/**",
    ]
    if lan_ip:
        defaults.extend([f"http://{lan_ip}:5173", f"http://{lan_ip}:5173/**"])
    for url in defaults:
        if url not in entries:
            entries.append(url)
    return entries


def configure_auth_urls(token: str, site_url: str | None = None, lan_ip: str | None = None) -> dict:
    site = (site_url or DEFAULT_SITE).rstrip("/")
    auth = api_request("GET", f"/projects/{PROJECT_REF}/config/auth", token)
    entries = build_allow_list(parse_allow_list(auth.get("uri_allow_list") or ""), site, lan_ip)
    patch = {
        "site_url": site,
        "uri_allow_list": "\n".join(entries),
    }
    api_request("PATCH", f"/projects/{PROJECT_REF}/config/auth", token, patch)
    return {"site_url": site, "redirect_count": len(entries), "previous_site_url": auth.get("site_url")}


def main() -> None:
    lan_ip = os.environ.get("LAN_IP", "").strip() or None
    token = load_token()
    try:
        result = configure_auth_urls(token, lan_ip=lan_ip)
    except urllib.error.HTTPError as exc:
        print(f"Error ({exc.code}): {exc.read().decode()}", file=sys.stderr)
        sys.exit(1)

    prev = result.get("previous_site_url")
    print(f"Site URL: {result['site_url']}" + (f" (antes: {prev})" if prev and prev != result["site_url"] else ""))
    print(f"Redirect URLs: {result['redirect_count']} entradas")
    print("Magic link debería volver a tu app en :5173. Pide un correo nuevo y abre solo el último enlace.")


if __name__ == "__main__":
    main()
