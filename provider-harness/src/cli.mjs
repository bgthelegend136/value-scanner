import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { createOddsApiClient } from "./client.mjs";
import { compareObservation, summarizeComparisons } from "./compare.mjs";
import { readCsv, writeCsv } from "./csv.mjs";
import { loadEnvFile, requireApiKey } from "./env.mjs";
import { normalizeOddsResponse } from "./normalize.mjs";

const execFileAsync = promisify(execFile);

const TARGET_BOOKMAKERS = ["Superbet", "Stoiximan"];

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

export async function runCli(argv, deps = {}) {
  const {
    out = (text) => process.stdout.write(text),
    err = (text) => process.stderr.write(text),
    loadApiKey = defaultLoadApiKey,
    createClient = createOddsApiClient,
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
