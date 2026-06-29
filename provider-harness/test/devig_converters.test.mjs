import assert from "node:assert/strict";
import test from "node:test";

import { devig, devigFlGlm, devigOoEpc } from "../src/value.mjs";

// A 1X2 market with a ~5% overround.
const market = [
  { market: "MATCH_RESULT", line: "", outcome: "1", decimalOdds: 2.0 },
  { market: "MATCH_RESULT", line: "", outcome: "X", decimalOdds: 3.5 },
  { market: "MATCH_RESULT", line: "", outcome: "2", decimalOdds: 4.0 },
];

const sumOf = (map) => [...map.values()].reduce((sum, value) => sum + value, 0);
const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} !~= ${b}`);

test("OO-EPC probabilities sum to 1 and stay positive", () => {
  const fair = devigOoEpc(market);
  assert.equal(fair.size, 3);
  near(sumOf(fair), 1);
  for (const p of fair.values()) assert.ok(p > 0 && p < 1);
});

test("OO-EPC skips an incomplete market (booksum <= 1)", () => {
  const oneSided = [{ market: "MATCH_RESULT", line: "", outcome: "1", decimalOdds: 1.2 }];
  assert.equal(devigOoEpc(oneSided).size, 0);
});

test("OO-EPC falls back to multiplicative when an outcome would go non-positive", () => {
  // A large overround relative to a longshot (1X2 with a fat margin) makes the
  // SE step overshoot the longshot's implied probability, forcing the fallback.
  const tight = [
    { market: "MATCH_RESULT", line: "", outcome: "1", decimalOdds: 1.30 },
    { market: "MATCH_RESULT", line: "", outcome: "X", decimalOdds: 1.30 },
    { market: "MATCH_RESULT", line: "", outcome: "2", decimalOdds: 26.0 },
  ];
  const fair = devigOoEpc(tight);
  const mult = devig(tight);
  near(sumOf(fair), 1);
  for (const key of mult.keys()) near(fair.get(key), mult.get(key));
});

test("FL-GLM with beta=1 equals the multiplicative method", () => {
  const flglm = devigFlGlm(market, { beta: 1 });
  const mult = devig(market);
  for (const key of mult.keys()) near(flglm.get(key), mult.get(key));
});

test("FL-GLM with beta>1 shrinks the longshot's share and sums to 1", () => {
  const base = devigFlGlm(market, { beta: 1 });
  const adjusted = devigFlGlm(market, { beta: 1.3 });
  near(sumOf(adjusted), 1);
  // Outcome "2" is the longest shot -> its probability share should fall.
  assert.ok(adjusted.get("MATCH_RESULT||2") < base.get("MATCH_RESULT||2"));
  // The favourite "1" should gain share.
  assert.ok(adjusted.get("MATCH_RESULT||1") > base.get("MATCH_RESULT||1"));
});
