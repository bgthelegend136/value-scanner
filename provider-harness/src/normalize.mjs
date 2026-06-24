const MARKET_NAMES = new Map([
  ["ML", "MATCH_RESULT"],
  ["Moneyline", "MATCH_RESULT"],
  ["Totals", "TOTALS"],
  ["Goals Over/Under", "TOTALS"],
  ["Both Teams To Score", "BTTS"],
  ["Double Chance", "DOUBLE_CHANCE"],
]);

function iso(value) {
  if (!value) return "";
  return new Date(value).toISOString();
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function baseRow(payload, bookmaker, market, receivedAt) {
  return {
    provider: "Odds-API.io",
    bookmaker,
    eventId: String(payload.id),
    competition: payload.league?.name ?? payload.league ?? "",
    kickoffUtc: iso(payload.date),
    homeTeam: payload.home,
    awayTeam: payload.away,
    period: "FULL_TIME",
    market: MARKET_NAMES.get(market.name),
    line: "",
    outcome: "",
    decimalOdds: 0,
    quoteUpdatedAt: iso(market.updatedAt),
    receivedAt,
    regionalStatus: "UNVERIFIED",
  };
}

function add(rows, base, outcome, odds, line = "") {
  const decimalOdds = number(odds);
  if (decimalOdds === null) return;
  rows.push({ ...base, line: line === "" ? "" : String(line), outcome, decimalOdds });
}

export function normalizeOddsResponse(payload, receivedAt) {
  const rows = [];

  for (const [bookmaker, markets] of Object.entries(payload.bookmakers ?? {})) {
    for (const market of markets ?? []) {
      const canonicalMarket = MARKET_NAMES.get(market.name);
      if (!canonicalMarket) continue;
      const base = baseRow(payload, bookmaker, market, receivedAt);

      for (const odds of market.odds ?? []) {
        if (canonicalMarket === "MATCH_RESULT") {
          add(rows, base, "1", odds.home);
          add(rows, base, "X", odds.draw);
          add(rows, base, "2", odds.away);
        } else if (canonicalMarket === "TOTALS") {
          const line = odds.hdp ?? odds.line ?? odds.total;
          if (line === undefined || line === null || line === "") continue;
          add(rows, base, "OVER", odds.over, line);
          add(rows, base, "UNDER", odds.under, line);
        } else if (canonicalMarket === "BTTS") {
          add(rows, base, "YES", odds.yes);
          add(rows, base, "NO", odds.no);
        } else if (canonicalMarket === "DOUBLE_CHANCE") {
          add(rows, base, "1X", odds.homeDraw ?? odds["1X"] ?? odds.oneX);
          add(rows, base, "12", odds.homeAway ?? odds["12"] ?? odds.oneTwo);
          add(rows, base, "X2", odds.drawAway ?? odds.X2 ?? odds.xTwo);
        }
      }
    }
  }

  return rows;
}
