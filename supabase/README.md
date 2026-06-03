# Supabase — Panini Intercambios

## Aplicar esquema

1. Abre tu proyecto en [Supabase Dashboard](https://supabase.com/dashboard).
2. **SQL Editor** → New query.
3. Pega y ejecuta [`migrations/20260603000000_initial_schema.sql`](migrations/20260603000000_initial_schema.sql).
4. Ejecuta [`seed/panini_2026_full.sql`](seed/panini_2026_full.sql) para cargar 90 láminas de ejemplo.

## Auth

- **Authentication → Providers**: Email (magic link) + Google.
- **URL Configuration**: `http://localhost:5173` en desarrollo.

## MCP en Cursor

[Guía oficial Supabase MCP](https://supabase.com/docs/guides/getting-started/mcp) — vincula este proyecto para ejecutar SQL y revisar tablas desde el editor.

## Claves para `.env`

Project Settings → API: `URL`, `anon`, `service_role`, JWT Secret (Settings → API → JWT Settings).
