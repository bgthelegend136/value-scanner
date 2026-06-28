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
    referenceEventId: "event-1",
    bettableEventId: "bet-1",
    firstSeenAt: "2026-06-28T10:00:00.000Z",
    kickoffUtc: "2026-06-28T18:00:00.000Z",
    homeTeam: "Spain",
    awayTeam: "Italy",
    bookmaker: "Stoiximan",
    market: "MATCH_RESULT",
    line: "",
    outcome: "1",
    decimalOdds: "2.0000",
    fairOdds: "1.9000",
    fairProbability: "0.526316",
    ev: "0.030000",
    tier: "VALUE",
    stake: "1.00",
    status: "WON",
    homeScore: "2",
    awayScore: "1",
    profit: "1.0000",
    settledAt: "2026-06-28T20:00:00.000Z",
    closingFairOdds: "1.9417",
    clv: "0.030000",
    clvCapturedAt: "2026-06-28T17:40:00.000Z",
    sportKey: "soccer_fifa_world_cup",
    ...overrides,
  };
}

async function runOffline(command, reportsDir, extraArgs = []) {
  let out = "";
  const code = await runCli([command, ...extraArgs], {
    reportsDir,
    out: (text) => { out += text; },
    err: (text) => { out += text; },
    now: () => new Date("2026-06-28T13:00:00.000Z"),
    loadApiKey: async () => { throw new Error(`${command} must not load Odds-API.io key`); },
    loadTheOddsKey: async () => { throw new Error(`${command} must not load The Odds API key`); },
  });
  return { code, out };
}

test("data-health reports duplicate selections, invalid numbers, stale pending, and CLV timing", async () => {
  const reportsDir = await mkdtemp(join(tmpdir(), "data-health-"));
  await writeCsv(join(reportsDir, "paper-bets.csv"), [
    paperRow(),
    paperRow({ firstSeenAt: "2026-06-28T10:05:00.000Z" }),
    paperRow({ referenceEventId: "", decimalOdds: "bad", status: "WON", profit: "" }),
    paperRow({
      referenceEventId: "event-pending",
      status: "PENDING",
      profit: "",
      clv: "",
      clvCapturedAt: "",
      kickoffUtc: "2026-06-28T11:00:00.000Z",
    }),
    paperRow({
      referenceEventId: "event-early-clv",
      clvCapturedAt: "2026-06-28T15:00:00.000Z",
    }),
    paperRow({
      referenceEventId: "event-totals",
      market: "TOTALS",
      line: "2.5",
      outcome: "OVER",
    }),
  ], PAPER_COLUMNS);

  const { code, out } = await runOffline("data-health", reportsDir);

  assert.equal(code, 0);
  assert.match(out, /Data health:/u);

  const rows = await readCsv(join(reportsDir, "data-health.csv"));
  const codes = new Set(rows.map((row) => row.code));
  assert.ok(codes.has("DUPLICATE_SELECTION"));
  assert.ok(codes.has("MISSING_REQUIRED_FIELD"));
  assert.ok(codes.has("INVALID_DECIMAL_ODDS"));
  assert.ok(codes.has("SETTLED_MISSING_PROFIT"));
  assert.ok(codes.has("PENDING_PAST_KICKOFF"));
  assert.ok(codes.has("VALUE_PENDING_WITHOUT_CLV_AFTER_WINDOW"));
  assert.ok(codes.has("CLV_CAPTURE_TOO_EARLY"));
  assert.ok(codes.has("NON_PRIMARY_MARKET_EXCLUDED"));

  const json = JSON.parse(await readFile(join(reportsDir, "data-health.json"), "utf8"));
  assert.equal(json.generatedAt, "2026-06-28T13:00:00.000Z");
  assert.ok(json.summary.ERROR >= 3);
  assert.ok(json.summary.WARN >= 2);
  assert.ok(json.summary.INFO >= 1);
});

