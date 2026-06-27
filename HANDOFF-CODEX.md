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

> **Status update 2026-06-28 (soccer-only market expansion).**
> Added a research-only soccer market profile for `theodds-sweep`:
> `--market-profile=soccer-core`. It uses The Odds API Event Odds endpoint for
> `h2h,h2h_3_way,draw_no_bet,btts,double_chance`, filters to `soccer_*` sports,
> and supports `--event-limit` plus `--max-event-credits` to cap credit spend.
> No US-style markets (`spreads`, team totals, alternates, props) were added.
> Normalization now maps `draw_no_bet` to `DRAW_NO_BET` and `h2h_3_way` to the
> existing `MATCH_RESULT` bucket. Paper CLV capture now calls event odds for
> pending soccer `DRAW_NO_BET`/`BTTS`/`DOUBLE_CHANCE` rows, so these markets can
> become real VALUE CLV samples instead of dead paper rows. First capped live
> run: `--market-profile=soccer-core --edge=0 --sample-min-ev=-5
> --sample-limit=150 --max-sports=8 --event-limit=4 --max-event-credits=150`
> used **133** credits, wrote **14** VALUE and **150** CONTROL rows, but the
> usable audit rows were all `MATCH_RESULT`; current extra-market coverage did
> not pass the consensus/value filters. Verification: `npm test` **244/244**.
>
> **Status update 2026-06-28 (forward CLV calibration).**
> Added `node src/cli.mjs clv-calibrate`, an offline calibration report over
> `reports/paper-bets.csv`. It excludes rows without valid captured CLV, writes
> `reports/clv-calibration.csv` and `.json`, and reports EV buckets, VALUE vs
> CONTROL, sport/market/bookmaker/odds-bucket segments, plus `clv ~ computed_ev`
> regression. It does not load API keys or spend credits. First live run:
> **393** captured rows, average CLV **-1.02%**, regression slope **+0.9051**,
> R^2 **0.2537**. Key split: VALUE **83** rows, avg CLV **+2.18%**, beat rate
> **80.7%**; CONTROL **307** rows, avg CLV **-1.91%**, beat rate **21.8%**.
> EV buckets are monotonic through 2-5% (`0..2%` avg CLV +0.79%, `2..5%`
> +3.71%); `5..10%` has only 3 rows and is not reliable. TOTALS remain weak:
> 43 rows, avg CLV -3.34%. Verification: `npm test` **242/242 passing**.
>
> **Status update 2026-06-27 (The Odds API sweep for fast research volume).**
> Corrected the coverage strategy after re-reading the documented limitations:
> Odds-API.io remains limited to the selected Stoiximan/Novibet account scope,
> so fast research volume now comes from The Odds API directly. Added
> `node src/cli.mjs theodds-sweep`, a paper-only cross-book market sweep that
> queries active The Odds API sports (`h2h,totals` with per-sport fallback to
> `h2h`), computes leave-one-book-out consensus fair probabilities, writes
> value rows plus EV-band controls into `reports/paper-bets.csv`, and writes a
> gitignored `reports/theodds-sweep-*.csv` audit file. It never uses
> Odds-API.io, Telegram, scraping, or auto-betting. Live run:
> `--edge=0.5 --sample-min-ev=-5 --sample-limit=250 --max-sports=12
> --markets=h2h,totals --regions=eu` used **18** The Odds API credits, skipped
> 3 unsupported sports, produced **2134** audit rows, **32** value rows and
> **250** controls. Paper ledger is now **584** rows (`VALUE/VALUE_CHECK=110`,
> `CONTROL=474`). Interpretation: this solves forward research volume, but these
> rows are a cross-book research dataset, not Stoiximan/Novibet-only actionable
> evidence. Verification: focused sweep tests passing; run full test before next
> commit/merge.
>
> **Status update 2026-06-27 (live coverage widening attempt).** Added
> `--target-bookmakers=ALL` to the measurement-only WebSocket probe and live
> shadow runner so local training/audit filters no longer discard non
> Stoiximan/Novibet odds if the provider account sends them. Runtime
> `Bet-Live-Shadow` was restarted on the new runner; an orphan old process was
> stopped, leaving one probe with `--target-bookmakers=ALL`. Provider-side
> widening is blocked: official `PUT /bookmakers/selected/select` returned 403
> for both 5-book and 2-book widening attempts:
> "allowed max 2 bookmakers; allowed: Stoiximan, Novibet". REST `GET /odds` for
> Bet365/Unibet also returned 403 under the same account restriction. Therefore
> live training can only accelerate after the Odds-API.io plan/allowed
> bookmakers are changed, or by using a different provider path. Verification:
> full `npm test` / `node --test` **238/238 passing**.
>
> **Status update 2026-06-27 (quant methodology fixes).** Fixed two audit
> failures without changing Telegram/live-alert rules. First, the scheduled
> paper runner no longer passes `--sample-repeat`; future `Bet-Paper-Scan`
> runs dedupe by selection, so row count does not overstate independent betting
> evidence. Existing repeated rows remain in `reports/paper-bets.csv` and must
> be clustered by selection/event in analysis. Second, live shadow/training now
> writes `reports/ws-live-feed-stats.csv` for every WebSocket message when
> `--live-shadow` or `--live-training` is enabled. This records message type,
> bookmaker, markets, generated audit/training/closed row counts, and rejection
> reason counts, without secrets. `Bet-Live-Shadow` was restarted and one node
> probe is running; the feed stats file has started with `welcome`/`score` rows,
> while no odds/live training row has arrived yet. A zero-credit forensic audit
> (`--max-credits=0`) confirmed the new feed stats are included without spending
> credits. Verification: focused tests plus full `npm test` / `node --test`
> **237/237 passing**.
>
> **Status update 2026-06-27 (forensic audit implemented and run).** Added a
> read-only forensic audit command:
> `node src/cli.mjs forensic-audit [--max-credits=N]`. It writes gitignored
> `reports/forensic-audit-summary.json`,
> `reports/forensic-audit-findings.csv`, and
> `reports/forensic-audit-report.md`, with hard cap `maxCredits <= 1000` and
> conservative 30-credit estimates per paid sport probe. Live run with
> `--max-credits=1000` used 6 The Odds API probes (`h2h,totals`), estimated
> 180 credits, actual **12** credits, quota after final probe **15872**. Main
> findings: paper rows **299** but only **84** unique selection keys
> (`215` repeat observations), CLV captured **19**, settled **7**, live
> status rows **32** but live training rows **0**, one WebSocket probe process
> running. Interpretation: current row volume is not independent evidence;
> no ROI/model conclusion yet; live connection is alive but not producing
> odds-training rows. Verification: focused TDD plus full `npm test` /
> `node --test` **235/235 passing**.
>
> **Status update 2026-06-27 (live training pipeline enabled).** P8 live remains
> measurement-only: no Telegram, no auto-betting, no scraping/login, and no
> 10% alert-floor change. `scripts/ws-lifetime-probe.mjs` now has opt-in
> `--live-training` and writes a separate
> `reports/live-training-observations.csv` ledger for EV-banded in-play rows
> (`LIVE_CONTROL`, `LIVE_VALUE`, `STRICT_CONFIRMED`) with Pinnacle fair prob,
> 3-book consensus prob, min confirmed EV, score/status context, and rejection
> reason. It also writes `reports/live-event-status.csv` for score/status rows
> that can later be joined for live settlement/labeling. Live shadow now requests
> `--markets=ML,Totals`; strict confirmation supports `TOTALS` as `OVER/UNDER`
> while preserving the same Pinnacle + 3-book consensus rule. Runtime
> `Bet-Live-Shadow` was restarted on the new runner, an orphan old node probe
> from the 14:00 run was stopped, and exactly one new live probe remains running.
> Runtime evidence: `reports/live-event-status.csv` already has score rows; no
> live training odds row had arrived in the short post-restart check. Verification:
> focused TDD plus full `npm test` / `node --test` **231/231 passing**.
>
> **Status update 2026-06-27 (fast paper volume mode).** To make ~200 paper
> observations reachable today/tomorrow, paper `scan` now has opt-in sampling flags:
> `--sample-min-ev=N`, `--sample-limit=M`, and `--sample-repeat`. The aggressive
> runner uses `node src/cli.mjs scan --edge=0 --sample-min-ev=-5 --sample-limit=250
> --sample-repeat`, so it records all positive-EV paper rows plus a capped `CONTROL`
> sample down to -5% EV. `--sample-repeat` treats the same selection in a later scan
> timestamp as a distinct paper observation for CLV-vs-EV regression; default scan
> dedupe behavior is unchanged. `Bet-Paper-Scan` was reinstalled hourly (`PT1H`,
> `WakeToRun=True`). Live application: paper ledger grew from 28 to **154** rows
> after two manual scans (`CONTROL=108`, `VALUE=46`, `MATCH_RESULT=134`,
> `TOTALS=20`); the next hourly run should push it over ~200 if inventory is similar.
> Telegram/live-alert rules and the 10% floor are unchanged. Verification:
> focused TDD plus full `npm test` / `node --test` **224/224 passing**.
>
> **Status update 2026-06-27 (P8 live-shadow measurement enabled).** P8 moved from
> scope-only into **measurement-only live shadowing**, still with no Telegram, no
> auto-betting, no scraping/login, and no 10% floor change. `scripts/ws-lifetime-probe.mjs`
> now has an opt-in `--live-shadow`/`--audit-output` audit stream that records every
> evaluated strict-EV WebSocket candidate row, including rejected candidates, to
> `reports/ws-live-shadow-audit.csv`; the original `reports/ws-lifetime-log.csv`
> remains the appear/disappear lifetime log for confirmed strict `>=10% +EV`
> candidates. New runner/installer scripts are
> `scripts/run-live-shadow-probe.ps1` and `scripts/install-live-shadow-task.ps1`.
> Runtime task `Bet-Live-Shadow` is installed Ready, repeats every 2h, wakes the
> computer, ignores overlapping runs, and runs for up to 3h. Smoke run connected to
> Odds-API.io with `status=live` and `channels=odds,scores,status` with redacted key.
> Follow-up review fixed the live-shadow CSV writer: audit/lifetime rows are now
> append-only and serialized, avoiding full-file rewrites and concurrent `onmessage`
> write races that could lose measurement rows under bursty live updates. Verification:
> focused tests plus full `npm test` / `node --test` **223/223 passing**.
>
> **Status update 2026-06-27 (paper market widening + analysis design).** The
> paper-only collection path now prices both `MATCH_RESULT` and `TOTALS` against
> Pinnacle reference data. `src/cli.mjs` uses `PAPER_REFERENCE_MARKETS =
> "h2h,totals"` for paper `scan` and paper `clv`; Telegram/live-alert paths and
> the 10% floor are unchanged. This follows the official The Odds API `markets`
> contract (comma-separated markets; quota cost per market/region), and remains
> protected by the 1000-credit reserve. `value-flow-report` now includes
> `paper.market` and `scan.latest.market` counters, so widened-market volume is
> visible locally. Live verification after the change: 18 in-season leagues, 36
> matched fixtures, 12 value bets, 0 new paper bets / 12 duplicates, quota 16032;
> latest scan had `MATCH_RESULT` 138 rows and `TOTALS` 26 rows, but all totals
> were `NO_VALUE` (max totals EV -3.87%), so paper ledger remains
> `MATCH_RESULT=28`. Manual settlement was run: paper=28, settled=7, pending=21,
> 5W-2L; `Bet-Paper-Settle` remains Ready with `LastTaskResult=0`. Analysis
> design is recorded at
> `docs/superpowers/plans/2026-06-27-forward-clv-analysis-design.md`. Verification:
> TDD red/green plus `npm test` / `node --test` **218/218 passing**.
>
> **Status update 2026-06-27 (forward CLV volume plan applied).** To grow the
> forward CLV sample after the La Liga calibration showed the fair-value engine
> is sound, the paper-only collection path was made more aggressive without
> touching Telegram/live-alert rules. `scripts/run-paper-scan.ps1` now runs
> `node src/cli.mjs scan --edge=0.5` (paper ledger only; strict Telegram floor
> remains 10%). Paper CLV capture now has a CLI-only override
> `clv --window-minutes=N`; `scripts/run-paper-clv.ps1` uses
> `--window-minutes=40` so paper rows miss fewer near-close captures, while
> `mispricing-clv` still uses the original 20-minute live-alert window.
> `install-paper-clv-task.ps1` now repeats every 10 minutes and keeps
> `WakeToRun`. Runtime tasks were re-registered: `Bet-Paper-Scan` is 4h /
> `P3650D` / `WakeToRun=True`, `Bet-Paper-CLV` is 10m / `P3650D` /
> `WakeToRun=True`. Manual `scan --edge=0.5` ran live: 18 leagues, 36 matched
> fixtures, 12 value bets, 3 new paper bets, 9 duplicates, quota 16068. `clv
> --window-minutes=40` had no due rows, so zero spend. Latest no-quota
> `value-flow-report`: paper=28, audit=4981, latestScanRows=164, top rejection
> `CANDIDATE_EV_BELOW_MIN`=4746. No secrets, no Telegram, no auto-betting.
> Verification: focused TDD red/green, then `npm test` / `node --test`
> **216/216 passing**.
>
> **Status update 2026-06-27 (historical calibration — first real result).** Fixed a
> name-matching bug in `scripts/historical-calibration.mjs` (it calibrated 0 events
> before: required exact normalized names, but football-data.org spells clubs differently
> from The Odds API — "Deportivo Alavés" vs "Alavés"). New `clubNameMatches` (token-subset
> + distinctive token, fail-closed on ambiguity), +2 tests, `node --test` 215/215. Ran the
> full La Liga (`PD`, Aug–Dec 2025) calibration: 153/171 events, ~3,420 cr (quota 16,104).
> **All 4 de-vig methods beat the naive baseline** (Brier ~0.525 vs 0.640; logLoss ~0.89
> vs 1.06); method choice barely matters. Reliability roughly calibrated, mild ~3–4pp
> over-prediction in the 20–40% bucket. **Takeaway:** the fair-value engine is sound, so
> the low bet count is NOT a probability bug — ≥10% soft-book mistakes are genuinely rare;
> small longshot "edges" are slightly optimistic, treat skeptically when the floor is
> eventually lowered. Next gate stays forward CLV volume (~200 settled). See WORKLOG.
>
> **Status update 2026-06-27 (WebSocket probe corrected to strict EV).** The
> owner clarified that the Iraq 17→12 example was only a latency example; the
> measurement target is **not** raw odds (no `--min-odds=15`) but strict
> `>=10% +EV` under the existing alert metrics. `scripts/ws-lifetime-probe.mjs`
> now evaluates each Stoiximan/Novibet WebSocket ML update against The Odds API
> reference data before opening a lifetime: event match, Pinnacle fair EV, and
> 3-book consensus EV must all pass the same strict confirmation rule used by
> Telegram alerts. It writes `reports/ws-lifetime-log.csv` only when a confirmed
> edge closes, with first/peak/last odds and Pinnacle/consensus EV fields. It is
> still measurement-only: no Telegram, no auto-betting, no threshold change.
> Verification: focused WS tests plus full `npm test` / `node --test` **213/213
> passing**.
>
> **Status update 2026-06-27 (Codex executed post-paid roadmap core).** Workstream A
> is implemented: paper `scan` and strict `mispricing-scan` now keep a **1000-credit
> CLV reserve** (`MIN_SCAN_QUOTA`, `QUOTA_RESERVE`), and `Bet-Paper-Scan` installer
> now repeats every **4h** with no 3-day stop. No Telegram floor change. Current P4
> audit still has unmapped lower leagues/ITF/NBL1 groups, but a zero-credit active
> `/sports` check found **no safe The Odds API key matches**, so no forced mapping
> was added. Workstream B is implemented: `getHistoricalOdds` plus
> `scripts/historical-calibration.mjs` (read-only JSON/CSV report, multiplicative /
> Shin / power / consensus, Brier/log-loss/reliability, temporal OOS split). Outcome
> preflight rejected EPL/PL Aug-Dec 2025, but confirmed La Liga `PD` Aug-Dec 2025
> coverage (171 finished matches); 1-match tiny historical dry-run wrote
> `reports/historical-calibration-2026-06-27T05-36-38.243Z.*`, quota remaining
> **19900**. Workstream C is implemented as `scripts/ws-lifetime-probe.mjs` using
> Node 22 built-in `WebSocket`, `seq`/`lastSeq`, redacted URLs, and
> `reports/ws-lifetime-log.csv`; 3-second smoke connected and welcome showed
> Stoiximan/Novibet. Owner clarification replaced the initial raw high-price probe:
> the script now cross-checks WS updates against The Odds API and logs only strict
> confirmed `>=10% +EV` lifetimes. Workstream D scope is documented in
> `docs/superpowers/plans/2026-06-27-p8-live-betting-scope.md`. Live paper scan after
> A: 18 leagues, 35 matched fixtures, 7 value bets, 1 new paper bet, quota 19864;
> `clv` spent zero because no bet was inside the capture window; `value-flow-report`
> paper=25, audit=4297, latestScanRows=157, top rejection `CANDIDATE_EV_BELOW_MIN`
> =4078. Verification: `npm test` / `node --test` **210/210 passing**.
>
> **Status update 2026-06-27 (paid plan + WebSocket trial — roadmap).** The owner
> bought **The Odds API 20K plan (€30/mo)** → historical odds + 40× the old free
> credits (20,000 vs 500). Odds-API.io also granted a **2-day free WebSocket add-on**.
> New roadmap: `docs/superpowers/plans/2026-06-27-post-paid-plan-roadmap.md`. Four
> workstreams, all paper/measurement only, none touch the 10% Telegram floor or place
> bets: **(A)** relax the quota guards (`MIN_SCAN_QUOTA` in `cli.mjs`, `QUOTA_RESERVE`
> in `mispricing_scan.mjs`; reserve ~1,000 cr for CLV) and re-enable continuous
> `Bet-Paper-Scan` to grow forward CLV faster; **(B)** lean historical de-vig
> calibration (1 league, ½ season ≈ 3,800 cr) — add `getHistoricalOdds` to
> `theodds_client.mjs`, build `scripts/historical-calibration.mjs`, reliability/Brier/
> log-loss on an OOS split; pre-flight that football-data.org free covers the outcome
> window; NOT a strategy backtest (no soft books in historical); **(C)** **measure-only**
> WebSocket instrument `scripts/ws-lifetime-probe.mjs` (Node 22 built-in `WebSocket`, no
> dep) to log fleeting-edge lifetimes during the 2-day trial and decide buy/don't-buy —
> motivated by Stoiximan Iraq 17→12 vs Senegal; **(D)** live betting (P8) = scope-only
> groundwork (faster in-play alerts to the human, never auto-betting). A zero-credit
> go/no-go probe + verified cost model already exists: `scripts/historical-probe.mjs`.
> Standing diagnosis unchanged: bottleneck is the candidate EV floor, not coverage.
> 203/203 tests green at handoff; nothing implemented from this roadmap yet.
>
> **Status update 2026-06-27 (P4 paper coverage mapping).** Added 8
> paper-scan registry mappings from the Cursor/Odds-API.io probe after a fresh
> zero-cost The Odds API `/sports` check confirmed all reference keys active:
> EFL Championship, League One, League Two, Norway Eliteserien, Sweden
> Allsvenskan, DFB-Pokal, Finland Veikkausliiga, and WNBA. No Telegram,
> threshold, live-market, or settlement behavior changed. Live paper scan after
> mapping: 18 in-season leagues, 35 matched fixtures, 6 value bets, 2 new paper
> bets, 4 duplicates, The Odds API quota 221. `value-flow-report`: paper=22,
> audit=3943, latestScanRows=159, top rejection `CANDIDATE_EV_BELOW_MIN`=3731.
>
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

