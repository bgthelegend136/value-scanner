import { selectionKey } from "./mispricing_match.mjs";
import {
  CONSENSUS_EXCLUDED_BOOKS as EXCLUDED_CONSENSUS,
  MAX_QUOTE_AGE_MS as MAX_AGE_MS,
  MIN_CONFIRMED_EV,
  MIN_EDGE_OVER_DISPERSION,
} from "./mispricing_thresholds.mjs";
import { devigPower, median } from "./value.mjs";

export { median };

// Sample standard deviation of the per-book fair probabilities — our proxy for
// how uncertain the "true" fair value is. Fewer than two books carries no usable
// spread.
function standardDeviation(values) {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    (values.length - 1);
  return Math.sqrt(variance);
}

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

function expectedOutcomes(candidate) {
  if (candidate.market === "TOTALS") return new Set(["OVER", "UNDER"]);
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
  // How far the consensus edge stands above the books' own disagreement. With
  // zero disagreement (every book identical) there is no noise to clear, so the
  // ratio is undefined and the gate is vacuously satisfied.
  const consensusDispersion = standardDeviation(probabilities);
  const consensusEdgeProbability = consensusFairProbability - 1 / candidate.offeredOdds;
  const edgeOverDispersion = consensusDispersion > 0
    ? consensusEdgeProbability / consensusDispersion
    : null;
  const base = {
    referenceEventId: String(referenceEvent.id),
    pinnacleFairProbability,
    pinnacleFairOdds: 1 / pinnacleFairProbability,
    pinnacleEv,
    consensusFairProbability,
    consensusFairOdds: 1 / consensusFairProbability,
    consensusEv,
    consensusBooks: probabilities.length,
    consensusDispersion,
    edgeOverDispersion,
    minimumConfirmedEv: Math.min(pinnacleEv, consensusEv),
  };
  if (!(pinnacleEv > MIN_CONFIRMED_EV)) {
    return { ...base, status: "REJECTED", reason: "PINNACLE_EV_BELOW_MIN" };
  }
  if (!(consensusEv > MIN_CONFIRMED_EV)) {
    return { ...base, status: "REJECTED", reason: "CONSENSUS_EV_BELOW_MIN" };
  }
  // Uncertainty gate: an edge smaller than the sharp books' spread is noise, not
  // signal — the kind of false positive the max-EV selection over many markets
  // manufactures. Perfect agreement (null) clears it.
  if (edgeOverDispersion !== null && edgeOverDispersion < MIN_EDGE_OVER_DISPERSION) {
    return { ...base, status: "REJECTED", reason: "EDGE_WITHIN_BOOK_NOISE" };
  }
  return { ...base, status: "CONFIRMED", reason: "" };
}
