# Handoff to Codex: Multi-Sport Mispricing Telegram Alerts

**Date:** 2026-06-26  
**Branch:** `master` (consolidated 2026-06-26 — the `codex/*` worktree branches were merged into `master`; one branch, one folder)  
**Repo root:** `C:\Users\bgthe\Documents\bet`  
**Working dir for commands:** `provider-harness/`  
**Runtime:** Node.js >= 22, ES modules, built-in `fetch`, `node:test`. No runtime npm dependencies.

---

## 0. Hard constraints

These are project-owner safety rules. They override convenience and feature goals.

1. Never send a betting alert based only on Odds-API.io EV. Every alert must pass independent dual confirmation against The Odds API: Pinnacle fair probability plus 3-book consensus EV over the floor. If confirmation data is missing, send nothing.
2. Never scrape, log in, place a bet, fabricate a bookmaker URL, or expose any API key/token.
3. Accept only HTTPS deep links on the explicit Stoiximan/Novibet domain allowlists in `src/mispricing_normalize.mjs`. Anything else becomes an empty link, never a guessed URL.
4. Secrets (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `ODDS_API_IO_KEY`, `THE_ODDS_API_KEY`) must never be printed, written to reports, included in errors/stacks, or committed. They live only in `.env.local` files.
5. Estimated boost legs are manual-analysis only. Do not send alerts from estimated legs.

If a task appears to require breaking one of these, stop and flag it.

---

## 1. Mission

Detect bookmaker pricing mistakes on Stoiximan and Novibet, independently confirm them against sharp reference odds, and push only confirmed opportunities to Telegram. The human decides and bets manually.

Current automated alert scope remains deliberately narrow: Stoiximan + Novibet, `MATCH_RESULT` only, 10% EV floor in `src/mispricing_thresholds.mjs`.

Boost tooling is a manual decision aid. It may analyze wider markets, but it must label confidence explicitly and must not feed Telegram alerts unless every leg is fully verified under the strict rule.

---

## 2. Current state