test("profitability-report gates production on VALUE h2h sample and excludes totals from primary readiness", async () => {
  const reportsDir = await mkdtemp(join(tmpdir(), "profitability-report-"));
  const rows = [
    paperRow({ referenceEventId: "value-1", profit: "1.0000", clv: "0.040000" }),
    paperRow({ referenceEventId: "value-2", outcome: "2", status: "LOST", profit: "-1.0000", clv: "0.020000" }),
    paperRow({ referenceEventId: "control-1", tier: "CONTROL", ev: "-0.010000", status: "LOST", profit: "-1.0000", clv: "-0.020000" }),
    paperRow({ referenceEventId: "total-1", market: "TOTALS", line: "2.5", outcome: "OVER", profit: "1.0000", clv: "0.100000" }),
  ];
  await writeCsv(join(reportsDir, "paper-bets.csv"), rows, PAPER_COLUMNS);

  const { code, out } = await runOffline("profitability-report", reportsDir);

  assert.equal(code, 0);
  assert.match(out, /Profitability report: RESEARCH_ONLY/u);

  const csv = await readCsv(join(reportsDir, "profitability-report.csv"));
  const primaryValue = csv.find((row) =>
    row.scope === "primary" && row.key === "MATCH_RESULT|VALUE");
  assert.equal(primaryValue.settled, "2");
  assert.equal(primaryValue.clvCaptured, "2");
  assert.equal(primaryValue.roi, "0.000000");

  const totalsValue = csv.find((row) =>
    row.scope === "market" && row.key === "TOTALS|VALUE");
  assert.equal(totalsValue.settled, "1");
  assert.equal(totalsValue.roi, "1.000000");

  const json = JSON.parse(await readFile(join(reportsDir, "profitability-report.json"), "utf8"));
  assert.equal(json.gates.productionReady, false);
  assert.equal(json.gates.valueMatchResultSettledReady, false);
  assert.equal(json.gates.valueMatchResultClvReady, false);
});

test("calibration-report writes EV bucket diagnostics, matched control comparison, and confidence", async () => {
  const reportsDir = await mkdtemp(join(tmpdir(), "calibration-report-"));
  await writeCsv(join(reportsDir, "paper-bets.csv"), [
    paperRow({ referenceEventId: "low-value", ev: "0.010000", clv: "0.005000", profit: "1.0000" }),
    paperRow({ referenceEventId: "high-value", ev: "0.080000", clv: "0.060000", profit: "1.0000" }),
    paperRow({ referenceEventId: "control", tier: "CONTROL", ev: "-0.010000", clv: "-0.020000", status: "LOST", profit: "-1.0000" }),
  ], PAPER_COLUMNS);

  const { code, out } = await runOffline("calibration-report", reportsDir);

  assert.equal(code, 0);
  assert.match(out, /Calibration report:/u);

  const csv = await readCsv(join(reportsDir, "calibration-report.csv"));
  assert.ok(csv.some((row) => row.scope === "evBucket" && row.key === "0..2%"));
  assert.ok(csv.some((row) => row.scope === "evBucket" && row.key === "5..10%"));
  assert.ok(csv.some((row) => row.scope === "matchedControl" && row.key === "MATCH_RESULT|1.50..2.00|0..360m"));

  const json = JSON.parse(await readFile(join(reportsDir, "calibration-report.json"), "utf8"));
  assert.equal(json.decision.modelStatus, "RANKING_SIGNAL");
  assert.ok(json.confidence.valueMatchResult.probabilityClvPositive > 0.5);
  assert.equal(json.monotonicity.status, "PASS");
});

