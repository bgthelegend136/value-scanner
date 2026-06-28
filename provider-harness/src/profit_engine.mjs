import {
  summarizeClvCalibration,
  summarizePaperBets,
  summarizeResearchStatus,
} from "./paper.mjs";
import { quarantineReportRows } from "./report_domain.mjs";
import { kellyStake } from "./staking.mjs";

const VALUE_TIERS = new Set(["VALUE", "VALUE_CHECK", "SUSPICIOUS"]);
const MARKET_MESSAGE_TYPES = new Set(["created", "updated", "deleted", "no_markets"]);
const CANDIDATE_MESSAGE_TYPES = new Set(["created", "updated"]);

function optionalNumber(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sumNumeric(rows, key) {
  return rows.reduce((sum, row) => sum + (optionalNumber(row[key]) ?? 0), 0);
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function calibrationRow(calibration, scope, key) {
  return calibration.rows.find((row) => row.scope === scope && row.key === key) ?? null;
}

function valueClvRows(rows) {
  return rows.filter((row) =>
    VALUE_TIERS.has(String(row.tier ?? "")) &&
    optionalNumber(row.clv) !== null);
}

function isSettled(row) {
  return ["WON", "LOST", "PUSH", "HALF_WON", "HALF_LOST"].includes(String(row.status ?? ""));
}

function valueSettledRows(rows) {
  return rows.filter((row) => VALUE_TIERS.has(String(row.tier ?? "")) && isSettled(row));
}

function controlClvRows(rows) {
  return rows.filter((row) =>
    String(row.tier ?? "") === "CONTROL" &&
    optionalNumber(row.clv) !== null);
}

function averageClv(rows) {
  return average(rows
    .map((row) => optionalNumber(row.clv))
    .filter((value) => value !== null));
}

function stakeFractions(rows, { kellyFraction, stakeCapFraction }) {
  return rows
    .map((row) => {
      const offeredOdds = optionalNumber(row.decimalOdds);
      const edge = optionalNumber(row.ev);
      if (offeredOdds === null || edge === null) return null;
      return kellyStake({
        offeredOdds,
        edge,
        fraction: kellyFraction,
        cap: stakeCapFraction,
      });
    })
    .filter((value) => value !== null);
}

export function summarizeLiveEfficiency({
  liveFeedStatsRows = [],
  liveStatusRows = [],
  liveTrainingRows = [],
  liveAuditRows = [],
  lifetimeRows = [],
} = {}) {
  const maxBetValues = liveTrainingRows
    .map((row) => optionalNumber(row.maxBet))
    .filter((value) => value !== null);
  const marketMessageRows = liveFeedStatsRows.filter((row) =>
    MARKET_MESSAGE_TYPES.has(String(row.messageType ?? ""))).length;
  const updatedPollRows = liveFeedStatsRows.filter((row) =>
    String(row.messageType ?? "") === "updated_poll").length;
  const updatedPollTrainingRows = liveTrainingRows.filter((row) =>
    String(row.source ?? "") === "updated_poll").length;
  const candidateMessageRows = liveFeedStatsRows.filter((row) =>
    CANDIDATE_MESSAGE_TYPES.has(String(row.messageType ?? ""))).length;
  const trainingRowsFromFeed = sumNumeric(liveFeedStatsRows, "trainingRows");
  const auditRowsFromFeed = sumNumeric(liveFeedStatsRows, "auditRows");
  const closedRowsFromFeed = sumNumeric(liveFeedStatsRows, "closedRows");
  const trainingRows = Math.max(liveTrainingRows.length, trainingRowsFromFeed);
  const auditRows = Math.max(liveAuditRows.length, auditRowsFromFeed);
  const lifetimeCount = Math.max(lifetimeRows.length, closedRowsFromFeed);
  const fallbackActive = updatedPollRows > 0 || updatedPollTrainingRows > 0;
  const fallbackRecommended = liveFeedStatsRows.length > 0 && marketMessageRows === 0 && !fallbackActive;
  const liveDataSource = marketMessageRows > 0 && fallbackActive
    ? "mixed"
    : fallbackActive
      ? "updated_poll"
      : marketMessageRows > 0
        ? "websocket"
        : "none";

  return {
    feedStatsRows: liveFeedStatsRows.length,
    statusRows: liveStatusRows.length,
    trainingRows,
    auditRows,
    lifetimeRows: lifetimeCount,
    marketMessageRows,
    candidateMessageRows,
    scoreRows: liveFeedStatsRows.filter((row) => row.messageType === "score").length,
    statusMessageRows: liveFeedStatsRows.filter((row) => row.messageType === "status").length,
    welcomeRows: liveFeedStatsRows.filter((row) => row.messageType === "welcome").length,
    updatedPollRows,
    updatedPollTrainingRows,
    fallbackActive,
    fallbackRecommended,
    liveDataSource,
    liquidityRows: maxBetValues.length,
    averageMaxBet: average(maxBetValues),
    maxObservedBetLimit: maxBetValues.length ? Math.max(...maxBetValues) : null,
    trainingConversionRate: candidateMessageRows > 0 ? trainingRows / candidateMessageRows : null,
    feedToTrainingRate: liveFeedStatsRows.length > 0 ? trainingRows / liveFeedStatsRows.length : null,
  };
}

function readiness({ valueCaptured, valueSettled, live, warnings }) {
  if (valueCaptured < 200) return "RESEARCH_ONLY";
  if (valueSettled < 200) return "CLV_READY_ROI_NOT_READY";
  if (live.trainingRows === 0) return "PREMATCH_ONLY_READY_LIVE_NOT_READY";
  if (warnings.includes("LIMITS_LIQUIDITY_NOT_MEASURED")) return "PAPER_READY_LIMITS_UNKNOWN";
  return "READY_FOR_TINY_STAKES";
}

export function buildProfitEngineReport({
  generatedAt = new Date().toISOString(),
  paperRows = [],
  liveFeedStatsRows = [],
  liveStatusRows = [],
  liveTrainingRows = [],
  liveAuditRows = [],
  lifetimeRows = [],
  bankroll = null,
  maxStake = null,
  kellyFraction = 0.25,
  stakeCapFraction = 0.02,
} = {}) {
  const analysisPaperRows = quarantineReportRows(paperRows);
  const paperSummary = summarizePaperBets(analysisPaperRows);
  const researchRows = summarizeResearchStatus(analysisPaperRows);
  const overallResearch = researchRows.find((row) => row.scope === "overall" && row.key === "all");
  const mainResearch = researchRows.find((row) => row.scope === "main" && row.key === "MATCH_RESULT");
  const calibration = summarizeClvCalibration(analysisPaperRows);
  const valueRow = calibrationRow(calibration, "tier", "VALUE");
  const controlRow = calibrationRow(calibration, "tier", "CONTROL");
  const mainRow = calibration.mainScore;
  const mainValueAverageClv = averageClv(valueClvRows(analysisPaperRows)
    .filter((row) => row.market === "MATCH_RESULT"));
  const live = summarizeLiveEfficiency({
    liveFeedStatsRows,
    liveStatusRows,
    liveTrainingRows,
    liveAuditRows,
    lifetimeRows,
  });
  const valueSettled = valueSettledRows(analysisPaperRows).length;

  const configuredBankroll = optionalNumber(bankroll);
  const configuredMaxStake = optionalNumber(maxStake);
  const maxStakeFraction = configuredBankroll && configuredMaxStake
    ? Math.min(stakeCapFraction, configuredMaxStake / configuredBankroll)
    : stakeCapFraction;
  const sampleFractions = stakeFractions(valueClvRows(analysisPaperRows), {
    kellyFraction,
    stakeCapFraction: maxStakeFraction,
  });

  const warnings = [];
  const valueCaptured = overallResearch?.valueClvCaptured ?? 0;
  if (valueCaptured < 200) warnings.push("VALUE_CLV_BELOW_200");
  if (valueSettled < 200) warnings.push("ROI_SAMPLE_TOO_SMALL");
  if (live.feedStatsRows > 0 && live.marketMessageRows === 0) {
    warnings.push("LIVE_FEED_HAS_NO_MARKET_MESSAGES");
  }
  if (live.fallbackRecommended) warnings.push("LIVE_UPDATED_POLL_FALLBACK_RECOMMENDED");
  if (live.statusRows > 0 && live.trainingRows === 0) warnings.push("LIVE_STATUS_WITHOUT_TRAINING");
  if (live.marketMessageRows > 0 && live.trainingRows === 0) warnings.push("LIVE_MARKETS_WITHOUT_TRAINING");
  if ((controlRow?.averageClv ?? 0) > 0) warnings.push("CONTROL_POSITIVE_DRIFT");
  if (mainValueAverageClv !== null && mainValueAverageClv <= 0) warnings.push("MAIN_SIGNAL_NOT_POSITIVE");
  if (live.liquidityRows === 0) warnings.push("LIMITS_LIQUIDITY_NOT_MEASURED");
  if (!configuredBankroll || !configuredMaxStake) warnings.push("CAPITAL_CONFIG_INCOMPLETE");

  const capital = {
    bankroll: configuredBankroll,
    maxStake: configuredMaxStake,
    kellyFraction,
    stakeCapFraction: maxStakeFraction,
    sampleAverageStakeFraction: average(sampleFractions),
    sampleMaxStakeFraction: sampleFractions.length ? Math.max(...sampleFractions) : null,
    sampleAverageStake: configuredBankroll && sampleFractions.length
      ? average(sampleFractions) * configuredBankroll
      : null,
    readiness: readiness({
      valueCaptured,
      valueSettled,
      live,
      warnings,
    }),
  };

  return {
    generatedAt,
    paper: {
      rows: paperSummary.total,
      pending: paperSummary.pending,
      settled: paperSummary.settled,
      settledStake: paperSummary.settledStake,
      profit: paperSummary.profit,
      roi: paperSummary.roi,
      valueSettled,
      valueClvCaptured: overallResearch?.valueClvCaptured ?? 0,
      mainValueClvCaptured: mainResearch?.valueClvCaptured ?? 0,
      valuePending: overallResearch?.valuePending ?? 0,
      controlClvCaptured: overallResearch?.controlClvCaptured ?? 0,
      uniqueSelectionCount: overallResearch?.uniqueSelectionCount ?? 0,
      missingValueClvTo200: overallResearch?.missingValueClvTo200 ?? 200,
      missingValueClvTo300: overallResearch?.missingValueClvTo300 ?? 300,
    },
    signal: {
      sampleSize: calibration.sampleSize,
      valueAverageClv: valueRow?.averageClv ?? null,
      controlAverageClv: controlRow?.averageClv ?? null,
      mainAverageClv: mainRow?.averageClv ?? null,
      mainValueAverageClv,
      regressionSlope: calibration.regression.slope,
      regressionRSquared: calibration.regression.rSquared,
    },
    live,
    capital,
    warnings,
  };
}

function valueForCsv(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(6);
  return String(value);
}

export function profitEngineRows(report) {
  const rows = [];
  function add(scope, key, value) {
    rows.push({ scope, key, value: valueForCsv(value) });
  }

  for (const [key, value] of Object.entries(report.paper)) add("paper", key, value);
  for (const [key, value] of Object.entries(report.signal)) add("signal", key, value);
  for (const [key, value] of Object.entries(report.live)) add("live", key, value);
  for (const [key, value] of Object.entries(report.capital)) add("capital", key, value);
  for (const warning of report.warnings) add("warning", warning, "1");
  return rows;
}
