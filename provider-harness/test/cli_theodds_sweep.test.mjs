import assert from "node:assert/strict";
import { access, mkdtemp, readdir } from "node:fs/promises";
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

function expandedBetssonEvent({ kickoff = "2026-06-28T18:00:00Z" } = {}) {
  function expandedBook(key, h, d, a, bttsYes, bttsNo, dnbHome, dnbAway, dc1x, dc12, dcx2) {
    return {
      key,
      title: key,
      last_update: "2026-06-27T12:00:00Z",
      markets: [
        {
          key: "h2h",
          last_update: "2026-06-27T12:00:00Z",
          outcomes: [
            { name: "Japan", price: h },
            { name: "Draw", price: d },
            { name: "Sweden", price: a },
          ],
        },
        {
          key: "totals",
          last_update: "2026-06-27T12:00:00Z",
          outcomes: [
            { name: "Over", point: 2.5, price: 1.90 },
            { name: "Under", point: 2.5, price: 1.95 },
          ],
        },
        {
          key: "btts",
          last_update: "2026-06-27T12:00:00Z",
          outcomes: [{ name: "Yes", price: bttsYes }, { name: "No", price: bttsNo }],
        },
        {
          key: "draw_no_bet",
          last_update: "2026-06-27T12:00:00Z",
          outcomes: [{ name: "Japan", price: dnbHome }, { name: "Sweden", price: dnbAway }],
        },
        {
          key: "double_chance",
          last_update: "2026-06-27T12:00:00Z",
          outcomes: [
            { name: "Japan or Draw", price: dc1x },
            { name: "Japan or Sweden", price: dc12 },
            { name: "Sweden or Draw", price: dcx2 },
          ],
        },
      ],
    };
  }

  return {
    ...soccerEvent,
    id: "betsson-oneapi-1",
    commence_time: kickoff,
    bookmakers: [
      expandedBook("pinnacle", 2.00, 3.40, 3.80, 1.80, 2.00, 1.72, 2.08, 1.32, 1.24, 1.45),
      expandedBook("betsson", 2.45, 3.10, 3.10, 2.25, 1.65, 2.05, 1.80, 4.00, 1.15, 1.25),
      expandedBook("unibet", 1.98, 3.45, 3.75, 1.81, 1.99, 1.71, 2.09, 1.32, 1.24, 1.45),
      expandedBook("williamhill", 2.01, 3.38, 3.72, 1.80, 2.00, 1.69, 2.11, 1.31, 1.25, 1.47),
      expandedBook("draftkings", 1.99, 3.42, 3.77, 1.82, 1.98, 1.70, 2.10, 1.33, 1.24, 1.46),
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

test("theodds-betsson-poc runs a one-API h2h Betsson sweep without Odds-API.io", async () => {
  const calls = [];
  let out = "";
  const reportsDir = await mkdtemp(join(tmpdir(), "theodds-betsson-poc-"));
  const betssonValueEvent = {
    ...event,
    bookmakers: [
      book("pinnacle", 2.00, 3.40, 3.80),
      book("betsson", 2.45, 3.10, 3.10),
      book("unibet", 1.98, 3.45, 3.75),
      book("williamhill", 2.01, 3.38, 3.72),
    ],
  };

  const code = await runCli([
    "theodds-betsson-poc",
    "--sports=soccer_fifa_world_cup",
    "--edge=5",
    "--sample-limit=0",
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
        async listEvents(args) {
          calls.push(["events", args]);
          return { data: [{ ...soccerEvent, id: "evt-1" }], quota: { remaining: 19888, lastCost: 0 } };
        },
        async getEventOdds(args) {
          calls.push(["eventOdds", args]);
          return { data: betssonValueEvent, receivedAt: "2026-06-27T12:00:05Z", quota: { remaining: 19882, lastCost: 6 } };
        },
      };
    },
    reportsDir,
    now: () => new Date("2026-06-27T12:00:05Z"),
  });

  assert.equal(code, 0);
  assert.match(out, /Betsson one-API POC/);
  assert.deepEqual(calls.find((call) => call[0] === "eventOdds")[1], {
    sportKey: "soccer_fifa_world_cup",
    eventId: "evt-1",
    regions: "eu",
    markets: "h2h,h2h_3_way,totals,draw_no_bet,btts,double_chance",
  });

  const rows = await readCsv(join(reportsDir, "betsson-oneapi-paper-bets.csv"));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].bookmaker, "betsson");
  assert.equal(rows[0].market, "MATCH_RESULT");
  assert.equal(rows[0].outcome, "1");
  assert.ok(Number(rows[0].ev) >= 0.05);
});

