# Handoff → Codex: Multi-Sport Mispricing Telegram Alerts

**Date:** 2026-06-26
**Branch:** `codex/multisport-mispricing-alerts`
**Working dir for all commands:** `provider-harness/`
**Runtime:** Node.js ≥ 22, ES modules, built-in `fetch`, `node:test`. **No runtime npm dependencies** — keep it that way.

---

## 0. HARD CONSTRAINTS — non-negotiable, read first

These are safety rules from the project owner. They override any convenience or feature goal. **Do not violate them, do not "temporarily" relax them in a test, do not work around them.**

1. **Never send a betting alert based only on Odds-API.io's EV.** Every alert MUST pass independent dual confirmation against The Odds API (Pinnacle EV > floor **AND** 3-book median consensus EV > floor). Fail closed: if confirmation data is missing, send nothing.
2. **Never scrape, log in, place a bet, fabricate a bookmaker URL, or expose any API key/token.**
3. **Accept only HTTPS deep links on the explicit Stoiximan/Superbet domain allowlists** (see `mispricing_normalize.mjs` → `ALLOWED_HOSTS`). Anything off-allowlist becomes an empty link, never a guessed URL.
4. **Secrets** — `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `ODDS_API_IO_KEY`, `THE_ODDS_API_KEY` — must **never** be printed, written to `reports/`, included in an error message/stack, or committed. They live only in `.env.local` (gitignored). The Telegram client already wraps network errors so the token in the URL never leaks (`telegram.mjs`); preserve that pattern.

If a task seems to require breaking one of these, stop and flag it instead.

---

## 1. Mission

Detect **bookmaker pricing mistakes** (≈10–20% edges) on **Stoiximan** and **Superbet**, independently confirm each against sharp reference odds (Pinnacle + consensus via The Odds API), and push only confirmed opportunities to Telegram. This is a personal, defensive analytics tool — it *finds and reports* mistakes; the human decides and bets manually.

**Scope (v1, deliberately narrow):** Stoiximan + Superbet only; `MATCH_RESULT` (1X2 / moneyline) market only; EV floor **10%** (`mispricing_thresholds.mjs`).

---

## 2. Current state (what already works)

- **All tests green:** `node --test` → **125/125** passing.
- **Live-verified end to end:**
  - `node src/cli.mjs telegram-test` → real message delivered to the owner's chat.
  - `node src/cli.mjs mispricing-scan --dry-run` → runs against both real APIs, fail-closed behavior confirmed (finds candidates, refuses to alert when confirmation data is absent).
- **Latest live funnel (2026-06-26):** 95 raw candidates → distribution `≥20%: 0 | 10–20%: 1 | 5–10%: 10 | 0–5%: 66`. The single 10–20% candidate was correctly dropped as `STALE_CANDIDATE`. Net: 0 confirmed, 0 sent. The pipeline is behaving correctly; opportunities are simply rare/fleeting.
- **Schedulers:** installer scripts exist (`scripts/install-mispricing-task.ps1` for the 3×/day production scanner; `scripts/install-mispricing-funnel-task.ps1` for the read-only sampler). The production scanner has **not** been registered on the machine yet — that is the owner's call.

The working tree on this branch is clean and committed. Do not revert existing files unless explicitly asked.

---

## 3. How to run

```bash
cd provider-harness

# All tests (this is the gate — must stay green)
node --test

# Live dry-run scan (queries both APIs, sends NOTHING to Telegram)
node src/cli.mjs mispricing-scan --dry-run

# Live scan (will send Telegram alerts if anything confirms)
node src/cli.mjs mispricing-scan

# Verify Telegram delivery path
node src/cli.mjs telegram-test

# EV-distribution instrument (no Telegram, optional --append-csv)
node scripts/mispricing-funnel.mjs
```

**Env setup:** copy `.env.example` → `.env.local` (repo root or harness root; the installer searches both, including the main repo root when run from a worktree). Required keys:
```
ODDS_API_IO_KEY=      # Odds-API.io (the soft-book value feed)
THE_ODDS_API_KEY=     # The Odds API (sharp reference: Pinnacle + consensus)
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=     # the human's chat id, NOT the bot's own id
```

---

## 4. Architecture — pipeline & file map

Data flows in stages; **every stage fails closed** (on doubt, reject/defer, never alert):

```
Odds-API.io /value-bets ──► normalize ──► map sport ──► match event ──► confirm (The Odds API) ──► dedup/state ──► Telegram
   (Stoiximan, Superbet)        │            │             │                  │                        │            │
