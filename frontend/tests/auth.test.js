import test from "node:test";
import assert from "node:assert/strict";
import { hasAuthTokensInHash, humanizeAuthError } from "../src/lib/auth.js";

test("hasAuthTokensInHash detects magic link hash", () => {
  assert.equal(
    hasAuthTokensInHash("#access_token=abc&type=magiclink"),
    true
  );
  assert.equal(hasAuthTokensInHash("#intercambiar"), false);
  assert.equal(hasAuthTokensInHash("#error=access_denied"), true);
});

test("humanizeAuthError explains expired magic link", () => {
  assert.match(
    humanizeAuthError("Email link is invalid or has expired"),
    /solo sirve una vez/
  );
});

test("humanizeAuthError explains disabled Google provider", () => {
  assert.match(
    humanizeAuthError("Unsupported provider: provider is not enabled"),
    /Google aún no está activado/
  );
});
