from functools import lru_cache

from supabase import Client, create_client

from app.config import settings


@lru_cache
def get_admin_client() -> Client:
    if not settings.supabase_url or not settings.supabase_service_role_key:
        raise RuntimeError("Configura SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en .env")
    return create_client(settings.supabase_url, settings.supabase_service_role_key)