test("calibration-report compares matched VALUE and CONTROL buckets and downgrades non-monotonic EV", async () => {
  const reportsDir = await mkdtemp(join(tmpdir(), "calibration-report-phase2-"));
  await writeCsv(join(reportsDir, "paper-bets.csv"), [
    paperRow({ referenceEventId: "low-value", ev: "0.010000", clv: "0.040000", profit: "1.0000" }),
    paperRow({ referenceEventId: "high-value", ev: "0.080000", clv: "-0.020000", status: "LOST", profit: "-1.0000" }),
    paperRow({ referenceEventId: "control-a", tier: "CONTROL", ev: "-0.010000", clv: "-0.020000", status: "LOST", profit: "-1.0000" }),
    paperRow({ referenceEventId: "control-b", tier: "CONTROL", ev: "-0.015000", clv: "-0.010000", status: "LOST", profit: "-1.0000" }),
  ], PAPER_COLUMNS);

  const { code } = await runOffline("calibration-report", reportsDir);

  assert.equal(code, 0);
  const json = JSON.parse(await readFile(join(reportsDir, "calibration-report.json"), "utf8"));
  assert.equal(json.monotonicity.status, "FAIL");
  assert.equal(json.decision.modelStatus, "RANKING_SIGNAL");
  assert.ok(json.matchedControlComparisons.some((row) =>
    row.key === "MATCH_RESULT|1.50..2.00|0..360m" &&
    row.valueCount === 2 &&
    row.controlCount === 2 &&
    row.clvSeparation > 0));
});

test("staking-sim simulates flat and capped Kelly policies without enabling real staking", async () => {
  const reportsDir = await mkdtemp(join(tmpdir(), "staking-sim-"));
  await writeCsv(join(reportsDir, "paper-bets.csv"), [
    paperRow({ referenceEventId: "win-1", decimalOdds: "2.0000", ev: "0.050000", profit: "1.0000" }),
    paperRow({ referenceEventId: "loss-1", decimalOdds: "2.0000", ev: "0.050000", outcome: "2", status: "LOST", profit: "-1.0000" }),
    paperRow({ referenceEventId: "control-1", tier: "CONTROL", ev: "-0.010000", status: "WON", profit: "1.0000" }),
  ], PAPER_COLUMNS);

  const { code, out } = await runOffline("staking-sim", reportsDir, [
    "--bankroll=1000",
    "--policy=flat",
    "--max-stake=10",
  ]);

  assert.equal(code, 0);
  assert.match(out, /Staking sim: RESEARCH_ONLY/u);

  const csv = await readCsv(join(reportsDir, "staking-sim.csv"));
  const summary = csv.find((row) => row.scope === "summary" && row.key === "flat");
  assert.equal(summary.bets, "2");
  assert.equal(summary.finalBankroll, "1000.000000");
  assert.equal(summary.realStakingEnabled, "false");

  const json = JSON.parse(await readFile(join(reportsDir, "staking-sim.json"), "utf8"));
  assert.equal(json.realStakingEnabled, false);
  assert.equal(json.policy, "flat");
  assert.equal(json.summary.maxDrawdown, 10);
});

test("staking-sim enforces daily exposure cap and writes exposure/risk diagnostics", async () => {
  const reportsDir = await mkdtemp(join(tmpdir(), "staking-sim-phase2-"));
  await writeCsv(join(reportsDir, "paper-bets.csv"), [
    paperRow({ referenceEventId: "same-day-win", firstSeenAt: "2026-06-28T10:00:00.000Z", decimalOdds: "2.0000", ev: "0.200000", profit: "1.0000" }),
    paperRow({ referenceEventId: "same-day-loss", firstSeenAt: "2026-06-28T10:05:00.000Z", decimalOdds: "2.0000", ev: "0.200000", outcome: "2", status: "LOST", profit: "-1.0000" }),
    paperRow({ referenceEventId: "next-day-loss", firstSeenAt: "2026-06-29T10:00:00.000Z", decimalOdds: "2.0000", ev: "0.200000", outcome: "2", status: "LOST", profit: "-1.0000" }),
  ], PAPER_COLUMNS);

  const { code } = await runOffline("staking-sim", reportsDir, [
    "--bankroll=1000",
    "--policy=kelly25",
    "--max-stake=100",
    "--daily-exposure-pct=5",
  ]);

  assert.equal(code, 0);
  const csv = await readCsv(join(reportsDir, "staking-sim.csv"));
  const summary = csv.find((row) => row.scope === "summary" && row.key === "kelly25");
  assert.equal(summary.maxDailyExposure, "50.000000");
  assert.equal(summary.maxDailyExposurePct, "0.050000");
  assert.equal(summary.realStakingEnabled, "false");
  assert.ok(Number(summary.probabilityDrawdown20) >= 0);

  assert.ok(csv.some((row) =>
    row.scope === "dailyExposure" &&
    row.key === "2026-06-28" &&
    row.totalStaked === "50.000000"));
  assert.ok(csv.some((row) =>
    row.scope === "marketExposure" &&
    row.key === "MATCH_RESULT" &&
    row.totalStaked === "100.000000"));

  const json = JSON.parse(await readFile(join(reportsDir, "staking-sim.json"), "utf8"));
  assert.equal(json.summary.maxDailyExposure, 50);
  assert.equal(json.exposure.daily[0].date, "2026-06-28");
  assert.equal(json.risk.realStakingEnabled, false);
});

