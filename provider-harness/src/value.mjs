// Shared median for fair-probability consensus. Ignores non-finite samples and
// returns undefined for an empty set, so callers can gate on `result > 0`.
export function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return undefined;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

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

// Solve for the exponent k such that the implied probabilities raised to k sum
// to 1. Because a complete market sums to > 1 and each implied prob is < 1,
// raising to k > 1 shrinks the sum; longshots (small probs) shrink fastest,
// which corrects the favorite-longshot bias of the simple proportional method.
function solvePowerExponent(impliedProbabilities) {
  const sumAt = (k) => impliedProbabilities.reduce((sum, p) => sum + p ** k, 0);
  let low = 1;
  let high = 100;
  for (let iteration = 0; iteration < 80; iteration += 1) {
    const mid = (low + high) / 2;
    if (sumAt(mid) > 1) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

export function devigPower(referenceSelections) {
  const groups = new Map();
  for (const selection of referenceSelections) {
    const groupKey = `${selection.market}|${selection.line}`;
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey).push(selection);
  }
  const fair = new Map();
  for (const selections of groups.values()) {
    const implied = selections.map((s) => 1 / s.decimalOdds);
    if (implied.reduce((a, b) => a + b, 0) <= 1) continue;
    const exponent = solvePowerExponent(implied);
    selections.forEach((s, index) => {
      fair.set(`${s.market}|${s.line}|${s.outcome}`, implied[index] ** exponent);
    });
  }
  return fair;
}

// Odds-Only-Equal-Profitability-Confidence (Goto et al., 2024, Algorithm 5).
// Reduces every inverse odd by the same number of standard errors z so the
// probabilities sum to the number of winning outcomes (t = 1 for 1X2 / 2-way
// moneyline / totals). Aligns with the bookmaker's equal-profit objective. If
// any probability would go non-positive (booksum barely above 1), it falls back
// to multiplicative for that market — exactly as the paper specifies. OFFLINE
// challenger only; not wired into the live confirmation path.
export function devigOoEpc(referenceSelections) {
  const groups = new Map();
  for (const selection of referenceSelections) {
    const groupKey = `${selection.market}|${selection.line}`;
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey).push(selection);
  }
  const fair = new Map();
  for (const selections of groups.values()) {
    const implied = selections.map((s) => 1 / s.decimalOdds);
    const booksum = implied.reduce((sum, p) => sum + p, 0);
    if (booksum <= 1) continue;
    const t = 1;
    const se = implied.map((x) => Math.sqrt(x * (1 - x)) / x);
    const sumSe = se.reduce((sum, value) => sum + value, 0);
    const z = sumSe > 0 ? (booksum - t) / sumSe : Infinity;
    const adjusted = implied.map((x, index) => x - z * se[index]);
    const usable = Number.isFinite(z) && adjusted.every((p) => p > 0);
    selections.forEach((s, index) => {
      const probability = usable ? adjusted[index] : implied[index] / booksum;
      fair.set(`${s.market}|${s.line}|${s.outcome}`, probability);
    });
  }
  return fair;
}

// Favourite-Longshot-Bias-Adjusted GLM (Goto et al., 2024, Algorithm 6): raise
// inverse odds to a fitted power beta, then multiplicatively normalise. beta = 1
// is exactly the multiplicative method; beta > 1 disproportionately shrinks
// longshots to correct the favourite-longshot bias. beta is fitted on a training
// split by the historical calibration harness; passing it in keeps this a pure
// transform. OFFLINE challenger only.
export function devigFlGlm(referenceSelections, { beta = 1 } = {}) {
  const groups = new Map();
  for (const selection of referenceSelections) {
    const groupKey = `${selection.market}|${selection.line}`;
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey).push(selection);
  }
  const fair = new Map();
  for (const selections of groups.values()) {
    const implied = selections.map((s) => 1 / s.decimalOdds);
    if (implied.reduce((sum, p) => sum + p, 0) <= 1) continue;
    const powered = implied.map((x) => x ** beta);
    const sum = powered.reduce((total, value) => total + value, 0);
    if (!(sum > 0)) continue;
    selections.forEach((s, index) => {
      fair.set(`${s.market}|${s.line}|${s.outcome}`, powered[index] / sum);
    });
  }
  return fair;
}

export function consensusFairProbabilities(referenceSelections) {
  const byBook = new Map();
  for (const selection of referenceSelections) {
    if (!byBook.has(selection.bookmaker)) byBook.set(selection.bookmaker, []);
    byBook.get(selection.bookmaker).push(selection);
  }
  // Power de-vig per book, then take the median across books — the same method
  // the alert path (mispricing_confirm.mjs) uses, so both consensus figures
  // agree. Median is more robust to a single mispriced/soft book than the mean.
  const samples = new Map();
  for (const bookSelections of byBook.values()) {
    for (const [key, probability] of devigPower(bookSelections)) {
      if (!samples.has(key)) samples.set(key, []);
      samples.get(key).push(probability);
    }
  }
  const consensus = new Map();
  for (const [key, probabilities] of samples) {
    consensus.set(key, { fairProbability: median(probabilities), books: probabilities.length });
  }
  return consensus;
}

export function classifyEv(ev) {
  if (ev >= 0.15) return "SUSPICIOUS";
  if (ev >= 0.05) return "VALUE_CHECK";
  return "VALUE";
}

export function findValueBets(bettableSelections, referenceSelections, { threshold = 0.03 } = {}) {
  const fair = devigPower(referenceSelections);
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
