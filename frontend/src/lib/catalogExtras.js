/** Láminas que pueden faltar si el seed de Supabase no está al día (p. ej. Coca-Cola). */

const COCA_COLA_PLAYERS = [
  { slot: 1, name: "Lamine Yamal" },
  { slot: 2, name: "Joshua Kimmich" },
  { slot: 3, name: "Virgil van Dijk" },
  { slot: 4, name: "Antonee Robinson" },
  { slot: 5, name: "Alphonso Davies" },
  { slot: 6, name: "Lautaro Martínez" },
  { slot: 7, name: "Harry Kane" },
  { slot: 8, name: "Edson Álvarez" },
  { slot: 9, name: "Weston McKennie" },
  { slot: 10, name: "Jefferson Lerma" },
  { slot: 11, name: "Santiago Giménez" },
  { slot: 12, name: "Gabriel Magalhães" },
];

export function buildCocaColaStickers() {
  return COCA_COLA_PLAYERS.map((p) => {
    const number = 980 + p.slot;
    return {
      id: number,
      number,
      code: `COC${p.slot}`,
      name: p.name,
      section: "Coca-Cola x Panini",
      team_code: "COC",
      team_name: "Coca-Cola x Panini",
      team_slot: p.slot,
      team_page: p.slot <= 6 ? 1 : 2,
      sticker_kind: "coca_cola",
      sticker_type: "special",
      display_order: 979 + p.slot,
    };
  });
}

/** Añade Coca-Cola al catálogo en memoria si la BD aún no la tiene. */
export function mergeCatalogExtras(stickers) {
  if (!stickers?.length) return buildCocaColaStickers();
  if (stickers.some((s) => s.team_code === "COC")) return stickers;
  return [...stickers, ...buildCocaColaStickers()].sort(
    (a, b) => (a.display_order || 0) - (b.display_order || 0)
  );
}
