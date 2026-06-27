// Read-only historical de-vig calibration harness.
//
// This is not a soft-book strategy backtest: The Odds API historical snapshots
// do not include Stoiximan/Novibet. It measures whether sharp/reference
// de-vigged probabilities are calibrated against finished outcomes.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveEnvPath } from "../src/cli.mjs";
import { writeCsv } from "../src/csv.mjs";
import { loadEnvFile, requireKey } from "../src/env.mjs";
import { createFootballDataClient } from "../src/football_data_client.mjs";
import { fdCompetitionFor } from "../src/football_data_settle.mjs";
import { createTheOddsApiClient } from "../src/theodds_client.mjs";
import { normalizeTheOddsResponse } from "../src/theodds_normalize.mjs";
import { consensusFairProbabilities, devig, devigPower } from "../src/value.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPORTS_DIR = resolve(HERE, "..", "reports");
const OUTCOMES = ["1", "X", "2"];
const EPSILON = 1e-12;
const CSV_COLUMNS = [
  "rowType", "method", "split", "events", "outcomeRows",
  "brier", "logLoss", "baselineBrier", "baselineLogLoss",
  "bin", "lower", "upper", "count", "avgPredicted", "observedRate",
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

function dateOnly(value) {
  return String(value ?? "").slice(0, 10);
}

function normalizeName(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();
}

function actualOutcomeFromScore(score) {
  const home = Number(score?.fullTime?.home);
  const away = Number(score?.fullTime?.away);
  if (!Number.isFinite(home) || !Number.isFinite(away)) return null;
  if (home > away) return "1";
  if (away > home) return "2";
  return "X";
}

export function filterFinishedMatches(matches, { from, to } = {}) {
  const fromKey = from ? dateOnly(from) : "";
  const toKey = to ? dateOnly(to) : "9999-99-99";
  return (matches ?? [])
    .filter((match) => match.status === "FINISHED")
    .map((match) => ({
      matchId: String(match.id ?? `${match.homeTeam?.name}-${match.awayTeam?.name}-${match.utcDate}`),
      kickoffUtc: new Date(match.utcDate).toISOString(),
      homeTeam: match.homeTeam?.name ?? "",
      awayTeam: match.awayTeam?.name ?? "",
      actualOutcome: actualOutcomeFromScore(match.score),
      score: match.score?.fullTime ?? {},
    }))
    .filter((match) =>
      match.actualOutcome &&
      match.homeTeam &&
      match.awayTeam &&
      dateOnly(match.kickoffUtc) >= fromKey &&
      dateOnly(match.kickoffUtc) <= toKey,
    )
    .sort((a, b) => new Date(a.kickoffUtc) - new Date(b.kickoffUtc));
}

export function snapshotIsoForKickoff(kickoffUtc, minutesBefore = 5) {
  return new Date(new Date(kickoffUtc).getTime() - minutesBefore * 60_000)
    .toISOString()
    .replace(".000Z", "Z");
}

function fairMapToProbabilities(fairMap) {
  const probabilities = {};
  for (const outcome of OUTCOMES) {
    const value = fairMap.get(`MATCH_RESULT||${outcome}`);
    if (!(value > 0)) return null;
    probabilities[outcome] = value;
  }
  const total = OUTCOMES.reduce((sum, outcome) => sum + probabilities[outcome], 0);
  if (!(total > 0)) return null;
  for (const outcome of OUTCOMES) probabilities[outcome] /= total;
  return probabilities;
}

function shinProbabilities(implied) {
  const overround = implied.reduce((sum, value) => sum + value, 0);
  if (!(overround > 1)) return null;
  const sumAt = (z) => implied.reduce((sum, p) => {
    const numerator = Math.sqrt((z * z) + (4 * (1 - z) * ((p * p) / overround))) - z;
    return sum + numerator / (2 * (1 - z));
  }, 0);
  let low = 0;
  let high = 0.999999;
  for (let i = 0; i < 80; i += 1) {
    const mid = (low + high) / 2;
    if (sumAt(mid) > 1) low = mid;
    else high = mid;
  }
  const z = (low + high) / 2;
  return implied.map((p) => {
    const numerator = Math.sqrt((z * z) + (4 * (1 - z) * ((p * p) / overround))) - z;
    return numerator / (2 * (1 - z));
  });
}

function devigShin(selections) {
  const groups = new Map();
  for (const selection of selections) {
    const key = `${selection.market}|${selection.line}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(selection);
  }
  const fair = new Map();
  for (const group of groups.values()) {
    const implied = group.map((selection) => 1 / selection.decimalOdds);
    const adjusted = shinProbabilities(implied);
    if (!adjusted) continue;
    group.forEach((selection, index) => {
      fair.set(`${selection.market}|${selection.line}|${selection.outcome}`, adjusted[index]);
    });
  }
  return fair;
}

function predictionsForEvent(eventPayload, match, receivedAt, snapshotAt) {
  const rows = normalizeTheOddsResponse([eventPayload], receivedAt);
  const pinnacle = rows.filter((row) => row.bookmaker === "pinnacle" && row.market === "MATCH_RESULT");
  const methods = [];

  const methodMaps = [
    ["multiplicative", devig(pinnacle)],
    ["shin", devigShin(pinnacle)],
    ["power", devigPower(pinnacle)],
  ];
  for (const [method, fairMap] of methodMaps) {
    const probabilities = fairMapToProbabilities(fairMap);
    if (probabilities) methods.push({
      method,
      eventId: String(eventPayload.id),
      kickoffUtc: match.kickoffUtc,
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      snapshotAt,
      probabilities,
      actualOutcome: match.actualOutcome,
    });
  }

  const consensus = fairMapToProbabilities(new Map(
    [...consensusFairProbabilities(rows)]
      .filter(([key]) => key.startsWith("MATCH_RESULT||"))
      .map(([key, value]) => [key, value.fairProbability]),
  ));
  if (consensus) methods.push({
    method: "consensus_power_median",
    eventId: String(eventPayload.id),
    kickoffUtc: match.kickoffUtc,
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
    snapshotAt,
    probabilities: consensus,
    actualOutcome: match.actualOutcome,
  });

  return methods;
}

function findHistoricalEventForMatch(events, match) {
  const home = normalizeName(match.homeTeam);
  const away = normalizeName(match.awayTeam);
  const day = dateOnly(match.kickoffUtc);
  return (events ?? []).find((event) =>
    normalizeName(event.home_team) === home &&
    normalizeName(event.away_team) === away &&
    dateOnly(event.commence_time) === day,
  ) ?? null;
}

function groupBy(items, keyFn) {
  const groups = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
}

function baselineFromTrain(rows) {
  const counts = new Map(OUTCOMES.map((outcome) => [outcome, 1]));
  for (const row of rows) counts.set(row.actualOutcome, counts.get(row.actualOutcome) + 1);
  const total = [...counts.values()].reduce((sum, value) => sum + value, 0);
  return Object.fromEntries(OUTCOMES.map((outcome) => [outcome, counts.get(outcome) / total]));
}

function metricSummary(rows, baseline = null) {
  if (rows.length === 0) return { events: 0, outcomeRows: 0, brier: null, logLoss: null };
  let brier = 0;
  let logLoss = 0;
  let baselineBrier = 0;
  let baselineLogLoss = 0;
  for (const row of rows) {
    for (const outcome of OUTCOMES) {
      const actual = row.actualOutcome === outcome ? 1 : 0;
      brier += (row.probabilities[outcome] - actual) ** 2;
      if (baseline) baselineBrier += (baseline[outcome] - actual) ** 2;
    }
    logLoss += -Math.log(Math.max(row.probabilities[row.actualOutcome], EPSILON));
    if (baseline) baselineLogLoss += -Math.log(Math.max(baseline[row.actualOutcome], EPSILON));
  }
  const result = {
    events: rows.length,
    outcomeRows: rows.length * OUTCOMES.length,
    brier: brier / rows.length,
    logLoss: logLoss / rows.length,
  };
  if (baseline) {
    result.baselineBrier = baselineBrier / rows.length;
    result.baselineLogLoss = baselineLogLoss / rows.length;
  }
  return result;
}

function reliability(rows, bins) {
  const bucketed = Array.from({ length: bins }, (_, index) => ({
    bin: index,
    lower: index / bins,
    upper: (index + 1) / bins,
    count: 0,
    predictedSum: 0,
    observedSum: 0,
  }));
  for (const row of rows) {
    for (const outcome of OUTCOMES) {
      const probability = row.probabilities[outcome];
      const index = Math.min(bins - 1, Math.floor(probability * bins));
      const bin = bucketed[index];
      bin.count += 1;
      bin.predictedSum += probability;
      bin.observedSum += row.actualOutcome === outcome ? 1 : 0;
    }
  }
  return bucketed.map((bin) => ({
    bin: bin.bin,
    lower: bin.lower,
    upper: bin.upper,
    count: bin.count,
    avgPredicted: bin.count ? bin.predictedSum / bin.count : null,
    observedRate: bin.count ? bin.observedSum / bin.count : null,
  }));
}

export function scoreCalibrationRows(rows, { bins = 10 } = {}) {
  const methods = [];
  for (const [method, methodRows] of groupBy(rows, (row) => row.method)) {
    const sorted = [...methodRows].sort((a, b) => new Date(a.kickoffUtc) - new Date(b.kickoffUtc));
    const splitAt = Math.max(1, Math.floor(sorted.length / 2));
    const trainRows = sorted.slice(0, splitAt);
    const validateRows = sorted.slice(splitAt);
    const baseline = baselineFromTrain(trainRows);
    methods.push({
      method,
      train: metricSummary(trainRows),
      validate: {
        ...metricSummary(validateRows, baseline),
        reliability: reliability(validateRows, bins),
      },
    });
  }
  methods.sort((a, b) => a.method.localeCompare(b.method));
  return {
    generatedAt: new Date().toISOString(),
    note: "Historical snapshots do not include Stoiximan/Novibet; this is fair-probability calibration, not a soft-book strategy backtest.",
    bins,
    methods,
  };
}

function csvValue(value) {
  if (value === null || value === undefined) return "";
  return Number.isFinite(value) ? String(Number(value.toFixed(8))) : String(value);
}

export function calibrationCsvRows(report) {
  const rows = [];
  for (const method of report.methods) {
    rows.push({
      rowType: "summary",
      method: method.method,
      split: "train",
      events: method.train.events,
      outcomeRows: method.train.outcomeRows,
      brier: csvValue(method.train.brier),
      logLoss: csvValue(method.train.logLoss),
      baselineBrier: "",
      baselineLogLoss: "",
    });
    rows.push({
      rowType: "summary",
      method: method.method,
      split: "validate",
      events: method.validate.events,
      outcomeRows: method.validate.outcomeRows,
      brier: csvValue(method.validate.brier),
      logLoss: csvValue(method.validate.logLoss),
      baselineBrier: csvValue(method.validate.baselineBrier),
      baselineLogLoss: csvValue(method.validate.baselineLogLoss),
    });
    for (const bin of method.validate.reliability) {
      rows.push({
        rowType: "reliability",
        method: method.method,
        split: "validate",
        bin: bin.bin,
        lower: csvValue(bin.lower),
        upper: csvValue(bin.upper),
        count: bin.count,
        avgPredicted: csvValue(bin.avgPredicted),
        observedRate: csvValue(bin.observedRate),
      });
    }
  }
  return rows;
}

async function writeReports(report, reportsDir, stamp) {
  await mkdir(reportsDir, { recursive: true });
  const jsonPath = join(reportsDir, `historical-calibration-${stamp}.json`);
  const csvPath = join(reportsDir, `historical-calibration-${stamp}.csv`);
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeCsv(csvPath, calibrationCsvRows(report), CSV_COLUMNS);
  return { jsonPath, csvPath };
}

async function runHistoricalCalibration(argv = process.argv.slice(2)) {
  // football-data.org free returned usable 2025/26 rows for La Liga (PD) in
  // the 2026-06-27 preflight, while PL/ELC returned zero rows.
  const sportKey = option(argv, "sport-key", "soccer_spain_la_liga");
  const competition = option(argv, "competition", fdCompetitionFor(sportKey));
  if (!competition) throw new Error(`No football-data.org competition mapping for ${sportKey}`);

  const from = option(argv, "from", "2025-08-01");
  const to = option(argv, "to", "2025-12-31");
  const markets = option(argv, "markets", "h2h,totals");
  const regions = option(argv, "regions", "eu");
  const snapshotMinutesBefore = numericOption(argv, "snapshot-minutes-before", 5);
  const bins = numericOption(argv, "bins", 10);
  const maxMatches = hasFlag(argv, "full") ? Number.POSITIVE_INFINITY : numericOption(argv, "max-matches", 5);
  const reportsDir = resolve(option(argv, "reports-dir", DEFAULT_REPORTS_DIR));

  const envPath = await resolveEnvPath(process.cwd());
  const env = await loadEnvFile(envPath);
  const fdClient = createFootballDataClient({ apiKey: requireKey(env, "football_data_org_key") });
  const fd = await fdClient.listFinishedMatches({ competition });
  const matches = filterFinishedMatches(fd.matches, { from, to });

  console.log(`Outcome preflight: ${competition} ${from}..${to} returned ${matches.length} finished matches.`);
  console.log(`football-data.org requests available this minute: ${fd.requestsAvailableMinute ?? "?"}`);
  if (matches.length === 0) {
    console.log("No covered outcome window; pick a different league/season before spending historical credits.");
    return 1;
  }
  if (hasFlag(argv, "preflight-only")) return 0;

  const limited = matches.slice(0, maxMatches);
  if (!hasFlag(argv, "full")) {
    console.log(`Safety cap: pulling ${limited.length}/${matches.length} matches. Pass --full for the whole window after a tiny dry-run passes.`);
  }

  const oddsClient = createTheOddsApiClient({ apiKey: requireKey(env, "THE_ODDS_API_KEY") });
  const calibrationRows = [];
  let quotaRemaining = "?";
  for (const match of limited) {
    const date = snapshotIsoForKickoff(match.kickoffUtc, snapshotMinutesBefore);
    const historical = await oddsClient.getHistoricalOdds({ sportKey, date, regions, markets });
    quotaRemaining = historical.quota?.remaining ?? quotaRemaining;
    const event = findHistoricalEventForMatch(historical.data?.data ?? [], match);
    if (!event) continue;
    calibrationRows.push(...predictionsForEvent(
      event,
      match,
      historical.data?.timestamp ?? historical.receivedAt,
      historical.data?.timestamp ?? date,
    ));
  }

  const report = {
    ...scoreCalibrationRows(calibrationRows, { bins }),
    meta: {
      sportKey,
      competition,
      from,
      to,
      markets,
      regions,
      matchesCoveredByOutcomes: matches.length,
      matchesPulled: limited.length,
      calibratedEvents: new Set(calibrationRows.map((row) => row.eventId)).size,
      quotaRemaining,
      notStrategyBacktest: true,
    },
  };
  const stamp = new Date().toISOString().replaceAll(":", "-");
  const { jsonPath, csvPath } = await writeReports(report, reportsDir, stamp);
  console.log(`Wrote historical calibration JSON: ${jsonPath}`);
  console.log(`Wrote historical calibration CSV: ${csvPath}`);
  console.log(`The Odds API quota remaining: ${quotaRemaining}`);
  return 0;
}

const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  runHistoricalCalibration().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    console.error(`historical-calibration error: ${error.message}`);
    process.exitCode = 1;
  });
}
