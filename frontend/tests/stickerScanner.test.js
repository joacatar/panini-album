import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildCatalogIndex } from "../src/lib/stickerListParser.js";
import { matchOcrText } from "../src/lib/stickerScanner.js";

const catalog = buildCatalogIndex([
  { id: 1, team_code: "MEX", team_slot: 15, code: "MEX15" },
  { id: 2, team_code: "AUT", team_slot: 5, code: "AUT5" },
  { id: 3, team_code: "FWC", team_slot: 3, code: "FWC3" },
  { id: 4, team_code: "COC", team_slot: 1, code: "COC1" },
]);

describe("matchOcrText", () => {
  it("parses clean OCR line", () => {
    const r = matchOcrText("MEX 15", catalog);
    assert.equal(r.match?.teamCode, "MEX");
    assert.equal(r.match?.slot, 15);
  });

  it("parses glued code", () => {
    const r = matchOcrText("AUT5", catalog);
    assert.equal(r.match?.teamCode, "AUT");
    assert.equal(r.match?.slot, 5);
  });

  it("maps CC to COC", () => {
    const r = matchOcrText("CC 1", catalog);
    assert.equal(r.match?.teamCode, "COC");
  });

  it("fixes O as zero in slot", () => {
    const r = matchOcrText("AUT O5", catalog);
    assert.equal(r.match?.teamCode, "AUT");
    assert.equal(r.match?.slot, 5);
  });
});
