import assert from "node:assert/strict";
import test from "node:test";

import { confirmCandidate, median } from "../src/mispricing_confirm.mjs";

const now = new Date("2026-06-25T09:00:00Z");
const referenceEvent = { id: "ref-501" };

// Football MATCH_RESULT (1X2). Each complete market needs 1, X, and 2.
function market3(bookmaker, home, draw, away, updatedAt = "2026-06-25T08:58:00Z") {
  return [
    { bookmaker, eventId: "ref-501", market: "MATCH_RESULT", line: "", outcome: "1", decimalOdds: home, quoteUpdatedAt: updatedAt },
    { bookmaker, eventId: "ref-501", market: "MATCH_RESULT", line: "", outcome: "X", decimalOdds: draw, quoteUpdatedAt: updatedAt },
    { bookmaker, eventId: "ref-501", market: "MATCH_RESULT", line: "", outcome: "2", decimalOdds: away, quoteUpdatedAt: updatedAt },
  ];
}

// Two-way MATCH_RESULT (e.g. basketball/tennis). Each complete market needs 1 and 2.
function market2(bookmaker, home, away, updatedAt = "2026-06-25T08:58:00Z") {
  return [
    { bookmaker, eventId: "ref-501", market: "MATCH_RESULT", line: "", outcome: "1", decimalOdds: home, quoteUpdatedAt: updatedAt },
    { bookmaker, eventId: "ref-501", market: "MATCH_RESULT", line: "", outcome: "2", decimalOdds: away, quoteUpdatedAt: updatedAt },
  ];
}

const footballHome = {
  providerEventId: "501",
  offeredOdds: 2.2,
  market: "MATCH_RESULT",
  line: "",
  outcome: "1",
  sportSlug: "football",
  kickoffUtc: "2026-06-25T18:30:00Z",
};

test("median handles odd and even samples", () => {
  assert.equal(median([0.4, 0.5, 0.6]), 0.5);
  assert.equal(median([0.4, 0.5, 0.6, 0.7]), 0.55);
});

test("confirms only when both Pinnacle and 3-book median exceed strict 20%", () => {
  const rows = [
    ...market3("pinnacle", 1.5, 4.2, 6.5),
    ...market3("betsson", 1.52, 4.1, 6.3),
    ...market3("unibet", 1.49, 4.3, 6.6),
    ...market3("williamhill", 1.51, 4.15, 6.4),
  ];
  const result = confirmCandidate(footballHome, referenceEvent, rows, { now });
  assert.equal(result.status, "CONFIRMED");
  assert.ok(result.pinnacleEv > 0.2);
  assert.ok(result.consensusEv > 0.2);
  assert.equal(result.consensusBooks, 3);
  assert.equal(result.minimumConfirmedEv, Math.min(result.pinnacleEv, result.consensusEv));
});

test("exactly 20 percent fails the strict boundary (two-way market)", () => {
  const twoWayHome = { ...footballHome, sportSlug: "basketball", offeredOdds: 2.4 };
  const result = confirmCandidate(
    twoWayHome,
    referenceEvent,
    [
      ...market2("pinnacle", 1.9, 1.9),
      ...market2("betsson", 1.9, 1.9),
      ...market2("unibet", 1.9, 1.9),
      ...market2("williamhill", 1.9, 1.9),
    ],
    { now },
  );
  assert.ok(Math.abs(result.pinnacleEv - 0.2) < 1e-9);
  assert.ok(Math.abs(result.consensusEv - 0.2) < 1e-9);
  assert.notEqual(result.status, "CONFIRMED");
});

test("rejects fewer than three consensus books, stale Pinnacle, and missing Pinnacle", () => {
  const cases = [
    [
      [...market3("pinnacle", 1.5, 4.2, 6.5), ...market3("betsson", 1.52, 4.1, 6.3), ...market3("unibet", 1.49, 4.3, 6.6)],
      "INSUFFICIENT_CONSENSUS",
    ],
    [
      [
        ...market3("pinnacle", 1.5, 4.2, 6.5, "2026-06-25T08:40:00Z"),
        ...market3("betsson", 1.52, 4.1, 6.3),
        ...market3("unibet", 1.49, 4.3, 6.6),
        ...market3("williamhill", 1.51, 4.15, 6.4),
      ],
      "STALE_PINNACLE_MARKET",
    ],
    [
      [...market3("betsson", 1.52, 4.1, 6.3), ...market3("unibet", 1.49, 4.3, 6.6), ...market3("williamhill", 1.51, 4.15, 6.4)],
      "NO_EXACT_PINNACLE_MARKET",
    ],
  ];
  for (const [rows, reason] of cases) {
    assert.equal(
      confirmCandidate(footballHome, referenceEvent, rows, { now }).reason,
      reason,
    );
  }
});

test("rejects an incomplete football 1X2 market with no draw", () => {
  const rows = [
    { bookmaker: "pinnacle", eventId: "ref-501", market: "MATCH_RESULT", line: "", outcome: "1", decimalOdds: 1.5, quoteUpdatedAt: "2026-06-25T08:58:00Z" },
    { bookmaker: "pinnacle", eventId: "ref-501", market: "MATCH_RESULT", line: "", outcome: "2", decimalOdds: 3.0, quoteUpdatedAt: "2026-06-25T08:58:00Z" },
  ];
  assert.equal(
    confirmCandidate(footballHome, referenceEvent, rows, { now }).reason,
    "NO_EXACT_PINNACLE_MARKET",
  );
});
