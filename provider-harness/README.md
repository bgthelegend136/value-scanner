# Odds-API.io Regional Validation Harness

> 🇬🇷 **Χρήστες:** για οδηγό χρήσης στα ελληνικά (τι κάνει, πώς τρέχει, πώς
> διαβάζεις τα αποτελέσματα), δες το [`USER-GUIDE.md`](USER-GUIDE.md).

A small, dependency-free Node.js 22 harness that helps determine whether
Odds-API.io prices for **Superbet** and **Stoiximan** correspond to the prices
shown on their Greece-facing websites.

It does this without scraping, automating, logging into, or betting on any
bookmaker site. The provider feed is fetched over the documented HTTP API; the
bookmaker-site prices are entered **by a human** into a generated worksheet, and
the harness only compares the two.

## What it is not

- It does **not** scrape or automate bookmaker websites.
- It does **not** place bets or generate actionable alerts.
- It does **not** prove regional identity. A bookmaker name alone is not proof
  that a feed is the Greece-facing product. Every captured selection is recorded
  with `regionalStatus = UNVERIFIED` until the provider supplies an explicit feed
  identifier or written human confirmation.

## Requirements

- Node.js **22+** (uses the built-in `fetch`, `node:test`, and ES modules).
- No runtime dependencies.
- An Odds-API.io key in a git-ignored `.env.local` at the repository root:

  ```
  ODDS_API_IO_KEY=your-key-here
  ```

The key is read only from `.env.local`. It is never printed, persisted, or
included in error messages or request URLs.

## Commands

Run from the `provider-harness/` directory.

### `events`

```
node src/cli.mjs events
```

Fetches up to 5 upcoming football events
(`GET /v3/events?sport=football&limit=5`) and prints a bounded, readable list
plus the current rate-limit metadata (`remaining`, `limit`, `reset`). No raw
JSON and no key are printed.

### `capture <eventId>`

```
node src/cli.mjs capture 123456
```

Fetches odds for exactly **Superbet** and **Stoiximan**
(`GET /v3/odds?eventId=...&bookmakers=Superbet,Stoiximan`), normalizes the
documented pre-match full-time markets into canonical selections, and writes a
sanitized CSV to `reports/`. The raw API response is not retained.

Normalized markets:

- Match result (`1`, `X`, `2`)
- Main totals (`OVER` / `UNDER`, exact line preserved)
- Both teams to score (`YES` / `NO`)
- Double Chance (`1X`, `12`, `X2`) — Stoiximan only

Superbet does not offer Double Chance, so it is never invented; downstream it is
reported as `NOT_APPLICABLE`, not as a failure.

Each row carries blank `siteOdds`, `siteObservedAt`, and `notes` columns for
**manual** entry of the Greek-site price and the moment it was observed.

### `evaluate <capture.csv>`

```
node src/cli.mjs evaluate reports/capture-123456-....csv
```

Reads a completed worksheet and reports metrics **independently for each
bookmaker + market stratum**. For every completed row it:

- rejects identity mismatches (bookmaker, event, kickoff, period, market, exact
  line, outcome must all match — `2.5` never matches `2.25`/`2.75`, and
  full-time never mixes with half-time/alternate periods);
- rejects observations whose site/API timestamps are more than **10 seconds**
  apart;
- classifies the price difference as `EXACT` (≤ 0.01), `ACCEPTABLE`
  (≤ 0.02 or implied-probability difference ≤ 0.5pp), or `LARGE_MISMATCH`
  (> 0.05);
- treats Superbet Double Chance as `NOT_APPLICABLE`.

A per-stratum summary CSV is written to `reports/`.

### `scan`

```
node src/cli.mjs scan [--edge=5]
```

Finds **positive-EV value bets** on upcoming FIFA World Cup matches by comparing
the bettable Greek-market books (**Stoiximan**, **Superbet** via Odds-API.io)
against **Pinnacle's de-vigged fair price** (via The Odds API). Requires both
keys in `.env.local`: `ODDS_API_IO_KEY` and `THE_ODDS_API_KEY`.

