// Go/no-go probe for a paid The Odds API HISTORICAL subscription.
//
// Why this exists: historical snapshots are paid-only, so you cannot test them
// before you pay. What you CAN do for ~free is (a) measure the *current* coverage
// of the same books/markets historical is built from, and (b) project the credit
// burn of a concrete historical pull from the documented pricing. Together those
// give a defensible buy / don't-buy call BEFORE spending a cent.
//
// It writes no betting state and (by default) spends zero credits.
//
// Usage (from provider-harness/):
//   node scripts/historical-probe.mjs                  # zero-credit: cost model + report coverage + checklist
//   node scripts/historical-probe.mjs --live           # + fresh coverage recon (costs a few live credits)
//   node scripts/historical-probe.mjs --live --leagues=soccer_brazil_campeonato,soccer_norway_eliteserien
//   node scripts/historical-probe.mjs --cm-leagues=3 --cm-matches=380 --cm-snapshots=3 --cm-batch=3
//
// IMPORTANT REALITY (2026-06): EPL / Bundesliga / Serie A are OFF-SEASON in June.
// A live recon of those keys returns nothing now — which is *itself* the reason
// historical is interesting (it's the only way to get domestic-league samples
// before August). For --live, point at a currently-active major league as a proxy
// for what historical EPL coverage will look like (Brazil Serie A is the default).

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveEnvPath } from "../src/cli.mjs";
import { loadEnvFile, requireKey } from "../src/env.mjs";
import { readCsv } from "../src/csv.mjs";
import { createTheOddsApiClient } from "../src/theodds_client.mjs";
import { normalizeTheOddsResponse } from "../src/theodds_normalize.mjs";
import { readdir } from "node:fs/promises";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPORTS_DIR = resolve(HERE, "..", "reports");

