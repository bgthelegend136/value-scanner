// Measurement-only Odds-API.io WebSocket probe.
//
// It records how long Stoiximan/Novibet WebSocket prices remain strict confirmed
// +EV under the same rule as Telegram alerts: Pinnacle fair probability plus
// 3-book consensus EV must both clear the 10% floor. It sends no alerts.

import { access, appendFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveEnvPath } from "../src/cli.mjs";
import { loadEnvFile, requireApiKey, requireKey } from "../src/env.mjs";
import { confirmCandidate } from "../src/mispricing_confirm.mjs";
import { matchCandidateEvent } from "../src/mispricing_match.mjs";
import { candidateIdentity } from "../src/mispricing_state.mjs";
import { loadSportRegistry, resolveSportKey } from "../src/multisport_map.mjs";
import { createTheOddsApiClient } from "../src/theodds_client.mjs";
import { normalizeTheOddsResponse } from "../src/theodds_normalize.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPORTS_DIR = resolve(HERE, "..", "reports");
const DEFAULT_SPORT_MAP = resolve(HERE, "..", "config", "multisport-map.json");
const DEFAULT_WS_BASE_URL = "wss://api.odds-api.io/v3/ws";
const TARGET_BOOKMAKERS = new Set(["Stoiximan", "Novibet"]);
const LEGACY_CSV_COLUMNS = [
  "openedAt", "closedAt", "lifetimeSeconds",
  "eventId", "bookmaker", "market", "line", "outcome",
  "firstOdds", "peakOdds", "lastOdds", "minOdds",
  "startSeq", "endSeq", "startTimestamp", "endTimestamp",
  "endReason", "providerExpectedValue",
];
const STRICT_CSV_COLUMNS = [
  "openedAt", "closedAt", "lifetimeSeconds",
  "providerEventId", "referenceEventId", "sportKey",
  "bookmaker", "match", "market", "line", "outcome",
  "firstOdds", "peakOdds", "lastOdds",
  "firstPinnacleEv", "peakPinnacleEv", "lastPinnacleEv",
  "firstConsensusEv", "peakConsensusEv", "lastConsensusEv",
  "consensusBooks", "minimumConfirmedEv", "edgeOverDispersion",
  "startSeq", "endSeq", "startTimestamp", "endTimestamp", "endReason",
];
const STRICT_AUDIT_COLUMNS = [
  "observedAt", "seq", "providerEventId", "referenceEventId", "sportKey",
  "bookmaker", "match", "market", "line", "outcome", "offeredOdds",
  "maxBet", "status", "reason", "pinnacleEv", "consensusEv", "consensusBooks",
  "minimumConfirmedEv", "edgeOverDispersion",
];
const LIVE_TRAINING_COLUMNS = [
  "observedAt", "seq", "providerEventId", "referenceEventId", "sportKey",
  "liveStatus", "homeScore", "awayScore",
  "bookmaker", "match", "market", "line", "outcome", "offeredOdds",
  "maxBet",
  "pinnacleFairProbability", "pinnacleFairOdds", "pinnacleEv",
  "consensusFairProbability", "consensusFairOdds", "consensusEv", "consensusBooks",
  "minimumConfirmedEv", "edgeOverDispersion",
  "sampleTier", "confirmationStatus", "rejectionReason",
];
const LIVE_EVENT_STATUS_COLUMNS = [
  "observedAt", "providerEventId", "eventStatus", "homeScore", "awayScore",
];
const LIVE_FEED_STATS_COLUMNS = [
  "observedAt", "messageType", "seq", "providerEventId", "bookmaker",
  "markets", "auditRows", "trainingRows", "closedRows", "rejectionReasons",
];

