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
node src/cli.mjs staking-sim --bankroll=1000 --policy=flat --max-stake=10
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
diagnostic-only and use `live-updated-poll` for fallback measurement.

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
- `VALUE_MATCH_RESULT_*_BELOW_200` means h2h sample is still research-only.

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
