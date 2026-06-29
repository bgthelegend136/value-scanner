// Maps the scanner's The Odds API sport keys to ESPN scoreboard league paths and
// turns ESPN finished events into the score events settlePaperBets() understands
// (keyed by our referenceEventId). ESPN is a FREE, keyless settlement source for
// the leagues football-data.org does not cover.
//
// Only leagues ESPN exposes as home/away-scored fixtures are listed. Combat
// sports (boxing/MMA), cricket, and NPB/KBO are intentionally absent — ESPN does
// not score them as two-team fixtures here, so those bets stay PENDING/REVIEW for
// manual settlement rather than risk a wrong result.
import { paperSportKey } from "./paper.mjs";

export const ESPN_LEAGUES = {
  americanfootball_nfl: "football/nfl",
  americanfootball_ncaaf: "football/college-football",
  basketball_nba: "basketball/nba",
  basketball_wnba: "basketball/wnba",
  baseball_mlb: "baseball/mlb",
  aussierules_afl: "australian-football/afl",
  soccer_brazil_serie_b: "soccer/bra.2",
  soccer_china_superleague: "soccer/chn.1",
  soccer_conmebol_copa_libertadores: "soccer/conmebol.libertadores",
  soccer_conmebol_copa_sudamericana: "soccer/conmebol.sudamericana",
};

export function espnLeagueFor(sportKey) {
  return ESPN_LEAGUES[sportKey] ?? null;
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

function numericScore(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// ESPN reports a date in its own (US) timezone, so a late UTC kickoff can land on
// a neighbouring calendar date. We fetch a ±1 day window and rely on the strict
// UTC-date name match below for correctness, maximising recall without false hits.
function neighborDateParams(iso) {
  const base = Date.parse(`${dateKey(iso)}T00:00:00Z`);
  if (!Number.isFinite(base)) return [];
  const day = 86_400_000;
  return [-1, 0, 1].map((offset) =>
    new Date(base + offset * day).toISOString().slice(0, 10).replace(/-/g, ""),
  );
}

// Distinct (leaguePath, date) fetch targets for the pending, ESPN-covered rows.
export function espnSettlementTargets(rows) {
  const seen = new Map();
  for (const row of rows) {
    const leaguePath = espnLeagueFor(paperSportKey(row));
    if (!leaguePath) continue;
    for (const date of neighborDateParams(row.kickoffUtc)) {
      const key = `${leaguePath}|${date}`;
      if (!seen.has(key)) seen.set(key, { leaguePath, date });
    }
  }
  return [...seen.values()];
}

// Normalize a raw ESPN scoreboard `events` array into flat finished-or-not rows.
export function parseEspnScoreboard(events) {
  const out = [];
  for (const event of events ?? []) {
    const competition = event.competitions?.[0];
    const competitors = competition?.competitors ?? [];
    const home = competitors.find((c) => c.homeAway === "home");
    const away = competitors.find((c) => c.homeAway === "away");
    if (!home || !away) continue;
    const completed = event.status?.type?.completed === true ||
      event.status?.type?.state === "post";
    out.push({
      date: dateKey(event.date),
      completed,
      home: home.team?.displayName ?? home.team?.name ?? "",
      away: away.team?.displayName ?? away.team?.name ?? "",
      homeScore: numericScore(home.score),
      awayScore: numericScore(away.score),
    });
  }
  return out;
}

// Build score events for paper bets that have a finished ESPN event. Match on
// normalized home+away names + UTC date; fall back to names alone only when
// exactly one finished event has those teams. Unmatched bets stay PENDING.
export function synthesizeEspnScoreEvents(rows, parsedEvents) {
  const finished = (parsedEvents ?? []).filter(
    (event) => event.completed && event.homeScore !== null && event.awayScore !== null,
  );

  const byNamesDate = new Map();
  const byNames = new Map();
  for (const event of finished) {
    const home = normalizeName(event.home);
    const away = normalizeName(event.away);
    byNamesDate.set(`${home}|${away}|${event.date}`, event);
    const namesKey = `${home}|${away}`;
    if (!byNames.has(namesKey)) byNames.set(namesKey, []);
    byNames.get(namesKey).push(event);
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
        { name: row.homeTeam, score: String(match.homeScore) },
        { name: row.awayTeam, score: String(match.awayScore) },
      ],
    });
  }
  return events;
}
