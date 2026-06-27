import assert from "node:assert/strict";
import test from "node:test";

import {
  calibrationCsvRows,
  filterFinishedMatches,
  scoreCalibrationRows,
  snapshotIsoForKickoff,
} from "../scripts/historical-calibration.mjs";

function event(eventId, kickoffUtc, method, probabilities, actualOutcome) {
  return { eventId, kickoffUtc, method, probabilities, actualOutcome };
}

test("historical calibration scores methods on a temporal out-of-sample split", () => {
  const rows = [
    event("a", "2025-08-01T14:00:00Z", "power", { 1: 0.72, X: 0.18, 2: 0.10 }, "1"),
    event("b", "2025-08-02T14:00:00Z", "power", { 1: 0.20, X: 0.20, 2: 0.60 }, "2"),
    event("c", "2025-08-03T14:00:00Z", "power", { 1: 0.70, X: 0.20, 2: 0.10 }, "1"),
    event("d", "2025-08-04T14:00:00Z", "power", { 1: 0.22, X: 0.58, 2: 0.20 }, "X"),
    event("a", "2025-08-01T14:00:00Z", "multiplicative", { 1: 0.34, X: 0.33, 2: 0.33 }, "1"),
    event("b", "2025-08-02T14:00:00Z", "multiplicative", { 1: 0.34, X: 0.33, 2: 0.33 }, "2"),
    event("c", "2025-08-03T14:00:00Z", "multiplicative", { 1: 0.34, X: 0.33, 2: 0.33 }, "1"),
    event("d", "2025-08-04T14:00:00Z", "multiplicative", { 1: 0.34, X: 0.33, 2: 0.33 }, "X"),
  ];

  const report = scoreCalibrationRows(rows, { bins: 5 });
  const power = report.methods.find((item) => item.method === "power");
  const flat = report.methods.find((item) => item.method === "multiplicative");

  assert.equal(power.train.events, 2);
  assert.equal(power.validate.events, 2);
  assert.equal(power.validate.outcomeRows, 6);
  assert.ok(power.validate.brier < flat.validate.brier);
  assert.ok(Number.isFinite(power.validate.logLoss));
  assert.ok(Number.isFinite(power.validate.baselineLogLoss));
  assert.equal(power.validate.reliability.reduce((sum, bin) => sum + bin.count, 0), 6);
});

test("historical calibration helpers filter finished outcome coverage and pick pre-kickoff snapshots", () => {
  const matches = filterFinishedMatches([
    {
      utcDate: "2025-08-16T15:00:00Z",
      status: "FINISHED",
      homeTeam: { name: "Liverpool" },
      awayTeam: { name: "Bournemouth" },
      score: { fullTime: { home: 2, away: 0 } },
    },
    {
      utcDate: "2025-08-17T15:00:00Z",
      status: "TIMED",
      homeTeam: { name: "Arsenal" },
      awayTeam: { name: "Chelsea" },
      score: { fullTime: { home: null, away: null } },
    },
  ], { from: "2025-08-01", to: "2025-08-31" });

  assert.equal(matches.length, 1);
  assert.equal(matches[0].actualOutcome, "1");
  assert.equal(snapshotIsoForKickoff("2025-08-16T15:00:00Z", 5), "2025-08-16T14:55:00Z");
});

test("historical calibration CSV rows flatten validation metrics and reliability bins", () => {
  const report = scoreCalibrationRows([
    event("a", "2025-08-01T14:00:00Z", "power", { 1: 0.60, X: 0.25, 2: 0.15 }, "1"),
    event("b", "2025-08-02T14:00:00Z", "power", { 1: 0.25, X: 0.20, 2: 0.55 }, "2"),
  ], { bins: 2 });

  const rows = calibrationCsvRows(report);
  assert.ok(rows.some((row) => row.rowType === "summary" && row.method === "power"));
  assert.ok(rows.some((row) => row.rowType === "reliability" && row.method === "power"));
});
