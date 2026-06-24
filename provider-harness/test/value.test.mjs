import assert from "node:assert/strict";
import test from "node:test";

import { buildReasons, classifyEv, consensusFairProbabilities, devig, findValueBets } from "../src/value.mjs";

const reference = [
  { market: "MATCH_RESULT", line: "", outcome: "1", decimalOdds: 1.30 },
  { market: "MATCH_RESULT", line: "", outcome: "X", decimalOdds: 6.20 },
  { market: "MATCH_RESULT", line: "", outcome: "2", decimalOdds: 11.0 },
  { market: "TOTALS", line: "2.5", outcome: "OVER", decimalOdds: 1.90 },
  { market: "TOTALS", line: "2.5", outcome: "UNDER", decimalOdds: 1.95 },
];

test("de-vig fair probabilities sum to 1 per market group", () => {
  const fair = devig(reference);
  const mr = ["1", "X", "2"].reduce((sum, o) => sum + fair.get(`MATCH_RESULT||${o}`), 0);
  const totals = ["OVER", "UNDER"].reduce((sum, o) => sum + fair.get(`TOTALS|2.5|${o}`), 0);
  assert.ok(Math.abs(mr - 1) < 1e-9);
  assert.ok(Math.abs(totals - 1) < 1e-9);
});

test("classifies EV tiers by magnitude", () => {
  assert.equal(classifyEv(0.04), "VALUE");
  assert.equal(classifyEv(0.10), "VALUE_CHECK");
  assert.equal(classifyEv(0.20), "SUSPICIOUS");
});

test("flags value above threshold, reports NO_REFERENCE when unmatched", () => {
  const bettable = [
    { bookmaker: "Stoiximan", market: "MATCH_RESULT", line: "", outcome: "X", decimalOdds: 7.50 },
    { bookmaker: "Superbet", market: "TOTALS", line: "3.5", outcome: "OVER", decimalOdds: 2.40 },
  ];
  const results = findValueBets(bettable, reference, { threshold: 0.03 });
  const draw = results.find((r) => r.outcome === "X");
  assert.equal(draw.status, "SUSPICIOUS");
  assert.ok(draw.ev > 0.15);
  assert.ok(draw.fairOdds > 6 && draw.fairOdds < 7);
  const over35 = results.find((r) => r.line === "3.5");
  assert.equal(over35.status, "NO_REFERENCE");
});

test("builds data-grounded reasons only", () => {
  const bet = { bookmaker: "Stoiximan", market: "MATCH_RESULT", line: "", outcome: "X", decimalOdds: 7.5, ev: 0.186, fairProbability: 0.1581, fairOdds: 6.33, status: "SUSPICIOUS" };
  const reasons = buildReasons(bet);
  assert.match(reasons[0], /EV \+18\.6%/);
  assert.match(reasons.join("\n"), /fair 6\.33/);
  assert.match(reasons.join("\n"), /high EV/i);
});

test("consensus averages per-book de-vig and counts the books", () => {
  const multiBook = [
    { bookmaker: "pinnacle", market: "MATCH_RESULT", line: "", outcome: "1", decimalOdds: 2.0 },
    { bookmaker: "pinnacle", market: "MATCH_RESULT", line: "", outcome: "X", decimalOdds: 3.5 },
    { bookmaker: "pinnacle", market: "MATCH_RESULT", line: "", outcome: "2", decimalOdds: 4.0 },
    { bookmaker: "betsson", market: "MATCH_RESULT", line: "", outcome: "1", decimalOdds: 1.95 },
    { bookmaker: "betsson", market: "MATCH_RESULT", line: "", outcome: "X", decimalOdds: 3.6 },
    { bookmaker: "betsson", market: "MATCH_RESULT", line: "", outcome: "2", decimalOdds: 4.2 },
  ];
  const consensus = consensusFairProbabilities(multiBook);
  const home = consensus.get("MATCH_RESULT||1");
  assert.equal(home.books, 2);
  assert.ok(home.fairProbability > 0.47 && home.fairProbability < 0.52);
  // averaged distribution still sums to 1 across the outcomes
  const sum = ["1", "X", "2"].reduce((s, o) => s + consensus.get(`MATCH_RESULT||${o}`).fairProbability, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9);
});