test("daily-decision-report summarizes blockers and next action from offline reports", async () => {
  const reportsDir = await mkdtemp(join(tmpdir(), "daily-decision-report-"));
  await writeCsv(join(reportsDir, "paper-bets.csv"), [
    paperRow({ referenceEventId: "value-1", clv: "0.040000", profit: "1.0000" }),
    paperRow({ referenceEventId: "control-1", tier: "CONTROL", ev: "-0.010000", clv: "-0.020000", status: "LOST", profit: "-1.0000" }),
  ], PAPER_COLUMNS);
  await writeCsv(join(reportsDir, "ws-live-feed-stats.csv"), [
    { observedAt: "2026-06-28T12:00:00Z", messageType: "welcome", seq: "", providerEventId: "", bookmaker: "", markets: "", auditRows: "0", trainingRows: "0", closedRows: "0", rejectionReasons: "" },
  ], ["observedAt", "messageType", "seq", "providerEventId", "bookmaker", "markets", "auditRows", "trainingRows", "closedRows", "rejectionReasons"]);

  const { code, out } = await runOffline("daily-decision-report", reportsDir);

  assert.equal(code, 0);
  assert.match(out, /Daily decision report: RESEARCH_ONLY/u);

  const markdown = await readFile(join(reportsDir, "daily-decision-report.md"), "utf8");
  assert.match(markdown, /Mode: RESEARCH_ONLY/u);
  assert.match(markdown, /VALUE_MATCH_RESULT_SETTLED_BELOW_200/u);
  assert.match(markdown, /RUN_LIVE_UPDATED_POLL_FALLBACK/u);

  const json = JSON.parse(await readFile(join(reportsDir, "daily-decision-report.json"), "utf8"));
  assert.equal(json.mode, "RESEARCH_ONLY");
  assert.ok(json.blockers.includes("VALUE_MATCH_RESULT_SETTLED_BELOW_200"));
  assert.ok(json.nextActions.includes("RUN_PROFITABILITY_REPORT"));
});

