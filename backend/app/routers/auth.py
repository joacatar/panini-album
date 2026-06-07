"""Bootstrap login: set password with service role when user knows DEV_AUTH_SECRET."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.config import settings
from app.deps.supabase import _service_role_key_invalid, get_admin_client

router = APIRouter(prefix="/auth", tags=["auth"])


class BootstrapRequest(BaseModel):
    secret: str
    email: str = Field(default="joacatar@gmail.com")
    password: str = Field(min_length=8)


class BootstrapResponse(BaseModel):
    email: str
    message: str


@router.post("/bootstrap-password", response_model=BootstrapResponse)
def bootstrap_password(body: BootstrapRequest) -> BootstrapResponse:
    """Dev-only: set password for an existing user if DEV_AUTH_SECRET matches."""
    if not settings.dev_auth_secret or body.secret != settings.dev_auth_secret:
        raise HTTPException(status_code=403, detail="Clave de bootstrap incorrecta.")

    if _service_role_key_invalid():
        raise HTTPException(
            status_code=503,
            detail="Falta SUPABASE_SERVICE_ROLE_KEY en .env. Ejecuta scripts/sync-supabase-env.py",
        )

    admin = get_admin_client()
    listed = admin.auth.admin.list_users(per_page=200)
    users = getattr(listed, "users", None) or listed
    if isinstance(users, dict):
        users = users.get("users", [])
    user = next((u for u in users if getattr(u, "email", None) == body.email), None)
    if not user:
        raise HTTPException(
            status_code=404,
            detail=f"No hay usuario {body.email}. Usa «Crear cuenta» en la app.",
        )

    admin.auth.admin.update_user_by_id(
        user.id,
        {"password": body.password, "email_confirm": True},
    )
    return BootstrapResponse(
        email=body.email,
        message="Contraseña lista. Entra con correo + contraseña en la app.",
    )
