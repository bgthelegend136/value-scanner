# World Cup Value-Bet Scanner Design

## Goal

A local CLI `scan` command that surfaces **positive-EV value bets** on upcoming
FIFA World Cup 2026 matches by comparing the prices of bettable Greek-market
books (Stoiximan, Superbet) against **Pinnacle's de-vigged fair price**, and
prints alerts with **data-grounded** reasons.

This supersedes the "no actionable alerts" rule of the earlier regional
validation design, by explicit user instruction. It reuses that harness's
dependency-free modules.

## Scope

- Discover active FIFA World Cup fixtures that are still upcoming (pre-match).
- For each fixture, fetch:
  - **Stoiximan + Superbet** from Odds-API.io (the books the user can bet).
  - **Pinnacle** (and other `eu` books, ignored for now) from The Odds API (the
    sharp fair-odds anchor).
- Normalize both providers into one canonical selection shape.
- Match fixtures across providers by kickoff time + team names.
- Compute Pinnacle's no-vig fair probability per selection, then the EV of each
  bettable book's price.
- Flag selections with `EV >= threshold` and print alerts; write a sanitized
  report.

Markets in scope: **1X2** (`h2h`) and **main Totals** (`totals`, exact line).
BTTS is a documented future extension (see below), not in the first build.

## Safety and Data Handling

- Two keys, read only from `.env.local`: `ODDS_API_IO_KEY`, `THE_ODDS_API_KEY`.
  Never printed, persisted, or included in errors or request URLs (both URLs
  carry the key in the query string).
- No bookmaker-site scraping, automation, login, or betting. "Alerts" are local,
  on-demand CLI/report outputs only — there is **no auto-bet** and no external
  push.
- Raw API responses are not retained; only sanitized selections and comparison
  records.
- Every alert carries a verify-before-betting risk block.

## Regional Identity Caveat

Odds-API.io stated in writing that it does **not** provide isolated local
(Greece-facing) feeds and that "Stoiximan" and "Betano" can be targeted
interchangeably. Therefore the scanner treats `Stoiximan`/`Superbet` prices as a
**branded European feed**, regional identity `UNVERIFIED`. The tool reports value
on the prices as delivered by the API; it does **not** assert these equal the
prices a user sees on stoiximan.gr / superbet.gr.

## Data Sources

### Odds-API.io (existing client, key #1)
- Free tier: 2 selected books, 100 requests/hour.
- `GET /v3/odds?eventId=...&bookmakers=Superbet,Stoiximan`.
- Response schema and normalizer already exist (`src/normalize.mjs`).

### The Odds API (new client, key #2)
- Free tier: 500 credits/month. `/sports` and `/events` cost **0 credits**;
  `/odds` costs `regions × markets` credits (eu × {h2h, totals} = 2).
- `GET /v4/sports` → confirms `soccer_fifa_world_cup` (active).
- `GET /v4/sports/soccer_fifa_world_cup/events` → upcoming fixtures (0 credits).
- `GET /v4/sports/soccer_fifa_world_cup/odds?regions=eu&markets=h2h,totals&oddsFormat=decimal`
  → all `eu` books incl. `pinnacle`.
- Capture `x-requests-remaining`, `x-requests-used`, `x-requests-last`.
- Verified live 2026-06-24: World Cup active, 24 upcoming events, Pinnacle present.

Response shape (verified):
```
event:      { id, sport_key, sport_title, commence_time, home_team, away_team, bookmakers[] }
bookmaker:  { key, title, last_update, markets[] }
market:     { key: "h2h" | "totals", last_update, outcomes[] }
outcome:    { name, price, point? }   // point present for totals
```
- `h2h` outcomes: `name` = `home_team` | `away_team` | `"Draw"`.
- `totals` outcomes: `name` = `"Over"` | `"Under"`, `point` = the line.

## Canonical Selection (shared)

Both normalizers emit the same shape (matching the existing one):

```
provider, bookmaker, eventId, kickoffUtc, homeTeam, awayTeam,
period (= "FULL_TIME"), market ("MATCH_RESULT" | "TOTALS"),
line, outcome ("1"|"X"|"2"|"OVER"|"UNDER"),
decimalOdds, quoteUpdatedAt, receivedAt
```

The Odds API normalizer mapping:
- `h2h`: `home_team` → `1`, `"Draw"` → `X`, `away_team` → `2` (market MATCH_RESULT).
- `totals`: `"Over"` + `point` → `OVER` line=`point`; `"Under"` → `UNDER`.

## Cross-Provider Match (`match.mjs`)

Match an Odds-API.io fixture to a The Odds API fixture by:
1. **Kickoff** equal within a small tolerance (default ±120s; both are scheduled
   UTC and should be identical).
