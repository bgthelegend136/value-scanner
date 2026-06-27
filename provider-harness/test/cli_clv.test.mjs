import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runCli } from "../src/cli.mjs";
import { readCsv, writeCsv } from "../src/csv.mjs";
import { PAPER_COLUMNS } from "../src/paper.mjs";

const KEY = "theodds-secret";

function paperRow(overrides = {}) {
  return {
    referenceEventId: "ref1",
    bettableEventId: "999",
    firstSeenAt: "2026-06-24T12:00:05.000Z",
    kickoffUtc: "2026-06-25T18:00:00.000Z",
    homeTeam: "Spain",
    awayTeam: "Cape Verde",
    bookmaker: "Stoiximan",
    market: "MATCH_RESULT",
    line: "",
    outcome: "X",
    decimalOdds: "7.5000",
    fairOdds: "6.3300",
    fairProbability: "0.158000",
    ev: "0.185000",
    tier: "SUSPICIOUS",
    stake: "1.00",
    status: "PENDING",
    homeScore: "",
    awayScore: "",
    profit: "",
    settledAt: "",
    closingFairOdds: "",
    clv: "",
    clvCapturedAt: "",
    ...overrides,
  };
}

const closingOdds = [{
  id: "ref1",
  sport_title: "FIFA World Cup",
  commence_time: "2026-06-25T18:00:00Z",
  home_team: "Spain",
  away_team: "Cape Verde",
  bookmakers: [{
    key: "pinnacle",
    title: "Pinnacle",
    last_update: "2026-06-25T17:55:00Z",
    markets: [{
      key: "h2h",
      last_update: "2026-06-25T17:55:00Z",
      outcomes: [
        { name: "Spain", price: 1.30 },
        { name: "Cape Verde", price: 12.0 },
        { name: "Draw", price: 6.00 },
      ],
    }],
  }],
}];

test("clv captures closing line value for pending bets", async () => {
  const reportsDir = await mkdtemp(join(tmpdir(), "clv-"));
  await writeCsv(join(reportsDir, "paper-bets.csv"), [paperRow()], PAPER_COLUMNS);
  const calls = [];
  let out = "";
  const code = await runCli(["clv"], {
    out: (text) => { out += text; },
    err: () => {},
    loadTheOddsKey: async () => KEY,
    createTheOddsClient: ({ apiKey }) => {
      assert.equal(apiKey, KEY);
      return {
        async getOdds(args) {
          calls.push(args);
          return { data: closingOdds, receivedAt: "2026-06-25T17:55:00.000Z", quota: { remaining: 494 } };
        },
      };
    },
    reportsDir,
    now: () => new Date("2026-06-25T17:55:00.000Z"),
  });

  assert.equal(code, 0);
  assert.deepEqual(calls, [{ sportKey: "soccer_fifa_world_cup" }]);
  const [row] = await readCsv(join(reportsDir, "paper-bets.csv"));
  assert.notEqual(row.clv, "");
  assert.notEqual(row.closingFairOdds, "");
  assert.equal(row.clvCapturedAt, "2026-06-25T17:55:00.000Z");
  assert.match(out, /CLV captured: 1/);
  assert.doesNotMatch(await readFile(join(reportsDir, "paper-bets.csv"), "utf8"), new RegExp(KEY));
});

test("clv waits until kickoff is near before spending quota", async () => {
  const reportsDir = await mkdtemp(join(tmpdir(), "clv-early-"));
  await writeCsv(join(reportsDir, "paper-bets.csv"), [paperRow()], PAPER_COLUMNS);
  let calls = 0;
  const code = await runCli(["clv"], {
    out: () => {},
    err: () => {},
    loadTheOddsKey: async () => KEY,
    createTheOddsClient: () => ({
      async getOdds() {
        calls += 1;
        return { data: closingOdds, receivedAt: "2026-06-25T12:00:00.000Z", quota: { remaining: 494 } };
      },
    }),
    reportsDir,
    now: () => new Date("2026-06-25T12:00:00.000Z"),
  });

  assert.equal(code, 0);
  assert.equal(calls, 0);
  const [row] = await readCsv(join(reportsDir, "paper-bets.csv"));
  assert.equal(row.clv, "");
  assert.equal(row.clvCapturedAt, "");
});