```

| Stage | File | Responsibility |
|-------|------|----------------|
| Provider client | `src/value_bets_client.mjs` | Pulls `/value-bets` per bookmaker; captures `receivedAt` + rate-limit headers. |
| Normalize | `src/mispricing_normalize.mjs` | EV floor, freshness, market shape, participant/link safety. **Bookmaker + host allowlists live here.** |
| Sport mapping | `src/multisport_map.mjs` + `config/multisport-map.json` | Maps provider `sport|league` → The Odds API sport key. Static registry first, then exact-title auto-map against active sports. |
| Event match | `src/mispricing_match.mjs` | Matches a candidate to a reference event by normalized team names + kickoff tolerance (120s). Rejects on no/ambiguous match. |
| Reference client | `src/theodds_client.mjs` | `listSports`, `listEvents`, `getOdds` (uses `markets=h2h` only → 1 credit/sport). |
| Reference normalize | `src/theodds_normalize.mjs` | Shapes The Odds API odds into selections. |
| Confirm | `src/mispricing_confirm.mjs` | Power de-vig; **Pinnacle EV AND 3-book consensus EV both > floor** or REJECTED. |
| Thresholds | `src/mispricing_thresholds.mjs` | Single source of truth: `MIN_CANDIDATE_EV`, `MIN_CONFIRMED_EV` (both 0.10). |
| State / dedup | `src/mispricing_state.mjs` | Queue, delivered-alerts ledger, health counters, `shouldSendAlert` (≥5pp improvement to re-alert). |
| Telegram | `src/telegram.mjs` | Formats message (Europe/Athens tz), inline keyboard; token-safe error wrapping. |
| Orchestrator | `src/mispricing_scan.mjs` | Wires all stages; quota reserve (100); per-stage audit rows; `--dry-run`. |
| CLI | `src/cli.mjs` | Command dispatch: `mispricing-scan`, `telegram-test`, plus existing `clv`, `settle`, `boost`, etc. |
| Schedulers | `scripts/*.ps1` | Production scanner (09:00/15:00/21:00) + funnel sampler. |

State/artifacts are written under `reports/` (gitignored): `mispricing-audit.csv`, `mispricing-queue.csv`, `mispricing-alerts.csv`, `mispricing-health.json`.

---

## 5. Domain facts & gotchas (will bite you if you don't know)

- **`expectedValue` from Odds-API.io is an INDEX ~100, not a percentage.** Fraction = `(value - 100) / 100`. Use exactly that form — `value/100 - 1` is float-fragile at the gate (`120/100 - 1 === 0.19999999999999996`). See `mispricing_normalize.mjs:128`.
- **Float fragility at thresholds is real.** Re-alert check uses an epsilon: `improvement >= 0.05 - 1e-9` (`mispricing_state.mjs`). Keep epsilons when comparing summed/subtracted floats at a boundary.
- **De-vig:** use the existing power method `devigPower` from `src/value.mjs`. Don't reinvent.
- **The Odds API credit cost:** `markets=h2h` = 1 credit/sport; adding totals doubles it. v1 is MATCH_RESULT-only, so keep `h2h`. Quota reserve of 100 stops verification before exhausting the plan.
- **Staleness window:** `MAX_AGE_MS = 10 min` in `mispricing_normalize.mjs`. A candidate whose `expectedValueUpdatedAt` is older than this is `STALE_CANDIDATE` (an EV from a stale price is fiction).
- **PowerShell 5.1 scheduler gotcha:** `New-ScheduledTaskSettingsSet -StartWhenAvailable $true` passes a stray positional arg and fails at runtime (it's a **switch**). Use the bare switch: `-StartWhenAvailable`, `-WakeToRun`. Tests assert this (`/-StartWhenAvailable\b(?!\s+\$)/`).
- **Superbet links** may resolve to `superbet.bet.br` (Brazil). Fine for *detection*; the human verifies market availability before betting. This domain is intentionally on the allowlist.

---

## 6. Prioritized backlog (the goals — do these in order)

Each item lists the **why**, the **concrete change**, and **acceptance criteria**. Follow TDD: red test → green → refactor. Keep `node --test` at 100%.

### P1 — Wire a feedback loop: CLV on every sent alert  *(highest value, mostly wiring)*
**Why:** The system sends alerts and forgets them. Without recording whether each alert beat the closing line, you can never prove the alerts are real edge vs. noise.
**What exists:** A full CLV domain already lives in `src/paper.mjs`: `applyClosingLine(rows, closingFairByKey, {capturedAt})`, `summarizeClv(rows)`, and the `clv` CLI command (`runClv` in `cli.mjs:477`). It currently operates on *paper bets*, not on mispricing alerts.
**Change:** When `mispricing_scan` sends an alert, also record it as a trackable bet (reuse the `paper.mjs` row shape: store offered odds, kickoff, the de-vigged fair probability at send time, and a stable key). Then extend/point the existing closing-line capture to compute CLV for these alert rows near kickoff, and surface `summarizeClv` output (captured / positive / average CLV).
**Acceptance:** A sent alert produces a tracked row; a later close-capture run fills `closingFairOdds`, `clv`, `clvCapturedAt`; `summarizeClv` reports aggregate CLV. New tests cover the send→track→capture→summarize path. Secrets never written to the CSV.

### P2 — Fix the cadence/latency mismatch  *(the real reason live mistakes are missed)*
**Why:** Mistakes live for *minutes*; the production scanner runs **3×/day**. A 10:00 mistake is gone by the 15:00 run. Verified live: the only 10–20% candidate today was already stale.
**Change:** Two-tier polling. A cheap **detection** pass (Odds-API.io only, **zero** The Odds API credits) every ~10–15 min that just checks whether any candidate clears the 10% floor and is fresh. Only when it finds one does it trigger the **expensive** confirmation path (spend a credit, run dual confirmation, alert). Keep the quota reserve guard. Add a scheduler trigger for the detection tier.
**Acceptance:** Detection pass provably spends 0 reference credits when nothing qualifies (assert via injected reference client that `getOdds` is never called). Confirmation only fires on a fresh ≥10% candidate. Quota reserve still honored.

### P3 — Widen confirmation coverage (second sharp source)
**Why:** Today confirmation depends 100% on The Odds API carrying the same league. The ≥10% mistakes keep landing in obscure leagues (e.g. Australian women's NPL) that it doesn't cover → 0 confirmable alerts. Single point of failure on coverage.
**Change:** Add an optional second sharp reference (e.g. Betfair Exchange fair price) as an *alternative* confirmation when Pinnacle is unavailable for a fixture. Do **not** weaken the dual-confirmation rule — a second sharp source *substitutes* for the missing one, it doesn't lower the bar.
**Acceptance:** When The Odds API lacks a fixture but the second source has it, confirmation can still run under the same EV floor. Behavior unchanged when both are present. Fail-closed preserved when neither is present.

### P4 — Harden event matching (aliases + near-miss logging)
**Why:** Matching requires an *exact* normalized team-name match + 120s tolerance. Spelling differences across providers ("Inter" vs "Internazionale", "Man Utd" vs "Manchester United") cause silent `NO_EVENT_MATCH` — you lose real opportunities and never know.
**Change:** Add a small alias/normalization layer and **log near-misses** (same kickoff window, high name similarity, but not exact) to an audit channel so the alias table can be grown from real data. Keep ambiguous matches rejected (never guess between two events).
**Acceptance:** Known alias pairs match; near-misses are logged with enough detail to triage; ambiguous (≥2 candidate events) still rejected.

### P5 — Operational resilience
**Why:** Runs on a single Windows PC via Task Scheduler. If it sleeps/off, no scans. (A health-warning after 3 consecutive provider failures exists, but doesn't help if the host itself is down.)
**Change:** Add a heartbeat/"last successful run" signal the human can check, and document a path to host the scan off the single PC if desired. Lower priority — only after P1–P4.
**Acceptance:** A missed/dead scanner is observable (e.g. stale heartbeat surfaced), not silent.

---

## 7. Working agreement (definition of done)

- **TDD always:** write the failing test first, then the implementation. No new behavior without a test.
- **`node --test` stays at 100%.** Don't merge red.
- **Fail closed everywhere.** On missing/ambiguous/stale data: reject or defer, never alert. The cost of a missed bet is zero; the cost of a bad alert is the human's money.
- **No new runtime dependencies.** Node built-ins only.
- **No secrets in logs, reports, errors, or commits.** Audit/report CSVs are gitignored but still must not contain tokens.
- **Single source of truth for thresholds:** change EV floors only in `mispricing_thresholds.mjs`.
- **Commit style:** small, atomic, conventional (`feat:`, `fix:`, `test:`, `docs:`, `chore:`), each commit green.
- Reference plan with deeper rationale: `docs/superpowers/plans/2026-06-25-multisport-mispricing-alerts.md` (see its "v1 Scope Decisions and Verified Schema" section).

---

## 8. First move for Codex

Start with **P1 (CLV wiring)** — it's the shortest path to *data about whether this system actually has edge*, and most of the machinery (`paper.mjs` CLV functions) already exists. Read `src/paper.mjs`, `src/cli.mjs:477` (`runClv`), and `src/mispricing_scan.mjs` (the send path), then write the failing test for "a sent alert becomes a CLV-trackable row" before touching implementation.
