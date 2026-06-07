import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatDuplicatesShareText } from "../src/lib/shareDuplicatesCard.js";

describe("formatDuplicatesShareText", () => {
  it("lists slots without quantity multipliers", () => {
    const text = formatDuplicatesShareText(
      [
        {
          team_code: "MEX",
          flag: "🇲🇽",
          duplicates: [{ team_slot: 15 }, { team_slot: 19 }],
        },
      ],
      { total: 2 }
    );
    assert.match(text, /REPETIDAS/);
    assert.match(text, /MEX.*15, 19/s);
    assert.doesNotMatch(text, /×/);
    assert.doesNotMatch(text, /copias de más/);
  });
});
