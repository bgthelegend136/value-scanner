# Boost Mix Exotic Markets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a manual `boost-mix` checker that can price boosted combos with API-backed exotic soccer legs while clearly labeling unsupported or missing-reference legs as estimates only.

**Architecture:** Keep the existing strict verifier honest: verified legs require Pinnacle plus at least three non-excluded consensus books. Add event-level odds retrieval for additional markets, normalize only markets with clear two- or three-way shapes, and put mixed verified/estimated combo math in a dedicated module used by a new CLI command. No estimated result feeds Telegram alerts.

**Tech Stack:** Node.js ES modules, built-in `fetch`, built-in `node:test`, no runtime dependencies.

## Global Constraints

- No scraping, login, auto-betting, or bookmaker URL fabrication.
- No secrets in logs, reports, errors, tests, or commits.
- New behavior must be covered by failing tests first.
- `boost-combo` remains strict and fail-closed.
- `boost-mix` output must say `FULLY_VERIFIED`, `MIXED_ESTIMATE`, or `UNVERIFIABLE`.
- Estimated legs are manual-decision output only and never generate alerts.

---

### Task 1: Event-Level Odds Endpoint

**Files:**
- Modify: `provider-harness/src/theodds_client.mjs`
- Modify: `provider-harness/test/theodds_client.test.mjs`

**Interfaces:**
- Produces: `client.getEventOdds({ sportKey, eventId, regions = "eu", markets, oddsFormat = "decimal" })`.

- [ ] Write a failing test that asserts `getEventOdds` calls `/v4/sports/{sportKey}/events/{eventId}/odds`, passes `regions`, `markets`, and `oddsFormat`, and returns quota headers.
- [ ] Run `node --test test/theodds_client.test.mjs` and verify the test fails because `getEventOdds` is missing.
- [ ] Implement `getEventOdds` using the existing private `request` helper.
- [ ] Re-run `node --test test/theodds_client.test.mjs` and verify green.

### Task 2: Normalize Safe Exotic Markets

**Files:**
- Modify: `provider-harness/src/theodds_normalize.mjs`
- Modify: `provider-harness/test/theodds_normalize.test.mjs`

**Interfaces:**
- Produces normalized markets: `DOUBLE_CHANCE`, `BTTS`, `TEAM_TOTALS`, `CORNERS_TOTALS`, `CARDS_SPREAD`, `PLAYER_GOALSCORER`, `PLAYER_SHOTS`, `PLAYER_SHOTS_ON_TARGET`.
- All rows keep the existing selection shape: `{ bookmaker, eventId, market, line, outcome, decimalOdds, quoteUpdatedAt }`.

- [ ] Write failing tests with a minimal event-level odds fixture covering `double_chance`, `btts`, `team_totals`, `alternate_team_totals`, `alternate_totals_corners`, `alternate_spreads_cards`, `player_goal_scorer_anytime`, `player_shots`, and `player_shots_on_target`.
- [ ] Include duplicate featured/alternate total rows and assert duplicates collapse per bookmaker/market/line/outcome.
- [ ] Run `node --test test/theodds_normalize.test.mjs` and verify the new tests fail.
- [ ] Implement exact mapping and deduplication. Do not guess unsupported market names.
- [ ] Re-run `node --test test/theodds_normalize.test.mjs` and verify green.

### Task 3: Boost Mix Pricing Core

**Files:**
- Create: `provider-harness/src/boost_mix.mjs`
- Create: `provider-harness/test/boost_mix.test.mjs`

**Interfaces:**
- Produces `parseMixLeg(token)` for leg tokens such as `1`, `X2`, `O2.5`, `BTTS_YES`, `TEAM:USA:O1.5`, `CORNERS:O9.5`, `CARDS:USA:+0.5`, `PLAYER:Ricardo Pepi:GOAL`, `PLAYER:Ricardo Pepi:SHOTS_OT:0.5`.
- Produces `priceMixLeg(selections, eventId, legSpec, { now })`.
- Produces `analyzeBoostMix({ boostedOdds, legResults })`.

- [ ] Write failing tests for a fully verified two-leg combo.
- [ ] Write failing tests for one verified plus one estimate-only leg producing `MIXED_ESTIMATE`.
- [ ] Write failing tests for missing reference and unsupported tokens producing `UNVERIFIABLE` or `ESTIMATE_ONLY` without throwing.
- [ ] Run `node --test test/boost_mix.test.mjs` and verify RED.
- [ ] Implement with existing `devigPower`, `MARKET_MARGINS`, and the same freshness rule used by `boost_legs.mjs`.
- [ ] Re-run `node --test test/boost_mix.test.mjs` and verify green.

### Task 4: `boost-mix` CLI

**Files:**
- Modify: `provider-harness/src/cli.mjs`
- Create: `provider-harness/test/cli_boost_mix.test.mjs`

**Interfaces:**
- Adds command:
  `boost-mix --boost=ODDS --leg="sportKey;home;away;date;pick" --leg=...`
- Uses `getEventOdds` with additional markets for one event at a time.

- [ ] Write a failing CLI test where both legs are verified and output includes `FULLY_VERIFIED`.
- [ ] Write a failing CLI test where a player leg has no reference and output includes `MIXED_ESTIMATE` plus an explicit estimate warning.
- [ ] Write a failing CLI test that fewer than two legs prints usage and returns `1`.
- [ ] Run `node --test test/cli_boost_mix.test.mjs` and verify RED.
- [ ] Implement `runBoostMix` and dispatch in `runCli`.
- [ ] Re-run `node --test test/cli_boost_mix.test.mjs` and verify green.

### Task 5: Verification and Live Fixture Check

**Files:**
- Modify docs only if command usage needs README/HANDOFF update.

- [ ] Run `npm test` from `provider-harness`.
- [ ] Run live reference checks for `Paraguay vs Australia` and `Turkey vs USA`.
- [ ] Report strict verified values separately from mixed estimates.
