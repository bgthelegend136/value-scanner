import { buildDataHealthReport } from "./data_health.mjs";
import { buildProfitabilityReport } from "./profitability_report.mjs";
import { buildCalibrationReport } from "./calibration_report.mjs";
import { buildOutcomeCalibrationReport } from "./outcome_calibration.mjs";
import { buildStakingSimReport } from "./staking_sim.mjs";
import { summarizeLiveEfficiency } from "./profit_engine.mjs";

const SETTLED_STATUSES = new Set(["WON", "LOST", "PUSH", "HALF_WON", "HALF_LOST"]);
// Above this many already-played-but-unsettled bets, settlement is falling behind
// the scanner and the realized-outcome sample is being starved.
const SETTLEMENT_BACKLOG_LIMIT = 150;
// classwise-ECE only becomes meaningful with a large sample, so this only guards
// go-live once the VALUE h2h gate sample is itself large enough.
const VALUE_OUTCOME_ECE_LIMIT = 0.08;

function pct(value) {
  return value === null || value === undefined ? "N/A" : `${(value * 100).toFixed(2)}%`;
}

function num(value) {
  return value === null || value === undefined ? "N/A" : Number(value).toFixed(4);
}

export function buildDailyDecisionReport({
  generatedAt = new Date().toISOString(),
  paperRows = [],
  liveFeedStatsRows = [],
  liveTrainingRows = [],
  now = new Date(),
} = {}) {
  const dataHealth = buildDataHealthReport({ rows: paperRows, generatedAt, now });
  const profitability = buildProfitabilityReport({ rows: paperRows, generatedAt });
  const calibration = buildCalibrationReport({ rows: paperRows, generatedAt });
  const outcome = buildOutcomeCalibrationReport({ rows: paperRows, generatedAt });
  const staking = buildStakingSimReport({ rows: paperRows, generatedAt });
  const live = summarizeLiveEfficiency({ liveFeedStatsRows, liveTrainingRows });

  const nowMs = now.getTime();
  let settledCount = 0;
  let pendingTotal = 0;
  let pendingPlayable = 0;
  for (const row of paperRows) {
    if (row.status === "PENDING") {
      pendingTotal += 1;
      const kickoff = Date.parse(row.kickoffUtc);
      if (Number.isFinite(kickoff) && kickoff < nowMs) pendingPlayable += 1;
    } else if (SETTLED_STATUSES.has(row.status)) {
      settledCount += 1;
    }
  }
  const settlementCoverage = settledCount + pendingPlayable > 0
    ? settledCount / (settledCount + pendingPlayable)
    : null;
  const valueOutcome = outcome.valueMatchResult ?? {};
  const controlOutcome = outcome.controlMatchResult ?? {};

  const blockers = [];
  if (!profitability.gates.valueMatchResultSettledReady) blockers.push("VALUE_MATCH_RESULT_SETTLED_BELOW_200");
  if (!profitability.gates.valueMatchResultClvReady) blockers.push("VALUE_MATCH_RESULT_CLV_BELOW_200");
  if (!profitability.gates.controlComparableReady) blockers.push("CONTROL_MATCH_RESULT_SETTLED_BELOW_200");
  if (dataHealth.summary.ERROR > 0) blockers.push("DATA_HEALTH_ERRORS_PRESENT");
  if (live.feedStatsRows > 0 && live.marketMessageRows === 0) blockers.push("LIVE_WS_HAS_NO_MARKET_MESSAGES");
  if (live.liquidityRows === 0) blockers.push("LIQUIDITY_NOT_MEASURED");
  if (pendingPlayable > SETTLEMENT_BACKLOG_LIMIT) blockers.push("SETTLEMENT_COVERAGE_LOW");
  if ((valueOutcome.n ?? 0) >= 200 && (valueOutcome.ece ?? 0) > VALUE_OUTCOME_ECE_LIMIT) {
    blockers.push("VALUE_OUTCOME_MISCALIBRATED");
  }

  const nextActions = [
    "RUN_PROFITABILITY_REPORT",
    "RUN_CALIBRATION_REPORT",
    "RUN_OUTCOME_CALIBRATION_REPORT",
    "RUN_STAKING_SIM",
  ];
  if (live.fallbackRecommended) nextActions.push("RUN_LIVE_UPDATED_POLL_FALLBACK");
  if (dataHealth.summary.ERROR > 0 || dataHealth.summary.WARN > 0) nextActions.push("RUN_DATA_HEALTH_REVIEW");
  if (pendingPlayable > 0) nextActions.push("SETTLE_PLAYABLE_PENDING");

  const mode = blockers.length === 0 && profitability.gates.productionReady ? "PAPER_READY" : "RESEARCH_ONLY";
  const primaryValue = profitability.rows.find((row) =>
    row.scope === "primary" && row.key === "MATCH_RESULT|VALUE" && row.grain === "row");
  const primaryValueCheck = profitability.rows.find((row) =>
    row.scope === "primary" && row.key === "MATCH_RESULT|VALUE_CHECK" && row.grain === "row");
  const overallValue = profitability.rows.find((row) =>
    row.scope === "overall" && row.key === "all|VALUE" && row.grain === "row");
  const overallValueCheck = profitability.rows.find((row) =>
    row.scope === "overall" && row.key === "all|VALUE_CHECK" && row.grain === "row");
  const primaryControl = profitability.rows.find((row) =>
    row.scope === "primary" && row.key === "MATCH_RESULT|CONTROL" && row.grain === "row");

  const markdown = [
    `# Daily Decision Report`,
    ``,
    `Generated: ${generatedAt}`,
    `Mode: ${mode}`,
    ``,
    `## Primary h2h`,
    `VALUE gate settled: ${primaryValue?.settled ?? 0}`,
    `VALUE ROI: ${pct(primaryValue?.roi)}`,
    `VALUE avg CLV: ${pct(primaryValue?.avgClv)}`,
    `VALUE_CHECK h2h settled: ${primaryValueCheck?.settled ?? 0}`,
    `VALUE_CHECK h2h ROI: ${pct(primaryValueCheck?.roi)}`,
    `CONTROL settled: ${primaryControl?.settled ?? 0}`,
    `CONTROL ROI: ${pct(primaryControl?.roi)}`,
    `All-market VALUE settled: ${overallValue?.settled ?? 0}`,
    `All-market VALUE_CHECK settled: ${overallValueCheck?.settled ?? 0}`,
    ``,
    `## Live`,
    `Feed rows: ${live.feedStatsRows}`,
    `Market messages: ${live.marketMessageRows}`,
    `Training rows: ${live.trainingRows}`,
    `Updated-poll rows: ${live.updatedPollRows ?? 0}`,
    `Updated-poll training rows: ${live.updatedPollTrainingRows ?? 0}`,
    `Live source: ${live.liveDataSource}`,
    `Fallback active: ${live.fallbackActive}`,
    `Fallback recommended: ${live.fallbackRecommended}`,
    ``,
    `## Outcome calibration`,
    `VALUE h2h settled: ${valueOutcome.n ?? 0}`,
    `VALUE win-rate: ${pct(valueOutcome.winRate)}`,
    `VALUE avg implied: ${pct(valueOutcome.avgProb)}`,
    `VALUE calibration gap: ${pct(valueOutcome.calibrationGap)}`,
    `VALUE ECE: ${num(valueOutcome.ece)}`,
    `CONTROL calibration gap: ${pct(controlOutcome.calibrationGap)}`,
    ``,
    `## Settlement`,
    `Settled: ${settledCount}`,
    `Pending: ${pendingTotal} (already played: ${pendingPlayable})`,
    `Settlement coverage: ${pct(settlementCoverage)}`,
    ``,
    `## Blockers`,
    ...(blockers.length ? blockers.map((item) => `- ${item}`) : ["- none"]),
    ``,
    `## Next Actions`,
    ...nextActions.map((item) => `- ${item}`),
    ``,
  ].join("\n");

  return {
    generatedAt,
    mode,
    blockers,
    nextActions,
    dataHealth: dataHealth.summary,
    profitability: profitability.gates,
    calibration: calibration.decision,
    outcomeCalibration: {
      sampleCount: outcome.sampleCount,
      valueMatchResult: valueOutcome,
      controlMatchResult: controlOutcome,
    },
    settlement: { settled: settledCount, pending: pendingTotal, pendingPlayable, coverage: settlementCoverage },
    staking: staking.summary,
    live,
    markdown,
  };
}