> **Status update 2026-06-27 (Codex improvement plan).** Quant diagnosis:
> the low bet count is expected from the current narrow universe, not evidence
> of a broken model. Live audit is dominated by `CANDIDATE_EV_BELOW_MIN`
> rejections, while paper scanning currently prices only mapped active leagues
> and mostly `MATCH_RESULT` markets. Improvement sequence: keep Telegram at
> the 10% dual-confirmation floor; first fix paper CLV so it captures only near
> kickoff; add no-quota value-flow diagnostics; then widen paper-only coverage
> through configurable bookmakers/markets; calibrate thresholds only after a
> larger clean CLV sample.
> Implementation follow-up in this session: paper `clv` now spends zero quota
> until a pending paper bet is inside the same 20-minute near-kickoff capture
> window used by live alerts; `run-paper-scan.ps1` no longer captures CLV
> immediately after scan; new `Bet-Paper-CLV` is registered every 15 minutes
> from `run/install-paper-clv-task.ps1`; `value-flow-report` writes a
> no-quota local funnel report; and `scan --bookmakers=A,B` lets paper scans
> test alternative bookmaker sets without changing the live Telegram path.
> Verification: PowerShell syntax OK, `node --test` 203/203 passing, no live
> Telegram threshold change.
>
> **Status update 2026-06-27 (Codex Novibet switch).** The active bookmaker pair
> was changed from Stoiximan/Superbet to **Stoiximan/Novibet** because the owner
> switched Odds-API.io bookmaker access and a live probe returned Stoiximan 200
> with 99 rows, Novibet 200 with 97 rows, and Superbet 403. Paper scan,
> production mispricing scan, and the diagnostic funnel now request Novibet
> instead of Superbet; live alerts still require Pinnacle + 3-book consensus and
> the 10% Telegram floor. Novibet links are allowlisted only for
> `novibet.gr`, `www.novibet.gr`, and observed `novibet.bet.br`; anything else
> is stripped. One live paper scan found 6 value bets, recorded 4 new paper bets
> (2 Novibet, 2 Stoiximan), then CLV captured 19 total rows with 18 positive and
> average CLV +2.2%. Strict live `mispricing-scan --dry-run` sent nothing:
> candidates 1, mapped 0, confirmed 0. Latest The Odds API quota observed: 258.
> **Status update 2026-06-27 (Codex Part C snapshot).** Data-collection window
> is running correctly; no threshold changed. `Bet-Paper-Scan` is Ready, repeats
> every 8h from `2026-06-27T00:00:00+03:00`, and stops at duration end after
> `P3D`; `Bet-Paper-Settle` is Ready daily at 07:30; Funnel remains Disabled.
> Latest heartbeat shows successful live scanner at `2026-06-26T23:30:03Z`,
> quota remaining `280`. Paper ledger is still small: 16 bets total, 4 WON,
> 1 LOST, 11 PENDING. `clv-report` remains 15 captured, 14 positive, beat-rate
> 93.3%, average CLV +2.2%, all World Cup; this is still too small for
> calibration. P4 audit found 30 `UNMAPPED_SPORT_LEAGUE` rows, led by club
> friendlies, Chile Copa Chile, New Zealand Southern League, Brazil Serie D, and
> lower Australia/Argentina leagues. A zero-credit The Odds API `/sports` check
> found no active matching keys for those groups, so no mapping was added.
> **Status update 2026-06-27 (Codex free settlement probes).** The owner added
> `api_sports_key` and `highlightly_key`; both were probed without printing
> secrets. API-Sports is the best free replacement candidate for Part B:
> football/baseball/basketball/hockey all returned HTTP 200, 100-request daily
> limits, and usable final-score fields (`FT`, totals/fulltime scores).
> Highlightly is viable as a backup for baseball/basketball/hockey, but is less
> clean: baseball/basketball returned completed score rows, hockey had no rows on
> the tested date, and the documented football direct host returned DNS failure.
> Recommendation: do not buy TheSportsDB Premium now; when non-soccer paper bets
> appear, build an API-Sports settlement adapter first, with Highlightly only as
> fallback/probe.
> **Status update 2026-06-27 (Codex token window).** Part A of the
> API-token plan is done. `scan` now has a quota guard (`MIN_SCAN_QUOTA = 60`)
> that stops the multi-league paper scan before The Odds API credits can be
> drained below the CLV reserve. `Bet-Mispricing-Funnel` was disabled because
> it duplicated provider calls. `Bet-Paper-Scan` remains the 8-hour paper-only
> data collector, with a 3-day repetition window ending around `2026-06-30`.
> `Bet-Paper-Settle` is enabled daily at 07:30 and was verified with
> `LastTaskResult=0`; it runs `fd-settle`, then `settle`, then
> `mispricing-settle`. TheSportsDB was probed and deferred: key `123` works for
> v1/free, but the free tier returns too little data for reliable settlement
> and v2 requires premium.
> **Status update 2026-06-26 (Codex ops).** `Bet-Paper-Settle` is now
> registered in Windows Task Scheduler and will run daily at 07:30 local time.
> First scheduled run is `2026-06-27 07:30`; it has not run yet
> (`LastTaskResult=267011`). `Bet-Paper-Scan` remains active; next run observed
> at `2026-06-27 00:00`. Latest no-quota `clv-report`: 15 captured CLV rows,
> 14 positive, beat rate 93.3%, average CLV +2.2%. Latest live The Odds API
> quota check: 314 remaining / 186 used, with `/sports` costing 0 credits.
> **Status update 2026-06-26 (Codex P4/data check).** P4 data audit found only
> two true `UNMAPPED_SPORT_LEAGUE` groups in the live alert path:
> `football|chile-copa-chile-group-c` (6 rows) and
> `football|new-zealand-southern-league` (2 rows). Current The Odds API active
> `/sports` list does not expose matching Chile Copa Chile or New Zealand
> Southern League keys, so no mapping was added. Live scanner has now sent 2
> strict confirmed Telegram alerts today; `mispricing-clv` captured both, with
> 1/2 positive and average CLV +12.1%. Latest quota observed: 311 remaining.
> **Status update 2026-06-26 (Codex live settlement).** Added
> `mispricing-settle` so sent Telegram alerts in `reports/mispricing-clv.csv`
> are settled to `WON`/`LOST`/`PUSH`/`REVIEW` with one-unit profit/ROI. The
> daily `run-paper-settle.ps1` now runs both paper `settle` and live
> `mispricing-settle`. Also fixed a CLV overwrite bug: already-captured CLV
> rows are no longer recaptured while they remain `PENDING` for settlement.
> Existing live alert CLV row corrupted by the pre-fix recapture was restored
> to the original near-kickoff capture. `node --test` -> **190/190 passing**.
> **Status update 2026-06-26 (Codex paper-settle scheduler).** Added daily paper
> settlement scripts: `scripts/run-paper-settle.ps1` and
> `scripts/install-paper-settle-task.ps1`. The runner executes `node src/cli.mjs
> settle`, writes `reports/logs/paper-settle-YYYY-MM-DD.log`, needs only
> `THE_ODDS_API_KEY`, and sends no Telegram. The installer registers
> `Bet-Paper-Settle` daily at 07:30, but Codex did **not** register it in Windows
> Task Scheduler during this change.
> **Status update 2026-06-26 (Codex clv-report).** Added a no-quota `clv-report`
> command for the paper ledger. It reads `provider-harness/reports/paper-bets.csv`
> and writes `reports/clv-report.csv` + `reports/clv-report.json`, grouped overall,
> by `sportKey`, and by CLV capture date. Current local report: 15 captured paper
> CLV rows, 14 positive, beat rate 93.3%, average CLV +2.2%. This is still a small
> sample and does not change the 10% Telegram alert floor.
> **Status update 2026-06-26.** Repo consolidated to `master` in the main folder
> (worktrees removed). `node --test` -> **184/184 passing**. The three Windows
> scheduled tasks are **registered and ran successfully** from the main folder
> (`LastTaskResult=0`); the Scanner's first real live cycle produced
> `candidates:2 → mapped:0 → confirmed:0 → sent:0` with zero API/Telegram failures
> — i.e. it is **live and fail-closing correctly**. The Scanner repeats every 15 min
> but only while the PC is awake.
>
> **Diagnosis of why 0 alerts (audit, 101 rows):** the dominant filter is the
> candidate **EV floor**, not coverage — 96/101 rejected as `CANDIDATE_EV_BELOW_MIN`,
> 3 stale, only 2 `UNMAPPED_SPORT_LEAGUE` (Chile Copa Chile Group C). World Cup
> candidates DO appear and map fine (not lost to naming); they simply lack a 10% edge.
> EV snapshot: max edge ~4%, nothing ≥5%. So **≥10% mispricings are genuinely rare
> right now**, and a 3rd reference provider (P3) would not change this — the bottleneck
> is candidate EV *before* confirmation. Next step is data accumulation, then a
> calibration decision on the 10% floor. The "uncommitted boost-mix" note below is
> historical — that work is now committed on `master`.
>
> **Multi-league paper scanner (2026-06-26).** To accelerate data collection
> WITHOUT touching the 10% live-alert safety rule, the legacy `scan` command (paper
> + CLV path, no Telegram) was generalised from World-Cup-only to **every in-season
> league in `multisport-map.json`**, default edge **2%**. Paper bets now carry a
> `sportKey`; `clv`/`settle` group pending bets by sport. First live run: 10 leagues,
> 35 fixtures; CLV on 16 paper bets showed beat rate 93%, avg +2.1% (n=15, World Cup,
> one snapshot — indicative only). 178 tests green. The mispricing-scan/Telegram path
> is unchanged and still gated at 10%.

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
- Novibet links may resolve to `novibet.bet.br` for detection. The human verifies market availability before betting; allowlist behavior is intentional.
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

