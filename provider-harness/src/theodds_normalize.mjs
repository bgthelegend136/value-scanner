function iso(value) {
  return value ? new Date(value).toISOString() : "";
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function normalizeTheOddsResponse(payload, receivedAt) {
  const events = Array.isArray(payload) ? payload : [];
  const rows = [];

  for (const event of events) {
    const base = {
      provider: "the-odds-api",
      eventId: String(event.id),
      competition: event.sport_title ?? "",
      kickoffUtc: iso(event.commence_time),
      homeTeam: event.home_team,
      awayTeam: event.away_team,
      period: "FULL_TIME",
      receivedAt,
      regionalStatus: "UNVERIFIED",
    };

    for (const bookmaker of event.bookmakers ?? []) {
      const key = bookmaker.key;
      const bookUpdated = iso(bookmaker.last_update);

      for (const market of bookmaker.markets ?? []) {
        const quoteUpdatedAt = iso(market.last_update) || bookUpdated;

        if (market.key === "h2h") {
          for (const outcome of market.outcomes ?? []) {
            const decimalOdds = number(outcome.price);
            if (decimalOdds === null) continue;
            let mapped = null;
            if (outcome.name === event.home_team) mapped = "1";
            else if (outcome.name === event.away_team) mapped = "2";
            else if (String(outcome.name).toLowerCase() === "draw") mapped = "X";
            if (!mapped) continue;
            rows.push({ ...base, bookmaker: key, market: "MATCH_RESULT", line: "", outcome: mapped, decimalOdds, quoteUpdatedAt });
          }
        } else if (market.key === "totals") {
          for (const outcome of market.outcomes ?? []) {
            const decimalOdds = number(outcome.price);
            if (decimalOdds === null || outcome.point === undefined || outcome.point === null) continue;
            const name = String(outcome.name).toLowerCase();
            const mapped = name === "over" ? "OVER" : name === "under" ? "UNDER" : null;
            if (!mapped) continue;
            rows.push({ ...base, bookmaker: key, market: "TOTALS", line: String(outcome.point), outcome: mapped, decimalOdds, quoteUpdatedAt });
          }
        }
      }
    }
  }

  return rows;
}
