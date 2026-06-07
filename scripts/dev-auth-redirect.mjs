#!/usr/bin/env node
/**
 * Supabase Site URL suele ser localhost:3000 — sirve HTML que reenvía a :5173
 * conservando query + hash (tokens del magic link).
 */
import http from "node:http";

const FROM_PORT = Number(process.env.AUTH_REDIRECT_FROM || 3000);
const TO_ORIGIN = (process.env.AUTH_REDIRECT_TO || "http://localhost:5173").replace(/\/$/, "");

const HTML = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>Entrando…</title>
  <style>body{font-family:system-ui;background:#0a1628;color:#f5f8fc;display:grid;place-items:center;min-height:100vh;margin:0}</style>
  <script>
    (function () {
      var base = ${JSON.stringify(TO_ORIGIN)};
      var target = base + location.pathname + location.search + location.hash;
      location.replace(target);
    })();
  </script>
</head>
<body><p>Entrando a Panini Intercambios…</p></body>
</html>`;

const server = http.createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  res.end(HTML);
});

server.listen(FROM_PORT, "127.0.0.1", () => {
  console.log(`Auth redirect (hash-safe): http://127.0.0.1:${FROM_PORT} → ${TO_ORIGIN}`);
});
