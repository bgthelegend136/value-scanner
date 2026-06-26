// Single source of truth for the mispricing EV gates. These are meant to be
// tuned: the goal is to catch Stoiximan/Superbet *mistakes*, which typically
// surface as ~10-20% edges against a de-vigged sharp consensus.
//
// MIN_CANDIDATE_EV  — Odds-API.io's (approximate) EV a candidate must show to be
//                     worth spending a reference credit to confirm.
// MIN_CONFIRMED_EV  — the independently-recomputed EV (vs Pinnacle and vs the
//                     median consensus) a candidate must strictly exceed to count
//                     as a confirmed mispricing.
export const MIN_CANDIDATE_EV = 0.1;
export const MIN_CONFIRMED_EV = 0.1;

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
export const CONSENSUS_EXCLUDED_BOOKS = new Set(["pinnacle", "stoiximan", "superbet"]);
