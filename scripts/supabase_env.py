#!/usr/bin/env python3
"""Shared helpers: load Supabase Management API token and .env values."""

from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load_dotenv() -> dict[str, str]:
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
            key, val = line.split(sep, 1)
            out[key.strip()] = val.strip()
    return out


def load_management_token() -> str:
    dotenv = load_dotenv()
    token = (
        os.environ.get("SUPABASE_ACCESS_TOKEN", "").strip()
        or dotenv.get("SUPABASE_ACCESS_TOKEN", "").strip()
    )
    if token:
        return token
    token_path = Path.home() / ".supabase" / "access-token"
    if token_path.is_file():
        return token_path.read_text().strip()
    return ""