### P8 - Live/in-play mistakes: OPEN (scoping started 2026-06-27)

Likely where the biggest mistakes are, but needs a live odds source and faster loop. Scope before building. Keep pre-match flow and CLV data as the proof base first.

First concrete step is the **measure-only WebSocket instrument** (Workstream C of `docs/superpowers/plans/2026-06-27-post-paid-plan-roadmap.md`): use the Odds-API.io WebSocket trial to measure fleeting-edge lifetimes (the Iraq 17→12 case) before committing to any live pipeline. Building blocks for later: Odds-API.io `scores`/`status` channels, `/events/live`, `/odds/movements`. Under §0 #2 this stays *faster alerts to the human*, never auto-betting.

Implemented 2026-06-27: `scripts/ws-lifetime-probe.mjs` logs local lifetime rows
from the Odds-API.io WebSocket odds channel with key redaction and `lastSeq`
replay. After owner clarification, the probe no longer tracks raw high-price
windows; it opens lifetimes only for strict confirmed `>=10% +EV` candidates
using the same Pinnacle + 3-book consensus rule as Telegram alerts, then closes
them when confirmation fails, the selection disappears, or the market is deleted.
It is still measure-only and not wired to Telegram. The buy/don't-buy decision
still needs a longer run with at least one full confirmed-edge lifecycle.

### P9 - Historical de-vig calibration: OPEN (new 2026-06-27)

The €30 plan unlocks historical odds. Lean first pass (1 league, ½ season ≈ 3,800 cr): de-vig closing snapshots, join to free football-data.org outcomes, score reliability/Brier/log-loss on an OOS split to judge fair-value calibration — the evidence needed before any calibrated change to the 10% floor. See Workstream B of the roadmap. Pre-flight the outcome-source coverage before the full credit spend.

Implemented 2026-06-27: `src/theodds_client.mjs` has `getHistoricalOdds`, and
`scripts/historical-calibration.mjs` performs the preflight + read-only report.
football-data.org free returned 0 rows for EPL/PL Aug-Dec 2025, but La Liga `PD`
covered 171 finished matches in Aug-Dec 2025. A 1-match tiny historical pull
completed and wrote JSON/CSV reports. Full half-season pull is still a deliberate
next command (`--full`) after reviewing the tiny report.

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
