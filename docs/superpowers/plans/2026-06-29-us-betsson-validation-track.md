# US / Betsson one-API validation track (post-2026-07-01 reset)

Status: PROPOSED — awaiting approval. Execution scheduled for **after the 1 Jul
credit reset** (only 1,896 The Odds API credits remain until then). Code can be
written earlier; anything that spends credits waits.

## Why

The Greek two-API path (Odds-API.io candidates → The Odds API reference) is the
**production edge** and stays. But it has two permanent limits: it **cannot be
backtested** (no historical soft-book odds exist anywhere), and it goes quiet in
the European off-season. This track adds a **second, complementary** path that
fixes exactly those two gaps:

- **Single API (The Odds API only):** candidate book and reference books share one
  event id → removes the cross-API event-matching layer (a real error source).
- **Backtestable:** The Odds API historical **includes** Betsson + US books, so we
  can finally measure soft-vs-sharp value **out-of-sample on real history** — the
  scientific proof the Greek path can never produce.
- **Year-round volume:** US sports (MLB now → NFL/NBA/NCAA) run all year and settle
  **free via the ESPN integration we already built**, so the settled + CLV sample
  grows fast even in the European off-season.

This is **validation + diversification, not a replacement.** A reference POC already
exists on branch `codex/betsson-single-api-poc` (commit 5ea8497) — we **re-build it
cleanly in `src/commands/`** (Phase 3 structure), we do **not** merge that divergent
branch.

## Hard guardrails

- **Bettability:** candidates restricted to books you can actually fund/bet from
  Greece — **Betsson, Pinnacle, bet365, Unibet**. US-only books (DraftKings, FanDuel,
  …) are reference-consensus only, never candidates. An edge you can't bet is noise.
- **Watchlist only**, no auto-betting, no staking language. Same gates as production.
- Reuses existing reports unchanged: `outcome-calibration-report`,
  `calibration-report`, `scan_scope`, ESPN/`espn-settle`.

## Steps & credit budget (fresh 20,000 after reset)

| # | Step | Credits |
|---|------|---------|
| 0 | **Prereq:** finish Phase 3 (`cli.mjs` split) so the one-API path lands as a clean `src/commands/oneapi_scan.mjs` | 0 (free, pre-reset) |
| 1 | Re-implement one-API scan in `commands/`: candidate = configurable (`--candidate=betsson`), reference = other books on same event id, EV vs de-vigged Pinnacle + ≥3-book consensus. Own ledger `reports/oneapi-paper-bets.csv`. Unit-tested with fixtures. | 0 code; ~50–100 live smoke |
| 2 | **Historical backtest (the key deliverable):** run the existing `historical-calibration` + a new soft-vs-sharp EV backtest with **Betsson (or bet365) as candidate** over one completed league ½ season, OOS temporal split. Produces the first real edge proof. | ~3,800 (1 league ½ season) |
| 3 | **Year-round forward paper:** schedule one-API scan on in-season US sports (MLB now), candidate = bettable book; settle free via `espn-settle`; capture CLV. | ~2 cr / scan + ~2 cr / CLV; budget ~3,000/mo |
| 4 | **Unified evaluation:** run `outcome-calibration-report` / `calibration-report` over the one-API ledger and compare VALUE-vs-CONTROL gap, CLV, ECE against the Greek path. | 0 (offline) |

Keep a **~3,000-credit reserve**. Indicative allocation: ~3,800 backtest +
~10,000 forward + reserve, leaving headroom for the Greek production path.

## Acceptance / decision

The track succeeds if the one-API path shows the method's edge **out-of-sample
historically** (Step 2: candidate beats sharp consensus after de-vig, on a proper
temporal split) **and** forward CLV > 0 with VALUE beating CONTROL (Steps 3–4). If
so, it becomes a second **validated, year-round, bettable** track that also lends
confidence to the un-backtestable Greek path. If the historical backtest shows no
edge, that is itself a crucial finding about how sharp Betsson/bet365 really are.

## Explicitly out of scope

- Merging the `codex/betsson-single-api-poc` branch (re-build instead).
- US-only books as candidates (not bettable from Greece).
- Any auto-betting or staking.
- Replacing or weakening the Greek production path.
