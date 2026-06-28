# Model Gates

The harness separates promising research evidence from actionable betting
evidence. These gates are intentionally conservative.

## Primary Universe

Primary model universe:

```text
MATCH_RESULT / h2h
```

`TOTALS`, `BTTS`, `DRAW_NO_BET`, and `DOUBLE_CHANCE` are reported separately and
must not influence primary h2h readiness.

## Readiness Thresholds

| Gate | Default |
| --- | --- |
| VALUE h2h CLV sample | `>= 200` |
| VALUE h2h settled sample | `>= 200` |
| CONTROL h2h settled sample | `>= 200` |
| VALUE average CLV | `> 0` |
| VALUE vs CONTROL CLV separation | VALUE must be materially better |
| Data health | no unexplained `ERROR` rows |
| Live evidence | required only for live/staking decisions |
| Staking | simulation-only until all evidence gates pass |

## Current Modes

| Mode | Meaning |
| --- | --- |
| `RESEARCH_ONLY` | Data collection and offline analysis only. |
| `PAPER_READY` | Paper edge has enough evidence for stronger monitoring, not real stakes. |
| `ALERT_READY` | Alerts may be considered only with The Odds API confirmation gates. |
| `STAKING_READY` | Requires paper, CLV, ROI, drawdown, liquidity, and operational gates. |

No command in the current roadmap enables real-money staking.

## Why The Gates Exist

- ROI has high variance at small samples.
- CLV is a faster leading indicator but can still be biased by stale captures or
  duplicated selections.
- CONTROL comparison prevents mistaking broad market drift for model edge.
- Event-level dedupe prevents one match from pretending to be many independent
  samples.
- Live WebSocket output is not useful until it emits real market messages.

## What Can Change A Gate

A threshold can be changed only after:

- `calibration-report` shows stable EV/CLV ordering;
- `profitability-report` shows segment-level VALUE superiority;
- `staking-sim` shows acceptable drawdown and ruin risk;
- `data-health` issues are fixed or explicitly accepted;
- the change is recorded in `docs/PROJECT-PROGRESS-DECISIONS.md` with evidence.
