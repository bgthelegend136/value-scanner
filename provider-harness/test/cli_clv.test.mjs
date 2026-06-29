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
  assert.deepEqual(calls, [{ sportKey: "soccer_fifa_world_cup", markets: "h2h,totals" }]);
  const [row] = await readCsv(join(reportsDir, "paper-bets.csv"));
  assert.notEqual(row.clv, "");
  assert.notEqual(row.closingFairOdds, "");
  assert.equal(row.clvCapturedAt, "2026-06-25T17:55:00.000Z");
  assert.match(out, /CLV captured: 1/);
  assert.doesNotMatch(await readFile(join(reportsDir, "paper-bets.csv"), "utf8"), new RegExp(KEY));
});

test("betsson-oneapi-clv captures closing line value from the dedicated Betsson ledger", async () => {
  const reportsDir = await mkdtemp(join(tmpdir(), "betsson-oneapi-clv-"));
  await writeCsv(join(reportsDir, "betsson-oneapi-paper-bets.csv"), [
    paperRow({ bookmaker: "betsson", sportKey: "soccer_fifa_world_cup" }),
  ], PAPER_COLUMNS);
  const calls = [];

  const code = await runCli(["betsson-oneapi-clv", "--window-minutes=60"], {
    out: () => {},
    err: () => {},
    loadTheOddsKey: async () => KEY,
    createTheOddsClient: () => ({
      async getOdds(args) {
        calls.push(args);
        return { data: closingOdds, receivedAt: "2026-06-25T17:55:00Z", quota: { remaining: 100, lastCost: 1 } };
      },
    }),
    reportsDir,
    now: () => new Date("2026-06-25T17:30:00Z"),
  });

  assert.equal(code, 0);
  assert.equal(calls.length, 1);
  const rows = await readCsv(join(reportsDir, "betsson-oneapi-paper-bets.csv"));
  assert.notEqual(rows[0].clv, "");
  await assert.rejects(() => readCsv(join(reportsDir, "paper-bets.csv")));
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

test("clv accepts a paper-only wider capture window", async () => {
  const reportsDir = await mkdtemp(join(tmpdir(), "clv-paper-window-"));
  await writeCsv(join(reportsDir, "paper-bets.csv"), [paperRow()], PAPER_COLUMNS);
  const calls = [];
  const code = await runCli(["clv", "--window-minutes=40"], {
    out: () => {},
    err: () => {},
    loadTheOddsKey: async () => KEY,
    createTheOddsClient: () => ({
      async getOdds(args) {
        calls.push(args);
        return { data: closingOdds, receivedAt: "2026-06-25T17:25:00.000Z", quota: { remaining: 494 } };
      },
    }),
    reportsDir,
    now: () => new Date("2026-06-25T17:25:00.000Z"),
  });

  assert.equal(code, 0);
  assert.deepEqual(calls, [{ sportKey: "soccer_fifa_world_cup", markets: "h2h,totals" }]);
  const [row] = await readCsv(join(reportsDir, "paper-bets.csv"));
  assert.notEqual(row.clv, "");
  assert.equal(row.clvCapturedAt, "2026-06-25T17:25:00.000Z");
});

test("clv captures totals paper bets by requesting totals closing markets", async () => {
  const reportsDir = await mkdtemp(join(tmpdir(), "clv-totals-"));
  await writeCsv(join(reportsDir, "paper-bets.csv"), [paperRow({
    market: "TOTALS",
    line: "2.5",
    outcome: "OVER",
    decimalOdds: "2.1500",
    fairOdds: "1.9342",
    fairProbability: "0.517000",
    ev: "0.111550",
  })], PAPER_COLUMNS);
  const totalsClosing = [{
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
        key: "totals",
        last_update: "2026-06-25T17:55:00Z",
        outcomes: [
          { name: "Over", point: 2.5, price: 1.92 },
          { name: "Under", point: 2.5, price: 1.92 },
        ],
      }],
    }],
  }];
  const calls = [];
  const code = await runCli(["clv"], {
    out: () => {},
    err: () => {},
    loadTheOddsKey: async () => KEY,
    createTheOddsClient: () => ({
      async getOdds(args) {
        calls.push(args);
        return { data: totalsClosing, receivedAt: "2026-06-25T17:55:00.000Z", quota: { remaining: 494 } };
      },
    }),
    reportsDir,
    now: () => new Date("2026-06-25T17:55:00.000Z"),
  });

  assert.equal(code, 0);
  assert.deepEqual(calls, [{ sportKey: "soccer_fifa_world_cup", markets: "h2h,totals" }]);
  const [row] = await readCsv(join(reportsDir, "paper-bets.csv"));
  assert.notEqual(row.clv, "");
  assert.notEqual(row.closingFairOdds, "");
});

