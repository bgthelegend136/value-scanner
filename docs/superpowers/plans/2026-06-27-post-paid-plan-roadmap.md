# Post-Paid-Plan Roadmap — The Odds API 20K + Odds-API.io WebSocket trial

> **For agentic workers (Claude ⇄ Codex):** Before acting, read `HANDOFF-CODEX.md`
> §0/§2/§6, the newest `provider-harness/WORKLOG-*.md`, and `git log --oneline -15`.
> Steps use checkbox (`- [ ]`) syntax. TDD for behavior changes; keep `node --test`
> green; commit atomically. This plan is **paper/measurement only** — it does NOT
> change the 10% Telegram alert floor or place any bet.

**Goal:** Turn two new capabilities into evidence — (1) The Odds API **20K plan**
(€30/mo: historical odds + 40× the old free credits) and (2) a **2-day Odds-API.io
WebSocket free trial** — toward the standing objective: grow a clean forward CLV track
record and a historical de-vig calibration so the 10% floor can later be lowered *with
data*, never blindly.

**Why now:** The owner bought the paid plan and confirmed two real needs the earlier
analysis underweighted: fleeting odds (Stoiximan Iraq @ 17.0 vs Senegal collapsed to
~12.0 within minutes — a 15-min poll can miss it) and a future live-betting goal (P8).
The bottleneck remains the **candidate EV floor, not coverage** — ≥10% edges are
structurally rare (`CANDIDATE_EV_BELOW_MIN` dominates the audit; max observed ~4%).

**Session decisions:** run WebSocket-measure + credits/historical **in parallel**;
WebSocket is **measure-only**; historical is **lean (1 league, ½ season ≈ 3,800 cr)**;
live betting is **scope-only groundwork**.

**Tech stack:** Node.js 22 ESM, built-in `fetch` and built-in global `WebSocket` (no
new runtime deps), `node:test`, CSV/JSON local state. Source of pricing/limits:
the-odds-api.com (historical = 10 credits/region/market/snapshot; player props are
event-level), docs.odds-api.io (`llms.txt`) for the WebSocket contract.

## Global constraints (HANDOFF §0 — non-negotiable)

- No auto-betting, no scraping, no login, no fabricated URLs, no secrets in
  logs/reports/errors/commits. "Live betting" here = *faster alerts to the human only*.
- **Do NOT touch the 10% Telegram floor** (`src/mispricing_thresholds.mjs`). All paper
  widening uses the 2% `scan` path (no Telegram).
- Every alert still requires Pinnacle + 3-book consensus dual confirmation.
- No new runtime dependencies; the WebSocket probe must use Node 22 built-in `WebSocket`.

---

## Workstream A — Capitalize on 20K credits (paper-only)

The old quota guards defended the 500/mo free plan; relax to the new budget so forward
paper collection accelerates toward the ~200 settled CLV bets the calibration needs.

- [x] Relax quota guards, keeping a non-zero reserve (never fully drain). Reserve
      ~1,000 cr for CLV (the irreplaceable spend), allow scans the rest:
  - `src/cli.mjs` — `MIN_SCAN_QUOTA` (currently 60).
  - `src/mispricing_scan.mjs` — `QUOTA_RESERVE` (currently 100).
  - Add/adjust the guard test so it still trips at the new floor.
- [x] Re-install `Bet-Paper-Scan` without the 3-day auto-stop
      (`scripts/install-paper-scan-task.ps1` — drop/extend `RepetitionDuration P3D` /
      `StopAtDurationEnd`); optionally raise cadence 8h → 4h.
- [x] Widen paper league coverage (fail-closed, no rule change): data-driven from
      `UNMAPPED_SPORT_LEAGUE` in `reports/mispricing-audit.csv`, cross-checked vs the
      live `/sports` active list; add pairs to `config/multisport-map.json` (+ aliases
      in `multisport_map.mjs`). Confirm TOTALS is priced in `scan`.
      2026-06-27 Codex check: current unmapped groups had no active `/sports` matches,
      so no forced mapping was added.
      2026-06-27 follow-up: paper `scan` and paper `clv` now request
      `markets=h2h,totals`; latest live scan showed 26 `TOTALS` rows but 0 totals
      value bets because max totals EV was negative in that snapshot.
- [x] Verify: live `scan` + `clv` show more matched fixtures/paper rows; guard trips at
      the new floor; `node --test` green.

## Workstream B — Historical de-vig calibration (lean: 1 league, ½ season)

Answer "is my de-vigged fair probability well-calibrated?" in volume — the fair-value
half of the 10%-floor decision. Soft books are **absent** from historical, so this is
explicitly **not** a strategy backtest. State this plainly in the report.

- [x] **Pre-flight (do FIRST, cheap):** confirm the **outcome source covers the window**
      before spending ~3,800 cr. `football_data_settle.mjs` / `football_data_client.mjs`
      (free) must return finished results for the chosen league+season (e.g. EPL `PL`,
      Aug–Dec 2025). If free coverage is short, pick a league/season it does cover. The
      Odds API `/scores` only goes back 3 days → NOT the results source.
- [x] Add `getHistoricalOdds({ sportKey, date, regions="eu", markets="h2h,totals",
      oddsFormat="decimal" })` to `src/theodds_client.mjs` →
      `GET /historical/sports/{sportKey}/odds?date=ISO`. Historical wraps events as
      `{ timestamp, previous_timestamp, next_timestamp, data: [...] }` — return json; the
      caller unwraps `.data` before `normalizeTheOddsResponse`. Add a unit test (fixture).
