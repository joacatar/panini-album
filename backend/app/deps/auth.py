from __future__ import annotations

from typing import Annotated, Optional
from uuid import UUID

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt

from app.config import settings

security = HTTPBearer(auto_error=False)


def get_current_user_id(
    credentials: Annotated[Optional[HTTPAuthorizationCredentials], Depends(security)],
) -> UUID:
    if not credentials or not credentials.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Debes iniciar sesión para continuar.",
        )
    if not settings.supabase_jwt_secret:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="API sin configurar (SUPABASE_JWT_SECRET).",
        )
    token = credentials.credentials
    try:
        payload = jwt.decode(
            token,
            settings.supabase_jwt_secret,
            algorithms=["HS256"],
            audience="authenticated",
        )
        sub = payload.get("sub")
        if not sub:
            raise HTTPException(status_code=401, detail="Token inválido.")
        return UUID(sub)
    except (JWTError, ValueError) as exc:
        raise HTTPException(status_code=401, detail="Token inválido.") from exc


CurrentUserId = Annotated[UUID, Depends(get_current_user_id)]


def get_current_user_payload(
    credentials: Annotated[Optional[HTTPAuthorizationCredentials], Depends(security)],
) -> dict:
    if not credentials or not credentials.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Debes iniciar sesión para continuar.",
        )
    if not settings.supabase_jwt_secret:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="API sin configurar (SUPABASE_JWT_SECRET).",
        )
    try:
        return jwt.decode(
            credentials.credentials,
            settings.supabase_jwt_secret,
            algorithms=["HS256"],
            audience="authenticated",
        )
    except JWTError as exc:
        raise HTTPException(status_code=401, detail="Token inválido.") from exc


def require_verified_email(payload: dict) -> None:
    if not payload.get("email_verified"):
        raise HTTPException(
            status_code=403,
            detail="Verifica tu correo antes de proponer intercambios.",
        )
