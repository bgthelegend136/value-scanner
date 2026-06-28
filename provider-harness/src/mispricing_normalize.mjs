// Scope: Stoiximan + Novibet, MATCH_RESULT-only. The EV floor (see
// mispricing_thresholds.mjs) is tuned to collect 5%+ research/watchlist edges
// while the Telegram formatter labels >=10% separately as urgent.
// Odds-API.io reports `expectedValue` as an index ~ (offered/fair)*100,
// NOT a percentage, so the fraction is (value - 100)/100.
// TOTALS stays deferred (undocumented over/under direction). Novibet candidates
// may resolve to novibet.bet.br (Brazil) -- verify before betting.
import { MIN_CANDIDATE_EV } from "./mispricing_thresholds.mjs";

const MAX_AGE_MS = 10 * 60 * 1000;

const SUPPORTED_BOOKMAKERS = new Set(["Stoiximan", "Novibet"]);
const ALLOWED_HOSTS = {
  Stoiximan: new Set([
    "stoiximan.gr",
    "www.stoiximan.gr",
    "en.stoiximan.gr",
    "m.stoiximan.gr",
  ]),
  Novibet: new Set([
    "novibet.gr",
    "www.novibet.gr",
    "novibet.bet.br",
  ]),
};

function text(value) {
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object") return String(value.name ?? "").trim();
  return "";
}

function slug(value) {
  if (value && typeof value === "object" && value.slug) {
    return String(value.slug).trim().toLowerCase();
  }
  return text(value)
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "");
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function safeUrl(bookmaker, value) {
  try {
    const url = new URL(String(value ?? ""));
    const allowed = ALLOWED_HOSTS[bookmaker] ?? new Set();
    return url.protocol === "https:" && allowed.has(url.hostname.toLowerCase())
      ? url.toString()
      : "";
  } catch {
    return "";
  }
}

export function chooseBookmakerLink({
  bookmaker,
  outcomeLink,
  marketLink,
  eventLink,
}) {
  for (const [depth, value] of [
    ["OUTCOME", outcomeLink],
    ["MARKET", marketLink],
    ["EVENT", eventLink],
  ]) {
    const url = safeUrl(bookmaker, value);
    if (url) return { url, depth };
  }
  return { url: "", depth: "NONE" };
}

function marketShape(raw) {
  const name = String(raw.market?.name ?? "").trim().toLowerCase();
  const side = String(raw.betSide ?? "").trim().toLowerCase();
  if (["ml", "moneyline", "match result", "head to head"].includes(name)) {
    const outcome =
      side === "home" ? "1" : side === "away" ? "2" : side === "draw" ? "X" : "";
    return outcome ? { market: "MATCH_RESULT", line: "", outcome } : null;
  }
  // TOTALS and everything else are out of scope for v1.
  return null;
}

function selectionValue(container, outcome) {
  const key = { "1": "home", X: "draw", "2": "away" }[outcome];
  return key ? container?.[key] : undefined;
}

function selectionLink(container, outcome) {
  const key = {
    "1": "homeDirectLink",
    X: "drawDirectLink",
    "2": "awayDirectLink",
  }[outcome];
  return key ? container?.[key] : "";
}

export function normalizeValueBet(
  raw,
  { receivedAt, now, maxAgeMs = MAX_AGE_MS },
) {
  const reject = (reason) => ({
    candidate: null,
    rejected: {
      candidateId: String(raw?.id ?? "UNKNOWN"),
      providerEventId: String(raw?.eventId ?? "UNKNOWN"),
      bookmaker: String(raw?.bookmaker ?? "UNKNOWN"),
      sportSlug: slug(raw?.event?.sport),
      leagueSlug: slug(raw?.event?.league),
      sportName: text(raw?.event?.sport),
      leagueName: text(raw?.event?.league),
      market: String(raw?.market?.name ?? ""),
      line: String(raw?.market?.hdp ?? raw?.market?.line ?? ""),
      outcome: String(raw?.betSide ?? ""),
      reason,
    },
  });

  if (!SUPPORTED_BOOKMAKERS.has(raw?.bookmaker)) return reject("UNSUPPORTED_BOOKMAKER");

  const expectedValue = finite(raw.expectedValue);
  // Use (value - 100)/100, not value/100 - 1: the latter is float-fragile right
  // at the 20% gate (120/100 - 1 === 0.19999999999999996, which would wrongly
  // reject an exactly-+20% candidate).
  const providerExpectedValue = expectedValue === null ? null : (expectedValue - 100) / 100;
  if (!(providerExpectedValue >= MIN_CANDIDATE_EV)) return reject("CANDIDATE_EV_BELOW_MIN");

  const valueUpdatedAt = new Date(raw.expectedValueUpdatedAt);
  if (!Number.isFinite(valueUpdatedAt.getTime())) return reject("INVALID_VALUE_TIMESTAMP");
  if (now.getTime() - valueUpdatedAt.getTime() > maxAgeMs) return reject("STALE_CANDIDATE");

  const kickoff = new Date(raw.event?.date);
  if (!Number.isFinite(kickoff.getTime())) return reject("INVALID_KICKOFF");
  if (kickoff.getTime() <= now.getTime()) return reject("EVENT_STARTED");

  const shape = marketShape(raw);
  if (!shape) return reject("UNSUPPORTED_MARKET");

  const offeredOdds = finite(
    selectionValue(raw.bookmakerOdds, shape.outcome) ??
      selectionValue(raw.market, shape.outcome),
  );
  if (!(offeredOdds > 1)) return reject("INVALID_OFFERED_ODDS");

  const event = raw.event ?? {};
  const participantOne = text(event.home);
  const participantTwo = text(event.away);
  if (!participantOne || !participantTwo) return reject("MISSING_PARTICIPANTS");

  const outcomeLink =
    selectionLink(raw.bookmakerOdds, shape.outcome) ||
    selectionLink(raw.market, shape.outcome);
  const marketLink = raw.market?.href ?? "";
  const eventLink = raw.bookmakerOdds?.href ?? event.href ?? raw.href ?? "";
  const selectedLink = chooseBookmakerLink({
    bookmaker: raw.bookmaker,
    outcomeLink,
    marketLink,
    eventLink,
  });

  return {
    candidate: {
      candidateId: String(raw.id),
      providerEventId: String(raw.eventId),
      bookmaker: raw.bookmaker,
      providerExpectedValue,
      sportSlug: slug(event.sport),
      leagueSlug: slug(event.league),
      sportName: text(event.sport),
      leagueName: text(event.league),
      kickoffUtc: kickoff.toISOString(),
      participantOne,
      participantTwo,
      market: shape.market,
      line: shape.line,
      outcome: shape.outcome,
      offeredOdds,
      valueUpdatedAt: valueUpdatedAt.toISOString(),
      receivedAt,
      link: selectedLink.url,
      linkDepth: selectedLink.depth,
    },
    rejected: null,
  };
}

export function normalizeValueBets(payload, options) {
  const candidates = [];
  const rejected = [];
  for (const raw of Array.isArray(payload) ? payload : []) {
    const result = normalizeValueBet(raw, options);
    if (result.candidate) candidates.push(result.candidate);
    else rejected.push(result.rejected);
  }
  return { candidates, rejected };
}
