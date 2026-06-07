import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  collectionFieldsForTotal,
  isSpecialSticker,
  MAX_ALBUM_COPIES,
  mergeCollectionRows,
  normalizeCollectionRow,
  totalCopiesFromRecord,
  tradeableSpareFromRecord,
} from "../src/lib/collectionCopies.js";

describe("collectionCopies", () => {
  it("tracks up to 9 copies", () => {
    assert.equal(MAX_ALBUM_COPIES, 9);
    assert.equal(totalCopiesFromRecord({ owned: true, duplicates: 5 }), 6);
    assert.equal(tradeableSpareFromRecord({ owned: true, duplicates: 5 }), 5);
    assert.equal(tradeableSpareFromRecord({ owned: true, duplicates: 0 }), 0);
  });

  it("maps totals to storage fields", () => {
    assert.deepEqual(collectionFieldsForTotal(0), { owned: false, duplicates: 0 });
    assert.deepEqual(collectionFieldsForTotal(1), { owned: true, duplicates: 0 });
    assert.deepEqual(collectionFieldsForTotal(5), { owned: true, duplicates: 4 });
    assert.deepEqual(collectionFieldsForTotal(9), { owned: true, duplicates: 8 });
    assert.deepEqual(collectionFieldsForTotal(12), { owned: true, duplicates: 8 });
  });

  it("normalizes owned when duplicates exist", () => {
    assert.deepEqual(normalizeCollectionRow({ owned: false, duplicates: 2 }), {
      owned: true,
      duplicates: 2,
    });
    assert.deepEqual(mergeCollectionRows({ owned: true, duplicates: 1 }, { owned: true, duplicates: 3 }), {
      owned: true,
      duplicates: 3,
    });
    assert.deepEqual(mergeCollectionRows({ owned: true, duplicates: 0 }, { owned: false, duplicates: 0 }), {
      owned: true,
      duplicates: 0,
    });
  });

  it("identifies special stickers", () => {
    assert.equal(isSpecialSticker({ sticker_kind: "escudo" }), true);
    assert.equal(isSpecialSticker({ sticker_kind: "foto_equipo" }), true);
    assert.equal(isSpecialSticker({ sticker_kind: "jugador" }), false);
    assert.equal(isSpecialSticker(null), false);
  });
});
