/** Paginación del álbum físico por sección (FWC, selecciones, Coca-Cola). */

/** FWC: 2 páginas de apertura (1–8) + 3 del Museo FIFA al final del álbum (9–20). */
const FWC_PAGE_RANGES = [
  [1, 4],
  [5, 8],
  [9, 12],
  [13, 16],
  [17, 20],
];

const PAGE_RANGES = {
  FWC: FWC_PAGE_RANGES,
  COC: [
    [1, 6],
    [7, 12],
  ],
  DEFAULT: [
    [1, 10],
    [11, 20],
  ],
};

export function fwcAlbumPage(slot) {
  if (slot <= 4) return 1;
  if (slot <= 8) return 2;
  if (slot <= 12) return 3;
  if (slot <= 16) return 4;
  return 5;
}

export function pageRangesForTeam(teamCode) {
  return PAGE_RANGES[teamCode] || PAGE_RANGES.DEFAULT;
}

export function stickerAlbumPage(sticker) {
  const code = sticker.team_code;
  const slot = sticker.team_slot ?? sticker.number;
  if (code === "FWC") return fwcAlbumPage(slot);
  if (sticker.team_page != null) return sticker.team_page;
  const ranges = pageRangesForTeam(code);
  for (let i = 0; i < ranges.length; i++) {
    const [lo, hi] = ranges[i];
    if (slot >= lo && slot <= hi) return i + 1;
  }
  return slot <= 10 ? 1 : 2;
}

export function albumPageNumbers(team) {
  if (team.team_code === "FWC") return [1, 2, 3, 4, 5];
  const max = Math.max(...team.stickers.map((s) => stickerAlbumPage(s)), 1);
  return Array.from({ length: max }, (_, i) => i + 1);
}

export function stickersOnAlbumPage(team, pageNum) {
  return team.stickers.filter((s) => stickerAlbumPage(s) === pageNum);
}

function fwcPageSection(pageNum) {
  if (pageNum <= 2) return "Apertura";
  return "Museo FIFA";
}

export function albumPageLabel(teamCode, pageNum) {
  if (teamCode === "FWC") {
    const ranges = FWC_PAGE_RANGES[pageNum - 1];
    const [lo, hi] = ranges;
    const section = fwcPageSection(pageNum);
    return `${section} · ${lo}–${hi}`;
  }
  const ranges = pageRangesForTeam(teamCode);
  const range = ranges[pageNum - 1];
  if (!range) return `Pág. ${pageNum}`;
  const [lo, hi] = range;
  return lo === hi ? `Pág. ${pageNum} · ${lo}` : `Pág. ${pageNum} · ${lo}–${hi}`;
}

export function albumPageDividerLabel(teamCode, pageNum) {
  if (teamCode === "FWC") {
    const ranges = FWC_PAGE_RANGES[pageNum - 1];
    const [lo, hi] = ranges;
    const section = fwcPageSection(pageNum);
    const where = pageNum <= 2 ? "inicio del álbum" : "final del álbum";
    return `${section} · FWC ${lo}–${hi} · ${where}`;
  }
  const ranges = pageRangesForTeam(teamCode);
  const range = ranges[pageNum - 1];
  if (!range) return `Página ${pageNum}`;
  const [lo, hi] = range;
  return lo === hi ? `Página ${pageNum} · ${lo}` : `Página ${pageNum} · ${lo}–${hi}`;
}
