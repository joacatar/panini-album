import test from "node:test";
import assert from "node:assert/strict";
import { buildCocaColaStickers, mergeCatalogExtras } from "../src/lib/catalogExtras.js";

test("builds 12 Coca-Cola stickers", () => {
  const coc = buildCocaColaStickers();
  assert.equal(coc.length, 12);
  assert.equal(coc[0].code, "COC1");
  assert.equal(coc[11].code, "COC12");
  assert.equal(coc[0].team_page, 1);
  assert.equal(coc[6].team_page, 2);
});

test("mergeCatalogExtras adds COC when missing", () => {
  const base = [{ id: 1, team_code: "FWC", display_order: 0 }];
  const merged = mergeCatalogExtras(base);
  assert.ok(merged.some((s) => s.team_code === "COC"));
  assert.equal(mergeCatalogExtras(merged).length, merged.length);
});
