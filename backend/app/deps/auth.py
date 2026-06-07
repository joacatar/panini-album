from __future__ import annotations

from typing import Annotated, Optional
from uuid import UUID

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.deps.supabase import _service_role_key_invalid, get_admin_client

security = HTTPBearer(auto_error=False)


def _service_config_error() -> None:
    err = _service_role_key_invalid()
    if err:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"{err} Reinicia el backend después de actualizar .env.",
        )


def _verify_access_token(token: str) -> tuple[UUID, dict]:
    """Valida el JWT del usuario contra Supabase Auth (solo necesitas service_role)."""
    _service_config_error()
    admin = get_admin_client()
    try:
        resp = admin.auth.get_user(jwt=token)
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Token inválido.") from exc
    if not resp or not resp.user:
        raise HTTPException(status_code=401, detail="Token inválido.")

    user = resp.user
    payload = {
        "sub": user.id,
        "email": user.email,
        "email_verified": bool(getattr(user, "email_confirmed_at", None)),
    }
    try:
        return UUID(user.id), payload
    except ValueError as exc:
        raise HTTPException(status_code=401, detail="Token inválido.") from exc


def get_current_user_id(
    credentials: Annotated[Optional[HTTPAuthorizationCredentials], Depends(security)],
) -> UUID:
    if not credentials or not credentials.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Debes iniciar sesión para continuar.",
        )
    user_id, _ = _verify_access_token(credentials.credentials)
    return user_id


CurrentUserId = Annotated[UUID, Depends(get_current_user_id)]


def get_current_user_payload(
    credentials: Annotated[Optional[HTTPAuthorizationCredentials], Depends(security)],
) -> dict:
    if not credentials or not credentials.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Debes iniciar sesión para continuar.",
        )
    _, payload = _verify_access_token(credentials.credentials)
    return payload


def require_verified_email(payload: dict) -> None:
    if not payload.get("email_verified"):
        raise HTTPException(
            status_code=403,
            detail="Verifica tu correo antes de proponer intercambios.",
        )
