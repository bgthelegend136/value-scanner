import assert from "node:assert/strict";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runCli } from "../src/cli.mjs";
import { readCsv } from "../src/csv.mjs";

const KEY = "theodds-secret";

function book(key, home, draw, away) {
  return {
    key,
    title: key,
    last_update: "2026-06-27T12:00:00Z",
    markets: [{
      key: "h2h",
      last_update: "2026-06-27T12:00:00Z",
      outcomes: [
        { name: "Japan", price: home },
        { name: "Sweden", price: away },
        { name: "Draw", price: draw },
      ],
    }],
  };
}

const event = {
  id: "evt-1",
  sport_key: "soccer_fifa_world_cup",
  sport_title: "FIFA World Cup",
  commence_time: "2026-06-28T18:00:00Z",
  home_team: "Japan",
  away_team: "Sweden",
  bookmakers: [
    book("pinnacle", 2.00, 3.40, 3.80),
    book("betsson", 2.02, 3.35, 3.70),
    book("unibet", 1.98, 3.45, 3.75),
    book("williamhill", 2.01, 3.38, 3.72),
    book("softbook", 2.45, 3.10, 3.10),
  ],
};

const soccerEvent = {
  id: "soccer-extra-1",
  sport_key: "soccer_fifa_world_cup",
  sport_title: "FIFA World Cup",
  commence_time: "2026-06-28T18:00:00Z",
  home_team: "Japan",
  away_team: "Sweden",
};

function soccerExtraEvent() {
  return {
    ...soccerEvent,
    bookmakers: [
      {
        key: "pinnacle",
        title: "pinnacle",
        markets: [
          { key: "draw_no_bet", outcomes: [{ name: "Japan", price: 1.72 }, { name: "Sweden", price: 2.08 }] },
          { key: "btts", outcomes: [{ name: "Yes", price: 1.80 }, { name: "No", price: 2.00 }] },
          { key: "double_chance", outcomes: [{ name: "Japan or Draw", price: 1.32 }, { name: "Sweden or Draw", price: 1.45 }, { name: "Japan or Sweden", price: 1.24 }] },
        ],
      },
      {
        key: "betsson",
        title: "betsson",
        markets: [
          { key: "draw_no_bet", outcomes: [{ name: "Japan", price: 1.70 }, { name: "Sweden", price: 2.10 }] },
          { key: "btts", outcomes: [{ name: "Yes", price: 1.82 }, { name: "No", price: 1.98 }] },
          { key: "double_chance", outcomes: [{ name: "Japan or Draw", price: 1.31 }, { name: "Sweden or Draw", price: 1.46 }, { name: "Japan or Sweden", price: 1.25 }] },
        ],
      },
      {
        key: "unibet",
        title: "unibet",
        markets: [
          { key: "draw_no_bet", outcomes: [{ name: "Japan", price: 1.71 }, { name: "Sweden", price: 2.09 }] },
          { key: "btts", outcomes: [{ name: "Yes", price: 1.81 }, { name: "No", price: 1.99 }] },
          { key: "double_chance", outcomes: [{ name: "Japan or Draw", price: 1.32 }, { name: "Sweden or Draw", price: 1.45 }, { name: "Japan or Sweden", price: 1.24 }] },
        ],
      },
      {
        key: "williamhill",
        title: "williamhill",
        markets: [
          { key: "draw_no_bet", outcomes: [{ name: "Japan", price: 1.69 }, { name: "Sweden", price: 2.11 }] },
          { key: "btts", outcomes: [{ name: "Yes", price: 1.80 }, { name: "No", price: 2.00 }] },
          { key: "double_chance", outcomes: [{ name: "Japan or Draw", price: 1.31 }, { name: "Sweden or Draw", price: 1.47 }, { name: "Japan or Sweden", price: 1.25 }] },
        ],
      },
      {
        key: "softbook",
        title: "softbook",
        markets: [
          { key: "draw_no_bet", outcomes: [{ name: "Japan", price: 2.05 }, { name: "Sweden", price: 1.80 }] },
          { key: "btts", outcomes: [{ name: "Yes", price: 2.25 }, { name: "No", price: 1.65 }] },
          { key: "double_chance", outcomes: [{ name: "Japan or Draw", price: 1.60 }, { name: "Sweden or Draw", price: 1.25 }, { name: "Japan or Sweden", price: 1.15 }] },
        ],
      },
    ],
  };
}

