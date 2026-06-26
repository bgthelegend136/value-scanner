import { selectionKey } from "./mispricing_match.mjs";
import {
  CONSENSUS_EXCLUDED_BOOKS as EXCLUDED_CONSENSUS,
  MAX_QUOTE_AGE_MS as MAX_AGE_MS,
  MIN_CONFIRMED_EV,
} from "./mispricing_thresholds.mjs";
import { devigPower, median } from "./value.mjs";

export { median };

function exactMarket(rows, candidate) {
  return rows.filter((row) =>
    row.market === candidate.market &&
    String(row.line ?? "") === String(candidate.line ?? ""),
  );
}

function validTimestamp(value, now, maxAgeMs) {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) &&
    now.getTime() - timestamp <= maxAgeMs &&
    timestamp <= now.getTime() + 60_000;
}

// v1 supports MATCH_RESULT only. Football-style sports carry a draw; everything
// else is two-way. A market must contain exactly these outcomes to be de-vigged.
function expectedOutcomes(candidate) {
  return candidate.sportSlug === "football"
    ? new Set(["1", "X", "2"])
    : new Set(["1", "2"]);
}

function fairForBook(rows, candidate) {
  const marketRows = exactMarket(rows, candidate);
  const actual = new Set(marketRows.map((row) => row.outcome));
  const expected = expectedOutcomes(candidate);
  if (
    actual.size !== expected.size ||
    [...expected].some((outcome) => !actual.has(outcome))
  ) {
    return { probability: undefined, rows: marketRows };
  }
  const key = selectionKey(candidate);
  return {
    probability: devigPower(marketRows).get(key),
    rows: marketRows,
  };
}

export function confirmCandidate(
  candidate,
  referenceEvent,
  normalizedSelections,
  { now, maxAgeMs = MAX_AGE_MS },
) {
  const rows = normalizedSelections.filter((row) => row.eventId === String(referenceEvent.id));
  const pinnacleRows = rows.filter((row) => row.bookmaker === "pinnacle");
  const pinnacle = fairForBook(pinnacleRows, candidate);
  if (pinnacle.probability === undefined) {
    return { status: "REJECTED", reason: "NO_EXACT_PINNACLE_MARKET" };
  }
  if (!pinnacle.rows.every((row) => validTimestamp(row.quoteUpdatedAt, now, maxAgeMs))) {
    return { status: "REJECTED", reason: "STALE_PINNACLE_MARKET" };
  }

  const byBook = new Map();
  for (const row of rows) {
    if (EXCLUDED_CONSENSUS.has(row.bookmaker)) continue;
    if (!byBook.has(row.bookmaker)) byBook.set(row.bookmaker, []);
    byBook.get(row.bookmaker).push(row);
  }
  const probabilities = [];
  for (const bookRows of byBook.values()) {
    const result = fairForBook(bookRows, candidate);
    if (result.probability === undefined) continue;
    if (!result.rows.every((row) => validTimestamp(row.quoteUpdatedAt, now, maxAgeMs))) continue;
    probabilities.push(result.probability);
  }
  if (probabilities.length < 3) {
    return { status: "REJECTED", reason: "INSUFFICIENT_CONSENSUS" };
  }

  const consensusFairProbability = median(probabilities);
  const pinnacleFairProbability = pinnacle.probability;
  const pinnacleEv = candidate.offeredOdds * pinnacleFairProbability - 1;
  const consensusEv = candidate.offeredOdds * consensusFairProbability - 1;
  const base = {
    referenceEventId: String(referenceEvent.id),
    pinnacleFairProbability,
    pinnacleFairOdds: 1 / pinnacleFairProbability,
    pinnacleEv,
    consensusFairProbability,
    consensusFairOdds: 1 / consensusFairProbability,
    consensusEv,
    consensusBooks: probabilities.length,
    minimumConfirmedEv: Math.min(pinnacleEv, consensusEv),
  };
  if (!(pinnacleEv > MIN_CONFIRMED_EV)) {
    return { ...base, status: "REJECTED", reason: "PINNACLE_EV_BELOW_MIN" };
  }
  if (!(consensusEv > MIN_CONFIRMED_EV)) {
    return { ...base, status: "REJECTED", reason: "CONSENSUS_EV_BELOW_MIN" };
  }
  return { ...base, status: "CONFIRMED", reason: "" };
}
