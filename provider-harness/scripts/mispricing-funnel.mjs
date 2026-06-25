// Read-only measurement instrument for the multi-sport mispricing idea.
// Runs the real Tasks 1-5 pipeline against live data and prints the funnel:
//   candidates -> mapped -> event-matched -> has Pinnacle+3 books -> confirmed >20%
// It sends nothing and writes no betting state. With --append-csv it appends one
// metrics row per run so the EV distribution can be tracked over days/weeks.
//
// Usage (from provider-harness/):
//   node scripts/mispricing-funnel.mjs [--max-sports=N] [--append-csv[=path]]
//
// Cost: listSports + listEvents are free; each verified sport costs 1 The Odds
// API credit (markets=h2h, regions=eu). Default cap is 2 sports => ~2 credits.
// Runs where nothing maps spend 0 credits.

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveEnvPath } from "../src/cli.mjs";
import { loadEnvFile, requireKey } from "../src/env.mjs";
import { readCsv, writeCsv } from "../src/csv.mjs";
import { createValueBetsClient } from "../src/value_bets_client.mjs";
import { createTheOddsApiClient } from "../src/theodds_client.mjs";
import { loadSportRegistry, resolveSportKey } from "../src/multisport_map.mjs";
import { normalizeValueBets } from "../src/mispricing_normalize.mjs";
import { matchCandidateEvent } from "../src/mispricing_match.mjs";
import { confirmCandidate } from "../src/mispricing_confirm.mjs";
import { MIN_CANDIDATE_EV, MIN_CONFIRMED_EV } from "../src/mispricing_thresholds.mjs";
import { normalizeTheOddsResponse } from "../src/theodds_normalize.mjs";

const CAND_PCT = (MIN_CANDIDATE_EV * 100).toFixed(0);
const CONF_PCT = (MIN_CONFIRMED_EV * 100).toFixed(0);

const HERE = fileURLToPath(new URL(".", import.meta.url));
const SPORT_MAP = resolve(HERE, "..", "config", "multisport-map.json");
const DEFAULT_LOG = resolve(HERE, "..", "reports", "mispricing-funnel-log.csv");
const BOOKMAKERS = ["Stoiximan", "Superbet"];

const LOG_COLUMNS = [
  "ranAt", "bookmaker", "raw", "ml", "evMaxPct",
  "evGte20", "ev10to20", "ev5to10", "ev0to5", "evNeg",
  "normalized", "mapped", "matched", "confirmable", "confirmed", "quotaRemaining",
];

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=")[1] : fallback;
}

function resolveAppendPath() {
  const hit = process.argv.find((a) => a === "--append-csv" || a.startsWith("--append-csv="));
  if (!hit) return null;
  return hit.includes("=") ? hit.split("=")[1] : DEFAULT_LOG;
}

