import assert from "node:assert/strict";
import test from "node:test";

import {
  applyClosingLine,
  findStalePending,
  mergePaperBets,
  paperBetKey,
  settlePaperBets,
  summarizeClv,
  summarizePaperBets,
} from "../src/paper.mjs";

function opportunity(overrides = {}) {
  return {
    fixture: {
      referenceEventId: "ref-1",
      bettableEventId: "bet-1",
      kickoffUtc: "2026-06-25T18:00:00.000Z",
      homeTeam: "Spain",
      awayTeam: "Cape Verde",
    },
    result: {
      bookmaker: "Stoiximan",
      market: "MATCH_RESULT",
      line: "",
      outcome: "X",
      decimalOdds: 7.5,
      fairOdds: 6.33,
      fairProbability: 0.158,
      ev: 0.185,
      status: "SUSPICIOUS",
      ...overrides,
    },
  };
}

function pending(overrides = {}) {
  const { rows } = mergePaperBets([], [opportunity()], {
    firstSeenAt: "2026-06-24T12:00:00.000Z",
  });
  return { ...rows[0], ...overrides };
}

test("paper bet identity includes event, bookmaker, market, line, and outcome", () => {
  const base = pending();
  assert.notEqual(paperBetKey(base), paperBetKey({ ...base, bookmaker: "Superbet" }));
  assert.notEqual(paperBetKey(base), paperBetKey({ ...base, outcome: "1" }));
  assert.notEqual(
    paperBetKey({ ...base, market: "TOTALS", line: "2.5", outcome: "OVER" }),
    paperBetKey({ ...base, market: "TOTALS", line: "3.5", outcome: "OVER" }),
  );
});

test("merge records a one-unit bet once and preserves first observed values", () => {
  const first = opportunity();
  const initial = mergePaperBets([], [first], {
    firstSeenAt: "2026-06-24T12:00:00.000Z",
  });
  const later = opportunity({ decimalOdds: 8, ev: 0.264, status: "SUSPICIOUS" });
  const repeated = mergePaperBets(initial.rows, [later], {
    firstSeenAt: "2026-06-24T13:00:00.000Z",
  });

  assert.equal(initial.added, 1);
  assert.equal(repeated.added, 0);
  assert.equal(repeated.duplicates, 1);
  assert.equal(repeated.rows.length, 1);
  assert.equal(repeated.rows[0].decimalOdds, "7.5000");
  assert.equal(repeated.rows[0].firstSeenAt, "2026-06-24T12:00:00.000Z");
  assert.equal(repeated.rows[0].stake, "1.00");
  assert.equal(repeated.rows[0].status, "PENDING");
});

test("same selection at two bookmakers creates two paper bets", () => {
  const merged = mergePaperBets(
    [],
    [opportunity(), opportunity({ bookmaker: "Superbet" })],
    { firstSeenAt: "2026-06-24T12:00:00.000Z" },
  );
  assert.equal(merged.added, 2);
  assert.equal(merged.rows.length, 2);
});

test("rejects malformed existing ledger rows instead of silently rewriting them", () => {
  assert.throws(
    () => mergePaperBets([{ referenceEventId: "ref-1" }], [], {
      firstSeenAt: "2026-06-24T12:00:00.000Z",
    }),
    /missing bookmaker/,
  );
});

const drawScore = [{
  id: "ref-1",
  completed: true,
  home_team: "Spain",
  away_team: "Cape Verde",
  scores: [
    { name: "Spain", score: "1" },
    { name: "Cape Verde", score: "1" },
  ],
  last_update: "2026-06-25T20:00:00Z",
}];

test("settles match-result home, draw, and away outcomes", () => {
  const rows = [
    pending({ outcome: "1", decimalOdds: "2.0000" }),
    pending({ outcome: "X", decimalOdds: "3.5000" }),
    pending({ outcome: "2", decimalOdds: "4.0000" }),
  ];
  const settled = settlePaperBets(rows, drawScore);
  assert.deepEqual(settled.map((row) => row.status), ["LOST", "WON", "LOST"]);
  assert.deepEqual(settled.map((row) => row.profit), ["-1.0000", "2.5000", "-1.0000"]);
});

