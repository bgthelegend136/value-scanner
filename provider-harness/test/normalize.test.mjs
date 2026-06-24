import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { normalizeOddsResponse } from "../src/normalize.mjs";

const fixture = JSON.parse(
  await readFile(new URL("./fixtures/odds-response.json", import.meta.url), "utf8"),
);
const receivedAt = "2026-06-24T12:00:05.000Z";

test("normalizes supported full-time markets into canonical selections", () => {
  const rows = normalizeOddsResponse(fixture, receivedAt);

  assert.equal(rows.length, 15);
  assert.deepEqual(
    rows.find((row) => row.bookmaker === "Stoiximan" && row.market === "MATCH_RESULT" && row.outcome === "X"),
    {
      provider: "Odds-API.io",
      bookmaker: "Stoiximan",
      eventId: "123456",
      competition: "International",
      kickoffUtc: "2026-06-25T18:00:00.000Z",
      homeTeam: "Greece",
      awayTeam: "Italy",
      period: "FULL_TIME",
      market: "MATCH_RESULT",
      line: "",
      outcome: "X",
      decimalOdds: 3.25,
      quoteUpdatedAt: "2026-06-24T12:00:00.000Z",
      receivedAt,
      regionalStatus: "UNVERIFIED"
    },
  );
});

test("preserves exact total lines and maps double chance outcomes", () => {
  const rows = normalizeOddsResponse(fixture, receivedAt);
  const total = rows.find(
    (row) => row.bookmaker === "Superbet" && row.market === "TOTALS" && row.outcome === "UNDER",
  );
  assert.equal(total.line, "2.5");
  assert.equal(total.decimalOdds, 1.93);

  const doubleChance = rows
    .filter((row) => row.market === "DOUBLE_CHANCE")
    .map((row) => row.outcome)
    .sort();
  assert.deepEqual(doubleChance, ["12", "1X", "X2"]);
});

test("ignores non-full-time markets and does not invent Superbet Double Chance", () => {
  const rows = normalizeOddsResponse(fixture, receivedAt);
  assert.equal(rows.some((row) => row.market.includes("HT")), false);
  assert.equal(
    rows.some((row) => row.bookmaker === "Superbet" && row.market === "DOUBLE_CHANCE"),
    false,
  );
});
