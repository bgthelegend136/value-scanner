export const PAPER_COLUMNS = [
  "referenceEventId", "bettableEventId", "firstSeenAt", "kickoffUtc",
  "homeTeam", "awayTeam", "bookmaker", "market", "line", "outcome",
  "decimalOdds", "fairOdds", "fairProbability", "ev", "tier", "stake",
  "status", "homeScore", "awayScore", "profit", "settledAt",
  "closingFairOdds", "clv", "clvCapturedAt", "sportKey",
];

// Paper bets predate multi-league scanning, so older ledger rows have no
// sportKey. They were all World Cup, so that is the safe backfill for settle/CLV
// grouping. New rows always carry their own sportKey from the scan.
export const LEGACY_SPORT_KEY = "soccer_fifa_world_cup";

export function paperSportKey(row) {
  const value = String(row.sportKey ?? "").trim();
  return value || LEGACY_SPORT_KEY;
}

const TERMINAL_STATUSES = new Set(["WON", "LOST", "PUSH", "REVIEW"]);
const SETTLED_STATUSES = new Set(["WON", "LOST", "PUSH"]);
const VALID_STATUSES = new Set(["PENDING", ...TERMINAL_STATUSES]);

function finite(value, name) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid paper bet ${name}: ${value}`);
  return parsed;
}

function required(value, name) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`Invalid paper bet: missing ${name}`);
  return text;
}

function validateRow(row) {
  for (const name of [
    "referenceEventId", "bookmaker", "bettableEventId", "firstSeenAt", "kickoffUtc",
    "homeTeam", "awayTeam", "market", "outcome", "tier", "status",
  ]) {
    required(row[name], name);
  }
  finite(row.decimalOdds, "decimalOdds");
  finite(row.fairOdds, "fairOdds");
  finite(row.fairProbability, "fairProbability");
  finite(row.ev, "ev");
  finite(row.stake, "stake");
  if (!VALID_STATUSES.has(row.status)) {
    throw new Error(`Invalid paper bet status: ${row.status}`);
  }
}

export function paperBetKey(row, { includeFirstSeenAt = false } = {}) {
  const parts = [
    row.referenceEventId,
    row.bookmaker,
    row.market,
    row.line ?? "",
    row.outcome,
  ];
  if (includeFirstSeenAt) parts.push(row.firstSeenAt);
  return parts.map((value) => String(value)).join("|");
}

function paperRow({ result, fixture }, firstSeenAt) {
  return {
    referenceEventId: String(fixture.referenceEventId),
    bettableEventId: String(fixture.bettableEventId),
    sportKey: String(fixture.sportKey ?? ""),
    firstSeenAt,
    kickoffUtc: fixture.kickoffUtc,
    homeTeam: fixture.homeTeam,
    awayTeam: fixture.awayTeam,
    bookmaker: result.bookmaker,
    market: result.market,
    line: String(result.line ?? ""),
    outcome: result.outcome,
    decimalOdds: result.decimalOdds.toFixed(4),
    fairOdds: result.fairOdds.toFixed(4),
    fairProbability: result.fairProbability.toFixed(6),
    ev: result.ev.toFixed(6),
    tier: result.status,
    stake: "1.00",
    status: "PENDING",
    homeScore: "",
    awayScore: "",
    profit: "",
    settledAt: "",
    closingFairOdds: "",
    clv: "",
    clvCapturedAt: "",
  };
}

export function mergePaperBets(existingRows, opportunities, { firstSeenAt, includeFirstSeenAtInKey = false }) {
  for (const row of existingRows) validateRow(row);
  const rows = existingRows.map((row) => ({ ...row }));
  const keyFor = (row) => paperBetKey(row, { includeFirstSeenAt: includeFirstSeenAtInKey });
  const keys = new Set(rows.map(keyFor));
  let added = 0;
  let duplicates = 0;

  for (const opportunity of opportunities) {
    const row = paperRow(opportunity, firstSeenAt);
    const key = keyFor(row);
    if (keys.has(key)) {
      duplicates += 1;
      continue;
    }
    keys.add(key);
    rows.push(row);
    added += 1;
  }

  return { rows, added, duplicates };
}

function scoreFor(event, team) {
  const item = event.scores?.find((score) => score.name === team);
  if (!item) return null;
  const value = Number(item.score);
  return Number.isFinite(value) ? value : null;
}

function isoOrBlank(value) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : "";
}

function resultStatus(row, homeScore, awayScore) {
  if (row.market === "MATCH_RESULT") {
    if (!["1", "X", "2"].includes(row.outcome)) return "REVIEW";
    const winner = homeScore > awayScore ? "1" : awayScore > homeScore ? "2" : "X";
    return row.outcome === winner ? "WON" : "LOST";
  }
  if (row.market !== "TOTALS") return "REVIEW";

  const line = Number(row.line);
  if (!Number.isFinite(line) || !Number.isInteger(line * 2)) return "REVIEW";
  if (!["OVER", "UNDER"].includes(row.outcome)) return "REVIEW";

  const total = homeScore + awayScore;
  if (total === line) return "PUSH";
  const over = total > line;
  return (row.outcome === "OVER") === over ? "WON" : "LOST";
}

function profitFor(row, status) {
  const stake = finite(row.stake, "stake");
  if (status === "WON") return ((finite(row.decimalOdds, "decimalOdds") - 1) * stake).toFixed(4);
  if (status === "LOST") return (-stake).toFixed(4);
  if (status === "PUSH") return "0.0000";
  return "";
}

export function settlePaperBets(rows, scoreEvents) {
  const byId = new Map(scoreEvents.map((event) => [String(event.id), event]));
  return rows.map((row) => {
    validateRow(row);
    if (TERMINAL_STATUSES.has(row.status)) return { ...row };
    if (row.status !== "PENDING") throw new Error(`Invalid paper bet status: ${row.status}`);

    const event = byId.get(String(row.referenceEventId));
    if (!event?.completed) return { ...row };
    const homeScore = scoreFor(event, row.homeTeam);
    const awayScore = scoreFor(event, row.awayTeam);
    if (homeScore === null || awayScore === null) return { ...row };

    const status = resultStatus(row, homeScore, awayScore);
    return {
      ...row,
      status,
      homeScore: String(homeScore),
      awayScore: String(awayScore),
      profit: profitFor(row, status),
      settledAt: isoOrBlank(event.last_update),
    };
  });
}

export function summarizePaperBets(rows) {
  const summary = {
    total: rows.length,
    pending: 0,
    settled: 0,
    wins: 0,
    losses: 0,
    pushes: 0,
    review: 0,
    settledStake: 0,
    profit: 0,
    roi: null,
  };
  for (const row of rows) {
    validateRow(row);
    if (row.status === "PENDING") summary.pending += 1;
    if (row.status === "REVIEW") summary.review += 1;
    if (!SETTLED_STATUSES.has(row.status)) continue;
    summary.settled += 1;
    if (row.status === "WON") summary.wins += 1;
    if (row.status === "LOST") summary.losses += 1;
    if (row.status === "PUSH") summary.pushes += 1;
    summary.settledStake += finite(row.stake, "stake");
    summary.profit += finite(row.profit, "profit");
  }
  if (summary.settledStake > 0) summary.roi = summary.profit / summary.settledStake;
  return summary;
}

export function findStalePending(rows, now, { days = 3 } = {}) {
  const cutoff = now.getTime() - days * 24 * 60 * 60 * 1000;
  return rows.filter((row) => {
    if (row.status !== "PENDING") return false;
    const kickoff = Date.parse(row.kickoffUtc);
    return Number.isFinite(kickoff) && kickoff < cutoff;
  });
}

// Closing Line Value: record, for each still-pending bet, the EV of its stored
// odds measured against the latest (closing) de-vigged fair probability. A
// positive CLV means the bet beat the closing line — the strongest fast signal
// that the edge was real, available before any result is known.
export function applyClosingLine(rows, closingFairByKey, { capturedAt }) {
  return rows.map((row) => {
    if (row.status !== "PENDING") return { ...row };
    if (row.clvCapturedAt) return { ...row };
    const key = `${row.referenceEventId}|${row.market}|${row.line ?? ""}|${row.outcome}`;
    const fairProbability = closingFairByKey.get(key);
    if (!(fairProbability > 0)) return { ...row };
    const odds = finite(row.decimalOdds, "decimalOdds");
    return {
      ...row,
      closingFairOdds: (1 / fairProbability).toFixed(4),
      clv: (odds * fairProbability - 1).toFixed(6),
      clvCapturedAt: capturedAt,
    };
  });
}

export function summarizeClv(rows) {
  let captured = 0;
  let positive = 0;
  let total = 0;
  for (const row of rows) {
    if (!row.clv) continue;
    const clv = Number(row.clv);
    if (!Number.isFinite(clv)) continue;
    captured += 1;
    total += clv;
    if (clv > 0) positive += 1;
  }
  return {
    captured,
    positive,
    beatRate: captured > 0 ? positive / captured : null,
    averageClv: captured > 0 ? total / captured : null,
  };
}
function emptyClvBucket(scope, key) {
  return { scope, key, captured: 0, positive: 0, total: 0 };
}

function addClvBucket(buckets, scope, key, clv) {
  const id = `${scope}|${key}`;
  if (!buckets.has(id)) buckets.set(id, emptyClvBucket(scope, key));
  const bucket = buckets.get(id);
  bucket.captured += 1;
  bucket.total += clv;
  if (clv > 0) bucket.positive += 1;
}

function finishClvBucket(bucket) {
  return {
    scope: bucket.scope,
    key: bucket.key,
    captured: bucket.captured,
    positive: bucket.positive,
    beatRate: bucket.captured > 0 ? bucket.positive / bucket.captured : null,
    averageClv: bucket.captured > 0 ? bucket.total / bucket.captured : null,
  };
}

export function summarizeClvTrend(rows) {
  const buckets = new Map();
  for (const row of rows) {
    if (!row.clv) continue;
    const clv = Number(row.clv);
    if (!Number.isFinite(clv)) continue;
    addClvBucket(buckets, "overall", "all", clv);
    addClvBucket(buckets, "sportKey", paperSportKey(row), clv);
    const capturedAt = Date.parse(row.clvCapturedAt);
    if (Number.isFinite(capturedAt)) {
      addClvBucket(buckets, "captureDate", new Date(capturedAt).toISOString().slice(0, 10), clv);
    }
  }
  const order = new Map([["overall", 0], ["sportKey", 1], ["captureDate", 2]]);
  return [...buckets.values()]
    .map(finishClvBucket)
    .sort((left, right) =>
      order.get(left.scope) - order.get(right.scope) || left.key.localeCompare(right.key),
    );
}

function optionalFinite(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

const VALUE_TIERS = new Set(["VALUE", "VALUE_CHECK", "SUSPICIOUS"]);
const RESEARCH_STATUS_MARKETS = ["MATCH_RESULT", "TOTALS", "DRAW_NO_BET", "BTTS", "DOUBLE_CHANCE"];

function isValueTier(row) {
  return VALUE_TIERS.has(String(row.tier ?? ""));
}

function hasCapturedClv(row) {
  return optionalFinite(row.clv) !== null;
}

function emptyResearchBucket(scope, key) {
  return {
    scope,
    key,
    rows: 0,
    uniqueSelections: new Set(),
    valueRows: 0,
    valueClvCaptured: 0,
    valuePending: 0,
    controlRows: 0,
    controlClvCaptured: 0,
  };
}

function addResearchBucket(buckets, scope, key, row) {
  const safeKey = String(key ?? "").trim() || "(blank)";
  const id = `${scope}|${safeKey}`;
  if (!buckets.has(id)) buckets.set(id, emptyResearchBucket(scope, safeKey));
  const bucket = buckets.get(id);
  bucket.rows += 1;
  bucket.uniqueSelections.add(paperBetKey(row));
  if (isValueTier(row)) {
    bucket.valueRows += 1;
    if (hasCapturedClv(row)) bucket.valueClvCaptured += 1;
    else if (row.status === "PENDING") bucket.valuePending += 1;
  } else if (row.tier === "CONTROL") {
    bucket.controlRows += 1;
    if (hasCapturedClv(row)) bucket.controlClvCaptured += 1;
  }
}

function ensureResearchBucket(buckets, scope, key) {
  const safeKey = String(key ?? "").trim() || "(blank)";
  const id = `${scope}|${safeKey}`;
  if (!buckets.has(id)) buckets.set(id, emptyResearchBucket(scope, safeKey));
}

function finishResearchBucket(bucket) {
  return {
    scope: bucket.scope,
    key: bucket.key,
    rows: bucket.rows,
    uniqueSelectionCount: bucket.uniqueSelections.size,
    valueRows: bucket.valueRows,
    valueClvCaptured: bucket.valueClvCaptured,
    valuePending: bucket.valuePending,
    controlRows: bucket.controlRows,
    controlClvCaptured: bucket.controlClvCaptured,
    missingValueClvTo200: Math.max(0, 200 - bucket.valueClvCaptured),
    missingValueClvTo300: Math.max(0, 300 - bucket.valueClvCaptured),
  };
}

export function summarizeResearchStatus(rows) {
  const buckets = new Map();
  ensureResearchBucket(buckets, "overall", "all");
  ensureResearchBucket(buckets, "main", "MATCH_RESULT");
  for (const market of RESEARCH_STATUS_MARKETS) {
    ensureResearchBucket(buckets, "market", market);
  }
  for (const row of rows) {
    addResearchBucket(buckets, "overall", "all", row);
    if (row.market === "MATCH_RESULT") addResearchBucket(buckets, "main", "MATCH_RESULT", row);
    addResearchBucket(buckets, "market", row.market, row);
  }
  const scopeOrder = new Map([["overall", 0], ["main", 1], ["market", 2]]);
  return [...buckets.values()]
    .map(finishResearchBucket)
    .sort((left, right) =>
      scopeOrder.get(left.scope) - scopeOrder.get(right.scope) ||
      right.valueClvCaptured - left.valueClvCaptured ||
      left.key.localeCompare(right.key),
    );
}

function clvCalibrationSample(rows) {
  const samples = [];
  for (const row of rows) {
    const ev = optionalFinite(row.ev);
    const clv = optionalFinite(row.clv);
    if (ev === null || clv === null) continue;
    samples.push({
      row,
      ev,
      clv,
      odds: optionalFinite(row.decimalOdds),
    });
  }
  return samples;
}

export function evCalibrationBucket(ev) {
  if (ev < -0.05) return "<-5%";
  if (ev < 0) return "-5..0%";
  if (ev < 0.02) return "0..2%";
  if (ev < 0.05) return "2..5%";
  if (ev < 0.10) return "5..10%";
  return "10%+";
}

export function oddsCalibrationBucket(odds) {
  if (!(odds > 0)) return "(unknown)";
  if (odds < 1.50) return "<1.50";
  if (odds < 2.00) return "1.50..2.00";
  if (odds < 3.00) return "2.00..3.00";
  if (odds < 5.00) return "3.00..5.00";
  return "5.00+";
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function emptyCalibrationBucket(scope, key) {
  return {
    scope,
    key,
    count: 0,
    positive: 0,
    evTotal: 0,
    clvTotal: 0,
    clvValues: [],
    uniqueSelections: new Set(),
  };
}

function addCalibrationBucket(buckets, scope, key, sample) {
  const safeKey = String(key ?? "").trim() || "(blank)";
  const id = `${scope}|${safeKey}`;
  if (!buckets.has(id)) buckets.set(id, emptyCalibrationBucket(scope, safeKey));
  const bucket = buckets.get(id);
  bucket.count += 1;
  bucket.evTotal += sample.ev;
  bucket.clvTotal += sample.clv;
  bucket.clvValues.push(sample.clv);
  bucket.uniqueSelections.add(paperBetKey(sample.row));
  if (sample.clv > 0) bucket.positive += 1;
}

function finishCalibrationBucket(bucket) {
  const averageEv = bucket.count > 0 ? bucket.evTotal / bucket.count : null;
  const averageClv = bucket.count > 0 ? bucket.clvTotal / bucket.count : null;
  return {
    scope: bucket.scope,
    key: bucket.key,
    count: bucket.count,
    uniqueSelectionCount: bucket.uniqueSelections.size,
    positive: bucket.positive,
    positiveClvRate: bucket.count > 0 ? bucket.positive / bucket.count : null,
    averageEv,
    averageClv,
    medianClv: median(bucket.clvValues),
    clvMinusEv: averageClv === null || averageEv === null ? null : averageClv - averageEv,
    sampleWarning: bucket.scope === "market" && bucket.count < 50 ? "LOW_SAMPLE_N_LT_50" : "",
  };
}

export function clvEvRegression(rows) {
  const samples = clvCalibrationSample(rows);
  const n = samples.length;
  if (n < 2) return { count: n, slope: null, intercept: null, rSquared: null };

  const xMean = samples.reduce((sum, sample) => sum + sample.ev, 0) / n;
  const yMean = samples.reduce((sum, sample) => sum + sample.clv, 0) / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const sample of samples) {
    const dx = sample.ev - xMean;
    const dy = sample.clv - yMean;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  if (sxx === 0) return { count: n, slope: null, intercept: null, rSquared: null };
  const slope = sxy / sxx;
  const intercept = yMean - slope * xMean;
  const rSquared = syy === 0 ? null : (sxy * sxy) / (sxx * syy);
  return { count: n, slope, intercept, rSquared };
}

export function summarizeClvCalibration(rows) {
  const samples = clvCalibrationSample(rows);
  const buckets = new Map();

  for (const sample of samples) {
    const { row } = sample;
    addCalibrationBucket(buckets, "overall", "all", sample);
    if (row.market === "MATCH_RESULT") addCalibrationBucket(buckets, "main", "MATCH_RESULT", sample);
    addCalibrationBucket(buckets, "evBucket", evCalibrationBucket(sample.ev), sample);
    addCalibrationBucket(buckets, "tier", row.tier, sample);
    addCalibrationBucket(buckets, "sportKey", paperSportKey(row), sample);
    addCalibrationBucket(buckets, "market", row.market, sample);
    addCalibrationBucket(buckets, "bookmaker", row.bookmaker, sample);
    addCalibrationBucket(buckets, "oddsBucket", oddsCalibrationBucket(sample.odds), sample);
  }

  const scopeOrder = new Map([
    ["overall", 0],
    ["main", 1],
    ["evBucket", 2],
    ["tier", 3],
    ["sportKey", 4],
    ["market", 5],
    ["bookmaker", 6],
    ["oddsBucket", 7],
  ]);
  const evBucketOrder = new Map([
    ["<-5%", 0],
    ["-5..0%", 1],
    ["0..2%", 2],
    ["2..5%", 3],
    ["5..10%", 4],
    ["10%+", 5],
  ]);
  const oddsBucketOrder = new Map([
    ["<1.50", 0],
    ["1.50..2.00", 1],
    ["2.00..3.00", 2],
    ["3.00..5.00", 3],
    ["5.00+", 4],
    ["(unknown)", 5],
  ]);

  const rowsOut = [...buckets.values()]
    .map(finishCalibrationBucket)
    .sort((left, right) => {
      const scopeDelta = scopeOrder.get(left.scope) - scopeOrder.get(right.scope);
      if (scopeDelta !== 0) return scopeDelta;
      if (left.scope === "evBucket") return evBucketOrder.get(left.key) - evBucketOrder.get(right.key);
      if (left.scope === "oddsBucket") return oddsBucketOrder.get(left.key) - oddsBucketOrder.get(right.key);
      return right.count - left.count || left.key.localeCompare(right.key);
    });

  return {
    sampleSize: samples.length,
    regression: clvEvRegression(rows),
    mainScore: rowsOut.find((row) => row.scope === "main" && row.key === "MATCH_RESULT") ?? null,
    rows: rowsOut,
  };
}
