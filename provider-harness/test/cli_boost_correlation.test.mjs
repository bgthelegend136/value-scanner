import assert from "node:assert/strict";
import test from "node:test";

import { runCli } from "../src/cli.mjs";

const KEY = "theodds-secret";
const KICKOFF = "2026-06-26T02:00:00Z";
const FRESH = "2026-06-26T01:32:00Z";
const NOW = new Date("2026-06-26T01:35:00Z");

function book(key, home, away) {
  return {
    key,
    title: key,
    last_update: FRESH,
    markets: [
      { key: "btts", last_update: FRESH, outcomes: [{ name: "Yes", price: 1.8 }, { name: "No", price: 2.0 }] },
      {
        key: "totals",
        last_update: FRESH,
        outcomes: [{ name: "Over", point: 2.5, price: 1.9 }, { name: "Under", point: 2.5, price: 1.9 }],
      },
      {
        key: "h2h",
        last_update: FRESH,
        outcomes: [{ name: home, price: 2.4 }, { name: "Draw", price: 3.3 }, { name: away, price: 3.0 }],
      },
    ],
  };
}

function fixture(id, home, away) {
  return {
    id,
    sport_title: "FIFA World Cup",
    commence_time: KICKOFF,
    home_team: home,
    away_team: away,
    bookmakers: ["pinnacle", "betsson", "unibet", "williamhill"].map((key) => book(key, home, away)),
  };
}

const FIXTURES = [
  fixture("ref-1", "Turkey", "USA"),
  fixture("ref-2", "Brazil", "Serbia"),
];

function deps(out) {
  return {
    out,
    err: () => {},
    loadTheOddsKey: async () => KEY,
    createTheOddsClient: () => ({
      async listEvents() {
        return { data: FIXTURES.map((f) => ({ id: f.id, home_team: f.home_team, away_team: f.away_team, commence_time: f.commence_time })) };
      },
      async getEventOdds({ eventId }) {
        return { data: FIXTURES.find((f) => f.id === eventId), receivedAt: FRESH, quota: { remaining: 100 } };
      },
      async getOdds({ eventIds }) {
        return { data: FIXTURES.filter((f) => eventIds.includes(f.id)), receivedAt: FRESH, quota: { remaining: 100 } };
      },
    }),
    now: () => NOW,
  };
}

test("boost-mix warns when two legs are on the same event", async () => {
  let out = "";
  const code = await runCli(
    [
      "boost-mix",
      "--boost=2.50",
      `--leg=soccer_fifa_world_cup;Turkey;USA;${KICKOFF};BTTS_YES`,
      `--leg=soccer_fifa_world_cup;Turkey;USA;${KICKOFF};O2.5`,
    ],
    deps((text) => { out += text; }),
  );

  assert.equal(code, 0);
  assert.match(out, /same event/i);
  assert.match(out, /approximate/i);
  assert.match(out, /FULLY_VERIFIED/);
});

test("boost-mix stays quiet when legs are on different events", async () => {
  let out = "";
  const code = await runCli(
    [
      "boost-mix",
      "--boost=2.50",
      `--leg=soccer_fifa_world_cup;Turkey;USA;${KICKOFF};BTTS_YES`,
      `--leg=soccer_fifa_world_cup;Brazil;Serbia;${KICKOFF};O2.5`,
    ],
    deps((text) => { out += text; }),
  );

  assert.equal(code, 0);
  assert.doesNotMatch(out, /same event/i);
});

test("boost-combo warns when two legs are on the same event", async () => {
  let out = "";
  const code = await runCli(
    [
      "boost-combo",
      "--boost=2.50",
      `--leg=soccer_fifa_world_cup;Turkey;USA;${KICKOFF};1`,
      `--leg=soccer_fifa_world_cup;Turkey;USA;${KICKOFF};2`,
    ],
    deps((text) => { out += text; }),
  );

  assert.equal(code, 0);
  assert.match(out, /same event/i);
});
