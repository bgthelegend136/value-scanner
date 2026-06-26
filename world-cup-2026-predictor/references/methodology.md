# World Cup 2026 Prediction Methodology

## Core Pillars

### 1. Klement Model as Macro Prior

Use Joachim Klement's 2026 World Cup model as a tournament-level prior, not as a match oracle. The model is described as econometric and uses:

- FIFA ranking as a proxy for current team quality.
- GDP per capita as a proxy for sports infrastructure, with decreasing returns.
- Population size as a proxy for talent pool.
- Average annual temperature, with climates around 14 C treated as favorable.
- Venue advantage, reduced in 2026 because the tournament is hosted across the United States, Mexico, and Canada.
- A large randomness factor; roughly 45% of a match result can be luck/noise.

When current sources support it, include the published 2026 Klement priors:

- Champion: Netherlands.
- Final: Netherlands vs Portugal.
- Semifinals: Netherlands vs Spain, England vs Portugal.
- Noted upset: Japan eliminating Brazil in the round of 32.
- Group K prior: Portugal first, Colombia second.

If fresh reporting contradicts any of these priors, use the fresh reporting and explain the source date.

### 2. World Cup Historical Record

Use a MisterChip/BDFutbol-style historical lens without depending on one specific site. Prioritize:

- Historic World Cup head-to-head between the national teams.
- Performance by phase: group stage, round of 32, round of 16, quarterfinals, semifinals, finals.
- Extra time and penalty shootout records.
- Recurring tournament patterns that are directly relevant to the match.
- Records and curiosities only when they improve the prediction, not as trivia filler.

Use `mundiales.bdfutbol.com` if accessible. If it is unavailable, use FIFA, RSSSF, Statbunker, 11v11, ESPN, AS, or other reputable archives and cite the source.

## Search Patterns

Use targeted searches like:

- `FIFA World Cup 2026 Team A Team B match preview`
- `FIFA ranking Team A Team B June 2026`
- `Team A Team B head to head World Cup`
- `Team A Team B recent form 2026`
- `Team A injuries suspensions World Cup 2026`
- `Joachim Klement World Cup 2026 prediction Netherlands Portugal`
- `MisterChip Team A Team B Mundial`
- `mundiales bdfutbol Team A Team B`

## Probability Calibration

Start with a balanced 1X2 frame and move it only when the evidence supports the shift:

- Small edge: 38-45% favorite win probability.
- Clear favorite: 46-58%.
- Heavy favorite: 59-70%.
- Extreme favorite: above 70%, only for severe mismatches.

For knockout matches, separate:

- 90-minute result probabilities.
- Qualification probability including extra time and penalties.

Draw probability should usually stay meaningful in group-stage football unless the tactical or quality gap is extreme.

## Betting Value Rules

For decimal odds:

- Break-even probability = `1 / decimal_odds`.
- Fair odds = `1 / estimated_probability`.
- Edge = `estimated_probability - break_even_probability`.

For free bets where the stake is not returned:

- Net win = `stake * (decimal_odds - 1)`.
- Expected free-bet value = `estimated_probability * stake * (decimal_odds - 1)`.
- Compare alternatives by expected free-bet value and volatility, not by cash break-even alone.
- Very short odds waste free-bet value unless the probability edge is overwhelming.
- Minimum-odds free bets should be used on the best available qualifying edge, while no-minimum free bets can be reserved for lower-variance picks.

## Lineup Gate

Before recommending a named-player market:

1. Check official or high-confidence lineup sources.
2. Classify the player status:
   - `confirmed starter`: official lineup lists the player in the XI.
   - `probable starter`: credible previews and prior XI strongly imply a start, but official lineups are not out.
   - `uncertain`: no reliable lineup signal or meaningful rotation/injury risk.
   - `not starting`: player is benched or absent.
3. Adjust action:
   - Confirmed starter: proceed with updated price and minutes-risk check.
   - Probable starter: recommend only as conditional, preferably wait if time allows.
   - Uncertain or not starting: pass on scorer/player-shot combos.

Sportsbook player markets, boosts, and stat panels are not official lineup confirmation.

For same-game parlays, avoid multiplying independent probabilities without adjustment. Estimate the conditional relationship:

- `P(team wins and player scores) = P(team wins) * P(player scores | team wins)`.
- Increase the conditional scorer probability when the player is central to the attack, likely to start, likely to play 75+ minutes, on penalties, or facing a weak defensive matchup.
- Decrease it for wide creators, shared scoring roles, low-total game scripts, possible early substitution, or opponents expected to defend deep.

As a default, require at least 3-5 percentage points of edge over break-even before recommending a bet. If the model edge is smaller than that, call it a pass or recreational-only lean.

## Scoreline Rules

Produce one likely scoreline, not a false range of precision. Use current goals-for/goals-against, pace, tactical style, and game incentives:

- Group-stage favorite with control but not urgency: 1-0 or 2-0.
- Strong favorite against a side that can counter: 2-1.
- Balanced technical matchup: 1-1, 2-1, or 1-2.
- Knockout match with two elite teams: 1-1 with qualification by extra time/penalties, or narrow 1-goal margin.

## Caveat Language

Always include a concise warning equivalent to:

`This is a probabilistic forecast, not a certainty or betting advice. Klement himself warns that if you bet money based on the model, no one can help you.`