test("theodds-sweep records cross-book paper value and controls without Odds-API.io", async () => {
  const calls = [];
  let out = "";
  const reportsDir = await mkdtemp(join(tmpdir(), "theodds-sweep-"));

  const code = await runCli([
    "theodds-sweep",
    "--sports=soccer_fifa_world_cup",
    "--edge=5",
    "--sample-min-ev=-5",
    "--sample-limit=3",
  ], {
    out: (text) => { out += text; },
    err: () => {},
    loadTheOddsKey: async () => KEY,
    loadApiKey: async () => { throw new Error("Odds-API.io must not be used"); },
    createClient: () => { throw new Error("Odds-API.io client must not be created"); },
    createTheOddsClient: ({ apiKey }) => {
      assert.equal(apiKey, KEY);
      return {
        async listSports() {
          calls.push(["sports"]);
          return { data: [{ key: "soccer_fifa_world_cup", active: true }] };
        },
        async getOdds(args) {
          calls.push(["odds", args]);
          return { data: [event], receivedAt: "2026-06-27T12:00:05Z", quota: { remaining: 19888, lastCost: 2 } };
        },
      };
    },
    reportsDir,
    now: () => new Date("2026-06-27T12:00:05Z"),
  });

  assert.equal(code, 0);
  assert.match(out, /The Odds sweep/);
  assert.match(out, /Recorded 1 new sweep value paper bet/);
  assert.match(out, /Sampled 3 sweep control/);
  assert.deepEqual(calls.find((call) => call[0] === "odds")[1], {
    sportKey: "soccer_fifa_world_cup",
    regions: "eu",
    markets: "h2h,totals",
  });

  const rows = await readCsv(join(reportsDir, "paper-bets.csv"));
  assert.equal(rows.length, 4);
  const value = rows.find((row) => row.tier !== "CONTROL");
  assert.equal(value.referenceEventId, "evt-1");
  assert.equal(value.bettableEventId, "evt-1");
  assert.equal(value.bookmaker, "softbook");
  assert.equal(value.market, "MATCH_RESULT");
  assert.equal(value.outcome, "1");
  assert.equal(value.sportKey, "soccer_fifa_world_cup");
  assert.ok(Number(value.ev) >= 0.05);
  assert.equal(rows.filter((row) => row.tier === "CONTROL").length, 3);
});

test("theodds-sweep soccer-core uses event odds for soccer-only research markets", async () => {
  const calls = [];
  const reportsDir = await mkdtemp(join(tmpdir(), "theodds-sweep-soccer-core-"));

  const code = await runCli([
    "theodds-sweep",
    "--market-profile=soccer-core",
    "--edge=5",
    "--sample-min-ev=-5",
    "--sample-limit=2",
    "--max-sports=10",
    "--event-limit=1",
  ], {
    out: () => {},
    err: () => {},
    loadTheOddsKey: async () => KEY,
    createTheOddsClient: () => ({
      async listSports() {
        calls.push(["sports"]);
        return {
          data: [
            { key: "soccer_fifa_world_cup", active: true },
            { key: "basketball_wnba", active: true },
          ],
        };
      },
      async listEvents(args) {
        calls.push(["events", args]);
        return { data: [soccerEvent], quota: { remaining: 19888, lastCost: 0 } };
      },
      async getEventOdds(args) {
        calls.push(["eventOdds", args]);
        return { data: soccerExtraEvent(), receivedAt: "2026-06-27T12:00:05Z", quota: { remaining: 19884, lastCost: 4 } };
      },
      async getOdds() {
        throw new Error("soccer-core must use event odds, not bulk odds");
      },
    }),
    reportsDir,
    now: () => new Date("2026-06-27T12:00:05Z"),
  });

  assert.equal(code, 0);
  assert.deepEqual(calls.filter((call) => call[0] === "events").map((call) => call[1].sportKey), ["soccer_fifa_world_cup"]);
  assert.deepEqual(calls.find((call) => call[0] === "eventOdds")[1], {
    sportKey: "soccer_fifa_world_cup",
    eventId: "soccer-extra-1",
    regions: "eu",
    markets: "h2h,h2h_3_way,draw_no_bet,btts,double_chance",
  });

  const rows = await readCsv(join(reportsDir, "paper-bets.csv"));
  assert.ok(rows.some((row) => row.market === "DRAW_NO_BET" && row.tier !== "CONTROL"));
  assert.ok(rows.some((row) => row.market === "BTTS" && row.tier !== "CONTROL"));
  assert.equal(rows.some((row) => row.market === "TOTALS"), false);
});