### P3 - Wider confirmation coverage: OPEN (re-prioritized 2026-06-26)

Plumbing for an optional second sharp reference source is built (`referenceSource`
recorded on every row), but it is NOT live — no third independent provider key is
available, and using Odds-API.io as both candidate and reference would be circular.

**Re-prioritization note:** the 2026-06-26 audit shows confirmation coverage is NOT
the current bottleneck. 95% of rejects are `CANDIDATE_EV_BELOW_MIN` (candidate EV
below the 10% floor, before any reference call); only 2/101 were `UNMAPPED`. So a
third reference provider would not increase alert volume right now — the candidates
do not clear the EV floor in the first place. Keep P3 plumbing, but the higher-value
work is data accumulation + a 10% floor calibration decision once real confirmed-EV
data exists. Original intent retained below for when candidate volume above the floor
returns: add an optional second sharp reference as a substitute when The Odds API
coverage is missing, without weakening dual confirmation or EV floors.

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

---

## 9. Collaboration protocol (Claude ⇄ Codex)

The owner alternates between two agents (Claude Code and Codex). Neither can see the
other's private memory, so **this repo is the only shared source of truth.** Both
agents must keep it current and read it before acting.

### Shared source-of-truth files (read these first, every session, in order)
1. `HANDOFF-CODEX.md` — §0 hard constraints, §2 Status-update banner (current state), §6 backlog.
2. `provider-harness/WORKLOG-<newest date>.md` — exactly what changed last and why.
3. `git log --oneline -15` — the real commits.

