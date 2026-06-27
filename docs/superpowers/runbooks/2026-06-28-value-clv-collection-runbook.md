# VALUE CLV Collection Runbook - 2026-06-28

## Objective

Reach 200-300 VALUE selections with captured CLV without weakening data
quality. The main model score remains `MATCH_RESULT` / `h2h`. `TOTALS`,
`DRAW_NO_BET`, `BTTS`, and `DOUBLE_CHANCE` stay in separate research buckets
until each market earns its own CLV evidence.

This runbook is for the short remaining Codex window and for manual operation
between Codex sessions. It intentionally avoids new production rules, Telegram
threshold changes, staking changes, or live-betting changes.

## Current Baseline

Latest read-only reports before this runbook:

| Metric | Count |
| --- | ---: |
| VALUE CLV captured | 86 |
| Main `MATCH_RESULT` VALUE CLV captured | 83 |
| VALUE pending without CLV | 38 |
| CONTROL CLV captured | 311 |
| Missing VALUE CLV to 200 | 114 |
| Missing VALUE CLV to 300 | 214 |

Latest signal summary:

| Segment | Avg CLV |
| --- | ---: |
| VALUE | +2.18% |
| CONTROL | -1.88% |

Investor interpretation: VALUE is still beating CONTROL. That is the signal we
are trying to validate with more forward samples. ROI remains secondary until
the sample is much larger.

## Collection Cycle

Run commands from:

```powershell
cd C:\Users\bgthe\Documents\bet\provider-harness
```

### 1. Main h2h Sweep

Use this for clean volume across supported sports without US-style markets:

```powershell
node src/cli.mjs theodds-sweep --edge=0 --sample-min-ev=-5 --sample-limit=300 --max-sports=20 --markets=h2h --regions=eu
```

### 2. Soccer-Core Exploratory Sweep

Use this sparingly to measure soccer-specific extra-market coverage:

```powershell
node src/cli.mjs theodds-sweep --market-profile=soccer-core --edge=0 --sample-min-ev=-5 --sample-limit=150 --max-sports=12 --event-limit=6 --max-event-credits=250
```

This may spend The Odds API credits. It is capped by `--max-event-credits=250`.
Do not run it repeatedly if coverage diagnostics show `NO_MARKET` or
`TOO_FEW_BOOKS` for the extra soccer markets.

### 3. CLV Capture

Use this often when events are near kickoff:

```powershell
node src/cli.mjs clv --window-minutes=40
```

Priority is higher than new sweeps. A VALUE row without captured CLV is much
less useful for the forward calibration target.

### 4. Status Reports

These are offline reports and should not spend API credits:

```powershell
node src/cli.mjs clv-calibrate
node src/cli.mjs research-status
```

## Cadence

For the next day of collection:

| Task | Cadence |
| --- | --- |
| `clv --window-minutes=40` | Every 10-20 minutes when fixtures are near kickoff |
| Main `h2h` sweep | Every 2-3 hours while there are active events |
| Soccer-core exploratory sweep | 1-2 times total, capped, only to inspect coverage |
| `research-status` | After every 2-3 sweeps |
| `clv-calibrate` | At the start and end of each collection block |

If attention is limited, use this priority order:

1. `clv --window-minutes=40`
2. `research-status`
3. Main `h2h` sweep
4. Soccer-core exploratory sweep

## Decision Rules

Continue collection if:

- VALUE average CLV stays positive.
- CONTROL average CLV stays negative or near zero.
- The `0..5% EV` range remains positive.
- Main `MATCH_RESULT` continues to beat `TOTALS`.
- Unique VALUE selections rise, not only duplicate raw rows.

Reduce aggressiveness or stop that path if:

- VALUE average CLV falls below `+0.5%`.
- CONTROL becomes consistently positive, which may mean general market drift
  instead of model skill.
- `TOTALS` remains negative; it stays out of the main score.
- Soccer-core coverage remains mostly `NO_MARKET` or `TOO_FEW_BOOKS`; do not
  spend more credits there today.

Do not change yet:

- Telegram thresholds.
- Live betting rules.
- Stake sizing.
- Production alert scope.

## What To Inspect After Each Run

In `research-status`, focus on:

- `overall all valueClvCaptured`
- `main MATCH_RESULT valueClvCaptured`
- `overall all valuePending`
- `missingValueClvTo200`
- `missingValueClvTo300`
- `uniqueSelectionCount`

In `clv-calibrate`, focus on:

- VALUE vs CONTROL average CLV.
- `main:MATCH_RESULT` average CLV.
- `market:TOTALS` separately, never folded into the main score.
- Low-sample warnings for any market with `n < 50`.
- The `0..2%` and `2..5%` EV buckets.

In soccer-core coverage CSVs, focus on:

- `HAS_VALUE`: market has coverage and at least one qualifying value row.
- `NO_VALUE`: market exists but did not clear value filters.
- `TOO_FEW_BOOKS`: coverage exists but consensus is too thin.
- `NO_MARKET`: The Odds API did not expose the market for those events/books.

## Next Checkpoint Targets

Before changing thresholds or Telegram aggressiveness, target:

| Metric | Next checkpoint |
| --- | ---: |
| VALUE CLV captured | 120+ |
| Main `MATCH_RESULT` VALUE CLV captured | 115+ |
| VALUE CLV captured before threshold changes | 200+ |
| Stronger decision target | 300+ |

The key question is not "did ROI win today?" The key question is whether VALUE
continues to separate from CONTROL in CLV as the forward sample grows.

## Next Codex Window Checklist

1. Run `node src/cli.mjs clv-calibrate`.
2. Run `node src/cli.mjs research-status`.
3. Compare VALUE, CONTROL, `main:MATCH_RESULT`, and `market:TOTALS`.
4. Inspect the newest soccer-core coverage CSV if one exists.
5. Decide whether another capped 300-600 The Odds API credit block is justified.
6. Update `HANDOFF-CODEX.md` and the daily worklog with exact counts.

