const TERMINAL_STATUSES = new Set(["WON", "LOST", "PUSH", "REVIEW"]);
const SETTLED_STATUSES = new Set(["WON", "LOST", "PUSH"]);

function finite(value, name) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid mispricing settlement ${name}: ${value}`);
  return parsed;
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

function matchResultStatus(row, homeScore, awayScore) {
  if (!["1", "X", "2"].includes(row.outcome)) return "REVIEW";
  const winner = homeScore > awayScore ? "1" : awayScore > homeScore ? "2" : "X";
  return row.outcome === winner ? "WON" : "LOST";
}

function profitFor(row, status) {
  if (status === "WON") return (finite(row.decimalOdds, "decimalOdds") - 1).toFixed(4);
  if (status === "LOST") return "-1.0000";
  if (status === "PUSH") return "0.0000";
  return "";
}

function round(value) {
  return Math.round(value * 1e12) / 1e12;
}

export function settleMispricingAlerts(rows, scoreEvents) {
  const byId = new Map(scoreEvents.map((event) => [String(event.id), event]));
  return rows.map((row) => {
    if (TERMINAL_STATUSES.has(row.status)) return { ...row };
    if (row.status !== "PENDING") throw new Error(`Invalid mispricing alert status: ${row.status}`);

    const event = byId.get(String(row.referenceEventId));
    if (!event?.completed) return { ...row };
    const homeScore = scoreFor(event, event.home_team);
    const awayScore = scoreFor(event, event.away_team);
    if (homeScore === null || awayScore === null) return { ...row };

    const status = row.market === "MATCH_RESULT"
      ? matchResultStatus(row, homeScore, awayScore)
      : "REVIEW";
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

export function summarizeMispricingSettlements(rows) {
  const summary = {
    total: rows.length,
    pending: 0,
    settled: 0,
    wins: 0,
    losses: 0,
    pushes: 0,
    review: 0,
    profit: 0,
    roi: null,
  };
  for (const row of rows) {
    if (row.status === "PENDING") summary.pending += 1;
    if (row.status === "REVIEW") summary.review += 1;
    if (!SETTLED_STATUSES.has(row.status)) continue;
    summary.settled += 1;
    if (row.status === "WON") summary.wins += 1;
    if (row.status === "LOST") summary.losses += 1;
    if (row.status === "PUSH") summary.pushes += 1;
    summary.profit = round(summary.profit + finite(row.profit, "profit"));
  }
  if (summary.settled > 0) summary.roi = round(summary.profit / summary.settled);
  return summary;
}
