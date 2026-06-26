# Handoff to Codex: Multi-Sport Mispricing Telegram Alerts

**Date:** 2026-06-26  
**Branch:** `codex/multisport-mispricing-alerts`  
**Repo root:** `C:\Users\bgthe\Documents\bet\.worktrees\multisport-mispricing-alerts`  
**Working dir for commands:** `provider-harness/`  
**Runtime:** Node.js >= 22, ES modules, built-in `fetch`, `node:test`. No runtime npm dependencies.

---

## 0. Hard constraints

These are project-owner safety rules. They override convenience and feature goals.

1. Never send a betting alert based only on Odds-API.io EV. Every alert must pass independent dual confirmation against The Odds API: Pinnacle fair probability plus 3-book consensus EV over the floor. If confirmation data is missing, send nothing.
2. Never scrape, log in, place a bet, fabricate a bookmaker URL, or expose any API key/token.
3. Accept only HTTPS deep links on the explicit Stoiximan/Superbet domain allowlists in `src/mispricing_normalize.mjs`. Anything else becomes an empty link, never a guessed URL.
4. Secrets (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `ODDS_API_IO_KEY`, `THE_ODDS_API_KEY`) must never be printed, written to reports, included in errors/stacks, or committed. They live only in `.env.local` files.
5. Estimated boost legs are manual-analysis only. Do not send alerts from estimated legs.

If a task appears to require breaking one of these, stop and flag it.

---

## 1. Mission

Detect bookmaker pricing mistakes on Stoiximan and Superbet, independently confirm them against sharp reference odds, and push only confirmed opportunities to Telegram. The human decides and bets manually.

Current automated alert scope remains deliberately narrow: Stoiximan + Superbet, `MATCH_RESULT` only, 10% EV floor in `src/mispricing_thresholds.mjs`.

Boost tooling is a manual decision aid. It may analyze wider markets, but it must label confidence explicitly and must not feed Telegram alerts unless every leg is fully verified under the strict rule.

---

## 2. Current state

- All tests were green after the latest boost-mix work: `npm test` / `node --test` -> 152/152 passing.
- P1 CLV feedback loop is shipped. Sent alerts are snapshotted to `reports/mispricing-clv.csv`; `mispricing-clv` captures Pinnacle closing line and reports realized CLV. Scheduling CLV capture is still open.
- P2 two-tier cadence is shipped. `runMispricingScan` exits before any reference call on no-op cycles, so empty cycles spend zero The Odds API credits. The production installer repeats every 15 minutes but is not registered on the machine.
- P6 boost evaluation is shipped for manual use: `boost-check`, `boost-combo`, and `boost-mix`.
- P7 event-level reference support exists for manual boost analysis only. Automated alerting has not been widened beyond `MATCH_RESULT`.
- Live Telegram path was previously verified end to end with `telegram-test`; live dry-run scan was also verified fail-closed.
- Latest live funnel before this handoff still produced 0 confirmed alerts. That is expected: confirmed 10%+ opportunities are rare/fleeting and missing reference coverage rejects candidates.
- The working tree currently has uncommitted boost-mix changes. Do not revert existing files unless explicitly asked.

Uncommitted boost-mix work currently includes:

- `provider-harness/src/theodds_client.mjs`
- `provider-harness/src/theodds_normalize.mjs`
- `provider-harness/src/boost_mix.mjs`
- `provider-harness/src/cli.mjs`
- `provider-harness/test/theodds_client.test.mjs`
- `provider-harness/test/theodds_normalize.test.mjs`
- `provider-harness/test/boost_mix.test.mjs`
- `provider-harness/test/cli_boost_mix.test.mjs`
- `docs/superpowers/plans/2026-06-26-boost-mix-exotic-markets.md`
- this handoff file

---

## 3. How to run

```bash
cd provider-harness

# All tests
npm test

# Same gate if npm script is unavailable
node --test

# Live dry-run scan: queries APIs, sends nothing to Telegram
node src/cli.mjs mispricing-scan --dry-run

# Live scan: sends Telegram alerts only if strict confirmation passes
node src/cli.mjs mispricing-scan

# Capture closing-line value for already-sent alerts
node src/cli.mjs mispricing-clv

# Price a single enhanced-odds 1X2 selection
node src/cli.mjs boost-check --sport-key=soccer_fifa_world_cup --home="Japan" --away="Sweden" --date=2026-06-26T18:30:00Z --pick=1 --base=1.78 --boost=2.40

# Price a strict multi-leg combo using only verified legs
node src/cli.mjs boost-combo --boost=2.50 --leg="soccer_fifa_world_cup;Japan;Sweden;2026-06-26T18:30:00Z;2" --leg="soccer_fifa_world_cup;Brazil;Serbia;2026-06-26T21:00:00Z;1"

# Price an exotic boosted mix. API-backed legs get VERIFIED; unsupported one-sided/missing-reference legs get ESTIMATE_ONLY or UNVERIFIABLE.
node src/cli.mjs boost-mix --boost=1.90 --leg="soccer_fifa_world_cup;Turkey;USA;2026-06-26T02:00:00Z;BTTS_YES" --leg="soccer_fifa_world_cup;Turkey;USA;2026-06-26T02:00:00Z;O2.5"

# Verify Telegram delivery path
node src/cli.mjs telegram-test

# EV-distribution instrument; no Telegram
node scripts/mispricing-funnel.mjs
```

