# Project Progress and Decision Log

Last updated: 2026-06-28 12:43 Europe/Athens

This is the durable progress and decision log for the betting research harness.
Every future strategic change should update this file with the evidence used,
the decision taken, and the reason for that decision.

## Mission

Detect bookmaker pricing mistakes on Stoiximan and Novibet, independently
confirm them against sharp reference odds, and send only strictly confirmed
manual-betting alerts. The human places any bet manually. There is no
auto-betting.

The production alert rule remains narrow:

- Target books: Stoiximan and Novibet.
- Production alert market: MATCH_RESULT.
- Confirmation: The Odds API reference, including Pinnacle fair probability and
  multi-book consensus.
- Alert floor: 10% confirmed EV.
- If reference coverage is missing or thin, send nothing.

## Current Evidence Snapshot

Fresh local diagnostics were run on 2026-06-28 at about 12:43 Europe/Athens:

```powershell
node src/cli.mjs clv-calibrate
node src/cli.mjs research-status
node src/cli.mjs profit-engine
```

Latest core metrics:

| Metric | Current |
| --- | ---: |
| Paper rows | 1193 |
| Unique selection count | 978 |
| Total captured CLV rows | 627 |
| VALUE CLV captured | 122 |
| Main MATCH_RESULT VALUE CLV captured | 119 |
| VALUE pending without CLV | 83 |
| CONTROL CLV captured | 505 |
| Missing VALUE CLV to 200 | 78 |
| Missing VALUE CLV to 300 | 178 |
| Settled paper rows | 289 |
| VALUE-tier settled rows | 69 |
| Paper ROI | -0.93% |
| Profit engine readiness | RESEARCH_ONLY |

Latest signal metrics:

| Segment | Current |
| --- | ---: |
| VALUE average CLV | +1.66% |
| CONTROL average CLV | -2.12% |
| Main VALUE MATCH_RESULT average CLV | +1.92% |
| CLV regression slope | +0.9972 |
| CLV regression R-squared | 0.2346 |
| 0..2% EV bucket average CLV | +0.69% |
| 2..5% EV bucket average CLV | +3.74% |
| TOTALS average CLV | -3.22% |

Latest settled ROI by tier:

| Segment | Settled | ROI |
| --- | ---: | ---: |
| VALUE only | 66 | +16.2% |
| VALUE MATCH_RESULT only | 63 | +21.7% |
| CONTROL | 220 | -5.7% |
| CONTROL MATCH_RESULT | 192 | -3.4% |
| CONTROL TOTALS | 28 | -21.2% |
| VALUE TOTALS | 3 | -100.0% |

Latest live diagnostics:

| Live item | Current |
| --- | ---: |
| Selected bookmakers visible | yes |
| Live preflight usable events | 7 |
| Live preflight maxSeq | 306953648 |
| Live feed stats rows | 2 |
| Live market messages | 0 |
| Live training rows | 0 |
| Live liquidity rows | 0 |

Latest historical calibration block:

| Historical item | Current |
| --- | ---: |
| Historical credits spent in latest block | 5760 |
| Historical matches pulled | 160 |
| Historical calibrated events | 144 |
| First block consensus_power_median validate Brier | 0.5802 |
| First block baseline Brier | 0.6548 |
| First block consensus_power_median validate logLoss | 0.9705 |
| First block baseline logLoss | 1.0815 |
| Final The Odds API quota observed | 8753 |

## What Works

### The Odds API research path

Status: works and is the primary model-research path.

Working capabilities:

- Active sports discovery.
- Prematch odds pulls.
- Event odds pulls.
- Scores/settlement support.
- Historical event IDs and historical event odds.
- Market availability diagnostics.
- h2h multi-sport sweeps.
- Soccer-core exploratory sweeps with capped event odds spend.
- Historical h2h multi-snapshot calibration.

Reliability:

- Good enough for research decisions.
- Not enough alone for real staking decisions.
- The historical calibration supports the reference probability model versus
  the baseline, but it does not include Stoiximan/Novibet and is not a soft-book
  strategy backtest.

### Forward CLV collection

Status: works and is the main decision gate.

Working capabilities:

- Paper rows are collected.
- CLV is captured near kickoff.
- VALUE and CONTROL are separated.
- Research status tracks progress to 200 and 300 VALUE CLV samples.
- CLV calibration reports EV buckets, market buckets, bookmaker buckets, and
  regression.

Reliability:

- Directionally promising.
- VALUE is positive and CONTROL is negative after the latest volume increase.
- Still below the 200 VALUE CLV checkpoint, so no threshold or staking change
  is justified yet.

