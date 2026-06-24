# Paper ROI Tracking Design

## Goal

Extend the World Cup value-bet scanner with a persistent paper-bet ledger and
result settlement so its theoretical positive-EV alerts can be evaluated
against realized profit and return on investment.

Every newly discovered alert is treated as a paper bet with a fixed stake of
one unit. No real bet is placed and no bookmaker account is accessed.

## Decisions

- Track every alert automatically; the user does not manually select bets.
- Use a fixed paper stake of `1.00` unit per unique bet.
- Record a bet only once, even when later scans find it again.
- Keep the odds and model values from the first scan that found the bet.
- Store the ledger as CSV so it remains human-readable and easy to inspect in
  spreadsheet software.
- Start tracking with scans made after this feature is installed. Existing scan
  reports are not backfilled because they do not contain every stable identifier
  required for safe settlement.

## Official Scores API

The implementation uses:

`GET /v4/sports/soccer_fifa_world_cup/scores?daysFrom=3`

The official documentation states that:

- `daysFrom` accepts values from 1 to 3.
- A request with `daysFrom` costs 2 credits.
- Completed events include `completed: true` and team score entries.
- The event `id` matches the event `id` returned by the odds endpoint.
- Scores for completed events can only be retrieved for the previous three
  days on this endpoint.

Source:
<https://the-odds-api.com/liveapi/guides/v4/#get-scores>

The scores request uses the existing `THE_ODDS_API_KEY`. The key is never
written to the ledger, reports, output, or error messages.

## Ledger

The scanner maintains:

`provider-harness/reports/paper-bets.csv`

The file is rewritten from its parsed records after each scan or settlement.
The CLI is not designed for concurrent writers; simultaneous `scan` and
`settle` processes are unsupported.

### Columns

| Column | Meaning |
|---|---|
| `referenceEventId` | Stable The Odds API event ID used for settlement |
| `bettableEventId` | Odds-API.io event ID retained for audit |
| `firstSeenAt` | UTC timestamp of the scan that first found the bet |
| `kickoffUtc` | Scheduled UTC kickoff |
| `homeTeam` | Home team at detection time |
| `awayTeam` | Away team at detection time |
| `bookmaker` | Bettable bookmaker |
| `market` | `MATCH_RESULT` or `TOTALS` |
| `line` | Exact totals line; empty for match result |
| `outcome` | `1`, `X`, `2`, `OVER`, or `UNDER` |
| `decimalOdds` | First offered decimal price |
| `fairOdds` | First Pinnacle de-vigged fair price |
| `fairProbability` | First Pinnacle de-vigged fair probability |
| `ev` | First measured expected value as a decimal |
| `tier` | `VALUE`, `VALUE_CHECK`, or `SUSPICIOUS` |
| `stake` | Always `1.00` in this version |
| `status` | `PENDING`, `WON`, `LOST`, `PUSH`, or `REVIEW` |
| `homeScore` | Final home score when settled |
| `awayScore` | Final away score when settled |
| `profit` | Net paper profit in units |
| `settledAt` | Score provider's `last_update` when available |

Numeric fields use invariant decimal notation with `.` as the decimal
separator.

## Duplicate Policy

A paper bet is uniquely identified by:

`referenceEventId + bookmaker + market + line + outcome`

The same selection at a different bookmaker is a separate bet. Different
totals lines are separate bets. A later scan finding the same unique bet does
not change its odds, EV, tier, first-seen time, status, or profit.

This prevents scan frequency from artificially weighting the ROI.

## Scan Integration

After `scan` has built and ranked its opportunity list:

1. Read `paper-bets.csv`; an absent file means an empty ledger.
2. Convert each opportunity to a ledger row using the matched The Odds API
   event ID.
3. Add only rows whose unique key is not already present.
4. Write the complete ledger.
5. Print how many new paper bets were recorded and how many duplicate alerts
   were skipped.

All three confidence tiers are tracked, including `SUSPICIOUS`, because the
ledger is intended to measure the scanner's actual alert policy. Tier-level
performance can then expose whether high reported EV is mostly data noise.

A scan that finds no opportunities does not create a bet row.

## Settlement Command

Add:

```text
node src/cli.mjs settle
```

The command:

1. Loads the paper ledger.
2. Calls the World Cup scores endpoint with `daysFrom=3`.
3. Indexes completed score records by The Odds API event ID.
4. Settles only ledger rows currently in `PENDING`.
5. Rewrites the ledger with updated statuses, scores, profit, and settlement
   timestamp.
6. Prints the latest aggregate paper-performance summary and quota remaining.

Re-running `settle` is idempotent. Rows already in a terminal state are not
recalculated.

If the ledger does not yet exist or has no bets, the command prints a clear
message and does not spend scores quota.

## Settlement Rules

Only score records with all of the following are accepted:

- `completed === true`
- matching `referenceEventId`
- one finite numeric score for the stored home team
- one finite numeric score for the stored away team

Team scores are mapped by team name, not by array position.

### Match Result

