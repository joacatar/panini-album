/** Máximo de copias rastreables en el álbum. */
export const MAX_ALBUM_COPIES = 9;

/** @param {{ owned?: boolean, duplicates?: number } | undefined} c */
export function totalCopiesFromRecord(c) {
  if (!c?.owned) return 0;
  return 1 + (c.duplicates || 0);
}

/** Copias de más disponibles para intercambiar. */
export function tradeableSpareFromRecord(c) {
  const total = totalCopiesFromRecord(c);
  return total > 1 ? total - 1 : 0;
}

/** @param {number} qty Total deseado (0–9). */
export function collectionFieldsForTotal(qty) {
  const total = Math.max(0, Math.min(qty, MAX_ALBUM_COPIES));
  if (total <= 0) return { owned: false, duplicates: 0 };
  return { owned: true, duplicates: total - 1 };
}

/** Normaliza sin perder datos — ya no capa. */
export function normalizeCollectionRow(row) {
  if (!row) return { owned: false, duplicates: 0 };
  const duplicates = row.duplicates || 0;
  const owned = Boolean(row.owned) || duplicates > 0;
  return { owned, duplicates };
}

/** Combina fila local y remota (conserva el mayor total de copias). */
export function mergeCollectionRows(local, remote) {
  const l = normalizeCollectionRow(local);
  const r = normalizeCollectionRow(remote);
  const total = Math.max(totalCopiesFromRecord(l), totalCopiesFromRecord(r));
  return collectionFieldsForTotal(total);
}

/** @param {object | undefined} sticker */
export function stickerKindMark(sticker) {
  if (!sticker) return "";
  if (sticker.sticker_kind === "escudo") return "🛡️";
  if (sticker.sticker_kind === "foto_equipo") return "📷";
  if (sticker.sticker_kind === "fwc") return "🏆";
  if (sticker.sticker_kind === "coca_cola") return "🥤";
  return "";
}

/** @param {object} sticker */
export function stickerKindTitle(sticker) {
  if (!sticker) return "";
  if (sticker.sticker_kind === "escudo") return "Escudo";
  if (sticker.sticker_kind === "foto_equipo") return "Foto equipo";
  if (sticker.sticker_kind === "fwc") return "FWC";
  if (sticker.sticker_kind === "coca_cola") return "Coca-Cola";
  return "";
}

/** ¿Es lámina especial? (escudo, foto equipo, FWC trophy, coca-cola) */
export function isSpecialSticker(sticker) {
  if (!sticker) return false;
  const k = sticker.sticker_kind;
  return k === "escudo" || k === "foto_equipo" || k === "fwc" || k === "coca_cola";
}

/**
 * Prioridad para ofrecer: más repetidas = más fácil ofrecer.
 * Retorna número alto = dar primero.
 */
export function givePriority(spareQty) {
  return spareQty;
}

/**
 * Prioridad para recibir: especiales valen más.
 * Retorna número alto = recibir primero.
 */
export function receivePriority(sticker, teFalta) {
  let score = 0;
  if (teFalta) score += 10;
  if (isSpecialSticker(sticker)) score += 5;
  return score;
}
