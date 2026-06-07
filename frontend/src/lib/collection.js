import { mergeCollectionRows } from "./collectionCopies.js";

const STORAGE_KEY = "panini_collection_v1";

export function loadLocalCollection() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

export function saveLocalCollection(collection) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(collection));
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
