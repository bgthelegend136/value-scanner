// Read-only forensic audit for the betting measurement pipeline.
//
// It inspects local reports, runtime task/process state, official API
// constraints, and optional capped The Odds API probes. It never sends alerts,
// places bets, or rewrites source ledgers.

import { access, readdir, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { resolveEnvPath } from "../src/cli.mjs";
import { readCsv, writeCsv } from "../src/csv.mjs";
import { loadEnvFile, requireKey } from "../src/env.mjs";
import { summarizeLiveEfficiency } from "../src/profit_engine.mjs";
import { createTheOddsApiClient } from "../src/theodds_client.mjs";

const execFileAsync = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPORTS_DIR = resolve(HERE, "..", "reports");
const MAX_ALLOWED_CREDITS = 1000;
const DEFAULT_PROBE_COST_ESTIMATE = 30;
const FINDING_COLUMNS = ["severity", "code", "title", "details", "evidence"];
const TERMINAL_STATUSES = new Set(["WON", "LOST", "PUSH"]);
const API_CONSTRAINTS = [
  {
    provider: "Odds-API.io",
    constraint: "Only one WebSocket connection is allowed per API key; a new connection closes the previous one.",
    source: "https://docs.odds-api.io/api-reference/websocket",
  },
  {
    provider: "Odds-API.io",
    constraint: "Scores and status channels are not replayable with seq; include odds channel when odds state is needed.",
    source: "https://docs.odds-api.io/api-reference/websocket",
  },
  {
    provider: "The Odds API",
    constraint: "Odds quota cost depends on selected markets and regions; /sports is zero quota.",
    source: "https://the-odds-api.com/liveapi/guides/v4/",
  },
  {
    provider: "The Odds API",
    constraint: "Historical odds snapshots are the closest snapshot equal to or earlier than the requested timestamp.",
    source: "https://the-odds-api.com/liveapi/guides/v4/",
  },
];

function option(argv, name, fallback = undefined) {
  const hit = argv.find((arg) => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

function numericOption(argv, name, fallback) {
  const parsed = Number(option(argv, name, fallback));
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function fileExists(path) {
  return access(path).then(() => true, () => false);
}

async function readCsvIfPresent(path) {
  return await fileExists(path) ? readCsv(path) : [];
}

async function readJsonIfPresent(path) {
  if (!await fileExists(path)) return null;
  return JSON.parse(await readFile(path, "utf8"));
}

function countBy(rows, keyFn) {
  const counts = {};
  for (const row of rows) {
    const key = String(keyFn(row) ?? "").trim() || "(blank)";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function sortedCountEntries(counts) {
  return Object.entries(counts)
    .map(([key, count]) => ({ key, count }))
    .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key));
}

function finiteNumber(value) {
  if (String(value ?? "").trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function paperKey(row) {
  return [
    row.referenceEventId,
    row.bookmaker,
    row.market,
    row.line ?? "",
    row.outcome,
  ].map((value) => String(value ?? "")).join("|");
}

function summarizeClv(rows) {
  const values = rows
    .map((row) => finiteNumber(row.clv))
    .filter((value) => value !== null);
  const positive = values.filter((value) => value > 0).length;
  return {
    captured: values.length,
    positive,
    beatRate: values.length ? positive / values.length : null,
    average: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null,
  };
}

function summarizePaper(rows) {
  const uniqueKeys = new Set(rows.map(paperKey));
  const uniqueEvents = new Set(rows.map((row) => String(row.referenceEventId ?? "")).filter(Boolean));
  const clv = summarizeClv(rows);
  const settled = rows.filter((row) => TERMINAL_STATUSES.has(row.status)).length;
  return {
    totalRows: rows.length,
    uniqueSelectionKeys: uniqueKeys.size,
    repeatedObservationRows: Math.max(0, rows.length - uniqueKeys.size),
    uniqueReferenceEvents: uniqueEvents.size,
    clvCaptured: clv.captured,
    clvPositive: clv.positive,
    clvBeatRate: clv.beatRate,
    averageClv: clv.average,
    settled,
    pending: rows.filter((row) => row.status === "PENDING").length,
    byTier: countBy(rows, (row) => row.tier),
    byMarket: countBy(rows, (row) => row.market),
    byBookmaker: countBy(rows, (row) => row.bookmaker),
    bySportKey: countBy(rows, (row) => row.sportKey || "soccer_fifa_world_cup"),
    byStatus: countBy(rows, (row) => row.status),
  };
}

function maxEv(rows) {
  const values = rows.map((row) => finiteNumber(row.ev)).filter((value) => value !== null);
  return values.length ? Math.max(...values) : null;
}

async function latestScanAllPath(reportsDir) {
  const files = await readdir(reportsDir).catch(() => []);
  const latest = files
    .filter((name) => /^scan-all-.+\.csv$/u.test(name))
    .sort()
    .at(-1);
  return latest ? join(reportsDir, latest) : "";
}

function summarizeAudit(rows) {
  return {
    totalRows: rows.length,
    byStatus: countBy(rows, (row) => row.status),
    byReason: countBy(rows, (row) => row.reason),
  };
}

function summarizeScan(rows, path) {
  return {
    path,
    rows: rows.length,
    maxEv: maxEv(rows),
    byStatus: countBy(rows, (row) => row.status),
    byMarket: countBy(rows, (row) => row.market),
    byBookmaker: countBy(rows, (row) => row.bookmaker),
  };
}

function summarizeLive({ statusRows, trainingRows, feedStatsRows, auditRows, lifetimeRows }) {
  const efficiency = summarizeLiveEfficiency({
    liveStatusRows: statusRows,
    liveTrainingRows: trainingRows,
    liveFeedStatsRows: feedStatsRows,
    liveAuditRows: auditRows,
    lifetimeRows,
  });
  return {
    ...efficiency,
    shadowAuditRows: auditRows.length,
    trainingByTier: countBy(trainingRows, (row) => row.sampleTier),
    trainingByMarket: countBy(trainingRows, (row) => row.market),
    statusByType: countBy(statusRows, (row) => row.eventStatus),
    feedStatsByType: countBy(feedStatsRows, (row) => row.messageType),
    feedStatsByBookmaker: countBy(feedStatsRows, (row) => row.bookmaker),
  };
}

async function defaultProcessProvider() {
  if (process.platform !== "win32") return [];
  const command = [
    "Get-CimInstance Win32_Process -Filter \"Name = 'node.exe'\"",
    "Where-Object { $_.CommandLine -like '*ws-lifetime-probe*' }",
    "Select-Object @{n='pid';e={$_.ProcessId}},@{n='commandLine';e={$_.CommandLine}}",
    "ConvertTo-Json -Compress",
  ].join(" | ");
  try {
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", command]);
    if (!stdout.trim()) return [];
    const parsed = JSON.parse(stdout);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

async function defaultTaskProvider() {
  if (process.platform !== "win32") return [];
  const command = [
    "$names='Bet-Live-Shadow','Bet-Paper-Scan','Bet-Paper-CLV','Bet-Paper-Settle','Bet-Mispricing-Scanner','Bet-Mispricing-CLV';",
    "$rows = foreach ($name in $names) {",
    "$task = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue;",
    "$info = Get-ScheduledTaskInfo -TaskName $name -ErrorAction SilentlyContinue;",
    "if ($task -and $info) { [pscustomobject]@{ taskName=$name; state=[string]$task.State; lastRunTime=[string]$info.LastRunTime; lastTaskResult=[string]$info.LastTaskResult; nextRunTime=[string]$info.NextRunTime } }",
    "};",
    "$rows | ConvertTo-Json -Compress",
  ].join(" ");
  try {
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", command]);
    if (!stdout.trim()) return [];
    const parsed = JSON.parse(stdout);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

async function defaultGitProvider() {
  async function run(args) {
    try {
      const { stdout } = await execFileAsync("git", args);
      return stdout.trim();
    } catch {
      return "";
    }
  }
  return {
    branch: await run(["branch", "--show-current"]),
    commit: await run(["rev-parse", "--short", "HEAD"]),
    dirty: Boolean(await run(["status", "--porcelain"])),
  };
}

function addFinding(findings, severity, code, title, details, evidence = {}) {
  findings.push({
    severity,
    code,
    title,
    details,
    evidence: JSON.stringify(evidence),
  });
}

function evaluateFindings(report) {
  const findings = [];
  if (report.paper.repeatedObservationRows > 0) {
    addFinding(
      findings,
      report.paper.totalRows / Math.max(1, report.paper.uniqueSelectionKeys) >= 2 ? "HIGH" : "MEDIUM",
      "ROW_VOLUME_NOT_INDEPENDENT",
      "Paper row count overstates independent evidence",
      "Repeated snapshots are useful observations, but analysis must cluster by selection/event and must not treat every row as an independent bet.",
      {
        totalRows: report.paper.totalRows,
        uniqueSelectionKeys: report.paper.uniqueSelectionKeys,
        repeatedObservationRows: report.paper.repeatedObservationRows,
      },
    );
  }
  if (report.paper.totalRows >= 50 && report.paper.clvCaptured < 50) {
    addFinding(
      findings,
      "HIGH",
      "LOW_CLV_CAPTURE_SAMPLE",
      "CLV sample is too small for model conclusions",
      "Forward CLV is the main near-term signal. Current capture count is below the minimum needed for slope/segment analysis.",
      { clvCaptured: report.paper.clvCaptured, totalRows: report.paper.totalRows },
    );
  }
  if (report.paper.settled < 100) {
    addFinding(
      findings,
      "HIGH",
      "INSUFFICIENT_SETTLED_SAMPLE",
      "Settled sample is too small for ROI conclusions",
      "Realized ROI has high variance; do not infer profitability from the current settled count.",
      { settled: report.paper.settled },
    );
  }
  if (report.live.statusRows > 0 && report.live.trainingRows === 0) {
    addFinding(
      findings,
      "HIGH",
      "LIVE_STATUS_WITHOUT_TRAINING",
      "Live WebSocket receives score/status but no EV training rows",
      "The live connection is alive, but no odds candidate has made it through mapping, reference matching, and EV-band sampling yet.",
      { statusRows: report.live.statusRows, trainingRows: report.live.trainingRows },
    );
  }
  if (report.live.feedStatsRows > 0 && report.live.marketMessageRows === 0) {
    addFinding(
      findings,
      "HIGH",
      "LIVE_FEED_NO_MARKET_MESSAGES",
      "Live WebSocket feed produced no odds market messages",
      "The live task can be connected and still produce no candidate observations. Investigate provider filters such as sport/status/markets before treating live as an acceleration source.",
      {
        feedStatsRows: report.live.feedStatsRows,
        marketMessageRows: report.live.marketMessageRows,
        feedStatsByType: report.live.feedStatsByType,
      },
    );
  }
  if (report.runtime.websocketProbeProcesses > 1) {
    addFinding(
      findings,
      "BLOCKER",
      "MULTIPLE_WEBSOCKET_PROBES",
      "More than one WebSocket probe appears to be running",
      "Odds-API.io allows one WebSocket connection per key; multiple probes can close each other and invalidate measurements.",
      { processes: report.runtime.websocketProcesses },
    );
  }
  const candidateBelowMin = Number(report.mispricing.byReason.CANDIDATE_EV_BELOW_MIN ?? 0);
  if (candidateBelowMin > 0 && candidateBelowMin / Math.max(1, report.mispricing.totalRows) > 0.8) {
    addFinding(
      findings,
      "MEDIUM",
      "FUNNEL_DOMINATED_BY_EV_FLOOR",
      "Candidate funnel is dominated by EV-below-floor rejections",
      "This supports the hypothesis that large soft-book mistakes are rare, but it also means threshold analysis must use controls and CLV slope, not raw alert count.",
      { candidateBelowMin, totalRows: report.mispricing.totalRows },
    );
  }
  return findings;
}

function clampBudget(value) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(Math.floor(value), MAX_ALLOWED_CREDITS);
}

function rankedSportKeys(paperRows) {
  return sortedCountEntries(countBy(
    paperRows.filter((row) => String(row.sportKey ?? "").trim()),
    (row) => row.sportKey,
  )).map((entry) => entry.key);
}

async function createDefaultReferenceClient() {
  const envPath = await resolveEnvPath(process.cwd());
  const env = await loadEnvFile(envPath);
  return createTheOddsApiClient({ apiKey: requireKey(env, "THE_ODDS_API_KEY") });
}

async function runPaidProbes({
  paperRows,
  maxCredits,
  referenceClient,
  probeCostEstimate = DEFAULT_PROBE_COST_ESTIMATE,
}) {
  const cappedMaxCredits = clampBudget(maxCredits);
  const result = {
    enabled: cappedMaxCredits > 0,
    maxCredits: cappedMaxCredits,
    probeCostEstimate,
    estimatedCreditsUsed: 0,
    actualCreditsUsed: 0,
    probes: [],
    skipped: [],
  };
  if (cappedMaxCredits <= 0) return result;

  let client = referenceClient;
  if (!client) {
    try {
      client = await createDefaultReferenceClient();
    } catch (error) {
      result.skipped.push({ reason: "REFERENCE_CLIENT_UNAVAILABLE", detail: error.message });
      return result;
    }
  }

  for (const sportKey of rankedSportKeys(paperRows)) {
    if (result.estimatedCreditsUsed + probeCostEstimate > cappedMaxCredits) {
      result.skipped.push({ sportKey, reason: "BUDGET_CAP" });
      continue;
    }
    try {
      const response = await client.getOdds({ sportKey, markets: "h2h,totals" });
      const actualCost = Number(response.quota?.lastCost);
      result.estimatedCreditsUsed += probeCostEstimate;
      if (Number.isFinite(actualCost)) result.actualCreditsUsed += actualCost;
      result.probes.push({
        sportKey,
        markets: "h2h,totals",
        estimatedCost: probeCostEstimate,
        actualCost: Number.isFinite(actualCost) ? actualCost : null,
        quotaRemaining: response.quota?.remaining ?? null,
        eventsReturned: Array.isArray(response.data) ? response.data.length : 0,
      });
    } catch (error) {
      result.estimatedCreditsUsed += probeCostEstimate;
      result.probes.push({
        sportKey,
        markets: "h2h,totals",
        estimatedCost: probeCostEstimate,
        actualCost: null,
        quotaRemaining: null,
        eventsReturned: 0,
        error: error.message,
      });
    }
  }
  return result;
}

function evaluatePaidProbeFindings(report) {
  if (report.paidProbes.skipped.some((item) => item.reason === "BUDGET_CAP")) {
    addFinding(
      report.findings,
      "MEDIUM",
      "PAID_PROBE_BUDGET_STOP",
      "Paid probe stopped before covering every sportKey",
      "The audit respected the requested credit budget cap. Unprobed sport keys require a later budgeted run if needed.",
      { maxCredits: report.paidProbes.maxCredits, skipped: report.paidProbes.skipped.length },
    );
  }
  if (report.paidProbes.probes.some((probe) => probe.error)) {
    addFinding(
      report.findings,
      "HIGH",
      "PAID_PROBE_PROVIDER_ERROR",
      "At least one paid reference probe failed",
      "Provider failures can explain missing CLV/training rows and need targeted follow-up before model conclusions.",
      { failures: report.paidProbes.probes.filter((probe) => probe.error).length },
    );
  }
}

function findingsMarkdown(findings) {
  if (findings.length === 0) return "No findings.\n";
  return findings
    .map((finding) => `- **${finding.severity} ${finding.code}:** ${finding.title}. ${finding.details}`)
    .join("\n") + "\n";
}

function countsMarkdown(title, counts) {
  const entries = sortedCountEntries(counts);
  if (entries.length === 0) return `### ${title}\nNo rows.\n`;
  return [
    `### ${title}`,
    "| Key | Count |",
    "| --- | ---: |",
    ...entries.slice(0, 12).map((entry) => `| ${entry.key} | ${entry.count} |`),
    "",
  ].join("\n");
}

function renderMarkdown(report) {
  return [
    "# Forensic Audit Report",
    "",
    `Generated at: ${report.generatedAt}`,
    `Git: ${report.git.branch || "?"} @ ${report.git.commit || "?"}${report.git.dirty ? " (dirty)" : ""}`,
    "",
    "## Executive Findings",
    findingsMarkdown(report.findings),
    "## Sample Integrity",
    `Paper rows: ${report.paper.totalRows}`,
    `Unique selection keys: ${report.paper.uniqueSelectionKeys}`,
    `Repeated observation rows: ${report.paper.repeatedObservationRows}`,
    `CLV captured: ${report.paper.clvCaptured}`,
    `Settled: ${report.paper.settled}`,
    "",
    countsMarkdown("Paper By Tier", report.paper.byTier),
    countsMarkdown("Paper By Market", report.paper.byMarket),
    countsMarkdown("Mispricing Rejection Reasons", report.mispricing.byReason),
    "## Live Pipeline",
    `Status rows: ${report.live.statusRows}`,
    `Training rows: ${report.live.trainingRows}`,
    `Feed stats rows: ${report.live.feedStatsRows}`,
    `Market message rows: ${report.live.marketMessageRows}`,
    `Training conversion rate: ${report.live.trainingConversionRate === null ? "N/A" : report.live.trainingConversionRate.toFixed(4)}`,
    `Shadow audit rows: ${report.live.shadowAuditRows}`,
    `Lifetime rows: ${report.live.lifetimeRows}`,
    `WebSocket probe processes: ${report.runtime.websocketProbeProcesses}`,
    "",
    "## Paid Probes",
    `Max credits: ${report.paidProbes.maxCredits}`,
    `Estimated credits used: ${report.paidProbes.estimatedCreditsUsed}`,
    `Actual credits used: ${report.paidProbes.actualCreditsUsed}`,
    `Probes run: ${report.paidProbes.probes.length}`,
    `Skipped: ${report.paidProbes.skipped.length}`,
    "",
    "## Official API Constraints",
    ...API_CONSTRAINTS.map((item) => `- ${item.provider}: ${item.constraint} (${item.source})`),
    "",
    "## Methodology Notes",
    "- Historical calibration tests fair-probability quality; it is not a Stoiximan/Novibet strategy backtest.",
    "- Forward CLV should be analyzed as CLV versus computed EV, clustered by event/selection.",
    "- Realized ROI is secondary until the settled sample is much larger.",
    "- Repeated paper snapshots are observations, not independent bets.",
    "",
  ].join("\n");
}

export async function buildAuditReport({
  reportsDir = DEFAULT_REPORTS_DIR,
  maxCredits = 0,
  now = () => new Date(),
  processProvider = defaultProcessProvider,
  taskProvider = defaultTaskProvider,
  gitProvider = defaultGitProvider,
  referenceClient = null,
  probeCostEstimate = DEFAULT_PROBE_COST_ESTIMATE,
} = {}) {
  const resolvedReportsDir = resolve(reportsDir);
  const paperRows = await readCsvIfPresent(join(resolvedReportsDir, "paper-bets.csv"));
  const mispricingRows = await readCsvIfPresent(join(resolvedReportsDir, "mispricing-audit.csv"));
  const liveStatusRows = await readCsvIfPresent(join(resolvedReportsDir, "live-event-status.csv"));
  const liveTrainingRows = await readCsvIfPresent(join(resolvedReportsDir, "live-training-observations.csv"));
  const liveFeedStatsRows = await readCsvIfPresent(join(resolvedReportsDir, "ws-live-feed-stats.csv"));
  const liveAuditRows = await readCsvIfPresent(join(resolvedReportsDir, "ws-live-shadow-audit.csv"));
  const lifetimeRows = await readCsvIfPresent(join(resolvedReportsDir, "ws-lifetime-log.csv"));
  const scanPath = await latestScanAllPath(resolvedReportsDir);
  const scanRows = scanPath ? await readCsvIfPresent(scanPath) : [];
  const valueFlow = await readJsonIfPresent(join(resolvedReportsDir, "value-flow-report.json"));
  const processes = await processProvider();
  const tasks = await taskProvider();
  const git = await gitProvider();
  const paidProbes = await runPaidProbes({
    paperRows,
    maxCredits,
    referenceClient,
    probeCostEstimate,
  });

  const report = {
    generatedAt: now().toISOString(),
    reportsDir: resolvedReportsDir,
    git,
    paper: summarizePaper(paperRows),
    mispricing: summarizeAudit(mispricingRows),
    latestScan: summarizeScan(scanRows, scanPath),
    live: summarizeLive({
      statusRows: liveStatusRows,
      trainingRows: liveTrainingRows,
      feedStatsRows: liveFeedStatsRows,
      auditRows: liveAuditRows,
      lifetimeRows,
    }),
    runtime: {
      tasks,
      websocketProbeProcesses: processes.length,
      websocketProcesses: processes,
    },
    paidProbes,
    apiConstraints: API_CONSTRAINTS,
    valueFlow,
    findings: [],
  };
  report.findings.push(...evaluateFindings(report));
  evaluatePaidProbeFindings(report);
  return report;
}

function findingRow(finding) {
  return {
    severity: finding.severity,
    code: finding.code,
    title: finding.title,
    details: finding.details,
    evidence: finding.evidence,
  };
}

export async function writeAuditReports(report, reportsDir = DEFAULT_REPORTS_DIR) {
  const resolvedReportsDir = resolve(reportsDir);
  const summaryPath = join(resolvedReportsDir, "forensic-audit-summary.json");
  const findingsPath = join(resolvedReportsDir, "forensic-audit-findings.csv");
  const markdownPath = join(resolvedReportsDir, "forensic-audit-report.md");
  await writeFile(summaryPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeCsv(findingsPath, report.findings.map(findingRow), FINDING_COLUMNS);
  await writeFile(markdownPath, renderMarkdown(report), "utf8");
  return { summaryPath, findingsPath, markdownPath };
}

export async function runForensicAudit({
  argv = process.argv.slice(2),
  out = process.stdout.write.bind(process.stdout),
  err = process.stderr.write.bind(process.stderr),
  now = () => new Date(),
  processProvider = defaultProcessProvider,
  taskProvider = defaultTaskProvider,
  gitProvider = defaultGitProvider,
  referenceClient = null,
} = {}) {
  const reportsDir = resolve(option(argv, "reports-dir", DEFAULT_REPORTS_DIR));
  const maxCredits = clampBudget(numericOption(argv, "max-credits", 0));
  try {
    const report = await buildAuditReport({
      reportsDir,
      maxCredits,
      now,
      processProvider,
      taskProvider,
      gitProvider,
      referenceClient,
    });
    const paths = await writeAuditReports(report, reportsDir);
    out(`Forensic audit: findings=${report.findings.length}, paperRows=${report.paper.totalRows}, uniqueSelections=${report.paper.uniqueSelectionKeys}\n`);
    out(`Paid probes: maxCredits=${report.paidProbes.maxCredits}, estimatedUsed=${report.paidProbes.estimatedCreditsUsed}, actualUsed=${report.paidProbes.actualCreditsUsed}\n`);
    out(`Wrote ${paths.summaryPath}\n`);
    out(`Wrote ${paths.findingsPath}\n`);
    out(`Wrote ${paths.markdownPath}\n`);
    return 0;
  } catch (error) {
    err(`forensic-audit error: ${error.message}\n`);
    return 1;
  }
}

const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  runForensicAudit().then((code) => {
    process.exitCode = code;
  });
}
