import {
  collectionFieldsForTotal,
  mergeCollectionRows,
  normalizeCollectionRow,
  totalCopiesFromRecord,
} from "./collectionCopies.js";

const STORAGE_KEY = "panini_collection_v1";

/** Ignora claves inválidas del localStorage (basura o ids NaN). */
export function sanitizeLocalCollection(raw, validStickerIds = null) {
  const out = {};
  for (const [idStr, row] of Object.entries(raw || {})) {
    const stickerId = parseInt(idStr, 10);
    if (!Number.isFinite(stickerId) || stickerId <= 0) continue;
    if (validStickerIds && !validStickerIds.has(stickerId)) continue;
    out[stickerId] = normalizeCollectionRow(row);
  }
  return out;
}

export function loadLocalCollection() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

export function saveLocalCollection(collection) {
  const out = {};
  for (const [id, row] of Object.entries(collection || {})) {
    const stickerId = parseInt(id, 10);
    if (!Number.isFinite(stickerId) || stickerId <= 0) continue;
    out[stickerId] = normalizeCollectionRow(row);
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(out));
}

export function clearLocalCollection() {
  localStorage.removeItem(STORAGE_KEY);
}

/** Sube filas con owned o repetidas > 0; no borra localStorage */
export async function syncCollectionToRemote(supabase, userId, collection) {
  const upserts = [];
  for (const [idStr, row] of Object.entries(collection || {})) {
    if (!row?.owned && !(row?.duplicates > 0)) continue;
    upserts.push({
      user_id: userId,
      sticker_id: parseInt(idStr, 10),
      owned: Boolean(row.owned),
      duplicates: row.duplicates || 0,
    });
  }
  if (!upserts.length) return { error: null };

  const chunkSize = 200;
  for (let i = 0; i < upserts.length; i += chunkSize) {
    const { error } = await supabase
      .from("user_stickers")
      .upsert(upserts.slice(i, i + chunkSize), { onConflict: "user_id,sticker_id" });
    if (error) return { error };
  }
  return { error: null };
}

/** Fusiona colección local + remota y sube el resultado; mantiene copia local */
export async function syncLocalToRemote(supabase, userId, local, remoteRows) {
  const remoteBySticker = {};
  for (const row of remoteRows || []) {
    remoteBySticker[row.sticker_id] = row;
  }

  const merged = {};
  for (const [idStr, localRow] of Object.entries(local || {})) {
    const stickerId = parseInt(idStr, 10);
    merged[stickerId] = mergeCollectionRows(localRow, remoteBySticker[stickerId]);
  }
  for (const row of remoteRows || []) {
    if (!merged[row.sticker_id]) {
      merged[row.sticker_id] = mergeCollectionRows(null, row);
    }
  }

  const { error } = await syncCollectionToRemote(supabase, userId, merged);
  if (!error) saveLocalCollection(merged);
  return { error, merged };
}
