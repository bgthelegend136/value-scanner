import assert from "node:assert/strict";
import test from "node:test";

import { kellyStake } from "../src/staking.mjs";

test("full Kelly fraction is edge / (odds - 1)", () => {
  // edge +20% at odds 2.40 -> f* = 0.20 / 1.40 = 0.142857...
  assert.ok(Math.abs(kellyStake({ offeredOdds: 2.4, edge: 0.2, fraction: 1, cap: 1 }) - 0.2 / 1.4) < 1e-9);
});

test("applies the Kelly fraction below the cap", () => {
  // edge +5% at odds 3.0 -> f* = 0.05 / 2.0 = 0.025; quarter Kelly = 0.00625
  const stake = kellyStake({ offeredOdds: 3.0, edge: 0.05, fraction: 0.25, cap: 0.02 });
  assert.ok(Math.abs(stake - 0.00625) < 1e-9);
});

test("caps the stake at the bankroll cap", () => {
  // edge +20% at odds 2.40 -> quarter Kelly = 0.0357 -> capped to 0.02
  const stake = kellyStake({ offeredOdds: 2.4, edge: 0.2, fraction: 0.25, cap: 0.02 });
  assert.equal(stake, 0.02);
});

test("stakes nothing on a non-positive edge", () => {
  assert.equal(kellyStake({ offeredOdds: 2.4, edge: 0, fraction: 0.25, cap: 0.02 }), 0);
  assert.equal(kellyStake({ offeredOdds: 2.4, edge: -0.1, fraction: 0.25, cap: 0.02 }), 0);
});

test("stakes nothing when odds carry no payout (<= 1)", () => {
  assert.equal(kellyStake({ offeredOdds: 1, edge: 0.2, fraction: 0.25, cap: 0.02 }), 0);
});
