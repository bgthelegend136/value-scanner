import {
  average,
  decimal,
  evBucket,
  eventSelectionKey,
  hasClv,
  isPrimaryMarket,
  isSettled,
  optionalNumber,
  oddsBucket,
  selectionKey,
  tierGroup,
  timeToCloseBucket,
} from "./report_domain.mjs";

export const PROFITABILITY_COLUMNS = [
  "scope", "key", "grain", "rows", "settled", "wins", "losses", "pushes",
  "stake", "profit", "roi", "avgOdds", "hitRate", "clvCaptured", "avgClv",
  "clvBeatRate",
];

function emptySegment(scope, key, grain) {
  return {
    scope,
    key,
    grain,
    rows: 0,
    settled: 0,
    wins: 0,
    losses: 0,
    pushes: 0,
    stake: 0,
    profit: 0,
    odds: [],
    clv: [],
  };
}

function addToSegment(segment, row) {
  segment.rows += 1;
  const odds = optionalNumber(row.decimalOdds);
  if (odds !== null) segment.odds.push(odds);
  const clv = optionalNumber(row.clv);
  if (clv !== null) segment.clv.push(clv);
  if (!isSettled(row)) return;
  segment.settled += 1;
  if (row.status === "WON") segment.wins += 1;
  if (row.status === "LOST") segment.losses += 1;
  if (row.status === "PUSH") segment.pushes += 1;
  segment.stake += optionalNumber(row.stake) ?? 0;
  segment.profit += optionalNumber(row.profit) ?? 0;
}

function finishSegment(segment) {
  const settledDecisions = segment.wins + segment.losses;
  const positiveClv = segment.clv.filter((value) => value > 0).length;
  return {
    scope: segment.scope,
    key: segment.key,
    grain: segment.grain,
    rows: segment.rows,
    settled: segment.settled,
    wins: segment.wins,
    losses: segment.losses,
    pushes: segment.pushes,
    stake: segment.stake,
    profit: segment.profit,
    roi: segment.stake > 0 ? segment.profit / segment.stake : null,
    avgOdds: average(segment.odds),
    hitRate: settledDecisions > 0 ? segment.wins / settledDecisions : null,
    clvCaptured: segment.clv.length,
    avgClv: average(segment.clv),
    clvBeatRate: segment.clv.length > 0 ? positiveClv / segment.clv.length : null,
  };
}

function segmentKey(row, scope) {
  const tier = tierGroup(row);
  if (scope === "overall") return `all|${tier}`;
  if (scope === "primary") return `MATCH_RESULT|${tier}`;
  if (scope === "market") return `${row.market || "(blank)"}|${tier}`;
  if (scope === "sportKey") return `${row.sportKey || "(blank)"}|${tier}`;
  if (scope === "bookmaker") return `${row.bookmaker || "(blank)"}|${tier}`;
  if (scope === "oddsBucket") return `${oddsBucket(optionalNumber(row.decimalOdds))}|${tier}`;
  if (scope === "evBucket") return `${evBucket(optionalNumber(row.ev))}|${tier}`;
  return `${timeToCloseBucket(row)}|${tier}`;
}

function summarize(rows, grain, dedupeKeyFn = null) {
  const segments = new Map();
  const seen = new Set();
  const scopes = ["overall", "market", "sportKey", "bookmaker", "oddsBucket", "evBucket", "timeToClose"];
  for (const row of rows) {
    if (dedupeKeyFn) {
      const dedupeKey = dedupeKeyFn(row);
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
    }
    const rowScopes = isPrimaryMarket(row) ? ["primary", ...scopes] : scopes;
    for (const scope of rowScopes) {
      const key = segmentKey(row, scope);
      const id = `${scope}|${key}|${grain}`;
      if (!segments.has(id)) segments.set(id, emptySegment(scope, key, grain));
      addToSegment(segments.get(id), row);
    }
  }
  return [...segments.values()].map(finishSegment);
}

export function buildProfitabilityReport({ rows = [], generatedAt = new Date().toISOString() } = {}) {
  const rowLevel = summarize(rows, "row");
  const eventLevel = summarize(rows, "event", eventSelectionKey);
  const reportRows = [...rowLevel, ...eventLevel].sort((left, right) =>
    left.scope.localeCompare(right.scope) || left.key.localeCompare(right.key) || left.grain.localeCompare(right.grain),
  );
  const primaryValue = reportRows.find((row) =>
    row.scope === "primary" && row.key === "MATCH_RESULT|VALUE" && row.grain === "row");
  const primaryControl = reportRows.find((row) =>
    row.scope === "primary" && row.key === "MATCH_RESULT|CONTROL" && row.grain === "row");
  const valueMatchResultSettledReady = (primaryValue?.settled ?? 0) >= 200;
  const valueMatchResultClvReady = (primaryValue?.clvCaptured ?? 0) >= 200;
  const controlComparableReady = (primaryControl?.settled ?? 0) >= 200;
  const lowerBoundChecksPass = (primaryValue?.roi ?? -1) > 0 && (primaryValue?.avgClv ?? -1) > 0;
  const productionReady = valueMatchResultSettledReady &&
    valueMatchResultClvReady &&
    controlComparableReady &&
    lowerBoundChecksPass;

  return {
    generatedAt,
    mode: productionReady ? "PAPER_READY" : "RESEARCH_ONLY",
    gates: {
      valueMatchResultSettledReady,
      valueMatchResultClvReady,
      controlComparableReady,
      lowerBoundChecksPass,
      productionReady,
      valueMatchResultSettled: primaryValue?.settled ?? 0,
      valueMatchResultClvCaptured: primaryValue?.clvCaptured ?? 0,
      controlMatchResultSettled: primaryControl?.settled ?? 0,
    },
    rows: reportRows,
  };
}

export function profitabilityCsvRow(row) {
  const fixed = new Set(["stake", "profit", "roi", "avgOdds", "hitRate", "avgClv", "clvBeatRate"]);
  return Object.fromEntries(PROFITABILITY_COLUMNS.map((key) => {
    const value = row[key];
    if (fixed.has(key) && typeof value === "number") return [key, value.toFixed(6)];
    return [key, decimal(value)];
  }));
}
