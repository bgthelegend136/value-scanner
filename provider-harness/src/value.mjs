export function devig(referenceSelections) {
  const groups = new Map();
  for (const selection of referenceSelections) {
    const groupKey = `${selection.market}|${selection.line}`;
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey).push(selection);
  }
  const fair = new Map();
  for (const selections of groups.values()) {
    const sumImplied = selections.reduce((sum, s) => sum + 1 / s.decimalOdds, 0);
    if (sumImplied <= 0) continue;
    for (const s of selections) {
      fair.set(`${s.market}|${s.line}|${s.outcome}`, 1 / s.decimalOdds / sumImplied);
    }
  }
  return fair;
}

export function classifyEv(ev) {
  if (ev >= 0.15) return "SUSPICIOUS";
  if (ev >= 0.05) return "VALUE_CHECK";
  return "VALUE";
}

export function findValueBets(bettableSelections, referenceSelections, { threshold = 0.03 } = {}) {
  const fair = devig(referenceSelections);
  const results = [];
  for (const selection of bettableSelections) {
    const fairProbability = fair.get(`${selection.market}|${selection.line}|${selection.outcome}`);
    if (fairProbability === undefined) {
      results.push({ ...selection, status: "NO_REFERENCE" });
      continue;
    }
    const ev = selection.decimalOdds * fairProbability - 1;
    const fairOdds = 1 / fairProbability;
    if (ev < threshold) {
      results.push({ ...selection, status: "NO_VALUE", ev, fairProbability, fairOdds });
      continue;
    }
    results.push({ ...selection, status: classifyEv(ev), ev, fairProbability, fairOdds });
  }
  return results;
}

export function buildReasons(bet) {
  const reasons = [
    `EV +${(bet.ev * 100).toFixed(1)}% (${bet.bookmaker} ${bet.decimalOdds.toFixed(2)} vs fair ${bet.fairOdds.toFixed(2)} from de-vigged Pinnacle)`,
    `Implied probability: offered ${(100 / bet.decimalOdds).toFixed(1)}% vs fair ${(bet.fairProbability * 100).toFixed(1)}%`,
  ];
  if (bet.status === "SUSPICIOUS") {
    reasons.push("Unusually high EV — likely a stale/mismatched line or palpable error; verify before trusting.");
  }
  return reasons;
}
