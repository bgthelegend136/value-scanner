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
import { consensusFairProbabilities, findValueBets } from "./value.mjs";
import { formatAlert } from "./alert.mjs";

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

const defaultFileExists = (path) => access(path).then(() => true, () => false);

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
    if (command === "evaluate") {
      const csvPath = rest[0];
      if (!csvPath) {
        err("usage: evaluate <capture.csv> (missing csv path)\n");
        return 1;
      }
      return await runEvaluate(csvPath, { out, reportsDir, now });
    }

    err(
      "usage: node src/cli.mjs <events | capture <eventId> | evaluate <capture.csv>>\n" +
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
