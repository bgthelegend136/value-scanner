# Multi-Sport Mispricing Telegram Alerts — Design

## Goal

Add a separate `mispricing-scan` mode that searches Stoiximan and Superbet for
large pre-match pricing errors across every sport exposed by the existing data
providers.

An alert is actionable only when the offered price has **strictly more than
20.0% expected value** against both:

1. Pinnacle's independently de-vigged price; and
2. a median consensus built from at least three other international
   bookmakers.

Confirmed opportunities are sent to the user's Telegram chat at scheduled scan
times. The system never places a bet.

## Branch and Isolation

Development happens in the isolated worktree:

`C:\Users\bgthe\Documents\bet\.worktrees\multisport-mispricing-alerts`

on branch:

`codex/multisport-mispricing-alerts`

The existing World Cup `scan`, paper ROI, CLV, and boost behavior remains
unchanged.

## Scope

### Sports

- All active sports and competitions for which Odds-API.io exposes a
  Stoiximan or Superbet candidate.
- A candidate is skipped when it cannot be mapped confidently to a sport and
  event in The Odds API.
- Outrights, futures, racing fields, and non-event markets are excluded from
  the first version.

### Markets

Only full-event, pre-match featured markets are supported:

- `MATCH_RESULT`: moneyline/head-to-head, including the draw for sports that
  offer one.
- `TOTALS`: the main full-event Over/Under line.

Spreads, handicaps, props, period markets, player markets, alternate totals,
live markets, and combinations are excluded.

For totals, the Odds-API.io candidate line must exactly equal the featured
`totals` line returned for Pinnacle and the consensus bookmakers. A line that
cannot be confirmed as the same featured line is rejected rather than guessed.

## Data Sources

### Candidate source: Odds-API.io

Use the provider's `value-bets` endpoint separately for Stoiximan and Superbet,
including event details and direct-link fields when supplied.

This stage is a cost-saving candidate filter only. Odds-API.io's pre-calculated
EV is never sufficient for a Telegram alert.

Candidate filters:

- bookmaker is exactly `Stoiximan` or `Superbet`;
- event is pre-match and has not started;
- market normalizes to `MATCH_RESULT` or `TOTALS`;
- provider EV is at least 20% so that final strict filtering can be applied
  locally;
- required event, selection, odds, sport, and timestamp fields are present.

If the authenticated Odds-API.io plan does not permit the `value-bets`
endpoint, the command fails closed and reports the missing capability. It must
not fall back to sending alerts from an unverified or partial calculation.

### Independent confirmation: The Odds API

For selected candidate sport keys, fetch `h2h,totals` odds for the `eu` region.
The response must contain:

- Pinnacle;
- the exact event;
- the exact market, outcome, and totals line;
- at least three additional complete international bookmaker markets.

Pinnacle and consensus calculations use only complete markets that can be
de-vigged. Stoiximan and Superbet are excluded from the international
consensus, and Pinnacle is kept separate from it.

## Candidate-First Architecture

Each scheduled run performs these stages:

1. Fetch Stoiximan and Superbet candidate value bets from Odds-API.io.
2. Normalize event, market, outcome, line, offered odds, timestamps, and links.
3. Reject unsupported, live, malformed, stale, or already-started candidates.
4. Group candidates by mapped The Odds API sport key.
5. Merge them with the persistent verification queue.
6. Rank sport groups by:
   - highest candidate EV;
   - nearest kickoff;
   - oldest queued group.
7. Verify at most two The Odds API sport keys in the current run.
8. Match events and exact selections across providers.
9. Calculate Pinnacle and international-consensus EV independently.
10. Apply freshness, confirmation, and deduplication rules.
11. Send confirmed Telegram alerts and write audit records.
12. Retain unprocessed or temporarily unverifiable candidates for a later run,
    unless they expire or their event starts.

The queue prevents a high-candidate-volume scan from exceeding the monthly
reference-data budget.

## Multi-Sport Mapping and Event Matching

Create an explicit mapping layer between:

- Odds-API.io sport and league identifiers; and
- The Odds API active sport keys.

Mappings are configuration data, not fuzzy guesses. New mappings can be added
without changing EV logic.

Within a mapped sport key, event matching requires:

- participant names equal after normalization and known aliases;
- participant orientation equal when home/away exists;
- kickoff times within a sport-specific tolerance;
- no second equally plausible event.

Individual sports may use different participant shapes:

- team sports: home and away teams;
- head-to-head sports such as tennis: player one and player two;
- draw-capable sports: two participants plus draw outcome.

Ambiguous or unsupported event shapes are recorded as rejected candidates.

## Fair Probability and Confirmation

### Pinnacle

For the exact market group:

