import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runCli } from "../src/cli.mjs";

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
    Superbet: [{ name: "ML", updatedAt: "2026-06-24T12:00:00Z", odds: [{ home: "1.29", draw: "6.10", away: "10.0" }] }],
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
    async listEvents(args) { calls.push(["theodds.events", args]); return { data: theOddsEvents, receivedAt: "2026-06-24T12:00:05.000Z", quota: { remaining: 500, used: 0, lastCost: 0 } }; },
    async getOdds(args) { calls.push(["theodds.odds", args]); return { data: theOddsOdds, receivedAt: "2026-06-24T12:00:05.000Z", quota: { remaining: 498, used: 2, lastCost: 2 } }; },
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
  assert.deepEqual(calls.find((c) => c[0] === "oddsapi.multi")[1], { eventIds: ["999"], bookmakers: ["Superbet", "Stoiximan"] });
  assert.equal(calls.filter((c) => c[0] === "oddsapi.multi").length, 1);
  assert.equal(calls.filter((c) => c[0] === "theodds.odds").length, 1);

  const files = await readdir(reportsDir);
  const valueReport = files.find((f) => f.startsWith("scan-") && !f.startsWith("scan-all-") && f.endsWith(".csv"));
  const fullReport = files.find((f) => f.startsWith("scan-all-") && f.endsWith(".csv"));
  assert.ok(valueReport, "clean value report written");
  assert.ok(fullReport, "full audit report written");

  const valueRaw = await readFile(join(reportsDir, valueReport), "utf8");
  assert.equal(valueRaw.split(/\r?\n/)[0], "ev,tier,match,pick,bookmaker,odd,fairOdd,marketFair,books,kickoffUtc");
  assert.match(valueRaw, /Spain v Cape Verde/);
  assert.match(valueRaw, /\+18\.4%/);
  assert.match(valueRaw, /SUSPICIOUS/);
  // Draw row: Pinnacle fair 6.33, market consensus (Pinnacle+Betsson) a number, 2 books
  assert.match(valueRaw, /Draw \(X\),Stoiximan,7\.50,6\.33,\d+\.\d+,2,/);
  // the clean report must NOT contain the NO_VALUE Superbet draw row
  assert.doesNotMatch(valueRaw, /Superbet/);

  const fullRaw = await readFile(join(reportsDir, fullReport), "utf8");
  assert.match(fullRaw, /NO_VALUE/);
  for (const raw of [valueRaw, fullRaw]) {
    assert.doesNotMatch(raw, new RegExp(ODDS_KEY));
    assert.doesNotMatch(raw, new RegExp(THEODDS_KEY));
  }
});
