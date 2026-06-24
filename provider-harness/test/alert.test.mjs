import assert from "node:assert/strict";
import test from "node:test";

import { formatAlert } from "../src/alert.mjs";

test("formats an alert block with market label, EV, reasons and risk", () => {
  const bet = {
    bookmaker: "Stoiximan", market: "MATCH_RESULT", line: "", outcome: "X",
    decimalOdds: 7.5, ev: 0.103, fairProbability: 0.147, fairOdds: 6.8, status: "VALUE_CHECK",
  };
  const text = formatAlert(bet, { fixture: { homeTeam: "Spain", awayTeam: "Cape Verde" } });
  assert.match(text, /^ALERT:/);
  assert.match(text, /Match: Spain - Cape Verde/);
  assert.match(text, /Market: Draw/);
  assert.match(text, /Offered odd: 7\.50/);
  assert.match(text, /EV: \+10\.3%/);
  assert.match(text, /Reasons:/);
  assert.match(text, /Risk:/);
  assert.match(text, /Verify official lineup/);
});

test("labels totals markets with side and line", () => {
  const bet = {
    bookmaker: "Superbet", market: "TOTALS", line: "2.5", outcome: "UNDER",
    decimalOdds: 1.95, ev: 0.04, fairProbability: 0.53, fairOdds: 1.89, status: "VALUE",
  };
  const text = formatAlert(bet, { fixture: { homeTeam: "Spain", awayTeam: "Cape Verde" } });
  assert.match(text, /Market: UNDER 2\.5/);
});
