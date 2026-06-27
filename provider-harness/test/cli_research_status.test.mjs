import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runCli } from "../src/cli.mjs";
import { readCsv, writeCsv } from "../src/csv.mjs";
import { PAPER_COLUMNS } from "../src/paper.mjs";

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
    outcome: "1",
    decimalOdds: "2.0000",
    fairOdds: "1.9000",
    fairProbability: "0.526316",
    ev: "0.052632",
    tier: "VALUE",
    stake: "1.00",
    status: "PENDING",
    homeScore: "",
    awayScore: "",
    profit: "",
    settledAt: "",
    closingFairOdds: "",
    clv: "",
    clvCapturedAt: "",
    sportKey: "soccer_fifa_world_cup",
    ...overrides,
  };
}

test("research-status summarizes VALUE/CONTROL CLV progress by main and market buckets without API keys", async () => {
  const reportsDir = await mkdtemp(join(tmpdir(), "research-status-"));
  await writeCsv(join(reportsDir, "paper-bets.csv"), [
    paperRow({ referenceEventId: "main-value-1", clv: "0.030000", clvCapturedAt: "2026-06-25T17:55:00.000Z" }),
    paperRow({ referenceEventId: "main-value-2", tier: "VALUE_CHECK", clv: "0.010000", clvCapturedAt: "2026-06-25T17:55:00.000Z" }),
    paperRow({ referenceEventId: "main-value-3" }),
    paperRow({ referenceEventId: "main-control-1", tier: "CONTROL", ev: "-0.020000", clv: "-0.010000", clvCapturedAt: "2026-06-25T17:55:00.000Z" }),
    paperRow({ referenceEventId: "totals-value-1", market: "TOTALS", line: "2.5", outcome: "OVER", clv: "0.040000", clvCapturedAt: "2026-06-25T17:55:00.000Z" }),
    paperRow({ referenceEventId: "btts-value-1", market: "BTTS", outcome: "YES", clv: "0.020000", clvCapturedAt: "2026-06-25T17:55:00.000Z" }),
    paperRow({ referenceEventId: "dnb-control-1", market: "DRAW_NO_BET", outcome: "1", tier: "CONTROL", ev: "-0.010000", clv: "-0.020000", clvCapturedAt: "2026-06-25T17:55:00.000Z" }),
    paperRow({ referenceEventId: "main-value-1", clv: "0.030000", clvCapturedAt: "2026-06-25T17:55:00.000Z" }),
  ], PAPER_COLUMNS);

  let out = "";
  const code = await runCli(["research-status"], {
    out: (text) => { out += text; },
    err: () => {},
    reportsDir,
    now: () => new Date("2026-06-28T12:00:00.000Z"),
    loadTheOddsKey: async () => { throw new Error("must not load key"); },
    createTheOddsClient: () => { throw new Error("must not create client"); },
  });

  assert.equal(code, 0);
  assert.match(out, /Research status: 5 VALUE CLV captured/);
  assert.match(out, /Main MATCH_RESULT VALUE CLV: 3/);
  assert.match(out, /Missing to 200: 195/);

  const csv = await readCsv(join(reportsDir, "research-status.csv"));
  const byKey = new Map(csv.map((row) => [`${row.scope}:${row.key}`, row]));
  assert.equal(byKey.get("overall:all").valueClvCaptured, "5");
  assert.equal(byKey.get("overall:all").valuePending, "1");
  assert.equal(byKey.get("overall:all").controlClvCaptured, "2");
  assert.equal(byKey.get("overall:all").uniqueSelectionCount, "7");
  assert.equal(byKey.get("overall:all").missingValueClvTo200, "195");
  assert.equal(byKey.get("main:MATCH_RESULT").valueClvCaptured, "3");
  assert.equal(byKey.get("main:MATCH_RESULT").uniqueSelectionCount, "4");
  assert.equal(byKey.get("market:TOTALS").valueClvCaptured, "1");
  assert.equal(byKey.get("market:BTTS").valueClvCaptured, "1");
  assert.equal(byKey.get("market:DRAW_NO_BET").controlClvCaptured, "1");
  assert.equal(byKey.get("market:DOUBLE_CHANCE").valueClvCaptured, "0");
  assert.equal(byKey.get("market:DOUBLE_CHANCE").uniqueSelectionCount, "0");

  const json = JSON.parse(await readFile(join(reportsDir, "research-status.json"), "utf8"));
  assert.equal(json.generatedAt, "2026-06-28T12:00:00.000Z");
  assert.equal(json.targets.valueClvCaptured.target200, 200);
  assert.equal(json.rows.length, csv.length);
});