function option(argv, name, fallback = undefined) {
  const hit = argv.find((arg) => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

function hasFlag(argv, name) {
  return argv.includes(`--${name}`);
}

function numericOption(argv, name, fallback) {
  const parsed = Number(option(argv, name, fallback));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function splitOption(argv, name) {
  return String(option(argv, name, ""))
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function targetBookmakersFromArgv(argv) {
  const target = String(option(argv, "target-bookmakers", "")).trim();
  if (target.toUpperCase() === "ALL") return null;
  const names = target
    ? target.split(",").map((item) => item.trim()).filter(Boolean)
    : splitOption(argv, "bookmakers");
  return names.length ? new Set(names) : TARGET_BOOKMAKERS;
}

function finiteOdds(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 1 ? parsed : null;
}

function finitePositive(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function text(value) {
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object") return String(value.name ?? value.title ?? "").trim();
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

function isoFromTimestamp(timestamp, fallback = new Date()) {
  const numeric = Number(timestamp);
  if (Number.isFinite(numeric)) {
    return new Date(numeric < 1e12 ? numeric * 1000 : numeric).toISOString();
  }
  return new Date(fallback).toISOString();
}

export function buildWsUrl({
  apiKey,
  baseUrl = DEFAULT_WS_BASE_URL,
  markets = "ML",
  channels = "odds",
  sport,
  leagues,
  eventIds,
  status,
  lastSeq = 0,
}) {
  const url = new URL(baseUrl);
  url.searchParams.set("apiKey", apiKey);
  if (channels) url.searchParams.set("channels", channels);
  if (markets) url.searchParams.set("markets", markets);
  if (sport) url.searchParams.set("sport", sport);
  if (leagues) url.searchParams.set("leagues", Array.isArray(leagues) ? leagues.join(",") : leagues);
  if (eventIds) url.searchParams.set("eventIds", Array.isArray(eventIds) ? eventIds.join(",") : eventIds);
  if (status) url.searchParams.set("status", status);
  if (Number(lastSeq) > 0) url.searchParams.set("lastSeq", String(lastSeq));
  return url.toString();
}

export function redactWsUrl(value) {
  const url = new URL(value);
  if (url.searchParams.has("apiKey")) url.searchParams.set("apiKey", "REDACTED");
  return url.toString();
}

export function liveShadowAuditPath({ argv, reportsDir }) {
  const explicit = option(argv, "audit-output", "");
  if (explicit) return explicit;
  return hasFlag(argv, "live-shadow") ? join(reportsDir, "ws-live-shadow-audit.csv") : "";
}

export function liveTrainingPath({ argv, reportsDir }) {
  const explicit = option(argv, "training-output", "");
  if (explicit) return explicit;
  return hasFlag(argv, "live-training") ? join(reportsDir, "live-training-observations.csv") : "";
}

export function liveEventStatusPath({ argv, reportsDir }) {
  const explicit = option(argv, "status-output", "");
  if (explicit) return explicit;
  return hasFlag(argv, "live-training") ? join(reportsDir, "live-event-status.csv") : "";
}

export function liveFeedStatsPath({ argv, reportsDir }) {
  const explicit = option(argv, "feed-stats-output", "");
  if (explicit) return explicit;
  return hasFlag(argv, "live-shadow") || hasFlag(argv, "live-training")
    ? join(reportsDir, "ws-live-feed-stats.csv")
    : "";
}

export function createLifetimeState() {
  return {
    active: new Map(),
    lastSeq: 0,
    resyncRequired: null,
  };
}

function marketName(value) {
  return String(value ?? "").trim().toLowerCase();
}

function extractMlSelections(message) {
  const selections = [];
  for (const market of message.markets ?? []) {
    if (!["ml", "moneyline", "match result"].includes(marketName(market.name))) continue;
    for (const odds of market.odds ?? []) {
      for (const [field, outcome] of [["home", "1"], ["draw", "X"], ["away", "2"]]) {
        const decimalOdds = finiteOdds(odds[field]);
        if (!decimalOdds) continue;
        selections.push({
          eventId: String(message.id),
          bookmaker: String(message.bookie ?? ""),
          market: "MATCH_RESULT",
          line: "",
          outcome,
          decimalOdds,
          maxBet: finitePositive(odds.max),
          quoteUpdatedAt: market.updatedAt ?? "",
        });
      }
    }
  }
  return selections;
}

function extractTotalsSelections(message) {
  const selections = [];
  for (const market of message.markets ?? []) {
    if (!["totals", "total"].includes(marketName(market.name))) continue;
    for (const odds of market.odds ?? []) {
      const line = odds.hdp ?? odds.line ?? odds.point ?? odds.total;
      if (line === undefined || line === null || String(line).trim() === "") continue;
      for (const [field, outcome] of [["over", "OVER"], ["under", "UNDER"]]) {
        const decimalOdds = finiteOdds(odds[field]);
        if (!decimalOdds) continue;
        selections.push({
          eventId: String(message.id),
          bookmaker: String(message.bookie ?? ""),
          market: "TOTALS",
          line: String(line),
          outcome,
          decimalOdds,
          maxBet: finitePositive(odds.max),
          quoteUpdatedAt: market.updatedAt ?? "",
        });
      }
    }
  }
  return selections;
}

function extractWsSelections(message) {
  return [
    ...extractMlSelections(message),
    ...extractTotalsSelections(message),
  ];
}

function eventDetails(message) {
  const event = message.event ?? {};
  return {
    home: text(event.home ?? event.homeTeam ?? event.home_team ?? message.home ?? message.homeTeam),
    away: text(event.away ?? event.awayTeam ?? event.away_team ?? message.away ?? message.awayTeam),
    date: event.date ?? event.commence_time ?? event.kickoffUtc ?? message.date ?? message.commence_time,
    sport: event.sport ?? message.sport,
    league: event.league ?? message.league,
  };
}

function extractWsCandidates(message, { targetBookmakers = TARGET_BOOKMAKERS, now = new Date() } = {}) {
  const bookmaker = String(message.bookie ?? message.bookmaker ?? "");
  if (targetBookmakers?.size && !targetBookmakers.has(bookmaker)) return [];
  const details = eventDetails(message);
  const kickoff = new Date(details.date);
  if (!details.home || !details.away || !Number.isFinite(kickoff.getTime())) return [];
  const timestamp = Number.isFinite(Number(message.timestamp))
    ? Number(message.timestamp)
    : Math.floor(new Date(now).getTime() / 1000);
  const valueUpdatedAt = isoFromTimestamp(timestamp, now);
  return extractWsSelections({ ...message, bookie: bookmaker }).map((selection) => ({
    candidateId: `${message.id}-${bookmaker}-${selection.market}-${selection.line}-${selection.outcome}`,
    providerEventId: String(message.id),
    bookmaker,
    providerExpectedValue: "",
    sportSlug: slug(details.sport),
    leagueSlug: slug(details.league),
    sportName: text(details.sport),
    leagueName: text(details.league),
    kickoffUtc: kickoff.toISOString(),
    participantOne: details.home,
    participantTwo: details.away,
    market: selection.market,
    line: selection.line,
    outcome: selection.outcome,
    offeredOdds: selection.decimalOdds,
    maxBet: selection.maxBet,
    valueUpdatedAt,
    receivedAt: valueUpdatedAt,
    link: "",
    linkDepth: "NONE",
  }));
}

function identity(selection) {
  return [
    selection.eventId,
    selection.bookmaker,
    selection.market,
    selection.line,
    selection.outcome,
  ].join("|");
}

function closeEntry(entry, { reason, timestamp, seq, latestOdds = entry.lastOdds }) {
  const startMs = Number(entry.startTimestamp) * 1000;
  const endMs = Number(timestamp) * 1000;
  const lifetimeSeconds = Number.isFinite(startMs) && Number.isFinite(endMs)
    ? Math.max(0, (endMs - startMs) / 1000)
    : 0;
  return {
    openedAt: entry.openedAt,
    closedAt: isoFromTimestamp(timestamp),
    lifetimeSeconds: lifetimeSeconds.toFixed(3),
    eventId: entry.eventId,
    bookmaker: entry.bookmaker,
    market: entry.market,
    line: entry.line,
    outcome: entry.outcome,
    firstOdds: entry.firstOdds.toFixed(4),
    peakOdds: entry.peakOdds.toFixed(4),
    lastOdds: latestOdds.toFixed(4),
    minOdds: entry.minOdds.toFixed(4),
    startSeq: entry.startSeq,
    endSeq: seq ?? "",
    startTimestamp: entry.startTimestamp,
    endTimestamp: timestamp ?? "",
    endReason: reason,
    providerExpectedValue: "",
  };
}

function formatNumber(value, digits = 4) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(digits) : "";
}

function closeStrictEntry(entry, {
  reason,
  timestamp,
  seq,
  candidate = null,
  confirmation = null,
}) {
  const startMs = Number(entry.startTimestamp) * 1000;
  const endMs = Number(timestamp) * 1000;
  const lifetimeSeconds = Number.isFinite(startMs) && Number.isFinite(endMs)
    ? Math.max(0, (endMs - startMs) / 1000)
    : 0;
  const lastOdds = candidate?.offeredOdds ?? entry.lastOdds;
  const lastPinnacleEv = confirmation?.pinnacleEv ?? entry.lastPinnacleEv;
  const lastConsensusEv = confirmation?.consensusEv ?? entry.lastConsensusEv;
  return {
    openedAt: entry.openedAt,
    closedAt: isoFromTimestamp(timestamp),
    lifetimeSeconds: lifetimeSeconds.toFixed(3),
    providerEventId: entry.providerEventId,
    referenceEventId: entry.referenceEventId,
    sportKey: entry.sportKey,
    bookmaker: entry.bookmaker,
    match: `${entry.participantOne} - ${entry.participantTwo}`,
    market: entry.market,
    line: entry.line,
    outcome: entry.outcome,
    firstOdds: formatNumber(entry.firstOdds),
    peakOdds: formatNumber(entry.peakOdds),
    lastOdds: formatNumber(lastOdds),
    firstPinnacleEv: formatNumber(entry.firstPinnacleEv),
    peakPinnacleEv: formatNumber(entry.peakPinnacleEv),
    lastPinnacleEv: formatNumber(lastPinnacleEv),
    firstConsensusEv: formatNumber(entry.firstConsensusEv),
    peakConsensusEv: formatNumber(entry.peakConsensusEv),
    lastConsensusEv: formatNumber(lastConsensusEv),
    consensusBooks: String(confirmation?.consensusBooks ?? entry.consensusBooks ?? ""),
    minimumConfirmedEv: formatNumber(confirmation?.minimumConfirmedEv ?? entry.minimumConfirmedEv),
    edgeOverDispersion: formatNumber(confirmation?.edgeOverDispersion ?? entry.edgeOverDispersion),
    startSeq: entry.startSeq,
    endSeq: seq ?? "",
    startTimestamp: entry.startTimestamp,
    endTimestamp: timestamp ?? "",
    endReason: reason,
  };
}

function strictAuditRow(candidate, { sportKey = "", confirmation = {}, timestamp, seq }) {
  return {
    observedAt: isoFromTimestamp(timestamp),
    seq: String(seq ?? ""),
    providerEventId: candidate.providerEventId,
    referenceEventId: confirmation.referenceEventId ?? "",
    sportKey,
    bookmaker: candidate.bookmaker,
    match: `${candidate.participantOne} - ${candidate.participantTwo}`,
    market: candidate.market,
    line: candidate.line,
    outcome: candidate.outcome,
    offeredOdds: formatNumber(candidate.offeredOdds),
    maxBet: formatNumber(candidate.maxBet),
    status: confirmation.status ?? "REJECTED",
    reason: confirmation.reason ?? "",
    pinnacleEv: formatNumber(confirmation.pinnacleEv),
    consensusEv: formatNumber(confirmation.consensusEv),
    consensusBooks: String(confirmation.consensusBooks ?? ""),
    minimumConfirmedEv: formatNumber(confirmation.minimumConfirmedEv),
    edgeOverDispersion: formatNumber(confirmation.edgeOverDispersion),
  };
}

function scoreText(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? String(parsed) : "";
}

export function applyLiveEventState(scoreStateByEvent, message) {
  if (!scoreStateByEvent || !message?.id) return;
  if (message.type !== "score" && message.type !== "status") return;
  const previous = scoreStateByEvent.get(String(message.id)) ?? {};
  const scores = message.scores ?? {};
  scoreStateByEvent.set(String(message.id), {
    ...previous,
    liveStatus: message.status ?? previous.liveStatus ?? "",
    homeScore: scores.home ?? previous.homeScore ?? "",
    awayScore: scores.away ?? previous.awayScore ?? "",
    scoreUpdatedAt: isoFromTimestamp(message.timestamp, new Date()),
  });
}

export function liveEventStatusRow(message) {
  if (!message?.id || (message.type !== "score" && message.type !== "status")) return null;
  const scores = message.scores ?? {};
  return {
    observedAt: isoFromTimestamp(message.timestamp),
    providerEventId: String(message.id),
    eventStatus: String(message.status ?? message.type ?? ""),
    homeScore: scoreText(scores.home),
    awayScore: scoreText(scores.away),
  };
}

function countReasons(audit) {
  const counts = new Map();
  for (const row of audit) {
    const reason = String(row.reason ?? "").trim();
    if (!reason) continue;
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return [...counts]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([reason, count]) => `${reason}:${count}`)
    .join("|");
}

export function liveFeedStatsRow(message, { audit = [], training = [], closed = [], now = new Date() } = {}) {
  if (!message) return null;
  const markets = (message.markets ?? [])
    .map((market) => String(market.name ?? "").trim())
    .filter(Boolean)
    .join("|");
  return {
    observedAt: isoFromTimestamp(message.timestamp, now),
    messageType: String(message.type ?? ""),
    seq: String(message.seq ?? ""),
    providerEventId: message.id ? String(message.id) : "",
    bookmaker: String(message.bookie ?? message.bookmaker ?? ""),
    markets,
    auditRows: String(audit.length),
    trainingRows: String(training.length),
    closedRows: String(closed.length),
    rejectionReasons: countReasons(audit),
  };
}

function trainingTier(confirmation) {
  if (confirmation.status === "CONFIRMED") return "STRICT_CONFIRMED";
  const ev = Number(confirmation.minimumConfirmedEv);
  return Number.isFinite(ev) && ev >= 0 ? "LIVE_VALUE" : "LIVE_CONTROL";
}

function liveTrainingRow(candidate, {
  sportKey = "",
  confirmation = {},
  timestamp,
  seq,
  scoreState = {},
}) {
  return {
    observedAt: isoFromTimestamp(timestamp),
    seq: String(seq ?? ""),
    providerEventId: candidate.providerEventId,
    referenceEventId: confirmation.referenceEventId ?? "",
    sportKey,
    liveStatus: scoreState.liveStatus ?? "",
    homeScore: scoreText(scoreState.homeScore),
    awayScore: scoreText(scoreState.awayScore),
    bookmaker: candidate.bookmaker,
    match: `${candidate.participantOne} - ${candidate.participantTwo}`,
    market: candidate.market,
    line: candidate.line,
    outcome: candidate.outcome,
    offeredOdds: formatNumber(candidate.offeredOdds),
    maxBet: formatNumber(candidate.maxBet),
    pinnacleFairProbability: formatNumber(confirmation.pinnacleFairProbability, 6),
    pinnacleFairOdds: formatNumber(confirmation.pinnacleFairOdds),
    pinnacleEv: formatNumber(confirmation.pinnacleEv),
    consensusFairProbability: formatNumber(confirmation.consensusFairProbability, 6),
    consensusFairOdds: formatNumber(confirmation.consensusFairOdds),
    consensusEv: formatNumber(confirmation.consensusEv),
    consensusBooks: String(confirmation.consensusBooks ?? ""),
    minimumConfirmedEv: formatNumber(confirmation.minimumConfirmedEv),
    edgeOverDispersion: formatNumber(confirmation.edgeOverDispersion),
    sampleTier: trainingTier(confirmation),
    confirmationStatus: confirmation.status ?? "REJECTED",
    rejectionReason: confirmation.reason ?? "",
  };
}

function closeMatching(state, predicate, context) {
  const closed = [];
  for (const [key, entry] of [...state.active]) {
    if (!predicate(entry)) continue;
    closed.push(closeEntry(entry, context));
    state.active.delete(key);
  }
  return closed;
}

function closeStrictMatching(state, predicate, context) {
  const closed = [];
  for (const [key, entry] of [...state.active]) {
    if (!predicate(entry)) continue;
    closed.push(closeStrictEntry(entry, context));
    state.active.delete(key);
  }
  return closed;
}

function openOrUpdateStrict(state, candidate, confirmation, { sportKey, timestamp, seq }) {
  const key = candidateIdentity(candidate);
  const active = state.active.get(key);
  if (active) {
    active.lastOdds = candidate.offeredOdds;
    active.peakOdds = Math.max(active.peakOdds, candidate.offeredOdds);
    active.lastPinnacleEv = confirmation.pinnacleEv;
    active.peakPinnacleEv = Math.max(active.peakPinnacleEv, confirmation.pinnacleEv);
    active.lastConsensusEv = confirmation.consensusEv;
    active.peakConsensusEv = Math.max(active.peakConsensusEv, confirmation.consensusEv);
    active.minimumConfirmedEv = confirmation.minimumConfirmedEv;
    active.edgeOverDispersion = confirmation.edgeOverDispersion;
    active.consensusBooks = confirmation.consensusBooks;
    active.lastSeq = seq;
    return;
  }
  state.active.set(key, {
    ...candidate,
    sportKey,
    referenceEventId: confirmation.referenceEventId,
    openedAt: isoFromTimestamp(timestamp),
    startTimestamp: timestamp,
    firstOdds: candidate.offeredOdds,
    peakOdds: candidate.offeredOdds,
    lastOdds: candidate.offeredOdds,
    firstPinnacleEv: confirmation.pinnacleEv,
    peakPinnacleEv: confirmation.pinnacleEv,
    lastPinnacleEv: confirmation.pinnacleEv,
    firstConsensusEv: confirmation.consensusEv,
    peakConsensusEv: confirmation.consensusEv,
    lastConsensusEv: confirmation.consensusEv,
    consensusBooks: confirmation.consensusBooks,
    minimumConfirmedEv: confirmation.minimumConfirmedEv,
    edgeOverDispersion: confirmation.edgeOverDispersion,
    startSeq: seq,
  });
}

export function applyWsMessage(
  state,
  message,
  {
    minOdds = 5,
    targetBookmakers = TARGET_BOOKMAKERS,
    now = new Date(),
  } = {},
) {
  if (message?.seq) state.lastSeq = Number(message.seq);
  if (!message || message.type === "welcome" || message.type === "score" || message.type === "status") return [];
  if (message.type === "resync_required") {
    state.resyncRequired = message;
    return [];
  }

  const bookmaker = String(message.bookie ?? "");
  if (targetBookmakers?.size && bookmaker && !targetBookmakers.has(bookmaker)) return [];

  const timestamp = Number.isFinite(Number(message.timestamp))
    ? Number(message.timestamp)
    : Math.floor(new Date(now).getTime() / 1000);
  const seq = message.seq ?? "";

  if (message.type === "deleted" || message.type === "no_markets") {
    return closeMatching(
      state,
      (entry) => entry.eventId === String(message.id) && entry.bookmaker === bookmaker,
      { reason: message.type === "deleted" ? "DELETED" : "NO_MARKETS", timestamp, seq },
    );
  }

  if (message.type !== "created" && message.type !== "updated") return [];

  const seen = new Set();
  const closed = [];
  for (const selection of extractMlSelections(message)) {
    const key = identity(selection);
    seen.add(key);
    const active = state.active.get(key);
    if (selection.decimalOdds >= minOdds) {
      if (active) {
        active.lastOdds = selection.decimalOdds;
        active.peakOdds = Math.max(active.peakOdds, selection.decimalOdds);
        active.lastSeenAt = isoFromTimestamp(timestamp);
        active.lastSeq = seq;
      } else {
        state.active.set(key, {
          ...selection,
          openedAt: isoFromTimestamp(timestamp),
          startTimestamp: timestamp,
          firstOdds: selection.decimalOdds,
          peakOdds: selection.decimalOdds,
          lastOdds: selection.decimalOdds,
          minOdds,
          startSeq: seq,
        });
      }
    } else if (active) {
      closed.push(closeEntry(active, {
        reason: "UPDATED_BELOW_THRESHOLD",
        timestamp,
        seq,
        latestOdds: selection.decimalOdds,
      }));
      state.active.delete(key);
    }
  }

  closed.push(...closeMatching(
    state,
    (entry) => entry.eventId === String(message.id) && entry.bookmaker === bookmaker && !seen.has(identity(entry)),
    { reason: "SELECTION_MISSING", timestamp, seq },
  ));
  return closed;
}

async function defaultReferenceSnapshot(referenceClient, sportKey) {
  const events = await referenceClient.listEvents({ sportKey });
  const odds = await referenceClient.getOdds({ sportKey, markets: "h2h,totals" });
  return {
    events: events.data ?? [],
    selections: normalizeTheOddsResponse(odds.data ?? [], odds.receivedAt),
  };
}

export async function evaluateStrictEvMessageWithAudit(
  state,
  message,
  {
    referenceClient,
    registry = new Map(),
    activeSports = [],
    sportKey: explicitSportKey = "",
    targetBookmakers = TARGET_BOOKMAKERS,
    referenceSnapshot = null,
    scoreStateByEvent = new Map(),
    trainingMinEv = null,
    now = new Date(),
  } = {},
) {
  if (message?.seq) state.lastSeq = Number(message.seq);
  if (!message || message.type === "welcome" || message.type === "score" || message.type === "status") {
    return { closed: [], audit: [], training: [] };
  }
  if (message.type === "resync_required") {
    state.resyncRequired = message;
    return { closed: [], audit: [], training: [] };
  }

  const timestamp = Number.isFinite(Number(message.timestamp))
    ? Number(message.timestamp)
    : Math.floor(new Date(now).getTime() / 1000);
  const seq = message.seq ?? "";
  const bookmaker = String(message.bookie ?? message.bookmaker ?? "");
  if (targetBookmakers?.size && bookmaker && !targetBookmakers.has(bookmaker)) {
    return { closed: [], audit: [], training: [] };
  }

  if (message.type === "deleted" || message.type === "no_markets") {
    return {
      closed: closeStrictMatching(
      state,
      (entry) => entry.providerEventId === String(message.id) && (!bookmaker || entry.bookmaker === bookmaker),
      { reason: message.type === "deleted" ? "DELETED" : "NO_MARKETS", timestamp, seq },
      ),
      audit: [],
      training: [],
    };
  }
  if (message.type !== "created" && message.type !== "updated") return { closed: [], audit: [], training: [] };

  const candidates = extractWsCandidates(message, { targetBookmakers, now });
  const activeKeys = new Set(activeSports.filter((sport) => sport.active !== false).map((sport) => sport.key));
  const bySport = new Map();
  const evaluations = new Map();

  for (const candidate of candidates) {
    const resolvedSportKey = explicitSportKey ||
      resolveSportKey(candidate, registry, activeKeys, activeSports).sportKey;
    const identity = candidateIdentity(candidate);
    if (!resolvedSportKey) {
      evaluations.set(identity, { candidate, confirmation: { status: "REJECTED", reason: "UNMAPPED_SPORT_LEAGUE" } });
      continue;
    }
    if (!bySport.has(resolvedSportKey)) bySport.set(resolvedSportKey, []);
    bySport.get(resolvedSportKey).push(candidate);
  }

  for (const [sportKey, sportCandidates] of bySport) {
    let snapshot;
    try {
      snapshot = referenceSnapshot
        ? await referenceSnapshot(sportKey)
        : await defaultReferenceSnapshot(referenceClient, sportKey);
    } catch {
      for (const candidate of sportCandidates) {
        evaluations.set(candidateIdentity(candidate), {
          candidate,
          sportKey,
          confirmation: { status: "REJECTED", reason: "REFERENCE_PROVIDER_ERROR" },
        });
      }
      continue;
    }
    for (const candidate of sportCandidates) {
      const match = matchCandidateEvent(candidate, snapshot.events);
      if (!match.event) {
        evaluations.set(candidateIdentity(candidate), {
          candidate,
          sportKey,
          confirmation: { status: "REJECTED", reason: match.reason },
        });
        continue;
      }
      const confirmation = confirmCandidate(candidate, match.event, snapshot.selections, { now: new Date(now) });
      evaluations.set(candidateIdentity(candidate), { candidate, sportKey, confirmation });
    }
  }

  const closed = [];
  const audit = [];
  const training = [];
  const seen = new Set(candidates.map((candidate) => candidateIdentity(candidate)));
  for (const [identity, result] of evaluations) {
    audit.push(strictAuditRow(result.candidate, {
      sportKey: result.sportKey ?? "",
      confirmation: result.confirmation,
      timestamp,
      seq,
    }));
    const minimumEv = Number(result.confirmation.minimumConfirmedEv);
    if (Number.isFinite(trainingMinEv) && Number.isFinite(minimumEv) && minimumEv >= trainingMinEv) {
      training.push(liveTrainingRow(result.candidate, {
        sportKey: result.sportKey ?? "",
        confirmation: result.confirmation,
        timestamp,
        seq,
        scoreState: scoreStateByEvent.get(String(result.candidate.providerEventId)) ?? {},
      }));
    }
    if (result.confirmation.status === "CONFIRMED") {
      openOrUpdateStrict(state, result.candidate, result.confirmation, {
        sportKey: result.sportKey,
        timestamp,
        seq,
      });
      continue;
    }
    const active = state.active.get(identity);
    if (active) {
      closed.push(closeStrictEntry(active, {
        reason: result.confirmation.reason,
        timestamp,
        seq,
        candidate: result.candidate,
        confirmation: result.confirmation,
      }));
      state.active.delete(identity);
    }
  }

  for (const [identity, active] of [...state.active]) {
    if (active.providerEventId !== String(message.id) || active.bookmaker !== bookmaker) continue;
    if (seen.has(identity)) continue;
    closed.push(closeStrictEntry(active, { reason: "SELECTION_MISSING", timestamp, seq }));
    state.active.delete(identity);
  }

  return { closed, audit, training };
}

export async function evaluateStrictEvMessage(state, message, options = {}) {
  const { closed } = await evaluateStrictEvMessageWithAudit(state, message, options);
  return closed;
}

async function fileExists(path) {
  return access(path).then(() => true, () => false);
}

function encodeCsvValue(value) {
  const text = String(value ?? "");
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

async function appendCsvRows(path, rows, columns) {
  if (rows.length === 0) return;
  await mkdir(dirname(path), { recursive: true });
  const existing = await fileExists(path);
  const lines = [
    ...(existing ? [] : [columns.map(encodeCsvValue).join(",")]),
    ...rows.map((row) => columns.map((column) => encodeCsvValue(row[column])).join(",")),
  ];
  await appendFile(path, `${lines.join("\r\n")}\r\n`, "utf8");
}

export function createSerializedCsvAppender(columns) {
  let tail = Promise.resolve();
  return async function append(path, rows) {
    if (rows.length === 0) return;
    const write = tail.then(
      () => appendCsvRows(path, rows, columns),
      () => appendCsvRows(path, rows, columns),
    );
    tail = write.catch(() => {});
    return write;
  };
}

async function dataAsText(data) {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("utf8");
  if (data?.text) return await data.text();
  return String(data ?? "");
}

async function runProbe(argv = process.argv.slice(2)) {
  if (typeof WebSocket === "undefined") {
    throw new Error("Node.js global WebSocket is unavailable; use Node 22+");
  }

  const envPath = await resolveEnvPath(process.cwd());
  const env = await loadEnvFile(envPath);
  const apiKey = requireApiKey(env);
  const referenceClient = createTheOddsApiClient({ apiKey: requireKey(env, "THE_ODDS_API_KEY") });
  const registry = await loadSportRegistry(DEFAULT_SPORT_MAP);
  const sportsResponse = await referenceClient.listSports();
  const state = createLifetimeState();
  const appendStrictRows = createSerializedCsvAppender(STRICT_CSV_COLUMNS);
  const appendAuditRows = createSerializedCsvAppender(STRICT_AUDIT_COLUMNS);
  const appendTrainingRows = createSerializedCsvAppender(LIVE_TRAINING_COLUMNS);
  const appendLiveStatusRows = createSerializedCsvAppender(LIVE_EVENT_STATUS_COLUMNS);
  const appendFeedStatsRows = createSerializedCsvAppender(LIVE_FEED_STATS_COLUMNS);
  const reportsDir = resolve(option(argv, "reports-dir", DEFAULT_REPORTS_DIR));
  const outputPath = resolve(option(argv, "output", join(reportsDir, "ws-lifetime-log.csv")));
  const auditOutput = liveShadowAuditPath({ argv, reportsDir });
  const auditOutputPath = auditOutput ? resolve(auditOutput) : "";
  const trainingOutput = liveTrainingPath({ argv, reportsDir });
  const trainingOutputPath = trainingOutput ? resolve(trainingOutput) : "";
  const statusOutput = liveEventStatusPath({ argv, reportsDir });
  const statusOutputPath = statusOutput ? resolve(statusOutput) : "";
  const feedStatsOutput = liveFeedStatsPath({ argv, reportsDir });
  const feedStatsOutputPath = feedStatsOutput ? resolve(feedStatsOutput) : "";
  const trainingMinEv = trainingOutputPath
    ? numericOption(argv, "live-training-min-ev", -5) / 100
    : null;
  const durationMinutes = numericOption(argv, "duration-minutes", 120);
  const referenceTtlMs = numericOption(argv, "reference-ttl-seconds", 60) * 1000;
  const effectiveBookmakers = targetBookmakersFromArgv(argv);
  const explicitSportKey = option(argv, "sport-key", "");
  const referenceCache = new Map();
  const liveEventStates = new Map();
  const referenceSnapshot = async (sportKey) => {
    const cached = referenceCache.get(sportKey);
    if (cached && Date.now() - cached.cachedAt < referenceTtlMs) return cached.snapshot;
    const snapshot = await defaultReferenceSnapshot(referenceClient, sportKey);
    referenceCache.set(sportKey, { cachedAt: Date.now(), snapshot });
    return snapshot;
  };
  const startedAt = Date.now();
  const stopAt = startedAt + durationMinutes * 60_000;
  let reconnectAttempts = 0;
  let ws = null;

  const connect = () => {
    const url = buildWsUrl({
      apiKey,
      markets: option(argv, "markets", "ML"),
      channels: option(argv, "channels", "odds"),
      sport: option(argv, "sport", "football"),
      leagues: option(argv, "leagues"),
      eventIds: option(argv, "eventIds"),
      status: option(argv, "status", "prematch"),
      lastSeq: state.lastSeq,
    });
    console.log(`Connecting ${redactWsUrl(url)}`);
    console.log(`Measurement target bookmakers: ${effectiveBookmakers ? [...effectiveBookmakers].join(",") : "ALL"}`);
    ws = new WebSocket(url);

    ws.onopen = () => {
      reconnectAttempts = 0;
      console.log(`WebSocket connected; logging strict confirmed EV lifetimes to ${outputPath}`);
    };

    ws.onmessage = async (event) => {
      let message;
      try {
        message = JSON.parse(await dataAsText(event.data));
      } catch {
        return;
      }
      if (message.type === "welcome") {
        console.log(`Welcome: channels=${(message.channels ?? []).join(",") || "?"}, bookmakers=${(message.bookmakers ?? []).join(",") || "?"}`);
      }
      applyLiveEventState(liveEventStates, message);
      const statusRow = liveEventStatusRow(message);
      const { closed: rows, audit, training } = await evaluateStrictEvMessageWithAudit(state, message, {
        referenceClient,
        registry,
        activeSports: sportsResponse.data ?? [],
        sportKey: explicitSportKey,
        targetBookmakers: effectiveBookmakers,
        referenceSnapshot,
        scoreStateByEvent: liveEventStates,
        trainingMinEv,
        now: new Date(),
      });
      const feedStatsRow = liveFeedStatsRow(message, {
        audit,
        training,
        closed: rows,
        now: new Date(),
      });
      await appendStrictRows(outputPath, rows);
      if (auditOutputPath) await appendAuditRows(auditOutputPath, audit);
      if (trainingOutputPath) await appendTrainingRows(trainingOutputPath, training);
      if (statusOutputPath && statusRow) await appendLiveStatusRows(statusOutputPath, [statusRow]);
      if (feedStatsOutputPath && feedStatsRow) await appendFeedStatsRows(feedStatsOutputPath, [feedStatsRow]);
      if (rows.length) console.log(`Closed ${rows.length} lifetime row(s); lastSeq=${state.lastSeq || "?"}`);
      if (auditOutputPath && audit.length) console.log(`Audited ${audit.length} strict EV candidate row(s); lastSeq=${state.lastSeq || "?"}`);
      if (trainingOutputPath && training.length) console.log(`Recorded ${training.length} live training observation(s); lastSeq=${state.lastSeq || "?"}`);
      if (state.resyncRequired) {
        console.error(`resync_required: ${state.resyncRequired.reason ?? "unknown"}; reconnecting with latest seq after close`);
        ws?.close();
      }
    };

    ws.onerror = () => {
      console.error("WebSocket error");
    };

    ws.onclose = () => {
      if (Date.now() >= stopAt) {
        console.log("WebSocket probe duration complete.");
        return;
      }
      reconnectAttempts += 1;
      const delay = Math.min(1000 * (2 ** reconnectAttempts), 30_000);
      setTimeout(connect, delay);
    };
  };

  connect();
  setTimeout(() => ws?.close(), Math.max(1_000, stopAt - Date.now()));
}

const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  runProbe().catch((error) => {
    console.error(`ws-lifetime-probe error: ${error.message}`);
    process.exitCode = 1;
  });
}