Flow: discover World Cup fixtures from The Odds API; match them to Odds-API.io
fixtures by kickoff + team name (national-team aliases handled); de-vig
Pinnacle's `1X2`/`Totals` prices to fair probabilities; compute each bettable
selection's `EV = offeredOdds × fairProbability − 1`; print alerts and write two
sanitized CSVs to `reports/`: `scan-<ts>.csv` (the value bets only, ranked by EV,
with columns `ev, tier, match, pick, bookmaker, odd, fairOdd, marketFair, books,
kickoffUtc`) and `scan-all-<ts>.csv` (every evaluated selection, for audit).

`fairOdd` is Pinnacle's de-vigged price (the EV anchor). `marketFair` is the
de-vigged **consensus** across all `eu` reference books, and `books` is how many
backed it — context to see whether Pinnacle is corroborated by the wider market.

EV confidence tiers (default floor 3%, override with `--edge=<percent>`):

- `VALUE` — **3%–5%**, the prime, most trustworthy band against a sharp anchor.
- `VALUE_CHECK` — **5%–15%**, flagged but verify line/timing first.
- `SUSPICIOUS` — **> ~15%**, almost always a stale/mismatched line or palpable
  error, **not** a stronger bet — surfaced with an explicit warning.

Only `1X2` and `Totals` (exact line) are scanned; selections Pinnacle does not
quote are `NO_REFERENCE` (skipped). Quota: one The Odds API `/odds` batch
(~2 credits of 500/month) plus one Odds-API.io `/odds/multi` request per 10
matched fixtures (so a full World Cup matchday is ~3 Odds-API.io requests).

The value model measures EV against Pinnacle's de-vigged line — it does **not**
assert that the Odds-API.io "Stoiximan"/"Superbet" prices equal the prices on
stoiximan.gr / superbet.gr (regional identity remains `UNVERIFIED`). No
scraping, no automation, no auto-betting; every alert carries a
verify-before-betting risk block.

### Paper ROI tracking

Every `scan` automatically records each unique value alert in
`reports/paper-bets.csv` as a paper bet with a fixed stake of **1 unit**.
Identity is `The Odds API event + bookmaker + market + exact line + outcome`,
so repeated scans do not duplicate or reprice the same bet. The first observed
odds, EV, tier, and timestamp are retained.

Settle completed bets with:

```text
node src/cli.mjs settle
```

`settle` requests World Cup scores for the previous three days, updates
`PENDING` bets to `WON`, `LOST`, `PUSH`, or `REVIEW`, and prints settled stake,
net paper profit, and realized ROI:

`ROI = settled paper profit / settled paper stake`

A win returns `odds - 1` units, a loss `-1`, and a push `0`. Pending and review
rows are excluded from ROI. The scores request costs 2 The Odds API credits
when `daysFrom=3`; unresolved bets older than three days require manual review.

This is paper-performance measurement, not proof of future profitability or an
authoritative bookmaker settlement record. The scores feed exposes an aggregate
soccer score but does not document whether knockout scores include extra time,
so those cases require caution.

## Manual worksheet workflow

1. `node src/cli.mjs events` — pick a fixture.
2. `node src/cli.mjs capture <eventId>` — generate the worksheet.
3. Open the bookmaker's Greece-facing site by hand, read each price, and fill in
   `siteOdds` and `siteObservedAt` (ISO 8601, within 10 seconds of the API
   receipt) for the selections you can match.
4. `node src/cli.mjs evaluate <worksheet.csv>` — read the stratified report.

The first run is an exploratory pilot (3–5 fixtures, one near-simultaneous
observation each). Pilot results are descriptive only; production pass criteria
require a much larger sample (see the design doc).

## Tests

```
npm test
```

Node's built-in test runner covers environment loading and key redaction,
normalization, identity and comparison metrics, CSV round-tripping, fixture-based
client requests, and the CLI commands. There are no live calls in the test
suite; live use is opt-in and quota-safe.

## Safety summary

- Key read only from `.env.local`; never printed, persisted, or placed in errors
  or URLs.
- No bookmaker-site scraping, automation, login, betting, or alerts.
- Raw API responses are not retained — only sanitized selections, timestamps,
  and comparison records.
- Regional identity remains `UNVERIFIED` pending explicit provider confirmation.
