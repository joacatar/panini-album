/** Navegación y shell compartidos. */

export const NAV_ITEMS = [
  { route: "album", href: "#album", icon: "📖", label: "Álbum" },
  { route: "missing", href: "#missing", icon: "📋", label: "Faltan" },
  { route: "duplicates", href: "#duplicates", icon: "📦", label: "Swaps" },
  {
    route: "intercambiar",
    href: "#intercambiar",
    icon: "🤝",
    label: "Cambiar",
    match: ["intercambiar", "explore", "trades", "trade", "flash", "profile", "user", "review"],
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