test("clv captures soccer event-level markets with event odds", async () => {
  const reportsDir = await mkdtemp(join(tmpdir(), "clv-soccer-event-market-"));
  await writeCsv(join(reportsDir, "paper-bets.csv"), [paperRow({
    market: "DRAW_NO_BET",
    outcome: "1",
    decimalOdds: "2.0500",
    fairOdds: "1.7200",
    fairProbability: "0.581395",
    ev: "0.191860",
    sportKey: "soccer_fifa_world_cup",
  })], PAPER_COLUMNS);
  const eventClosing = {
    id: "ref1",
    sport_title: "FIFA World Cup",
    commence_time: "2026-06-25T18:00:00Z",
    home_team: "Spain",
    away_team: "Cape Verde",
    bookmakers: [{
      key: "pinnacle",
      title: "Pinnacle",
      markets: [{
        key: "draw_no_bet",
        last_update: "2026-06-25T17:55:00Z",
        outcomes: [
          { name: "Spain", price: 1.70 },
          { name: "Cape Verde", price: 2.15 },
        ],
      }],
    }],
  };
  const calls = [];
  const code = await runCli(["clv"], {
    out: () => {},
    err: () => {},
    loadTheOddsKey: async () => KEY,
    createTheOddsClient: () => ({
      async getOdds(args) {
        calls.push(["odds", args]);
        return { data: [], receivedAt: "2026-06-25T17:55:00.000Z", quota: { remaining: 494, lastCost: 2 } };
      },
      async getEventOdds(args) {
        calls.push(["eventOdds", args]);
        return { data: eventClosing, receivedAt: "2026-06-25T17:55:00.000Z", quota: { remaining: 490, lastCost: 4 } };
      },
    }),
    reportsDir,
    now: () => new Date("2026-06-25T17:55:00.000Z"),
  });

  assert.equal(code, 0);
  assert.deepEqual(calls, [
    ["odds", { sportKey: "soccer_fifa_world_cup", markets: "h2h,totals" }],
    ["eventOdds", {
      sportKey: "soccer_fifa_world_cup",
      eventId: "ref1",
      markets: "h2h,h2h_3_way,draw_no_bet,btts,double_chance",
    }],
  ]);
  const [row] = await readCsv(join(reportsDir, "paper-bets.csv"));
  assert.notEqual(row.clv, "");
  assert.notEqual(row.closingFairOdds, "");
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
    paperRow({ sportKey: "soccer_brazil_serie_b", kickoffUtc: "2026-06-25T22:00:00.000Z", clv: "-0.050000", clvCapturedAt: "2026-06-25T21:55:00.000Z" }),
    paperRow({ sportKey: "soccer_fifa_world_cup", kickoffUtc: "2026-06-26T18:00:00.000Z", clv: "0.100000", clvCapturedAt: "2026-06-26T17:55:00.000Z" }),
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

test("clv-calibrate writes EV bucket and segment diagnostics without spending API quota", async () => {
  const reportsDir = await mkdtemp(join(tmpdir(), "clv-calibrate-"));
  await writeCsv(join(reportsDir, "paper-bets.csv"), [
    paperRow({
      referenceEventId: "control-neg",
      tier: "CONTROL",
      bookmaker: "betfair_ex_eu",
      sportKey: "basketball_wnba",
      kickoffUtc: "2026-06-27T18:00:00.000Z",
      decimalOdds: "2.0000",
      ev: "-0.030000",
      clv: "-0.040000",
      clvCapturedAt: "2026-06-27T12:00:00.000Z",
    }),
    paperRow({
      referenceEventId: "control-flat",
      tier: "CONTROL",
      bookmaker: "matchbook",
      sportKey: "baseball_mlb",
      kickoffUtc: "2026-06-27T18:00:00.000Z",
      decimalOdds: "1.8000",
      ev: "0.010000",
      clv: "-0.005000",
      clvCapturedAt: "2026-06-27T13:00:00.000Z",
    }),
    paperRow({
      referenceEventId: "value-mid",
      tier: "VALUE",
      bookmaker: "Stoiximan",
      sportKey: "soccer_fifa_world_cup",
      kickoffUtc: "2026-06-27T18:00:00.000Z",
      decimalOdds: "2.5000",
      ev: "0.040000",
      clv: "0.030000",
      clvCapturedAt: "2026-06-27T14:00:00.000Z",
    }),
    paperRow({
      referenceEventId: "value-high",
      tier: "VALUE",
      bookmaker: "Novibet",
      sportKey: "soccer_fifa_world_cup",
      kickoffUtc: "2026-06-27T18:00:00.000Z",
      decimalOdds: "6.0000",
      ev: "0.120000",
      clv: "0.080000",
      clvCapturedAt: "2026-06-27T15:00:00.000Z",
    }),
    paperRow({
      referenceEventId: "uncaptured",
      tier: "VALUE",
      ev: "0.200000",
      clv: "",
      clvCapturedAt: "",
    }),
  ], PAPER_COLUMNS);

  let out = "";
  const code = await runCli(["clv-calibrate"], {
    out: (text) => { out += text; },
    err: () => {},
    reportsDir,
    now: () => new Date("2026-06-28T09:00:00.000Z"),
    loadTheOddsKey: async () => { throw new Error("must not load key"); },
    createTheOddsClient: () => { throw new Error("must not create client"); },
  });

  assert.equal(code, 0);
  assert.match(out, /CLV calibration: 4 captured rows/);
  assert.match(out, /Regression slope: \+/);

  const csv = await readCsv(join(reportsDir, "clv-calibration.csv"));
  const byKey = new Map(csv.map((row) => [`${row.scope}:${row.key}`, row]));
  assert.equal(byKey.get("overall:all").count, "4");
  assert.equal(byKey.get("tier:VALUE").count, "2");
  assert.equal(byKey.get("tier:CONTROL").averageClv, "-0.0225");
  assert.equal(byKey.get("evBucket:-5..0%").count, "1");
  assert.equal(byKey.get("evBucket:10%+").averageClv, "0.0800");
  assert.equal(byKey.get("oddsBucket:5.00+").count, "1");

  const json = JSON.parse(await readFile(join(reportsDir, "clv-calibration.json"), "utf8"));
  assert.equal(json.generatedAt, "2026-06-28T09:00:00.000Z");
  assert.equal(json.sampleSize, 4);
  assert.ok(json.regression.slope > 0);
  assert.ok(json.regression.rSquared > 0.8);
  assert.ok(json.rows.length >= 10);
});

test("clv-calibrate adds main score, unique selection counts, and low-sample market warnings", async () => {
  const reportsDir = await mkdtemp(join(tmpdir(), "clv-calibrate-main-"));
  await writeCsv(join(reportsDir, "paper-bets.csv"), [
    paperRow({
      referenceEventId: "main-1",
      bookmaker: "softbook",
      market: "MATCH_RESULT",
      kickoffUtc: "2026-06-27T18:00:00.000Z",
      outcome: "1",
      ev: "0.030000",
      clv: "0.040000",
      clvCapturedAt: "2026-06-27T12:00:00.000Z",
    }),
    paperRow({
      referenceEventId: "main-1",
      bookmaker: "softbook",
      market: "MATCH_RESULT",
      kickoffUtc: "2026-06-27T18:00:00.000Z",
      outcome: "1",
      ev: "0.030000",
      clv: "0.040000",
      clvCapturedAt: "2026-06-27T12:01:00.000Z",
    }),
    paperRow({
      referenceEventId: "totals-1",
      market: "TOTALS",
      kickoffUtc: "2026-06-27T18:00:00.000Z",
      line: "2.5",
      outcome: "OVER",
      ev: "0.020000",
      clv: "-0.100000",
      clvCapturedAt: "2026-06-27T12:02:00.000Z",
    }),
    paperRow({
      referenceEventId: "btts-1",
      market: "BTTS",
      kickoffUtc: "2026-06-27T18:00:00.000Z",
      outcome: "YES",
      ev: "0.010000",
      clv: "0.020000",
      clvCapturedAt: "2026-06-27T12:03:00.000Z",
    }),
  ], PAPER_COLUMNS);

  let out = "";
  const code = await runCli(["clv-calibrate"], {
    out: (text) => { out += text; },
    err: () => {},
    reportsDir,
    now: () => new Date("2026-06-28T13:00:00.000Z"),
    loadTheOddsKey: async () => { throw new Error("must not load key"); },
    createTheOddsClient: () => { throw new Error("must not create client"); },
  });

  assert.equal(code, 0);
  assert.match(out, /Main MATCH_RESULT CLV: \+4\.00%/);

  const csv = await readCsv(join(reportsDir, "clv-calibration.csv"));
  const byKey = new Map(csv.map((row) => [`${row.scope}:${row.key}`, row]));
  assert.equal(byKey.get("overall:all").count, "4");
  assert.equal(byKey.get("overall:all").uniqueSelectionCount, "3");
  assert.equal(byKey.get("main:MATCH_RESULT").count, "2");
  assert.equal(byKey.get("main:MATCH_RESULT").uniqueSelectionCount, "1");
  assert.equal(byKey.get("main:MATCH_RESULT").averageClv, "0.0400");
  assert.equal(byKey.get("market:TOTALS").sampleWarning, "LOW_SAMPLE_N_LT_50");
  assert.equal(byKey.get("market:BTTS").sampleWarning, "LOW_SAMPLE_N_LT_50");

  const json = JSON.parse(await readFile(join(reportsDir, "clv-calibration.json"), "utf8"));
  assert.equal(json.mainScore.scope, "main");
  assert.equal(json.mainScore.key, "MATCH_RESULT");
  assert.equal(json.mainScore.averageClv, "0.0400");
});
