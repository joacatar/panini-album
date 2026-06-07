/** Navegación y shell compartidos. */

export const NAV_ITEMS = [
  { route: "album", href: "#album", icon: "📖", label: "Álbum" },
  { route: "missing", href: "#missing", icon: "📋", label: "Faltan" },
  { route: "duplicates", href: "#duplicates", icon: "📦", label: "Swaps" },
  {
    route: "intercambiar",
    href: "#intercambiar",
    icon: "⚡",
    label: "Cambiar",
    match: ["intercambiar", "flash"],
  },
  {
    route: "cuenta",
    href: "#cuenta",
    icon: "👤",
    label: "Cuenta",
    match: ["cuenta", "explore", "trades", "trade", "profile", "user", "review", "onboarding", "guia"],
  },
];

export function isNavActive(item, route) {
  if (item.match) return item.match.includes(route);
  return item.route === route;
}

export function renderBottomNav(route) {
  return `<nav class="bottom-nav" aria-label="Principal">${NAV_ITEMS.map(
    (item) => `
    <a href="${item.href}" class="nav-item ${isNavActive(item, route) ? "active" : ""}" data-nav="${item.route}">
      <span class="nav-icon" aria-hidden="true">${item.icon}</span>
      <span class="nav-label">${item.label}</span>
    </a>`
  ).join("")}</nav>`;
}

export function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;");
}

/** Enlace discreto a la guía (#guia). */
export function renderGuiaLink(label = "❓ Guía rápida") {
  return `<a href="#guia" class="guia-link">${label}</a>`;
}

/** Mensaje corto para nuevos usuarios (español latino). */
export function renderWelcomeMessage() {
  return `
    <article class="welcome-banner card">
      <p class="welcome-kicker">Mundial FIFA 2026 · álbum Panini</p>
      <h2 class="welcome-title">Marca tu álbum, pega listas y cambia láminas</h2>
      <ul class="welcome-list">
        <li><strong>Álbum</strong> — anota lo que tienes; no hace falta cuenta.</li>
        <li><strong>Pegar lista</strong> — copia el texto de WhatsApp y la app lo entiende.</li>
        <li><strong>Cambiar → Flash</strong> — armas el trato con un amigo al instante.</li>
        <li><strong>Cuenta</strong> — solo si quieres guardar en la nube o ver gente cerca.</li>
      </ul>
      <p class="welcome-guia">${renderGuiaLink("Ver guía paso a paso →")}</p>
    </article>`;
}
