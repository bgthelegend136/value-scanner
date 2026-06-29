// Calibration of the harness's OWN realized paper-bet outcomes — the Walsh &
// Joshi (2024) test applied to the project's real edge, not the sharp-side
// historical proxy. For each settled bet we treat the de-vigged fairProbability
// of the backed selection as the prediction p, and whether that selection won as
// the binary outcome y (WON=1, LOST=0). PUSH / HALF_* / REVIEW / PENDING are
// excluded. This is per-selection (one-vs-rest / classwise) calibration.
//
// VALUE bets are EV-filtered, so the VALUE curve is the *conditioned* calibration
// (what we actually bet); CONTROL is the unconditioned baseline for comparison.
import {
  average,
  decimal,
  isPrimaryMarket,
  oddsBucket,
  optionalNumber,
  tierGroup,
} from "./report_domain.mjs";

export const OUTCOME_CALIBRATION_COLUMNS = [
  "scope", "key", "n", "winRate", "avgProb", "calibrationGap",
  "brier", "logLoss", "ece",
];

const LOG_EPSILON = 1e-9;

function clamp01(value) {
  return Math.min(1 - LOG_EPSILON, Math.max(LOG_EPSILON, value));
}

function binaryOutcome(status) {
  const value = String(status ?? "");
  if (value === "WON") return 1;
  if (value === "LOST") return 0;
  return null; // PUSH / HALF_WON / HALF_LOST / REVIEW / PENDING: not a clean 0/1
}

function sampleOf(row) {
  const probability = optionalNumber(row.fairProbability);
  const outcome = binaryOutcome(row.status);
  if (probability === null || outcome === null) return null;
  if (!(probability > 0 && probability < 1)) return null;
  return { p: probability, y: outcome, row };
}

// Reliability: partition predictions into equal-width probability bins and
// compare the average predicted probability to the realized win rate per bin.
// classwise-ECE (Kull et al.) is the size-weighted mean absolute gap.
function reliability(samples, bins) {
  const buckets = Array.from({ length: bins }, (_, index) => ({
    bin: index,
    lo: index / bins,
    hi: (index + 1) / bins,
    probs: [],
    outcomes: [],
  }));
  for (const sample of samples) {
    const index = Math.min(bins - 1, Math.floor(sample.p * bins));
    buckets[index].probs.push(sample.p);
    buckets[index].outcomes.push(sample.y);
  }
  let ece = 0;
  const total = samples.length;
  const curve = buckets
    .filter((bucket) => bucket.probs.length > 0)
    .map((bucket) => {
      const avgProb = average(bucket.probs);
      const winRate = average(bucket.outcomes);
      ece += (bucket.probs.length / total) * Math.abs(avgProb - winRate);
      return {
        bin: bucket.bin,
        lo: bucket.lo,
        hi: bucket.hi,
        n: bucket.probs.length,
        avgProb,
        winRate,
      };
    });
  return { curve, ece: total > 0 ? ece : null };
}

function finishBucket(bucket, bins) {
  const probs = bucket.samples.map((sample) => sample.p);
  const outcomes = bucket.samples.map((sample) => sample.y);
  const n = bucket.samples.length;
  const avgProb = average(probs);
  const winRate = average(outcomes);
  const brier = average(bucket.samples.map((s) => (s.p - s.y) ** 2));
  const logLoss = average(
    bucket.samples.map((s) => -(s.y * Math.log(clamp01(s.p)) + (1 - s.y) * Math.log(clamp01(1 - s.p)))),
  );
  const { ece } = reliability(bucket.samples, bins);
  return {
    scope: bucket.scope,
    key: bucket.key,
    n,
    winRate,
    avgProb,
    // Positive gap => selections won more often than the fair line implied, i.e.
    // the model under-estimated the true probability (favourable for value).
    calibrationGap: winRate !== null && avgProb !== null ? winRate - avgProb : null,
    brier,
    logLoss,
    ece,
  };
}

export function buildOutcomeCalibrationReport({ rows = [], bins = 10, generatedAt = new Date().toISOString() } = {}) {
  const samples = [];
  for (const row of rows) {
    const sample = sampleOf(row);
    if (sample) samples.push(sample);
  }

  const buckets = new Map();
  const add = (scope, key, sample) => {
    const id = `${scope}|${key}`;
    if (!buckets.has(id)) buckets.set(id, { scope, key, samples: [] });
    buckets.get(id).samples.push(sample);
  };
  for (const sample of samples) {
    const row = sample.row;
    add("overall", "all", sample);
    add("tier", tierGroup(row), sample);
    add("oddsBucket", oddsBucket(optionalNumber(row.decimalOdds)), sample);
    add("market", row.market || "(blank)", sample);
    add("sport", row.sportKey || "(blank)", sample);
    if (isPrimaryMarket(row)) add("primary", `MATCH_RESULT|${tierGroup(row)}`, sample);
  }

  const reportRows = [...buckets.values()]
    .map((bucket) => finishBucket(bucket, bins))
    .sort((left, right) => left.scope.localeCompare(right.scope) || left.key.localeCompare(right.key));

  const valueMatchResult = reportRows.find((r) => r.scope === "primary" && r.key === "MATCH_RESULT|VALUE") ?? null;
  const controlMatchResult = reportRows.find((r) => r.scope === "primary" && r.key === "MATCH_RESULT|CONTROL") ?? null;
  const valueSamples = samples.filter((s) => isPrimaryMarket(s.row) && tierGroup(s.row) === "VALUE");

  return {
    generatedAt,
    sampleCount: samples.length,
    valueMatchResult: valueMatchResult ?? {},
    controlMatchResult: controlMatchResult ?? {},
    valueReliabilityCurve: reliability(valueSamples, bins).curve,
    rows: reportRows,
  };
}

export function outcomeCalibrationCsvRow(row) {
  return Object.fromEntries(OUTCOME_CALIBRATION_COLUMNS.map((key) => [key, decimal(row[key])]));
}
