import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { normalizeTheOddsResponse } from "../src/theodds_normalize.mjs";

const fixture = JSON.parse(
  await readFile(new URL("./fixtures/theodds-odds-response.json", import.meta.url), "utf8"),
);
const receivedAt = "2026-06-24T12:00:05.000Z";

test("maps h2h to 1X2 with correct draw mapping", () => {
  const rows = normalizeTheOddsResponse(fixture, receivedAt);
  const draw = rows.find((r) => r.market === "MATCH_RESULT" && r.outcome === "X");
  assert.deepEqual(draw, {
    provider: "the-odds-api",
    bookmaker: "pinnacle",
    eventId: "evt_spain_cv",
    competition: "FIFA World Cup",
    kickoffUtc: "2026-06-25T18:00:00.000Z",
    homeTeam: "Spain",
    awayTeam: "Cape Verde",
    period: "FULL_TIME",
    market: "MATCH_RESULT",
    line: "",
    outcome: "X",
    decimalOdds: 6.2,
    quoteUpdatedAt: "2026-06-24T12:00:00.000Z",
    receivedAt,
    regionalStatus: "UNVERIFIED",
  });
  assert.equal(rows.find((r) => r.market === "MATCH_RESULT" && r.outcome === "1").decimalOdds, 1.3);
  assert.equal(rows.find((r) => r.market === "MATCH_RESULT" && r.outcome === "2").decimalOdds, 11);
});

test("maps totals with exact line and ignores unsupported markets", () => {
  const rows = normalizeTheOddsResponse(fixture, receivedAt);
  const under = rows.find((r) => r.market === "TOTALS" && r.outcome === "UNDER");
  assert.equal(under.line, "2.5");
  assert.equal(under.decimalOdds, 1.95);
  assert.equal(rows.some((r) => r.market === "SPREADS" || r.line === "-1.5"), false);
});
