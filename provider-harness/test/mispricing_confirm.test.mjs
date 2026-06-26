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

test("confirms when both Pinnacle and the 3-book median clear the EV floor", () => {
  const rows = [
    ...market3("pinnacle", 1.5, 4.2, 6.5),
    ...market3("betsson", 1.52, 4.1, 6.3),
    ...market3("unibet", 1.49, 4.3, 6.6),
    ...market3("williamhill", 1.51, 4.15, 6.4),
  ];
  const result = confirmCandidate(footballHome, referenceEvent, rows, { now });
  assert.equal(result.status, "CONFIRMED");
  assert.ok(result.pinnacleEv > 0.1);
  assert.ok(result.consensusEv > 0.1);
  assert.equal(result.consensusBooks, 3);
  assert.equal(result.minimumConfirmedEv, Math.min(result.pinnacleEv, result.consensusEv));
});

test("a confirmed alert exposes edge-over-dispersion confidence above 1", () => {
  const rows = [
    ...market3("pinnacle", 1.5, 4.2, 6.5),
    ...market3("betsson", 1.52, 4.1, 6.3),
    ...market3("unibet", 1.49, 4.3, 6.6),
    ...market3("williamhill", 1.51, 4.15, 6.4),
  ];
  const result = confirmCandidate(footballHome, referenceEvent, rows, { now });
  assert.equal(result.status, "CONFIRMED");
  // Books agree tightly, so the edge dwarfs their disagreement.
  assert.ok(result.edgeOverDispersion > 1);
  assert.ok(result.consensusDispersion >= 0);
});

test("rejects an edge that sits within the consensus books' disagreement", () => {
  // Two-way market. Pinnacle and the consensus median both clear the 10% EV
  // floor (fair ~0.5, offered 2.4 -> EV +20%), but the three consensus books
  // wildly disagree on the home fair probability (~0.61 / ~0.36 / ~0.50), so the
  // ~8pt edge is smaller than their ~12pt spread: it is statistical noise.
  const twoWayHome = { ...footballHome, sportSlug: "basketball", offeredOdds: 2.4 };
  const result = confirmCandidate(
    twoWayHome,
    referenceEvent,
    [
      ...market2("pinnacle", 1.95, 1.95),
      ...market2("betsson", 1.6, 2.4),
      ...market2("unibet", 2.5, 1.5),
      ...market2("williamhill", 1.95, 1.95),
    ],
    { now },
  );
  // Both EV floors are cleared, so only the dispersion gate can reject it.
  assert.ok(result.pinnacleEv > 0.1);
  assert.ok(result.consensusEv > 0.1);
  assert.equal(result.consensusBooks, 3);
  assert.equal(result.status, "REJECTED");
  assert.equal(result.reason, "EDGE_WITHIN_BOOK_NOISE");
  assert.ok(result.edgeOverDispersion < 1);
});

test("an EV just below the 10 percent floor is rejected", () => {
  const twoWayHome = { ...footballHome, sportSlug: "basketball", offeredOdds: 2.18 };
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
  // fair ~0.5 each -> EV ~ 2.18 * 0.5 - 1 = 0.09
  assert.ok(result.pinnacleEv < 0.1);
  assert.notEqual(result.status, "CONFIRMED");
  assert.equal(result.reason, "PINNACLE_EV_BELOW_MIN");
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