1. Convert each Pinnacle decimal price to implied probability.
2. Apply the existing power-method de-vig to the complete market.
3. Select the fair probability for the candidate outcome.
4. Calculate:

   `pinnacleEv = offeredOdds * pinnacleFairProbability - 1`

### International consensus

For each eligible international bookmaker:

1. Require a complete exact market.
2. De-vig that bookmaker independently with the power method.
3. Extract the candidate outcome's fair probability.

The consensus fair probability is the median of those probabilities. At least
three bookmakers are required.

Calculate:

`consensusEv = offeredOdds * consensusFairProbability - 1`

### Final alert rule

A candidate is confirmed only when all conditions hold:

- `pinnacleEv > 0.20`;
- `consensusEv > 0.20`;
- Pinnacle is present and has a complete exact market;
- at least three other international bookmakers support the consensus;
- exact market, outcome, period, and totals line match;
- candidate and reference data pass freshness checks;
- kickoff is still in the future.

Exactly 20.0% is not enough.

## Freshness and Fail-Closed Rules

- Use provider timestamps where available.
- Reject a candidate if its value timestamp is more than 10 minutes old when
  scanned.
- Reject a reference bookmaker quote if its latest market timestamp is more
  than 10 minutes old.
- Do not alert when timestamps are absent or invalid.
- Do not alert after kickoff.
- Do not extrapolate missing selections, totals lines, draw outcomes, or
  bookmaker prices.
- A provider error, mapping failure, incomplete market, stale quote, or quota
  guard produces no betting alert.

These thresholds are configuration constants with conservative defaults, not
CLI options in the first version.

## Quota Control

The Odds API charges one credit per region per market. One sport-key
confirmation for `eu` and `h2h,totals` costs up to two credits.

Budget:

- maximum two sport keys per run;
- maximum four The Odds API credits per run;
- three runs per day;
- approximately 360 credits in a 30-day month;
- reserve at least 100 of the 500 monthly credits for existing/manual tools and
  error margin.

The command reads response quota headers before continuing. It stops additional
confirmations when the configured reserve would be crossed. Queued candidates
remain for a later run if still valid.

## Telegram Alert

Secrets are loaded from the repository-root `.env.local`:

- `TELEGRAM_BOT_TOKEN`;
- `TELEGRAM_CHAT_ID`.

They are never printed, stored in reports, included in errors, or committed.

Each confirmed alert contains:

- sport and competition;
- participants/event;
- kickoff in `Europe/Athens`;
- Stoiximan or Superbet;
- exact market, outcome, and totals line when applicable;
- offered decimal odds;
- Pinnacle fair odds and EV;
- international median fair odds, EV, and bookmaker count;
- source freshness time;
- a manual-verification warning.

Example structure:

```text
🚨 CONFIRMED MISPRICING >20%

Sport: Basketball — EuroLeague
Event: Team A vs Team B
Start: 25/06/2026 21:30 Greece
Book: Stoiximan
Pick: Over 162.5
Offered: 2.40

Pinnacle fair: 1.91 | EV: +25.7%
Consensus fair: 1.95 | EV: +23.1% | 6 books

Verify the displayed price and exact market before betting.
```

## Bookmaker Deep Links

The Telegram message includes one inline button:

- `Open in Stoiximan`, or
- `Open in Superbet`.

Choose the deepest provider-supplied HTTPS link in this order:

1. exact outcome/betslip link;
2. exact market link;
3. event link.

The message states when the link opens only the event and repeats the exact
selection the user must find manually.

The system does not fabricate bookmaker URLs, scrape bookmaker pages, log in,
or automate bet placement. Links are accepted only when they use HTTPS and
match an allowlisted Stoiximan or Superbet domain. Invalid or unavailable links
produce an alert without a button.

## Deduplication and State

Persist state under `provider-harness/reports/`, which is git-ignored:

- `mispricing-queue.csv`: pending sport groups/candidates;
- `mispricing-alerts.csv`: sent alerts;
- `mispricing-audit.csv`: confirmed, rejected, expired, deferred, and errored
  candidates;
- `mispricing-health.json`: consecutive provider and Telegram failures.

Alert identity includes:

- provider event identity;
- bookmaker;
- market;
- exact line;
- outcome.

Send one initial alert per identity. Send an update only when the smaller of
`pinnacleEv` and `consensusEv` has increased by at least five percentage points
since the last successful alert. This captures meaningful price improvements
without repeated messages on every scheduled run.

Telegram delivery is recorded as sent only after the API confirms success. A
failed send remains retryable without creating duplicate successful records.

## Scheduling

Install one Windows Task Scheduler task with three daily triggers:

- 09:00;
- 15:00;
- 21:00;