### Production Telegram alert path

Status: implemented and fail-closing.

Working capabilities:

- Strict scan path exists.
- Alerts require The Odds API confirmation.
- Secrets and keys are redacted.
- Candidate queue, delivered-alert ledger, CLV capture, and settlement ledgers
  exist.
- Two historical live alerts were sent and settled, both lost. This sample is
  too small to infer ROI.

Reliability:

- Good for safety and fail-closed behavior.
- Not enough alert count or settlement count to judge profitability.

### Paper settlement and ROI reporting

Status: works mechanically, not statistically useful yet.

Working capabilities:

- Paper settlement exists.
- Football-data settlement exists for supported soccer competitions.
- Profit and ROI can be reported.

Reliability:

- Current total settled count is 289, but VALUE-tier settled count is 69.
- Overall paper ROI is -0.93%.
- VALUE-only ROI is +16.2%, and VALUE MATCH_RESULT ROI is +21.7%.
- CONTROL ROI is -5.7%.
- This is encouraging, but still below the 200 VALUE-settled checkpoint.

### Profit engine

Status: works as an offline diagnostic.

Working capabilities:

- Combines paper ROI, CLV evidence, live evidence, staking diagnostics, and
  warnings.
- Computes fractional-Kelly sample stake fractions.
- Emits readiness states.

Current readiness:

- RESEARCH_ONLY.

Current warnings:

- VALUE_CLV_BELOW_200.
- ROI_SAMPLE_TOO_SMALL.
- LIVE_STATUS_WITHOUT_TRAINING.
- LIMITS_LIQUIDITY_NOT_MEASURED.
- CAPITAL_CONFIG_INCOMPLETE.

### Staking code

Status: implemented as math, not approved for use.

Working capabilities:

- Fractional Kelly stake fraction: full Kelly equals edge / (odds - 1).
- Default diagnostic assumptions: quarter Kelly and 2% stake cap.
- Current sample average stake fraction over VALUE rows is about 0.6758%.
- Current sample max stake fraction is 2%.

Reliability:

- The formula is standard.
- The inputs are not yet proven enough for real staking.
- Bankroll and max stake are not configured.
- Bookmaker limits and live liquidity are not measured.

### Odds-API.io live path

Status: partially works as infrastructure, not as training/profit source.

Working capabilities:

- Selected bookmakers check works.
- Live event preflight works.
- REST snapshot with /odds/multi and includeSeq works.
- Event ID output works.
- WebSocket code supports eventIds-first startup, lastSeq, lock guard, and
  resync refresh.
- /odds/updated fallback works with sport=Football casing.

Current blocker:

- Live odds market messages and live training rows are still zero.
- The latest live preflight found 7 usable events, but the latest
  /odds/updated smoke test returned 0 feed rows and 0 training rows.

Reliability:

- Reliable enough as diagnostics.
- Not reliable enough as a live betting, live training, or liquidity source.

## What Is Missing For ROI, Staking, And Profitability

### ROI

Missing:

- At least 200 settled independent VALUE decisions.
- Preferably 300+ settled VALUE decisions for a stronger read.
- Clustered analysis by event and selection so repeated snapshots do not count
  as independent bets.
- Clear split between VALUE and CONTROL realized ROI.
- Settlement coverage across all sports/markets used by the paper ledger.
- Confirmation that score period semantics match the exact bet market.
- Out-of-sample threshold lock before using ROI to change alert rules.

Current state:

- Settled rows: 289 overall.
- VALUE-tier settled rows: 69.
- Overall paper ROI is -0.93%.
- VALUE-only ROI is +16.2%; VALUE MATCH_RESULT ROI is +21.7%.
- CONTROL ROI is -5.7%.
- ROI is not decision-grade until VALUE settled rows approach 200.
- CLV remains the primary gate until VALUE settlement volume is much larger.

### Staking

Missing:

- Bankroll configuration.
- Maximum real stake configuration.
- Liquidity and limit evidence from the target bookmakers.
- Live or near-live maxBet/max stake observations.
- Slippage and stale-odds assumptions.
- Drawdown simulation on a larger out-of-sample sample.
- A fixed staking policy that is not adjusted after seeing outcomes.

Current state:

- Staking formula exists.
- Profit engine can compute diagnostic fractions.
- Staking is not approved because capital config and liquidity evidence are
  missing.

### Profitability

Missing:

- More VALUE CLV samples.
- More settled independent VALUE rows.
- A stable positive VALUE-vs-CONTROL separation after the 200 and 300 VALUE CLV
  checkpoints.
