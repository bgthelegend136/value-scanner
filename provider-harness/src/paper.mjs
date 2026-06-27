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
