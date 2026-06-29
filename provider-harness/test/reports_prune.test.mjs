import assert from "node:assert/strict";
import test from "node:test";

import { planSnapshotPrune } from "../src/reports_prune.mjs";

const snapshots = (stamps) =>
  stamps.flatMap((stamp) => [
    `historical-calibration-${stamp}.json`,
    `historical-calibration-${stamp}.csv`,
  ]);

test("keeps the newest N of each extension and deletes the rest", () => {
  const files = snapshots([
    "2026-06-25T00-00-00.000Z",
    "2026-06-26T00-00-00.000Z",
    "2026-06-27T00-00-00.000Z",
    "2026-06-28T00-00-00.000Z",
  ]);
  const toDelete = planSnapshotPrune(files, { keep: 2 }).sort();
  assert.deepEqual(toDelete, [
    "historical-calibration-2026-06-25T00-00-00.000Z.csv",
    "historical-calibration-2026-06-25T00-00-00.000Z.json",
    "historical-calibration-2026-06-26T00-00-00.000Z.csv",
    "historical-calibration-2026-06-26T00-00-00.000Z.json",
  ]);
});

test("leaves unrelated report files untouched", () => {
  const files = [
    "calibration-report.json",
    "paper-bets.csv",
    "data-health.json",
    ...snapshots(["2026-06-27T00-00-00.000Z"]),
  ];
  assert.deepEqual(planSnapshotPrune(files, { keep: 0 }).sort(), [
    "historical-calibration-2026-06-27T00-00-00.000Z.csv",
    "historical-calibration-2026-06-27T00-00-00.000Z.json",
  ]);
});

test("deletes nothing when fewer snapshots than the keep budget exist", () => {
  const files = snapshots(["2026-06-27T00-00-00.000Z", "2026-06-28T00-00-00.000Z"]);
  assert.deepEqual(planSnapshotPrune(files, { keep: 8 }), []);
});

test("handles an empty directory listing", () => {
  assert.deepEqual(planSnapshotPrune([], { keep: 3 }), []);
});
