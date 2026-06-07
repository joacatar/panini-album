# Panini Intercambios — Mundial FIFA 2026

Marketplace en **español latino** para intercambiar láminas del álbum Panini Mundial 2026. Web app móvil (PWA) + API en **Python (FastAPI)** + **Supabase** (PostgreSQL, Auth, RLS).

## Características (v1)

- Cuenta con **Google** o **correo** (enlace mágico)
- Registra láminas que **tienes** y **repetidas**
- Lista automática de **me faltan**
- **Explorar** coleccionistas con coincidencias mutuas y filtro por **geolocalización**
- **Solicitudes de intercambio** con chat de coordinación (sin envíos integrados)
- **Reseñas** tras intercambio completado y **reportes** de usuarios
- Instalable en **iPhone** como PWA (Safari → Compartir → Añadir a pantalla de inicio)

## Requisitos

- Cuenta en [Supabase](https://supabase.com)
- Python 3.11+
- Node.js 18+

## 1. Supabase

1. Crea un proyecto en Supabase (región cercana a tus usuarios).
2. **SQL Editor** → ejecuta en orden:
   - [`supabase/migrations/20260603000000_initial_schema.sql`](supabase/migrations/20260603000000_initial_schema.sql)
   - [`supabase/seed/panini_2026_full.sql`](supabase/seed/panini_2026_full.sql)
3. **Authentication → Providers**: activa **Email** (magic link) y **Google** (OAuth client en Google Cloud).
4. **Authentication → URL Configuration**: sitio `http://localhost:5173`, redirect igual.
5. Copia de **Project Settings → API**: URL, `anon` key, `service_role` key, y **JWT Secret**.

### Supabase MCP en Cursor

1. **Settings → MCP → Add server** → [Supabase MCP](https://supabase.com/docs/guides/getting-started/mcp)
2. Autentica y vincula tu proyecto para migraciones y consultas desde el editor.

## 2. Variables de entorno

```bash
cp .env.example .env
# Edita .env con tus claves Supabase

cp .env.example frontend/.env
# Mismas URL/anon key + VITE_API_URL=http://localhost:8000
```

## 3. Backend (FastAPI)

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cd ..
# Desde la raíz del repo (para que encuentre .env):
uvicorn app.main:app --app-dir backend --reload --host 0.0.0.0 --port 8000
```

API: http://localhost:8000/docs

## 4. Frontend (PWA)

```bash
cd frontend
npm install
npm run dev
```

Abre http://localhost:5173

## Estructura

```
panini-intercambios/
├── supabase/migrations/   # Esquema + RLS
├── supabase/seed/         # Catálogo 90 láminas (placeholder)
├── backend/app/           # FastAPI: matches, trades, reviews
└── frontend/              # PWA Vite + Supabase JS
```

## Actualizar catálogo

Edita [`backend/data/panini_2026.json`](backend/data/panini_2026.json) y ejecuta:

```bash
python3 backend/scripts/seed_stickers.py
```

Luego aplica el SQL generado en `supabase/seed/panini_2026_full.sql`.

## Colección sin cuenta

Sin iniciar sesión, tu álbum se guarda en el **navegador** (`localStorage`, clave `panini_collection_v1`). No se pierde al recargar la página en el mismo dispositivo/navegador.

Si luego entras con Google o correo, la app **fusiona** lo local con tu cuenta en Supabase y limpia el almacenamiento local.

## Despliegue

| Componente | Dónde | URL |
|------------|-------|-----|
| Base de datos + Auth | **Supabase** (ya en la nube) | `https://TU_PROYECTO.supabase.co` |
| Frontend PWA | **Vercel** o Netlify | Sí, te dan link `*.vercel.app` |
| API Python | **Cloud Run**, Railway o Render | Sí, cada uno da URL pública |

**Vercel no ejecuta Python/FastAPI.** Necesitas dos servicios:

1. **Frontend** → Vercel  
   - Root: `frontend`  
   - Build: `npm run build`  
   - Output: `dist`  
   - Env: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_URL=https://TU-API.run.app`

2. **Backend** → Google Cloud Run (o Railway)  
   - Dockerfile/uvicorn en `backend`  
   - Env: `SUPABASE_*`, `CORS_ORIGINS=https://tu-app.vercel.app`  
   - Cloud Run te da una URL tipo `https://panini-api-xxxxx.run.app`

3. **Supabase Auth** → añade la URL de Vercel en Redirect URLs del dashboard.

Usa HTTPS en producción (obligatorio para PWA y OAuth).

## Aviso legal

Los intercambios son entre particulares. Esta app no gestiona pagos ni envíos. Panini y FIFA son marcas de sus titulares; este proyecto es un fan tool no oficial.