test("theodds-betsson-poc default edge records low positive Betsson h2h collection candidates", async () => {
  const reportsDir = await mkdtemp(join(tmpdir(), "theodds-betsson-low-edge-"));
  const lowEdgeEvent = {
    ...event,
    bookmakers: [
      book("pinnacle", 2.00, 3.40, 3.80),
      book("betsson", 2.12, 3.35, 3.70),
      book("unibet", 1.98, 3.45, 3.75),
      book("williamhill", 2.01, 3.38, 3.72),
    ],
  };

  const code = await runCli([
    "theodds-betsson-poc",
    "--sports=soccer_fifa_world_cup",
    "--sample-limit=0",
  ], {
    out: () => {},
    err: () => {},
    loadTheOddsKey: async () => KEY,
    loadApiKey: async () => { throw new Error("Odds-API.io must not be used"); },
    createClient: () => { throw new Error("Odds-API.io client must not be created"); },
    createTheOddsClient: () => ({
      async listSports() {
        return { data: [{ key: "soccer_fifa_world_cup", active: true }] };
      },
      async listEvents() {
        return { data: [{ ...soccerEvent, id: "evt-low-edge" }], quota: { remaining: 19888, lastCost: 0 } };
      },
      async getEventOdds() {
        return { data: lowEdgeEvent, receivedAt: "2026-06-27T12:00:05Z", quota: { remaining: 19882, lastCost: 6 } };
      },
    }),
    reportsDir,
    now: () => new Date("2026-06-27T12:00:05Z"),
  });

  assert.equal(code, 0);
  const rows = await readCsv(join(reportsDir, "betsson-oneapi-paper-bets.csv"));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].market, "MATCH_RESULT");
  assert.equal(rows[0].tier, "VALUE");
  assert.ok(Number(rows[0].ev) >= 0.01);
  assert.ok(Number(rows[0].ev) < 0.05);
});

test("theodds-betsson-poc uses expanded event markets and a dedicated Betsson ledger", async () => {
  const calls = [];
  const reportsDir = await mkdtemp(join(tmpdir(), "betsson-oneapi-expanded-"));

  const code = await runCli([
    "theodds-betsson-poc",
    "--sports=soccer_fifa_world_cup",
    "--edge=5",
    "--sample-min-ev=-2",
    "--sample-limit=5",
    "--event-limit=1",
    "--max-event-credits=60",
  ], {
    out: () => {},
    err: () => {},
    loadTheOddsKey: async () => KEY,
    loadApiKey: async () => { throw new Error("Odds-API.io must not be used"); },
    createClient: () => { throw new Error("Odds-API.io client must not be created"); },
    createTheOddsClient: () => ({
      async listSports() {
        calls.push(["sports"]);
        return { data: [{ key: "soccer_fifa_world_cup", active: true }] };
      },
      async listEvents(args) {
        calls.push(["events", args]);
        return { data: [{ ...soccerEvent, id: "betsson-oneapi-1" }], quota: { remaining: 4000, lastCost: 0 } };
      },
      async getEventOdds(args) {
        calls.push(["eventOdds", args]);
        return { data: expandedBetssonEvent(), receivedAt: "2026-06-27T12:05:00Z", quota: { remaining: 3994, lastCost: 6 } };
      },
      async getOdds() {
        throw new Error("Betsson one-api POC must use event odds");
      },
    }),
    reportsDir,
    now: () => new Date("2026-06-27T12:05:00Z"),
  });

  assert.equal(code, 0);
  assert.deepEqual(calls.find((call) => call[0] === "eventOdds")[1], {
    sportKey: "soccer_fifa_world_cup",
    eventId: "betsson-oneapi-1",
    regions: "eu",
    markets: "h2h,h2h_3_way,totals,draw_no_bet,btts,double_chance",
  });

  const files = await readdir(reportsDir);
  assert.ok(files.some((name) => name.startsWith("betsson-oneapi-sweep-")));
  assert.ok(files.some((name) => name.startsWith("betsson-oneapi-coverage-")));
  await assert.rejects(() => access(join(reportsDir, "paper-bets.csv")));

  const rows = await readCsv(join(reportsDir, "betsson-oneapi-paper-bets.csv"));
  assert.ok(rows.length > 1);
  assert.ok(rows.every((row) => row.bookmaker === "betsson"));
  assert.ok(rows.some((row) => row.market === "MATCH_RESULT" && row.tier !== "RESEARCH_ONLY"));
  assert.ok(rows.some((row) => row.market === "BTTS" && row.tier === "RESEARCH_ONLY"));
  assert.ok(rows.some((row) => row.market === "DRAW_NO_BET" && row.tier === "RESEARCH_ONLY"));
  assert.ok(rows.some((row) => row.market === "DOUBLE_CHANCE" && row.tier === "RESEARCH_ONLY"));
});

