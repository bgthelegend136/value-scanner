import assert from "node:assert/strict";
import test from "node:test";

import { parseLegPick, legFairProbabilities } from "../src/boost_legs.mjs";
import { devigPower } from "../src/value.mjs";

const NOW = new Date("2026-06-26T18:27:00Z");
const FRESH = "2026-06-26T18:25:00Z";

function h2hRows(book) {
  return [
    { eventId: "E", bookmaker: book, market: "MATCH_RESULT", line: "", outcome: "1", decimalOdds: 2.0, quoteUpdatedAt: FRESH },
    { eventId: "E", bookmaker: book, market: "MATCH_RESULT", line: "", outcome: "X", decimalOdds: 3.5, quoteUpdatedAt: FRESH },
    { eventId: "E", bookmaker: book, market: "MATCH_RESULT", line: "", outcome: "2", decimalOdds: 3.8, quoteUpdatedAt: FRESH },
  ];
}
function totalsRows(book) {
  return [
    { eventId: "E", bookmaker: book, market: "TOTALS", line: "2.5", outcome: "OVER", decimalOdds: 1.90, quoteUpdatedAt: FRESH },
    { eventId: "E", bookmaker: book, market: "TOTALS", line: "2.5", outcome: "UNDER", decimalOdds: 1.90, quoteUpdatedAt: FRESH },
  ];
}
const BOOKS = ["pinnacle", "betsson", "unibet", "williamhill"];
const selections = (rowFn) => BOOKS.flatMap(rowFn);

test("parseLegPick recognizes match result, double chance, and totals", () => {
  assert.deepEqual(parseLegPick("1"), { market: "MATCH_RESULT", outcome: "1", line: "" });
  assert.deepEqual(parseLegPick("x2"), { market: "DOUBLE_CHANCE", outcome: "X2", line: "" });
  assert.deepEqual(parseLegPick("12"), { market: "DOUBLE_CHANCE", outcome: "12", line: "" });
  assert.deepEqual(parseLegPick("O2.5"), { market: "TOTALS", outcome: "OVER", line: "2.5" });
  assert.deepEqual(parseLegPick("U1.5"), { market: "TOTALS", outcome: "UNDER", line: "1.5" });
  assert.equal(parseLegPick("BTTS"), null);
});

test("double chance fair prob equals the sum of its two 1X2 components", () => {
  const sel = selections(h2hRows);
  const fair = devigPower(h2hRows("pinnacle"));
  const expected = fair.get("MATCH_RESULT||X") + fair.get("MATCH_RESULT||2");
  const result = legFairProbabilities(sel, "E", parseLegPick("X2"), { now: NOW });
  assert.ok(Math.abs(result.pinnacleFairProbability - expected) < 1e-9);
  assert.ok(Math.abs(result.consensusFairProbability - expected) < 1e-9);
});

test("totals fair prob comes from the de-vigged over/under at the line", () => {
  const result = legFairProbabilities(selections(totalsRows), "E", parseLegPick("O2.5"), { now: NOW });
  // Symmetric 1.90/1.90 market de-vigs to 0.5 each.
  assert.ok(Math.abs(result.pinnacleFairProbability - 0.5) < 1e-9);
});

test("fails closed without Pinnacle or with thin consensus", () => {
  // Only Pinnacle present -> consensus < 3 books.
  const onlyPinnacle = h2hRows("pinnacle");
  assert.equal(
    legFairProbabilities(onlyPinnacle, "E", parseLegPick("1"), { now: NOW }).reason,
    "INSUFFICIENT_CONSENSUS",
  );
  // No Pinnacle row at all.
  const noPinnacle = ["betsson", "unibet", "williamhill"].flatMap(h2hRows);
  assert.equal(
    legFairProbabilities(noPinnacle, "E", parseLegPick("1"), { now: NOW }).reason,
    "NO_PINNACLE_MARKET",
  );
});

test("rejects a stale book market", () => {
  const stale = BOOKS.flatMap((book) =>
    h2hRows(book).map((row) => ({ ...row, quoteUpdatedAt: "2026-06-26T17:00:00Z" })));
  assert.equal(
    legFairProbabilities(stale, "E", parseLegPick("1"), { now: NOW }).reason,
    "NO_PINNACLE_MARKET",
  );
});
