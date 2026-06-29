// Offline report commands: read the paper-bet ledger and write the profitability,
// calibration, outcome-calibration, staking-sim, and daily-decision reports.
// Extracted from cli.mjs (Phase 3 command split); behaviour is identical. All are
// offline (no network, no The Odds API credits).
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { writeCsv } from "../csv.mjs";
import { numericArg, optionValue, readCsvIfPresent } from "../cli_shared.mjs";
import { buildProfitabilityReport, profitabilityCsvRow, PROFITABILITY_COLUMNS } from "../profitability_report.mjs";
import { buildCalibrationReport, calibrationCsvRow, CALIBRATION_REPORT_COLUMNS } from "../calibration_report.mjs";
import { buildOutcomeCalibrationReport, outcomeCalibrationCsvRow, OUTCOME_CALIBRATION_COLUMNS } from "../outcome_calibration.mjs";
import { buildStakingSimReport, stakingSimCsvRow, STAKING_SIM_COLUMNS } from "../staking_sim.mjs";
import { buildDailyDecisionReport } from "../daily_decision_report.mjs";

export async function runProfitabilityReport({ out, reportsDir, now }) {
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

export async function runCalibrationReport({ out, reportsDir, now }) {
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

export async function runOutcomeCalibrationReport({ out, reportsDir, now }) {
  const paperRows = await readCsvIfPresent(join(reportsDir, "paper-bets.csv"));
  const report = buildOutcomeCalibrationReport({
    rows: paperRows,
    generatedAt: now().toISOString(),
  });
  const csvRows = report.rows.map(outcomeCalibrationCsvRow);
  await writeCsv(join(reportsDir, "outcome-calibration.csv"), csvRows, OUTCOME_CALIBRATION_COLUMNS);
  await writeFile(
    join(reportsDir, "outcome-calibration.json"),
    `${JSON.stringify({ ...report, rows: csvRows }, null, 2)}\n`,
    "utf8",
  );
  const pct = (value) => (value === null || value === undefined || value === "" ? "n/a" : `${(Number(value) * 100).toFixed(1)}%`);
  const num = (value) => (value === null || value === undefined || value === "" ? "n/a" : Number(value).toFixed(4));
  const v = report.valueMatchResult;
  out(
    `Outcome calibration: ${report.sampleCount} settled bets; ` +
    `VALUE h2h n=${v.n ?? 0} winRate=${pct(v.winRate)} avgProb=${pct(v.avgProb)} ` +
    `gap=${pct(v.calibrationGap)} ECE=${num(v.ece)}\n`,
  );
  return 0;
}

export async function runStakingSim({ args, out, reportsDir, now }) {
  const paperRows = await readCsvIfPresent(join(reportsDir, "paper-bets.csv"));
  const bankroll = numericArg(args, "bankroll", 1000);
  const maxStake = numericArg(args, "max-stake", 10);
  const dailyExposurePct = numericArg(args, "daily-exposure-pct", 5);
  const policy = optionValue(args, "policy", "flat");
  const report = buildStakingSimReport({
    rows: paperRows,
    generatedAt: now().toISOString(),
    bankroll,
    policy,
    maxStake,
    dailyExposurePct: dailyExposurePct / 100,
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

export async function runDailyDecisionReport({ out, reportsDir, now }) {
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
