import { MARKET_MARGINS } from "./boost.mjs";
import { parseLegPick } from "./boost_legs.mjs";
import {
  CONSENSUS_EXCLUDED_BOOKS as EXCLUDED_CONSENSUS,
  MAX_QUOTE_AGE_MS as MAX_AGE_MS,
} from "./mispricing_thresholds.mjs";
import { devigPower, median } from "./value.mjs";

const EXTRA_MARGINS = {
  btts: 0.08,
};

function parseOverUnder(token) {
  const match = String(token ?? "").toUpperCase().match(/^([OU])(\d+(?:\.\d+)?)$/u);
  if (!match) return null;
  return { outcome: match[1] === "O" ? "OVER" : "UNDER", line: match[2] };
}

export function parseMixLeg(token) {
  const raw = String(token ?? "").trim();
  const basic = parseLegPick(raw);
  if (basic) {
    const estimateMarket = basic.market === "TOTALS" ? "totals" : "1x2";
    return { ...basic, estimateMarket };
  }

  const upper = raw.toUpperCase();
  if (upper === "BTTS_YES" || upper === "BTTS:YES") {
    return { market: "BTTS", line: "", outcome: "YES", estimateMarket: "btts" };
  }
  if (upper === "BTTS_NO" || upper === "BTTS:NO") {
    return { market: "BTTS", line: "", outcome: "NO", estimateMarket: "btts" };
  }

  const parts = raw.split(":");
  if (parts.length === 3 && parts[0].toUpperCase() === "TEAM") {
    const total = parseOverUnder(parts[2]);
    if (!parts[1] || !total) return null;
    return {
      market: "TEAM_TOTALS",
      line: `${parts[1]}|${total.line}`,
      outcome: total.outcome,
      estimateMarket: "team-total",
    };
  }
  if (parts.length === 2 && parts[0].toUpperCase() === "CORNERS") {
    const total = parseOverUnder(parts[1]);
    if (!total) return null;
    return {
      market: "CORNERS_TOTALS",
      line: total.line,
      outcome: total.outcome,
      estimateMarket: "corners",
    };
  }
  if (parts.length === 3 && parts[0].toUpperCase() === "CARDS") {
    return {
      market: "CARDS_SPREAD",
      line: "",
      outcome: parts[1],
      requestedPoint: parts[2],
      estimateMarket: "cards",
    };
  }
  if (parts.length >= 3 && parts[0].toUpperCase() === "PLAYER") {
    const player = parts[1];
    const kind = parts[2].toUpperCase();
    if (!player) return null;
    if (kind === "GOAL") {
      return { market: "PLAYER_GOALSCORER", line: player, outcome: "YES", estimateMarket: "player" };
    }
    if ((kind === "SHOTS" || kind === "SOT" || kind === "SHOTS_OT") && parts[3]) {
      const total = parseOverUnder(parts[3]);
      if (!total) return null;
      return {
        market: kind === "SHOTS" ? "PLAYER_SHOTS" : "PLAYER_SHOTS_ON_TARGET",
        line: `${player}|${total.line}`,
        outcome: total.outcome,
        estimateMarket: "player",
      };
    }
  }

  return null;
}

function fresh(rows, now, maxAgeMs = MAX_AGE_MS) {
  return rows.length > 0 && rows.every((row) => {
    const timestamp = new Date(row.quoteUpdatedAt).getTime();
    return Number.isFinite(timestamp) &&
      now.getTime() - timestamp <= maxAgeMs &&
      timestamp <= now.getTime() + 60_000;
  });
}

function rowsForBook(rows, book, spec) {
  if (spec.market !== "CARDS_SPREAD" || !spec.requestedPoint) {
    return rows.filter((row) =>
      row.bookmaker === book &&
      row.market === spec.market &&
      String(row.line) === String(spec.line));
  }
  return rows.filter((row) =>
    row.bookmaker === book &&
    row.market === spec.market &&
    String(row.line).includes(`${spec.outcome}|${spec.requestedPoint}`));
}

function doubleChanceParts(outcome) {
  return {
    "1X": ["1", "X"],
    X1: ["1", "X"],
    "12": ["1", "2"],
    "21": ["1", "2"],
    X2: ["X", "2"],
    "2X": ["X", "2"],
  }[outcome];
}

