import assert from "node:assert/strict";
import test from "node:test";

import { buildOutcomeCalibrationReport } from "../src/outcome_calibration.mjs";

const bet = (over = {}) => ({
  market: "MATCH_RESULT",
  tier: "VALUE",
  sportKey: "soccer_epl",
  decimalOdds: "2.0000",
  fairProbability: "0.5",
  status: "WON",
  ...over,
});

const near = (actual, expected, tol = 1e-6) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${actual} !~= ${expected}`);

test("known binary Brier and log-loss for a single bet", () => {
  const report = buildOutcomeCalibrationReport({ rows: [bet({ fairProbability: "0.5", status: "WON" })] });
  const overall = report.rows.find((r) => r.scope === "overall");
  assert.equal(overall.n, 1);
  near(overall.brier, 0.25);
  near(overall.logLoss, Math.log(2));
  near(overall.winRate, 1);
  near(overall.avgProb, 0.5);
});

test("a calibrated single bin has ~zero ECE and gap", () => {
  const rows = [
    bet({ fairProbability: "0.5", status: "WON" }),
    bet({ fairProbability: "0.5", status: "WON" }),
    bet({ fairProbability: "0.5", status: "LOST" }),
    bet({ fairProbability: "0.5", status: "LOST" }),
  ];
  const overall = buildOutcomeCalibrationReport({ rows }).rows.find((r) => r.scope === "overall");
  near(overall.winRate, 0.5);
  near(overall.avgProb, 0.5);
  near(overall.calibrationGap, 0);
  near(overall.ece, 0);
});

test("a miscalibrated bin surfaces a large ECE and negative gap", () => {
  const rows = [
    bet({ fairProbability: "0.8", status: "LOST" }),
    bet({ fairProbability: "0.8", status: "LOST" }),
  ];
  const overall = buildOutcomeCalibrationReport({ rows }).rows.find((r) => r.scope === "overall");
  near(overall.winRate, 0);
  near(overall.avgProb, 0.8);
  near(overall.calibrationGap, -0.8);
  near(overall.ece, 0.8);
});

test("excludes PUSH, REVIEW, PENDING, and non-numeric probabilities", () => {
  const rows = [
    bet({ status: "WON" }),
    bet({ status: "PUSH" }),
    bet({ status: "REVIEW" }),
    bet({ status: "PENDING" }),
    bet({ status: "WON", fairProbability: "" }),
    bet({ status: "LOST", fairProbability: "1.0" }), // degenerate, excluded
  ];
  const report = buildOutcomeCalibrationReport({ rows });
  assert.equal(report.sampleCount, 1);
});

test("splits VALUE vs CONTROL primary buckets", () => {
  const rows = [
    bet({ tier: "VALUE", status: "WON" }),
    bet({ tier: "CONTROL", status: "LOST" }),
  ];
  const report = buildOutcomeCalibrationReport({ rows });
  assert.equal(report.valueMatchResult.n, 1);
  near(report.valueMatchResult.winRate, 1);
  assert.equal(report.controlMatchResult.n, 1);
  near(report.controlMatchResult.winRate, 0);
});
