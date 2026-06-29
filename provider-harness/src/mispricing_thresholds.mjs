// Single source of truth for the mispricing EV gates. These are meant to be
// tuned: the goal is to collect 5%+ research signals while still separating
// urgent 10%+ Stoiximan/Pamestoixima mistakes from lower-confidence watchlist edges.
//
// MIN_CANDIDATE_EV  — Odds-API.io's (approximate) EV a candidate must show to be
//                     worth spending a reference credit to confirm.
// MIN_CONFIRMED_EV  — the independently-recomputed EV (vs Pinnacle and vs the
//                     median consensus) a candidate must strictly exceed to count
//                     as a confirmed mispricing.
export const MIN_CANDIDATE_EV = 0.05;
export const MIN_CONFIRMED_EV = 0.05;

// Signal-to-noise floor for a confirmed edge. The consensus books give several
// independent estimates of the fair probability; their spread (standard
// deviation) is a free, data-driven estimate of how uncertain that fair value
// is. We require the probability edge (consensus fair minus the offered break-
// even) to be at least this many standard deviations — i.e. the edge must beat
// the sharp books' own disagreement, not merely the flat EV floor. This guards
// against the optimizer's curse: we alert on the *largest* EV across many noisy
// candidates, and the noisiest (longshot / illiquid) markets manufacture the
// biggest spurious edges. 1.0 is deliberately conservative (real liquid edges
// score in the tens); raise it once the audit's edgeOverDispersion column shows
// the live distribution.
export const MIN_EDGE_OVER_DISPERSION = 1.0;

// Bankroll sizing defaults retained for offline profit-engine/staking research.
// Telegram alerts intentionally do not emit stake sizing until model gates pass.
export const KELLY_FRACTION = 0.25;
export const STAKE_CAP_FRACTION = 0.02;

// Closing-line value is only meaningful at the *close*. A pending alert's CLV is
// captured once we are within this window of kickoff, so a frequently scheduled
// mispricing-clv run grabs a near-closing line rather than one from hours
// earlier. Rows outside the window stay PENDING for a later run.
export const CLV_CAPTURE_WINDOW_MS = 20 * 60 * 1000;

// The strict confirmation rule is implemented identically in three reference
// paths (mispricing_confirm, boost_legs, boost_mix). These two constants keep
// that rule in lockstep so tightening it in one place can never silently leave
// another path on the looser rule:
//
// MAX_QUOTE_AGE_MS         — a sharp reference quote older than this is stale and
//                            cannot confirm a candidate. (Candidate/value-bet
//                            freshness in mispricing_normalize is a *separate*
//                            knob and is intentionally not coupled here.)
// CONSENSUS_EXCLUDED_BOOKS — books kept out of the 3-book consensus: the sharp
//                            anchor (pinnacle) and the two target books whose
//                            own price is the thing under test.
export const MAX_QUOTE_AGE_MS = 10 * 60 * 1000;
export const CONSENSUS_EXCLUDED_BOOKS = new Set(["pinnacle", "stoiximan", "superbet", "novibet"]);
