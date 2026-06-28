# Operations

This project is a research and decision-support harness. It must not place bets,
enable real staking, or send production alerts unless the model gates explicitly
allow it.

## Daily Command Set

Run these from `provider-harness`:

```powershell
node src/cli.mjs data-health
node src/cli.mjs profitability-report
node src/cli.mjs calibration-report
node src/cli.mjs staking-sim --bankroll=1000 --policy=kelly25 --max-stake=100 --daily-exposure-pct=5
node src/cli.mjs profit-engine
node src/cli.mjs daily-decision-report
```

Read `reports/daily-decision-report.md` first. It summarizes the current mode,
blockers, live status, and next actions.

## Scheduled Tasks

Expected local Windows scheduled tasks:

| Task | Purpose |
| --- | --- |
| `Bet-Paper-Scan` | Collect forward paper VALUE/CONTROL candidates. |
| `Bet-Paper-CLV` | Run `clv --window-minutes=40` frequently near kickoff. |
| `Bet-Paper-Settle` | Settle paper rows after results become available. |
| `Bet-Mispricing-Scanner` | Research scanner path; no auto-betting. |
| `Bet-Mispricing-CLV` | CLV capture for sent research alerts. |
| `Bet-Live-Shadow` | Odds-API.io live diagnostic feed. |

If live shadow produces only `welcome` rows and no market messages, treat it as
diagnostic-only and use `live-updated-poll` for fallback measurement. The daily
report distinguishes:

- `fallbackRecommended=true`: WebSocket is observed but has no market messages
  and no `/odds/updated` fallback rows exist yet.
- `fallbackActive=true`: `/odds/updated` has produced feed or training rows.

## Report Meanings

| Report | Meaning |
| --- | --- |
| `data-health.csv/json` | Offline ledger integrity checks and sample-quality warnings. |
| `profitability-report.csv/json` | VALUE vs CONTROL ROI/CLV by segment and readiness gates. |
| `calibration-report.csv/json` | EV bucket calibration, CLV confidence, and monotonicity. |
| `staking-sim.csv/json` | Paper-only bankroll simulation; never enables real staking. |
| `profit-engine-report.csv/json` | Conservative combined readiness, live, liquidity, and staking diagnostics. |
| `daily-decision-report.md/json` | Human-readable daily status and next actions. |

## Warning Policy

- `ERROR` in `data-health` blocks production readiness.
- `WARN` means review before trusting segment-level metrics.
- `INFO` is usually a scope warning, such as non-primary markets being excluded
  from h2h readiness.
- `LIVE_WS_HAS_NO_MARKET_MESSAGES` means the WebSocket is not usable for live
  training or staking.
- `LIVE_UPDATED_POLL_FALLBACK_RECOMMENDED` means run `live-updated-poll` if live
  measurement is still needed.
- `VALUE_MATCH_RESULT_*_BELOW_200` means h2h sample is still research-only.

## Staking Simulation Policy

`staking-sim` is research-only. Use it to compare flat staking with capped
fractional Kelly, daily exposure, market exposure, bookmaker exposure, drawdown,
and bootstrap-style risk diagnostics.

Recommended research command:

```powershell
node src/cli.mjs staking-sim --bankroll=1000 --policy=kelly25 --max-stake=100 --daily-exposure-pct=5
```

Supported policies:

| Policy | Meaning |
| --- | --- |
| `flat` | Fixed stake equal to `--max-stake`. |
| `flat_pct` | 1% bankroll stake capped by `--max-stake`. |
| `kelly10` | 10% fractional Kelly capped by `--max-stake`. |
| `kelly25` | 25% fractional Kelly capped by `--max-stake`. |

The daily exposure cap is enforced per `firstSeenAt` date. It limits simulated
stake volume; it does not approve live staking.

## Live Fallback Command

When `daily-decision-report` includes `RUN_LIVE_UPDATED_POLL_FALLBACK`, run:

```powershell
node src/cli.mjs live-updated-poll --sport=Football --bookmakers=Stoiximan,Novibet --markets=ML,Totals --interval-seconds=45 --duration-minutes=30
```

Fallback rows are marked with `source=updated_poll` in
`reports/live-training-observations.csv`.

## Credit Spending Policy

- CLV capture is the highest-value recurring spend because it measures whether
  the model beats the close.
- Historical spend is allowed only with explicit credit caps and reserve guards.
- Historical odds are fair-probability calibration evidence, not a direct
  Stoiximan/Novibet soft-book backtest.
- Avoid broad extra-market sweeps unless the market already has a clear research
  question and a credit cap.

## Production Readiness

The default mode is `RESEARCH_ONLY`. Moving beyond it requires:

- primary h2h VALUE CLV sample at least 200;
- primary h2h VALUE settled sample at least 200;
- comparable CONTROL sample at least 200;
- positive VALUE/CONTROL CLV separation;
- acceptable ROI confidence and drawdown simulation;
- clean or explained `data-health` errors;
- measured live/liquidity evidence if live betting is considered.
