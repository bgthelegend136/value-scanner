import assert from "node:assert/strict";
import test from "node:test";

import { runCli } from "../src/cli.mjs";

const KEY = "theodds-secret";
const KICKOFF = "2026-06-26T18:30:00Z";
const FRESH = "2026-06-26T18:25:00Z";
const NOW = new Date("2026-06-26T18:27:00Z");

function refBook(key, home, draw, away) {
  return {
    key,
    title: key,
    last_update: FRESH,
    markets: [{
      key: "h2h",
      last_update: FRESH,
      outcomes: [
        { name: "Japan", price: home },
        { name: "Sweden", price: away },
        { name: "Draw", price: draw },
      ],
    }],
  };
}

const referenceOdds = [{
  id: "ref-501",
  sport_title: "FIFA World Cup",
  commence_time: KICKOFF,
  home_team: "Japan",
  away_team: "Sweden",
  bookmakers: [
    refBook("pinnacle", 1.95, 3.6, 3.9),
    refBook("betsson", 1.95, 3.6, 3.9),
    refBook("unibet", 1.95, 3.6, 3.9),
    refBook("williamhill", 1.95, 3.6, 3.9),
  ],
}];

function deps({ out, calls }) {
  return {
    out,
    err: () => {},
    loadTheOddsKey: async () => KEY,
    createTheOddsClient: ({ apiKey }) => {
      assert.equal(apiKey, KEY);
      return {
        async listEvents(args) {
          calls.push(["listEvents", args]);
          return { data: [{ id: "ref-501", home_team: "Japan", away_team: "Sweden", commence_time: KICKOFF }] };
        },
        async getOdds(args) {
          calls.push(["getOdds", args]);
          return { data: referenceOdds, receivedAt: FRESH, quota: { remaining: 470 } };
        },
      };
    },
    now: () => NOW,
  };
}

test("boost-check prices a boosted match-result pick against real sharp odds", async () => {
  let out = "";
  const calls = [];
  const code = await runCli(
    [
      "boost-check",
      "--sport-key=soccer_fifa_world_cup",
      "--home=Japan",
      "--away=Sweden",
      `--date=${KICKOFF}`,
      "--pick=1",
      "--base=1.78",
      "--boost=2.40",
    ],
    deps({ out: (text) => { out += text; }, calls }),
  );

  assert.equal(code, 0);
  const getOdds = calls.find(([name]) => name === "getOdds")[1];
  assert.equal(getOdds.sportKey, "soccer_fifa_world_cup");
  assert.deepEqual(getOdds.eventIds, ["ref-501"]);
  assert.equal(getOdds.markets, "h2h");

  // Japan boosted to 2.40 against a ~1.95 Pinnacle line is clearly +EV.
  assert.match(out, /Pinnacle/);
  assert.match(out, /Consensus/);
  assert.match(out, /EV \+\d/); // a positive EV percentage is shown
  assert.match(out, /Verdict:/);
});

test("boost-check reports no verdict when the event is not found", async () => {
  let out = "";
  const calls = [];
  const base = deps({ out: (text) => { out += text; }, calls });
  base.createTheOddsClient = () => ({
    async listEvents() { return { data: [] }; },
    async getOdds() { throw new Error("getOdds must not be called without a match"); },
  });

  const code = await runCli(
    [
      "boost-check",
      "--sport-key=soccer_fifa_world_cup",
      "--home=Japan",
      "--away=Sweden",
      `--date=${KICKOFF}`,
      "--pick=1",
      "--boost=2.40",
    ],
    base,
  );

  assert.equal(code, 0);
  assert.match(out, /could not be matched|not found|No event/i);
});
