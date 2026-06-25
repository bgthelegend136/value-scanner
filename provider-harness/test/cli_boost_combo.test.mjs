import assert from "node:assert/strict";
import test from "node:test";

import { runCli } from "../src/cli.mjs";

const KEY = "theodds-secret";
const KICKOFF_A = "2026-06-26T18:30:00Z";
const KICKOFF_B = "2026-06-26T21:00:00Z";
const FRESH = "2026-06-26T18:25:00Z";
const NOW = new Date("2026-06-26T18:27:00Z");

function event(id, home, away, kickoff) {
  return {
    id,
    sport_title: "FIFA World Cup",
    commence_time: kickoff,
    home_team: home,
    away_team: away,
    bookmakers: ["pinnacle", "betsson", "unibet", "williamhill"].map((key) => ({
      key,
      title: key,
      last_update: FRESH,
      markets: [{
        key: "h2h",
        last_update: FRESH,
        outcomes: [
          { name: home, price: 2.0 },
          { name: away, price: 3.8 },
          { name: "Draw", price: 3.5 },
        ],
      }],
    })),
  };
}

const EVENTS = [
  event("ref-A", "Japan", "Sweden", KICKOFF_A),
  event("ref-B", "Brazil", "Serbia", KICKOFF_B),
];

function deps({ out, calls, events = EVENTS }) {
  return {
    out,
    err: () => {},
    loadTheOddsKey: async () => KEY,
    createTheOddsClient: ({ apiKey }) => {
      assert.equal(apiKey, KEY);
      return {
        async listEvents(args) {
          calls.push(["listEvents", args]);
          return { data: events.map((e) => ({ id: e.id, home_team: e.home_team, away_team: e.away_team, commence_time: e.commence_time })) };
        },
        async getOdds(args) {
          calls.push(["getOdds", args]);
          return { data: EVENTS.filter((e) => args.eventIds.includes(e.id)), receivedAt: FRESH, quota: { remaining: 469 } };
        },
      };
    },
    now: () => NOW,
  };
}

test("boost-combo prices a multi-leg parlay against real sharp odds", async () => {
  let out = "";
  const calls = [];
  const code = await runCli(
    [
      "boost-combo",
      "--boost=2.50",
      "--leg=soccer_fifa_world_cup;Japan;Sweden;2026-06-26T18:30:00Z;2",
      "--leg=soccer_fifa_world_cup;Brazil;Serbia;2026-06-26T21:00:00Z;1",
    ],
    deps({ out: (text) => { out += text; }, calls }),
  );

  assert.equal(code, 0);
  // Each leg is priced with its own odds pull.
  assert.equal(calls.filter(([name]) => name === "getOdds").length, 2);
  assert.match(out, /Leg 1/);
  assert.match(out, /Leg 2/);
  assert.match(out, /Pinnacle fair odds \(combo\)/);
  assert.match(out, /Consensus fair odds \(combo\)/);
  assert.match(out, /Verdict:/);
});

test("boost-combo prices a double-chance leg from the 1X2 line", async () => {
  let out = "";
  const calls = [];
  const code = await runCli(
    [
      "boost-combo",
      "--boost=1.50",
      "--leg=soccer_fifa_world_cup;Japan;Sweden;2026-06-26T18:30:00Z;X2",
      "--leg=soccer_fifa_world_cup;Brazil;Serbia;2026-06-26T21:00:00Z;1",
    ],
    deps({ out: (text) => { out += text; }, calls }),
  );

  assert.equal(code, 0);
  assert.match(out, /Leg 1: Japan vs Sweden pick X2/);
  assert.match(out, /Pinnacle fair odds \(combo\)/);
  assert.match(out, /Verdict:/);
});

test("boost-combo refuses to verify when a leg cannot be matched", async () => {
  let out = "";
  const calls = [];
  const code = await runCli(
    [
      "boost-combo",
      "--boost=2.50",
      "--leg=soccer_fifa_world_cup;Japan;Sweden;2026-06-26T18:30:00Z;2",
      "--leg=soccer_fifa_world_cup;Nowhere United;Ghost FC;2026-06-26T21:00:00Z;1",
    ],
    deps({ out: (text) => { out += text; }, calls }),
  );

  assert.equal(code, 0);
  assert.match(out, /could not price|cannot be verified/i);
  assert.doesNotMatch(out, /Verdict: \+EV/);
});

test("boost-combo rejects fewer than two legs", async () => {
  let err = "";
  const calls = [];
  const base = deps({ out: () => {}, calls });
  base.err = (text) => { err += text; };
  const code = await runCli(
    ["boost-combo", "--boost=2.50", "--leg=soccer_fifa_world_cup;Japan;Sweden;2026-06-26T18:30:00Z;2"],
    base,
  );
  assert.equal(code, 1);
  assert.match(err, /usage: boost-combo/);
});