using the Windows local timezone (`Europe/Athens` behavior, including daylight
saving changes).

Task settings:

- run `node src/cli.mjs mispricing-scan` from `provider-harness`;
- start as soon as possible after a missed scheduled start;
- do not start a second instance while one is running;
- wake the computer to run when Windows permits;
- write stdout/stderr to a local rotating log;
- no interactive window is required.

The computer must be powered on and have network access. This is not a cloud
service.

## Failure Handling

- Odds-API.io failure: no candidates or betting alerts; increment health
  counter.
- The Odds API failure: affected candidates stay queued; no unconfirmed alert.
- Quota reserve reached: stop confirmation cleanly and defer remaining groups.
- Telegram failure: retain an unsent delivery record and retry next run.
- CSV/state corruption: stop before sending, preserve the original file, and
  report the error.
- After three consecutive provider-level failed runs, send one Telegram health
  warning if Telegram is operational.
- If Telegram itself is unavailable, record the health failure locally; it
  cannot notify through the failed channel.
- A later successful run resets the corresponding consecutive-failure counter.

## CLI

New command:

```powershell
node src/cli.mjs mispricing-scan
```

Supporting setup and diagnostics:

```powershell
node src/cli.mjs telegram-test
node src/cli.mjs mispricing-scan --dry-run
```

`--dry-run` performs candidate discovery and verification but sends no Telegram
message and does not mark an alert as delivered. It still writes a clearly
labelled audit report.

No threshold override is exposed initially; the strict 20% rule is part of this
mode's contract.

## Components

Keep modules independently testable:

- `src/value_bets_client.mjs`: Odds-API.io candidate endpoint.
- `src/multisport_map.mjs`: explicit sport/league mapping.
- `src/mispricing_normalize.mjs`: candidate normalization.
- `src/mispricing_match.mjs`: multi-sport event and selection matching.
- `src/mispricing_confirm.mjs`: Pinnacle and median-consensus calculations.
- `src/mispricing_state.mjs`: queue, audit, health, and deduplication state.
- `src/telegram.mjs`: Telegram API client, formatting, and safe inline button.
- `src/scheduler.mjs` or a PowerShell installer script: idempotent Task
  Scheduler registration.
- `src/cli.mjs`: orchestration only.

Reuse existing environment loading, CSV support, HTTP redaction patterns,
normalizers where compatible, and power de-vig logic.

## Testing

Implementation follows test-driven development.

Required automated coverage:

- Odds-API.io value-bet request parameters and secret redaction;
- Stoiximan and Superbet candidate normalization;
- supported and rejected market types;
- broad sport mapping fixtures;
- team and player event matching;
- ambiguity and kickoff mismatch rejection;
- exact totals-line enforcement;
- power de-vig and median consensus;
- strict `>20%` boundary for both benchmarks;
- minimum three-book consensus;
- stale/missing timestamp rejection;
- quota reserve and two-sport-key cap;
- queue ordering, expiry, and persistence;
- deduplication and five-percentage-point update rule;
- Telegram escaping, formatting, API failure handling, and secret redaction;
- exact-selection, market, and event-link fallback;
- HTTPS/domain allowlist;
- dry-run behavior;
- CLI orchestration with injected fake providers;
- scheduler installer idempotence and three expected triggers.

Tests use fixtures and injected clients. They make no live provider or Telegram
calls.

## Activation and Verification

Before enabling the scheduled task:

1. Run the full existing and new automated test suite.
2. Confirm the Odds-API.io account can access `value-bets` for both target
   bookmakers.
3. Run `telegram-test` and confirm receipt.
4. Run one `mispricing-scan --dry-run`.
5. Inspect quota consumption, queue, audit rows, matching, and link safety.
6. Run one manual live `mispricing-scan`.
7. Confirm no duplicate Telegram delivery.
8. Install the Task Scheduler task and inspect all three triggers.

## Non-Goals

- No guaranteed-profit claim.
- No automatic staking or bet placement.
- No bookmaker login, browser automation, or scraping.
- No live/in-play alerts.
- No unsupported or approximate market matching.
- No alert based solely on Odds-API.io's calculated EV.
- No expansion to props, spreads, alternate lines, periods, or outrights in
  this version.

## Reference Documentation

- The Odds API v4 documentation and quota formula:
  <https://the-odds-api.com/liveapi/guides/v4/>
- The Odds API bookmaker deep links:
  <https://the-odds-api.com/releases/deep-links.html>
- Odds-API.io value-bets guide:
  <https://docs.odds-api.io/examples/finding-value-bets>
- Odds-API.io value-bets endpoint:
  <https://docs.odds-api.io/api-reference/value-bets/get-value-bets>
