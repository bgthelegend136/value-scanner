# Fast Paper Volume Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reach roughly 200 paper observations by the end of 2026-06-27 or 2026-06-28 by widening paper-only sampling without changing Telegram/live-alert rules.

**Architecture:** Keep the existing `scan` pipeline, reference pricing, paper ledger, CLV, and settlement. Add an opt-in control-sampling band so paper scan can record priced selections below the value threshold as `CONTROL` rows. This makes the dataset useful for `computed EV -> CLV` regression instead of collecting only rare high-positive edges.

**Tech Stack:** Node.js 22 ESM, built-in `node:test`, PowerShell scheduled tasks, local CSV reports.

## Global Constraints

- Paper-only: no Telegram, no live alert floor change, no auto-betting.
- Every paper row must still have a matched The Odds API reference event and Pinnacle fair probability.
- No secrets in reports/logs/errors/commits.
- Keep The Odds API reserve guard.

---

## Tasks

- [x] Add `CONTROL` as a valid paper tier.
- [x] Add `scan --sample-min-ev=N --sample-limit=M` to include priced rows with EV >= N percent, even when EV is below `--edge`.
- [x] Preserve the clean value report as value-only; use the ledger for sampled rows.
- [x] Add `--sample-repeat` so later scan timestamps can record the same selection as a distinct CLV observation.
- [x] Make `run-paper-scan.ps1` aggressive: `scan --edge=0 --sample-min-ev=-5 --sample-limit=250 --sample-repeat`.
- [x] Reinstall `Bet-Paper-Scan` hourly so multiple snapshots can add new odds/fixtures quickly.
- [x] Verify with TDD, full tests, live scan, and value-flow report.

## Result

Live run on 2026-06-27 grew `reports/paper-bets.csv` from 28 to 154 rows:
`CONTROL=108`, `VALUE=46`, `MATCH_RESULT=134`, `TOTALS=20`. With the hourly
task installed, one more similar snapshot should push the ledger above 200 rows.
