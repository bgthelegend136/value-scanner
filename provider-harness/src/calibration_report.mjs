import {
  average,
  decimal,
  evBucket,
  isPrimaryMarket,
  isSettled,
  median,
  optionalNumber,
  oddsBucket,
  quarantineReportRows,
  tierGroup,
  timeToCloseBucket,
} from "./report_domain.mjs";

export const CALIBRATION_REPORT_COLUMNS = [
  "scope", "key", "count", "settled", "roi", "avgEv", "avgClv", "medianClv",
  "clvBeatRate", "roiLower", "roiUpper", "clvLower", "clvUpper",
  "probabilityRoiPositive", "probabilityClvPositive",
];

const EV_BUCKET_ORDER = ["<-5%", "-5..0%", "0..2%", "2..5%", "5..10%", "10%+"];

function quantile(values, q) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))));
  return sorted[index];
}

function nextRandom(seed) {
  return (seed * 1664525 + 1013904223) >>> 0;
}

function deterministicResamples(values, iterations = 1000) {
  if (values.length === 0) return [];
  const out = [];
  let seed = 0x9e3779b9 ^ values.length;
  for (let i = 0; i < iterations; i += 1) {
    let total = 0;
    for (let j = 0; j < values.length; j += 1) {
      seed = nextRandom(seed);
      total += values[(seed >>> 8) % values.length];
    }
    out.push(total / values.length);
  }
  return out;
}

function confidence(values) {
  if (values.length === 0) {
    return { lower: null, upper: null, probabilityPositive: null };
  }
  const samples = deterministicResamples(values);
  return {
    lower: quantile(samples, 0.025),
    upper: quantile(samples, 0.975),
    probabilityPositive: samples.filter((value) => value > 0).length / samples.length,
  };
}

function emptyBucket(scope, key) {
  return { scope, key, rows: [], evs: [], clvs: [], returns: [], settled: 0, stake: 0, profit: 0 };
}

function addBucket(map, scope, key, row) {
  const id = `${scope}|${key}`;
  if (!map.has(id)) map.set(id, emptyBucket(scope, key));
  const bucket = map.get(id);
  bucket.rows.push(row);
  const ev = optionalNumber(row.ev);
  const clv = optionalNumber(row.clv);
  if (ev !== null) bucket.evs.push(ev);
  if (clv !== null) bucket.clvs.push(clv);
  if (isSettled(row)) {
    const stake = optionalNumber(row.stake) ?? 0;
    const profit = optionalNumber(row.profit) ?? 0;
    bucket.settled += 1;
    bucket.stake += stake;
    bucket.profit += profit;
    if (stake > 0) bucket.returns.push(profit / stake);
  }
}

function finishBucket(bucket) {
  const roiConfidence = confidence(bucket.returns);
  const clvConfidence = confidence(bucket.clvs);
  return {
    scope: bucket.scope,
    key: bucket.key,
    count: bucket.rows.length,
    settled: bucket.settled,
    roi: bucket.stake > 0 ? bucket.profit / bucket.stake : null,
    avgEv: average(bucket.evs),
    avgClv: average(bucket.clvs),
    medianClv: median(bucket.clvs),
    clvBeatRate: bucket.clvs.length > 0 ? bucket.clvs.filter((value) => value > 0).length / bucket.clvs.length : null,
    roiLower: roiConfidence.lower,
    roiUpper: roiConfidence.upper,
    clvLower: clvConfidence.lower,
    clvUpper: clvConfidence.upper,
    probabilityRoiPositive: roiConfidence.probabilityPositive,
    probabilityClvPositive: clvConfidence.probabilityPositive,
  };
}

function monotonicity(rows) {
  const evRows = rows
    .filter((row) => row.scope === "evBucket" && row.avgClv !== null)
    .sort((left, right) => EV_BUCKET_ORDER.indexOf(left.key) - EV_BUCKET_ORDER.indexOf(right.key));
  let previous = null;
  for (const row of evRows) {
    if (previous !== null && row.avgClv + 0.005 < previous) {
      return { status: "FAIL", reason: `${row.key} average CLV underperformed lower EV bucket` };
    }
    previous = row.avgClv;
  }
  return { status: "PASS", reason: "" };
}