- `1`: `WON` when home score is greater; otherwise `LOST`.
- `X`: `WON` when scores are equal; otherwise `LOST`.
- `2`: `WON` when away score is greater; otherwise `LOST`.

### Totals

Let `total = homeScore + awayScore`.

- `OVER`: won when `total > line`, lost when `total < line`.
- `UNDER`: won when `total < line`, lost when `total > line`.
- Equality with an integer or whole-goal line is `PUSH`.

The current scanner compares exact lines and does not support split Asian
quarter lines. If an existing or future ledger row has a non-integer
quarter-line such as `2.25` or `2.75`, it is marked `REVIEW` rather than
incorrectly applying full-win/full-loss settlement.

### Profit

For the fixed one-unit stake:

- `WON`: `decimalOdds - 1`
- `LOST`: `-1`
- `PUSH`: `0`
- `PENDING` or `REVIEW`: blank profit

## ROI Summary

The summary includes:

- total recorded bets
- pending bets
- settled bets
- wins, losses, and pushes
- review-required bets
- settled stake
- net profit in units
- realized ROI

`settled stake` is the sum of stakes for `WON`, `LOST`, and `PUSH` rows.

`realized ROI = total settled profit / total settled stake`

`REVIEW` and `PENDING` rows are excluded from both profit and denominator.
When settled stake is zero, ROI is displayed as unavailable rather than zero.

## Missing and Stale Results

A pending row remains unchanged when:

- its event is not returned,
- the event is not completed,
- scores are absent or malformed, or
- team names cannot be mapped safely.

After settlement, the command warns when a pending bet's kickoff is more than
three days old. The free scores window can no longer resolve that row
automatically. It is not silently counted as a loss or excluded from the
ledger.

## Soccer Period Limitation

The official scores documentation exposes one aggregate score per team but
does not document whether soccer scores after knockout matches represent
90 minutes only or include extra time. The scanner's `MATCH_RESULT` and
`TOTALS` markets are full-time betting markets.

Therefore the ledger is paper-performance evidence, not an authoritative
bookmaker settlement record. Any completed knockout event known to have gone
to extra time must be treated as `REVIEW` until the provider's soccer period
semantics are confirmed or a period-level result source is added. This
limitation is documented in CLI output and the README.

## Architecture

### `src/theodds_client.mjs`

Add `getScores({ sportKey, daysFrom = 3 })`, reusing the existing request,
quota parsing, and redacted error handling.

### `src/paper.mjs`

Own the pure paper-bet domain logic:

- stable unique-key construction
- opportunity-to-ledger conversion
- deduplicating new opportunities
- score validation and settlement
- profit calculation
- aggregate ROI summary
- stale-pending detection

The module performs no network or filesystem access.

### `src/cli.mjs`

- Extend `scan` to read, merge, and write the paper ledger.
- Add the `settle` command and user-facing summary.
- Inject filesystem and API dependencies through existing CLI patterns so
  tests use local temporary directories and fake clients.

### `src/csv.mjs`

Reuse `readCsv` and `writeCsv`. No new storage dependency or database is added.

## Error Handling

- API failures propagate through the existing sanitized CLI error path.
- A malformed ledger row produces a clear validation error rather than being
  silently modified.
- The ledger is written only after all in-memory merge or settlement work
  succeeds.
- No API response body or secret-bearing request URL is persisted.
- Unknown markets or outcomes are marked `REVIEW`; they are never guessed.

## Testing Strategy

Implementation follows test-driven development.

### Client tests

- Scores endpoint path and `daysFrom=3`.
- Quota headers.
- API key redaction on failure.

### Paper-domain tests

- Unique key includes event, bookmaker, market, line, and outcome.
- Duplicate alerts retain the first observed odds and model values.
- Same selection at different books remains separate.
- Match-result home, draw, and away settlement.
- Totals over, under, push, and unsupported quarter-line review.
- Win, loss, and push profit.
- Pending behavior for incomplete, missing, or malformed score records.
- ROI denominator includes wins, losses, and pushes but excludes pending and
  review rows.
- Stale pending detection.

### CLI tests

- `scan` creates the ledger and reports new paper bets.
- A repeated scan does not duplicate bets.
- `settle` updates completed bets and prints P/L and ROI.
- Empty ledger avoids an API call.
- Repeated settlement is idempotent.
- Neither API key appears in output or ledger files.

No test performs a live API call.

## Documentation

Update `provider-harness/README.md` with:

- automatic paper tracking behavior
- the `settle` command
- fixed one-unit stake and duplicate policy
- settlement and ROI formulas
- scores quota and three-day retrieval window
- extra-time/period limitation
- explicit statement that paper results are not proof of future profitability

## Out of Scope

- Real-money bet placement or bookmaker integration.
- Variable stakes, bankroll sizing, Kelly staking, or manual bet selection.
- Importing bets placed outside the scanner.
- Backfilling existing scan CSVs.
- Paid historical scores or historical-odds backtesting.
- Database storage, concurrent ledger writers, dashboards, charts, or external
  notifications.
- Automatic resolution of postponed, abandoned, voided, or extra-time-specific
  bookmaker rules.