test("theodds-betsson-poc defaults to summer soccer h2h sports for Betsson collection", async () => {
  const calls = [];
  const reportsDir = await mkdtemp(join(tmpdir(), "betsson-oneapi-summer-h2h-"));

  const code = await runCli([
    "theodds-betsson-poc",
    "--markets=h2h",
    "--event-limit=1",
    "--sample-limit=0",
    "--max-event-credits=20",
  ], {
    out: () => {},
    err: () => {},
    loadTheOddsKey: async () => KEY,
    loadApiKey: async () => { throw new Error("Odds-API.io must not be used"); },
    createClient: () => { throw new Error("Odds-API.io client must not be created"); },
    createTheOddsClient: () => ({
      async listSports() {
        calls.push(["sports"]);
        return {
          data: [
            { key: "soccer_brazil_campeonato", active: true },
            { key: "soccer_brazil_serie_b", active: true },
            { key: "soccer_sweden_allsvenskan", active: true },
            { key: "soccer_sweden_superettan", active: false },
            { key: "soccer_norway_eliteserien", active: true },
            { key: "soccer_finland_veikkausliiga", active: true },
            { key: "soccer_league_of_ireland", active: true },
            { key: "soccer_usa_mls", active: true },
            { key: "soccer_fifa_world_cup", active: true },
          ],
        };
      },
      async listEvents(args) {
        calls.push(["events", args]);
        return { data: [{ ...soccerEvent, id: `${args.sportKey}-event` }], quota: { remaining: 4000, lastCost: 0 } };
      },
      async getEventOdds(args) {
        calls.push(["eventOdds", args]);
        return {
          data: { ...expandedBetssonEvent(), id: args.eventId },
          receivedAt: "2026-06-27T12:05:00Z",
          quota: { remaining: 3998, lastCost: 2 },
        };
      },
    }),
    reportsDir,
    now: () => new Date("2026-06-27T12:05:00Z"),
  });

  assert.equal(code, 0);
  assert.deepEqual(calls.filter(([name]) => name === "events").map(([, args]) => args.sportKey), [
    "soccer_brazil_campeonato",
    "soccer_brazil_serie_b",
    "soccer_sweden_allsvenskan",
    "soccer_norway_eliteserien",
    "soccer_finland_veikkausliiga",
    "soccer_league_of_ireland",
  ]);
  assert.equal(calls.some(([, args]) => args?.sportKey === "soccer_fifa_world_cup"), false);
  assert.equal(calls.some(([, args]) => args?.sportKey === "soccer_usa_mls"), false);
  assert.ok(calls.filter(([name]) => name === "eventOdds").every(([, args]) => args.markets === "h2h"));

  const coverageFile = (await readdir(reportsDir)).find((name) => name.startsWith("betsson-oneapi-coverage-"));
  assert.ok(coverageFile);
  const coverage = await readCsv(join(reportsDir, coverageFile));
  assert.ok(coverage.length > 0);
  assert.deepEqual([...new Set(coverage.map((row) => row.market))], ["MATCH_RESULT"]);
});

test("theodds-betsson-poc coverage distinguishes missing Betsson market from thin consensus", async () => {
  const reportsDir = await mkdtemp(join(tmpdir(), "betsson-oneapi-no-candidate-"));
  const noCandidateEvent = {
    ...soccerEvent,
    id: "betsson-no-candidate-1",
    bookmakers: [
      book("pinnacle", 2.00, 3.40, 3.80),
      book("betsson", 2.02, 3.35, 3.70),
      book("unibet", 1.98, 3.45, 3.75),
      book("williamhill", 2.01, 3.38, 3.72),
      {
        key: "pinnacle",
        title: "pinnacle",
        markets: [{ key: "draw_no_bet", outcomes: [{ name: "Japan", price: 1.70 }, { name: "Sweden", price: 2.10 }] }],
      },
      {
        key: "unibet",
        title: "unibet",
        markets: [{ key: "draw_no_bet", outcomes: [{ name: "Japan", price: 1.71 }, { name: "Sweden", price: 2.09 }] }],
      },
    ],
  };

  const code = await runCli([
    "theodds-betsson-poc",
    "--sports=soccer_fifa_world_cup",
    "--event-limit=1",
    "--sample-limit=0",
  ], {
    out: () => {},
    err: () => {},
    loadTheOddsKey: async () => KEY,
    loadApiKey: async () => { throw new Error("Odds-API.io must not be used"); },
    createClient: () => { throw new Error("Odds-API.io client must not be created"); },
    createTheOddsClient: () => ({
      async listSports() {
        return { data: [{ key: "soccer_fifa_world_cup", active: true }] };
      },
      async listEvents() {
        return { data: [{ ...soccerEvent, id: "betsson-no-candidate-1" }], quota: { remaining: 4000, lastCost: 0 } };
      },
      async getEventOdds() {
        return { data: noCandidateEvent, receivedAt: "2026-06-27T12:05:00Z", quota: { remaining: 3994, lastCost: 6 } };
      },
    }),
    reportsDir,
    now: () => new Date("2026-06-27T12:05:00Z"),
  });

  assert.equal(code, 0);
  const coverageFile = (await readdir(reportsDir)).find((name) => name.startsWith("betsson-oneapi-coverage-"));
  assert.ok(coverageFile);
  const coverage = await readCsv(join(reportsDir, coverageFile));
  const dnb = coverage.find((row) => row.market === "DRAW_NO_BET");
  assert.equal(dnb.normalizedRows, "4");
  assert.equal(dnb.candidateRows, "0");
  assert.equal(dnb.reason, "NO_CANDIDATE_BOOKMAKER");
});

