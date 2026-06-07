import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  compactCollectionForStorage,
  loadLocalCollectionSafe,
  sanitizeLocalCollection,
} from "../src/lib/collection.js";

describe("collection storage", () => {
  it("drops empty rows when compacting", () => {
    const compact = compactCollectionForStorage({
      1: { owned: true, duplicates: 0 },
      2: { owned: false, duplicates: 0 },
      3: { owned: true, duplicates: 2 },
    });
    assert.deepEqual(compact, {
      1: { owned: true, duplicates: 0 },
      3: { owned: true, duplicates: 2 },
    });
  });

  it("reports corrupt JSON as repaired", () => {
    const storage = new Map();
    const original = globalThis.localStorage;
    globalThis.localStorage = {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    };
    try {
      storage.set("panini_collection_v1", "{not json");
      const result = loadLocalCollectionSafe();
      assert.deepEqual(result.raw, {});
      assert.ok(result.error);
      assert.equal(result.repaired, true);
      assert.equal(storage.has("panini_collection_v1"), false);
    } finally {
      globalThis.localStorage = original;
    }
  });

  it("sanitizes invalid sticker ids", () => {
    const out = sanitizeLocalCollection({ abc: { owned: true }, 5: { owned: true, duplicates: 1 } });
    assert.deepEqual(out, { 5: { owned: true, duplicates: 1 } });
  });
});