Environment setup: copy `.env.example` to `.env.local` in the repo root or harness root. Required keys:

```bash
ODDS_API_IO_KEY=
THE_ODDS_API_KEY=
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
```

Do not print these values.

---

## 4. Architecture and file map

Every production alert stage fails closed:

```text
Odds-API.io value-bets
  -> normalize
  -> map sport
  -> match event
  -> confirm with The Odds API
  -> dedup/state
  -> Telegram
```

| Stage | File | Responsibility |
| --- | --- | --- |
| Provider client | `src/value_bets_client.mjs` | Pulls `/value-bets` per bookmaker; captures receive time and rate-limit headers. |
| Normalize | `src/mispricing_normalize.mjs` | EV floor, freshness, market shape, participant/link safety. Bookmaker + host allowlists live here. |
| Sport mapping | `src/multisport_map.mjs` + `config/multisport-map.json` | Maps provider `sport|league` to The Odds API sport key. |
| Event match | `src/mispricing_match.mjs` | Matches candidates to reference events by normalized teams and kickoff tolerance. Rejects no/ambiguous matches. |
| Reference client | `src/theodds_client.mjs` | `listSports`, `listEvents`, `getOdds`, and new `getEventOdds({ sportKey, eventId, markets })`. |
| Reference normalize | `src/theodds_normalize.mjs` | Shapes The Odds API odds into selections, including event-level exotic markets used by `boost-mix`. |
| Confirm | `src/mispricing_confirm.mjs` | Power de-vig; Pinnacle EV and 3-book consensus EV must both pass the floor. |
| Boost legs | `src/boost_legs.mjs` | Strict `boost-combo` leg parsing/pricing for match result, double chance, and totals. |
| Boost mix | `src/boost_mix.mjs` | Manual boosted-combo analysis with `FULLY_VERIFIED`, `MIXED_ESTIMATE`, or `UNVERIFIABLE` output. |
| Thresholds | `src/mispricing_thresholds.mjs` | Single source of truth for EV floors. |
| State/dedup | `src/mispricing_state.mjs` | Queue, delivered-alerts ledger, health counters, CLV ledger. |
| Telegram | `src/telegram.mjs` | Formats alerts and wraps network errors without leaking tokens. |
| Orchestrator | `src/mispricing_scan.mjs` | Wires scan stages; quota reserve; audit rows; dry-run. |
| CLI | `src/cli.mjs` | Command dispatch: scan, CLV, Telegram test, boost tools, etc. |
| Schedulers | `scripts/*.ps1` | Windows Task Scheduler installers for scan and funnel sampler. |

State/artifacts are written under gitignored `reports/`: `mispricing-audit.csv`, `mispricing-queue.csv`, `mispricing-alerts.csv`, `mispricing-clv.csv`, `mispricing-health.json`.

---

## 5. Domain facts and gotchas

- `expectedValue` from Odds-API.io is an index around 100, not a percentage. Fraction is `(value - 100) / 100`; keep the current implementation to avoid float gate errors.
- Staleness matters. `MAX_AGE_MS = 10 min`; stale candidate EV is rejected.
- Use the existing `devigPower` method from `src/value.mjs`; do not invent another de-vig method.
- The Odds API credit cost grows with markets. `markets=h2h` is cheap; broad event-level market sets can be expensive. A recent live exotic-market check cost 14 credits, so use targeted market lists.
- `double_chance` must be derived from de-vigged `MATCH_RESULT` probabilities, not by de-vigging the `double_chance` market directly. Double-chance outcomes overlap, so treating them as a normal mutually exclusive 3-way market is wrong.
- One-sided player/scorer markets cannot be fully verified from a yes-only price. `boost-mix` may estimate them with per-market margins, but that remains `ESTIMATE_ONLY`.
- The strict alert rule is unchanged: Pinnacle fair probability plus 3-book consensus, or no verified verdict.
- Superbet links may resolve to `superbet.bet.br` for detection. The human verifies market availability before betting; allowlist behavior is intentional.
- PowerShell 5.1 scheduler switch gotcha: `-StartWhenAvailable` and `-WakeToRun` are switches, not boolean args. Tests assert the scripts avoid the bad form.

---

## 6. Backlog status

### P1 - CLV feedback loop: DONE

Delivered:
- `mispricing_state.mjs` ledger helpers for `reports/mispricing-clv.csv`
- scan-time append of pending CLV rows after successful Telegram sends
- `mispricing-clv` command to capture closing Pinnacle line
- tests in `mispricing_state.test.mjs`, `cli_mispricing_clv.test.mjs`, and `mispricing_scan.test.mjs`

