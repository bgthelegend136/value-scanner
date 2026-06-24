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
