# Forward CLV analysis design — paper-only

Date: 2026-06-27

This is the analysis contract for the paper ledger after the post-paid volume
changes. It does not change Telegram thresholds and it does not place bets.

## Goal

Decide whether computed paper EV has real predictive value before lowering any
live alert threshold. The decision must come from forward CLV first, then from
settled ROI as a slower secondary check.

## Data source

- Primary ledger: `provider-harness/reports/paper-bets.csv`.
- Supporting reports:
  - `provider-harness/reports/clv-report.csv`
  - `provider-harness/reports/value-flow-report.csv`
  - latest `provider-harness/reports/scan-all-*.csv`

Required row fields already exist: `ev`, `clv`, `sportKey`, `market`,
`bookmaker`, `line`, `decimalOdds`, `fairProbability`, `kickoffUtc`,
`firstSeenAt`, `clvCapturedAt`, `status`, `profit`.

## Minimum sample gates

- Do not judge the model from ROI before at least 200 paper bets with captured
  CLV and settlement status.
- Use CLV as the first gate once there are about 200 captured CLV rows.
- Segment conclusions need at least 30 rows per segment, ideally 50+. Smaller
  segments are diagnostic only.
- Do not lower the live Telegram floor from this analysis alone; lowering the
  floor is a separate reviewed change with the report attached.

## Primary tests

1. **CLV vs computed EV gradient**
   - Dependent variable: `clv`.
   - Independent variable: initial `ev`.
   - Expected signal: higher computed EV buckets should have higher average CLV.
   - Failure mode: flat or negative slope means positive CLV is likely generic
     line drift rather than model skill.

2. **EV buckets**
   - Buckets: `0.5-1%`, `1-2%`, `2-4%`, `4-7%`, `7%+`.
   - For each bucket: count, average CLV, median CLV, positive CLV rate,
     settled ROI when available.
   - The useful question is not "is every bucket profitable"; it is whether the
     trend rises with computed EV.

3. **Market segmentation**
   - Compare `MATCH_RESULT` vs `TOTALS`.
   - Run this only after `TOTALS` has enough rows; until then, report totals as
     "insufficient sample".

4. **Bookmaker segmentation**
   - Compare Stoiximan vs Novibet.
   - This checks whether the edge is concentrated in one soft book.

5. **Odds / probability bucket**
   - Buckets by offered decimal odds: `<1.5`, `1.5-2.0`, `2.0-3.5`, `3.5+`.
   - This specifically checks the historical-calibration warning that small
     longshot edges may be optimistic.

## Secondary tests

- Settled ROI by the same EV/market/bookmaker buckets.
- Time-to-close: `kickoffUtc - firstSeenAt` and `kickoffUtc - clvCapturedAt`.
- Duplicate pressure: how many scan opportunities are duplicates vs new paper
  rows, by market and bookmaker.

## Go / no-go interpretation

- Strong go signal: positive average CLV overall, positive EV-to-CLV slope, and
  the top EV buckets outperform the low EV buckets.
- Weak go signal: positive average CLV but flat slope. Keep collecting; do not
  infer model skill yet.
- No-go signal: negative average CLV or negative EV-to-CLV slope after a
  reasonable sample.

## Next implementation

When the sample is large enough, add a no-quota `clv-analysis` command that reads
only local CSVs and writes:

- `reports/clv-analysis.csv`
- `reports/clv-analysis.json`

The first version should compute bucket summaries and a simple least-squares
CLV-vs-EV slope. Avoid complex modelling until the sample justifies it.
