import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runCli } from "../src/cli.mjs";
import { readCsv } from "../src/csv.mjs";

const ODDS_KEY = "oddsapi-secret";
const THEODDS_KEY = "theodds-secret";

const theOddsEvents = [
  { id: "ref1", home_team: "Spain", away_team: "Cape Verde", commence_time: "2026-06-25T18:00:00Z" },
];
const theOddsOdds = [
  {
    id: "ref1", sport_title: "FIFA World Cup", commence_time: "2026-06-25T18:00:00Z",
    home_team: "Spain", away_team: "Cape Verde",
    bookmakers: [
      { key: "pinnacle", title: "Pinnacle", last_update: "2026-06-24T12:00:00Z", markets: [
        { key: "h2h", last_update: "2026-06-24T12:00:00Z", outcomes: [
          { name: "Spain", price: 1.30 }, { name: "Cape Verde", price: 11.0 }, { name: "Draw", price: 6.20 },
        ] },
      ] },
      { key: "betsson", title: "Betsson", last_update: "2026-06-24T12:00:00Z", markets: [
        { key: "h2h", last_update: "2026-06-24T12:00:00Z", outcomes: [
          { name: "Spain", price: 1.32 }, { name: "Cape Verde", price: 10.5 }, { name: "Draw", price: 6.00 },
        ] },
      ] },
    ],
  },
];
const oddsApiEvents = [
  { id: 999, home: "Spain", away: "Cape Verde", date: "2026-06-25T18:00:00Z", league: { name: "World Cup" } },
];
const oddsApiOdds = {
  id: 999, home: "Spain", away: "Cape Verde", date: "2026-06-25T18:00:00Z", league: { name: "World Cup" },
  bookmakers: {
    Stoiximan: [{ name: "ML", updatedAt: "2026-06-24T12:00:00Z", odds: [{ home: "1.28", draw: "7.50", away: "10.5" }] }],
    Novibet: [{ name: "ML", updatedAt: "2026-06-24T12:00:00Z", odds: [{ home: "1.29", draw: "6.10", away: "10.0" }] }],
  },
};

function fakeOddsApiClient(calls) {
  return {
    async listEvents(args) { calls.push(["oddsapi.events", args]); return { data: [oddsApiEvents[0]], receivedAt: "2026-06-24T12:00:05.000Z", rateLimit: { limit: 100, remaining: 99, resetAt: "x" } }; },
    async getOddsMulti(args) { calls.push(["oddsapi.multi", args]); return { data: [oddsApiOdds], receivedAt: "2026-06-24T12:00:05.000Z", rateLimit: { limit: 100, remaining: 98, resetAt: "x" } }; },
  };
}
function fakeTheOddsClient(calls) {
  return {
    async listSports() { calls.push(["theodds.sports"]); return { data: [{ key: "soccer_fifa_world_cup", group: "Soccer", title: "FIFA World Cup", active: true }] }; },
    async listEvents(args) { calls.push(["theodds.events", args]); return { data: theOddsEvents, receivedAt: "2026-06-24T12:00:05.000Z", quota: { remaining: 20000, used: 0, lastCost: 0 } }; },
    async getOdds(args) { calls.push(["theodds.odds", args]); return { data: theOddsOdds, receivedAt: "2026-06-24T12:00:05.000Z", quota: { remaining: 19998, used: 2, lastCost: 2 } }; },
  };
}

