import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildCatalogIndex } from "../src/lib/stickerListParser.js";
import {
  buildSuggestedTrade,
  computeFlashTrade,
  computeMegaDuplicateSwap,
  computeOfferList,
  computeRequestList,
  computeTradeBreakdown,
  formatFlashDealText,
  mergeTradePools,
  parseTradeListToKeys,
  requestTier,
} from "../src/lib/flashTrade.js";

const stickers = [
  { id: 1, team_code: "MEX", team_slot: 15, number: 100, sticker_kind: "jugador" },
  { id: 2, team_code: "MEX", team_slot: 19, number: 101, sticker_kind: "jugador" },
  { id: 3, team_code: "ARG", team_slot: 10, number: 200, sticker_kind: "escudo" },
  { id: 4, team_code: "ECU", team_slot: 4, number: 300, sticker_kind: "jugador" },
  { id: 5, team_code: "ECU", team_slot: 8, number: 301, sticker_kind: "jugador" },
];

const catalog = buildCatalogIndex(stickers);

describe("requestTier", () => {
  it("excludes 3+ copies", () => {
    assert.equal(requestTier(3, stickers[0]), null);
  });

  it("prioritizes special with 0-2", () => {
    assert.equal(requestTier(0, stickers[2]), 1);
  });
});

describe("buildSuggestedTrade", () => {
  it("caps receive when friend has more than you can give", () => {
    const collection = {
      1: { owned: false, duplicates: 0 },
      2: { owned: true, duplicates: 1 },
      3: { owned: false, duplicates: 0 },
      4: { owned: true, duplicates: 2 },
      5: { owned: true, duplicates: 1 },
    };
    const offer = computeOfferList("ECU 4, ECU 8", catalog, collection);
    const request = computeRequestList("MEX 15, ARG 10, MEX 19", catalog, collection);
    const s = buildSuggestedTrade(offer, request);
    assert.equal(s.give.length, s.receive.length);
    assert.ok(s.receive.length <= request.length);
  });

  it("never includes unique stickers (×1) in offer", () => {
    const collection = {
      1: { owned: false, duplicates: 0 },
      2: { owned: true, duplicates: 0 },
      3: { owned: false, duplicates: 0 },
      4: { owned: true, duplicates: 0 },
      5: { owned: true, duplicates: 1 },
    };
    const offer = computeOfferList("MEX 19, ECU 4, ECU 8", catalog, collection);
    assert.equal(offer.length, 1);
    assert.equal(offer[0].key, "ECU:8");
  });
});

describe("computeFlashTrade", () => {
  it("suggested trade is balanced not full request list", () => {
    const collection = {
      1: { owned: false, duplicates: 0 },
      2: { owned: true, duplicates: 1 },
      3: { owned: false, duplicates: 0 },
      4: { owned: true, duplicates: 2 },
      5: { owned: true, duplicates: 1 },
    };
    const r = computeFlashTrade("MEX 15, ARG 10, MEX 19", "ECU 4, ECU 8", catalog, stickers, collection);
    assert.equal(r.iGive.length, r.iReceive.length);
    assert.ok(r.iReceive.length <= r.shouldRequest.length);
  });

  it("formats deal text", () => {
    const text = formatFlashDealText(
      [{ teamCode: "MEX", slot: 15, key: "MEX:15", sticker: stickers[0] }],
      [{ teamCode: "ECU", slot: 4, key: "ECU:4", sticker: stickers[3] }]
    );
    assert.match(text, /TE DOY/);
    assert.match(text, /TE PIDO/);
  });
});

describe("computeMegaDuplicateSwap", () => {
  it("pairs each mega with one requestable card", () => {
    const collection = {
      1: { owned: true, duplicates: 4 },
      2: { owned: true, duplicates: 0 },
      3: { owned: false, duplicates: 0 },
      4: { owned: true, duplicates: 0 },
      5: { owned: true, duplicates: 0 },
    };
    const swap = computeMegaDuplicateSwap(stickers, "MEX 15, ARG 10", catalog, collection);
    assert.equal(swap.give.length, 1);
    assert.equal(swap.receive.length, 1);
  });
});

describe("parseTradeListToKeys", () => {
  it("parses keys", () => {
    const keys = parseTradeListToKeys("MEX 15, 19", catalog, "duplicates");
    assert.deepEqual(keys, ["MEX:15", "MEX:19"]);
  });

  it("parses parenthesized qty format like 2(x1) 5(x2)", () => {
    const keys = parseTradeListToKeys("mex: 15(x1) 19(x2)", catalog, "duplicates");
    assert.deepEqual(keys, ["MEX:15", "MEX:19"]);
  });

  it("parses moovtech format like 4(1x) 10(3x)", () => {
    const keys = parseTradeListToKeys("MEX: 15(1x), 19(2x)", catalog, "duplicates");
    assert.deepEqual(keys, ["MEX:15", "MEX:19"]);
  });

  it("parses format with colon separator", () => {
    const keys = parseTradeListToKeys("ECU: 4 8", catalog, "duplicates");
    assert.deepEqual(keys, ["ECU:4", "ECU:8"]);
  });
});

describe("mergeTradePools", () => {
  it("dedupes", () => {
    const a = [{ teamCode: "MEX", slot: 15, key: "MEX:15", sticker: stickers[0] }];
    const b = [{ teamCode: "MEX", slot: 19, key: "MEX:19", sticker: stickers[1] }];
    assert.equal(mergeTradePools(a, b).length, 2);
  });
});

describe("priority picks", () => {
  it("boosts picks to tier 0 and sorts first", () => {
    const collection = {
      1: { owned: false, duplicates: 0 },
      2: { owned: true, duplicates: 0 },
      3: { owned: false, duplicates: 0 },
      4: { owned: true, duplicates: 1 },
      5: { owned: true, duplicates: 0 },
    };
    const request = computeRequestList(
      "MEX 15, ARG 10, MEX 19",
      catalog,
      collection,
      ["MEX:19"]
    );
    assert.ok(request[0].isPick);
    assert.equal(request[0].key, "MEX:19");
    const s = buildSuggestedTrade(
      computeOfferList("ECU 4, ECU 8", catalog, collection),
      request
    );
    assert.equal(s.receive[0].key, "MEX:19");
  });

  it("breakdown counts missing from friend dups", () => {
    const collection = {
      1: { owned: false, duplicates: 0 },
      2: { owned: true, duplicates: 0 },
      3: { owned: false, duplicates: 0 },
      4: { owned: true, duplicates: 1 },
      5: { owned: true, duplicates: 0 },
    };
    const r = computeFlashTrade("MEX 15, ARG 10, MEX 19", "ECU 4, ECU 8", catalog, stickers, collection);
    assert.equal(r.breakdown.friendDupsYouMissing, 2);
    assert.equal(r.breakdown.friendDupsYouCanAsk, r.shouldRequest.length);
  });
});
