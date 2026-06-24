# Odds-API.io Regional Validation Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a quota-safe CLI that fetches Superbet and Stoiximan football odds, creates sanitized manual-comparison CSVs, and evaluates Greek-site observations.

**Architecture:** A dependency-free Node.js 22 package separates environment loading, provider HTTP calls, normalization, CSV persistence, comparison metrics, and CLI orchestration. Provider responses are normalized in memory and only sanitized selections are retained.

**Tech Stack:** Node.js 22, built-in `fetch`, built-in `node:test`, ES modules, CSV/JSON files.

## Global Constraints

- API key is read only from `.env.local` and is never printed or persisted.
- No bookmaker-site automation, scraping, alerts, or betting.
- Raw API responses are not retained by default.
- Target bookmakers are exactly `Superbet` and `Stoiximan`.
- Only pre-match full-time markets enter the comparison.
- Superbet Double Chance is `NOT_APPLICABLE`.
- Manual site observation and API receipt must be no more than 10 seconds apart.

---

### Task 1: Project Skeleton and Secret Loading

**Files:**
- Create: `provider-harness/package.json`
- Create: `provider-harness/src/env.mjs`
- Create: `provider-harness/test/env.test.mjs`

**Interfaces:**
- Produces: `loadEnvFile(path): Promise<Record<string,string>>`
- Produces: `requireApiKey(env): string`

- [ ] **Step 1: Write failing tests**

Test parsing `ODDS_API_IO_KEY=value`, ignoring comments, rejecting a missing or
blank key, and ensuring thrown errors never include a supplied key.

- [ ] **Step 2: Verify RED**

Run: `node --test test/env.test.mjs`
Expected: FAIL because `src/env.mjs` does not exist.

- [ ] **Step 3: Implement minimal secret loading**

Use `node:fs/promises`; parse only simple `KEY=value` lines; return a trimmed
key; emit `ODDS_API_IO_KEY is missing from .env.local` for missing input.

- [ ] **Step 4: Verify GREEN**

Run: `node --test test/env.test.mjs`
Expected: all environment tests pass.

### Task 2: Canonical Selection Normalization

**Files:**
- Create: `provider-harness/src/normalize.mjs`
- Create: `provider-harness/test/normalize.test.mjs`
- Create: `provider-harness/test/fixtures/odds-response.json`

**Interfaces:**
- Produces: `normalizeOddsResponse(payload, receivedAt): CanonicalSelection[]`
- `CanonicalSelection` fields: provider, bookmaker, eventId, competition,
  kickoffUtc, homeTeam, awayTeam, period, market, line, outcome, decimalOdds,
  quoteUpdatedAt, receivedAt, regionalStatus.

- [ ] **Step 1: Write failing fixture-based tests**

Cover ML home/draw/away, totals with exact lines, BTTS, Stoiximan Double Chance,
ignored non-full-time markets, and missing Superbet Double Chance.

- [ ] **Step 2: Verify RED**

Run: `node --test test/normalize.test.mjs`
Expected: FAIL because normalization is absent.

- [ ] **Step 3: Implement minimal normalization**

Map documented Odds-API.io market arrays into stable rows. Preserve decimal
values without display rounding. Set `regionalStatus` to `UNVERIFIED`.

- [ ] **Step 4: Verify GREEN**

Run: `node --test test/normalize.test.mjs`
Expected: all normalization tests pass.

### Task 3: Comparison and Metrics

**Files:**
- Create: `provider-harness/src/compare.mjs`
- Create: `provider-harness/test/compare.test.mjs`

**Interfaces:**
- Produces: `compareObservation(selection, manual): ComparisonResult`
- Produces: `summarizeComparisons(results): StratumSummary[]`

- [ ] **Step 1: Write failing tests**

Cover exact match, acceptable match, large mismatch, 10-second skew rejection,
exact-line mismatch, period mismatch, missing selection, and grouping by
bookmaker plus market.

- [ ] **Step 2: Verify RED**

Run: `node --test test/compare.test.mjs`
Expected: FAIL because comparison functions are absent.

- [ ] **Step 3: Implement minimal calculations**

Calculate absolute decimal difference, signed implied-probability difference,
classification, and per-stratum rates. Identity mismatches must fail before
price calculations.

