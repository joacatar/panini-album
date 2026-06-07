import test from "node:test";
import assert from "node:assert/strict";
import {
  albumPageDividerLabel,
  albumPageLabel,
  albumPageNumbers,
  fwcAlbumPage,
  stickerAlbumPage,
  stickersOnAlbumPage,
} from "../src/lib/albumPages.js";

const fwcTeam = {
  team_code: "FWC",
  stickers: Array.from({ length: 20 }, (_, i) => ({
    team_code: "FWC",
    team_slot: i + 1,
    team_page: i < 10 ? 1 : 2,
  })),
};

const cocTeam = {
  team_code: "COC",
  stickers: Array.from({ length: 12 }, (_, i) => ({
    team_code: "COC",
    team_slot: i + 1,
  })),
};

test("FWC uses five album pages (2 apertura + 3 museo)", () => {
  assert.equal(fwcAlbumPage(4), 1);
  assert.equal(fwcAlbumPage(5), 2);
  assert.equal(fwcAlbumPage(8), 2);
  assert.equal(fwcAlbumPage(9), 3);
  assert.equal(fwcAlbumPage(17), 5);
  assert.deepEqual(albumPageNumbers(fwcTeam), [1, 2, 3, 4, 5]);
  assert.equal(stickersOnAlbumPage(fwcTeam, 1).length, 4);
  assert.equal(stickersOnAlbumPage(fwcTeam, 2).length, 4);
  assert.equal(stickersOnAlbumPage(fwcTeam, 5).length, 4);
  assert.match(albumPageLabel("FWC", 1), /Apertura/);
  assert.match(albumPageLabel("FWC", 3), /Museo FIFA/);
  assert.match(albumPageDividerLabel("FWC", 1), /inicio del álbum/);
  assert.match(albumPageDividerLabel("FWC", 4), /final del álbum/);
});

test("FWC ignores stale team_page from database", () => {
  assert.equal(stickerAlbumPage({ team_code: "FWC", team_slot: 15, team_page: 2 }), 4);
});

test("Coca-Cola uses pages of six", () => {
  assert.equal(stickerAlbumPage({ team_code: "COC", team_slot: 6 }), 1);
  assert.equal(stickerAlbumPage({ team_code: "COC", team_slot: 7 }), 2);
  assert.deepEqual(albumPageNumbers(cocTeam), [1, 2]);
  assert.equal(stickersOnAlbumPage(cocTeam, 1).length, 6);
  assert.equal(stickersOnAlbumPage(cocTeam, 2).length, 6);
});

test("national teams default to ten per page", () => {
  assert.equal(stickerAlbumPage({ team_code: "MEX", team_slot: 10 }), 1);
  assert.equal(stickerAlbumPage({ team_code: "MEX", team_slot: 11 }), 2);
});
