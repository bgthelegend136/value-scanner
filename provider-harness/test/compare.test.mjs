import assert from "node:assert/strict";
import test from "node:test";

import { compareObservation, summarizeComparisons } from "../src/compare.mjs";

const selection = {
  bookmaker: "Stoiximan",
  eventId: "123",
  kickoffUtc: "2026-06-25T18:00:00.000Z",
  period: "FULL_TIME",
  market: "TOTALS",
  line: "2.5",
  outcome: "UNDER",
  decimalOdds: 1.95,
  receivedAt: "2026-06-24T12:00:05.000Z",
};

test("classifies exact, acceptable, and large price differences", () => {
  assert.equal(
    compareObservation(selection, {
      ...selection,
      siteOdds: 1.96,
      siteObservedAt: "2026-06-24T12:00:00.000Z",
    }).classification,
    "EXACT",
  );
  assert.equal(
    compareObservation(selection, {
      ...selection,
      siteOdds: 1.97,
      siteObservedAt: "2026-06-24T12:00:00.000Z",
    }).classification,
    "ACCEPTABLE",
  );
  assert.equal(
    compareObservation(selection, {
      ...selection,
      siteOdds: 2.01,
      siteObservedAt: "2026-06-24T12:00:00.000Z",
    }).classification,
    "LARGE_MISMATCH",
  );
});

test("rejects identity mismatches and observation skew over ten seconds", () => {
  assert.throws(
    () =>
      compareObservation(selection, {
        ...selection,
        line: "2.25",
        siteOdds: 1.95,
        siteObservedAt: "2026-06-24T12:00:00.000Z",
      }),
    /identity mismatch: line/,
  );
  assert.throws(
    () =>
      compareObservation(selection, {
        ...selection,
        siteOdds: 1.95,
        siteObservedAt: "2026-06-24T11:59:54.000Z",
      }),
    /observation skew exceeds 10 seconds/,
  );
});

test("summarizes each bookmaker and market independently", () => {
  const results = [
    compareObservation(selection, {
      ...selection,
      siteOdds: 1.95,
      siteObservedAt: "2026-06-24T12:00:00.000Z",
    }),
    compareObservation(
      { ...selection, bookmaker: "Superbet", market: "MATCH_RESULT", line: "", outcome: "1" },
      {
        ...selection,
        bookmaker: "Superbet",
        market: "MATCH_RESULT",
        line: "",
        outcome: "1",
        siteOdds: 2.0,
        siteObservedAt: "2026-06-24T12:00:00.000Z",
      },
    ),
  ];

  const summary = summarizeComparisons(results);
  assert.equal(summary.length, 2);
  assert.deepEqual(
    summary.map(({ bookmaker, market }) => `${bookmaker}:${market}`).sort(),
    ["Stoiximan:TOTALS", "Superbet:MATCH_RESULT"],
  );
});