test("daily-decision-report treats updated-poll rows as active live fallback instead of recommending fallback again", async () => {
  const reportsDir = await mkdtemp(join(tmpdir(), "daily-decision-live-fallback-"));
  await writeCsv(join(reportsDir, "paper-bets.csv"), [
    paperRow({ referenceEventId: "value-1", clv: "0.040000", profit: "1.0000" }),
  ], PAPER_COLUMNS);
  await writeCsv(join(reportsDir, "ws-live-feed-stats.csv"), [
    { observedAt: "2026-06-28T12:00:00Z", messageType: "welcome", seq: "", providerEventId: "", bookmaker: "", markets: "", auditRows: "0", trainingRows: "0", closedRows: "0", rejectionReasons: "" },
    { observedAt: "2026-06-28T12:01:00Z", messageType: "updated_poll", seq: "", providerEventId: "live-1", bookmaker: "Stoiximan", markets: "MATCH_RESULT", auditRows: "0", trainingRows: "1", closedRows: "0", rejectionReasons: "" },
  ], ["observedAt", "messageType", "seq", "providerEventId", "bookmaker", "markets", "auditRows", "trainingRows", "closedRows", "rejectionReasons"]);
  await writeCsv(join(reportsDir, "live-training-observations.csv"), [
    {
      observedAt: "2026-06-28T12:01:00Z",
      seq: "",
      providerEventId: "live-1",
      referenceEventId: "",
      sportKey: "",
      liveStatus: "",
      homeScore: "",
      awayScore: "",
      bookmaker: "Stoiximan",
      match: "Spain - Italy",
      market: "MATCH_RESULT",
      line: "",
      outcome: "1",
      offeredOdds: "2.0000",
      maxBet: "",
      pinnacleFairProbability: "",
      pinnacleFairOdds: "",
      pinnacleEv: "",
      consensusFairProbability: "",
      consensusFairOdds: "",
      consensusEv: "",
      consensusBooks: "",
      minimumConfirmedEv: "",
      edgeOverDispersion: "",
      sampleTier: "LIVE_UNCONFIRMED",
      confirmationStatus: "UNCONFIRMED",
      rejectionReason: "",
      source: "updated_poll",
    },
  ], [
    "observedAt", "seq", "providerEventId", "referenceEventId", "sportKey",
    "liveStatus", "homeScore", "awayScore", "bookmaker", "match", "market",
    "line", "outcome", "offeredOdds", "maxBet", "pinnacleFairProbability",
    "pinnacleFairOdds", "pinnacleEv", "consensusFairProbability",
    "consensusFairOdds", "consensusEv", "consensusBooks", "minimumConfirmedEv",
    "edgeOverDispersion", "sampleTier", "confirmationStatus", "rejectionReason",
    "source",
  ]);

  const { code } = await runOffline("daily-decision-report", reportsDir);

  assert.equal(code, 0);
  const markdown = await readFile(join(reportsDir, "daily-decision-report.md"), "utf8");
  assert.match(markdown, /Live source: updated_poll/u);
  assert.match(markdown, /Fallback active: true/u);
  assert.doesNotMatch(markdown, /RUN_LIVE_UPDATED_POLL_FALLBACK/u);

  const json = JSON.parse(await readFile(join(reportsDir, "daily-decision-report.json"), "utf8"));
  assert.equal(json.live.fallbackActive, true);
  assert.equal(json.live.fallbackRecommended, false);
  assert.equal(json.live.updatedPollTrainingRows, 1);
  assert.equal(json.live.liveDataSource, "updated_poll");
  assert.ok(!json.nextActions.includes("RUN_LIVE_UPDATED_POLL_FALLBACK"));
});

test("profit-engine reports live fallback status and source counts", async () => {
  const reportsDir = await mkdtemp(join(tmpdir(), "profit-engine-live-fallback-"));
  await writeCsv(join(reportsDir, "paper-bets.csv"), [
    paperRow({ referenceEventId: "value-1", clv: "0.040000", profit: "1.0000" }),
  ], PAPER_COLUMNS);
  await writeCsv(join(reportsDir, "ws-live-feed-stats.csv"), [
    { observedAt: "2026-06-28T12:00:00Z", messageType: "welcome", seq: "", providerEventId: "", bookmaker: "", markets: "", auditRows: "0", trainingRows: "0", closedRows: "0", rejectionReasons: "" },
    { observedAt: "2026-06-28T12:01:00Z", messageType: "updated_poll", seq: "", providerEventId: "live-1", bookmaker: "Stoiximan", markets: "MATCH_RESULT", auditRows: "0", trainingRows: "1", closedRows: "0", rejectionReasons: "" },
  ], ["observedAt", "messageType", "seq", "providerEventId", "bookmaker", "markets", "auditRows", "trainingRows", "closedRows", "rejectionReasons"]);
  await writeCsv(join(reportsDir, "live-training-observations.csv"), [
    { source: "updated_poll", maxBet: "", market: "MATCH_RESULT" },
  ], ["source", "maxBet", "market"]);

  const { code } = await runOffline("profit-engine", reportsDir);

  assert.equal(code, 0);
  const json = JSON.parse(await readFile(join(reportsDir, "profit-engine-report.json"), "utf8"));
  assert.equal(json.live.fallbackActive, true);
  assert.equal(json.live.fallbackRecommended, false);
  assert.equal(json.live.updatedPollRows, 1);
  assert.equal(json.live.updatedPollTrainingRows, 1);
  assert.equal(json.live.liveDataSource, "updated_poll");
});