test("settles totals wins, losses, pushes, and quarter lines", () => {
  const base = { market: "TOTALS", outcome: "OVER" };
  const rows = [
    pending({ ...base, line: "1.5", decimalOdds: "1.9000" }),
    pending({ ...base, line: "2.5", decimalOdds: "1.9000" }),
    pending({ ...base, line: "2", decimalOdds: "1.9000" }),
    pending({ ...base, line: "2.25", decimalOdds: "1.9000" }),
  ];
  const settled = settlePaperBets(rows, drawScore);
  assert.deepEqual(settled.map((row) => row.status), ["WON", "LOST", "PUSH", "REVIEW"]);
  assert.deepEqual(settled.map((row) => row.profit), ["0.9000", "-1.0000", "0.0000", ""]);
});

test("marks unknown markets and outcomes for review", () => {
  const rows = [
    pending({ outcome: "UNKNOWN" }),
    pending({ market: "BTTS", outcome: "YES" }),
  ];
  assert.deepEqual(
    settlePaperBets(rows, drawScore).map((row) => row.status),
    ["REVIEW", "REVIEW"],
  );
});

test("leaves missing, incomplete, and malformed score events pending", () => {
  const row = pending();
  assert.equal(settlePaperBets([row], [])[0].status, "PENDING");
  assert.equal(
    settlePaperBets([row], [{ ...drawScore[0], completed: false }])[0].status,
    "PENDING",
  );
  assert.equal(
    settlePaperBets([row], [{ ...drawScore[0], scores: [{ name: "Spain", score: "x" }] }])[0].status,
    "PENDING",
  );
});

test("does not recalculate terminal rows", () => {
  const won = pending({ status: "WON", profit: "6.5000", homeScore: "0", awayScore: "0" });
  assert.deepEqual(settlePaperBets([won], drawScore), [won]);
});

test("summarizes settled stake, net profit, ROI, and open statuses", () => {
  const rows = [
    pending({ status: "WON", profit: "2.5000" }),
    pending({ status: "LOST", profit: "-1.0000" }),
    pending({ status: "PUSH", profit: "0.0000" }),
    pending(),
    pending({ status: "REVIEW" }),
  ];
  assert.deepEqual(summarizePaperBets(rows), {
    total: 5,
    pending: 1,
    settled: 3,
    wins: 1,
    losses: 1,
    pushes: 1,
    review: 1,
    settledStake: 3,
    profit: 1.5,
    roi: 0.5,
  });
});

test("finds pending bets whose kickoff is beyond the scores window", () => {
  const rows = [
    pending({ kickoffUtc: "2026-06-20T12:00:00Z" }),
    pending({ kickoffUtc: "2026-06-23T13:00:00Z" }),
    pending({ kickoffUtc: "2026-06-20T12:00:00Z", status: "WON", profit: "1.0000" }),
  ];
  const stale = findStalePending(rows, new Date("2026-06-24T12:00:00Z"));
  assert.equal(stale.length, 1);
  assert.equal(stale[0].kickoffUtc, "2026-06-20T12:00:00Z");
});

test("applies closing-line CLV to pending bets and skips settled ones", () => {
  const rows = [
    pending(),
    pending({ status: "WON", profit: "6.5000" }),
  ];
  // closing fair probability 16% for the draw -> fair odds 6.25; bet odds 7.5
  const closing = new Map([["ref-1|MATCH_RESULT||X", 0.16]]);
  const updated = applyClosingLine(rows, closing, { capturedAt: "2026-06-25T17:55:00.000Z" });
  assert.equal(updated[0].closingFairOdds, "6.2500");
  assert.equal(updated[0].clv, "0.200000"); // 7.5 * 0.16 - 1
  assert.equal(updated[0].clvCapturedAt, "2026-06-25T17:55:00.000Z");
  assert.equal(updated[1].clv, ""); // settled row untouched
});

test("leaves CLV blank when no closing line covers the selection", () => {
  const updated = applyClosingLine([pending()], new Map(), { capturedAt: "x" });
  assert.equal(updated[0].clv, "");
  assert.equal(updated[0].closingFairOdds, "");
});

test("summarizes CLV beat rate and average", () => {
  const rows = [
    pending({ clv: "0.200000" }),
    pending({ clv: "-0.050000" }),
    pending({ clv: "" }),
  ];
  const summary = summarizeClv(rows);
  assert.equal(summary.captured, 2);
  assert.equal(summary.positive, 1);
  assert.equal(summary.beatRate, 0.5);
  assert.ok(Math.abs(summary.averageClv - 0.075) < 1e-9);
});
