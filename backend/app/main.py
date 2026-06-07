from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.deps.supabase import _jwt_secret_invalid, _service_role_key_invalid
from app.routers import auth, matches, reviews, trades

app = FastAPI(
    title="Panini Intercambios API",
    description="Marketplace de láminas Panini FIFA 2026 — español latino",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list or ["*"],
    allow_origin_regex=(
        r"https?://(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3})(:\d+)?"
        if settings.dev_allow_lan
        else None
    ),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(matches.router)
app.include_router(trades.router)
app.include_router(reviews.router)


@app.get("/health")
def health() -> dict:
    service_err = _service_role_key_invalid()
    errors = [e for e in (service_err,) if e]
    return {
        "status": "ok" if not errors else "degraded",
        "locale": "es-419",
        "supabase": {
            "url_configured": bool(settings.supabase_url),
            "service_role_configured": not service_err,
            "auth_via_supabase": True,
            "errors": errors,
        },
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host=settings.api_host, port=settings.api_port, reload=True)
