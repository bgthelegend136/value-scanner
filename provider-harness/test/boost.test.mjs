import assert from "node:assert/strict";
import test from "node:test";

import { analyzeBoost, classifyBoostEv, comboOverround } from "../src/boost.mjs";

test("derives boost multiplier and break-even margin from base and boosted odds", () => {
  const result = analyzeBoost({ baseOdds: 2.25, boostedOdds: 2.75 });
  assert.ok(Math.abs(result.multiplier - 2.75 / 2.25) < 1e-9);
  // A boost survives any base-market margin up to (multiplier - 1).
  assert.ok(Math.abs(result.breakEvenMargin - (2.75 / 2.25 - 1)) < 1e-9);
  assert.equal(result.ev, undefined); // no overround supplied -> no EV claim
  assert.equal(result.verdict, undefined);
});

test("EV is strongly positive when the boost beats the assumed market margin", () => {
  // Single 1X2 (~5% overround): a 22% boost is real value.
  const result = analyzeBoost({ baseOdds: 2.25, boostedOdds: 2.75, overround: 0.05 });
  assert.ok(Math.abs(result.ev - ((2.75 / 2.25) / 1.05 - 1)) < 1e-9);
  assert.ok(result.ev > 0.05);
  assert.equal(result.verdict, "STRONG_VALUE");
  // Boosted odds must clear the de-vigged fair price to be +EV.
  assert.ok(Math.abs(result.fairBoostOdds - 2.25 * 1.05) < 1e-9);
});

test("EV is negative when the market margin swallows the boost", () => {
  // Saves prop (~20% overround) with only an 8% boost: still a losing bet.
  const result = analyzeBoost({ baseOdds: 2.5, boostedOdds: 2.7, overround: 0.2 });
  assert.ok(result.ev < 0);
  assert.equal(result.verdict, "NEGATIVE");
});

test("classifies boost EV into strong, marginal, and negative", () => {
  assert.equal(classifyBoostEv(0.08), "STRONG_VALUE");
  assert.equal(classifyBoostEv(0.05), "STRONG_VALUE");
  assert.equal(classifyBoostEv(0.0), "MARGINAL");
  assert.equal(classifyBoostEv(0.03), "MARGINAL");
  assert.equal(classifyBoostEv(-0.01), "NEGATIVE");
});

test("combo overround compounds the per-leg margins", () => {
  assert.ok(Math.abs(comboOverround(0.07, 3) - ((1.07 ** 3) - 1)) < 1e-9);
  // Three soft legs blow past a 22% boost.
  assert.ok(comboOverround(0.07, 3) > 0.22);
  assert.ok(Math.abs(comboOverround(0.05, 1) - 0.05) < 1e-9);
});

test("rejects non-odds inputs and a negative overround", () => {
  assert.throws(() => analyzeBoost({ baseOdds: 1, boostedOdds: 2 }), /base odds/);
  assert.throws(() => analyzeBoost({ baseOdds: 2, boostedOdds: 0.5 }), /boosted odds/);
  assert.throws(
    () => analyzeBoost({ baseOdds: 2, boostedOdds: 2.5, overround: -0.1 }),
    /overround/,
  );
});
