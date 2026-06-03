from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routers import matches, reviews, trades

app = FastAPI(
    title="Panini Intercambios API",
    description="Marketplace de láminas Panini FIFA 2026 — español latino",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list or ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(matches.router)
app.include_router(trades.router)
app.include_router(reviews.router)


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "locale": "es-419"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host=settings.api_host, port=settings.api_port, reload=True)