- Main h2h/MATCH_RESULT performance separated from weak markets such as TOTALS.
- Real execution evidence: odds availability, limits, and accepted stake size.
- A predeclared rule for when to move from paper to tiny real stakes.

Current state:

- The model is directionally promising, not proven profitable.
- The correct status is RESEARCH_ONLY.

## Model Reliability Assessment

### High confidence

- The code paths are fail-closed around secrets, missing reference data, and
  unsupported markets.
- The Odds API research path works.
- Forward CLV reports work.
- Profit engine reports current readiness correctly.
- Historical h2h calibration improves Brier/logLoss versus baseline in the
  latest historical block.

### Medium confidence

- Prematch h2h/MATCH_RESULT VALUE signal.
- VALUE average CLV is positive while CONTROL average CLV is negative.
- EV buckets from 0% to 5% have positive CLV.

Why only medium:

- VALUE CLV is 122, below the 200 checkpoint.
- VALUE rows are not all independent; analysis must account for event/selection
  clustering.
- The model still has limited settled ROI evidence.

### Low confidence

- Real ROI.
- Staking.
- Live betting.
- TOTALS.
- DRAW_NO_BET, BTTS, and DOUBLE_CHANCE.

Why low:

- ROI has only 69 VALUE-tier settled rows.
- Staking lacks capital and liquidity evidence.
- Live has zero market/training rows.
- TOTALS is negative and low-sample.
- Soccer-core extra markets currently have no captured VALUE CLV.

## Decision Log

### 2026-06-28: Keep RESEARCH_ONLY

Decision:

- Do not enable staking.
- Do not reduce alert thresholds.
- Do not expand production alert scope.

Reason:

- VALUE CLV is below 200.
- VALUE-tier settled rows are below 200.
- Live training rows are zero.
- Capital and liquidity are incomplete.

### 2026-06-28: Keep ROI gated after settlement jump

Decision:

- Keep `ROI_SAMPLE_TOO_SMALL` gated on VALUE-tier settled rows, not total
  settled rows.
- Keep the project in RESEARCH_ONLY despite 289 total settled paper rows.
- Do not enable staking or lower alert thresholds.

Reason:

- Total settled rows increased to 289, but VALUE-tier settled rows are 69.
- Pure VALUE settled rows are 66; VALUE_CHECK adds 3 more to the VALUE-tier
  diagnostic count.
- The model being evaluated is the VALUE signal; CONTROL settlement volume
  cannot make VALUE ROI statistically ready.
- VALUE-only ROI is encouraging at +16.2%, and VALUE MATCH_RESULT ROI is
  +21.7%, but the sample is still below the 200-row gate.

Implementation note:

- `profit-engine` now reports `paper.valueSettled`.
- `ROI_SAMPLE_TOO_SMALL` now checks VALUE-tier settled rows rather than total
  settled rows.

### 2026-06-28: Use The Odds API as primary research engine

Decision:

- Spend expiring credits on The Odds API h2h sweeps, soccer-core coverage, CLV
  capture, and historical calibration.
- Treat Odds-API.io live as diagnostic until it produces market messages.

Reason:

- The Odds API path produces measurable forward CLV and historical calibration
  evidence.
- Odds-API.io is still useful for Stoiximan/Novibet target coverage, but live
  streaming has not produced odds training rows.

### 2026-06-28: Keep MATCH_RESULT/h2h as the main model score

Decision:

- Use MATCH_RESULT/h2h as the main decision surface.
- Keep TOTALS, DRAW_NO_BET, BTTS, and DOUBLE_CHANCE separate.

Reason:

- Main MATCH_RESULT VALUE CLV is +2.26%.
- TOTALS average CLV is -3.42% and low-sample.
- Extra soccer-core markets have no captured VALUE CLV yet.

### 2026-06-28: Spend historical credits before reset

Decision:

- Run h2h-only multi-snapshot historical calibration using 24h, 6h, 1h, and 10m
  snapshots.

Reason:

- Credits were expiring.
- Historical fair-probability calibration improves model understanding.
- The run remained bounded by max credit and reserve-credit guards.

Result:

- 5760 historical credits spent.
- 160 matches pulled.
- 144 calibrated events.
- Reference model beat the baseline in Brier and logLoss in the main reported
  block.

### 2026-06-28: Fix h2h sweep 422 handling

Decision:

- If an explicit h2h sweep gets a sport-level 422, skip that sport and continue
  the sweep.

Reason:

