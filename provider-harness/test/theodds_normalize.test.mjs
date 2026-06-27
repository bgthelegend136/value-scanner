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

test("maps event-level additional soccer markets into canonical selections", () => {
  const rows = normalizeTheOddsResponse([{
    id: "evt-extra",
    sport_title: "FIFA World Cup",
    commence_time: "2026-06-26T02:00:00Z",
    home_team: "Turkey",
    away_team: "USA",
    bookmakers: [{
      key: "pinnacle",
      last_update: "2026-06-26T01:32:00Z",
      markets: [
        {
          key: "draw_no_bet",
          last_update: "2026-06-26T01:32:00Z",
          outcomes: [
            { name: "Turkey", price: 1.95 },
            { name: "USA", price: 1.90 },
          ],
        },
        {
          key: "h2h_3_way",
          last_update: "2026-06-26T01:32:00Z",
          outcomes: [
            { name: "Turkey", price: 2.7 },
            { name: "Draw", price: 3.1 },
            { name: "USA", price: 2.9 },
          ],
        },
        {
          key: "double_chance",
          last_update: "2026-06-26T01:32:00Z",
          outcomes: [
            { name: "Turkey or Draw", price: 1.8 },
            { name: "USA or Draw", price: 1.3 },
            { name: "Turkey or USA", price: 1.25 },
          ],
        },
        {
          key: "btts",
          last_update: "2026-06-26T01:32:00Z",
          outcomes: [{ name: "Yes", price: 1.58 }, { name: "No", price: 2.4 }],
        },
        {
          key: "team_totals",
          last_update: "2026-06-26T01:32:00Z",
          outcomes: [
            { name: "Over", description: "USA", point: 1.5, price: 1.85 },
            { name: "Under", description: "USA", point: 1.5, price: 1.98 },
          ],
        },
        {
          key: "alternate_totals_corners",
          last_update: "2026-06-26T01:32:00Z",
          outcomes: [{ name: "Over", point: 9.5, price: 1.83 }, { name: "Under", point: 9.5, price: 1.98 }],
        },
        {
          key: "alternate_spreads_cards",
          last_update: "2026-06-26T01:32:00Z",
          outcomes: [
            { name: "Turkey", point: -0.5, price: 2.56 },
            { name: "USA", point: 0.5, price: 1.5 },
          ],
        },
        {
          key: "player_goal_scorer_anytime",
          last_update: "2026-06-26T01:32:00Z",
          outcomes: [{ name: "Yes", description: "Ricardo Pepi", price: 2.75 }],
        },
        {
          key: "player_shots",
          last_update: "2026-06-26T01:32:00Z",
          outcomes: [{ name: "Over", description: "Ricardo Pepi", point: 0.5, price: 1.02 }],
        },
        {
          key: "player_shots_on_target",
          last_update: "2026-06-26T01:32:00Z",
          outcomes: [{ name: "Over", description: "Weston McKennie", point: 0.5, price: 1.85 }],
        },
      ],
    }],
  }], receivedAt);

  assert.equal(rows.find((r) => r.market === "DRAW_NO_BET" && r.outcome === "1").decimalOdds, 1.95);
  assert.equal(rows.find((r) => r.market === "MATCH_RESULT" && r.outcome === "X").decimalOdds, 3.1);
  assert.equal(rows.find((r) => r.market === "DOUBLE_CHANCE" && r.outcome === "X2").decimalOdds, 1.3);
  assert.equal(rows.find((r) => r.market === "BTTS" && r.outcome === "YES").decimalOdds, 1.58);
  assert.equal(rows.find((r) => r.market === "TEAM_TOTALS" && r.line === "USA|1.5" && r.outcome === "OVER").decimalOdds, 1.85);
  assert.equal(rows.find((r) => r.market === "CORNERS_TOTALS" && r.line === "9.5" && r.outcome === "UNDER").decimalOdds, 1.98);
  assert.equal(rows.find((r) => r.market === "CARDS_SPREAD" && r.line === "Turkey|-0.5|USA|0.5" && r.outcome === "Turkey").decimalOdds, 2.56);
  assert.equal(rows.find((r) => r.market === "PLAYER_GOALSCORER" && r.line === "Ricardo Pepi" && r.outcome === "YES").decimalOdds, 2.75);
  assert.equal(rows.find((r) => r.market === "PLAYER_SHOTS" && r.line === "Ricardo Pepi|0.5" && r.outcome === "OVER").decimalOdds, 1.02);
  assert.equal(rows.find((r) => r.market === "PLAYER_SHOTS_ON_TARGET" && r.line === "Weston McKennie|0.5" && r.outcome === "OVER").decimalOdds, 1.85);
});

test("deduplicates featured and alternate rows for the same bookmaker selection", () => {
  const rows = normalizeTheOddsResponse([{
    id: "evt-dupe",
    sport_title: "FIFA World Cup",
    commence_time: "2026-06-26T02:00:00Z",
    home_team: "Turkey",
    away_team: "USA",
    bookmakers: [{
      key: "pinnacle",
      last_update: "2026-06-26T01:32:00Z",
      markets: [
        { key: "totals", outcomes: [{ name: "Over", point: 2.5, price: 1.69 }, { name: "Under", point: 2.5, price: 2.04 }] },
        { key: "alternate_totals", outcomes: [{ name: "Over", point: 2.5, price: 1.69 }, { name: "Under", point: 2.5, price: 2.04 }] },
        { key: "team_totals", outcomes: [{ name: "Over", description: "USA", point: 1.5, price: 1.85 }] },
        { key: "alternate_team_totals", outcomes: [{ name: "Over", description: "USA", point: 1.5, price: 1.85 }] },
      ],
    }],
  }], receivedAt);

  assert.equal(rows.filter((r) =>
    r.bookmaker === "pinnacle" &&
    r.market === "TOTALS" &&
    r.line === "2.5" &&
    r.outcome === "OVER").length, 1);
  assert.equal(rows.filter((r) =>
    r.bookmaker === "pinnacle" &&
    r.market === "TEAM_TOTALS" &&
    r.line === "USA|1.5" &&
    r.outcome === "OVER").length, 1);
});
