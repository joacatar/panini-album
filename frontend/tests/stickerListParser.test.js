import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCatalogIndex,
  parseStickerList,
  detectImportMode,
  normalizeStickerListText,
  summarizeParseResult,
} from "../src/lib/stickerListParser.js";

const mockStickers = [
  { id: 1, code: "MEX15", team_code: "MEX", team_slot: 15, number: 35 },
  { id: 2, code: "MEX19", team_code: "MEX", team_slot: 19, number: 39 },
  { id: 3, code: "ECU4", team_code: "ECU", team_slot: 4, number: 84 },
  { id: 4, code: "ECU8", team_code: "ECU", team_slot: 8, number: 88 },
  { id: 5, code: "ECU10", team_code: "ECU", team_slot: 10, number: 90 },
  { id: 6, code: "COC1", team_code: "COC", team_slot: 1, number: 981 },
  { id: 11, code: "COC2", team_code: "COC", team_slot: 2, number: 982 },
  { id: 12, code: "COC3", team_code: "COC", team_slot: 3, number: 983 },
  { id: 7, code: "FWC3", team_code: "FWC", team_slot: 3, number: 3 },
  { id: 8, code: "FWC7", team_code: "FWC", team_slot: 7, number: 7 },
  { id: 9, code: "FWC12", team_code: "FWC", team_slot: 12, number: 12 },
  { id: 10, code: "COC12", team_code: "COC", team_slot: 12, number: 992 },
];

const catalog = buildCatalogIndex(mockStickers);

test("detects missing mode", () => {
  assert.equal(detectImportMode("Missing stickers"), "missing");
  assert.equal(detectImportMode("Estas son las que tengo"), "owned");
});

test("parses classic missing list", () => {
  const r = parseStickerList("Missing stickers\nMEX 15, 19\nECU 4, 8, 10", catalog, { mode: "missing" });
  assert.equal(r.matched.length, 5);
  assert.deepEqual(
    r.matched.map((m) => `${m.teamCode}${m.slot}`),
    ["MEX15", "MEX19", "ECU4", "ECU8", "ECU10"]
  );
});

test("parses glued codes and flags", () => {
  const r = parseStickerList("🇲🇽 15 19 ECU4 ECU8x2", catalog, { mode: "missing" });
  assert.equal(r.matched.length, 4);
  const mex19 = r.matched.find((m) => m.teamCode === "MEX" && m.slot === 19);
  assert.ok(mex19);
  const ecu8 = r.matched.find((m) => m.teamCode === "ECU" && m.slot === 8);
  assert.equal(ecu8?.qty, 2);
});

test("parses coca cola section", () => {
  const r = parseStickerList("COC 1, 3, 12", catalog, { mode: "owned" });
  assert.equal(r.matched.length, 3);
  assert.ok(r.matched.every((m) => m.teamCode === "COC"));
});

test("parses CC code from Panini app as Coca-Cola", () => {
  const r = parseStickerList("CC 1, 2\nCC3 CC12", catalog, { mode: "owned" });
  assert.equal(r.matched.length, 4);
  assert.ok(r.matched.every((m) => m.teamCode === "COC"));
  assert.deepEqual(
    r.matched.map((m) => m.slot).sort((a, b) => a - b),
    [1, 2, 3, 12]
  );
});

test("parses FWC on its own line then numbers", () => {
  const r = parseStickerList("FWC\n3, 5, 7\nMEX 15", catalog, { mode: "missing" });
  assert.ok(r.matched.some((m) => m.teamCode === "FWC" && m.slot === 3));
  assert.ok(r.matched.some((m) => m.teamCode === "FWC" && m.slot === 7));
  assert.ok(r.matched.some((m) => m.teamCode === "MEX" && m.slot === 15));
});

test("parses glued FWC and trophy emoji", () => {
  const r = parseStickerList("FWC3 FWC12 🏆 7", catalog, { mode: "missing" });
  assert.equal(r.matched.filter((m) => m.teamCode === "FWC").length, 3);
});

test("summarize lists FWC before teams", () => {
  const r = parseStickerList("MEX 15\nFWC 3", catalog, { mode: "missing" });
  const summary = summarizeParseResult(r);
  assert.ok(summary.indexOf("FWC") < summary.indexOf("MEX"));
});

test("parses global hash numbers", () => {
  const r = parseStickerList("#3", catalog, { mode: "owned" });
  assert.equal(r.matched.length, 1);
  assert.equal(r.matched[0].teamCode, "FWC");
});

test("normalize collapses separators", () => {
  assert.equal(normalizeStickerListText("MEX 15; 19 / ECU 4"), "MEX 15 19 ECU 4");
});