test("clv queries each pending league's closing line and merges them", async () => {
  const reportsDir = await mkdtemp(join(tmpdir(), "clv-multi-"));
  const brClosing = [{
    id: "br1", sport_title: "Brazil Serie B", commence_time: "2026-06-26T22:00:00Z",
    home_team: "Goias", away_team: "Coritiba",
    bookmakers: [{ key: "pinnacle", title: "Pinnacle", last_update: "2026-06-26T21:55:00Z", markets: [{ key: "h2h", last_update: "2026-06-26T21:55:00Z", outcomes: [
      { name: "Goias", price: 1.30 }, { name: "Coritiba", price: 12.0 }, { name: "Draw", price: 6.00 }] }] }],
  }];
  await writeCsv(join(reportsDir, "paper-bets.csv"), [
    paperRow({ sportKey: "soccer_fifa_world_cup" }),
    paperRow({ referenceEventId: "br1", bettableEventId: "222", homeTeam: "Goias", awayTeam: "Coritiba", kickoffUtc: "2026-06-26T22:00:00.000Z", sportKey: "soccer_brazil_serie_b" }),
  ], PAPER_COLUMNS);
  const calls = [];
  const code = await runCli(["clv"], {
    out: () => {}, err: () => {},
    loadTheOddsKey: async () => KEY,
    createTheOddsClient: () => ({
      async getOdds(args) {
        calls.push(args.sportKey);
        return { data: args.sportKey === "soccer_brazil_serie_b" ? brClosing : closingOdds, receivedAt: "2026-06-26T21:55:00.000Z", quota: { remaining: 490 } };
      },
    }),
    reportsDir, now: () => new Date("2026-06-26T21:55:00.000Z"),
  });
  assert.equal(code, 0);
  assert.deepEqual([...calls].sort(), ["soccer_brazil_serie_b", "soccer_fifa_world_cup"]);
  const rows = await readCsv(join(reportsDir, "paper-bets.csv"));
  for (const row of rows) assert.notEqual(row.clv, "");
});

test("clv spends no quota with no ledger or no pending bets", async () => {
  const reportsDir = await mkdtemp(join(tmpdir(), "clv-empty-"));
  let calls = 0;
  const deps = {
    out: () => {},
    err: () => {},
    loadTheOddsKey: async () => KEY,
    createTheOddsClient: () => ({ async getOdds() { calls += 1; return { data: [], quota: {} }; } }),
    reportsDir,
    now: () => new Date("2026-06-25T17:55:00.000Z"),
  };

  assert.equal(await runCli(["clv"], deps), 0);
  await writeCsv(
    join(reportsDir, "paper-bets.csv"),
    [paperRow({ status: "WON", profit: "6.5000" })],
    PAPER_COLUMNS,
  );
  assert.equal(await runCli(["clv"], deps), 0);
  assert.equal(calls, 0);
});
test("clv-report writes trend summaries without spending API quota", async () => {
  const reportsDir = await mkdtemp(join(tmpdir(), "clv-report-"));
  await writeCsv(join(reportsDir, "paper-bets.csv"), [
    paperRow({ sportKey: "soccer_fifa_world_cup", clv: "0.200000", clvCapturedAt: "2026-06-25T17:55:00.000Z" }),
    paperRow({ sportKey: "soccer_brazil_serie_b", clv: "-0.050000", clvCapturedAt: "2026-06-25T21:55:00.000Z" }),
    paperRow({ sportKey: "soccer_fifa_world_cup", clv: "0.100000", clvCapturedAt: "2026-06-26T17:55:00.000Z" }),
    paperRow({ sportKey: "soccer_fifa_world_cup", clv: "", clvCapturedAt: "" }),
  ], PAPER_COLUMNS);
  let out = "";
  const code = await runCli(["clv-report"], {
    out: (text) => { out += text; },
    err: () => {},
    reportsDir,
    now: () => new Date("2026-06-27T08:00:00.000Z"),
    loadTheOddsKey: async () => { throw new Error("must not load key"); },
    createTheOddsClient: () => { throw new Error("must not create client"); },
  });

  assert.equal(code, 0);
  assert.match(out, /CLV report: 3 captured/);
  assert.match(out, /Beat rate: 66\.7%/);
  assert.match(out, /Average CLV: \+8\.3%/);

  const csv = await readCsv(join(reportsDir, "clv-report.csv"));
  assert.deepEqual(
    csv.map((row) => `${row.scope}:${row.key}:${row.captured}:${row.positive}:${row.beatRate}:${row.averageClv}`),
    [
      "overall:all:3:2:0.6667:0.0833",
      "sportKey:soccer_brazil_serie_b:1:0:0.0000:-0.0500",
      "sportKey:soccer_fifa_world_cup:2:2:1.0000:0.1500",
      "captureDate:2026-06-25:2:1:0.5000:0.0750",
      "captureDate:2026-06-26:1:1:1.0000:0.1000",
    ],
  );

  const json = JSON.parse(await readFile(join(reportsDir, "clv-report.json"), "utf8"));
  assert.equal(json.generatedAt, "2026-06-27T08:00:00.000Z");
  assert.equal(json.rows.length, 5);
});
