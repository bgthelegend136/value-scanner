# Odds-API.io Regional Validation Harness Design

## Goal

Build a small local harness that helps determine whether Odds-API.io prices for
Superbet and Stoiximan correspond to prices visible on their Greece-facing
websites.

## Scope

- Fetch upcoming football events from Odds-API.io.
- Fetch odds for one selected event from Superbet and Stoiximan.
- Normalize pre-match, full-time selections for:
  - match result (`1`, `X`, `2`);
  - main totals (`Over`, `Under`, exact line);
  - both teams to score (`Yes`, `No`);
  - Double Chance for Stoiximan only.
- Record API quote timestamps and local receipt timestamps.
- Produce a manual-entry worksheet in CSV form for Greek-site prices and
  observation timestamps.
- Evaluate completed observations separately by bookmaker and market.

## Safety and Data Handling

- Read the API key only from `.env.local`.
- Never print, persist, or include the key in request errors.
- Do not automate, scrape, log into, or place bets on bookmaker websites.
- Do not generate actionable alerts.
- Do not retain full raw API responses by default.
- Retain sanitized event, selection, timestamp, and comparison records only.

## Identity Rules

The canonical comparison key is:

`bookmaker + event ID + kickoff UTC + home + away + full-time period + market + line + outcome`

Exact lines must match; `2.5` must not match `2.25` or `2.75`. Full-time markets
must not be mixed with first-half, second-half, extra-time, or alternate-period
markets. Missing Superbet Double Chance is `NOT_APPLICABLE`, not a failure.

Bookmaker names alone do not prove Greek regional identity. The harness tests
price behavior and records the result as evidence, while regional identity
remains `UNVERIFIED` until the provider supplies an explicit feed identifier or
written human confirmation.

## Pilot Protocol

The first run is exploratory:

- 3–5 fixtures;
- match result, main totals, and BTTS for both books;
- Double Chance for Stoiximan when present;
- one near-simultaneous observation per fixture;
- Greek-site observation and API receipt no more than 10 seconds apart.

If the pilot works, expand to the defensible protocol suggested during review:
20 fixtures per bookmaker, at least three competitions and three days, with
snapshots around 24 hours, 2 hours, and 15–30 minutes before kickoff.

## Evaluation

Report metrics independently for each bookmaker-market stratum:

- exact/tick match: absolute decimal-odds difference `<= 0.01`;
- acceptable match: difference `<= 0.02` or implied-probability difference
  `<= 0.5` percentage points;
- large mismatch: difference `> 0.05`;
- missing selection coverage;
- mean signed implied-probability difference.

Pilot results are descriptive. Production pass criteria require a larger sample:

- at least 90% exact/tick matches;
- at least 97% acceptable matches;
- no more than 1% large mismatches;
- at least 95% eligible selection coverage.

## Architecture

Use Node.js 22 with no runtime dependencies:

- `src/env.mjs`: load the ignored local environment file.
- `src/client.mjs`: documented Odds-API.io HTTP calls and rate-limit metadata.
- `src/normalize.mjs`: convert provider markets into canonical selections.
- `src/compare.mjs`: validate manual observations and calculate metrics.
- `src/csv.mjs`: deterministic CSV read/write helpers.
- `src/cli.mjs`: `events`, `capture`, and `evaluate` commands.

Node's built-in test runner covers normalization, identity, comparison,
redaction, and fixture-based API response handling. Live tests are opt-in and
quota-safe.

