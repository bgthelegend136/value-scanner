import assert from "node:assert/strict";
import test from "node:test";

import {
  settleMispricingAlerts,
  summarizeMispricingSettlements,
} from "../src/mispricing_settle.mjs";

const scoreEvents = [{
  id: "ref1",
  completed: true,
  home_team: "Norway",
  away_team: "France",
  scores: [
    { name: "Norway", score: "2" },
    { name: "France", score: "1" },
  ],
  last_update: "2026-06-26T21:00:00Z",
}];

function row(overrides = {}) {
  return {
    identity: "501|Stoiximan|MATCH_RESULT||1",
    referenceEventId: "ref1",
    sportKey: "soccer_fifa_world_cup",
    market: "MATCH_RESULT",
    line: "",
    outcome: "1",
    decimalOdds: "9.0500",
    status: "PENDING",
    homeScore: "",
    awayScore: "",
    profit: "",
    settledAt: "",
    ...overrides,
  };
}

test("settles live alert match-result rows against completed scores", () => {
  const settled = settleMispricingAlerts([
    row({ outcome: "1", decimalOdds: "9.0500" }),
    row({ identity: "502|Stoiximan|MATCH_RESULT||2", outcome: "2", decimalOdds: "17.5000" }),
    row({ identity: "503|Stoiximan|MATCH_RESULT||X", outcome: "X", decimalOdds: "6.0000" }),
  ], scoreEvents);

  assert.deepEqual(settled.map((item) => item.status), ["WON", "LOST", "LOST"]);
  assert.deepEqual(settled.map((item) => item.profit), ["8.0500", "-1.0000", "-1.0000"]);
  assert.deepEqual(settled.map((item) => item.homeScore), ["2", "2", "2"]);
  assert.deepEqual(settled.map((item) => item.awayScore), ["1", "1", "1"]);
});

test("summarizes live alert settlement ROI on one-unit stakes", () => {
  const summary = summarizeMispricingSettlements([
    row({ status: "WON", profit: "8.0500" }),
    row({ identity: "502", status: "LOST", profit: "-1.0000" }),
    row({ identity: "503", status: "PENDING", profit: "" }),
  ]);

  assert.deepEqual(summary, {
    total: 3,
    pending: 1,
    settled: 2,
    wins: 1,
    losses: 1,
    pushes: 0,
    review: 0,
    profit: 7.05,
    roi: 3.525,
  });
});