- [ ] **Step 4: Verify GREEN**

Run: `node --test test/compare.test.mjs`
Expected: all comparison tests pass.

### Task 4: CSV Round Trip

**Files:**
- Create: `provider-harness/src/csv.mjs`
- Create: `provider-harness/test/csv.test.mjs`

**Interfaces:**
- Produces: `writeCsv(path, rows, columns): Promise<void>`
- Produces: `readCsv(path): Promise<Record<string,string>[]>`

- [ ] **Step 1: Write failing tests**

Cover commas, quotes, newlines, blank line values, deterministic columns, and
round-trip preservation.

- [ ] **Step 2: Verify RED**

Run: `node --test test/csv.test.mjs`
Expected: FAIL because CSV helpers are absent.

- [ ] **Step 3: Implement RFC-4180-compatible helpers**

Use UTF-8 and quoted-field parsing without adding a package dependency.

- [ ] **Step 4: Verify GREEN**

Run: `node --test test/csv.test.mjs`
Expected: all CSV tests pass.

### Task 5: Odds-API.io Client

**Files:**
- Create: `provider-harness/src/client.mjs`
- Create: `provider-harness/test/client.test.mjs`

**Interfaces:**
- Produces: `createOddsApiClient({apiKey, fetchImpl, baseUrl})`
- Client methods: `listEvents({sport, limit})`, `getOdds({eventId, bookmakers})`
- Responses include parsed data, local receipt time, and redacted rate-limit
  headers.

- [ ] **Step 1: Write failing tests with a local fake fetch**

Assert documented URLs:
`/v3/events?apiKey=...&sport=football&limit=...` and
`/v3/odds?apiKey=...&eventId=...&bookmakers=Superbet%2CStoiximan`.
Assert non-2xx errors redact the key.

- [ ] **Step 2: Verify RED**

Run: `node --test test/client.test.mjs`
Expected: FAIL because the client is absent.

- [ ] **Step 3: Implement minimal client**

Use `URL` and `URLSearchParams`, capture `x-ratelimit-limit`,
`x-ratelimit-remaining`, and `x-ratelimit-reset`, and never serialize the
request URL in errors.

- [ ] **Step 4: Verify GREEN**

Run: `node --test test/client.test.mjs`
Expected: all client tests pass.

### Task 6: CLI Workflow

**Files:**
- Create: `provider-harness/src/cli.mjs`
- Create: `provider-harness/test/cli.test.mjs`
- Create: `provider-harness/README.md`
- Create directory: `provider-harness/reports/`

**Interfaces:**
- Command: `node src/cli.mjs events`
- Command: `node src/cli.mjs capture <eventId>`
- Command: `node src/cli.mjs evaluate <capture.csv>`

- [ ] **Step 1: Write failing command tests**

Test argument validation, event listing output without raw JSON, capture CSV
columns, evaluation summary, and no API-key leakage.

- [ ] **Step 2: Verify RED**

Run: `node --test test/cli.test.mjs`
Expected: FAIL because the CLI is absent.

- [ ] **Step 3: Implement commands**

`events` lists a bounded set of upcoming football fixtures. `capture` fetches
only Superbet and Stoiximan, writes sanitized canonical rows plus blank
`siteOdds`, `siteObservedAt`, and `notes` columns. `evaluate` validates completed
manual rows and prints plus writes per-stratum results.

- [ ] **Step 4: Verify GREEN**

Run: `node --test test/cli.test.mjs`
Expected: all CLI tests pass.

- [ ] **Step 5: Run full verification**

Run: `npm test`
Expected: all tests pass with no secret output.

### Task 7: Quota-Safe Live Smoke Test

**Files:**
- Modify only if needed: `provider-harness/README.md`

**Interfaces:**
- Uses the existing root `.env.local`.

- [ ] **Step 1: Validate the key without printing it**

Run the `events` command once with a limit of five.
Expected: fixture list or a clear redacted provider error.

- [ ] **Step 2: Inspect rate-limit metadata**

Confirm remaining quota is reported without the key.

- [ ] **Step 3: Capture one selected event**

Make one `/v3/odds` request for Superbet and Stoiximan and write a sanitized CSV.

- [ ] **Step 4: Verify report contents**

Confirm the CSV contains no API key, raw URLs, or unrequested bookmakers.

