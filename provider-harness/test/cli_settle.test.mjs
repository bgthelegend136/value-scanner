import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runCli } from "../src/cli.mjs";
import { readCsv, writeCsv } from "../src/csv.mjs";
import { PAPER_COLUMNS } from "../src/paper.mjs";

const KEY = "scores-secret";

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
    ...overrides,
  };
}

test("settle updates completed bets and prints realized ROI", async () => {
  const reportsDir = await mkdtemp(join(tmpdir(), "settle-"));
  await writeCsv(join(reportsDir, "paper-bets.csv"), [paperRow()], PAPER_COLUMNS);
  const calls = [];
  let out = "";
  const code = await runCli(["settle"], {
    out: (text) => { out += text; },
    err: () => {},
    loadTheOddsKey: async () => KEY,
    createTheOddsClient: ({ apiKey }) => {
      assert.equal(apiKey, KEY);
      return {
        async getScores(args) {
          calls.push(args);
          return {
            data: [{
              id: "ref1",
              completed: true,
              home_team: "Spain",
              away_team: "Cape Verde",
              scores: [
                { name: "Spain", score: "1" },
                { name: "Cape Verde", score: "1" },
              ],
              last_update: "2026-06-25T20:00:00Z",
            }],
            quota: { remaining: 496, used: 4, lastCost: 2 },
          };
        },
      };
    },
    reportsDir,
    now: () => new Date("2026-06-25T20:01:00Z"),
  });

  assert.equal(code, 0);
  assert.deepEqual(calls, [{ sportKey: "soccer_fifa_world_cup", daysFrom: 3 }]);
  const [row] = await readCsv(join(reportsDir, "paper-bets.csv"));
  assert.equal(row.status, "WON");
  assert.equal(row.profit, "6.5000");
  assert.match(out, /Wins: 1/);
  assert.match(out, /Net profit: \+6\.5000 units/);
  assert.match(out, /ROI: \+650\.0%/);
  assert.match(out, /aggregate score/i);
  assert.doesNotMatch(await readFile(join(reportsDir, "paper-bets.csv"), "utf8"), new RegExp(KEY));
});

test("settle fetches scores for every pending league", async () => {
  const reportsDir = await mkdtemp(join(tmpdir(), "settle-multi-"));
  await writeCsv(join(reportsDir, "paper-bets.csv"), [
    paperRow({ sportKey: "soccer_fifa_world_cup" }),
    paperRow({ referenceEventId: "br1", bettableEventId: "222", homeTeam: "Goias", awayTeam: "Coritiba", outcome: "1", sportKey: "soccer_brazil_serie_b" }),
  ], PAPER_COLUMNS);
  const scoresBySport = {
    soccer_fifa_world_cup: [{ id: "ref1", completed: true, home_team: "Spain", away_team: "Cape Verde", scores: [{ name: "Spain", score: "1" }, { name: "Cape Verde", score: "1" }], last_update: "2026-06-25T20:00:00Z" }],
    soccer_brazil_serie_b: [{ id: "br1", completed: true, home_team: "Goias", away_team: "Coritiba", scores: [{ name: "Goias", score: "2" }, { name: "Coritiba", score: "0" }], last_update: "2026-06-25T20:00:00Z" }],
  };
  const calls = [];
  const code = await runCli(["settle"], {
    out: () => {}, err: () => {},
    loadTheOddsKey: async () => KEY,
    createTheOddsClient: () => ({
      async getScores(args) { calls.push(args.sportKey); return { data: scoresBySport[args.sportKey], quota: { remaining: 490 } }; },
    }),
    reportsDir, now: () => new Date("2026-06-25T20:05:00Z"),
  });
  assert.equal(code, 0);
  assert.deepEqual([...calls].sort(), ["soccer_brazil_serie_b", "soccer_fifa_world_cup"]);
  const rows = await readCsv(join(reportsDir, "paper-bets.csv"));
  assert.equal(rows.find((r) => r.referenceEventId === "ref1").status, "WON");
  assert.equal(rows.find((r) => r.referenceEventId === "br1").status, "WON");
});

test("settle avoids quota when the ledger is absent or has no pending bets", async () => {
  const reportsDir = await mkdtemp(join(tmpdir(), "settle-empty-"));
  let calls = 0;
  const deps = {
    out: () => {},
    err: () => {},
    loadTheOddsKey: async () => KEY,
    createTheOddsClient: () => ({
      async getScores() { calls += 1; return { data: [], quota: {} }; },
    }),
    reportsDir,
  };

  assert.equal(await runCli(["settle"], deps), 0);
  await writeCsv(
    join(reportsDir, "paper-bets.csv"),
    [paperRow({ status: "LOST", profit: "-1.0000" })],
    PAPER_COLUMNS,
  );
  assert.equal(await runCli(["settle"], deps), 0);
  assert.equal(calls, 0);
});

test("settle warns about pending bets outside the three-day window", async () => {
  const reportsDir = await mkdtemp(join(tmpdir(), "settle-stale-"));
  await writeCsv(
    join(reportsDir, "paper-bets.csv"),
    [paperRow({ kickoffUtc: "2026-06-20T12:00:00Z" })],
    PAPER_COLUMNS,
  );
  let out = "";
  const code = await runCli(["settle"], {
    out: (text) => { out += text; },
    err: () => {},
    loadTheOddsKey: async () => KEY,
    createTheOddsClient: () => ({
      async getScores() {
        return { data: [], quota: { remaining: 496, used: 4, lastCost: 2 } };
      },
    }),
    reportsDir,
    now: () => new Date("2026-06-24T12:00:00Z"),
  });
  assert.equal(code, 0);
  assert.match(out, /1 pending paper bet.*older than 3 days/i);
});
