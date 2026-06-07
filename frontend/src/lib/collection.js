import {
  collectionFieldsForTotal,
  mergeCollectionRows,
  normalizeCollectionRow,
  totalCopiesFromRecord,
} from "./collectionCopies.js";

export const COLLECTION_STORAGE_KEY = "panini_collection_v1";
const STORAGE_KEY = COLLECTION_STORAGE_KEY;
const MAX_STORAGE_BYTES = 2_000_000;

/** Solo persiste láminas con al menos una copia — ahorra espacio y evita QuotaExceeded. */
export function compactCollectionForStorage(collection) {
  const out = {};
  for (const [idStr, row] of Object.entries(collection || {})) {
    const stickerId = parseInt(idStr, 10);
    if (!Number.isFinite(stickerId) || stickerId <= 0) continue;
    const normalized = normalizeCollectionRow(row);
    if (!normalized.owned && !(normalized.duplicates > 0)) continue;
    out[stickerId] = normalized;
  }
  return out;
}

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

export function loadLocalCollectionRaw() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function loadLocalCollection() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

/**
 * Carga segura: detecta JSON corrupto o demasiado grande.
 * @returns {{ raw: object, repaired: boolean, dropped: boolean, error: string | null }}
 */
export function loadLocalCollectionSafe() {
  let rawText = null;
  try {
    rawText = localStorage.getItem(STORAGE_KEY);
  } catch (err) {
    return { raw: {}, repaired: false, dropped: true, error: err.message };
  }

  if (!rawText) return { raw: {}, repaired: false, dropped: false, error: null };

  if (rawText.length > MAX_STORAGE_BYTES) {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    return {
      raw: {},
      repaired: false,
      dropped: true,
      error: "El álbum local era demasiado grande y se reinició en este dispositivo.",
    };
  }

  try {
    const parsed = JSON.parse(rawText);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      localStorage.removeItem(STORAGE_KEY);
      return {
        raw: {},
        repaired: true,
        dropped: false,
        error: "Datos del álbum local corruptos — se limpiaron.",
      };
    }
    return { raw: parsed, repaired: false, dropped: false, error: null };
  } catch {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    return {
      raw: {},
      repaired: true,
      dropped: false,
      error: "No se pudo leer el álbum guardado — se limpiaron datos locales.",
    };
  }
}

export function saveLocalCollection(collection) {
  const out = compactCollectionForStorage(collection);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(out));
    return { error: null };
  } catch (err) {
    try {
      const minimal = {};
      for (const [id, row] of Object.entries(out)) {
        if (totalCopiesFromRecord(row) > 0) minimal[id] = row;
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(minimal));
      return { error: null, compacted: true };
    } catch (err2) {
      return { error: err2.message || err.message };
    }
  }
}

export function clearLocalCollection() {
  localStorage.removeItem(STORAGE_KEY);
}

/** Sube filas con owned o repetidas > 0; no borra localStorage */
export async function syncCollectionToRemote(supabase, userId, collection) {
  const upserts = [];
  for (const [idStr, row] of Object.entries(compactCollectionForStorage(collection) || {})) {
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
