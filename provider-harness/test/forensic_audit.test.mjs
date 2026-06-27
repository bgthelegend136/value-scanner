import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildAuditReport,
  runForensicAudit,
} from "../scripts/forensic-audit.mjs";
import { runCli } from "../src/cli.mjs";
import { readCsv, writeCsv } from "../src/csv.mjs";
import { PAPER_COLUMNS } from "../src/paper.mjs";

function paperRow(overrides = {}) {
  return {
    referenceEventId: "ref-1",
    bettableEventId: "bet-1",
    firstSeenAt: "2026-06-27T10:00:00.000Z",
    kickoffUtc: "2026-06-27T18:00:00.000Z",
    homeTeam: "Japan",
    awayTeam: "Sweden",
    bookmaker: "Stoiximan",
    market: "MATCH_RESULT",
    line: "",
    outcome: "1",
    decimalOdds: "2.1000",
    fairOdds: "2.0000",
    fairProbability: "0.500000",
    ev: "0.050000",
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

function scanRow(overrides = {}) {
  return {
    bookmaker: "Stoiximan",
    eventId: "bet-1",
    kickoffUtc: "2026-06-27T18:00:00.000Z",
    homeTeam: "Japan",
    awayTeam: "Sweden",
    market: "MATCH_RESULT",
    line: "",
    outcome: "1",
    decimalOdds: "2.1000",
    fairOdds: "2.0000",
    fairProbability: "0.5000",
    ev: "0.0500",
    status: "VALUE",
    ...overrides,
  };
}

test("forensic audit separates row volume from independent evidence", async () => {
  const reportsDir = await mkdtemp(join(tmpdir(), "forensic-audit-"));
  await writeCsv(join(reportsDir, "paper-bets.csv"), [
    paperRow({ firstSeenAt: "2026-06-27T10:00:00.000Z", clv: "0.020000", clvCapturedAt: "2026-06-27T17:40:00.000Z" }),
    paperRow({ firstSeenAt: "2026-06-27T11:00:00.000Z" }),
    paperRow({
      referenceEventId: "ref-2",
      bettableEventId: "bet-2",
      market: "TOTALS",
      line: "2.5",
      outcome: "OVER",
      tier: "CONTROL",
      ev: "-0.020000",
      status: "WON",
      profit: "1.1000",
    }),
  ], PAPER_COLUMNS);
  await writeCsv(join(reportsDir, "scan-all-2026-06-27T10-00-00.000Z.csv"), [
    scanRow(),
    scanRow({ market: "TOTALS", line: "2.5", outcome: "OVER", ev: "-0.0200", status: "NO_VALUE" }),
  ], Object.keys(scanRow()));
  await writeCsv(join(reportsDir, "mispricing-audit.csv"), [
    { status: "REJECTED", reason: "CANDIDATE_EV_BELOW_MIN" },
    { status: "REJECTED", reason: "UNMAPPED_SPORT_LEAGUE" },
  ], ["status", "reason"]);
  await writeCsv(join(reportsDir, "live-event-status.csv"), [
    { observedAt: "2026-06-27T12:00:00Z", providerEventId: "live-1", eventStatus: "score", homeScore: "1", awayScore: "0" },
  ], ["observedAt", "providerEventId", "eventStatus", "homeScore", "awayScore"]);
  await writeCsv(join(reportsDir, "ws-live-feed-stats.csv"), [
    { observedAt: "2026-06-27T12:00:00Z", messageType: "score", bookmaker: "", markets: "", auditRows: "0", trainingRows: "0" },
  ], ["observedAt", "messageType", "bookmaker", "markets", "auditRows", "trainingRows"]);

  const report = await buildAuditReport({
    reportsDir,
    now: () => new Date("2026-06-27T12:30:00.000Z"),
    processProvider: async () => [
      { pid: 101, commandLine: "node scripts/ws-lifetime-probe.mjs --live-training --markets=ML,Totals" },
      { pid: 202, commandLine: "node scripts/ws-lifetime-probe.mjs --live-shadow" },
    ],
    taskProvider: async () => [
      { taskName: "Bet-Live-Shadow", state: "Running", lastTaskResult: 267009 },
    ],
  });

  assert.equal(report.paper.totalRows, 3);
  assert.equal(report.paper.uniqueSelectionKeys, 2);
  assert.equal(report.paper.repeatedObservationRows, 1);
  assert.equal(report.paper.clvCaptured, 1);
  assert.equal(report.paper.settled, 1);
  assert.equal(report.live.statusRows, 1);
  assert.equal(report.live.trainingRows, 0);
  assert.equal(report.live.feedStatsRows, 1);
  assert.equal(report.live.feedStatsByType.score, 1);
  assert.equal(report.runtime.websocketProbeProcesses, 2);
  assert.ok(report.findings.some((finding) => finding.code === "ROW_VOLUME_NOT_INDEPENDENT"));
  assert.ok(report.findings.some((finding) => finding.code === "LIVE_STATUS_WITHOUT_TRAINING"));
  assert.ok(report.findings.some((finding) => finding.code === "MULTIPLE_WEBSOCKET_PROBES"));
  assert.doesNotMatch(JSON.stringify(report), /secret|apiKey|sk-/i);
});

test("forensic audit caps paid probes at the requested credit budget", async () => {
  const reportsDir = await mkdtemp(join(tmpdir(), "forensic-budget-"));
  await writeCsv(join(reportsDir, "paper-bets.csv"), [
    paperRow({ sportKey: "soccer_fifa_world_cup" }),
    paperRow({ referenceEventId: "ref-2", bettableEventId: "bet-2", sportKey: "soccer_brazil_campeonato" }),
    paperRow({ referenceEventId: "ref-3", bettableEventId: "bet-3", sportKey: "soccer_spain_la_liga" }),
  ], PAPER_COLUMNS);

  const calls = [];
  const report = await buildAuditReport({
    reportsDir,
    maxCredits: 65,
    now: () => new Date("2026-06-27T12:30:00.000Z"),
    processProvider: async () => [],
    taskProvider: async () => [],
    referenceClient: {
      async getOdds({ sportKey, markets }) {
        calls.push({ sportKey, markets });
        return {
          data: [],
          receivedAt: "2026-06-27T12:30:00.000Z",
          quota: { remaining: 15900, lastCost: 30 },
        };
      },
    },
  });

  assert.equal(calls.length, 2);
  assert.equal(report.paidProbes.maxCredits, 65);
  assert.equal(report.paidProbes.estimatedCreditsUsed, 60);
  assert.equal(report.paidProbes.skipped.length, 1);
  assert.ok(report.findings.some((finding) => finding.code === "PAID_PROBE_BUDGET_STOP"));
});

test("forensic audit writes reports without modifying source ledgers", async () => {
  const reportsDir = await mkdtemp(join(tmpdir(), "forensic-output-"));
  const ledgerPath = join(reportsDir, "paper-bets.csv");
  await writeCsv(ledgerPath, [paperRow()], PAPER_COLUMNS);
  const before = await stat(ledgerPath);

  const code = await runForensicAudit({
    argv: [`--reports-dir=${reportsDir}`, "--max-credits=0"],
    now: () => new Date("2026-06-27T12:30:00.000Z"),
    out: () => {},
    err: () => {},
    processProvider: async () => [],
    taskProvider: async () => [],
  });

  assert.equal(code, 0);
  const after = await stat(ledgerPath);
  assert.equal(after.mtimeMs, before.mtimeMs);

  const findings = await readCsv(join(reportsDir, "forensic-audit-findings.csv"));
  assert.ok(Array.isArray(findings));
  const summary = JSON.parse(await readFile(join(reportsDir, "forensic-audit-summary.json"), "utf8"));
  assert.equal(summary.paidProbes.maxCredits, 0);
  const markdown = await readFile(join(reportsDir, "forensic-audit-report.md"), "utf8");
  assert.match(markdown, /Forensic Audit Report/u);
  assert.match(markdown, /Official API Constraints/u);
});

test("cli exposes forensic-audit with a zero-credit default", async () => {
  const reportsDir = await mkdtemp(join(tmpdir(), "forensic-cli-"));
  await writeCsv(join(reportsDir, "paper-bets.csv"), [paperRow()], PAPER_COLUMNS);

  let out = "";
  const code = await runCli(["forensic-audit"], {
    reportsDir,
    out: (text) => { out += text; },
    err: () => {},
    now: () => new Date("2026-06-27T12:30:00.000Z"),
    loadTheOddsKey: async () => { throw new Error("default forensic-audit must not spend credits"); },
  });

  assert.equal(code, 0);
  assert.match(out, /Forensic audit:/u);
  const summary = JSON.parse(await readFile(join(reportsDir, "forensic-audit-summary.json"), "utf8"));
  assert.equal(summary.paidProbes.maxCredits, 0);
});
