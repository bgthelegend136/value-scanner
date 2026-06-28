import { execFile } from "node:child_process";
import { access, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { createOddsApiClient } from "./client.mjs";
import { compareObservation, summarizeComparisons } from "./compare.mjs";
import { readCsv, writeCsv } from "./csv.mjs";
import { loadEnvFile, requireApiKey, requireKey } from "./env.mjs";
import { normalizeOddsResponse } from "./normalize.mjs";
import { createTheOddsApiClient } from "./theodds_client.mjs";
import { normalizeTheOddsResponse } from "./theodds_normalize.mjs";
import { matchFixtures } from "./match.mjs";
import { consensusFairProbabilities, devigPower, findValueBets } from "./value.mjs";
import { formatAlert } from "./alert.mjs";
import { MARKET_MARGINS, analyzeBoost, comboOverround } from "./boost.mjs";
import {
  PAPER_COLUMNS,
  applyClosingLine,
  findStalePending,
  mergePaperBets,
  paperSportKey,
  settlePaperBets,
  summarizeClv,
  summarizeClvCalibration,
  summarizeClvTrend,
  summarizePaperBets,
  summarizeResearchStatus,
} from "./paper.mjs";
import { createValueBetsClient } from "./value_bets_client.mjs";
import { createTelegramClient } from "./telegram.mjs";
import { createMispricingState } from "./mispricing_state.mjs";
import {
  settleMispricingAlerts,
  summarizeMispricingSettlements,
} from "./mispricing_settle.mjs";
import { CLV_CAPTURE_WINDOW_MS } from "./mispricing_thresholds.mjs";
import { loadSportRegistry } from "./multisport_map.mjs";
import { runMispricingScan } from "./mispricing_scan.mjs";
import { matchCandidateEvent } from "./mispricing_match.mjs";
import { confirmCandidate } from "./mispricing_confirm.mjs";
import { parseLegPick, legFairProbabilities } from "./boost_legs.mjs";
import { analyzeBoostMix, parseMixLeg, priceMixLeg } from "./boost_mix.mjs";
import { createFootballDataClient } from "./football_data_client.mjs";
import { fdCompetitionFor, synthesizeFdScoreEvents } from "./football_data_settle.mjs";
import { buildProfitEngineReport, profitEngineRows } from "./profit_engine.mjs";
import { buildDataHealthReport, DATA_HEALTH_COLUMNS } from "./data_health.mjs";
import { buildProfitabilityReport, profitabilityCsvRow, PROFITABILITY_COLUMNS } from "./profitability_report.mjs";
import { buildCalibrationReport, calibrationCsvRow, CALIBRATION_REPORT_COLUMNS } from "./calibration_report.mjs";
import { buildStakingSimReport, stakingSimCsvRow, STAKING_SIM_COLUMNS } from "./staking_sim.mjs";
import { buildDailyDecisionReport } from "./daily_decision_report.mjs";

const execFileAsync = promisify(execFile);

const TARGET_BOOKMAKERS = ["Novibet", "Stoiximan"];
const REFERENCE_BOOKMAKER = "pinnacle";
const PAPER_REFERENCE_MARKETS = "h2h,totals";
const SOCCER_CORE_RESEARCH_MARKETS = "h2h,h2h_3_way,draw_no_bet,btts,double_chance";
// Quota guard: stop a multi-league scan once The Odds API monthly credits drop
// below this floor, so the autoscan can never drain the budget to zero. The
// reserve leaves room for CLV capture (the irreplaceable spend).
const MIN_SCAN_QUOTA = 1000;
const SCAN_COLUMNS = [
  "bookmaker", "eventId", "kickoffUtc", "homeTeam", "awayTeam",
  "market", "line", "outcome", "decimalOdds", "fairOdds", "fairProbability",
  "ev", "status",
];
const OPPORTUNITY_COLUMNS = ["ev", "tier", "match", "pick", "bookmaker", "odd", "fairOdd", "marketFair", "books", "kickoffUtc"];
const THEODDS_SWEEP_COLUMNS = [
  "sportKey", "eventId", "kickoffUtc", "homeTeam", "awayTeam", "bookmaker",
  "market", "line", "outcome", "decimalOdds", "fairOdds", "fairProbability",
  "ev", "status", "consensusBooks",
];
const THEODDS_SWEEP_COVERAGE_COLUMNS = [
  "sportKey", "eventId", "market", "normalizedRows", "candidateRows",
  "pricedCandidates", "valueCandidates", "controlCandidates",
  "noValueCandidates", "tooFewBooksCandidates", "reason",
];
const SOCCER_CORE_COVERAGE_MARKETS = ["MATCH_RESULT", "DRAW_NO_BET", "BTTS", "DOUBLE_CHANCE"];
const LIVE_PREFLIGHT_COLUMNS = [
  "eventId", "home", "away", "status", "bookmakerCount",
  "snapshotRows", "markets", "maxSeq", "reason",
];
const LIVE_FEED_STATS_COLUMNS = [
  "observedAt", "messageType", "seq", "providerEventId", "bookmaker",
  "markets", "auditRows", "trainingRows", "closedRows", "rejectionReasons",
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
  "source",
];
const MARKET_AVAILABILITY_COLUMNS = [
  "sportKey", "eventId", "market", "bookCount", "books", "reason", "creditsSpent",
];
const MATCH_RESULT_PICK = { "1": "Home (1)", X: "Draw (X)", "2": "Away (2)" };

const CANONICAL_COLUMNS = [
  "provider",
  "bookmaker",
  "eventId",
  "competition",
  "kickoffUtc",
  "homeTeam",
  "awayTeam",
  "period",
  "market",
  "line",
  "outcome",
  "decimalOdds",
  "quoteUpdatedAt",
  "receivedAt",
  "regionalStatus",
];
const MANUAL_COLUMNS = ["siteOdds", "siteObservedAt", "notes"];
const CAPTURE_COLUMNS = [...CANONICAL_COLUMNS, ...MANUAL_COLUMNS];
const SUMMARY_COLUMNS = [
  "bookmaker",
  "market",
  "observations",
  "exactRate",
  "acceptableRate",
  "largeMismatchRate",
  "meanSignedImpliedProbabilityDifferencePp",
];

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPORTS_DIR = resolve(HERE, "..", "reports");
const DEFAULT_SPORT_MAP = resolve(HERE, "..", "config", "multisport-map.json");

const defaultFileExists = (path) => access(path).then(() => true, () => false);

async function readCsvIfPresent(path) {
  return await defaultFileExists(path) ? readCsv(path) : [];
}

async function defaultRunGit(startDir) {
  try {
    const { stdout } = await execFileAsync("git", [
      "-C",
      startDir,
      "rev-parse",
      "--git-common-dir",
    ]);
    return stdout.trim();
  } catch {
    return null;
  }
}

export async function resolveEnvPath(
  startDir,
  { fileExists = defaultFileExists, runGit = defaultRunGit } = {},
) {
  let dir = resolve(startDir);
  for (;;) {
    const candidate = join(dir, ".env.local");
    if (await fileExists(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  const commonDir = await runGit(startDir);
  if (commonDir) {
    const mainRoot = dirname(resolve(startDir, commonDir));
    const candidate = join(mainRoot, ".env.local");
    if (await fileExists(candidate)) return candidate;
  }

  throw new Error(".env.local not found from the working directory or the git root");
}

async function defaultLoadApiKey() {
  const envPath = await resolveEnvPath(process.cwd());
  const env = await loadEnvFile(envPath);
  return requireApiKey(env);
}

async function defaultLoadTheOddsKey() {
  const envPath = await resolveEnvPath(process.cwd());
  const env = await loadEnvFile(envPath);
  return requireKey(env, "THE_ODDS_API_KEY");
}

async function defaultLoadFootballDataKey() {
  const envPath = await resolveEnvPath(process.cwd());
  const env = await loadEnvFile(envPath);
  return requireKey(env, "football_data_org_key");
}

async function defaultLoadMispricingConfig() {
  const envPath = await resolveEnvPath(process.cwd());
  const env = await loadEnvFile(envPath);
  return {
    oddsApiKey: requireKey(env, "ODDS_API_IO_KEY"),
    theOddsApiKey: requireKey(env, "THE_ODDS_API_KEY"),
    telegramToken: requireKey(env, "TELEGRAM_BOT_TOKEN"),
    telegramChatId: requireKey(env, "TELEGRAM_CHAT_ID"),
  };
}

function formatRateLimit(rateLimit) {
  const { limit, remaining, resetAt } = rateLimit ?? {};
  return `Rate limit: remaining ${remaining ?? "?"} of ${limit ?? "?"} (resets ${resetAt ?? "?"})`;
}

function asPercent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function stampFrom(now) {
  return now().toISOString().replaceAll(":", "-");
}

async function runEvents({ loadApiKey, createClient, out }) {
  const apiKey = await loadApiKey();
  const client = createClient({ apiKey });
  const { data, rateLimit } = await client.listEvents({ sport: "football", limit: 5 });

  const events = Array.isArray(data) ? data : data?.events ?? data?.data ?? [];
  const bounded = events.slice(0, 5);

  const lines = [`Upcoming football events (showing ${bounded.length}):`];
  for (const event of bounded) {
    const league = event.league?.name ?? event.league ?? "";
    const kickoff = event.date ? new Date(event.date).toISOString() : "";
    const suffix = league ? `  (${league})` : "";
    lines.push(`  ${event.id}  ${kickoff}  ${event.home} vs ${event.away}${suffix}`);
  }
  lines.push(formatRateLimit(rateLimit));
  out(`${lines.join("\n")}\n`);
  return 0;
}

function bookmakerName(value) {
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object") {
    return String(value.name ?? value.title ?? value.key ?? value.bookmaker ?? "").trim();
  }
  return "";
}

function selectedBookmakerNames(payload) {
  const source = Array.isArray(payload)
    ? payload
    : payload?.bookmakers ?? payload?.selected ?? payload?.data ?? Object.values(payload ?? {});
  const candidates = Array.isArray(source) ? source : Object.values(source ?? {});
  return [...new Set(candidates
    .map(bookmakerName)
    .filter(Boolean))];
}

function canonicalLiveMarket(value) {
  const name = String(value ?? "").trim().toLowerCase();
  if (["ml", "moneyline", "match_result", "match result", "h2h"].includes(name)) return "MATCH_RESULT";
  if (["totals", "total"].includes(name)) return "TOTALS";
  if (["btts", "both teams to score"].includes(name)) return "BTTS";
  if (["double_chance", "double chance"].includes(name)) return "DOUBLE_CHANCE";
  return name.toUpperCase();
}

function countReasons(rows) {
  const counts = {};
  for (const row of rows) counts[row.reason] = (counts[row.reason] ?? 0) + 1;
  return counts;
}

async function runLivePreflight({ args, loadApiKey, createClient, out, reportsDir, now }) {
  const sport = optionValue(args, "sport", "football");
  const requestedBookmakers = splitArg(args, "bookmakers");
  const bookmakers = requestedBookmakers.length ? requestedBookmakers : TARGET_BOOKMAKERS;
  const requestedMarkets = new Set(
    String(optionValue(args, "markets", "ML"))
      .split(",")
      .map(canonicalLiveMarket)
      .filter(Boolean),
  );
  const maxEvents = Math.max(0, Math.floor(numericArg(args, "max-events", 50)));
  const client = createClient({ apiKey: await loadApiKey() });

  const selectedResponse = await client.listSelectedBookmakers();
  const selectedBookmakers = selectedBookmakerNames(selectedResponse.data);
  const selectedSet = new Set(selectedBookmakers.map((name) => name.toLowerCase()));
  const selectedBookmakersVisible = bookmakers.every((name) => selectedSet.has(name.toLowerCase()));

  const liveResponse = await client.listLiveEvents({ sport });
  const liveEvents = (liveResponse.data ?? []).slice(0, maxEvents);
  const rowsByEvent = new Map(liveEvents.map((event) => [String(event.id), {
    eventId: String(event.id),
    home: event.home ?? "",
    away: event.away ?? "",
    status: event.status ?? "",
    bookmakerCount: String(event.bookmakerCount ?? ""),
    snapshotRows: "0",
    markets: "",
    maxSeq: "",
    reason: "NO_MARKET",
  }]));
  let maxSeq = null;

  for (let index = 0; index < liveEvents.length; index += 10) {
    const chunk = liveEvents.slice(index, index + 10);
    const response = await client.getOddsMulti({
      eventIds: chunk.map((event) => String(event.id)),
      bookmakers,
      includeSeq: true,
    });
    if (Number.isFinite(response.seq)) maxSeq = Math.max(maxSeq ?? 0, response.seq);
    for (const event of response.data ?? []) {
      const eventId = String(event.id);
      const normalized = normalizeOddsResponse(event, response.receivedAt);
      const filtered = normalized.filter((row) =>
        bookmakers.includes(row.bookmaker) && requestedMarkets.has(row.market),
      );
      const markets = [...new Set(filtered.map((row) => row.market))].sort();
      const existing = rowsByEvent.get(eventId) ?? {
        eventId,
        home: event.home ?? "",
        away: event.away ?? "",
        status: event.status ?? "",
        bookmakerCount: String(event.bookmakerCount ?? ""),
      };
      rowsByEvent.set(eventId, {
        ...existing,
        snapshotRows: String(filtered.length),
        markets: markets.join("|"),
        maxSeq: Number.isFinite(response.seq) ? String(response.seq) : "",
        reason: filtered.length > 0 ? "MARKET_AVAILABLE" : "NO_MARKET",
      });
    }
  }

  const rows = liveEvents.length
    ? [...rowsByEvent.values()]
    : [{
      eventId: "",
      home: "",
      away: "",
      status: "",
      bookmakerCount: "",
      snapshotRows: "0",
      markets: "",
      maxSeq: "",
      reason: "NO_LIVE_EVENTS",
    }];
  const usableEventIds = rows
    .filter((row) => row.reason === "MARKET_AVAILABLE")
    .map((row) => row.eventId);
  const summary = {
    generatedAt: now().toISOString(),
    sport,
    requestedBookmakers: bookmakers,
    selectedBookmakers,
    selectedBookmakersVisible,
    liveEventCount: liveEvents.length,
    snapshotEventCount: rows.filter((row) => row.eventId).length,
    usableEventCount: usableEventIds.length,
    maxSeq,
    reasons: countReasons(rows),
  };

  await writeCsv(join(reportsDir, "live-preflight.csv"), rows, LIVE_PREFLIGHT_COLUMNS);
  await writeFile(
    join(reportsDir, "live-preflight.json"),
    `${JSON.stringify({ summary, usableEventIds, events: rows }, null, 2)}\n`,
    "utf8",
  );
  await writeFile(join(reportsDir, "live-preflight-eventIds.txt"), `${usableEventIds.join("\n")}${usableEventIds.length ? "\n" : ""}`, "utf8");

  out(`Live preflight: usableEvents=${usableEventIds.length}, liveEvents=${liveEvents.length}, selectedBookmakersVisible=${selectedBookmakersVisible ? "yes" : "no"}, maxSeq=${maxSeq ?? "none"}.\n`);
  out("Wrote live-preflight.csv, live-preflight.json, and live-preflight-eventIds.txt\n");
  return 0;
}

function marketFilterFromArg(value) {
  return new Set(String(value ?? "ML")
    .split(",")
    .map(canonicalLiveMarket)
    .filter(Boolean));
}

function liveUpdatedTrainingRow(row, observedAt) {
  return {
    observedAt,
    seq: "",
    providerEventId: row.eventId,
    referenceEventId: "",
    sportKey: "",
    liveStatus: "",
    homeScore: "",
    awayScore: "",
    bookmaker: row.bookmaker,
    match: `${row.homeTeam} - ${row.awayTeam}`,
    market: row.market,
    line: row.line,
    outcome: row.outcome,
    offeredOdds: Number(row.decimalOdds).toFixed(4),
    maxBet: "",
    pinnacleFairProbability: "",
    pinnacleFairOdds: "",
    pinnacleEv: "",
    consensusFairProbability: "",
    consensusFairOdds: "",
    consensusEv: "",
    consensusBooks: "",
    minimumConfirmedEv: "",
    edgeOverDispersion: "",
    sampleTier: "LIVE_UNCONFIRMED",
    confirmationStatus: "UNCONFIRMED",
    rejectionReason: "",
    source: "updated_poll",
  };
}

function sleep(ms) {
  return new Promise((resolveSleep) => { setTimeout(resolveSleep, ms); });
}

async function runLiveUpdatedPoll({ args, loadApiKey, createClient, out, reportsDir, now }) {
  const sport = optionValue(args, "sport", "Football");
  const bookmakers = splitArg(args, "bookmakers");
  const targetBookmakers = bookmakers.length ? bookmakers : TARGET_BOOKMAKERS;
  const intervalMs = Math.max(1, numericArg(args, "interval-seconds", 45)) * 1000;
  const durationMs = Math.max(0, numericArg(args, "duration-minutes", 30)) * 60_000;
  const marketFilter = marketFilterFromArg(optionValue(args, "markets", "ML"));
  const client = createClient({ apiKey: await loadApiKey() });
  const feedRows = [];
  const trainingRows = [];
  const stopAt = Date.now() + durationMs;

  do {
    const since = Math.floor((now().getTime() - 55_000) / 1000);
    for (const bookmaker of targetBookmakers) {
      const response = await client.getOddsUpdated({ since, bookmaker, sport });
      for (const event of response.data ?? []) {
        const observedAt = response.receivedAt ?? now().toISOString();
        const normalized = normalizeOddsResponse(event, observedAt).filter((row) =>
          row.bookmaker === bookmaker && marketFilter.has(row.market),
        );
        if (normalized.length === 0) continue;
        const markets = [...new Set(normalized.map((row) => row.market))].sort();
        feedRows.push({
          observedAt,
          messageType: "updated_poll",
          seq: "",
          providerEventId: String(event.id ?? ""),
          bookmaker,
          markets: markets.join("|"),
          auditRows: "0",
          trainingRows: String(normalized.length),
          closedRows: "0",
          rejectionReasons: "",
        });
        trainingRows.push(...normalized.map((row) => liveUpdatedTrainingRow(row, observedAt)));
      }
    }
    if (durationMs === 0 || Date.now() >= stopAt) break;
    await sleep(Math.min(intervalMs, Math.max(1, stopAt - Date.now())));
  } while (Date.now() < stopAt);

  await writeCsv(join(reportsDir, "ws-live-feed-stats.csv"), feedRows, LIVE_FEED_STATS_COLUMNS);
  await writeCsv(join(reportsDir, "live-training-observations.csv"), trainingRows, LIVE_TRAINING_COLUMNS);
  out(`Live updated poll: feedRows=${feedRows.length}, trainingRows=${trainingRows.length}, bookmakers=${targetBookmakers.join(",")}.\n`);
  return 0;
}

function bookmakerMarketEntries(payload) {
  if (Array.isArray(payload)) return payload;
  return Object.entries(payload ?? {}).map(([key, value]) => ({
    key,
    markets: Array.isArray(value) ? value : value?.markets,
  }));
}

function marketKey(value) {
  if (typeof value === "string") return value;
  return String(value?.key ?? value?.name ?? "").trim();
}

function marketAvailabilityBooks(payload) {
  const byMarket = new Map();
  for (const entry of bookmakerMarketEntries(payload)) {
    const bookmaker = String(entry.key ?? entry.title ?? entry.name ?? entry.bookmaker ?? "").trim();
    if (!bookmaker) continue;
    for (const market of entry.markets ?? []) {
      const key = marketKey(market);
      if (!key) continue;
      if (!byMarket.has(key)) byMarket.set(key, new Set());
      byMarket.get(key).add(bookmaker);
    }
  }
  return byMarket;
}

async function runMarketAvailability({ args, loadTheOddsKey, createTheOddsClient, out, reportsDir, now }) {
  const sports = splitArg(args, "sports");
  const sportKeys = sports.length ? sports : ["soccer_spain_la_liga", "soccer_germany_bundesliga", "soccer_italy_serie_a"];
  const markets = splitArg(args, "markets");
  const marketKeys = markets.length ? markets : ["btts", "draw_no_bet", "double_chance", "totals"];
  const regions = optionValue(args, "regions", "eu");
  const eventLimit = Math.max(0, Math.floor(numericArg(args, "event-limit", 20)));
  const maxCredits = Math.min(100, Math.max(0, Math.floor(numericArg(args, "max-credits", 100))));
  const minBooks = Math.max(1, Math.floor(numericArg(args, "min-books", 3)));
  const client = createTheOddsClient({ apiKey: await loadTheOddsKey() });
  const rows = [];
  let creditsSpent = 0;
  let stoppedByCreditCap = false;

  for (const sportKey of sportKeys) {
    const eventsResponse = await client.listEvents({ sportKey });
    const events = (eventsResponse.data ?? []).slice(0, eventLimit);
    if (events.length === 0) {
      for (const market of marketKeys) {
        rows.push({ sportKey, eventId: "", market, bookCount: "0", books: "", reason: "NO_EVENT", creditsSpent: String(creditsSpent) });
      }
      continue;
    }
    for (const event of events) {
      if (creditsSpent + 1 > maxCredits) {
        stoppedByCreditCap = true;
        break;
      }
      const response = await client.getEventMarkets({ sportKey, eventId: event.id, regions });
      creditsSpent += Number(response.quota?.lastCost ?? 1) || 1;
      const byMarket = marketAvailabilityBooks(response.data ?? []);
      for (const market of marketKeys) {
        const books = [...(byMarket.get(market) ?? new Set())].sort();
        const reason = books.length === 0
          ? "NO_MARKET"
          : books.length < minBooks
            ? "TOO_FEW_BOOKS"
            : "MARKET_AVAILABLE";
        rows.push({
          sportKey,
          eventId: String(event.id ?? ""),
          market,
          bookCount: String(books.length),
          books: books.join("|"),
          reason,
          creditsSpent: String(creditsSpent),
        });
      }
    }
    if (stoppedByCreditCap) break;
  }

  const summary = {
    generatedAt: now().toISOString(),
    sports: sportKeys,
    markets: marketKeys,
    regions,
    minBooks,
    maxCredits,
    creditsSpent,
    stoppedByCreditCap,
    reasons: countReasons(rows),
  };
  await writeCsv(join(reportsDir, "market-availability.csv"), rows, MARKET_AVAILABILITY_COLUMNS);
  await writeFile(
    join(reportsDir, "market-availability.json"),
    `${JSON.stringify({ summary, rows }, null, 2)}\n`,
    "utf8",
  );
  out(`Market availability: rows=${rows.length}, creditsSpent=${creditsSpent}, stoppedByCreditCap=${stoppedByCreditCap ? "yes" : "no"}.\n`);
  return 0;
}

async function runCapture(eventId, { loadApiKey, createClient, out, reportsDir, now }) {
  const apiKey = await loadApiKey();
  const client = createClient({ apiKey });
  const { data, receivedAt, rateLimit } = await client.getOdds({
    eventId: String(eventId),
    bookmakers: TARGET_BOOKMAKERS,
  });

  const rows = normalizeOddsResponse(data, receivedAt)
    .filter((selection) => TARGET_BOOKMAKERS.includes(selection.bookmaker))
    .map((selection) => ({ ...selection, siteOdds: "", siteObservedAt: "", notes: "" }));

  const reportPath = join(reportsDir, `capture-${eventId}-${stampFrom(now)}.csv`);
  await writeCsv(reportPath, rows, CAPTURE_COLUMNS);

  out(`Wrote ${rows.length} canonical selections to ${reportPath}\n`);
  out(`${formatRateLimit(rateLimit)}\n`);
  return 0;
}

async function runEvaluate(csvPath, { out, reportsDir, now }) {
  const rows = await readCsv(csvPath);

  const results = [];
  const notApplicable = [];
  const rejected = [];
  let incomplete = 0;

  for (const row of rows) {
    if (row.bookmaker === "Superbet" && row.market === "DOUBLE_CHANCE") {
      notApplicable.push(row);
      continue;
    }
    if (!row.siteOdds || row.siteOdds.trim() === "") {
      incomplete += 1;
      continue;
    }
    const selection = { ...row, decimalOdds: Number(row.decimalOdds) };
    try {
      results.push(compareObservation(selection, row));
    } catch (error) {
      rejected.push({ row, reason: error.message });
    }
  }

  const summary = summarizeComparisons(results);

  const lines = [
    `Evaluated ${rows.length} rows: ${results.length} compared, ` +
      `${notApplicable.length} NOT_APPLICABLE, ${rejected.length} REJECTED, ` +
      `${incomplete} incomplete.`,
  ];
  for (const stratum of summary) {
    lines.push(
      `  ${stratum.bookmaker} / ${stratum.market}: n=${stratum.observations} ` +
        `exact=${asPercent(stratum.exactRate)} acceptable=${asPercent(stratum.acceptableRate)} ` +
        `large=${asPercent(stratum.largeMismatchRate)} ` +
        `meanSignedIPpp=${stratum.meanSignedImpliedProbabilityDifferencePp.toFixed(3)}`,
    );
  }
  for (const row of notApplicable) {
    lines.push(`  NOT_APPLICABLE: ${row.bookmaker} / ${row.market} / ${row.outcome}`);
  }
  for (const item of rejected) {
    lines.push(
      `  REJECTED: ${item.row.bookmaker} / ${item.row.market} / ${item.row.outcome} — ${item.reason}`,
    );
  }
  out(`${lines.join("\n")}\n`);

  const reportPath = join(reportsDir, `evaluation-${stampFrom(now)}.csv`);
  await writeCsv(reportPath, summary, SUMMARY_COLUMNS);
  out(`Wrote evaluation summary to ${reportPath}\n`);
  return 0;
}

function toFixtureList(events, shape) {
  return events.map(shape).filter((e) => e.homeTeam && e.awayTeam && e.kickoffUtc);
}

function chunk(items, size) {
  const groups = [];
  for (let index = 0; index < items.length; index += size) {
    groups.push(items.slice(index, index + size));
  }
  return groups;
}

function scanRow(result) {
  return {
    bookmaker: result.bookmaker,
    eventId: result.eventId,
    kickoffUtc: result.kickoffUtc ?? "",
    homeTeam: result.homeTeam ?? "",
    awayTeam: result.awayTeam ?? "",
    market: result.market,
    line: result.line,
    outcome: result.outcome,
    decimalOdds: result.decimalOdds,
    fairOdds: result.fairOdds !== undefined ? result.fairOdds.toFixed(4) : "",
    fairProbability: result.fairProbability !== undefined ? result.fairProbability.toFixed(4) : "",
    ev: result.ev !== undefined ? result.ev.toFixed(4) : "",
    status: result.status,
  };
}

function opportunityRow(result, fixture, consensus) {
  const pick =
    result.market === "MATCH_RESULT" ? MATCH_RESULT_PICK[result.outcome] : `${result.outcome} ${result.line}`;
  const market = consensus.get(`${result.market}|${result.line}|${result.outcome}`);
  return {
    ev: `+${(result.ev * 100).toFixed(1)}%`,
    tier: result.status,
    match: `${fixture.homeTeam} v ${fixture.awayTeam}`,
    pick,
    bookmaker: result.bookmaker,
    odd: result.decimalOdds.toFixed(2),
    fairOdd: result.fairOdds.toFixed(2),
    marketFair: market ? (1 / market.fairProbability).toFixed(2) : "",
    books: market ? String(market.books) : "",
    kickoffUtc: fixture.kickoffUtc,
  };
}

// Price one league's Stoiximan/Novibet odds against its Pinnacle reference.
// Every returned opportunity/pair carries the league's sportKey so paper bets,
// CLV capture, and settlement can later query the right reference sport.
async function scanLeague({
  oddsClient, theOddsClient, sport, leagueSlug, sportKey, threshold, targetBookmakers,
  sampleMinEv = null,
}) {
  const referenceEventsRaw = await theOddsClient.listEvents({ sportKey });
  const referenceFixtures = toFixtureList(referenceEventsRaw.data ?? [], (e) => ({
    eventId: String(e.id), homeTeam: e.home_team, awayTeam: e.away_team, kickoffUtc: e.commence_time,
  }));

  const oddsEventsRaw = await oddsClient.listEvents({
    sport,
    league: leagueSlug,
    status: "pending",
    limit: 100,
  });
  const oddsEvents = Array.isArray(oddsEventsRaw.data) ? oddsEventsRaw.data : oddsEventsRaw.data?.events ?? [];
  const bettableFixtures = toFixtureList(oddsEvents, (e) => ({
    eventId: String(e.id), homeTeam: e.home, awayTeam: e.away, kickoffUtc: e.date,
  }));

  const pairs = matchFixtures(referenceFixtures, bettableFixtures).map((pair) => ({ ...pair, sportKey }));

  const referenceOdds = await theOddsClient.getOdds({ sportKey, markets: PAPER_REFERENCE_MARKETS });
  const allReferenceSelections = normalizeTheOddsResponse(referenceOdds.data, referenceOdds.receivedAt);
  const referenceSelections = allReferenceSelections.filter((row) => row.bookmaker === REFERENCE_BOOKMAKER);

  // Only fixtures we have a Pinnacle reference for are worth pricing.
  const usablePairs = pairs.filter((pair) =>
    referenceSelections.some((s) => s.eventId === pair.referenceEventId),
  );

  // Fetch bettable odds in batches of up to 10 events per request (/odds/multi).
  const bettableByEvent = new Map();
  for (const group of chunk(usablePairs, 10)) {
    const response = await oddsClient.getOddsMulti({
      eventIds: group.map((pair) => String(pair.bettableEventId)),
      bookmakers: targetBookmakers,
    });
    for (const event of Array.isArray(response.data) ? response.data : []) {
      const rows = normalizeOddsResponse(event, response.receivedAt).filter(
        (row) =>
          targetBookmakers.includes(row.bookmaker) &&
          (row.market === "MATCH_RESULT" || row.market === "TOTALS"),
      );
      bettableByEvent.set(String(event.id), rows);
    }
  }

  const opportunities = [];
  const sampleControls = [];
  const allRows = [];
  for (const pair of usablePairs) {
    const refForFixture = referenceSelections.filter((s) => s.eventId === pair.referenceEventId);
    const consensus = consensusFairProbabilities(
      allReferenceSelections.filter((s) => s.eventId === pair.referenceEventId),
    );
    const bettable = bettableByEvent.get(String(pair.bettableEventId)) ?? [];

    for (const result of findValueBets(bettable, refForFixture, { threshold })) {
      if (result.status === "NO_REFERENCE") continue;
      allRows.push(scanRow(result));
      if (result.status !== "NO_VALUE") opportunities.push({ result, fixture: pair, consensus });
      if (
        result.status === "NO_VALUE" &&
        Number.isFinite(sampleMinEv) &&
        result.ev >= sampleMinEv
      ) {
        sampleControls.push({
          result: { ...result, status: "CONTROL" },
          fixture: pair,
          consensus,
        });
      }
    }
  }

  return {
    matchedFixtures: pairs.length,
    opportunities,
    sampleControls,
    allRows,
    quotaRemaining: referenceOdds.quota?.remaining,
  };
}

async function runScan({
  loadApiKey, loadTheOddsKey, createClient, createTheOddsClient, out, reportsDir, now, threshold,
  loadRegistry = loadSportRegistry, registryPath = DEFAULT_SPORT_MAP,
  targetBookmakers = TARGET_BOOKMAKERS,
  sampleMinEv = null,
  sampleLimit = 0,
  sampleRepeat = false,
}) {
  const oddsClient = createClient({ apiKey: await loadApiKey() });
  const theOddsClient = createTheOddsClient({ apiKey: await loadTheOddsKey() });

  // Scan every mapped league whose sharp reference sport is in season now. The
  // map pairs an Odds-API.io `sport|league` slug with a The Odds API sport key.
  const registry = await loadRegistry(registryPath);
  const sportsRes = await theOddsClient.listSports();
  const activeKeys = new Set(
    (sportsRes.data ?? []).filter((s) => s.active !== false).map((s) => String(s.key)),
  );
  const leagues = [];
  for (const [slug, sportKey] of registry) {
    if (!activeKeys.has(sportKey)) continue;
    const [sport, leagueSlug] = slug.split("|");
    leagues.push({ sport, leagueSlug, sportKey });
  }

  const opportunities = [];
  const sampleControls = [];
  const allRows = [];
  let matchedFixtures = 0;
  let quotaRemaining;
  for (const league of leagues) {
    const result = await scanLeague({
      oddsClient,
      theOddsClient,
      ...league,
      threshold,
      targetBookmakers,
      sampleMinEv,
    });
    opportunities.push(...result.opportunities);
    sampleControls.push(...result.sampleControls);
    allRows.push(...result.allRows);
    matchedFixtures += result.matchedFixtures;
    if (result.quotaRemaining !== undefined) quotaRemaining = result.quotaRemaining;
    if (Number.isFinite(quotaRemaining) && quotaRemaining < MIN_SCAN_QUOTA) {
      out(`Stopping scan: The Odds API quota ${quotaRemaining} is below the ${MIN_SCAN_QUOTA}-credit floor (reserved for CLV).\n`);
      break;
    }
  }

  opportunities.sort((a, b) => b.result.ev - a.result.ev);
  sampleControls.sort((a, b) => b.result.ev - a.result.ev);
  const sampledControls = sampleLimit > 0
    ? sampleControls.slice(0, sampleLimit)
    : sampleControls;

  const header = `Value scan — ${leagues.length} in-season league${leagues.length === 1 ? "" : "s"}, ${matchedFixtures} matched fixtures, ${opportunities.length} value bets (EV >= ${(threshold * 100).toFixed(1)}%).`;
  out(`${header}\n\n`);
  for (const { result, fixture } of opportunities) out(`${formatAlert(result, { fixture })}\n\n`);
  out(`The Odds API quota remaining: ${quotaRemaining ?? "?"}\n`);

  const stamp = stampFrom(now);
  const reportPath = join(reportsDir, `scan-${stamp}.csv`);
  await writeCsv(reportPath, opportunities.map(({ result, fixture, consensus }) => opportunityRow(result, fixture, consensus)), OPPORTUNITY_COLUMNS);
  const allPath = join(reportsDir, `scan-all-${stamp}.csv`);
  await writeCsv(allPath, allRows, SCAN_COLUMNS);
  out(`Wrote ${opportunities.length} value bets to ${reportPath}\n`);
  out(`Full audit data (${allRows.length} rows) at ${allPath}\n`);

  const ledgerPath = join(reportsDir, "paper-bets.csv");
  const existingPaperBets = await readCsvIfPresent(ledgerPath);
  const merged = mergePaperBets(existingPaperBets, opportunities, {
    firstSeenAt: now().toISOString(),
    includeFirstSeenAtInKey: sampleRepeat,
  });
  const sampledMerged = mergePaperBets(merged.rows, sampledControls, {
    firstSeenAt: now().toISOString(),
    includeFirstSeenAtInKey: sampleRepeat,
  });
  await writeCsv(ledgerPath, sampledMerged.rows, PAPER_COLUMNS);
  out(`Recorded ${merged.added} new paper bet${merged.added === 1 ? "" : "s"}.\n`);
  out(`Skipped ${merged.duplicates} duplicate paper bet${merged.duplicates === 1 ? "" : "s"}.\n`);
  if (Number.isFinite(sampleMinEv)) {
    out(
      `Sampled ${sampledMerged.added} paper observation${sampledMerged.added === 1 ? "" : "s"} ` +
      `from EV >= ${(sampleMinEv * 100).toFixed(1)}% controls.\n`,
    );
    out(`Skipped ${sampledMerged.duplicates} duplicate sampled observation${sampledMerged.duplicates === 1 ? "" : "s"}.\n`);
  }
  return 0;
}

function optionValue(args, name, fallback = undefined) {
  const hit = args.find((arg) => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

function numericArg(args, name, fallback) {
  const parsed = Number(optionValue(args, name, fallback));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function splitArg(args, name) {
  return String(optionValue(args, name, ""))
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function sweepStatus(ev) {
  if (ev >= 0.15) return "SUSPICIOUS";
  if (ev >= 0.05) return "VALUE_CHECK";
  return "VALUE";
}

function sweepRow(result) {
  return {
    sportKey: result.sportKey,
    eventId: result.eventId,
    kickoffUtc: result.kickoffUtc,
    homeTeam: result.homeTeam,
    awayTeam: result.awayTeam,
    bookmaker: result.bookmaker,
    market: result.market,
    line: result.line ?? "",
    outcome: result.outcome,
    decimalOdds: result.decimalOdds.toFixed(4),
    fairOdds: result.fairOdds.toFixed(4),
    fairProbability: result.fairProbability.toFixed(6),
    ev: result.ev.toFixed(6),
    status: result.status,
    consensusBooks: String(result.consensusBooks),
  };
}

function sweepOpportunity(result) {
  return {
    result,
    fixture: {
      referenceEventId: result.eventId,
      bettableEventId: result.eventId,
      sportKey: result.sportKey,
      kickoffUtc: result.kickoffUtc,
      homeTeam: result.homeTeam,
      awayTeam: result.awayTeam,
    },
    consensus: new Map(),
  };
}

function normalizeTheOddsPayload(payload, receivedAt) {
  return normalizeTheOddsResponse(Array.isArray(payload) ? payload : [payload], receivedAt);
}

function findTheOddsSweepRows(rows, {
  sportKey,
  threshold,
  sampleMinEv,
  minBooks,
  candidateBookmakers,
}) {
  const byEvent = new Map();
  for (const row of rows) {
    if (!byEvent.has(row.eventId)) byEvent.set(row.eventId, []);
    byEvent.get(row.eventId).push(row);
  }

  const values = [];
  const controls = [];
  const audit = [];
  const candidateSet = candidateBookmakers.length ? new Set(candidateBookmakers) : null;
  for (const eventRows of byEvent.values()) {
    for (const candidate of eventRows) {
      if (candidate.bookmaker === REFERENCE_BOOKMAKER) continue;
      if (candidateSet && !candidateSet.has(candidate.bookmaker)) continue;
      const referenceRows = eventRows.filter((row) => row.bookmaker !== candidate.bookmaker);
      const consensus = consensusFairProbabilities(referenceRows);
      const key = `${candidate.market}|${candidate.line}|${candidate.outcome}`;
      const fair = consensus.get(key);
      if (!fair?.fairProbability || fair.books < minBooks) continue;
      const ev = candidate.decimalOdds * fair.fairProbability - 1;
      const result = {
        ...candidate,
        sportKey,
        fairProbability: fair.fairProbability,
        fairOdds: 1 / fair.fairProbability,
        ev,
        consensusBooks: fair.books,
        status: ev >= threshold ? sweepStatus(ev) : "NO_VALUE",
      };
      audit.push(result);
      if (ev >= threshold) values.push(result);
      else if (Number.isFinite(sampleMinEv) && ev >= sampleMinEv) {
        controls.push({ ...result, status: "CONTROL" });
      }
    }
  }
  return { values, controls, audit };
}

function summarizeSweepCoverage(rows, {
  sportKey,
  threshold,
  sampleMinEv,
  minBooks,
  candidateBookmakers,
  expectedMarkets = SOCCER_CORE_COVERAGE_MARKETS,
}) {
  const byEvent = new Map();
  for (const row of rows) {
    if (!byEvent.has(row.eventId)) byEvent.set(row.eventId, []);
    byEvent.get(row.eventId).push(row);
  }

  const coverage = [];
  const candidateSet = candidateBookmakers.length ? new Set(candidateBookmakers) : null;
  for (const [eventId, eventRows] of byEvent) {
    for (const market of expectedMarkets) {
      const marketRows = eventRows.filter((row) => row.market === market);
      const candidates = marketRows.filter((row) =>
        row.bookmaker !== REFERENCE_BOOKMAKER &&
        (!candidateSet || candidateSet.has(row.bookmaker)),
      );
      let pricedCandidates = 0;
      let valueCandidates = 0;
      let controlCandidates = 0;
      let noValueCandidates = 0;
      let tooFewBooksCandidates = 0;

      for (const candidate of candidates) {
        const referenceRows = eventRows.filter((row) => row.bookmaker !== candidate.bookmaker);
        const consensus = consensusFairProbabilities(referenceRows);
        const key = `${candidate.market}|${candidate.line}|${candidate.outcome}`;
        const fair = consensus.get(key);
        if (!fair?.fairProbability || fair.books < minBooks) {
          tooFewBooksCandidates += 1;
          continue;
        }
        pricedCandidates += 1;
        const ev = candidate.decimalOdds * fair.fairProbability - 1;
        if (ev >= threshold) valueCandidates += 1;
        else if (Number.isFinite(sampleMinEv) && ev >= sampleMinEv) controlCandidates += 1;
        else noValueCandidates += 1;
      }

      let reason = "HAS_VALUE";
      if (marketRows.length === 0) reason = "NO_MARKET";
      else if (pricedCandidates === 0) reason = "TOO_FEW_BOOKS";
      else if (valueCandidates === 0) reason = "NO_VALUE";

      coverage.push({
        sportKey,
        eventId,
        market,
        normalizedRows: String(marketRows.length),
        candidateRows: String(candidates.length),
        pricedCandidates: String(pricedCandidates),
        valueCandidates: String(valueCandidates),
        controlCandidates: String(controlCandidates),
        noValueCandidates: String(noValueCandidates),
        tooFewBooksCandidates: String(tooFewBooksCandidates),
        reason,
      });
    }
  }
  return coverage;
}

async function runTheOddsSweep({
  args,
  loadTheOddsKey,
  createTheOddsClient,
  out,
  reportsDir,
  now,
}) {
  const client = createTheOddsClient({ apiKey: await loadTheOddsKey() });
  const threshold = numericArg(args, "edge", 2) / 100;
  const sampleMinEvRaw = optionValue(args, "sample-min-ev", "");
  const sampleMinEv = sampleMinEvRaw === "" ? null : Number(sampleMinEvRaw) / 100;
  const sampleLimit = Math.max(0, Math.floor(numericArg(args, "sample-limit", 100)));
  const minBooks = Math.max(2, Math.floor(numericArg(args, "min-books", 4)));
  const maxSports = Math.max(1, Math.floor(numericArg(args, "max-sports", 12)));
  const marketProfile = optionValue(args, "market-profile", "");
  const soccerCore = marketProfile === "soccer-core";
  const markets = optionValue(args, "markets", soccerCore ? SOCCER_CORE_RESEARCH_MARKETS : PAPER_REFERENCE_MARKETS);
  const regions = optionValue(args, "regions", "eu");
  const candidateBookmakers = splitArg(args, "bookmakers");
  const explicitSports = splitArg(args, "sports");
  const eventLimit = Math.max(1, Math.floor(numericArg(args, "event-limit", 8)));
  const maxEventCredits = Math.max(0, Math.floor(numericArg(args, "max-event-credits", 250)));
  const sportsResponse = await client.listSports();
  const activeSports = (sportsResponse.data ?? []).filter((sport) => sport.active !== false);
  const activeKeys = new Set(activeSports.map((sport) => String(sport.key)));
  const sportKeys = (explicitSports.length ? explicitSports : activeSports.map((sport) => String(sport.key)))
    .filter((sportKey) => activeKeys.has(sportKey))
    .filter((sportKey) => !soccerCore || sportKey.startsWith("soccer_"))
    .slice(0, maxSports);

  const values = [];
  const controls = [];
  const audit = [];
  const coverage = [];
  let quotaRemaining;
  let actualCredits = 0;
  let skippedSports = 0;
  for (const sportKey of sportKeys) {
    if (soccerCore) {
      const eventsResponse = await client.listEvents({ sportKey });
      quotaRemaining = eventsResponse.quota?.remaining ?? quotaRemaining;
      actualCredits += Number(eventsResponse.quota?.lastCost ?? 0) || 0;
      const eventIds = (eventsResponse.data ?? []).map((event) => String(event.id)).filter(Boolean).slice(0, eventLimit);
      for (const eventId of eventIds) {
        if (maxEventCredits > 0 && actualCredits >= maxEventCredits) break;
        let response;
        try {
          response = await client.getEventOdds({ sportKey, eventId, regions, markets });
        } catch (error) {
          if (!String(error.message).includes("status 422")) throw error;
          skippedSports += 1;
          break;
        }
        quotaRemaining = response.quota?.remaining ?? quotaRemaining;
        actualCredits += Number(response.quota?.lastCost ?? 0) || 0;
        const rows = normalizeTheOddsPayload(response.data ?? [], response.receivedAt);
        coverage.push(...summarizeSweepCoverage(rows, {
          sportKey,
          threshold,
          sampleMinEv,
          minBooks,
          candidateBookmakers,
        }));
        const result = findTheOddsSweepRows(rows, {
          sportKey,
          threshold,
          sampleMinEv,
          minBooks,
          candidateBookmakers,
        });
        values.push(...result.values);
        controls.push(...result.controls);
        audit.push(...result.audit);
      }
      if (Number.isFinite(quotaRemaining) && quotaRemaining < MIN_SCAN_QUOTA) break;
      if (maxEventCredits > 0 && actualCredits >= maxEventCredits) break;
      continue;
    }

    let response;
    try {
      response = await client.getOdds({ sportKey, regions, markets });
    } catch (error) {
      if (!String(error.message).includes("status 422")) throw error;
      if (markets === "h2h") {
        skippedSports += 1;
        continue;
      }
      try {
        response = await client.getOdds({ sportKey, regions, markets: "h2h" });
      } catch (fallbackError) {
        if (!String(fallbackError.message).includes("status 422")) throw fallbackError;
        skippedSports += 1;
        continue;
      }
    }
    quotaRemaining = response.quota?.remaining ?? quotaRemaining;
    actualCredits += Number(response.quota?.lastCost ?? 0) || 0;
    const rows = normalizeTheOddsPayload(response.data ?? [], response.receivedAt);
    const result = findTheOddsSweepRows(rows, {
      sportKey,
      threshold,
      sampleMinEv,
      minBooks,
      candidateBookmakers,
    });
    values.push(...result.values);
    controls.push(...result.controls);
    audit.push(...result.audit);
    if (Number.isFinite(quotaRemaining) && quotaRemaining < MIN_SCAN_QUOTA) break;
  }

  values.sort((a, b) => b.ev - a.ev);
  controls.sort((a, b) => b.ev - a.ev);
  const sampledControls = sampleLimit ? controls.slice(0, sampleLimit) : controls;
  const stamp = stampFrom(now);
  await writeCsv(join(reportsDir, `theodds-sweep-${stamp}.csv`), audit.map(sweepRow), THEODDS_SWEEP_COLUMNS);
  if (soccerCore) {
    await writeCsv(
      join(reportsDir, `theodds-sweep-coverage-${stamp}.csv`),
      coverage,
      THEODDS_SWEEP_COVERAGE_COLUMNS,
    );
  }

  const ledgerPath = join(reportsDir, "paper-bets.csv");
  const existing = await readCsvIfPresent(ledgerPath);
  const mergedValues = mergePaperBets(existing, values.map(sweepOpportunity), {
    firstSeenAt: now().toISOString(),
  });
  const mergedControls = mergePaperBets(mergedValues.rows, sampledControls.map(sweepOpportunity), {
    firstSeenAt: now().toISOString(),
  });
  await writeCsv(ledgerPath, mergedControls.rows, PAPER_COLUMNS);

  out(
    `The Odds sweep — sports=${sportKeys.length}, skippedSports=${skippedSports}, auditRows=${audit.length}, value=${values.length}, controls=${sampledControls.length}, credits=${actualCredits}.\n`,
  );
  out(`Recorded ${mergedValues.added} new sweep value paper bet${mergedValues.added === 1 ? "" : "s"}.\n`);
  out(`Sampled ${mergedControls.added} sweep control${mergedControls.added === 1 ? "" : "s"}.\n`);
  out(`The Odds API quota remaining: ${quotaRemaining ?? "?"}\n`);
  return 0;
}

function signed(value, digits = 4) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}`;
}

function parseBookmakers(value) {
  const parsed = String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return [...new Set(parsed)];
}

function parseWindowMs(value, fallbackMs) {
  const minutes = Number(value);
  return Number.isFinite(minutes) && minutes > 0
    ? minutes * 60 * 1000
    : fallbackMs;
}

function printPaperSummary(out, rows) {
  const summary = summarizePaperBets(rows);
  const roi = summary.roi === null ? "N/A" : `${signed(summary.roi * 100, 1)}%`;
  out(
    [
      `Paper bets: ${summary.total}`,
      `Pending: ${summary.pending}`,
      `Settled: ${summary.settled}`,
      `Wins: ${summary.wins}`,
      `Losses: ${summary.losses}`,
      `Pushes: ${summary.pushes}`,
      `Review: ${summary.review}`,
      `Settled stake: ${summary.settledStake.toFixed(2)} units`,
      `Net profit: ${signed(summary.profit)} units`,
      `ROI: ${roi}`,
      "Settlement limitation: soccer ROI uses The Odds API aggregate score; extra-time period semantics are not documented.",
    ].join("\n") + "\n",
  );
}

async function runSettle({
  loadTheOddsKey, createTheOddsClient, out, reportsDir, now,
}) {
  const ledgerPath = join(reportsDir, "paper-bets.csv");
  if (!await defaultFileExists(ledgerPath)) {
    out("No paper-bet ledger found. Run scan first.\n");
    return 0;
  }

  const rows = await readCsv(ledgerPath);
  if (rows.length === 0) {
    out("Paper-bet ledger is empty. Run scan first.\n");
    return 0;
  }
  if (!rows.some((row) => row.status === "PENDING")) {
    out("No pending paper bets to settle.\n");
    printPaperSummary(out, rows);
    return 0;
  }

  const client = createTheOddsClient({ apiKey: await loadTheOddsKey() });
  // Settle across every league with a pending bet: fetch each sport's scores.
  const pendingSportKeys = new Set(
    rows.filter((row) => row.status === "PENDING").map(paperSportKey),
  );
  const scoreEvents = [];
  let quotaRemaining;
  for (const sportKey of pendingSportKeys) {
    const response = await client.getScores({ sportKey, daysFrom: 3 });
    quotaRemaining = response.quota?.remaining ?? quotaRemaining;
    scoreEvents.push(...(response.data ?? []));
  }
  const settled = settlePaperBets(rows, scoreEvents);
  await writeCsv(ledgerPath, settled, PAPER_COLUMNS);
  printPaperSummary(out, settled);

  const stale = findStalePending(settled, now());
  if (stale.length > 0) {
    out(
      `Warning: ${stale.length} pending paper bet${stale.length === 1 ? "" : "s"} ` +
      "is older than 3 days and may be outside the free scores window.\n",
    );
  }
  out(`The Odds API quota remaining: ${quotaRemaining ?? "?"}\n`);
  return 0;
}

// Free settlement for soccer bets via football-data.org, so The Odds API credits
// stay reserved for CLV. Settles only football-data-covered leagues; the rest are
// left PENDING for the regular `settle` (The Odds API). Run this before `settle`.
async function runFdSettle({ loadFootballDataKey, createFootballDataClient: createFd, out, reportsDir }) {
  const ledgerPath = join(reportsDir, "paper-bets.csv");
  if (!await defaultFileExists(ledgerPath)) {
    out("No paper-bet ledger found. Run scan first.\n");
    return 0;
  }
  const rows = await readCsv(ledgerPath);
  const pending = rows.filter(
    (row) => row.status === "PENDING" && fdCompetitionFor(paperSportKey(row)),
  );
  if (pending.length === 0) {
    out("No pending football-data-covered (soccer) paper bets to settle.\n");
    return 0;
  }

  const client = createFd({ apiKey: await loadFootballDataKey() });
  const competitions = new Set(pending.map((row) => fdCompetitionFor(paperSportKey(row))));
  const fdMatches = [];
  for (const competition of competitions) {
    const { matches, requestsAvailableMinute } = await client.listFinishedMatches({ competition });
    fdMatches.push(...matches);
    if (Number.isFinite(requestsAvailableMinute)) {
      out(`football-data.org [${competition}] requests available this minute: ${requestsAvailableMinute}\n`);
    }
  }

  const settled = settlePaperBets(rows, synthesizeFdScoreEvents(pending, fdMatches));
  await writeCsv(ledgerPath, settled, PAPER_COLUMNS);
  printPaperSummary(out, settled);
  out("Settled soccer bets via football-data.org (free) — no The Odds API credits spent.\n");
  return 0;
}

function closingFairByKey(payload, receivedAt) {
  const pinnacle = normalizeTheOddsPayload(payload, receivedAt).filter(
    (row) => row.bookmaker === REFERENCE_BOOKMAKER,
  );
  const byEvent = new Map();
  for (const selection of pinnacle) {
    if (!byEvent.has(selection.eventId)) byEvent.set(selection.eventId, []);
    byEvent.get(selection.eventId).push(selection);
  }
  const fair = new Map();
  for (const [eventId, selections] of byEvent) {
    for (const [key, probability] of devigPower(selections)) {
      fair.set(`${eventId}|${key}`, probability);
    }
  }
  return fair;
}

const EVENT_LEVEL_CLV_MARKETS = new Set(["DRAW_NO_BET", "BTTS", "DOUBLE_CHANCE"]);

function eventLevelClvTargets(rows) {
  const targets = new Map();
  for (const row of rows) {
    if (!EVENT_LEVEL_CLV_MARKETS.has(row.market)) continue;
    const sportKey = paperSportKey(row);
    if (!sportKey.startsWith("soccer_")) continue;
    const eventId = String(row.referenceEventId ?? "").trim();
    if (!eventId) continue;
    const key = `${sportKey}|${eventId}`;
    if (!targets.has(key)) targets.set(key, { sportKey, eventId });
  }
  return [...targets.values()];
}

async function runClv({
  loadTheOddsKey,
  createTheOddsClient,
  out,
  reportsDir,
  now,
  captureWindowMs = CLV_CAPTURE_WINDOW_MS,
}) {
  const ledgerPath = join(reportsDir, "paper-bets.csv");
  if (!await defaultFileExists(ledgerPath)) {
    out("No paper-bet ledger found. Run scan first.\n");
    return 0;
  }
  const rows = await readCsv(ledgerPath);
  if (!rows.some((row) => row.status === "PENDING")) {
    out("No pending paper bets for CLV capture.\n");
    return 0;
  }

  const nowMs = now().getTime();
  const dueRows = rows.filter((row) =>
    row.status === "PENDING" &&
    !row.clvCapturedAt &&
    new Date(row.kickoffUtc).getTime() <= nowMs + captureWindowMs);
  if (dueRows.length === 0) {
    out("No paper bets are inside the CLV capture window.\n");
    return 0;
  }

  const client = createTheOddsClient({ apiKey: await loadTheOddsKey() });
  // Pending bets can now span many leagues, so query each pending sport's
  // closing line and merge them (event ids are unique across sports).
  const pendingSportKeys = new Set(
    dueRows.map(paperSportKey),
  );
  const closing = new Map();
  let quotaRemaining;
  for (const sportKey of pendingSportKeys) {
    const response = await client.getOdds({ sportKey, markets: PAPER_REFERENCE_MARKETS });
    quotaRemaining = response.quota?.remaining ?? quotaRemaining;
    for (const [key, probability] of closingFairByKey(response.data ?? [], response.receivedAt)) {
      closing.set(key, probability);
    }
  }
  for (const target of eventLevelClvTargets(dueRows)) {
    const response = await client.getEventOdds({
      sportKey: target.sportKey,
      eventId: target.eventId,
      markets: SOCCER_CORE_RESEARCH_MARKETS,
    });
    quotaRemaining = response.quota?.remaining ?? quotaRemaining;
    for (const [key, probability] of closingFairByKey(response.data ?? [], response.receivedAt)) {
      closing.set(key, probability);
    }
  }
  const updated = applyClosingLine(rows, closing, { capturedAt: now().toISOString() });
  await writeCsv(ledgerPath, updated, PAPER_COLUMNS);

  const summary = summarizeClv(updated);
  const beatRate = summary.beatRate === null ? "N/A" : `${(summary.beatRate * 100).toFixed(1)}%`;
  const averageClv = summary.averageClv === null ? "N/A" : `${signed(summary.averageClv * 100, 1)}%`;
  out(
    [
      `CLV captured: ${summary.captured}`,
      `Positive CLV (beat the close): ${summary.positive}`,
      `Beat rate: ${beatRate}`,
      `Average CLV: ${averageClv}`,
    ].join("\n") + "\n",
  );
  out(`The Odds API quota remaining: ${quotaRemaining ?? "?"}\n`);
  return 0;
}

const CLV_REPORT_COLUMNS = [
  "scope", "key", "captured", "positive", "beatRate", "averageClv",
];

const CLV_CALIBRATION_COLUMNS = [
  "scope", "key", "count", "uniqueSelectionCount", "positive", "positiveClvRate",
  "averageEv", "averageClv", "medianClv", "clvMinusEv", "sampleWarning",
];

const RESEARCH_STATUS_COLUMNS = [
  "scope", "key", "rows", "uniqueSelectionCount", "valueRows",
  "valueClvCaptured", "valuePending", "controlRows", "controlClvCaptured",
  "missingValueClvTo200", "missingValueClvTo300",
];

function clvReportRow(row) {
  return {
    scope: row.scope,
    key: row.key,
    captured: String(row.captured),
    positive: String(row.positive),
    beatRate: row.beatRate === null ? "" : row.beatRate.toFixed(4),
    averageClv: row.averageClv === null ? "" : row.averageClv.toFixed(4),
  };
}

async function runClvReport({ out, reportsDir, now }) {
  const ledgerPath = join(reportsDir, "paper-bets.csv");
  if (!await defaultFileExists(ledgerPath)) {
    out("No paper-bet ledger found. Run scan first.\n");
    return 0;
  }

  const rows = await readCsv(ledgerPath);
  const reportRows = summarizeClvTrend(rows);
  const csvRows = reportRows.map(clvReportRow);
  const generatedAt = now().toISOString();
  await writeCsv(join(reportsDir, "clv-report.csv"), csvRows, CLV_REPORT_COLUMNS);
  await writeFile(
    join(reportsDir, "clv-report.json"),
    `${JSON.stringify({ generatedAt, rows: csvRows }, null, 2)}\n`,
    "utf8",
  );

  const overall = reportRows.find((row) => row.scope === "overall" && row.key === "all") ?? {
    captured: 0, positive: 0, beatRate: null, averageClv: null,
  };
  const beatRate = overall.beatRate === null ? "N/A" : `${(overall.beatRate * 100).toFixed(1)}%`;
  const averageClv = overall.averageClv === null ? "N/A" : `${signed(overall.averageClv * 100, 1)}%`;
  out(
    [
      `CLV report: ${overall.captured} captured`,
      `Positive CLV (beat the close): ${overall.positive}`,
      `Beat rate: ${beatRate}`,
      `Average CLV: ${averageClv}`,
      `Wrote ${csvRows.length} summary rows to ${join(reportsDir, "clv-report.csv")}`,
    ].join("\n") + "\n",
  );
  return 0;
}

function decimalOrBlank(value) {
  return value === null || value === undefined ? "" : value.toFixed(4);
}

function clvCalibrationRow(row) {
  return {
    scope: row.scope,
    key: row.key,
    count: String(row.count),
    uniqueSelectionCount: String(row.uniqueSelectionCount),
    positive: String(row.positive),
    positiveClvRate: decimalOrBlank(row.positiveClvRate),
    averageEv: decimalOrBlank(row.averageEv),
    averageClv: decimalOrBlank(row.averageClv),
    medianClv: decimalOrBlank(row.medianClv),
    clvMinusEv: decimalOrBlank(row.clvMinusEv),
    sampleWarning: row.sampleWarning ?? "",
  };
}

async function runClvCalibrate({ out, reportsDir, now }) {
  const ledgerPath = join(reportsDir, "paper-bets.csv");
  if (!await defaultFileExists(ledgerPath)) {
    out("No paper-bet ledger found. Run scan first.\n");
    return 0;
  }

  const rows = await readCsv(ledgerPath);
  const report = summarizeClvCalibration(rows);
  const csvRows = report.rows.map(clvCalibrationRow);
  const generatedAt = now().toISOString();
  const json = {
    generatedAt,
    sampleSize: report.sampleSize,
    regression: report.regression,
    mainScore: report.mainScore ? clvCalibrationRow(report.mainScore) : null,
    rows: csvRows,
  };

  await writeCsv(join(reportsDir, "clv-calibration.csv"), csvRows, CLV_CALIBRATION_COLUMNS);
  await writeFile(
    join(reportsDir, "clv-calibration.json"),
    `${JSON.stringify(json, null, 2)}\n`,
    "utf8",
  );

  const overall = report.rows.find((row) => row.scope === "overall" && row.key === "all");
  const averageClv = overall?.averageClv === null || overall?.averageClv === undefined
    ? "N/A"
    : `${signed(overall.averageClv * 100, 2)}%`;
  const slope = report.regression.slope === null ? "N/A" : signed(report.regression.slope, 4);
  const rSquared = report.regression.rSquared === null ? "N/A" : report.regression.rSquared.toFixed(4);
  const mainClv = report.mainScore?.averageClv === null || report.mainScore?.averageClv === undefined
    ? "N/A"
    : `${signed(report.mainScore.averageClv * 100, 2)}%`;
  out(
    [
      `CLV calibration: ${report.sampleSize} captured rows`,
      `Average CLV: ${averageClv}`,
      `Main MATCH_RESULT CLV: ${mainClv}`,
      `Regression slope: ${slope}`,
      `Regression R^2: ${rSquared}`,
      `Wrote ${csvRows.length} diagnostics rows to ${join(reportsDir, "clv-calibration.csv")}`,
    ].join("\n") + "\n",
  );
  return 0;
}

function researchStatusRow(row) {
  return {
    scope: row.scope,
    key: row.key,
    rows: String(row.rows),
    uniqueSelectionCount: String(row.uniqueSelectionCount),
    valueRows: String(row.valueRows),
    valueClvCaptured: String(row.valueClvCaptured),
    valuePending: String(row.valuePending),
    controlRows: String(row.controlRows),
    controlClvCaptured: String(row.controlClvCaptured),
    missingValueClvTo200: String(row.missingValueClvTo200),
    missingValueClvTo300: String(row.missingValueClvTo300),
  };
}

async function runResearchStatus({ out, reportsDir, now }) {
  const ledgerPath = join(reportsDir, "paper-bets.csv");
  if (!await defaultFileExists(ledgerPath)) {
    out("No paper-bet ledger found. Run scan first.\n");
    return 0;
  }

  const rows = await readCsv(ledgerPath);
  const reportRows = summarizeResearchStatus(rows);
  const csvRows = reportRows.map(researchStatusRow);
  const generatedAt = now().toISOString();
  await writeCsv(join(reportsDir, "research-status.csv"), csvRows, RESEARCH_STATUS_COLUMNS);
  await writeFile(
    join(reportsDir, "research-status.json"),
    `${JSON.stringify({
      generatedAt,
      targets: { valueClvCaptured: { target200: 200, target300: 300 } },
      rows: csvRows,
    }, null, 2)}\n`,
    "utf8",
  );

  const overall = reportRows.find((row) => row.scope === "overall" && row.key === "all");
  const main = reportRows.find((row) => row.scope === "main" && row.key === "MATCH_RESULT");
  out(
    [
      `Research status: ${overall?.valueClvCaptured ?? 0} VALUE CLV captured`,
      `Main MATCH_RESULT VALUE CLV: ${main?.valueClvCaptured ?? 0}`,
      `VALUE pending without CLV: ${overall?.valuePending ?? 0}`,
      `CONTROL CLV captured: ${overall?.controlClvCaptured ?? 0}`,
      `Missing to 200: ${overall?.missingValueClvTo200 ?? 200}`,
      `Missing to 300: ${overall?.missingValueClvTo300 ?? 300}`,
      `Wrote ${csvRows.length} research status rows to ${join(reportsDir, "research-status.csv")}`,
    ].join("\n") + "\n",
  );
  return 0;
}

const VALUE_FLOW_COLUMNS = ["scope", "key", "value"];
const PROFIT_ENGINE_COLUMNS = ["scope", "key", "value"];

function increment(map, key) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function countBy(rows, keyFn) {
  const counts = new Map();
  for (const row of rows) {
    const key = String(keyFn(row) ?? "").trim();
    increment(counts, key || "(blank)");
  }
  return counts;
}

function addCountRows(rows, scope, counts) {
  const sorted = [...counts].sort((left, right) =>
    right[1] - left[1] || left[0].localeCompare(right[0]),
  );
  for (const [key, value] of sorted) rows.push({ scope, key, value: String(value) });
}

async function latestScanAllPath(reportsDir) {
  const files = await readdir(reportsDir).catch(() => []);
  const latest = files
    .filter((name) => /^scan-all-.+\.csv$/u.test(name))
    .sort()
    .at(-1);
  return latest ? join(reportsDir, latest) : "";
}

function maxEv(rows) {
  const values = rows.map((row) => Number(row.ev)).filter(Number.isFinite);
  return values.length === 0 ? "" : Math.max(...values).toFixed(4);
}

async function runValueFlowReport({ out, reportsDir, now }) {
  const paperRows = await readCsvIfPresent(join(reportsDir, "paper-bets.csv"));
  const auditRows = await readCsvIfPresent(join(reportsDir, "mispricing-audit.csv"));
  const scanPath = await latestScanAllPath(reportsDir);
  const latestScanRows = scanPath ? await readCsv(scanPath) : [];
  const paperSummary = summarizePaperBets(paperRows);
  const clvSummary = summarizeClv(paperRows);

  const reportRows = [
    { scope: "paper", key: "total", value: String(paperSummary.total) },
    { scope: "paper", key: "pending", value: String(paperSummary.pending) },
    { scope: "paper", key: "settled", value: String(paperSummary.settled) },
    { scope: "paper", key: "clvCaptured", value: String(clvSummary.captured) },
    { scope: "paper", key: "clvPositive", value: String(clvSummary.positive) },
    { scope: "paper", key: "averageClv", value: clvSummary.averageClv === null ? "" : clvSummary.averageClv.toFixed(4) },
    { scope: "audit", key: "total", value: String(auditRows.length) },
    { scope: "scan.latest", key: "rows", value: String(latestScanRows.length) },
    { scope: "scan.latest", key: "maxEv", value: maxEv(latestScanRows) },
  ];
  addCountRows(reportRows, "paper.bookmaker", countBy(paperRows, (row) => row.bookmaker));
  addCountRows(reportRows, "paper.market", countBy(paperRows, (row) => row.market));
  addCountRows(reportRows, "paper.sportKey", countBy(paperRows, paperSportKey));
  addCountRows(reportRows, "audit.status", countBy(auditRows, (row) => row.status));
  addCountRows(reportRows, "audit.reason", countBy(auditRows, (row) => row.reason));
  addCountRows(reportRows, "scan.latest.status", countBy(latestScanRows, (row) => row.status));
  addCountRows(reportRows, "scan.latest.bookmaker", countBy(latestScanRows, (row) => row.bookmaker));
  addCountRows(reportRows, "scan.latest.market", countBy(latestScanRows, (row) => row.market));

  const topRejection = [...countBy(
    auditRows.filter((row) => String(row.reason ?? "").trim()),
    (row) => row.reason,
  )].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0];

  const generatedAt = now().toISOString();
  await writeCsv(join(reportsDir, "value-flow-report.csv"), reportRows, VALUE_FLOW_COLUMNS);
  await writeFile(
    join(reportsDir, "value-flow-report.json"),
    `${JSON.stringify({
      generatedAt,
      paper: {
        total: paperSummary.total,
        pending: paperSummary.pending,
        settled: paperSummary.settled,
        clvCaptured: clvSummary.captured,
        clvPositive: clvSummary.positive,
        averageClv: clvSummary.averageClv,
      },
      audit: { total: auditRows.length },
      latestScan: { path: scanPath, rows: latestScanRows.length, maxEv: maxEv(latestScanRows) },
      rows: reportRows,
    }, null, 2)}\n`,
    "utf8",
  );

  out(`Value-flow report: paper=${paperRows.length}, audit=${auditRows.length}, latestScanRows=${latestScanRows.length}\n`);
  if (topRejection) out(`Top rejection: ${topRejection[0]} (${topRejection[1]})\n`);
  out("Wrote value-flow-report.csv and value-flow-report.json\n");
  return 0;
}

function percentOrNA(value) {
  return value === null || value === undefined ? "N/A" : `${signed(value * 100, 2)}%`;
}

async function runProfitEngine({ args, out, reportsDir, now }) {
  const paperRows = await readCsvIfPresent(join(reportsDir, "paper-bets.csv"));
  const liveFeedStatsRows = await readCsvIfPresent(join(reportsDir, "ws-live-feed-stats.csv"));
  const liveStatusRows = await readCsvIfPresent(join(reportsDir, "live-event-status.csv"));
  const liveTrainingRows = await readCsvIfPresent(join(reportsDir, "live-training-observations.csv"));
  const liveAuditRows = await readCsvIfPresent(join(reportsDir, "ws-live-shadow-audit.csv"));
  const lifetimeRows = await readCsvIfPresent(join(reportsDir, "ws-lifetime-log.csv"));
  const bankroll = optionValue(args, "bankroll", "");
  const maxStake = optionValue(args, "max-stake", "");
  const kellyFraction = numericArg(args, "kelly-fraction", 0.25);
  const stakeCapPct = numericArg(args, "stake-cap-pct", 2);
  const report = buildProfitEngineReport({
    generatedAt: now().toISOString(),
    paperRows,
    liveFeedStatsRows,
    liveStatusRows,
    liveTrainingRows,
    liveAuditRows,
    lifetimeRows,
    bankroll,
    maxStake,
    kellyFraction,
    stakeCapFraction: stakeCapPct / 100,
  });
  const rows = profitEngineRows(report);

  await writeCsv(join(reportsDir, "profit-engine-report.csv"), rows, PROFIT_ENGINE_COLUMNS);
  await writeFile(
    join(reportsDir, "profit-engine-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );

  out(
    [
      `Profit engine: ${report.capital.readiness}`,
      `VALUE CLV captured: ${report.paper.valueClvCaptured}`,
      `Main MATCH_RESULT VALUE CLV: ${report.paper.mainValueClvCaptured}`,
      `VALUE avg CLV: ${percentOrNA(report.signal.valueAverageClv)}`,
      `CONTROL avg CLV: ${percentOrNA(report.signal.controlAverageClv)}`,
      `Paper ROI: ${percentOrNA(report.paper.roi)} (${report.paper.settled} settled)`,
      `Live market messages: ${report.live.marketMessageRows}`,
      `Live training rows: ${report.live.trainingRows}`,
      `Warnings: ${report.warnings.join(", ") || "none"}`,
      "Wrote profit-engine-report.csv and profit-engine-report.json",
    ].join("\n") + "\n",
  );
  return 0;
}

async function runDataHealth({ out, reportsDir, now }) {
  const paperRows = await readCsvIfPresent(join(reportsDir, "paper-bets.csv"));
  const report = buildDataHealthReport({
    rows: paperRows,
    generatedAt: now().toISOString(),
    now: now(),
  });
  await writeCsv(join(reportsDir, "data-health.csv"), report.issues, DATA_HEALTH_COLUMNS);
  await writeFile(
    join(reportsDir, "data-health.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
  out(`Data health: ERROR=${report.summary.ERROR}, WARN=${report.summary.WARN}, INFO=${report.summary.INFO}\n`);
  return 0;
}

async function runProfitabilityReport({ out, reportsDir, now }) {
  const paperRows = await readCsvIfPresent(join(reportsDir, "paper-bets.csv"));
  const report = buildProfitabilityReport({
    rows: paperRows,
    generatedAt: now().toISOString(),
  });
  const csvRows = report.rows.map(profitabilityCsvRow);
  await writeCsv(join(reportsDir, "profitability-report.csv"), csvRows, PROFITABILITY_COLUMNS);
  await writeFile(
    join(reportsDir, "profitability-report.json"),
    `${JSON.stringify({
      ...report,
      rows: csvRows,
    }, null, 2)}\n`,
    "utf8",
  );
  out(`Profitability report: ${report.mode} (${report.gates.valueMatchResultSettled} VALUE h2h settled, ${report.gates.valueMatchResultClvCaptured} VALUE h2h CLV)\n`);
  return 0;
}

async function runCalibrationReport({ out, reportsDir, now }) {
  const paperRows = await readCsvIfPresent(join(reportsDir, "paper-bets.csv"));
  const report = buildCalibrationReport({
    rows: paperRows,
    generatedAt: now().toISOString(),
  });
  const csvRows = report.rows.map(calibrationCsvRow);
  await writeCsv(join(reportsDir, "calibration-report.csv"), csvRows, CALIBRATION_REPORT_COLUMNS);
  await writeFile(
    join(reportsDir, "calibration-report.json"),
    `${JSON.stringify({
      ...report,
      rows: csvRows,
    }, null, 2)}\n`,
    "utf8",
  );
  out(`Calibration report: ${report.decision.modelStatus} (${report.monotonicity.status})\n`);
  return 0;
}

async function runStakingSim({ args, out, reportsDir, now }) {
  const paperRows = await readCsvIfPresent(join(reportsDir, "paper-bets.csv"));
  const bankroll = numericArg(args, "bankroll", 1000);
  const maxStake = numericArg(args, "max-stake", 10);
  const policy = optionValue(args, "policy", "flat");
  const report = buildStakingSimReport({
    rows: paperRows,
    generatedAt: now().toISOString(),
    bankroll,
    policy,
    maxStake,
  });
  const csvRows = report.rows.map(stakingSimCsvRow);
  await writeCsv(join(reportsDir, "staking-sim.csv"), csvRows, STAKING_SIM_COLUMNS);
  await writeFile(
    join(reportsDir, "staking-sim.json"),
    `${JSON.stringify({
      ...report,
      rows: csvRows,
    }, null, 2)}\n`,
    "utf8",
  );
  out(`Staking sim: ${report.mode} (${report.policy}, final bankroll ${report.summary.finalBankroll.toFixed(2)})\n`);
  return 0;
}

async function runDailyDecisionReport({ out, reportsDir, now }) {
  const paperRows = await readCsvIfPresent(join(reportsDir, "paper-bets.csv"));
  const liveFeedStatsRows = await readCsvIfPresent(join(reportsDir, "ws-live-feed-stats.csv"));
  const liveTrainingRows = await readCsvIfPresent(join(reportsDir, "live-training-observations.csv"));
  const report = buildDailyDecisionReport({
    generatedAt: now().toISOString(),
    paperRows,
    liveFeedStatsRows,
    liveTrainingRows,
    now: now(),
  });
  await writeFile(
    join(reportsDir, "daily-decision-report.md"),
    report.markdown,
    "utf8",
  );
  await writeFile(
    join(reportsDir, "daily-decision-report.json"),
    `${JSON.stringify({ ...report, markdown: undefined }, null, 2)}\n`,
    "utf8",
  );
  out(`Daily decision report: ${report.mode} (${report.blockers.length} blockers)\n`);
  return 0;
}
// Capture closing-line value for sent mispricing alerts. Reuses the same Pinnacle
// de-vig + applyClosingLine/summarizeClv machinery as paper-bet CLV, but reads the
// mispricing alert ledger and queries each sport once, limited to tracked events.
async function runMispricingClv({ loadTheOddsKey, createTheOddsClient, out, reportsDir, now }) {
  const state = createMispricingState({ reportsDir });
  const rows = await state.readClvLedger();
  // Capture only once kickoff is near, so the line we grab approximates the
  // close. Rows still far from kickoff stay PENDING for a later scheduled run.
  const nowMs = now().getTime();
  const due = rows.filter((row) =>
    row.status === "PENDING" &&
    !row.clvCapturedAt &&
    new Date(row.kickoffUtc).getTime() <= nowMs + CLV_CAPTURE_WINDOW_MS);
  if (due.length === 0) {
    out("No pending mispricing alerts ready for CLV capture.\n");
    return 0;
  }

  const client = createTheOddsClient({ apiKey: await loadTheOddsKey() });
  const eventsBySport = new Map();
  for (const row of due) {
    if (!eventsBySport.has(row.sportKey)) eventsBySport.set(row.sportKey, new Set());
    eventsBySport.get(row.sportKey).add(row.referenceEventId);
  }

  const closing = new Map();
  let quotaRemaining;
  for (const [sportKey, eventIdSet] of eventsBySport) {
    const response = await client.getOdds({
      sportKey,
      eventIds: [...eventIdSet],
      markets: "h2h",
    });
    quotaRemaining = response.quota?.remaining ?? quotaRemaining;
    for (const [key, probability] of closingFairByKey(response.data ?? [], response.receivedAt)) {
      closing.set(key, probability);
    }
  }

  const updated = applyClosingLine(rows, closing, { capturedAt: now().toISOString() });
  await state.writeClvLedger(updated);

  const summary = summarizeClv(updated);
  const beatRate = summary.beatRate === null ? "N/A" : `${(summary.beatRate * 100).toFixed(1)}%`;
  const averageClv = summary.averageClv === null ? "N/A" : `${signed(summary.averageClv * 100, 1)}%`;
  out(
    [
      `Mispricing CLV captured: ${summary.captured}`,
      `Positive CLV (beat the close): ${summary.positive}`,
      `Beat rate: ${beatRate}`,
      `Average CLV: ${averageClv}`,
    ].join("\n") + "\n",
  );
  out(`The Odds API quota remaining: ${quotaRemaining ?? "?"}\n`);
  return 0;
}

function printMispricingSettlementSummary(out, rows) {
  const summary = summarizeMispricingSettlements(rows);
  const roi = summary.roi === null ? "N/A" : `${signed(summary.roi * 100, 1)}%`;
  out(
    [
      `Live alerts: ${summary.total}`,
      `Pending: ${summary.pending}`,
      `Settled: ${summary.settled}`,
      `Wins: ${summary.wins}`,
      `Losses: ${summary.losses}`,
      `Pushes: ${summary.pushes}`,
      `Review: ${summary.review}`,
      `Net profit: ${signed(summary.profit)} units`,
      `ROI: ${roi}`,
      "Settlement limitation: soccer ROI uses The Odds API aggregate score; extra-time period semantics are not documented.",
    ].join("\n") + "\n",
  );
}

async function runMispricingSettle({ loadTheOddsKey, createTheOddsClient, out, reportsDir }) {
  const state = createMispricingState({ reportsDir });
  const rows = await state.readClvLedger();
  if (rows.length === 0) {
    out("No live alert ledger found. Wait for Telegram alerts first.\n");
    return 0;
  }
  if (!rows.some((row) => row.status === "PENDING")) {
    out("No pending live alerts to settle.\n");
    printMispricingSettlementSummary(out, rows);
    return 0;
  }

  const client = createTheOddsClient({ apiKey: await loadTheOddsKey() });
  const pendingSportKeys = new Set(
    rows.filter((row) => row.status === "PENDING").map((row) => row.sportKey),
  );
  const scoreEvents = [];
  let quotaRemaining;
  for (const sportKey of pendingSportKeys) {
    const response = await client.getScores({ sportKey, daysFrom: 3 });
    quotaRemaining = response.quota?.remaining ?? quotaRemaining;
    scoreEvents.push(...(response.data ?? []));
  }

  const settled = settleMispricingAlerts(rows, scoreEvents);
  await state.writeClvLedger(settled);
  printMispricingSettlementSummary(out, settled);
  out(`The Odds API quota remaining: ${quotaRemaining ?? "?"}\n`);
  return 0;
}

function flag(rest, name) {
  const hit = rest.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=")[1] : undefined;
}

// Price a Stoiximan/Novibet "Ενισχυμένες Αποδόσεις" boost that the user is
// looking at, against real de-vigged sharp odds — the same dual confirmation
// (Pinnacle + 3-book consensus) the alert pipeline uses, instead of the assumed
// market margin of the offline `boost` calculator. The user supplies the boost
// (no scraping); we never gate or auto-bet, just report the true EV.
async function runBoostCheck(rest, { loadTheOddsKey, createTheOddsClient, out, err, now }) {
  const sportKey = flag(rest, "sport-key");
  const home = flag(rest, "home");
  const away = flag(rest, "away");
  const date = flag(rest, "date");
  const pick = flag(rest, "pick");
  const boosted = Number(flag(rest, "boost"));
  const baseFlag = flag(rest, "base");
  const base = baseFlag != null ? Number(baseFlag) : undefined;

  if (!sportKey || !home || !away || !date || !pick || !Number.isFinite(boosted) || boosted <= 1) {
    err("usage: boost-check --sport-key=K --home=H --away=A --date=ISO --pick=1|X|2 --boost=ODDS [--base=ODDS]\n");
    return 1;
  }
  const kickoff = new Date(date);
  if (!Number.isFinite(kickoff.getTime())) {
    err("boost-check: --date must be a valid ISO timestamp\n");
    return 1;
  }
  const outcome = String(pick).toUpperCase();
  if (!["1", "X", "2"].includes(outcome)) {
    err("boost-check: --pick must be 1, X, or 2\n");
    return 1;
  }

  // A boost is just a mispricing candidate the user supplies: feed it through the
  // same confirmation so offeredOdds = the boosted price yields its true EV.
  const candidate = {
    sportSlug: sportKey.startsWith("soccer") ? "football" : "other",
    leagueSlug: "",
    kickoffUtc: kickoff.toISOString(),
    participantOne: home,
    participantTwo: away,
    market: "MATCH_RESULT",
    line: "",
    outcome,
    offeredOdds: boosted,
  };

  const client = createTheOddsClient({ apiKey: await loadTheOddsKey() });
  const header = `Boost check: ${home} vs ${away} — pick ${outcome} @ ${boosted}${base ? ` (was ${base})` : ""}`;

  const events = await client.listEvents({ sportKey });
  const match = matchCandidateEvent(candidate, events.data ?? []);
  if (!match.event) {
    out(`${header}\n`);
    out(`The fixture could not be matched in the reference data (${match.reason}).\n`);
    return 0;
  }

  const odds = await client.getOdds({
    sportKey,
    eventIds: [String(match.event.id)],
    markets: "h2h",
  });
  const selections = normalizeTheOddsResponse(odds.data ?? [], odds.receivedAt);
  const result = confirmCandidate(candidate, match.event, selections, { now: now() });
  const quota = odds.quota?.remaining ?? "?";

  out(`${header}\n`);
  if (result.pinnacleEv === undefined) {
    out(`Could not verify against sharp odds (${result.reason}).\n`);
    out(`The Odds API quota remaining: ${quota}\n`);
    return 0;
  }

  out(`Pinnacle fair odds: ${result.pinnacleFairOdds.toFixed(2)} (EV ${signed(result.pinnacleEv * 100, 1)}%)\n`);
  out(`Consensus fair odds: ${result.consensusFairOdds.toFixed(2)} (EV ${signed(result.consensusEv * 100, 1)}%, ${result.consensusBooks} books)\n`);
  const positive = result.pinnacleEv > 0 && result.consensusEv > 0;
  out(`Verdict: ${positive ? "+EV — both sharp references agree" : "Not +EV"}\n`);
  out(`The Odds API quota remaining: ${quota}\n`);
  return 0;
}

// Resolve one combo leg to its de-vigged fair probabilities (Pinnacle + consensus)
// across market types (1X2, double chance, totals — see boost_legs.mjs). The leg
// pick token decides the market, so a Bet Builder boost can mix leg types.
async function priceBoostLeg(client, leg, now) {
  const spec = parseLegPick(leg.pick);
  if (!spec) return { ok: false, reason: "UNSUPPORTED_LEG_PICK", leg };
  const candidate = {
    kickoffUtc: new Date(leg.date).toISOString(),
    participantOne: leg.home,
    participantTwo: leg.away,
  };
  const events = await client.listEvents({ sportKey: leg.sportKey });
  const match = matchCandidateEvent(candidate, events.data ?? []);
  if (!match.event) return { ok: false, reason: match.reason, leg };
  // Totals legs need the totals market; everything else rides the h2h line.
  const markets = spec.market === "TOTALS" ? "totals" : "h2h";
  const odds = await client.getOdds({
    sportKey: leg.sportKey,
    eventIds: [String(match.event.id)],
    markets,
  });
  const selections = normalizeTheOddsResponse(odds.data ?? [], odds.receivedAt);
  const fair = legFairProbabilities(selections, match.event.id, spec, { now: now() });
  const quota = odds.quota?.remaining;
  if (!(fair.pinnacleFairProbability > 0)) {
    return { ok: false, reason: fair.reason, leg, quota };
  }
  return {
    ok: true,
    leg,
    spec,
    pinnacleFairProbability: fair.pinnacleFairProbability,
    consensusFairProbability: fair.consensusFairProbability,
    quota,
  };
}

function marketsForMixSpec(spec) {
  if (spec.market === "MATCH_RESULT") return "h2h";
  if (spec.market === "DOUBLE_CHANCE") return "h2h,double_chance";
  if (spec.market === "TOTALS") return "totals,alternate_totals";
  if (spec.market === "BTTS") return "btts";
  if (spec.market === "TEAM_TOTALS") return "team_totals,alternate_team_totals";
  if (spec.market === "CORNERS_TOTALS") return "alternate_totals_corners";
  if (spec.market === "CARDS_SPREAD") return "alternate_spreads_cards";
  if (spec.market === "PLAYER_GOALSCORER") return "player_goal_scorer_anytime";
  if (spec.market === "PLAYER_SHOTS") return "player_shots";
  if (spec.market === "PLAYER_SHOTS_ON_TARGET") return "player_shots_on_target";
  return "h2h";
}

async function priceBoostMixLeg(client, leg, now) {
  const spec = parseMixLeg(leg.pick);
  if (!spec) return { status: "UNVERIFIABLE", reason: "UNSUPPORTED_LEG", leg };
  const candidate = {
    kickoffUtc: new Date(leg.date).toISOString(),
    participantOne: leg.home,
    participantTwo: leg.away,
  };
  const events = await client.listEvents({ sportKey: leg.sportKey });
  const match = matchCandidateEvent(candidate, events.data ?? []);
  if (!match.event) return { status: "UNVERIFIABLE", reason: match.reason, leg, spec };
  const odds = await client.getEventOdds({
    sportKey: leg.sportKey,
    eventId: String(match.event.id),
    markets: marketsForMixSpec(spec),
  });
  const eventPayload = Array.isArray(odds.data) ? odds.data : [odds.data];
  const selections = normalizeTheOddsResponse(eventPayload, odds.receivedAt);
  return {
    ...priceMixLeg(selections, match.event.id, spec, { now: now() }),
    leg,
    quota: odds.quota?.remaining,
  };
}

function parseLegs(rest) {
  return rest
    .filter((arg) => arg.startsWith("--leg="))
    .map((arg) => {
      const [sportKey, home, away, date, pick] = arg.slice("--leg=".length).split(";");
      return { sportKey, home, away, date, pick: String(pick ?? "") };
    });
}

// Both boost commands price a parlay as the *product* of each leg's de-vigged
// fair probability, which assumes the legs are independent. That holds across
// different fixtures, but Bet Builder boosts routinely stack legs from the same
// match (e.g. Over 2.5 + BTTS), whose outcomes are correlated. We can't recover
// that correlation from one-sided sharp prices, so we surface it: the combined
// EV for any same-event group is an independence approximation, not a true price.
function sameEventLegWarning(legs) {
  const groups = new Map();
  legs.forEach((leg, index) => {
    const key = [leg.sportKey, leg.home, leg.away, leg.date]
      .map((part) => String(part ?? "").trim().toLowerCase())
      .join("|");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(index + 1);
  });
  const correlated = [...groups.values()].filter((indices) => indices.length > 1);
  if (correlated.length === 0) return "";
  const groupsText = correlated.map((indices) => `legs ${indices.join("+")}`).join(", ");
  return `Note: ${groupsText} are on the same event and are priced as independent; ` +
    "real correlation is not modeled, so the combined EV is approximate.\n";
}

// Price a multi-leg boosted parlay (e.g. a Stoiximan Bet Builder boost) against
// real sharp odds: fair combo probability is the product of each leg's de-vigged
// fair probability, so EV = boostedOdds * product - 1. v1: MATCH_RESULT legs only.
async function runBoostCombo(rest, { loadTheOddsKey, createTheOddsClient, out, err, now }) {
  const boosted = Number(flag(rest, "boost"));
  const legs = parseLegs(rest);
  if (!Number.isFinite(boosted) || boosted <= 1 || legs.length < 2) {
    err('usage: boost-combo --boost=ODDS --leg="sportKey;home;away;date;pick" --leg=... (>=2 legs, pick 1|X|2)\n');
    return 1;
  }
  for (const leg of legs) {
    if (!leg.sportKey || !leg.home || !leg.away || !leg.date || !parseLegPick(leg.pick) ||
      !Number.isFinite(new Date(leg.date).getTime())) {
      err('boost-combo: each --leg needs "sportKey;home;away;date;pick"; pick = 1|X|2, double chance 1X|12|X2, or totals O2.5|U2.5\n');
      return 1;
    }
  }

  const client = createTheOddsClient({ apiKey: await loadTheOddsKey() });
  out(`Boost combo: ${legs.length} legs @ ${boosted}\n`);
  const correlationNote = sameEventLegWarning(legs);
  if (correlationNote) out(correlationNote);

  const priced = [];
  let quota = "?";
  for (const leg of legs) {
    const result = await priceBoostLeg(client, leg, now);
    if (result.quota !== undefined) quota = result.quota;
    priced.push(result);
  }

  priced.forEach((p, index) => {
    const label = `Leg ${index + 1}: ${p.leg.home} vs ${p.leg.away} pick ${p.leg.pick}`;
    out(p.ok
      ? `  ${label} — fair ${(1 / p.pinnacleFairProbability).toFixed(2)}\n`
      : `  ${label} — could not price (${p.reason})\n`);
  });

  if (priced.some((p) => !p.ok)) {
    out("Combo cannot be verified: at least one leg is unpriced.\n");
    out(`The Odds API quota remaining: ${quota}\n`);
    return 0;
  }

  const comboPinnacle = priced.reduce((acc, p) => acc * p.pinnacleFairProbability, 1);
  const comboConsensus = priced.reduce((acc, p) => acc * p.consensusFairProbability, 1);
  const evPinnacle = boosted * comboPinnacle - 1;
  const evConsensus = boosted * comboConsensus - 1;
  out(`Pinnacle fair odds (combo): ${(1 / comboPinnacle).toFixed(2)} (EV ${signed(evPinnacle * 100, 1)}%)\n`);
  out(`Consensus fair odds (combo): ${(1 / comboConsensus).toFixed(2)} (EV ${signed(evConsensus * 100, 1)}%)\n`);
  const positive = evPinnacle > 0 && evConsensus > 0;
  out(`Verdict: ${positive ? "+EV — both sharp references agree" : "Not +EV"}\n`);
  out(`The Odds API quota remaining: ${quota}\n`);
  return 0;
}

async function runBoostMix(rest, { loadTheOddsKey, createTheOddsClient, out, err, now }) {
  const boosted = Number(flag(rest, "boost"));
  const legs = parseLegs(rest);
  if (!Number.isFinite(boosted) || boosted <= 1 || legs.length < 2) {
    err('usage: boost-mix --boost=ODDS --leg="sportKey;home;away;date;pick" --leg=... (>=2 legs)\n');
    return 1;
  }
  for (const leg of legs) {
    if (!leg.sportKey || !leg.home || !leg.away || !leg.date ||
      !Number.isFinite(new Date(leg.date).getTime())) {
      err('boost-mix: each --leg needs "sportKey;home;away;date;pick"\n');
      return 1;
    }
  }

  const client = createTheOddsClient({ apiKey: await loadTheOddsKey() });
  out(`Boost mix: ${legs.length} legs @ ${boosted}\n`);
  const correlationNote = sameEventLegWarning(legs);
  if (correlationNote) out(correlationNote);

  const priced = [];
  let quota = "?";
  for (const leg of legs) {
    const result = await priceBoostMixLeg(client, leg, now);
    if (result.quota !== undefined) quota = result.quota;
    priced.push(result);
  }

  priced.forEach((p, index) => {
    const label = `Leg ${index + 1}: ${p.leg.home} vs ${p.leg.away} pick ${p.leg.pick}`;
    if (p.status === "VERIFIED") {
      out(`  ${label} - VERIFIED, fair ${(1 / p.pinnacleFairProbability).toFixed(2)} Pinnacle / ${(1 / p.consensusFairProbability).toFixed(2)} consensus\n`);
    } else if (p.status === "ESTIMATE_ONLY") {
      out(`  ${label} - estimate only, fair about ${(1 / p.estimateProbability).toFixed(2)} (${p.reason})\n`);
    } else {
      out(`  ${label} - unverified (${p.reason})\n`);
    }
  });

  const analysis = analyzeBoostMix({ boostedOdds: boosted, legResults: priced });
  out(`Status: ${analysis.status}\n`);
  if (analysis.status === "FULLY_VERIFIED") {
    out(`Pinnacle fair odds: ${analysis.pinnacleFairOdds.toFixed(2)} (EV ${signed(analysis.pinnacleEv * 100, 1)}%)\n`);
    out(`Consensus fair odds: ${analysis.consensusFairOdds.toFixed(2)} (EV ${signed(analysis.consensusEv * 100, 1)}%)\n`);
  } else if (analysis.status === "MIXED_ESTIMATE") {
    out(`Estimated fair odds: ${analysis.estimatedFairOdds.toFixed(2)} (EV ${signed(analysis.estimatedEv * 100, 1)}%)\n`);
    out("Warning: estimate only legs are not strict verified value and must not be used for alerts.\n");
  } else {
    out("Combo cannot be priced: at least one leg is unsupported or has no usable reference.\n");
  }
  out(`The Odds API quota remaining: ${quota}\n`);
  return 0;
}

// `boost` is pure arithmetic — no network, no keys, no quota.
function runBoost(rest, { out, err }) {
  const baseOdds = Number(flag(rest, "base"));
  const boostedOdds = Number(flag(rest, "boost"));
  if (!Number.isFinite(baseOdds) || !Number.isFinite(boostedOdds)) {
    err("usage: boost --base=<odds> --boost=<odds> [--market=<type> [--legs=N] | --margin=<percent>]\n");
    return 1;
  }

  const marginFlag = flag(rest, "margin");
  const marketFlag = flag(rest, "market");
  const legs = Number(flag(rest, "legs") ?? 1);

  let overround;
  let assumption;
  if (marginFlag != null) {
    overround = Number(marginFlag) / 100;
    assumption = `assumed total margin ${Number(marginFlag).toFixed(1)}%`;
  } else if (marketFlag != null) {
    const perLeg = MARKET_MARGINS[marketFlag];
    if (perLeg === undefined) {
      err(`unknown market: ${marketFlag}\nknown markets: ${Object.keys(MARKET_MARGINS).join(", ")}\n`);
      return 1;
    }
    overround = comboOverround(perLeg, legs);
    assumption = `${marketFlag} ×${legs} leg(s) → overround ${(overround * 100).toFixed(1)}%`;
  }

  let analysis;
  try {
    analysis = analyzeBoost({ baseOdds, boostedOdds, overround });
  } catch (error) {
    err(`error: ${error.message}\n`);
    return 1;
  }

  const lines = [
    `Boost check: ${baseOdds} → ${boostedOdds}`,
    `Boost multiplier: ×${analysis.multiplier.toFixed(3)} (${signed(analysis.breakEvenMargin * 100, 1)}%)`,
    `Break-even: +EV as long as the base-market margin is under ${(analysis.breakEvenMargin * 100).toFixed(1)}%.`,
  ];

  if (analysis.ev === undefined) {
    lines.push("");
    lines.push("No market given — typical TOTAL margins to compare against:");
    for (const [name, margin] of Object.entries(MARKET_MARGINS)) {
      lines.push(`  ${name.padEnd(11)} ${(margin * 100).toFixed(0)}%`);
    }
    lines.push("Re-run with --market=<type> [--legs=N] or --margin=<percent> for a verdict.");
  } else {
    lines.push("");
    lines.push(`Market: ${assumption}`);
    lines.push(`Fair odds needed: ${analysis.fairBoostOdds.toFixed(2)} (you have ${boostedOdds})`);
    lines.push(`EV: ${signed(analysis.ev * 100, 1)}%  →  ${analysis.verdict}`);
  }

  out(lines.join("\n") + "\n");
  return 0;
}

export async function runCli(argv, deps = {}) {
  const {
    out = (text) => process.stdout.write(text),
    err = (text) => process.stderr.write(text),
    loadApiKey = defaultLoadApiKey,
    loadTheOddsKey = defaultLoadTheOddsKey,
    createClient = createOddsApiClient,
    createTheOddsClient = createTheOddsApiClient,
    reportsDir = DEFAULT_REPORTS_DIR,
    now = () => new Date(),
    loadMispricingConfig = defaultLoadMispricingConfig,
    createValueBetsClient: createValueBets = createValueBetsClient,
    createTelegramClient: createTelegram = createTelegramClient,
    createState = createMispricingState,
    loadRegistry = loadSportRegistry,
    runMispricing = runMispricingScan,
    sportMapPath = DEFAULT_SPORT_MAP,
    loadFootballDataKey = defaultLoadFootballDataKey,
    createFootballDataClient: createFdClient = createFootballDataClient,
  } = deps;

  const [command, ...rest] = argv;

  try {
    if (command === "events") {
      return await runEvents({ loadApiKey, createClient, out });
    }
    if (command === "capture") {
      const eventId = rest[0];
      if (!eventId) {
        err("usage: capture <eventId> (missing eventId)\n");
        return 1;
      }
      return await runCapture(eventId, { loadApiKey, createClient, out, reportsDir, now });
    }
    if (command === "live-preflight") {
      return await runLivePreflight({
        args: rest,
        loadApiKey,
        createClient,
        out,
        reportsDir,
        now,
      });
    }
    if (command === "live-updated-poll") {
      return await runLiveUpdatedPoll({
        args: rest,
        loadApiKey,
        createClient,
        out,
        reportsDir,
        now,
      });
    }
    if (command === "scan") {
      const edgeArg = rest.find((a) => a.startsWith("--edge="));
      const parsed = edgeArg ? Number(edgeArg.split("=")[1]) / 100 : 0.02;
      const threshold = Number.isFinite(parsed) ? parsed : 0.02;
      const sampleMinEvArg = rest.find((a) => a.startsWith("--sample-min-ev="));
      const parsedSampleMinEv = sampleMinEvArg ? Number(sampleMinEvArg.split("=")[1]) / 100 : null;
      const sampleMinEv = Number.isFinite(parsedSampleMinEv) ? parsedSampleMinEv : null;
      const sampleLimitArg = rest.find((a) => a.startsWith("--sample-limit="));
      const parsedSampleLimit = sampleLimitArg ? Number(sampleLimitArg.split("=")[1]) : 0;
      const sampleLimit = Number.isFinite(parsedSampleLimit) && parsedSampleLimit > 0
        ? Math.floor(parsedSampleLimit)
        : 0;
      const sampleRepeat = rest.includes("--sample-repeat");
      const bookmakerArg = rest.find((a) => a.startsWith("--bookmakers="));
      const targetBookmakers = bookmakerArg
        ? parseBookmakers(bookmakerArg.slice("--bookmakers=".length))
        : TARGET_BOOKMAKERS;
      if (targetBookmakers.length === 0) {
        err("usage: scan [--edge=N] [--bookmakers=A,B] (bookmaker list is empty)\n");
        return 1;
      }
      return await runScan({
        loadApiKey, loadTheOddsKey, createClient, createTheOddsClient, out, reportsDir, now, threshold,
        loadRegistry, registryPath: sportMapPath, targetBookmakers, sampleMinEv, sampleLimit, sampleRepeat,
      });
    }
    if (command === "theodds-sweep") {
      return await runTheOddsSweep({
        args: rest,
        loadTheOddsKey,
        createTheOddsClient,
        out,
        reportsDir,
        now,
      });
    }
    if (command === "market-availability") {
      return await runMarketAvailability({
        args: rest,
        loadTheOddsKey,
        createTheOddsClient,
        out,
        reportsDir,
        now,
      });
    }
    if (command === "settle") {
      return await runSettle({
        loadTheOddsKey, createTheOddsClient, out, reportsDir, now,
      });
    }
    if (command === "fd-settle") {
      return await runFdSettle({
        loadFootballDataKey, createFootballDataClient: createFdClient, out, reportsDir,
      });
    }
    if (command === "clv") {
      const windowArg = rest.find((a) => a.startsWith("--window-minutes="));
      return await runClv({
        loadTheOddsKey,
        createTheOddsClient,
        out,
        reportsDir,
        now,
        captureWindowMs: parseWindowMs(
          windowArg?.slice("--window-minutes=".length),
          CLV_CAPTURE_WINDOW_MS,
        ),
      });
    }
    if (command === "clv-report") {
      return await runClvReport({ out, reportsDir, now });
    }
    if (command === "clv-calibrate") {
      return await runClvCalibrate({ out, reportsDir, now });
    }
    if (command === "research-status") {
      return await runResearchStatus({ out, reportsDir, now });
    }
    if (command === "value-flow-report") {
      return await runValueFlowReport({ out, reportsDir, now });
    }
    if (command === "data-health") {
      return await runDataHealth({ out, reportsDir, now });
    }
    if (command === "profitability-report") {
      return await runProfitabilityReport({ out, reportsDir, now });
    }
    if (command === "calibration-report") {
      return await runCalibrationReport({ out, reportsDir, now });
    }
    if (command === "staking-sim") {
      return await runStakingSim({ args: rest, out, reportsDir, now });
    }
    if (command === "daily-decision-report") {
      return await runDailyDecisionReport({ out, reportsDir, now });
    }
    if (command === "profit-engine") {
      return await runProfitEngine({
        args: rest,
        out,
        reportsDir,
        now,
      });
    }
    if (command === "forensic-audit") {
      const { runForensicAudit } = await import("../scripts/forensic-audit.mjs");
      return await runForensicAudit({
        argv: [
          `--reports-dir=${reportsDir}`,
          ...rest,
        ],
        out,
        err,
        now,
      });
    }
    if (command === "mispricing-clv") {
      return await runMispricingClv({
        loadTheOddsKey, createTheOddsClient, out, reportsDir, now,
      });
    }
    if (command === "mispricing-settle") {
      return await runMispricingSettle({
        loadTheOddsKey, createTheOddsClient, out, reportsDir,
      });
    }
    if (command === "boost") {
      return runBoost(rest, { out, err });
    }
    if (command === "boost-check") {
      return await runBoostCheck(rest, {
        loadTheOddsKey, createTheOddsClient, out, err, now,
      });
    }
    if (command === "boost-combo") {
      return await runBoostCombo(rest, {
        loadTheOddsKey, createTheOddsClient, out, err, now,
      });
    }
    if (command === "boost-mix") {
      return await runBoostMix(rest, {
        loadTheOddsKey, createTheOddsClient, out, err, now,
      });
    }
    if (command === "evaluate") {
      const csvPath = rest[0];
      if (!csvPath) {
        err("usage: evaluate <capture.csv> (missing csv path)\n");
        return 1;
      }
      return await runEvaluate(csvPath, { out, reportsDir, now });
    }
    if (command === "telegram-test") {
      const config = await loadMispricingConfig();
      const telegram = createTelegram({
        token: config.telegramToken,
        chatId: config.telegramChatId,
      });
      const result = await telegram.sendText(
        `Telegram connection test — ${now().toISOString()}`,
      );
      out(`Telegram test sent (message ${result.messageId}).\n`);
      return 0;
    }
    if (command === "mispricing-scan") {
      const unsupported = rest.filter((arg) => arg !== "--dry-run");
      if (unsupported.length > 0) {
        err(`unsupported mispricing-scan option: ${unsupported[0]}\n`);
        return 1;
      }
      const config = await loadMispricingConfig();
      await runMispricing({
        valueBetsClient: createValueBets({ apiKey: config.oddsApiKey }),
        referenceClient: createTheOddsClient({ apiKey: config.theOddsApiKey }),
        telegramClient: createTelegram({
          token: config.telegramToken,
          chatId: config.telegramChatId,
        }),
        state: createState({ reportsDir }),
        registry: await loadRegistry(sportMapPath),
        reportsDir,
        now: now(),
        dryRun: rest.includes("--dry-run"),
        out,
      });
      return 0;
    }

    err(
      "usage: node src/cli.mjs <events | capture <eventId> | live-preflight [--sport=S --bookmakers=A,B --markets=M --max-events=N] | live-updated-poll [--sport=S --bookmakers=A,B --interval-seconds=N --duration-minutes=N] | scan [--edge=N] [--bookmakers=A,B] [--sample-min-ev=N --sample-limit=M] [--sample-repeat] | theodds-sweep [--sports=K] [--edge=N --sample-min-ev=N --sample-limit=M] | market-availability [--sports=K --markets=M --max-credits=N] | settle | fd-settle | clv [--window-minutes=N] | boost --base=N --boost=N [--market=T [--legs=N] | --margin=P] | boost-check --sport-key=K --home=H --away=A --date=ISO --pick=1|X|2 --boost=N [--base=N] | boost-combo --boost=N --leg=\"K;H;A;ISO;1|X|2\" --leg=... | boost-mix --boost=N --leg=\"K;H;A;ISO;PICK\" --leg=... | evaluate <capture.csv> | mispricing-scan [--dry-run] | mispricing-clv | mispricing-settle | clv-report | clv-calibrate | research-status | value-flow-report | data-health | profitability-report | calibration-report | staking-sim [--bankroll=N --policy=flat|flat_pct|kelly10|kelly25 --max-stake=N] | daily-decision-report | profit-engine [--bankroll=N --max-stake=N] | forensic-audit [--max-credits=N] | telegram-test>\n" +
        `unknown command: ${command ?? ""}\n`,
    );
    return 1;
  } catch (error) {
    err(`error: ${error.message}\n`);
    return 1;
  }
}

const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  runCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