test("scan finds value vs Pinnacle, prints alerts, writes report, leaks no key", async () => {
  const calls = [];
  let out = "";
  const reportsDir = await mkdtemp(join(tmpdir(), "scan-"));
  const code = await runCli(["scan"], {
    out: (t) => { out += t; },
    err: () => {},
    loadApiKey: async () => ODDS_KEY,
    loadTheOddsKey: async () => THEODDS_KEY,
    createClient: ({ apiKey }) => { assert.equal(apiKey, ODDS_KEY); return fakeOddsApiClient(calls); },
    createTheOddsClient: ({ apiKey }) => { assert.equal(apiKey, THEODDS_KEY); return fakeTheOddsClient(calls); },
    reportsDir,
    now: () => new Date("2026-06-24T12:00:05.000Z"),
  });

  assert.equal(code, 0);
  assert.match(out, /ALERT:/);
  assert.match(out, /Match: Spain - Cape Verde/);
  assert.match(out, /Stoiximan/);
  assert.deepEqual(calls.find((c) => c[0] === "oddsapi.events")[1], { sport: "football", league: "international-fifa-world-cup", status: "pending", limit: 100 });
  assert.deepEqual(calls.find((c) => c[0] === "oddsapi.multi")[1], { eventIds: ["999"], bookmakers: ["Novibet", "Stoiximan"] });
  assert.equal(calls.filter((c) => c[0] === "oddsapi.multi").length, 1);
  assert.equal(calls.filter((c) => c[0] === "theodds.odds").length, 1);

  const files = await readdir(reportsDir);
  const valueReport = files.find((f) => f.startsWith("scan-") && !f.startsWith("scan-all-") && f.endsWith(".csv"));
  const fullReport = files.find((f) => f.startsWith("scan-all-") && f.endsWith(".csv"));
  assert.ok(valueReport, "clean value report written");
  assert.ok(fullReport, "full audit report written");

  const valueRaw = await readFile(join(reportsDir, valueReport), "utf8");
  assert.equal(valueRaw.split(/\r?\n/)[0], "ev,tier,match,pick,bookmaker,odd,fairOdd,marketFair,books,kickoffUtc");
  // value row: +EV%, a tier, the match, Draw pick on Stoiximan @7.50, numeric
  // Pinnacle fairOdd + market consensus, backed by 2 reference books
  assert.match(
    valueRaw,
    /^\+\d+\.\d+%,(VALUE|VALUE_CHECK|SUSPICIOUS),Spain v Cape Verde,Draw \(X\),Stoiximan,7\.50,\d+\.\d+,\d+\.\d+,2,/m,
  );
  // the clean report must NOT contain the NO_VALUE Novibet draw row
  assert.doesNotMatch(valueRaw, /Novibet/);

  const fullRaw = await readFile(join(reportsDir, fullReport), "utf8");
  assert.match(fullRaw, /NO_VALUE/);
  for (const raw of [valueRaw, fullRaw]) {
    assert.doesNotMatch(raw, new RegExp(ODDS_KEY));
    assert.doesNotMatch(raw, new RegExp(THEODDS_KEY));
  }

  const ledgerPath = join(reportsDir, "paper-bets.csv");
  const ledger = await readFile(ledgerPath, "utf8");
  assert.match(ledger, /referenceEventId,bettableEventId,firstSeenAt/);
  assert.match(ledger, /ref1,999,2026-06-24T12:00:05\.000Z/);
  assert.match(ledger, /Stoiximan,MATCH_RESULT,,X,7\.5000/);
  assert.match(ledger.split(/\r?\n/)[0], /,sportKey$/);
  assert.match(ledger, /,soccer_fifa_world_cup\b/);
  assert.match(out, /Recorded 1 new paper bet/);
  assert.doesNotMatch(ledger, new RegExp(ODDS_KEY));
  assert.doesNotMatch(ledger, new RegExp(THEODDS_KEY));
});

test("scan covers every in-season mapped league and tags paper bets with sportKey", async () => {
  // Two leagues, each with one clearly +EV draw (Stoiximan 7.50 vs ~6.2 fair).
  const leagues = {
    soccer_fifa_world_cup: {
      slug: "football|international-fifa-world-cup", sport: "football", leagueSlug: "international-fifa-world-cup",
      ref: { id: "wc1", home_team: "Spain", away_team: "Cape Verde", commence_time: "2026-06-25T18:00:00Z" },
      bet: { id: 111, home: "Spain", away: "Cape Verde", date: "2026-06-25T18:00:00Z", league: { name: "World Cup" } },
    },
    soccer_brazil_serie_b: {
      slug: "football|brazil-brasileiro-serie-b", sport: "football", leagueSlug: "brazil-brasileiro-serie-b",
      ref: { id: "br1", home_team: "Goias", away_team: "Coritiba", commence_time: "2026-06-26T22:00:00Z" },
      bet: { id: 222, home: "Goias", away: "Coritiba", date: "2026-06-26T22:00:00Z", league: { name: "Brazil Serie B" } },
    },
  };
  const refOdds = (ev) => [{
    id: ev.id, sport_title: "x", commence_time: ev.commence_time, home_team: ev.home_team, away_team: ev.away_team,
    bookmakers: [
      { key: "pinnacle", title: "Pinnacle", last_update: "2026-06-24T12:00:00Z", markets: [{ key: "h2h", last_update: "2026-06-24T12:00:00Z", outcomes: [
        { name: ev.home_team, price: 1.30 }, { name: ev.away_team, price: 11.0 }, { name: "Draw", price: 6.20 }] }] },
      { key: "betsson", title: "Betsson", last_update: "2026-06-24T12:00:00Z", markets: [{ key: "h2h", last_update: "2026-06-24T12:00:00Z", outcomes: [
        { name: ev.home_team, price: 1.32 }, { name: ev.away_team, price: 10.5 }, { name: "Draw", price: 6.00 }] }] },
    ],
  }];
  const betOdds = (b) => ({ ...b, bookmakers: { Stoiximan: [{ name: "ML", updatedAt: "2026-06-24T12:00:00Z", odds: [{ home: "1.28", draw: "7.50", away: "10.5" }] }] } });

  const all = Object.values(leagues);
  const oddsClient = {
    async listEvents(args) { const l = all.find((x) => x.leagueSlug === args.league); return { data: [l.bet], receivedAt: "2026-06-24T12:00:05.000Z", rateLimit: { limit: 100, remaining: 99 } }; },
    async getOddsMulti(args) { const l = all.find((x) => String(x.bet.id) === String(args.eventIds[0])); return { data: [betOdds(l.bet)], receivedAt: "2026-06-24T12:00:05.000Z" }; },
  };
  const theOdds = {
    async listSports() { return { data: Object.keys(leagues).map((key) => ({ key, group: "Soccer", title: "x", active: true })) }; },
    async listEvents(args) { return { data: [leagues[args.sportKey].ref], receivedAt: "2026-06-24T12:00:05.000Z", quota: { remaining: 19990 } }; },
    async getOdds(args) { return { data: refOdds(leagues[args.sportKey].ref), receivedAt: "2026-06-24T12:00:05.000Z", quota: { remaining: 19988 } }; },
  };

  let out = "";
  const reportsDir = await mkdtemp(join(tmpdir(), "scan-multi-"));
  const code = await runCli(["scan"], {
    out: (t) => { out += t; }, err: () => {},
    loadApiKey: async () => ODDS_KEY, loadTheOddsKey: async () => THEODDS_KEY,
    createClient: () => oddsClient, createTheOddsClient: () => theOdds,
    reportsDir, now: () => new Date("2026-06-24T12:00:05.000Z"),
    loadRegistry: async () => new Map(all.map((l) => [l.slug, Object.keys(leagues).find((k) => leagues[k] === l)])),
  });

  assert.equal(code, 0);
  assert.match(out, /2 in-season leagues/);
  assert.match(out, /Recorded 2 new paper bets/);
  const ledger = await readFile(join(reportsDir, "paper-bets.csv"), "utf8");
  assert.match(ledger, /^wc1,111,.*soccer_fifa_world_cup$/m);
  assert.match(ledger, /^br1,222,.*soccer_brazil_serie_b$/m);
});

