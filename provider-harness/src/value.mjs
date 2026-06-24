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
    // A complete market with a bookmaker margin always sums to > 1. A sum <= 1
    // means the market is one-sided/incomplete, so de-vigging it would invent a
    // bogus ~100% probability — skip it.
    if (sumImplied <= 1) continue;
    for (const s of selections) {
      fair.set(`${s.market}|${s.line}|${s.outcome}`, 1 / s.decimalOdds / sumImplied);
    }
  }
  return fair;
}

export function consensusFairProbabilities(referenceSelections) {
  const byBook = new Map();
  for (const selection of referenceSelections) {
    if (!byBook.has(selection.bookmaker)) byBook.set(selection.bookmaker, []);
    byBook.get(selection.bookmaker).push(selection);
  }
  const totals = new Map();
  for (const bookSelections of byBook.values()) {
    for (const [key, probability] of devig(bookSelections)) {
      const entry = totals.get(key) ?? { sum: 0, books: 0 };
      entry.sum += probability;
      entry.books += 1;
      totals.set(key, entry);
    }
  }
  const consensus = new Map();
  for (const [key, { sum, books }] of totals) {
    consensus.set(key, { fairProbability: sum / books, books });
  }
  return consensus;
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
