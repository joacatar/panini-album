from functools import lru_cache
from typing import Optional

from supabase import Client, create_client

from app.config import settings


def _placeholder_secret(value: str, label: str) -> Optional[str]:
    key = (value or "").strip()
    if not key:
        return f"Falta {label} en .env (raíz del proyecto)."
    upper = key.upper()
    if upper.startswith("PEGAR") or key.startswith("tu_") or key == "lorem":
        return f"{label} parece un placeholder. Ejecuta: python3 scripts/sync-supabase-env.py"
    if label.endswith("SERVICE_ROLE_KEY") and len(key) < 40:
        return f"{label} parece inválida. Ejecuta: python3 scripts/sync-supabase-env.py"
    if label.endswith("JWT_SECRET") and len(key) < 16:
        return f"{label} parece inválida. Ejecuta: python3 scripts/sync-supabase-env.py"
    return None


def _service_role_key_invalid() -> Optional[str]:
    return _placeholder_secret(settings.supabase_service_role_key, "SUPABASE_SERVICE_ROLE_KEY")


def _jwt_secret_invalid() -> Optional[str]:
    """Opcional — ya no se usa para validar tokens (Supabase Auth lo hace)."""
    key = (settings.supabase_jwt_secret or "").strip()
    if not key:
        return None
    return _placeholder_secret(key, "SUPABASE_JWT_SECRET")


@lru_cache
def get_admin_client() -> Client:
    if not settings.supabase_url:
        raise RuntimeError("Configura SUPABASE_URL en .env (raíz del proyecto).")
    key_err = _service_role_key_invalid()
    if key_err:
        raise RuntimeError(key_err)
    return create_client(settings.supabase_url, settings.supabase_service_role_key)