- [x] Build `scripts/historical-calibration.mjs` (read-only; writes only a report):
  - 1 league + ½-season range; **closing snapshot** (nearest kickoff) per match is enough
    (~190 × 1 × 20 cr ≈ 3,800 cr; one 24h snapshot optional for movement).
  - De-vig → fair probabilities, **reusing** `src/value.mjs` (`findValueBets`) and
    `consensusFairProbabilities` (in `cli.mjs`); compare multiplicative vs Shin vs power.
  - Join to outcomes via the football-data mapping (reuse `football_data_settle.mjs`).
  - Metrics: reliability diagram (binned predicted vs realized), Brier, log-loss vs a
    naive baseline, on an **out-of-sample temporal split** (first half calibrate, second
    validate). Output `reports/historical-calibration-*.json/csv`.
- [x] Verify: tiny-window dry-run (a few credits) BEFORE the full pull; metrics computed;
      report written; `node --test` green.

## Workstream C — WebSocket measure-only instrument (time-boxed to the 2-day trial)

Decide *from data* whether fleeting edges justify paying for the add-on. **No** alert /
Telegram / betting wiring (respects P8 "scope before building"). Stop when the trial ends.

- [x] Build `scripts/ws-lifetime-probe.mjs` using Node 22 built-in `WebSocket` (no dep).
      Get the WS endpoint/auth + subscribe shape from `docs.odds-api.io` (`llms.txt`);
      confirm the existing `ODDS_API_IO_KEY` works under the trial. Handle message types
      `welcome/created/updated/deleted/no_markets/score/status/resync_required`; use
      `seq`/`lastSeq` for reconnect replay. **Never print the key.**
- [x] Subscribe to the **odds** channel for Stoiximan/Novibet on target sports. Log each
      value-bet candidate's **lifetime**: appear (created/updated over EV X) → disappear
      (deleted / updated below EV) with EV, odds, timestamps → `reports/ws-lifetime-log.csv`.
      2026-06-27 Codex note: after owner clarification, this is **not** a raw odds
      or `--min-odds` probe. The script now cross-checks each WS update against
      The Odds API and opens a lifetime only after the existing strict rule confirms
      Pinnacle EV plus 3-book consensus EV over the 10% floor.
      Decision input is strict confirmed >=10% +EV lifetime data, not raw 17->12
      price movement.
- [ ] **Decision (record in WORKLOG):** if a meaningful share of real strict ≥10% edges live
      **< ~2–5 min**, WebSocket pays for itself → propose buying it as a separate reviewed
      change. If they live **> ~10 min**, tighten polling cadence (Workstream A) instead —
      don't pay. Use the Iraq/Senegal case to see whether 17→12 was a catchable real edge
      or a stale display (cross-check `/odds/movements`).
      2026-06-27 follow-up: P8 live-shadow audit is now installed as a scheduled
      measurement-only collector (`Bet-Live-Shadow`, every 2h). It records every
      evaluated strict-EV live WebSocket candidate to `reports/ws-live-shadow-audit.csv`
      and confirmed appear/disappear lifetimes to `reports/ws-lifetime-log.csv`.
      The buy/don't-buy decision still needs real rows from the running collector.
- [ ] Verify: connects, logs ≥1 full appear→disappear lifecycle, reconnects via `lastSeq`,
      leaks no secret.
      2026-06-27 Codex smoke: connected successfully for 3 seconds with key redacted
      and welcome showed Stoiximan/Novibet; full lifecycle still needs a longer run.

## Workstream D — Live betting (P8): scope-only groundwork

No build now — document the path for the next milestone:
`docs/superpowers/plans/2026-06-27-p8-live-betting-scope.md`.

- Building blocks: Odds-API.io WebSocket **scores**/**status** channels, `/events/live`
  (clock/minute/period), `/odds/movements` + paid `/dropping-odds`.
- Under §0 #2: live betting = **faster in-play alerts to the human**, never automated
  placement. Strict dual-confirmation still applies and needs a live sharp reference (The
  Odds API in-play coverage TBD — the open P8 scoping question).
- Workstream C's instrument is the first concrete step toward this.
- 2026-06-27 follow-up: `docs/superpowers/plans/2026-06-27-p8-live-shadow-plan.md`
  documents the implemented live-shadow measurement layer. It is not a betting
  implementation; it only collects audit/lifetime evidence for future P8 decisions.

---

## Verification (end-to-end)

- `cd provider-harness && node --test` stays green (new tests: historical client method,
  quota-guard change, any pure WS-parsing helpers).
- A: live `scan` then `clv` → more fixtures/rows; guard trips at the new floor.
- B: tiny-window dry-run → full ½-season pull → calibration report with reliability /
  Brier / log-loss on an OOS split.
- C: `node scripts/ws-lifetime-probe.mjs` logs full lifecycles; WORKLOG records verdict.
- Secrets check: grep reports/logs for any key fragment → none.

## References

- Private origin plan (Claude): `~/.claude/plans/gleaming-bubbling-meerkat.md`.
- Go/no-go probe + cost model (already built): `provider-harness/scripts/historical-probe.mjs`.
- Prior plans: `docs/superpowers/plans/2026-06-25-multisport-mispricing-alerts.md`,
  `docs/superpowers/plans/2026-06-26-boost-mix-exotic-markets.md`.