test("theodds-betsson-poc preflights Betsson markets before requesting event odds", async () => {
  const calls = [];
  const reportsDir = await mkdtemp(join(tmpdir(), "betsson-oneapi-market-preflight-"));

  const code = await runCli([
    "theodds-betsson-poc",
    "--sports=soccer_fifa_world_cup",
    "--event-limit=1",
    "--sample-limit=0",
  ], {
    out: () => {},
    err: () => {},
    loadTheOddsKey: async () => KEY,
    loadApiKey: async () => { throw new Error("Odds-API.io must not be used"); },
    createClient: () => { throw new Error("Odds-API.io client must not be created"); },
    createTheOddsClient: () => ({
      async listSports() {
        return { data: [{ key: "soccer_fifa_world_cup", active: true }] };
      },
      async listEvents() {
        return { data: [{ ...soccerEvent, id: "betsson-preflight-1" }], quota: { remaining: 4000, lastCost: 0 } };
      },
      async getEventMarkets(args) {
        calls.push(["markets", args]);
        return {
          data: [{ key: "betsson", markets: [{ key: "h2h" }, { key: "totals" }] }],
          receivedAt: "2026-06-27T12:04:00Z",
          quota: { remaining: 4000, lastCost: 0 },
        };
      },
      async getEventOdds(args) {
        calls.push(["eventOdds", args]);
        assert.equal(args.markets, "h2h,h2h_3_way,totals");
        return {
          data: {
            ...expandedBetssonEvent(),
            bookmakers: expandedBetssonEvent().bookmakers.map((bookmaker) => ({
              ...bookmaker,
              markets: bookmaker.markets.filter((market) => ["h2h", "totals"].includes(market.key)),
            })),
          },
          receivedAt: "2026-06-27T12:05:00Z",
          quota: { remaining: 3994, lastCost: 6 },
        };
      },
    }),
    reportsDir,
    now: () => new Date("2026-06-27T12:05:00Z"),
  });

  assert.equal(code, 0);
  assert.deepEqual(calls[0], ["markets", {
    sportKey: "soccer_fifa_world_cup",
    eventId: "betsson-preflight-1",
    bookmakers: "betsson",
  }]);
  assert.equal(calls.filter(([name]) => name === "eventOdds").length, 1);
});

test("theodds-betsson-poc sends Telegram only for clean h2h watchlist candidates", async () => {
  const reportsDir = await mkdtemp(join(tmpdir(), "betsson-oneapi-telegram-"));
  const sent = [];

  const code = await runCli([
    "theodds-betsson-poc",
    "--sports=soccer_fifa_world_cup",
    "--edge=5",
    "--telegram-watchlist",
    "--event-limit=1",
  ], {
    out: () => {},
    err: () => {},
    loadTheOddsKey: async () => KEY,
    loadTelegramConfig: async () => ({ telegramToken: "token", telegramChatId: "chat" }),
    createTelegramClient: () => ({
      async sendText(text) {
        sent.push(text);
        return { messageId: String(sent.length) };
      },
    }),
    createTheOddsClient: () => ({
      async listSports() {
        return { data: [{ key: "soccer_fifa_world_cup", active: true }] };
      },
      async listEvents() {
        return { data: [{ ...soccerEvent, id: "betsson-oneapi-1" }], quota: { remaining: 4000, lastCost: 0 } };
      },
      async getEventOdds() {
        return {
          data: expandedBetssonEvent({ kickoff: "2026-06-28T18:00:00Z" }),
          receivedAt: "2026-06-27T12:05:00Z",
          quota: { remaining: 3994, lastCost: 6 },
        };
      },
    }),
    reportsDir,
    now: () => new Date("2026-06-27T12:05:00Z"),
  });

  assert.equal(code, 0);
  assert.equal(sent.length, 1);
  assert.match(sent[0], /Betsson h2h research watchlist/u);
  assert.match(sent[0], /Japan vs Sweden/u);
  assert.doesNotMatch(sent[0], /BTTS|DRAW_NO_BET|DOUBLE_CHANCE/u);
  assert.doesNotMatch(sent[0], /stake|staking|kelly|unit/i);
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
