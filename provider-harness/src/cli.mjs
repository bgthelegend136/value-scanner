import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
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
  settlePaperBets,
  summarizeClv,
  summarizePaperBets,
} from "./paper.mjs";
import { createValueBetsClient } from "./value_bets_client.mjs";
import { createTelegramClient } from "./telegram.mjs";
import { createMispricingState } from "./mispricing_state.mjs";
import { CLV_CAPTURE_WINDOW_MS } from "./mispricing_thresholds.mjs";
import { loadSportRegistry } from "./multisport_map.mjs";
import { runMispricingScan } from "./mispricing_scan.mjs";
import { matchCandidateEvent } from "./mispricing_match.mjs";
import { confirmCandidate } from "./mispricing_confirm.mjs";
import { parseLegPick, legFairProbabilities } from "./boost_legs.mjs";
import { analyzeBoostMix, parseMixLeg, priceMixLeg } from "./boost_mix.mjs";

const execFileAsync = promisify(execFile);

const TARGET_BOOKMAKERS = ["Superbet", "Stoiximan"];
const WORLD_CUP_SPORT_KEY = "soccer_fifa_world_cup";
const WORLD_CUP_LEAGUE_SLUG = "international-fifa-world-cup";
const REFERENCE_BOOKMAKER = "pinnacle";
const SCAN_COLUMNS = [
  "bookmaker", "eventId", "kickoffUtc", "homeTeam", "awayTeam",
  "market", "line", "outcome", "decimalOdds", "fairOdds", "fairProbability",
  "ev", "status",
];
const OPPORTUNITY_COLUMNS = ["ev", "tier", "match", "pick", "bookmaker", "odd", "fairOdd", "marketFair", "books", "kickoffUtc"];
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

async function runScan({
  loadApiKey, loadTheOddsKey, createClient, createTheOddsClient, out, reportsDir, now, threshold,
}) {
  const oddsClient = createClient({ apiKey: await loadApiKey() });
  const theOddsClient = createTheOddsClient({ apiKey: await loadTheOddsKey() });

  const referenceEventsRaw = await theOddsClient.listEvents({ sportKey: WORLD_CUP_SPORT_KEY });
  const referenceFixtures = toFixtureList(referenceEventsRaw.data ?? [], (e) => ({
    eventId: String(e.id), homeTeam: e.home_team, awayTeam: e.away_team, kickoffUtc: e.commence_time,
  }));

  const oddsEventsRaw = await oddsClient.listEvents({
    sport: "football",
    league: WORLD_CUP_LEAGUE_SLUG,
    status: "pending",
    limit: 100,
  });
  const oddsEvents = Array.isArray(oddsEventsRaw.data) ? oddsEventsRaw.data : oddsEventsRaw.data?.events ?? [];
  const bettableFixtures = toFixtureList(oddsEvents, (e) => ({
    eventId: String(e.id), homeTeam: e.home, awayTeam: e.away, kickoffUtc: e.date,
  }));

  const pairs = matchFixtures(referenceFixtures, bettableFixtures);

  const referenceOdds = await theOddsClient.getOdds({ sportKey: WORLD_CUP_SPORT_KEY });
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
      bookmakers: TARGET_BOOKMAKERS,
    });
    for (const event of Array.isArray(response.data) ? response.data : []) {
      const rows = normalizeOddsResponse(event, response.receivedAt).filter(
        (row) =>
          TARGET_BOOKMAKERS.includes(row.bookmaker) &&
          (row.market === "MATCH_RESULT" || row.market === "TOTALS"),
      );
      bettableByEvent.set(String(event.id), rows);
    }
  }

  const opportunities = [];
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
    }
  }

  opportunities.sort((a, b) => b.result.ev - a.result.ev);

  const header = `World Cup value scan — ${pairs.length} matched fixtures, ${opportunities.length} value bets (EV >= ${(threshold * 100).toFixed(1)}%).`;
  out(`${header}\n\n`);
  for (const { result, fixture } of opportunities) out(`${formatAlert(result, { fixture })}\n\n`);
  out(`The Odds API quota remaining: ${referenceOdds.quota?.remaining ?? "?"}\n`);

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
  });
  await writeCsv(ledgerPath, merged.rows, PAPER_COLUMNS);
  out(`Recorded ${merged.added} new paper bet${merged.added === 1 ? "" : "s"}.\n`);
  out(`Skipped ${merged.duplicates} duplicate paper bet${merged.duplicates === 1 ? "" : "s"}.\n`);
  return 0;
}

function signed(value, digits = 4) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}`;
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
  const response = await client.getScores({
    sportKey: WORLD_CUP_SPORT_KEY,
    daysFrom: 3,
  });
  const settled = settlePaperBets(rows, response.data ?? []);
  await writeCsv(ledgerPath, settled, PAPER_COLUMNS);
  printPaperSummary(out, settled);

  const stale = findStalePending(settled, now());
  if (stale.length > 0) {
    out(
      `Warning: ${stale.length} pending paper bet${stale.length === 1 ? "" : "s"} ` +
      "is older than 3 days and may be outside the free scores window.\n",
    );
  }
  out(`The Odds API quota remaining: ${response.quota?.remaining ?? "?"}\n`);
  return 0;
}

function closingFairByKey(payload, receivedAt) {
  const pinnacle = normalizeTheOddsResponse(payload, receivedAt).filter(
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

async function runClv({ loadTheOddsKey, createTheOddsClient, out, reportsDir, now }) {
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

  const client = createTheOddsClient({ apiKey: await loadTheOddsKey() });
  const response = await client.getOdds({ sportKey: WORLD_CUP_SPORT_KEY });
  const closing = closingFairByKey(response.data ?? [], response.receivedAt);
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
  out(`The Odds API quota remaining: ${response.quota?.remaining ?? "?"}\n`);
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

function flag(rest, name) {
  const hit = rest.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=")[1] : undefined;
}

// Price a Stoiximan/Superbet "Ενισχυμένες Αποδόσεις" boost that the user is
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
    if (command === "scan") {
      const edgeArg = rest.find((a) => a.startsWith("--edge="));
      const parsed = edgeArg ? Number(edgeArg.split("=")[1]) / 100 : 0.03;
      const threshold = Number.isFinite(parsed) ? parsed : 0.03;
      return await runScan({
        loadApiKey, loadTheOddsKey, createClient, createTheOddsClient, out, reportsDir, now, threshold,
      });
    }
    if (command === "settle") {
      return await runSettle({
        loadTheOddsKey, createTheOddsClient, out, reportsDir, now,
      });
    }
    if (command === "clv") {
      return await runClv({
        loadTheOddsKey, createTheOddsClient, out, reportsDir, now,
      });
    }
    if (command === "mispricing-clv") {
      return await runMispricingClv({
        loadTheOddsKey, createTheOddsClient, out, reportsDir, now,
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
      "usage: node src/cli.mjs <events | capture <eventId> | scan [--edge=N] | settle | clv | boost --base=N --boost=N [--market=T [--legs=N] | --margin=P] | boost-check --sport-key=K --home=H --away=A --date=ISO --pick=1|X|2 --boost=N [--base=N] | boost-combo --boost=N --leg=\"K;H;A;ISO;1|X|2\" --leg=... | boost-mix --boost=N --leg=\"K;H;A;ISO;PICK\" --leg=... | evaluate <capture.csv> | mispricing-scan [--dry-run] | mispricing-clv | telegram-test>\n" +
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
