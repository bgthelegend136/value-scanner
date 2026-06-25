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