test("theodds-sweep soccer-core writes pre-filter coverage diagnostics", async () => {
  const calls = [];
  const reportsDir = await mkdtemp(join(tmpdir(), "theodds-sweep-coverage-"));
  const coverageEvent = {
    ...soccerEvent,
    id: "coverage-1",
    bookmakers: [
      book("pinnacle", 2.00, 3.40, 3.80),
      book("betsson", 2.02, 3.35, 3.70),
      book("unibet", 1.98, 3.45, 3.75),
      book("williamhill", 2.01, 3.38, 3.72),
      book("softbook", 2.03, 3.30, 3.60),
      {
        key: "pinnacle",
        title: "pinnacle",
        markets: [{ key: "draw_no_bet", outcomes: [{ name: "Japan", price: 1.70 }, { name: "Sweden", price: 2.10 }] }],
      },
      {
        key: "softbook",
        title: "softbook",
        markets: [{ key: "draw_no_bet", outcomes: [{ name: "Japan", price: 1.72 }, { name: "Sweden", price: 2.05 }] }],
      },
    ],
  };

  const code = await runCli([
    "theodds-sweep",
    "--market-profile=soccer-core",
    "--edge=50",
    "--sample-min-ev=-5",
    "--sample-limit=0",
    "--event-limit=1",
  ], {
    out: () => {},
    err: () => {},
    loadTheOddsKey: async () => KEY,
    createTheOddsClient: () => ({
      async listSports() {
        return { data: [{ key: "soccer_fifa_world_cup", active: true }] };
      },
      async listEvents() {
        return { data: [{ ...soccerEvent, id: "coverage-1" }], quota: { remaining: 19888, lastCost: 0 } };
      },
      async getEventOdds(args) {
        calls.push(args);
        return { data: coverageEvent, receivedAt: "2026-06-27T12:00:05Z", quota: { remaining: 19884, lastCost: 4 } };
      },
    }),
    reportsDir,
    now: () => new Date("2026-06-27T12:00:05Z"),
  });

  assert.equal(code, 0);
  assert.doesNotMatch(calls[0].markets, /spreads|team_totals|alternate|player/u);

  const coverageFile = (await readdir(reportsDir)).find((name) => name.startsWith("theodds-sweep-coverage-"));
  assert.ok(coverageFile);
  const coverage = await readCsv(join(reportsDir, coverageFile));
  const byMarket = new Map(coverage.map((row) => [row.market, row]));
  assert.equal(byMarket.get("MATCH_RESULT").reason, "NO_VALUE");
  assert.equal(byMarket.get("MATCH_RESULT").normalizedRows, "15");
  assert.equal(byMarket.get("DRAW_NO_BET").reason, "TOO_FEW_BOOKS");
  assert.equal(byMarket.get("BTTS").reason, "NO_MARKET");
  assert.equal(byMarket.get("DOUBLE_CHANCE").reason, "NO_MARKET");
});

test("theodds-sweep falls back to h2h when a sport rejects totals", async () => {
  const calls = [];
  const reportsDir = await mkdtemp(join(tmpdir(), "theodds-sweep-fallback-"));

  const code = await runCli([
    "theodds-sweep",
    "--sports=soccer_fifa_world_cup",
    "--markets=h2h,totals",
  ], {
    out: () => {},
    err: () => {},
    loadTheOddsKey: async () => KEY,
    createTheOddsClient: () => ({
      async listSports() {
        return { data: [{ key: "soccer_fifa_world_cup", active: true }] };
      },
      async getOdds(args) {
        calls.push(args);
        if (args.markets === "h2h,totals") throw new Error("The Odds API request failed with status 422");
        return { data: [event], receivedAt: "2026-06-27T12:00:05Z", quota: { remaining: 19888, lastCost: 1 } };
      },
    }),
    reportsDir,
    now: () => new Date("2026-06-27T12:00:05Z"),
  });

  assert.equal(code, 0);
  assert.deepEqual(calls.map((call) => call.markets), ["h2h,totals", "h2h"]);
});

test("theodds-sweep skips sports that reject h2h too", async () => {
  let out = "";
  const reportsDir = await mkdtemp(join(tmpdir(), "theodds-sweep-skip-"));

  const code = await runCli(["theodds-sweep", "--sports=bad_sport"], {
    out: (text) => { out += text; },
    err: () => {},
    loadTheOddsKey: async () => KEY,
    createTheOddsClient: () => ({
      async listSports() {
        return { data: [{ key: "bad_sport", active: true }] };
      },
      async getOdds() {
        throw new Error("The Odds API request failed with status 422");
      },
    }),
    reportsDir,
    now: () => new Date("2026-06-27T12:00:05Z"),
  });

  assert.equal(code, 0);
  assert.match(out, /skippedSports=1/);
});

test("theodds-sweep skips explicit h2h rejects and continues other sports", async () => {
  const calls = [];
  let out = "";
  const reportsDir = await mkdtemp(join(tmpdir(), "theodds-sweep-explicit-h2h-skip-"));

  const code = await runCli([
    "theodds-sweep",
    "--markets=h2h",
    "--sports=bad_sport,soccer_fifa_world_cup",
  ], {
    out: (text) => { out += text; },
    err: () => {},
    loadTheOddsKey: async () => KEY,
    createTheOddsClient: () => ({
      async listSports() {
        return {
          data: [
            { key: "bad_sport", active: true },
            { key: "soccer_fifa_world_cup", active: true },
          ],
        };
      },
      async getOdds(args) {
        calls.push(args);
        if (args.sportKey === "bad_sport") {
          throw new Error("The Odds API request failed with status 422");
        }
        return { data: [event], receivedAt: "2026-06-27T12:00:05Z", quota: { remaining: 19888, lastCost: 1 } };
      },
    }),
    reportsDir,
    now: () => new Date("2026-06-27T12:00:05Z"),
  });

  assert.equal(code, 0);
  assert.deepEqual(calls.map((call) => call.sportKey), ["bad_sport", "soccer_fifa_world_cup"]);
  assert.match(out, /skippedSports=1/);
});