### When you FINISH a piece of work (both agents must do this)
- Append/create `provider-harness/WORKLOG-YYYY-MM-DD.md` (Greek, summary table + sections, reference commit hashes).
- Update the §2 Status-update banner here with the new state.
- Commit atomically with clear messages; report the commit hashes.

### Template the owner pastes when handing a task to Codex
> Before doing anything, read in order: (1) `HANDOFF-CODEX.md` §0/§2/§6, (2) the newest
> `provider-harness/WORKLOG-*.md`, (3) `git log --oneline -15`. Confirm what changed last.
> Hard rules: do NOT lower the 10% Telegram alert floor (the 2% floor is the paper-only
> `scan`, no Telegram); every alert needs Pinnacle + 3-book consensus; no scraping, no
> auto-betting, no secrets in logs/commits; TDD, keep `node --test` green.
> Task: <task>, related to backlog <P#>. When done, update WORKLOG + this §2 banner and commit.

---

## 10. Immediate next steps for Codex (as of 2026-06-26)

Context: the paper-bet data engine is live. `scan`/`clv`/`settle` cover every
in-season mapped league at a 2% edge; a `Bet-Paper-Scan` scheduled task runs
`scan` + `clv` every 8 hours (paper only, no Telegram). The goal now is to grow a
**measurable track record** and judge whether the 2-3% edge is real via CLV. Do
these in order; all are free/cheap and must follow the §0 rules and TDD.

1. **P4 — data-driven league + alias expansion (highest value).** As
   `reports/paper-bets.csv` and `reports/scan-all-*.csv` grow, find leagues that
   show up as candidates but stay unmapped while The Odds API actually lists them
   (cross-check the live `/sports` active list). Add the pairs to
   `config/multisport-map.json` and title aliases to `multisport_map.mjs`. This
   widens the paper funnel without weakening any rule.
2. **CLV trend report: DONE 2026-06-26.** Added a `clv-report` command that reads
   `paper-bets.csv` and summarises **beat-rate and average CLV over time and per
   `sportKey`** — not just the current capture. This is the metric the owner uses
   to decide if the edge is real. Persist a small CSV/JSON summary under `reports/`.