- One unsupported active sport should not stop a multi-sport collection block.
- A regression test now covers this behavior.

### 2026-06-28: Add reliability and profitability reporting layer

Decision:

- Add offline commands for `data-health`, `profitability-report`,
  `calibration-report`, `staking-sim`, and `daily-decision-report`.
- Keep all new commands zero-credit and report-only.
- Keep real staking disabled.

Reason:

- The project needs daily decision support, not only raw collection scripts.
- ROI must be measured by VALUE h2h sample, not by total paper rows.
- Quant confidence needs segment-level CLV, ROI, calibration, and drawdown views.

Latest real-data run:

- `data-health`: ERROR 24, WARN 797, INFO 84.
- `profitability-report`: RESEARCH_ONLY, 63 VALUE h2h settled, 114 VALUE h2h
  CLV.
- `calibration-report`: RANKING_SIGNAL, monotonicity PASS.
- `staking-sim --bankroll=1000 --policy=flat --max-stake=10`: RESEARCH_ONLY,
  final bankroll 1137.00 in paper simulation.
- `daily-decision-report`: RESEARCH_ONLY with 6 blockers.

Interpretation:

- The h2h signal remains promising, but still below the 200/200 VALUE h2h gate.
- Data-health errors must be reviewed before trusting production-style gates.
- Staking simulation is now available for research, but does not approve real
  staking.

### 2026-06-28: Strengthen calibration and staking simulation

Decision:

- Extend `calibration-report` with matched VALUE-vs-CONTROL comparisons by
  market, odds bucket, and time-to-close bucket.
- Extend `staking-sim` with daily exposure caps, market/bookmaker exposure,
  drawdown percentage, and deterministic drawdown risk diagnostics.
- Add `--daily-exposure-pct` to `staking-sim`.

Reason:

- Overall CLV/ROI is not enough; VALUE must beat comparable CONTROL buckets.
- Staking usefulness depends on exposure and drawdown, not only profit.
- The project must stay research-only while still showing realistic bankroll
  behavior.

Latest real-data run:

- `calibration-report`: RANKING_SIGNAL, monotonicity PASS.
- Top matched h2h buckets show positive VALUE-vs-CONTROL CLV separation:
  +2.45pp, +2.55pp, and +2.82pp in the first reported buckets.
- `staking-sim --bankroll=1000 --policy=kelly25 --max-stake=100
  --daily-exposure-pct=5`: final bankroll 1030.43, max drawdown 11.32,
  max daily exposure 50.00, probabilityDrawdown20 0, ruinProbability 0.

Interpretation:

- Matched-control evidence is encouraging for h2h, but still not actionable
  until the 200/200 sample gates are met and data-health issues are reviewed.
- Kelly25 is a useful research simulator, not a staking approval.

### 2026-06-28: Make live fallback diagnostics source-aware

Decision:

- Track whether live data comes from WebSocket market messages,
  `/odds/updated`, both, or neither.
- Add `fallbackActive`, `fallbackRecommended`, `updatedPollTrainingRows`, and
  `liveDataSource` to live diagnostics.
- Make `daily-decision-report` recommend `RUN_LIVE_UPDATED_POLL_FALLBACK` only
  when fallback is not already active.

Reason:

- The previous report could say "run fallback" even when fallback rows already
  existed.
- Live WebSocket and `/odds/updated` have different reliability profiles and
  should not be mixed silently.

Latest real-data run:

- WebSocket feed stats rows: 2.
- WebSocket market messages: 0.
- Updated-poll rows: 0.
- Updated-poll training rows: 0.
- Fallback active: false.
- Fallback recommended: true.
- Live data source: none.

Interpretation:

- Live WebSocket remains diagnostic-only.
- The next live measurement action is `live-updated-poll`; real staking and live
  alerts remain blocked.

## Next Gates

Do not move beyond RESEARCH_ONLY until these gates are met:

1. VALUE CLV captured reaches at least 200.
2. Main MATCH_RESULT VALUE CLV remains positive.
3. CONTROL CLV remains negative or near zero.
4. Settled independent VALUE sample grows toward 200.
5. Bankroll and max stake are configured.
6. Liquidity and limit evidence exists for target books.
7. Live odds/training rows exist if live betting is considered.

The immediate operating priority is:

1. Run CLV capture frequently.
2. Keep collecting main h2h/MATCH_RESULT forward CLV.
3. Avoid spending more on weak or zero-evidence extra markets.
4. Let scheduled paper settlement grow the ROI sample.
5. Treat live as diagnostic until it emits real odds market messages.
