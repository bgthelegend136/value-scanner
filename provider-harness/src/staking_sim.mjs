import { kellyStake } from "./staking.mjs";
import {
  decimal,
  isPrimaryMarket,
  isSettled,
  optionalNumber,
  tierGroup,
} from "./report_domain.mjs";

export const STAKING_SIM_COLUMNS = [
  "scope", "key", "policy", "bets", "startingBankroll", "finalBankroll", "profit",
  "roi", "maxDrawdown", "longestLosingStreak", "ruinProbability", "realStakingEnabled",
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

function simulateRows(rows, { bankroll, policy, maxStake }) {
  let current = bankroll;
  let peak = bankroll;
  let maxDrawdown = 0;
  let longestLosingStreak = 0;
  let losingStreak = 0;
  const curve = [];
  for (const row of rows) {
    const stake = stakeFor(row, current, { policy, maxStake });
    const baseStake = optionalNumber(row.stake) || 1;
    const baseProfit = optionalNumber(row.profit) ?? 0;
    const pnl = baseProfit * (stake / baseStake);
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
  }
  return {
    bets: rows.length,
    startingBankroll: bankroll,
    finalBankroll: current,
    profit: current - bankroll,
    roi: bankroll > 0 ? (current - bankroll) / bankroll : null,
    maxDrawdown,
    longestLosingStreak,
    ruinProbability: curve.some((value) => value <= bankroll * 0.5) ? 1 : 0,
    realStakingEnabled: false,
  };
}

export function buildStakingSimReport({
  rows = [],
  generatedAt = new Date().toISOString(),
  bankroll = 1000,
  policy = "flat",
  maxStake = 10,
} = {}) {
  const candidates = rows
    .filter((row) => tierGroup(row) === "VALUE" && isPrimaryMarket(row) && isSettled(row))
    .sort((left, right) => String(left.firstSeenAt ?? "").localeCompare(String(right.firstSeenAt ?? "")));
  const summary = simulateRows(candidates, { bankroll, policy, maxStake });
  return {
    generatedAt,
    mode: "RESEARCH_ONLY",
    policy,
    bankroll,
    maxStake,
    realStakingEnabled: false,
    summary,
    rows: [
      { scope: "summary", key: policy, policy, ...summary },
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
    "ruinProbability",
  ]);
  return Object.fromEntries(STAKING_SIM_COLUMNS.map((key) => {
    const value = row[key];
    if (fixed.has(key) && typeof value === "number") return [key, value.toFixed(6)];
    return [key, decimal(value)];
  }));
}
