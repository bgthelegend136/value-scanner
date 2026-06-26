import assert from "node:assert/strict";
import test from "node:test";

import { analyzeBoostMix, parseMixLeg, priceMixLeg } from "../src/boost_mix.mjs";

const NOW = new Date("2026-06-26T01:35:00Z");
const FRESH = "2026-06-26T01:32:00Z";
const BOOKS = ["pinnacle", "betsson", "unibet", "williamhill"];

function bttsRows(book) {
  return [
    { eventId: "E", bookmaker: book, market: "BTTS", line: "", outcome: "YES", decimalOdds: 1.8, quoteUpdatedAt: FRESH },
    { eventId: "E", bookmaker: book, market: "BTTS", line: "", outcome: "NO", decimalOdds: 2.0, quoteUpdatedAt: FRESH },
  ];
}

function h2hRows(book) {
  return [
    { eventId: "E", bookmaker: book, market: "MATCH_RESULT", line: "", outcome: "1", decimalOdds: 3.4, quoteUpdatedAt: FRESH },
    { eventId: "E", bookmaker: book, market: "MATCH_RESULT", line: "", outcome: "X", decimalOdds: 4.0, quoteUpdatedAt: FRESH },
    { eventId: "E", bookmaker: book, market: "MATCH_RESULT", line: "", outcome: "2", decimalOdds: 2.05, quoteUpdatedAt: FRESH },
  ];
}

function playerRows(book) {
  return [
    { eventId: "E", bookmaker: book, market: "PLAYER_GOALSCORER", line: "Ricardo Pepi", outcome: "YES", decimalOdds: 2.75, quoteUpdatedAt: FRESH },
  ];
}

test("parseMixLeg recognizes verified and estimate-capable exotic tokens", () => {
  assert.deepEqual(parseMixLeg("BTTS_YES"), { market: "BTTS", line: "", outcome: "YES", estimateMarket: "btts" });
  assert.deepEqual(parseMixLeg("TEAM:USA:O1.5"), { market: "TEAM_TOTALS", line: "USA|1.5", outcome: "OVER", estimateMarket: "team-total" });
  assert.deepEqual(parseMixLeg("CORNERS:O9.5"), { market: "CORNERS_TOTALS", line: "9.5", outcome: "OVER", estimateMarket: "corners" });
  assert.deepEqual(parseMixLeg("PLAYER:Ricardo Pepi:GOAL"), {
    market: "PLAYER_GOALSCORER",
    line: "Ricardo Pepi",
    outcome: "YES",
    estimateMarket: "player",
  });
  assert.equal(parseMixLeg("FOULS:O25.5"), null);
});

test("prices a fully verified two-leg boost from Pinnacle and consensus", () => {
  const selections = BOOKS.flatMap(bttsRows);
  const leg = priceMixLeg(selections, "E", parseMixLeg("BTTS_YES"), { now: NOW });

  assert.equal(leg.status, "VERIFIED");
  assert.ok(leg.pinnacleFairProbability > 0);
  assert.ok(leg.consensusFairProbability > 0);
  assert.equal(leg.consensusBooks, 3);

  const combo = analyzeBoostMix({ boostedOdds: 1.9, legResults: [leg, leg] });
  assert.equal(combo.status, "FULLY_VERIFIED");
  assert.ok(Number.isFinite(combo.pinnacleEv));
  assert.equal(combo.estimatedEv, undefined);
});

test("one-sided player markets are estimate-only even with API odds", () => {
  const selections = BOOKS.flatMap(playerRows);
  const leg = priceMixLeg(selections, "E", parseMixLeg("PLAYER:Ricardo Pepi:GOAL"), { now: NOW });

  assert.equal(leg.status, "ESTIMATE_ONLY");
  assert.match(leg.reason, /ONE_SIDED|ESTIMATE/);
  assert.ok(leg.estimateProbability > 0);

  const verified = priceMixLeg(BOOKS.flatMap(bttsRows), "E", parseMixLeg("BTTS_YES"), { now: NOW });
  const combo = analyzeBoostMix({ boostedOdds: 3.5, legResults: [verified, leg] });
  assert.equal(combo.status, "MIXED_ESTIMATE");
  assert.equal(combo.pinnacleEv, undefined);
  assert.ok(Number.isFinite(combo.estimatedEv));
});

test("double chance is verified from the de-vigged 1X2 market", () => {
  const selections = BOOKS.flatMap(h2hRows);
  const leg = priceMixLeg(selections, "E", parseMixLeg("1X"), { now: NOW });

  assert.equal(leg.status, "VERIFIED");
  assert.ok(leg.pinnacleFairProbability > 0.4);
  assert.equal(leg.consensusBooks, 3);
});

test("unsupported or missing-reference legs make the combo unverifiable", () => {
  const unsupported = priceMixLeg([], "E", null, { now: NOW });
  assert.equal(unsupported.status, "UNVERIFIABLE");
  assert.equal(unsupported.reason, "UNSUPPORTED_LEG");

  const missing = priceMixLeg([], "E", parseMixLeg("BTTS_YES"), { now: NOW });
  assert.equal(missing.status, "UNVERIFIABLE");
  assert.equal(analyzeBoostMix({ boostedOdds: 2.5, legResults: [missing] }).status, "UNVERIFIABLE");
});
