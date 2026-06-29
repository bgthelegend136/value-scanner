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
import { consensusFairProbabilities, devig, devigOoEpc, devigPower } from "../src/value.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPORTS_DIR = resolve(HERE, "..", "reports");
const OUTCOMES = ["1", "X", "2"];
const EPSILON = 1e-12;
const FD_COMPETITION_SPORT_KEYS = new Map([
  ["PD", "soccer_spain_la_liga"],
  ["BL1", "soccer_germany_bundesliga"],
  ["SA", "soccer_italy_serie_a"],
  ["PL", "soccer_epl"],
]);
const CSV_COLUMNS = [
  "rowType", "method", "split", "events", "outcomeRows",
  "brier", "logLoss", "baselineBrier", "baselineLogLoss",
  "rps", "classwiseEce", "expectedDraws", "actualDraws", "beta",
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

function splitOption(argv, name) {
  return String(option(argv, name, ""))
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
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

export function snapshotSpecsFromArg(value = "24h,6h,1h,10m") {
  return String(value)
    .split(",")
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map((label) => {
      const match = label.match(/^(\d+)([hm])$/u);
      if (!match) throw new Error(`Invalid snapshot label: ${label}`);
      const amount = Number(match[1]);
      const minutesBefore = match[2] === "h" ? amount * 60 : amount;
      return { label, minutesBefore };
    });
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
    ["oo_epc", devigOoEpc(pinnacle)],
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

function nameTokens(value) {
  return normalizeName(value).split(" ").filter((token) => token.length > 0);
}

// football-data.org and The Odds API spell clubs differently ("Deportivo Alavés"
// vs "Alavés", "Levante UD" vs "Levante", "FC Barcelona" vs "Barcelona"). Treat two
// names as the same club when the shorter token set is fully contained in the longer
// one AND they share a distinctive token (length >= 4). This accepts prefix/suffix
// variants while still keeping e.g. "Real Madrid" and "Real Sociedad" apart (neither
// token set is a subset of the other).
export function clubNameMatches(a, b) {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (ta.length === 0 || tb.length === 0) return false;
  const [small, big] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  const bigSet = new Set(big);
  if (!small.every((token) => bigSet.has(token))) return false;
  return small.some((token) => token.length >= 4);
}

export function findHistoricalEventForMatch(events, match) {
  const day = dateOnly(match.kickoffUtc);
  const candidates = (events ?? []).filter((event) =>
    dateOnly(event.commence_time) === day &&
    clubNameMatches(event.home_team, match.homeTeam) &&
    clubNameMatches(event.away_team, match.awayTeam),
  );
  // Fail closed on ambiguity: only pair when exactly one snapshot event fits.
  return candidates.length === 1 ? candidates[0] : null;
}

function historicalList(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

function historicalEventPayload(payload) {
  if (Array.isArray(payload?.data)) return payload.data[0] ?? null;
  if (payload?.data && typeof payload.data === "object") return payload.data;
  return payload && typeof payload === "object" ? payload : null;
}

export async function collectHistoricalCalibrationRows({
  matches,
  oddsClient,
  sportKey,
  regions = "eu",
  markets = "h2h",
  snapshots = snapshotSpecsFromArg(),
  maxCredits = 8000,
  reserveCredits = 0,
} = {}) {
  const rows = [];
  const eventIdCache = new Map();
  let creditsSpent = 0;
  let quotaRemaining = "?";
  let stoppedByCreditCap = false;
  let stoppedByReserve = false;

  outer:
  for (const match of matches ?? []) {
    for (const snapshot of snapshots) {
      if (creditsSpent + 10 > maxCredits) {
        stoppedByCreditCap = true;
        break outer;
      }
      const date = snapshotIsoForKickoff(match.kickoffUtc, snapshot.minutesBefore);
      const cacheKey = match.matchId ?? `${match.homeTeam}|${match.awayTeam}|${match.kickoffUtc}`;
      if (!eventIdCache.has(cacheKey)) {
        const eventsResponse = await oddsClient.getHistoricalEvents({ sportKey, date });
        const event = findHistoricalEventForMatch(historicalList(eventsResponse.data), match);
        eventIdCache.set(cacheKey, event?.id ? String(event.id) : "");
      }
      const eventId = eventIdCache.get(cacheKey);
      if (!eventId) continue;
      const oddsResponse = await oddsClient.getHistoricalEventOdds({
        sportKey,
        eventId,
        date,
        regions,
        markets,
      });
      const lastCost = Number(oddsResponse.quota?.lastCost ?? 10) || 10;
      creditsSpent += lastCost;
      quotaRemaining = oddsResponse.quota?.remaining ?? quotaRemaining;
      const eventPayload = historicalEventPayload(oddsResponse.data);
      if (!eventPayload) continue;
      rows.push(...predictionsForEvent(
        eventPayload,
        match,
        oddsResponse.data?.timestamp ?? oddsResponse.receivedAt ?? date,
        oddsResponse.data?.timestamp ?? date,
      ).map((row) => ({
        ...row,
        snapshotLabel: snapshot.label,
      })));
      if (Number.isFinite(Number(quotaRemaining)) && Number(quotaRemaining) <= reserveCredits) {
        stoppedByReserve = true;
        break outer;
      }
    }
  }

  return {
    rows,
    meta: {
      creditsSpent,
      quotaRemaining,
      stoppedByCreditCap,
      stoppedByReserve,
      snapshots: snapshots.map((snapshot) => snapshot.label),
    },
  };
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

const RPS_ORDER = ["1", "X", "2"];

// Ranked probability score for an ordered 1X2 forecast (Baboota & Kaur, 2018):
// rewards getting both the location and the spread of the distribution right.
function rankedProbabilityScore(row) {
  let cumulativePredicted = 0;
  let cumulativeObserved = 0;
  let sum = 0;
  for (let i = 0; i < RPS_ORDER.length - 1; i += 1) {
    cumulativePredicted += row.probabilities[RPS_ORDER[i]];
    cumulativeObserved += row.actualOutcome === RPS_ORDER[i] ? 1 : 0;
    sum += (cumulativePredicted - cumulativeObserved) ** 2;
  }
  return sum / (RPS_ORDER.length - 1);
}

// classwise-ECE (Kull et al., 2019; Walsh & Joshi, 2024): mean over the three
// one-vs-rest classes of each class's size-weighted |avg predicted − observed|.
function classwiseEce(rows, bins) {
  if (rows.length === 0) return null;
  let total = 0;
  for (const outcome of OUTCOMES) {
    const buckets = Array.from({ length: bins }, () => ({ count: 0, predicted: 0, observed: 0 }));
    for (const row of rows) {
      const probability = row.probabilities[outcome];
      const index = Math.min(bins - 1, Math.floor(probability * bins));
      buckets[index].count += 1;
      buckets[index].predicted += probability;
      buckets[index].observed += row.actualOutcome === outcome ? 1 : 0;
    }
    let ece = 0;
    for (const bucket of buckets) {
      if (bucket.count === 0) continue;
      ece += (bucket.count / rows.length) *
        Math.abs(bucket.predicted / bucket.count - bucket.observed / bucket.count);
    }
    total += ece;
  }
  return total / OUTCOMES.length;
}

// Draw-bias check (Goto et al., 2024, Fig. 1): expected vs actual number of draws.
// FL-bias-adjusting methods (power, shin, oo_epc, fl_glm) tend to under-count them.
function extraMetrics(rows, bins) {
  if (rows.length === 0) {
    return { rps: null, classwiseEce: null, expectedDraws: null, actualDraws: null };
  }
  const rps = rows.reduce((sum, row) => sum + rankedProbabilityScore(row), 0) / rows.length;
  const expectedDraws = rows.reduce((sum, row) => sum + row.probabilities.X, 0);
  const actualDraws = rows.reduce((sum, row) => sum + (row.actualOutcome === "X" ? 1 : 0), 0);
  return { rps, classwiseEce: classwiseEce(rows, bins), expectedDraws, actualDraws };
}

// FL-GLM applied to already-de-vigged multiplicative probabilities: powering the
// normalised probabilities by beta and renormalising is algebraically identical
// to powering the raw inverse odds (the multiplicative normaliser cancels).
function flGlmRow(row, beta) {
  const powered = OUTCOMES.map((outcome) => row.probabilities[outcome] ** beta);
  const sum = powered.reduce((total, value) => total + value, 0);
  const probabilities = Object.fromEntries(OUTCOMES.map((outcome, index) => [outcome, powered[index] / sum]));
  return { ...row, method: "fl_glm", probabilities };
}

// Fit the single FL-GLM power constant on the TRAIN split only (minimise train
// log-loss); validation outcomes are never used, avoiding leakage.
function fitFlGlmBeta(trainRows) {
  const loss = (beta) => trainRows.reduce((sum, row) => {
    const transformed = flGlmRow(row, beta);
    return sum - Math.log(Math.max(transformed.probabilities[row.actualOutcome], EPSILON));
  }, 0) / Math.max(1, trainRows.length);
  let best = 1;
  let bestLoss = Infinity;
  for (let beta = 0.5; beta <= 2.5001; beta += 0.01) {
    const value = loss(beta);
    if (value < bestLoss) {
      bestLoss = value;
      best = beta;
    }
  }
  return Math.round(best * 100) / 100;
}

export function scoreCalibrationRows(rows, { bins = 10 } = {}) {
  const methods = [];
  const splits = new Map();
  for (const [method, methodRows] of groupBy(rows, (row) => row.method)) {
    const sorted = [...methodRows].sort((a, b) => new Date(a.kickoffUtc) - new Date(b.kickoffUtc));
    const splitAt = Math.max(1, Math.floor(sorted.length / 2));
    const trainRows = sorted.slice(0, splitAt);
    const validateRows = sorted.slice(splitAt);
    splits.set(method, { trainRows, validateRows });
    const baseline = baselineFromTrain(trainRows);
    methods.push({
      method,
      train: metricSummary(trainRows),
      validate: {
        ...metricSummary(validateRows, baseline),
        ...extraMetrics(validateRows, bins),
        reliability: reliability(validateRows, bins),
      },
    });
  }

  // FL-GLM: fit beta on the multiplicative train split, then apply to both splits.
  const multiplicative = splits.get("multiplicative");
  if (multiplicative && multiplicative.trainRows.length > 0) {
    const beta = fitFlGlmBeta(multiplicative.trainRows);
    const trainFl = multiplicative.trainRows.map((row) => flGlmRow(row, beta));
    const validateFl = multiplicative.validateRows.map((row) => flGlmRow(row, beta));
    const baseline = baselineFromTrain(multiplicative.trainRows);
    methods.push({
      method: "fl_glm",
      beta,
      train: metricSummary(trainFl),
      validate: {
        ...metricSummary(validateFl, baseline),
        ...extraMetrics(validateFl, bins),
        reliability: reliability(validateFl, bins),
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
      beta: method.beta === undefined ? "" : csvValue(method.beta),
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
      rps: csvValue(method.validate.rps),
      classwiseEce: csvValue(method.validate.classwiseEce),
      expectedDraws: csvValue(method.validate.expectedDraws),
      actualDraws: csvValue(method.validate.actualDraws),
      beta: method.beta === undefined ? "" : csvValue(method.beta),
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
  const requestedLeagues = splitOption(argv, "leagues");
  const defaultSportKey = option(argv, "sport-key", "soccer_spain_la_liga");
  const defaultCompetition = option(argv, "competition", fdCompetitionFor(defaultSportKey));
  const targets = requestedLeagues.length
    ? requestedLeagues.map((competitionCode) => ({
      competition: competitionCode,
      sportKey: FD_COMPETITION_SPORT_KEYS.get(competitionCode) ?? defaultSportKey,
    }))
    : [{ sportKey: defaultSportKey, competition: defaultCompetition }];
  for (const target of targets) {
    if (!target.competition) throw new Error(`No football-data.org competition mapping for ${target.sportKey}`);
  }

  const from = option(argv, "from", "2025-08-01");
  const to = option(argv, "to", "2025-12-31");
  const markets = option(argv, "markets", "h2h,totals");
  const regions = option(argv, "regions", "eu");
  const snapshotMinutesBefore = numericOption(argv, "snapshot-minutes-before", 5);
  const bins = numericOption(argv, "bins", 10);
  const maxMatches = hasFlag(argv, "full") ? Number.POSITIVE_INFINITY : numericOption(argv, "max-matches", 5);
  const maxCredits = numericOption(argv, "max-credits", 8000);
  const reserveCredits = numericOption(argv, "reserve-credits", 2000);
  const reportsDir = resolve(option(argv, "reports-dir", DEFAULT_REPORTS_DIR));

  const envPath = await resolveEnvPath(process.cwd());
  const env = await loadEnvFile(envPath);
  const fdClient = createFootballDataClient({ apiKey: requireKey(env, "football_data_org_key") });
  const targetMatches = [];
  for (const target of targets) {
    const fd = await fdClient.listFinishedMatches({ competition: target.competition });
    const matches = filterFinishedMatches(fd.matches, { from, to });
    targetMatches.push({ ...target, matches, requestsAvailableMinute: fd.requestsAvailableMinute });
    console.log(`Outcome preflight: ${target.competition} ${from}..${to} returned ${matches.length} finished matches.`);
    console.log(`football-data.org requests available this minute: ${fd.requestsAvailableMinute ?? "?"}`);
  }
  const primary = targetMatches[0];
  const { sportKey, competition, matches } = primary;

  if (targetMatches.every((target) => target.matches.length === 0)) {
    console.log("No covered outcome window; pick a different league/season before spending historical credits.");
    return 1;
  }
  if (hasFlag(argv, "preflight-only")) return 0;

  const limited = matches.slice(0, maxMatches);
  if (!hasFlag(argv, "full")) {
    console.log(`Safety cap: pulling ${limited.length}/${matches.length} matches. Pass --full for the whole window after a tiny dry-run passes.`);
  }

  const oddsClient = createTheOddsApiClient({ apiKey: requireKey(env, "THE_ODDS_API_KEY") });
  if (hasFlag(argv, "multi-snapshot")) {
    const snapshots = snapshotSpecsFromArg(option(argv, "snapshots", "24h,6h,1h,10m"));
    const maxEventsPerLeague = numericOption(argv, "max-events-per-league", maxMatches);
    const allRows = [];
    const perLeague = [];
    if (markets !== "h2h") {
      throw new Error("--multi-snapshot is h2h-only for this calibration gate");
    }
    console.log(
      `Multi-snapshot historical calibration: leagues=${targetMatches.length}, ` +
      `snapshots=${snapshots.map((snapshot) => snapshot.label).join(",")}, maxCredits=${maxCredits}, reserveCredits=${reserveCredits}.`,
    );
    let creditsRemainingForRun = maxCredits;
    let stoppedByCreditCap = false;
    let quotaRemaining = "?";
    for (const target of targetMatches) {
      const limitedMulti = target.matches.slice(0, maxEventsPerLeague);
      const collected = await collectHistoricalCalibrationRows({
        matches: limitedMulti,
        oddsClient,
        sportKey: target.sportKey,
        regions,
        markets,
        snapshots,
        maxCredits: creditsRemainingForRun,
        reserveCredits,
      });
      creditsRemainingForRun -= collected.meta.creditsSpent;
      stoppedByCreditCap = stoppedByCreditCap || collected.meta.stoppedByCreditCap;
      const stoppedByReserve = collected.meta.stoppedByReserve;
      quotaRemaining = collected.meta.quotaRemaining ?? quotaRemaining;
      allRows.push(...collected.rows.map((row) => ({
        ...row,
        sportKey: target.sportKey,
        competition: target.competition,
      })));
      perLeague.push({
        sportKey: target.sportKey,
        competition: target.competition,
        matchesCoveredByOutcomes: target.matches.length,
        matchesPulled: limitedMulti.length,
        calibratedEvents: new Set(collected.rows.map((row) => row.eventId)).size,
        creditsSpent: collected.meta.creditsSpent,
        stoppedByCreditCap: collected.meta.stoppedByCreditCap,
        stoppedByReserve,
      });
      if (creditsRemainingForRun <= 0 || stoppedByCreditCap || stoppedByReserve) break;
    }
    const creditsSpent = maxCredits - Math.max(0, creditsRemainingForRun);
    const report = {
      ...scoreCalibrationRows(allRows, { bins }),
      meta: {
        sportKey: targetMatches.map((target) => target.sportKey).join(","),
        competition: targetMatches.map((target) => target.competition).join(","),
        from,
        to,
        markets,
        regions,
        matchesCoveredByOutcomes: targetMatches.reduce((sum, target) => sum + target.matches.length, 0),
        matchesPulled: perLeague.reduce((sum, target) => sum + target.matchesPulled, 0),
        calibratedEvents: new Set(allRows.map((row) => row.eventId)).size,
        quotaRemaining,
        creditsSpent,
        reserveCredits,
        stoppedByCreditCap,
        stoppedByReserve: perLeague.some((target) => target.stoppedByReserve),
        snapshotLabels: snapshots.map((snapshot) => snapshot.label),
        perLeague,
        eventIdFirst: true,
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
