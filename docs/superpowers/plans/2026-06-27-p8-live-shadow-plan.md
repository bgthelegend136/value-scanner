# P8 Live Shadow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans
> to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for
> tracking.

**Goal:** Turn the existing strict WebSocket lifetime probe into a measurement-only
live-shadow collector that records both confirmed lifetimes and rejected/covered
candidate evaluations.

**Architecture:** Keep `scripts/ws-lifetime-probe.mjs` as the single WebSocket
measurement engine. Add an audit CSV path that records every evaluated Stoiximan /
Novibet ML candidate with its strict confirmation result. Add PowerShell runner
and installer scripts for a live-shadow scheduled task.

**Tech Stack:** Node.js 22 ESM, built-in global `WebSocket`, built-in `node:test`,
PowerShell Task Scheduler scripts. No runtime dependencies.

## Global Constraints

- Measurement-only: no Telegram, no scraping, no login, no auto-betting.
- Do not change `src/mispricing_thresholds.mjs` or the 10% live alert floor.
- Every confirmed row must still use Pinnacle fair EV plus 3-book consensus.
- Missing, stale, ambiguous, or unsupported reference data must fail closed.
- No secrets in logs, CSVs, errors, or commits.

---

### Task 1: Audit Rows From Strict WebSocket Evaluation

**Files:**
- Modify: `provider-harness/scripts/ws-lifetime-probe.mjs`
- Test: `provider-harness/test/ws_lifetime_probe.test.mjs`

**Interfaces:**
- Produces: `evaluateStrictEvMessageWithAudit(state, message, options)` returning
  `{ closed, audit }`.
- Keeps: `evaluateStrictEvMessage(...)` returning only `closed` for compatibility.

- [ ] Write a failing test that one rejected live update produces an audit row with
      `status=REJECTED`, `reason`, bookmaker, match, sport key, and offered odds.
- [ ] Run `node --test test/ws_lifetime_probe.test.mjs` and verify RED.
- [ ] Implement audit row formatting and the wrapper function.
- [ ] Run the focused test and verify GREEN.

### Task 2: Live-Shadow CSV Output

**Files:**
- Modify: `provider-harness/scripts/ws-lifetime-probe.mjs`
- Test: `provider-harness/test/ws_lifetime_probe.test.mjs`

**Interfaces:**
- CLI flag: `--audit-output=<path>`.
- Default when `--live-shadow` is set:
  `reports/ws-live-shadow-audit.csv`.

- [ ] Write a failing test for `liveShadowAuditPath({ argv, reportsDir })`.
- [ ] Implement `--audit-output` / `--live-shadow` path selection.
- [ ] Wire `runProbe` to append audit rows without changing lifetime output.
- [ ] Run focused tests.

### Task 3: PowerShell Runner And Installer

**Files:**
- Create: `provider-harness/scripts/run-live-shadow-probe.ps1`
- Create: `provider-harness/scripts/install-live-shadow-task.ps1`
- Test: `provider-harness/test/live_shadow_scripts.test.mjs`

**Interfaces:**
- Runner command:
  `node scripts/ws-lifetime-probe.mjs --live-shadow --status=live --channels=odds,scores,status --duration-minutes=120`
- Scheduled task: `Bet-Live-Shadow`, repeat every 2 hours, `WakeToRun`,
  `StartWhenAvailable`, no Telegram keys required.

- [ ] Write failing script tests that check command flags and scheduler settings.
- [ ] Add the two PowerShell scripts.
- [ ] Run focused script tests.

### Task 4: Verification And Handoff

**Files:**
- Modify: `HANDOFF-CODEX.md`
- Modify: `provider-harness/WORKLOG-2026-06-27.md`

- [ ] Run focused tests.
- [ ] Run full `npm test`.
- [ ] Run a short live smoke:
      `node scripts/ws-lifetime-probe.mjs --live-shadow --status=live --duration-minutes=0.05`.
- [ ] Record whether the smoke connected and whether audit rows appeared.
- [ ] Update handoff/worklog and commit.
