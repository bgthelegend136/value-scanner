import { kellyStake } from "./staking.mjs";
import {
  decimal,
  hasValidDecimalOdds,
  isPrimaryMarket,
  isSettled,
  optionalNumber,
  tierGroup,
} from "./report_domain.mjs";

export const STAKING_SIM_COLUMNS = [
  "scope", "key", "policy", "bets", "startingBankroll", "finalBankroll", "profit",
  "roi", "totalStaked", "maxDrawdown", "maxDrawdownPct", "longestLosingStreak",
  "maxDailyExposure", "maxDailyExposurePct", "maxMarketExposure",
  "maxBookmakerExposure", "probabilityDrawdown20", "ruinProbability",
  "realStakingEnabled",
];

function stakeFor(row, bankroll, { policy, maxStake }) {
  if (policy === "flat") return maxStake;
  if (policy === "flat_pct") return Math.min(maxStake, bankroll * 0.01);
  const offeredOdds = optionalNumber(row.decimalOdds);
  const edge = optionalNumber(row.ev);
  const fraction = policy === "kelly10" ? 0.10 : 0.25;
  if (offeredOdds === null || edge === null) return 0;
  return Math.min(maxStake, bankroll * kellyStake({
    offeredOdds,
    edge,
    fraction,
    cap: maxStake / bankroll,
  }));
}

function dateKey(row) {
  const timestamp = Date.parse(row.firstSeenAt || row.settledAt || row.kickoffUtc);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString().slice(0, 10) : "(unknown)";
}

function addExposure(map, key, stake) {
  map.set(key, (map.get(key) ?? 0) + stake);
}

function maxMapValue(map) {
  return Math.max(0, ...map.values());
}

function deterministicDrawdownProbability(pnls, bankroll) {
  if (pnls.length === 0 || bankroll <= 0) return 0;
  let drawdown20 = 0;
  const iterations = 200;
  for (let i = 0; i < iterations; i += 1) {
    let current = bankroll;
    let peak = bankroll;
    let maxDrawdown = 0;
    for (let j = 0; j < pnls.length; j += 1) {
      current += pnls[(i * 13 + j * 29) % pnls.length];
      peak = Math.max(peak, current);
      maxDrawdown = Math.max(maxDrawdown, peak - current);
    }
    if (maxDrawdown / bankroll >= 0.20) drawdown20 += 1;
  }
  return drawdown20 / iterations;
}

function exposureRows(map, scope, policy) {
  return [...map]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([key, totalStaked]) => ({
      scope,
      key,
      policy,
      bets: "",
      startingBankroll: "",
      finalBankroll: "",
      profit: "",
      roi: "",
      totalStaked,
      maxDrawdown: "",
      maxDrawdownPct: "",
      longestLosingStreak: "",
      maxDailyExposure: "",
      maxDailyExposurePct: "",
      maxMarketExposure: "",
      maxBookmakerExposure: "",
      probabilityDrawdown20: "",
      ruinProbability: "",
      realStakingEnabled: false,
    }));
}

