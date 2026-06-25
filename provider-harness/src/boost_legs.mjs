// Fair probabilities for a single boost *leg* across market types, so a Bet
// Builder boost (which mixes 1X2, double chance, totals...) can be priced against
// real sharp odds. MATCH_RESULT and DOUBLE_CHANCE come from the de-vigged 1X2
// line; TOTALS from the de-vigged over/under at the exact line. Team totals /
// BTTS are NOT here — The Odds API h2h/totals does not carry them (needs another
// source; see handoff P7/P8).
import { devigPower } from "./value.mjs";

const MAX_AGE_MS = 10 * 60 * 1000;
const EXCLUDED_CONSENSUS = new Set(["pinnacle", "stoiximan", "superbet"]);

const DOUBLE_CHANCE = {
  "1X": ["1", "X"], X1: ["1", "X"],
  "12": ["1", "2"], "21": ["1", "2"],
  X2: ["X", "2"], "2X": ["X", "2"],
};
const DOUBLE_CHANCE_CANONICAL = { "1X": "1X", X1: "1X", "12": "12", "21": "12", X2: "X2", "2X": "X2" };

export function parseLegPick(pick) {
  const token = String(pick ?? "").toUpperCase();
  if (["1", "X", "2"].includes(token)) return { market: "MATCH_RESULT", outcome: token, line: "" };
  if (DOUBLE_CHANCE_CANONICAL[token]) {
    return { market: "DOUBLE_CHANCE", outcome: DOUBLE_CHANCE_CANONICAL[token], line: "" };
  }
  const totals = token.match(/^([OU])(\d+(?:\.\d+)?)$/u);
  if (totals) return { market: "TOTALS", outcome: totals[1] === "O" ? "OVER" : "UNDER", line: totals[2] };
  return null;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function fresh(rows, now, maxAgeMs) {
  return rows.length > 0 && rows.every((row) => {
    const timestamp = new Date(row.quoteUpdatedAt).getTime();
    return Number.isFinite(timestamp) &&
      now.getTime() - timestamp <= maxAgeMs &&
      timestamp <= now.getTime() + 60_000;
  });
}

// Fair probability of one leg from one book's rows, or undefined if that book
// can't price it (incomplete market, stale, or missing component).
export function legProbabilityForBook(bookRows, legSpec, { now, maxAgeMs = MAX_AGE_MS }) {
  if (legSpec.market === "TOTALS") {
    const rows = bookRows.filter((row) =>
      row.market === "TOTALS" && String(row.line) === String(legSpec.line));
    const outcomes = new Set(rows.map((row) => row.outcome));
    if (!(outcomes.has("OVER") && outcomes.has("UNDER"))) return undefined;
    if (!fresh(rows, now, maxAgeMs)) return undefined;
    return devigPower(rows).get(`TOTALS|${legSpec.line}|${legSpec.outcome}`);
  }

  const rows = bookRows.filter((row) =>
    row.market === "MATCH_RESULT" && String(row.line ?? "") === "");
  const outcomes = new Set(rows.map((row) => row.outcome));
  if (!(outcomes.has("1") && outcomes.has("X") && outcomes.has("2"))) return undefined;
  if (!fresh(rows, now, maxAgeMs)) return undefined;
  const fair = devigPower(rows);
  if (legSpec.market === "MATCH_RESULT") return fair.get(`MATCH_RESULT||${legSpec.outcome}`);

  const [first, second] = DOUBLE_CHANCE[legSpec.outcome] ?? [];
  const a = fair.get(`MATCH_RESULT||${first}`);
  const b = fair.get(`MATCH_RESULT||${second}`);
  return a === undefined || b === undefined ? undefined : a + b;
}

// Pinnacle + 3-book-consensus fair probability for a leg, mirroring the strict
// dual-confirmation rule in mispricing_confirm.mjs.
export function legFairProbabilities(selections, referenceEventId, legSpec, { now, maxAgeMs = MAX_AGE_MS } = {}) {
  if (!legSpec) return { reason: "BAD_PICK" };
  const rows = selections.filter((row) => row.eventId === String(referenceEventId));
  const byBook = new Map();
  for (const row of rows) {
    if (!byBook.has(row.bookmaker)) byBook.set(row.bookmaker, []);
    byBook.get(row.bookmaker).push(row);
  }

  const pinnacle = legProbabilityForBook(byBook.get("pinnacle") ?? [], legSpec, { now, maxAgeMs });
  if (!(pinnacle > 0)) return { reason: "NO_PINNACLE_MARKET" };

  const probabilities = [];
  for (const [book, bookRows] of byBook) {
    if (EXCLUDED_CONSENSUS.has(book)) continue;
    const probability = legProbabilityForBook(bookRows, legSpec, { now, maxAgeMs });
    if (probability > 0) probabilities.push(probability);
  }
  if (probabilities.length < 3) return { reason: "INSUFFICIENT_CONSENSUS" };

  return {
    pinnacleFairProbability: pinnacle,
    consensusFairProbability: median(probabilities),
    reason: "",
  };
}
