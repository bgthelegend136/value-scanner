---
name: world-cup-2026-predictor
description: Generate informed, sourced predictions and betting-value analysis for FIFA World Cup 2026 matches, group outcomes, knockout qualification, championship picks, probable scores, props, same-game parlays, and quiniela/bracket questions. Use when the user asks who will win, who qualifies, expected results, score predictions, odds value, whether to take a bet, player-to-score offers, tournament forecasts, or mentions national-team matchups in the context of the 2026 World Cup even without saying "prediction".
---

# World Cup 2026 Predictor

## Overview

Predict 2026 World Cup outcomes with a transparent evidence stack: current team strength, recent form, World Cup history, matchup context, and the Joachim Klement econometric model as a macro prior. Treat every output as probabilistic and date-stamped, not as a guaranteed result or betting recommendation.

## Workflow

1. Identify the exact match, phase, or tournament question. If the user asks after a match may have already been played, verify whether the result is final before predicting.
2. Use current web/search data before forecasting. Prioritize official FIFA pages, current FIFA rankings, team news, injuries/suspensions, lineups when available, recent results, and reputable World Cup databases.
3. Load `references/methodology.md` when making a prediction, ranking group outcomes, or explaining the model.
4. Combine the evidence into probabilities and a likely scoreline. Keep uncertainty visible; Klement's own framing leaves a large random component in football outcomes.
5. Answer in the user's language unless they ask otherwise.

## Evidence To Gather

- Match status: scheduled, live, completed, venue, kickoff time, weather if relevant, rest days, travel, altitude, and home/host advantage.
- Team quality: current FIFA ranking, Elo-style ratings when available, squad value or club-level quality, tactical profile, and key player availability.
- Recent form: last 5-10 matches, competitive matches weighted above friendlies, goals for/against, clean sheets, and opponent strength.
- Tournament history: World Cup head-to-head, stage-specific performance, penalty shootout record, and historical patterns from reputable archives.
- Klement model inputs: FIFA ranking, GDP per capita with decreasing returns, population size, average annual temperature proximity to roughly 14 C, venue advantage, and a large luck/randomness factor.
- Market view when useful: odds or consensus previews may be included as crowd wisdom, but never use betting markets as the only reason.

## Prediction Blend

Use this default weighting unless the evidence clearly calls for adjustment:

- 35% current team strength and recent form
- 25% Klement macro/tournament prior
- 20% matchup, tactical fit, and player availability
- 15% World Cup history and phase-specific context
- 5% venue, rest, travel, weather, and situational factors

Keep 90-minute win probabilities conservative. Only exceed 70% for one side when the evidence shows a major mismatch across ranking, form, squad strength, and availability.

## Response Format

For a single match, use:

```markdown
Prediccion: Team A 2-1 Team B
Probabilidades 90 minutos: Team A 48% | Empate 27% | Team B 25%
Si es eliminatoria: clasifica Team A, con X% incluyendo prorroga/penales.
Confianza: Media

Por que:
- Current form/ranking point.
- Klement-model point.
- Historical or World Cup-stage point.
- Main risk or upset path.

Aviso: Es una estimacion probabilistica, no una certeza ni consejo de apuesta.
Fuentes: source links with dates.
```

For a group or bracket question, return projected standings or bracket path, qualification probabilities, key swing matches, and one concise explanation per team.

## Betting Lens

When the user gives odds or asks whether a bet is worth taking:

1. Convert the offered decimal odds into break-even probability: `1 / odds`.
2. Estimate the fair probability from the evidence, explicitly separating team result, player prop, and same-game correlation.
3. Convert fair probability back to fair odds: `1 / probability`.
4. Classify the bet:
   - Take only if estimated probability is clearly above break-even after margin for error.
   - Lean take if the edge is small but plausible and the stake is recreational.
   - Pass if fair probability is near or below break-even.
5. Compare against simpler alternatives when relevant, such as team win, team total goals, player shots, or player anytime scorer alone.
6. Keep bankroll advice conservative: no chasing, no certainty language, and stake small on correlated player/result props.

## Lineup Gate

For any player-dependent bet, run a lineup gate before recommending action:

- Confirm whether official lineups are available from FIFA, the sportsbook event page, reputable live blogs, or team accounts.
- If official lineups are not available, label the bet `conditional` and state the exact condition, such as "only place if Schick starts".
- Treat sportsbook player markets and player stat panels as evidence of availability/importance, not proof of starting status.
- If the player starts, reassess the price, role, and minutes risk. If the player is benched, do not recommend an anytime-scorer or player-shot combo unless the market rules clearly void non-starters and the user accepts that risk.
- Prefer waiting for lineups when the bonus expiry allows it and the bet depends on one named player.

## Free Bet Lens

When the user is using a free bet where the stake is not returned:

- Calculate net win as `stake * (odds - 1)`.
- Compare free-bet candidates by expected free-bet value: `estimated_probability * stake * (odds - 1)`.
- Do not treat normal cash break-even as the only decision rule. A higher-odds free-bet pick can be better than a safer low-odds pick because the user does not receive the bonus stake back.
- Respect bonus constraints first: expiry, minimum ticket odds, max stake per bonus, eligible sports/markets, and whether multiple free bets are being combined on one ticket.
- Prefer using soon-expiring and minimum-odds bonuses first. Keep longer-dated, no-minimum bonuses for lower-variance spots unless a clearly superior value appears.

## Guardrails

- Do not claim certainty or imply the future is known.
- Do not fabricate data, rankings, odds, head-to-head records, injuries, or lineups. If evidence is unavailable, say so and lower confidence.
- If a match is already completed, provide the actual result first and only offer a counterfactual prediction if asked.
- Always include the model caveat: football has a large random component, and Klement warned against using his model as betting advice.
- Prefer fresh sources. Rankings, squads, injuries, odds, and even completed results can change quickly during the tournament.
