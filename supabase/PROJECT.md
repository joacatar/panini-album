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
   - **Google**: activar y pegar Client ID + Secret de [Google Cloud Console](https://console.cloud.google.com/apis/credentials) (OAuth 2.0, redirect: `https://htpfymxjfsvyvskfirjq.supabase.co/auth/v1/callback`).

2. **URL Configuration**  
   https://supabase.com/dashboard/project/htpfymxjfsvyvskfirjq/auth/url-configuration  
   - Site URL: `http://localhost:5173`  
   - Redirect URLs: `http://localhost:5173`, `http://localhost:5173/**`

3. **Claves para FastAPI** (raíz `.env`)  
   https://supabase.com/dashboard/project/htpfymxjfsvyvskfirjq/settings/api  
   - `service_role` → `SUPABASE_SERVICE_ROLE_KEY`  
   - JWT Secret → `SUPABASE_JWT_SECRET`

## MCP en Cursor

En `~/.cursor/mcp.json` (opcional, acotar al proyecto):

```json
{
  "mcpServers": {
    "supabase": {
      "type": "http",
      "url": "https://mcp.supabase.com/mcp?project_ref=htpfymxjfsvyvskfirjq"
    }
  }
}
```
