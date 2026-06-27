import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runCli } from "../src/cli.mjs";
import { writeCsv, readCsv } from "../src/csv.mjs";
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
    sportKey: "soccer_fifa_world_cup",
    ...overrides,
  };
}

test("value-flow-report summarizes local CSVs without loading API keys", async () => {
  const reportsDir = await mkdtemp(join(tmpdir(), "value-flow-"));
  await writeCsv(join(reportsDir, "paper-bets.csv"), [
    paperRow({ bookmaker: "Stoiximan", status: "WON", profit: "6.5000", clv: "0.200000", clvCapturedAt: "2026-06-25T17:55:00.000Z" }),
    paperRow({ referenceEventId: "ref2", bettableEventId: "998", bookmaker: "Novibet", status: "PENDING", clv: "-0.050000", clvCapturedAt: "2026-06-25T17:55:00.000Z" }),
  ], PAPER_COLUMNS);
  await writeCsv(join(reportsDir, "mispricing-audit.csv"), [
    { auditedAt: "2026-06-25T12:00:00Z", runMode: "LIVE", candidateId: "c1", bookmaker: "Stoiximan", status: "REJECTED", reason: "CANDIDATE_EV_BELOW_MIN" },
    { auditedAt: "2026-06-25T12:01:00Z", runMode: "LIVE", candidateId: "c2", bookmaker: "Novibet", status: "REJECTED", reason: "UNMAPPED_SPORT_LEAGUE" },
    { auditedAt: "2026-06-25T12:02:00Z", runMode: "LIVE", candidateId: "c3", bookmaker: "Stoiximan", status: "CONFIRMED", reason: "" },
  ], ["auditedAt", "runMode", "candidateId", "bookmaker", "status", "reason"]);
  await writeCsv(join(reportsDir, "scan-all-2026-06-25T12-00-00.000Z.csv"), [
    { bookmaker: "Stoiximan", ev: "0.0320", status: "VALUE" },
    { bookmaker: "Novibet", ev: "0.0100", status: "NO_VALUE" },
  ], ["bookmaker", "ev", "status"]);

  let out = "";
  const code = await runCli(["value-flow-report"], {
    out: (text) => { out += text; },
    err: () => {},
    reportsDir,
    loadApiKey: async () => { throw new Error("must not load Odds-API.io key"); },
    loadTheOddsKey: async () => { throw new Error("must not load The Odds API key"); },
  });

  assert.equal(code, 0);
  assert.match(out, /Value-flow report: paper=2, audit=3, latestScanRows=2/);
  assert.match(out, /Top rejection: CANDIDATE_EV_BELOW_MIN \(1\)/);

  const rows = await readCsv(join(reportsDir, "value-flow-report.csv"));
  assert.ok(rows.some((row) => row.scope === "paper" && row.key === "total" && row.value === "2"));
  assert.ok(rows.some((row) => row.scope === "paper.bookmaker" && row.key === "Novibet" && row.value === "1"));
  assert.ok(rows.some((row) => row.scope === "audit.reason" && row.key === "UNMAPPED_SPORT_LEAGUE" && row.value === "1"));
  assert.ok(rows.some((row) => row.scope === "scan.latest" && row.key === "maxEv" && row.value === "0.0320"));

  const json = JSON.parse(await readFile(join(reportsDir, "value-flow-report.json"), "utf8"));
  assert.equal(json.paper.total, 2);
  assert.equal(json.audit.total, 3);
  assert.equal(json.latestScan.rows, 2);
});