function simulateRows(rows, { bankroll, policy, maxStake, dailyExposurePct }) {
  let current = bankroll;
  let peak = bankroll;
  let maxDrawdown = 0;
  let longestLosingStreak = 0;
  let losingStreak = 0;
  const curve = [];
  const pnls = [];
  const dailyExposure = new Map();
  const marketExposure = new Map();
  const bookmakerExposure = new Map();
  const dailyCap = bankroll * dailyExposurePct;
  let totalStaked = 0;
  for (const row of rows) {
    const day = dateKey(row);
    const alreadyStakedToday = dailyExposure.get(day) ?? 0;
    const stake = Math.min(
      stakeFor(row, current, { policy, maxStake }),
      Math.max(0, dailyCap - alreadyStakedToday),
    );
    const baseStake = optionalNumber(row.stake) || 1;
    const baseProfit = optionalNumber(row.profit) ?? 0;
    const pnl = baseProfit * (stake / baseStake);
    totalStaked += stake;
    addExposure(dailyExposure, day, stake);
    addExposure(marketExposure, row.market || "(blank)", stake);
    addExposure(bookmakerExposure, row.bookmaker || "(blank)", stake);
    current += pnl;
    peak = Math.max(peak, current);
    maxDrawdown = Math.max(maxDrawdown, peak - current);
    if (pnl < 0) {
      losingStreak += 1;
      longestLosingStreak = Math.max(longestLosingStreak, losingStreak);
    } else {
      losingStreak = 0;
    }
    curve.push(current);
    pnls.push(pnl);
  }
  const maxDailyExposure = maxMapValue(dailyExposure);
  const maxMarketExposure = maxMapValue(marketExposure);
  const maxBookmakerExposure = maxMapValue(bookmakerExposure);
  return {
    summary: {
      bets: rows.length,
      startingBankroll: bankroll,
      finalBankroll: current,
      profit: current - bankroll,
      roi: bankroll > 0 ? (current - bankroll) / bankroll : null,
      totalStaked,
      maxDrawdown,
      maxDrawdownPct: bankroll > 0 ? maxDrawdown / bankroll : null,
      longestLosingStreak,
      maxDailyExposure,
      maxDailyExposurePct: bankroll > 0 ? maxDailyExposure / bankroll : null,
      maxMarketExposure,
      maxBookmakerExposure,
      probabilityDrawdown20: deterministicDrawdownProbability(pnls, bankroll),
      ruinProbability: curve.some((value) => value <= bankroll * 0.5) ? 1 : 0,
      realStakingEnabled: false,
    },
    exposure: {
      daily: [...dailyExposure].sort((left, right) => left[0].localeCompare(right[0]))
        .map(([date, total]) => ({ date, totalStaked: total })),
      market: [...marketExposure].sort((left, right) => left[0].localeCompare(right[0]))
        .map(([market, total]) => ({ market, totalStaked: total })),
      bookmaker: [...bookmakerExposure].sort((left, right) => left[0].localeCompare(right[0]))
        .map(([bookmaker, total]) => ({ bookmaker, totalStaked: total })),
    },
    exposureRows: [
      ...exposureRows(dailyExposure, "dailyExposure", policy),
      ...exposureRows(marketExposure, "marketExposure", policy),
      ...exposureRows(bookmakerExposure, "bookmakerExposure", policy),
    ],
  };
}

export function buildStakingSimReport({
  rows = [],
  generatedAt = new Date().toISOString(),
  bankroll = 1000,
  policy = "flat",
  maxStake = 10,
  dailyExposurePct = 0.05,
} = {}) {
  const candidates = rows
    .filter((row) => hasValidDecimalOdds(row) && tierGroup(row) === "VALUE" && isPrimaryMarket(row) && isSettled(row))
    .sort((left, right) => String(left.firstSeenAt ?? "").localeCompare(String(right.firstSeenAt ?? "")));
  const simulated = simulateRows(candidates, { bankroll, policy, maxStake, dailyExposurePct });
  const { summary } = simulated;
  return {
    generatedAt,
    mode: "RESEARCH_ONLY",
    policy,
    bankroll,
    maxStake,
    realStakingEnabled: false,
    risk: {
      realStakingEnabled: false,
      probabilityDrawdown20: summary.probabilityDrawdown20,
      ruinProbability: summary.ruinProbability,
    },
    exposure: simulated.exposure,
    summary,
    rows: [
      { scope: "summary", key: policy, policy, ...summary },
      ...simulated.exposureRows,
    ],
  };
}

export function stakingSimCsvRow(row) {
  const fixed = new Set([
    "startingBankroll",
    "finalBankroll",
    "profit",
    "roi",
    "maxDrawdown",
    "maxDrawdownPct",
    "totalStaked",
    "maxDailyExposure",
    "maxDailyExposurePct",
    "maxMarketExposure",
    "maxBookmakerExposure",
    "probabilityDrawdown20",
    "ruinProbability",
  ]);
  return Object.fromEntries(STAKING_SIM_COLUMNS.map((key) => {
    const value = row[key];
    if (fixed.has(key) && typeof value === "number") return [key, value.toFixed(6)];
    return [key, decimal(value)];
  }));
}