3. **Daily settle: DONE 2026-06-26.** Added `run-paper-settle.ps1` + `install-paper-settle-task.ps1`. The installer creates `Bet-Paper-Settle` daily at 07:30 and requires only `THE_ODDS_API_KEY`. It was not registered automatically by Codex.
4. **Hold calibration until the data says so.** Do NOT lower the 10% Telegram
   alert floor. Only after ~200 settled bets with CLV: if beat-rate stays clearly
   above ~55% and average CLV is positive, propose a calibrated live-alert floor as
   a SEPARATE, reviewed change with the data attached.
5. **P3 (3rd reference provider) stays deprioritized** — the 2026-06-26 audit showed
   the bottleneck is candidate EV before confirmation, not reference coverage.
6. **Free settlement: DONE 2026-06-27 (soccer).** New `fd-settle` command settles
   soccer/World Cup paper bets for FREE via football-data.org (`football_data_client.mjs`
   + `football_data_settle.mjs`, key `football_data_org_key`, header `X-Auth-Token`,
   10 req/min). `run-paper-settle.ps1` runs `fd-settle` first, then `settle` for the
   rest — so The Odds API credits are reserved for CLV. Soccer name-matching uses
   normalized names + date; watch club-league name mismatches when expanding beyond
   national teams.
7. **TheSportsDB free settlement: DEFERRED 2026-06-27.** The key is set to
   `123` and v1/free works, but free endpoints return too little data
   (~3 events/day, 1 observed for MLB) and v2 requires premium. Do not build the
   non-soccer settlement adapter unless the owner chooses TheSportsDB Premium.
   For now, non-soccer fallback settlement stays on The Odds API. This is cheap
   enough because there are no non-soccer paper bets yet.
8. **Free non-soccer settlement probe: API-Sports preferred 2026-06-27.**
   `api_sports_key` works across football/baseball/basketball/hockey and returns
   final-score structures suitable for settlement. `highlightly_key` works for
   baseball/basketball/hockey but needs stricter filtering and football direct
   host follow-up. If non-soccer paper bets begin accumulating or The Odds API
   settlement burn becomes material, implement API-Sports first; keep Highlightly
   as secondary fallback only.
9. **Part C snapshot: RUNNING 2026-06-27.** The 3-day window is active and
   protected by the quota guard plus task repetition duration. Current sample is
   still too small for calibration (16 paper bets, 5 settled, 15 CLV captures).
   P4 audit was run against current reports: `UNMAPPED_SPORT_LEAGUE` exists, but
   the zero-credit active `/sports` list does not expose matching The Odds API
   sport keys for the observed lower leagues, so no safe mappings were added.
   Continue collecting until the auto-stop, then rerun `clv-report` and P4 audit.

### Decision 2026-06-27 — SportsGameOdds (SGO): DO NOT integrate yet

A SportsGameOdds free key was obtained and integrating it as a 3rd reference was
proposed. **Decision: defer. Do not build `sports_game_odds_client.mjs` now.** Reasons:
- It is P3, which is deprioritized — the bottleneck is candidate EV under the floor,
  not reference coverage. A 3rd reference does not address that.
- SGO's free tier is US-centric (8 leagues NBA/NFL/MLB/NHL/EPL/UCL/NCAA, 9 US books,
  2,500 objects/month, ~10-min updates). It does not cover the World Cup or the
  Greek/lower leagues; for the leagues it does cover (MLB/NFL/EPL — already in our
  map) The Odds API already provides Pinnacle, so SGO is largely redundant.
- Allowed only as a cheap, reversible probe: a one-off `sgo-test` coverage check
  (~1 object) to confirm whether it lists anything The Odds API does not, with
  Pinnacle. Do NOT wire it into the scan/Telegram path. Revisit only if the data
  experiment later shows confirmation coverage (not the EV floor) is the limiter.

Owner quota note: The Odds API free tier is ~500 credits/month; each full `scan`
≈ 20 credits. The 8-hour paper-scan burns ~60/day — fine for a ~3-day window, but
the owner should disable/review `Bet-Paper-Scan` after the data-collection run.