test("scan stops early when The Odds API quota falls below the 1000-credit CLV reserve", async () => {
  let oddsCalls = 0;
  const theOdds = {
    async listSports() { return { data: [{ key: "soccer_a", group: "Soccer", title: "A", active: true }, { key: "soccer_b", group: "Soccer", title: "B", active: true }] }; },
    async listEvents() { return { data: [], receivedAt: "2026-06-24T12:00:05.000Z", quota: { remaining: 999 } }; },
    async getOdds() { oddsCalls += 1; return { data: [], receivedAt: "2026-06-24T12:00:05.000Z", quota: { remaining: 999 } }; },
  };
  const oddsClient = { async listEvents() { return { data: [], receivedAt: "x", rateLimit: {} }; }, async getOddsMulti() { return { data: [] }; } };
  let out = "";
  const reportsDir = await mkdtemp(join(tmpdir(), "scan-quota-"));
  const code = await runCli(["scan"], {
    out: (t) => { out += t; }, err: () => {},
    loadApiKey: async () => ODDS_KEY, loadTheOddsKey: async () => THEODDS_KEY,
    createClient: () => oddsClient, createTheOddsClient: () => theOdds,
    reportsDir, now: () => new Date("2026-06-24T12:00:05.000Z"),
    loadRegistry: async () => new Map([["football|a", "soccer_a"], ["football|b", "soccer_b"]]),
  });
  assert.equal(code, 0);
  assert.match(out, /Stopping scan: The Odds API quota 999 is below the 1000-credit floor/);
  assert.equal(oddsCalls, 1); // stopped after the first league, never queried the second
});

test("repeated scans do not duplicate the same paper bet", async () => {
  const calls = [];
  let out = "";
  const reportsDir = await mkdtemp(join(tmpdir(), "scan-dedup-"));
  const deps = {
    out: (text) => { out += text; },
    err: () => {},
    loadApiKey: async () => ODDS_KEY,
    loadTheOddsKey: async () => THEODDS_KEY,
    createClient: () => fakeOddsApiClient(calls),
    createTheOddsClient: () => fakeTheOddsClient(calls),
    reportsDir,
    now: () => new Date("2026-06-24T12:00:05.000Z"),
  };

  assert.equal(await runCli(["scan"], deps), 0);
  assert.equal(await runCli(["scan"], deps), 0);

  const rows = await readCsv(join(reportsDir, "paper-bets.csv"));
  assert.equal(rows.length, 1);
  assert.match(out, /Skipped 1 duplicate paper bet/);
});

test("scan accepts a paper-only bookmaker override", async () => {
  const calls = [];
  const reportsDir = await mkdtemp(join(tmpdir(), "scan-books-"));
  const code = await runCli(["scan", "--bookmakers=Stoiximan"], {
    out: () => {},
    err: () => {},
    loadApiKey: async () => ODDS_KEY,
    loadTheOddsKey: async () => THEODDS_KEY,
    createClient: () => fakeOddsApiClient(calls),
    createTheOddsClient: () => fakeTheOddsClient(calls),
    reportsDir,
    now: () => new Date("2026-06-24T12:00:05.000Z"),
  });

  assert.equal(code, 0);
  assert.deepEqual(calls.find((c) => c[0] === "oddsapi.multi")[1].bookmakers, ["Stoiximan"]);
});