function matchedControlComparisons(rows) {
  const buckets = new Map();
  for (const row of rows) {
    const tier = tierGroup(row);
    if (!["VALUE", "CONTROL"].includes(tier)) continue;
    const key = `${row.market || "(blank)"}|${oddsBucket(optionalNumber(row.decimalOdds))}|${timeToCloseBucket(row)}`;
    if (!buckets.has(key)) {
      buckets.set(key, { key, valueClvs: [], controlClvs: [] });
    }
    const clv = optionalNumber(row.clv);
    if (tier === "VALUE") buckets.get(key).valueClvs.push(clv);
    if (tier === "CONTROL") buckets.get(key).controlClvs.push(clv);
  }
  return [...buckets.values()]
    .filter((bucket) => bucket.valueClvs.length > 0 && bucket.controlClvs.length > 0)
    .map((bucket) => {
      const valueAverageClv = average(bucket.valueClvs);
      const controlAverageClv = average(bucket.controlClvs);
      return {
        key: bucket.key,
        valueCount: bucket.valueClvs.length,
        controlCount: bucket.controlClvs.length,
        valueAverageClv,
        controlAverageClv,
        clvSeparation: valueAverageClv - controlAverageClv,
      };
    })
    .sort((left, right) => right.valueCount - left.valueCount || left.key.localeCompare(right.key));
}

export function buildCalibrationReport({ rows = [], generatedAt = new Date().toISOString() } = {}) {
  const buckets = new Map();
  const analysisRows = quarantineReportRows(rows).filter((row) => optionalNumber(row.clv) !== null);
  for (const row of analysisRows) {
    addBucket(buckets, "overall", "all", row);
    addBucket(buckets, "tier", tierGroup(row), row);
    addBucket(buckets, "market", row.market || "(blank)", row);
    addBucket(buckets, "evBucket", evBucket(optionalNumber(row.ev)), row);
    addBucket(buckets, "oddsBucket", oddsBucket(optionalNumber(row.decimalOdds)), row);
    if (isPrimaryMarket(row)) addBucket(buckets, "primary", `MATCH_RESULT|${tierGroup(row)}`, row);
    addBucket(buckets, "matchedControl", `${row.market || "(blank)"}|${oddsBucket(optionalNumber(row.decimalOdds))}|${timeToCloseBucket(row)}`, row);
  }
  const reportRows = [...buckets.values()].map(finishBucket).sort((left, right) =>
    left.scope.localeCompare(right.scope) || left.key.localeCompare(right.key),
  );
  const valueMatchResult = reportRows.find((row) => row.scope === "primary" && row.key === "MATCH_RESULT|VALUE") ?? null;
  const controlMatchResult = reportRows.find((row) => row.scope === "primary" && row.key === "MATCH_RESULT|CONTROL") ?? null;
  const mono = monotonicity(reportRows);
  const comparisons = matchedControlComparisons(analysisRows);
  const ready = valueMatchResult &&
    valueMatchResult.count >= 200 &&
    (valueMatchResult.avgClv ?? -1) > 0 &&
    (valueMatchResult.probabilityClvPositive ?? 0) > 0.5 &&
    mono.status === "PASS";

  return {
    generatedAt,
    decision: {
      modelStatus: ready ? "CALIBRATED_EDGE_CANDIDATE" : "RANKING_SIGNAL",
      reason: ready ? "Primary h2h sample passes calibration gates" : "Primary h2h sample is below production calibration gates",
    },
    monotonicity: mono,
    confidence: {
      valueMatchResult: valueMatchResult ?? {},
      controlMatchResult: controlMatchResult ?? {},
    },
    matchedControlComparisons: comparisons,
    rows: reportRows,
  };
}

export function calibrationCsvRow(row) {
  return Object.fromEntries(CALIBRATION_REPORT_COLUMNS.map((key) => [key, decimal(row[key])]));
}