function probabilityForBook(rows, book, spec, now) {
  if (spec.market === "DOUBLE_CHANCE") {
    const bookRows = rows.filter((row) =>
      row.bookmaker === book &&
      row.market === "MATCH_RESULT" &&
      String(row.line ?? "") === "");
    if (!fresh(bookRows, now)) return undefined;
    const fair = devigPower(bookRows);
    const parts = doubleChanceParts(spec.outcome);
    if (!parts) return undefined;
    const probabilities = parts.map((part) => fair.get(`MATCH_RESULT||${part}`));
    return probabilities.every((probability) => probability > 0)
      ? probabilities.reduce((sum, probability) => sum + probability, 0)
      : undefined;
  }
  const bookRows = rowsForBook(rows, book, spec);
  if (!fresh(bookRows, now)) return undefined;
  const fair = devigPower(bookRows);
  return fair.get(`${spec.market}|${spec.line}|${spec.outcome}`);
}

function estimateProbability(rows, spec, now) {
  const candidates = rows
    .filter((row) =>
      row.market === spec.market &&
      String(row.line) === String(spec.line) &&
      row.outcome === spec.outcome)
    .filter((row) => fresh([row], now))
    .map((row) => 1 / row.decimalOdds);
  const implied = median(candidates);
  if (!(implied > 0)) return undefined;
  const margin = MARKET_MARGINS[spec.estimateMarket] ?? EXTRA_MARGINS[spec.estimateMarket];
  if (!(margin >= 0)) return undefined;
  return implied / (1 + margin);
}

export function priceMixLeg(selections, eventId, legSpec, { now = new Date() } = {}) {
  if (!legSpec) return { status: "UNVERIFIABLE", reason: "UNSUPPORTED_LEG", spec: legSpec };

  const rows = selections.filter((row) => row.eventId === String(eventId));
  const pinnacleFairProbability = probabilityForBook(rows, "pinnacle", legSpec, now);

  const books = [...new Set(rows.map((row) => row.bookmaker))];
  const consensusValues = books
    .filter((book) => !EXCLUDED_CONSENSUS.has(book))
    .map((book) => probabilityForBook(rows, book, legSpec, now))
    .filter((probability) => probability > 0);
  const consensusFairProbability = median(consensusValues);

  if (pinnacleFairProbability > 0 && consensusValues.length >= 3 && consensusFairProbability > 0) {
    return {
      status: "VERIFIED",
      spec: legSpec,
      pinnacleFairProbability,
      consensusFairProbability,
      consensusBooks: consensusValues.length,
    };
  }

  const estimated = estimateProbability(rows, legSpec, now);
  if (estimated > 0) {
    return {
      status: "ESTIMATE_ONLY",
      reason: "ONE_SIDED_OR_INCOMPLETE_MARKET_ESTIMATE_ONLY",
      spec: legSpec,
      estimateProbability: estimated,
      consensusBooks: consensusValues.length,
    };
  }

  return {
    status: "UNVERIFIABLE",
    reason: pinnacleFairProbability > 0 ? "INSUFFICIENT_CONSENSUS" : "NO_PINNACLE_MARKET",
    spec: legSpec,
    consensusBooks: consensusValues.length,
  };
}

export function analyzeBoostMix({ boostedOdds, legResults } = {}) {
  const boosted = Number(boostedOdds);
  if (!Number.isFinite(boosted) || boosted <= 1) {
    throw new Error("boosted odds must be decimal odds greater than 1");
  }
  const legs = Array.isArray(legResults) ? legResults : [];
  if (legs.some((leg) => leg.status === "UNVERIFIABLE")) {
    return { status: "UNVERIFIABLE" };
  }
  const allVerified = legs.length > 0 && legs.every((leg) => leg.status === "VERIFIED");
  if (allVerified) {
    const pinnacleProbability = legs.reduce((product, leg) => product * leg.pinnacleFairProbability, 1);
    const consensusProbability = legs.reduce((product, leg) => product * leg.consensusFairProbability, 1);
    return {
      status: "FULLY_VERIFIED",
      pinnacleFairOdds: 1 / pinnacleProbability,
      consensusFairOdds: 1 / consensusProbability,
      pinnacleEv: boosted * pinnacleProbability - 1,
      consensusEv: boosted * consensusProbability - 1,
    };
  }

  const estimatedProbability = legs.reduce((product, leg) => {
    const probability = leg.status === "VERIFIED" ? leg.consensusFairProbability : leg.estimateProbability;
    return probability > 0 ? product * probability : product;
  }, 1);

  return {
    status: "MIXED_ESTIMATE",
    estimatedFairOdds: 1 / estimatedProbability,
    estimatedEv: boosted * estimatedProbability - 1,
  };
}