function tally(items, keyOf) {
  const m = new Map();
  for (const x of items) {
    const k = keyOf(x);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

async function appendLog(path, row) {
  let existing = [];
  try {
    existing = await readCsv(path);
  } catch {
    existing = [];
  }
  await writeCsv(path, [...existing, row], LOG_COLUMNS);
}

async function main() {
  const maxSports = Number(arg("max-sports", "2"));
  const appendPath = resolveAppendPath();
  const envPath = await resolveEnvPath(process.cwd());
  const env = await loadEnvFile(envPath);

  const valueBets = createValueBetsClient({ apiKey: requireKey(env, "ODDS_API_IO_KEY") });
  const reference = createTheOddsApiClient({ apiKey: requireKey(env, "THE_ODDS_API_KEY") });
  const registry = await loadSportRegistry(SPORT_MAP);
  const now = new Date();

  const metrics = {
    ranAt: now.toISOString(), bookmaker: BOOKMAKERS.join("+"),
    raw: 0, ml: 0, evMaxPct: "",
    evGte20: 0, ev10to20: 0, ev5to10: 0, ev0to5: 0, evNeg: 0,
    normalized: 0, mapped: 0, matched: 0, confirmable: 0, confirmed: 0,
    quotaRemaining: "",
  };

  // Stage 1: candidates (both books)
  const rawList = [];
  const candidates = [];
  const rejected = [];
  const perBook = [];
  for (const bk of BOOKMAKERS) {
    const r = await valueBets.getValueBets({ bookmaker: bk });
    const list = Array.isArray(r.data) ? r.data : [];
    rawList.push(...list);
    const n = normalizeValueBets(list, { receivedAt: r.receivedAt, now });
    candidates.push(...n.candidates);
    rejected.push(...n.rejected);
    perBook.push(`${bk}: ${list.length} raw -> ${n.candidates.length} candidate(s)`);
  }
  metrics.raw = rawList.length;
  metrics.normalized = candidates.length;

  console.log(`\n# Mispricing funnel — ${now.toISOString()} (${BOOKMAKERS.join(", ")})\n`);
  console.log(`Per book: ${perBook.join("  |  ")}`);
  console.log(`Raw candidates from /value-bets: ${metrics.raw}`);

  // EV distribution of raw ML/Moneyline candidates — how close we get to +20%.
  const evFracs = rawList
    .filter((x) => ["ml", "moneyline"].includes(String(x?.market?.name ?? "").toLowerCase()))
    .map((x) => (Number(x.expectedValue) - 100) / 100)
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => b - a);
  metrics.ml = evFracs.length;
  if (evFracs.length) {
    const band = (lo, hi) => evFracs.filter((v) => v >= lo && (hi === undefined || v < hi)).length;
    metrics.evGte20 = band(0.2);
    metrics.ev10to20 = band(0.1, 0.2);
    metrics.ev5to10 = band(0.05, 0.1);
    metrics.ev0to5 = band(0, 0.05);
    metrics.evNeg = band(-Infinity, 0);
    metrics.evMaxPct = (evFracs[0] * 100).toFixed(1);
    console.log(`ML EV distribution (n=${evFracs.length}):`);
    console.log(`    >=20%: ${metrics.evGte20}   10-20%: ${metrics.ev10to20}   5-10%: ${metrics.ev5to10}   0-5%: ${metrics.ev0to5}   <0%: ${metrics.evNeg}`);
    console.log(`    top EVs: ${evFracs.slice(0, 5).map((v) => `${(v * 100).toFixed(1)}%`).join(", ")}`);
  }
  console.log(`Normalized MATCH_RESULT candidates (EV>=${CAND_PCT}%, fresh, pre-match): ${candidates.length}`);
  if (rejected.length) {
    console.log(`Rejected at normalize (${rejected.length}):`);
    for (const [reason, n] of tally(rejected, (r) => r.reason)) console.log(`    ${n}x  ${reason}`);
  }

  if (candidates.length > 0) {
    console.log(`\nCandidate sport|league (these are what the registry must map):`);
    for (const [k, n] of tally(candidates, (c) => `${c.sportSlug}|${c.leagueSlug}`)) {
      console.log(`    ${n}x  ${k}`);
    }

    // Stage 2: map to active The Odds API sport keys
    const sports = await reference.listSports();
    const active = new Set((sports.data ?? []).filter((s) => s.active).map((s) => s.key));
    const mapped = [];
    const unmapped = [];
    for (const c of candidates) {
      const r = resolveSportKey(c, registry, active);
      if (r.sportKey) mapped.push({ ...c, sportKey: r.sportKey });
      else unmapped.push({ ...c, reason: r.reason });
    }
    metrics.mapped = mapped.length;
    console.log(`\nMapped to an active reference sport: ${mapped.length} / ${candidates.length}`);
    for (const [reason, n] of tally(unmapped, (u) => u.reason)) console.log(`    ${n}x  ${reason}`);

    // Stage 3+: verify up to maxSports sport keys (1 credit each, markets=h2h)
    const bySport = new Map();
    for (const c of mapped) {
      if (!bySport.has(c.sportKey)) bySport.set(c.sportKey, []);
      bySport.get(c.sportKey).push(c);
    }
    const sportKeys = [...bySport.keys()].slice(0, maxSports);
    const deferred = [...bySport.keys()].slice(maxSports);
    if (deferred.length) console.log(`\nDeferred (sport cap ${maxSports}): ${deferred.join(", ")}`);

    for (const sportKey of sportKeys) {
      const group = bySport.get(sportKey);
      console.log(`\n--- ${sportKey} (${group.length} candidate(s)) ---`);
      const events = await reference.listEvents({ sportKey });
      const eventMatches = group.map((c) => ({ c, m: matchCandidateEvent(c, events.data ?? []) }));
      const eventIds = [...new Set(eventMatches.filter((x) => x.m.event).map((x) => String(x.m.event.id)))];
      const localMatched = eventMatches.filter((x) => x.m.event).length;
      metrics.matched += localMatched;
      console.log(`    events listed: ${(events.data ?? []).length}; matched to an event: ${localMatched}/${group.length}`);
      if (eventIds.length === 0) {
        for (const [reason, n] of tally(eventMatches.map((x) => x.m), (m) => m.reason || "MATCHED")) {
          if (reason !== "MATCHED") console.log(`      ${n}x  ${reason}`);
        }
        continue;
      }

      const odds = await reference.getOdds({ sportKey, eventIds, markets: "h2h" });
      metrics.quotaRemaining = odds.quota?.remaining ?? metrics.quotaRemaining;
      const selections = normalizeTheOddsResponse(odds.data ?? [], odds.receivedAt);

      for (const { c, m } of eventMatches) {
        if (!m.event) continue;
        const result = confirmCandidate(c, m.event, selections, { now });
        const evNote = result.pinnacleEv !== undefined
          ? `pinnEV=${(result.pinnacleEv * 100).toFixed(1)}% consEV=${(result.consensusEv * 100).toFixed(1)}% books=${result.consensusBooks}`
          : "";
        console.log(`      ${c.participantOne} v ${c.participantTwo} [${c.outcome} @ ${c.offeredOdds}] -> ${result.status}/${result.reason || "OK"} ${evNote}`);
        if (result.pinnacleEv !== undefined) metrics.confirmable += 1;
        if (result.status === "CONFIRMED") metrics.confirmed += 1;
      }
    }
  }

  console.log(`\n# FUNNEL`);
  console.log(`  raw                 : ${metrics.raw}`);
  console.log(`  normalized (>=${CAND_PCT}%)   : ${metrics.normalized}`);
  console.log(`  mapped              : ${metrics.mapped}`);
  console.log(`  event-matched       : ${metrics.matched}`);
  console.log(`  had Pinnacle+3books : ${metrics.confirmable}`);
  console.log(`  CONFIRMED >${CONF_PCT}%       : ${metrics.confirmed}`);
  console.log(`The Odds API credits remaining: ${metrics.quotaRemaining || "? (none spent)"}`);

  if (appendPath) {
    await appendLog(appendPath, metrics);
    console.log(`\nAppended metrics row to ${appendPath}`);
  }
  console.log("");
}

main().catch((error) => {
  console.error(`funnel error: ${error.message}`);
  process.exitCode = 1;
});