2. **Team names** equal after normalization: lowercase, trim, strip punctuation,
   then apply a national-team **alias table** (e.g. `Bosnia & Herzegovina` ↔
   `Bosnia and Herzegovina`, `South Korea` ↔ `Korea Republic`, `USA` ↔
   `United States`, `Turkey` ↔ `Türkiye`, `Ivory Coast` ↔ `Côte d'Ivoire`).
3. Home/away orientation must agree.

No confident match → **skip** the fixture (never guess); record as `unmatched`.

## Value Model (`value.mjs`)

For a matched fixture and a market both Pinnacle and a bettable book quote:

1. **De-vig** Pinnacle: `implied_i = 1 / pinnacleOdds_i` for each outcome in the
   market; `fair_p_i = implied_i / Σ implied`. (Normalization / multiplicative
   method.)
2. **Fair odds** = `1 / fair_p_i`.
3. For each bettable selection matching `(market, exact line, outcome)`:
   `EV = bookOdds * fair_p - 1`.
4. Flag when `EV >= threshold` (default **+0.03**, `--edge` configurable), then
   label by confidence tier rather than a single verdict:
   - **3%–5%** → `VALUE` (prime, most trustworthy band against a sharp anchor).
   - **5%–15%** → `VALUE_CHECK` (flagged, but verify line/timing first).
   - **> ~15%** → `SUSPICIOUS` — almost always a stale/mismatched line or a
     palpable error, **not** a stronger bet. Surfaced but explicitly warned.
   Report `EV%` and the fair vs offered price for each.
5. Pinnacle must quote that exact selection/line; otherwise `NO_REFERENCE`
   (skipped, not a failure). Totals compare **exact line only** (`2.5` ≠ `2.25`).

Rationale: against a sharp de-vigged anchor, genuine repeatable edge lives in the
low single digits; very high measured EV signals a data artifact (stale soft-book
price, cross-provider timing skew, wrong line match, voidable error), so the
scanner treats high EV as suspect, not superior.

## Reasons (data-grounded only)

Computed from the odds in hand:
- `EV +X% (Stoiximan 7.50 vs fair 6.80 from de-vigged Pinnacle)`
- `Implied probability: offered 13.3% vs fair 14.7%`
- optional cross-market coherence from the same fixture's other selections.

No external narrative (lineups, rotation, tactics) — there is no data source for
it, so it is never printed.

## Risk Block (always)

"Verify official lineup and the exact market/line before betting. EV is modelled
from Pinnacle's de-vigged price, not a guarantee. Odds move — re-check before
staking. No auto-betting."

## Architecture

Reuse (unchanged): `src/env.mjs`, `src/csv.mjs`, `src/client.mjs`,
`src/normalize.mjs`. Existing `events`/`capture`/`evaluate` commands stay.

New modules (each small, single-purpose, TDD):
- `src/theodds_client.mjs` — The Odds API HTTP calls + redacted quota headers;
  never serializes the URL in errors.
- `src/theodds_normalize.mjs` — The Odds API payload → canonical selections.
- `src/match.mjs` — alias-based team normalization + cross-provider fixture match.
- `src/value.mjs` — de-vig, EV, classification, reason strings.
- `src/alert.mjs` — format one alert block in the user's example layout.
- CLI `scan` command — discover World Cup fixtures → fetch both providers →
  match → value → print alerts + write sanitized report to `reports/`.
- `src/env.mjs` — small generalization to require a named key
  (`THE_ODDS_API_KEY`) without leaking it.

## Quota

Per scan: The Odds API = 1 events call (0) + 1 odds call (2 credits) → ~2
credits/scan out of 500/month. Odds-API.io = 1 odds call per fixture (100/hour).
Both comfortable for World Cup match days.

## Testing (TDD)

- `theodds_normalize`: fixture-based — h2h → 1X2 (Draw mapping), totals →
  OVER/UNDER with `point` as line.
- `match`: alias normalization, correct match, rejected mismatch, orientation,
  no-guess on ambiguity.
- `value`: de-vig sums to 1, EV math, threshold classification, `NO_REFERENCE`
  when Pinnacle lacks the selection, exact-line enforcement.
- `alert`: output format.
- CLI `scan`: injected fake clients for both providers; one fixture with a known
  value edge → alert printed + report written + no key leak.

Live use is opt-in and quota-safe; no live calls in the test suite.

## Future Extensions (not in first build)

- **BTTS**: Odds-API.io exposes it, but The Odds API needs a separate `btts`
  market key (extra credits) and Pinnacle BTTS availability varies. Add once the
  core EV loop is proven.
- Additional `eu` reference books beyond Pinnacle for a blended fair line.
- A throttled `watch` mode (still on-demand, no background betting).
