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

/** Fusiona colección local → remota al iniciar sesión */
export async function syncLocalToRemote(supabase, userId, local, remoteRows) {
  const remoteBySticker = {};
  for (const row of remoteRows || []) {
    remoteBySticker[row.sticker_id] = row;
  }
  const upserts = [];
  for (const [idStr, localRow] of Object.entries(local)) {
    const stickerId = parseInt(idStr, 10);
    const remote = remoteBySticker[stickerId];
    const owned = localRow.owned || remote?.owned || false;
    const duplicates = Math.max(localRow.duplicates || 0, remote?.duplicates || 0);
    if (owned || duplicates > 0) {
      upserts.push({
        user_id: userId,
        sticker_id: stickerId,
        owned,
        duplicates,
      });
    }
  }
  if (upserts.length) {
    await supabase.from("user_stickers").upsert(upserts, { onConflict: "user_id,sticker_id" });
  }
  clearLocalCollection();
}
