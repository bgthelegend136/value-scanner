// Boost / "Ενισχυμένες Αποδόσεις" value checker.
//
// A boost raises the price, but the BASE price already carries the book's
// margin (overround). The boost is only +EV if it gives back MORE than that
// margin. We can't de-vig a single price in isolation, so we work against an
// assumed market overround R: the de-vigged fair odds of the selection are
// roughly baseOdds * R, and the boosted bet's EV is multiplier / R - 1.

// Typical TOTAL overround (margin) for a single market of each type. Soft,
// exotic markets carry far more margin than the sharp 1X2 line — which is
// exactly why boosts on them rarely clear.
export const MARKET_MARGINS = {
  "1x2": 0.05,
  "totals": 0.06,
  "team-total": 0.12,
  "cards": 0.18,
  "corners": 0.18,
  "saves": 0.20,
  "player": 0.22,
};

function positiveOdds(value, name) {
  const odds = Number(value);
  if (!Number.isFinite(odds) || odds <= 1) {
    throw new Error(`${name} must be decimal odds greater than 1`);
  }
  return odds;
}

export function classifyBoostEv(ev) {
  if (ev >= 0.05) return "STRONG_VALUE";
  if (ev >= 0) return "MARGINAL";
  return "NEGATIVE";
}

// For a combo, each leg multiplies in its own margin, so the overround
// compounds: R = (1 + perLegMargin)^legs.
export function comboOverround(perLegMargin, legs) {
  const margin = Number(perLegMargin);
  const count = Number(legs);
  if (!Number.isFinite(margin) || margin < 0) {
    throw new Error("per-leg margin must be >= 0");
  }
  if (!Number.isInteger(count) || count < 1) {
    throw new Error("legs must be a positive integer");
  }
  return (1 + margin) ** count - 1;
}

export function analyzeBoost({ baseOdds, boostedOdds, overround } = {}) {
  const base = positiveOdds(baseOdds, "base odds");
  const boosted = positiveOdds(boostedOdds, "boosted odds");
  const multiplier = boosted / base;

  const result = {
    baseOdds: base,
    boostedOdds: boosted,
    multiplier,
    // The largest base-market overround this boost can still absorb.
    breakEvenMargin: multiplier - 1,
  };

  if (overround != null) {
    const r = Number(overround);
    if (!Number.isFinite(r) || r < 0) {
      throw new Error("overround must be a number >= 0");
    }
    result.overround = r;
    result.fairBoostOdds = base * (1 + r); // boosted must beat this to be +EV
    result.ev = multiplier / (1 + r) - 1;
    result.verdict = classifyBoostEv(result.ev);
  }

  return result;
}
