function iso(value) {
  return value ? new Date(value).toISOString() : "";
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function side(name, event) {
  if (name === event.home_team) return "1";
  if (name === event.away_team) return "2";
  return null;
}

function overUnder(name) {
  const lower = String(name).toLowerCase();
  if (lower === "over") return "OVER";
  if (lower === "under") return "UNDER";
  return null;
}

function yesNo(name) {
  const lower = String(name).toLowerCase();
  if (lower === "yes") return "YES";
  if (lower === "no") return "NO";
  return null;
}

function doubleChanceOutcome(name, event) {
  const lower = String(name).toLowerCase();
  const hasHome = lower.includes(String(event.home_team).toLowerCase());
  const hasAway = lower.includes(String(event.away_team).toLowerCase());
  const hasDraw = lower.includes("draw");
  if (hasHome && hasDraw) return "1X";
  if (hasAway && hasDraw) return "X2";
  if (hasHome && hasAway) return "12";
  return null;
}

function cardsSpreadLine(outcome, event) {
  const name = String(outcome.name);
  const point = Number(outcome.point);
  if (!Number.isFinite(point)) return null;
  if (name === event.home_team) return `${event.home_team}|${point}|${event.away_team}|${-point}`;
  if (name === event.away_team) return `${event.home_team}|${-point}|${event.away_team}|${point}`;
  return null;
}

export function normalizeTheOddsResponse(payload, receivedAt) {
  const events = Array.isArray(payload) ? payload : [];
  const rows = [];
  const seen = new Set();

  function pushRow(row) {
    const key = [
      row.bookmaker,
      row.eventId,
      row.market,
      row.line,
      row.outcome,
    ].join("|");
    if (seen.has(key)) return;
    seen.add(key);
    rows.push(row);
  }

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

        if (market.key === "h2h" || market.key === "h2h_3_way") {
          for (const outcome of market.outcomes ?? []) {
            const decimalOdds = number(outcome.price);
            if (decimalOdds === null) continue;
            let mapped = null;
            if (outcome.name === event.home_team) mapped = "1";
            else if (outcome.name === event.away_team) mapped = "2";
            else if (String(outcome.name).toLowerCase() === "draw") mapped = "X";
            if (!mapped) continue;
            pushRow({ ...base, bookmaker: key, market: "MATCH_RESULT", line: "", outcome: mapped, decimalOdds, quoteUpdatedAt });
          }
        } else if (market.key === "draw_no_bet") {
          for (const outcome of market.outcomes ?? []) {
            const decimalOdds = number(outcome.price);
            if (decimalOdds === null) continue;
            const mapped = side(outcome.name, event);
            if (!mapped) continue;
            pushRow({ ...base, bookmaker: key, market: "DRAW_NO_BET", line: "", outcome: mapped, decimalOdds, quoteUpdatedAt });
          }
        } else if (market.key === "totals" || market.key === "alternate_totals") {
          for (const outcome of market.outcomes ?? []) {
            const decimalOdds = number(outcome.price);
            if (decimalOdds === null || outcome.point === undefined || outcome.point === null) continue;
            const mapped = overUnder(outcome.name);
            if (!mapped) continue;
            pushRow({ ...base, bookmaker: key, market: "TOTALS", line: String(outcome.point), outcome: mapped, decimalOdds, quoteUpdatedAt });
          }
        } else if (market.key === "double_chance") {
          for (const outcome of market.outcomes ?? []) {
            const decimalOdds = number(outcome.price);
            if (decimalOdds === null) continue;
            const mapped = doubleChanceOutcome(outcome.name, event);
            if (!mapped) continue;
            pushRow({ ...base, bookmaker: key, market: "DOUBLE_CHANCE", line: "", outcome: mapped, decimalOdds, quoteUpdatedAt });
          }
        } else if (market.key === "btts") {
          for (const outcome of market.outcomes ?? []) {
            const decimalOdds = number(outcome.price);
            if (decimalOdds === null) continue;
            const mapped = yesNo(outcome.name);
            if (!mapped) continue;
            pushRow({ ...base, bookmaker: key, market: "BTTS", line: "", outcome: mapped, decimalOdds, quoteUpdatedAt });
          }
        } else if (market.key === "team_totals" || market.key === "alternate_team_totals") {
          for (const outcome of market.outcomes ?? []) {
            const decimalOdds = number(outcome.price);
            const team = String(outcome.description ?? "");
            if (decimalOdds === null || !team || outcome.point === undefined || outcome.point === null) continue;
            const mapped = overUnder(outcome.name);
            if (!mapped) continue;
            pushRow({ ...base, bookmaker: key, market: "TEAM_TOTALS", line: `${team}|${outcome.point}`, outcome: mapped, decimalOdds, quoteUpdatedAt });
          }
        } else if (market.key === "alternate_totals_corners") {
          for (const outcome of market.outcomes ?? []) {
            const decimalOdds = number(outcome.price);
            if (decimalOdds === null || outcome.point === undefined || outcome.point === null) continue;
            const mapped = overUnder(outcome.name);
            if (!mapped) continue;
            pushRow({ ...base, bookmaker: key, market: "CORNERS_TOTALS", line: String(outcome.point), outcome: mapped, decimalOdds, quoteUpdatedAt });
          }
        } else if (market.key === "alternate_spreads_cards") {
          for (const outcome of market.outcomes ?? []) {
            const decimalOdds = number(outcome.price);
            const mapped = side(outcome.name, event);
            const line = cardsSpreadLine(outcome, event);
            if (decimalOdds === null || !mapped || !line) continue;
            pushRow({ ...base, bookmaker: key, market: "CARDS_SPREAD", line, outcome: outcome.name, decimalOdds, quoteUpdatedAt });
          }
        } else if (market.key === "player_goal_scorer_anytime") {
          for (const outcome of market.outcomes ?? []) {
            const decimalOdds = number(outcome.price);
            const player = String(outcome.description ?? "");
            const mapped = yesNo(outcome.name);
            if (decimalOdds === null || !player || mapped !== "YES") continue;
            pushRow({ ...base, bookmaker: key, market: "PLAYER_GOALSCORER", line: player, outcome: mapped, decimalOdds, quoteUpdatedAt });
          }
        } else if (market.key === "player_shots" || market.key === "player_shots_on_target") {
          const mappedMarket = market.key === "player_shots" ? "PLAYER_SHOTS" : "PLAYER_SHOTS_ON_TARGET";
          for (const outcome of market.outcomes ?? []) {
            const decimalOdds = number(outcome.price);
            const player = String(outcome.description ?? "");
            const mapped = overUnder(outcome.name);
            if (decimalOdds === null || !player || outcome.point === undefined || outcome.point === null || !mapped) continue;
            pushRow({ ...base, bookmaker: key, market: mappedMarket, line: `${player}|${outcome.point}`, outcome: mapped, decimalOdds, quoteUpdatedAt });
          }
        }
      }
    }
  }

  return rows;
}
