import assert from "node:assert/strict";
import test from "node:test";

import { filterScannableSports, isPaperScannableSport } from "../src/scan_scope.mjs";

test("keeps sports with a free settlement source or a soft-book edge", () => {
  for (const key of [
    "soccer_fifa_world_cup",
    "soccer_epl",
    "soccer_conmebol_copa_libertadores",
    "americanfootball_nfl",
    "basketball_wnba",
    "baseball_mlb",
    "aussierules_afl",
  ]) {
    assert.equal(isPaperScannableSport(key), true, key);
  }
});

test("excludes sports with no free settlement and no edge", () => {
  for (const key of [
    "boxing_boxing",
    "mma_mixed_martial_arts",
    "cricket_t20_blast",
    "cricket_test_match",
    "baseball_kbo",
    "baseball_npb",
  ]) {
    assert.equal(isPaperScannableSport(key), false, key);
  }
});

test("filterScannableSports drops only the excluded keys, preserving order", () => {
  const input = ["soccer_epl", "boxing_boxing", "baseball_mlb", "cricket_t20_blast", "americanfootball_nfl"];
  assert.deepEqual(filterScannableSports(input), ["soccer_epl", "baseball_mlb", "americanfootball_nfl"]);
});