Still open: schedule CLV capture near kickoff; optionally add consensus CLV.

### P2 - Cadence/latency: DONE

Delivered:
- no-op cycles return before reference API calls
- production task installer repeats every 15 minutes
- tests for early exit and scheduler script

The production scanner is not registered on the machine.

### P3 - Wider confirmation coverage: OPEN

Highest leverage for automated alert volume. Current confirmation depends on The Odds API carrying the same league/event. Add an optional second sharp reference source as a substitute when Pinnacle/The Odds API coverage is missing, without weakening dual confirmation or EV floors.

### P4 - Event matching aliases and near-miss logging: OPEN

Exact normalized team match plus kickoff tolerance misses real events with provider spelling differences. Add alias/normalization and near-miss logs, while keeping ambiguous matches rejected.

### P5 - Operational resilience: OPEN

Add observable heartbeat/last-success signal for the Windows scheduled scanner. Lower priority than P3/P4.

### P6 - Boost/enhanced-odds evaluation: DONE for manual use

Delivered:
- `boost-check`: single 1X2 enhanced-odds candidate through real strict confirmation
- `boost-combo`: strict multi-leg combo pricing; fails closed if any leg cannot be verified
- `boost_legs.mjs`: match result, double chance, totals leg support
- `boost-mix`: manual exotic boosted combo analysis with explicit confidence status

`boost-mix` statuses:
- `FULLY_VERIFIED`: every leg API-backed and verified under strict rule
- `MIXED_ESTIMATE`: at least one leg is estimated; manual decision only
- `UNVERIFIABLE`: missing/unsupported reference data prevents useful pricing

Do not send alerts from `MIXED_ESTIMATE` or `UNVERIFIABLE`.

### P7 - Markets beyond 1X2: PARTIAL

Manual boost analysis now normalizes these event-level markets where The Odds API provides them:

- `double_chance`
- `btts`
- `team_totals`
- `alternate_team_totals`
- `alternate_totals_corners`
- `alternate_spreads_cards`
- `player_goal_scorer_anytime`
- `player_shots`
- `player_shots_on_target`

This is not wired into automated alerts. Before alerting on any market beyond `MATCH_RESULT`, add market-specific candidate normalization, exact line matching, Pinnacle+3-book consensus verification, audit rows, and tests.

### P8 - Live/in-play mistakes: OPEN

Likely where the biggest mistakes are, but needs a live odds source and faster loop. Scope before building. Keep pre-match flow and CLV data as the proof base first.

---

## 7. Recent live manual checks

Fixtures found under `soccer_fifa_world_cup`:

- Paraguay vs Australia, event `22f6ac06dfcc88a847920f62633e6459`, kickoff `2026-06-26T02:00:00Z`
- Turkey vs USA, event `f41aeac9a8343a84b4950f15ea25fba2`, kickoff `2026-06-26T02:00:00Z`

Focused live check around `2026-06-26T01:52:39Z`:

- Turkey @ 3.70: VERIFIED; Pinnacle EV about +13.5%, consensus EV about +11.2%. This was the cleanest strict candidate from the screenshots.
- Paraguay-Australia Under 1.5 @ 2.22: VERIFIED but borderline; Pinnacle EV about +10.1%, consensus EV about +8.1%. It does not meet a strict 10% consensus floor.
- Turkey-USA Over 2.5 component @ 1.90: VERIFIED but borderline; Pinnacle EV about +9.4%, consensus EV about +9.9%.
- Turkey-USA BTTS Yes + Over 2.5 @ 1.90: `FULLY_VERIFIED` and strongly negative, about -33% EV. Avoid.

These are historical manual-analysis notes for the session, not alerts.

---

## 8. Working agreement

- TDD for behavior changes: failing test first, then implementation.
- Keep `node --test` / `npm test` green.
- Fail closed on missing, ambiguous, stale, or unsupported data.
- No new runtime dependencies unless the owner explicitly accepts that tradeoff.
- No secrets in logs, reports, errors, or commits.
- EV floors live only in `src/mispricing_thresholds.mjs`.
- Keep commits small, atomic, and green if/when the owner asks for commits.
- Deeper planning docs:
  - `docs/superpowers/plans/2026-06-25-multisport-mispricing-alerts.md`
  - `docs/superpowers/plans/2026-06-26-boost-mix-exotic-markets.md`

---

## 9. Recommended next moves

1. Review the uncommitted boost-mix changes and commit them if the owner wants a checkpoint.
2. Use `boost-mix` manually for screenshot boosts; trust only `FULLY_VERIFIED` for rigorous verdicts.
3. Decide whether any exotic markets should graduate into automated alerts. Only two-sided, exact-line, Pinnacle+3-consensus markets should be considered.
4. For alert volume, P3 remains the highest-leverage engineering task: add a second sharp reference source for events The Odds API/Pinnacle does not cover.
5. P4 is the next reliability task: improve event matching with aliases and near-miss logs.

Do not start by widening alert markets casually. The strict verification rule is the product boundary.
