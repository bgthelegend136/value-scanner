// Maps the scanner's The Odds API sport keys to football-data.org free-tier
// competition codes, and turns football-data finished matches into the score
// events settlePaperBets() already understands (keyed by our referenceEventId).
//
// Only the free-tier soccer competitions are listed; any sport key not here
// (Brazil Série B, League of Ireland, Superettan, baseball, NFL, …) is left to
// the existing The Odds API settle path.
export const FD_COMPETITIONS = {
  soccer_fifa_world_cup: "WC",
  soccer_brazil_campeonato: "BSA",
  soccer_brazil_serie_a: "BSA",
  soccer_epl: "PL",
  soccer_italy_serie_a: "SA",
  soccer_spain_la_liga: "PD",
  soccer_germany_bundesliga: "BL1",
  soccer_france_ligue_one: "FL1",
  soccer_netherlands_eredivisie: "DED",
  soccer_portugal_primeira_liga: "PPL",
  soccer_uefa_champs_league: "CL",
  soccer_efl_champ: "ELC",
};

export function fdCompetitionFor(sportKey) {
  return FD_COMPETITIONS[sportKey] ?? null;
}

function normalizeName(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();
}

function dateKey(iso) {
  return String(iso ?? "").slice(0, 10);
}

// Build score events for paper bets that have a finished football-data match.
// Match on normalized home+away names + UTC date; fall back to names alone only
// when exactly one finished match has those teams (avoids settling the wrong leg
// when a team plays twice). Unmatched bets are simply skipped (stay PENDING).
export function synthesizeFdScoreEvents(rows, fdMatches) {
  const finished = (fdMatches ?? []).filter(
    (m) => m.status === "FINISHED" && m.score?.fullTime &&
      m.score.fullTime.home != null && m.score.fullTime.away != null,
  );

  const byNamesDate = new Map();
  const byNames = new Map();
  for (const m of finished) {
    const home = normalizeName(m.homeTeam?.name);
    const away = normalizeName(m.awayTeam?.name);
    byNamesDate.set(`${home}|${away}|${dateKey(m.utcDate)}`, m);
    const namesKey = `${home}|${away}`;
    if (!byNames.has(namesKey)) byNames.set(namesKey, []);
    byNames.get(namesKey).push(m);
  }

  const events = [];
  for (const row of rows) {
    const home = normalizeName(row.homeTeam);
    const away = normalizeName(row.awayTeam);
    let match = byNamesDate.get(`${home}|${away}|${dateKey(row.kickoffUtc)}`);
    if (!match) {
      const candidates = byNames.get(`${home}|${away}`) ?? [];
      if (candidates.length === 1) match = candidates[0];
    }
    if (!match) continue;
    events.push({
      id: String(row.referenceEventId),
      completed: true,
      home_team: row.homeTeam,
      away_team: row.awayTeam,
      scores: [
        { name: row.homeTeam, score: String(match.score.fullTime.home) },
        { name: row.awayTeam, score: String(match.score.fullTime.away) },
      ],
    });
  }
  return events;
}