// ---- Documented pricing (verified the-odds-api.com, 2026-06) -----------------
// Historical FEATURED endpoint (/v4/historical/sports/{sport}/odds): 10 credits
// per region per market, PER SNAPSHOT CALL. One call returns every event for the
// sport at that timestamp, so cost is driven by the number of distinct snapshot
// TIMESTAMPS you query, not by the match count directly. Event-level (player
// props) historical is 10 per region per market *per event* — far pricier, hence
// probe-only. Snapshots exist at 5-min intervals (featured from 2020-06, player
// markets from 2023-05).
const HIST_CREDIT_PER_REGION_PER_MARKET = 10;
const PLANS = [
  { name: "20K", price: 30, credits: 20000 },
  { name: "100K", price: 59, credits: 100000 },
];
const SOFT_BOOKS = ["stoiximan", "novibet", "superbet"]; // expected ABSENT from The Odds API

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=")[1] : fallback;
}
function flag(name) {
  return process.argv.includes(`--${name}`);
}
function num(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// ---- Cost model (pure, zero credits) ----------------------------------------
function costScenario({ label, leagues, matchesPerLeague, snapshots, markets, regions, batch }) {
  const creditsPerCall = HIST_CREDIT_PER_REGION_PER_MARKET * markets * regions;
  // Distinct snapshot timestamps ≈ (matches / matches-sharing-a-slot) × snapshots.
  const callsPerLeague = Math.ceil((matchesPerLeague / Math.max(batch, 1)) * snapshots);
  const totalCalls = leagues * callsPerLeague;
  const credits = totalCalls * creditsPerCall;
  const plan = PLANS.find((p) => credits <= p.credits) ?? null;
  return { label, leagues, matchesPerLeague, snapshots, markets, regions, batch, creditsPerCall, totalCalls, credits, plan };
}

function printCostModel(custom) {
  const scenarios = [
    costScenario({ label: "Feasibility (1 league, ~1 month)", leagues: 1, matchesPerLeague: 40, snapshots: 3, markets: 2, regions: 1, batch: 3 }),
    costScenario({ label: "Lean calibration (1 league, ½ season)", leagues: 1, matchesPerLeague: 190, snapshots: 3, markets: 2, regions: 1, batch: 3 }),
    costScenario({ label: "Target (3 leagues, full season)", leagues: 3, matchesPerLeague: 380, snapshots: 3, markets: 2, regions: 1, batch: 3 }),
    custom,
  ].filter(Boolean);

  console.log("# HISTORICAL CREDIT-COST MODEL  (featured h2h/totals, 10 cr/region/market/snapshot)\n");
  console.log("  scenario                              leagues  matches  snaps  mkts  reg  calls   credits   plan");
  for (const s of scenarios) {
    const planText = s.plan ? `${s.plan.name} $${s.plan.price}` : ">100K (too big)";
    console.log(
      `  ${s.label.padEnd(36)}  ${String(s.leagues).padStart(5)}  ${String(s.matchesPerLeague).padStart(7)}  ` +
      `${String(s.snapshots).padStart(5)}  ${String(s.markets).padStart(4)}  ${String(s.regions).padStart(3)}  ` +
      `${String(s.totalCalls).padStart(5)}  ${String(s.credits).padStart(8)}   ${planText}`,
    );
  }
  console.log("\n  Note: cost is driven by distinct snapshot TIMESTAMPS, not match count. `batch` =");
  console.log("  avg matches sharing one kickoff slot (clustered weekends ⇒ batch 3-5 ⇒ cheaper).");
  console.log("  Player props are event-level (10/region/market PER EVENT) ⇒ keep probe-only.\n");
}

// ---- Coverage from existing reports (zero credits) --------------------------
async function latestOpportunityCsv() {
  const files = (await readdir(REPORTS_DIR))
    .filter((f) => f.startsWith("scan-") && !f.startsWith("scan-all-") && f.endsWith(".csv"))
    .sort();
  return files.length ? resolve(REPORTS_DIR, files.at(-1)) : null;
}

async function coverageFromReports() {
  const path = await latestOpportunityCsv();
  console.log("# CONSENSUS DEPTH FROM EXISTING REPORTS (zero credits)\n");
  if (!path) {
    console.log("  No scan-*.csv found. Run a normal `scan` first, or use --live.\n");
    return;
  }
  const rows = await readCsv(path);
  const books = rows.map((r) => Number(r.books)).filter((n) => Number.isFinite(n) && n > 0);
  if (!books.length) {
    console.log(`  ${path.split(/[\\/]/).at(-1)}: no consensus-book counts present.\n`);
    return;
  }
  books.sort((a, b) => a - b);
  const median = books[Math.floor(books.length / 2)];
  const min = books[0];
  const max = books.at(-1);
  console.log(`  ${path.split(/[\\/]/).at(-1)}: ${rows.length} opportunities`);
  console.log(`  consensus books per opportunity — min ${min}, median ${median}, max ${max}`);
  console.log("  (This is the de-vig consensus depth on matches you actually priced.)\n");
}

// ---- Live coverage recon (opt-in, costs a few credits) ----------------------
async function liveRecon(client, sportKeys) {
  console.log("# LIVE COVERAGE RECON (costs ~markets×regions credits per league)\n");
  for (const sportKey of sportKeys) {
    let events;
    try {
      events = await client.listEvents({ sportKey }); // free
    } catch (e) {
      console.log(`  ${sportKey}: listEvents failed (${e.message})\n`);
      continue;
    }
    const eventCount = (events.data ?? []).length;
    if (eventCount === 0) {
      console.log(`  ${sportKey}: 0 upcoming events (likely OFF-SEASON) — skip, costs nothing.\n`);
      continue;
    }
    let odds;
    try {
      odds = await client.getOdds({ sportKey, regions: "eu", markets: "h2h,totals" }); // costs credits
    } catch (e) {
      console.log(`  ${sportKey}: getOdds failed (${e.message})\n`);
      continue;
    }
    const rows = normalizeTheOddsResponse(odds.data ?? [], odds.receivedAt);
    const byEvent = new Map();
    for (const r of rows) {
      if (!byEvent.has(r.eventId)) byEvent.set(r.eventId, { books: new Set(), h2h: false, totals: false });
      const e = byEvent.get(r.eventId);
      e.books.add(r.bookmaker);
      if (r.market === "MATCH_RESULT") e.h2h = true;
      if (r.market === "TOTALS") e.totals = true;
    }
    const evs = [...byEvent.values()];
    const n = evs.length || 1;
    const withPinnacle = evs.filter((e) => e.books.has("pinnacle")).length;
    const withTotals = evs.filter((e) => e.totals).length;
    const bookCounts = evs.map((e) => e.books.size).sort((a, b) => a - b);
    const medianBooks = bookCounts[Math.floor(bookCounts.length / 2)] ?? 0;
    const softPresent = SOFT_BOOKS.filter((b) => rows.some((r) => r.bookmaker === b));

    console.log(`  ${sportKey}: ${evs.length} priced events`);
    console.log(`    Pinnacle present : ${withPinnacle}/${evs.length} (${((withPinnacle / n) * 100).toFixed(0)}%)`);
    console.log(`    median books/evt : ${medianBooks}`);
    console.log(`    totals coverage  : ${withTotals}/${evs.length} (${((withTotals / n) * 100).toFixed(0)}%)`);
    console.log(`    soft books found : ${softPresent.length ? softPresent.join(", ") : "NONE (expected — confirms no soft-book backtest)"}`);
    console.log(`    quota remaining  : ${odds.quota?.remaining ?? "?"}\n`);
  }
}

function printChecklist() {
  console.log("# DECISION CHECKLIST — buy 1 month only if ALL of these hold\n");
  console.log("  [ ] Pinnacle present on >80% of events for your target leagues (proxy recon ok)");
  console.log("  [ ] median consensus books >= 5 (devig needs independent estimates)");
  console.log("  [ ] totals coverage healthy (or accept h2h-only first)");
  console.log("  [ ] soft books CONFIRMED absent — accept you are NOT backtesting your edge");
  console.log("  [ ] target-scope credits fit the plan you intend to buy (see cost model)");
  console.log("  [ ] settlement join works: football-data.org covers the leagues (free) for outcomes\n");
  console.log("  Then the ONLY valid goal for the spend is: calibrate the de-vig / fair-value");
  console.log("  engine (Brier / log-loss / reliability, out-of-sample temporal split) so you can");
  console.log("  lower the 10% floor with evidence. The edge itself stays a FORWARD-paper question.\n");
}

async function main() {
  printChecklist();

  const custom = (flag("cm-custom") || process.argv.some((a) => a.startsWith("--cm-")))
    ? costScenario({
        label: "Custom (your knobs)",
        leagues: num(arg("cm-leagues"), 3),
        matchesPerLeague: num(arg("cm-matches"), 380),
        snapshots: num(arg("cm-snapshots"), 3),
        markets: num(arg("cm-markets"), 2),
        regions: num(arg("cm-regions"), 1),
        batch: num(arg("cm-batch"), 3),
      })
    : null;
  printCostModel(custom);

  await coverageFromReports();

  if (flag("live")) {
    const envPath = await resolveEnvPath(process.cwd());
    const env = await loadEnvFile(envPath);
    const client = createTheOddsApiClient({ apiKey: requireKey(env, "THE_ODDS_API_KEY") });
    const defaultProxies = ["soccer_brazil_campeonato", "soccer_norway_eliteserien"];
    const sportKeys = (arg("leagues", defaultProxies.join(","))).split(",").map((s) => s.trim()).filter(Boolean);
    await liveRecon(client, sportKeys);
  } else {
    console.log("# Add --live to run a fresh coverage recon (costs a few credits).\n");
  }
}

main().catch((error) => {
  console.error(`historical-probe error: ${error.message}`);
  process.exitCode = 1;
});
