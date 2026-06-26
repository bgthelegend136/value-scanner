import assert from "node:assert/strict";
import test from "node:test";

import { runCli } from "../src/cli.mjs";

const KEY = "theodds-secret";
const KICKOFF = "2026-06-26T02:00:00Z";
const FRESH = "2026-06-26T01:32:00Z";
const NOW = new Date("2026-06-26T01:35:00Z");

function book(key, extraMarkets = []) {
  return {
    key,
    title: key,
    last_update: FRESH,
    markets: [
      {
        key: "btts",
        last_update: FRESH,
        outcomes: [{ name: "Yes", price: 1.8 }, { name: "No", price: 2.0 }],
      },
      {
        key: "totals",
        last_update: FRESH,
        outcomes: [{ name: "Over", point: 2.5, price: 1.9 }, { name: "Under", point: 2.5, price: 1.9 }],
      },
      ...extraMarkets,
    ],
  };
}

function event({ player = false } = {}) {
  const playerMarket = player
    ? [{
      key: "player_goal_scorer_anytime",
      last_update: FRESH,
      outcomes: [{ name: "Yes", description: "Ricardo Pepi", price: 2.75 }],
    }]
    : [];
  return {
    id: "ref-1",
    sport_title: "FIFA World Cup",
    commence_time: KICKOFF,
    home_team: "Turkey",
    away_team: "USA",
    bookmakers: ["pinnacle", "betsson", "unibet", "williamhill"].map((key) => book(key, playerMarket)),
  };
}

function deps({ out, err = () => {}, calls, player = false }) {
  return {
    out,
    err,
    loadTheOddsKey: async () => KEY,
    createTheOddsClient: ({ apiKey }) => {
      assert.equal(apiKey, KEY);
      return {
        async listEvents(args) {
          calls.push(["listEvents", args]);
          return { data: [{ id: "ref-1", home_team: "Turkey", away_team: "USA", commence_time: KICKOFF }] };
        },
        async getEventOdds(args) {
          calls.push(["getEventOdds", args]);
          return { data: event({ player }), receivedAt: FRESH, quota: { remaining: 439 } };
        },
      };
    },
    now: () => NOW,
  };
}

test("boost-mix reports FULLY_VERIFIED when every leg has Pinnacle and consensus", async () => {
  let out = "";
  const calls = [];
  const code = await runCli(
    [
      "boost-mix",
      "--boost=2.50",
      `--leg=soccer_fifa_world_cup;Turkey;USA;${KICKOFF};BTTS_YES`,
      `--leg=soccer_fifa_world_cup;Turkey;USA;${KICKOFF};O2.5`,
    ],
    deps({ out: (text) => { out += text; }, calls }),
  );

  assert.equal(code, 0);
  assert.match(out, /FULLY_VERIFIED/);
  assert.match(out, /BTTS_YES/);
  assert.match(out, /O2.5/);
  assert.match(out, /Pinnacle fair odds/);
  assert.equal(calls.filter(([name]) => name === "getEventOdds").length, 2);
});

test("boost-mix labels one-sided player markets as MIXED_ESTIMATE", async () => {
  let out = "";
  const calls = [];
  const code = await runCli(
    [
      "boost-mix",
      "--boost=3.50",
      `--leg=soccer_fifa_world_cup;Turkey;USA;${KICKOFF};BTTS_YES`,
      `--leg=soccer_fifa_world_cup;Turkey;USA;${KICKOFF};PLAYER:Ricardo Pepi:GOAL`,
    ],
    deps({ out: (text) => { out += text; }, calls, player: true }),
  );

  assert.equal(code, 0);
  assert.match(out, /MIXED_ESTIMATE/);
  assert.match(out, /estimate only/i);
  assert.match(out, /Ricardo Pepi/);
  assert.doesNotMatch(out, /FULLY_VERIFIED/);
});

test("boost-mix rejects fewer than two legs", async () => {
  let err = "";
  const calls = [];
  const code = await runCli(
    ["boost-mix", "--boost=2.50", `--leg=soccer_fifa_world_cup;Turkey;USA;${KICKOFF};BTTS_YES`],
    deps({ out: () => {}, err: (text) => { err += text; }, calls }),
  );

  assert.equal(code, 1);
  assert.match(err, /usage: boost-mix/);
});
