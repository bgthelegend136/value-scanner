// Fractional-Kelly bankroll sizing. For decimal odds O and an expected-value
// edge (EV = O*p - 1), the full Kelly fraction is f* = edge / (O - 1). We never
// stake full Kelly: the fair probability is an estimate, so we apply a Kelly
// fraction (quarter-Kelly is the usual choice under model uncertainty) and a
// hard cap. A non-positive edge, or odds with no payout, stakes nothing.
export function kellyStake({ offeredOdds, edge, fraction, cap }) {
  const payout = offeredOdds - 1;
  if (!(payout > 0) || !(edge > 0)) return 0;
  const fullKelly = edge / payout;
  return Math.min(fraction * fullKelly, cap);
}
