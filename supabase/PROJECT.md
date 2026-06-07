# Proyecto Supabase vinculado

| Campo | Valor |
|-------|--------|
| Nombre | panini-intercambios |
| Project ref | `htpfymxjfsvyvskfirjq` |
| Región | sa-east-1 (São Paulo) |
| URL API | https://htpfymxjfsvyvskfirjq.supabase.co |
| Dashboard | https://supabase.com/dashboard/project/htpfymxjfsvyvskfirjq |

## Migraciones aplicadas (MCP)

- `initial_schema` — tablas, RLS, triggers, vistas
- Seed — 90 láminas en `public.stickers`

## Auth — configurar en Dashboard

1. **Providers**  
   https://supabase.com/dashboard/project/htpfymxjfsvyvskfirjq/auth/providers  
   - **Email**: activado, preferir **Magic Link** (sin contraseña obligatoria).  
   - **Google** (requiere credenciales propias en Google Cloud):
     1. [Google Cloud → Credentials](https://console.cloud.google.com/apis/credentials) → **OAuth client ID** → Web application  
     2. **Authorized redirect URI**: `https://htpfymxjfsvyvskfirjq.supabase.co/auth/v1/callback`  
     3. Copia Client ID + Secret al `.env` raíz:
        ```env
        GOOGLE_OAUTH_CLIENT_ID=....apps.googleusercontent.com
        GOOGLE_OAUTH_CLIENT_SECRET=GOCSPX-...
        ```
     4. Activa en Supabase con el script (token en https://supabase.com/dashboard/account/tokens):
        ```bash
        export SUPABASE_ACCESS_TOKEN=sbp_...
        python3 scripts/configure-google-auth.py
        ```
     Sin esto verás: *"Unsupported provider: provider is not enabled"*.

2. **URL Configuration** (crítico para magic link)  
   https://supabase.com/dashboard/project/htpfymxjfsvyvskfirjq/auth/url-configuration  
   - **Site URL** debe ser `http://localhost:5173` (no `:3000`)  
   - **Redirect URLs**: `http://localhost:5173`, `http://localhost:5173/**`, etc.

   Si el enlace del correo te manda a otro puerto o dice “expiró”, ejecuta:
   ```bash
   export SUPABASE_ACCESS_TOKEN=sbp_...
   python3 scripts/configure-auth-urls.py
   ```

3. **Claves para FastAPI** (raíz `.env`)  
   https://supabase.com/dashboard/project/htpfymxjfsvyvskfirjq/settings/api  
   - `service_role` → `SUPABASE_SERVICE_ROLE_KEY`  
   - JWT Secret → `SUPABASE_JWT_SECRET`

## MCP en Cursor

El proyecto incluye `.mcp.json` con el servidor Supabase MCP. En Cursor:

1. **Settings → Tools & MCP** → verifica que `supabase` esté conectado (OAuth).
2. Si no aparece, recarga Cursor tras autenticarte en el navegador.

Para sincronizar claves al `.env` (service_role + JWT secret):

```bash
# Token: https://supabase.com/dashboard/account/tokens
export SUPABASE_ACCESS_TOKEN=sbp_...
LAN_IP=$(ipconfig getifaddr en0) python3 scripts/sync-supabase-env.py
```

## Probar en el teléfono (misma Wi‑Fi)

```bash
./scripts/dev.sh          # terminal 1 — API en :8000
./scripts/dev-mobile.sh   # terminal 2 — muestra http://192.168.x.x:5173
```

Abre esa URL en el teléfono. El frontend detecta la IP del API automáticamente.
