import { buildDataHealthReport } from "./data_health.mjs";
import { buildProfitabilityReport } from "./profitability_report.mjs";
import { buildCalibrationReport } from "./calibration_report.mjs";
import { buildStakingSimReport } from "./staking_sim.mjs";
import { summarizeLiveEfficiency } from "./profit_engine.mjs";

function pct(value) {
  return value === null || value === undefined ? "N/A" : `${(value * 100).toFixed(2)}%`;
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
  const staking = buildStakingSimReport({ rows: paperRows, generatedAt });
  const live = summarizeLiveEfficiency({ liveFeedStatsRows, liveTrainingRows });
  const blockers = [];
  if (!profitability.gates.valueMatchResultSettledReady) blockers.push("VALUE_MATCH_RESULT_SETTLED_BELOW_200");
  if (!profitability.gates.valueMatchResultClvReady) blockers.push("VALUE_MATCH_RESULT_CLV_BELOW_200");
  if (!profitability.gates.controlComparableReady) blockers.push("CONTROL_MATCH_RESULT_SETTLED_BELOW_200");
  if (dataHealth.summary.ERROR > 0) blockers.push("DATA_HEALTH_ERRORS_PRESENT");
  if (live.feedStatsRows > 0 && live.marketMessageRows === 0) blockers.push("LIVE_WS_HAS_NO_MARKET_MESSAGES");
  if (live.liquidityRows === 0) blockers.push("LIQUIDITY_NOT_MEASURED");

  const nextActions = ["RUN_PROFITABILITY_REPORT", "RUN_CALIBRATION_REPORT", "RUN_STAKING_SIM"];
  if (live.fallbackRecommended) nextActions.push("RUN_LIVE_UPDATED_POLL_FALLBACK");
  if (dataHealth.summary.ERROR > 0 || dataHealth.summary.WARN > 0) nextActions.push("RUN_DATA_HEALTH_REVIEW");

  const mode = blockers.length === 0 && profitability.gates.productionReady ? "PAPER_READY" : "RESEARCH_ONLY";
  const primaryValue = profitability.rows.find((row) =>
    row.scope === "primary" && row.key === "MATCH_RESULT|VALUE" && row.grain === "row");
  const primaryControl = profitability.rows.find((row) =>
    row.scope === "primary" && row.key === "MATCH_RESULT|CONTROL" && row.grain === "row");

  const markdown = [
    `# Daily Decision Report`,
    ``,
    `Generated: ${generatedAt}`,
    `Mode: ${mode}`,
    ``,
    `## Primary h2h`,
    `VALUE settled: ${primaryValue?.settled ?? 0}`,
    `VALUE ROI: ${pct(primaryValue?.roi)}`,
    `VALUE avg CLV: ${pct(primaryValue?.avgClv)}`,
    `CONTROL settled: ${primaryControl?.settled ?? 0}`,
    `CONTROL ROI: ${pct(primaryControl?.roi)}`,
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
    staking: staking.summary,
    live,
    markdown,
  };
}
