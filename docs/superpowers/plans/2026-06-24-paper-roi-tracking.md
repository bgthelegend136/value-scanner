# Paper ROI Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist each unique value alert as a one-unit paper bet, settle completed World Cup bets through The Odds API scores endpoint, and report realized profit and ROI.

**Architecture:** Extend the existing The Odds API client with scores, add one pure `paper.mjs` domain module for ledger identity/settlement/summary logic, then wire persistence into `scan` and a new `settle` command. CSV remains the only storage format; network and filesystem access stay in the CLI.

**Tech Stack:** Node.js 22, ES modules, built-in `fetch`, `node:test`, and the existing dependency-free CSV helper.

## Global Constraints

- Work in `provider-harness/`; add no runtime dependencies.
- Fixed paper stake is exactly `1.00` unit.
- Deduplicate by `referenceEventId + bookmaker + market + line + outcome`.
- Preserve the first observed odds, EV, tier, and timestamp.
- Settle only `MATCH_RESULT` and `TOTALS`; unsupported rows become `REVIEW`.
- The scores lookback is exactly `daysFrom=3`, costing 2 The Odds API credits.
- API keys, request URLs, and raw responses must never be persisted or printed.
- Existing scan reports are not backfilled.
- Tests must not make live API calls.

**Spec:** `docs/superpowers/specs/2026-06-24-paper-roi-tracking-design.md`

---

## File Structure

- Modify `provider-harness/src/theodds_client.mjs`: add the documented scores request.
- Create `provider-harness/src/paper.mjs`: pure ledger, settlement, P/L, ROI, and stale-row logic.
- Modify `provider-harness/src/cli.mjs`: persist paper bets during `scan`; add `settle`.
- Modify `provider-harness/test/theodds_client.test.mjs`: scores URL/quota coverage.
- Create `provider-harness/test/paper.test.mjs`: paper-domain behavior.
- Modify `provider-harness/test/cli_scan.test.mjs`: ledger creation and deduplication.
- Create `provider-harness/test/cli_settle.test.mjs`: end-to-end CLI settlement behavior with fake clients.
- Modify `provider-harness/README.md`: commands, formulas, quota, and limitations.

---

### Task 1: Add the scores client method

**Files:**
- Modify: `provider-harness/src/theodds_client.mjs`
- Modify: `provider-harness/test/theodds_client.test.mjs`

**Interfaces:**
- Consumes: existing internal `request(path, parameters)`.
- Produces: `client.getScores({ sportKey, daysFrom = 3, dateFormat = "iso" })`.

- [ ] **Step 1: Add the failing client test**

Append this test to `test/theodds_client.test.mjs`:

```javascript
test("calls the scores endpoint with a three-day completed-game window", async () => {
  const urls = [];
  const client = createTheOddsApiClient({
    apiKey: "secret",
    fetchImpl: async (url) => {
      urls.push(String(url));
      return jsonResponse([], {
        headers: {
          "x-requests-remaining": "496",
          "x-requests-used": "4",
          "x-requests-last": "2",
        },
      });
    },
  });

  const response = await client.getScores({
    sportKey: "soccer_fifa_world_cup",
  });

  const url = new URL(urls[0]);
  assert.equal(url.pathname, "/v4/sports/soccer_fifa_world_cup/scores");
  assert.equal(url.searchParams.get("daysFrom"), "3");
  assert.equal(url.searchParams.get("dateFormat"), "iso");
  assert.equal(url.searchParams.get("apiKey"), "secret");
  assert.deepEqual(response.quota, { remaining: 496, used: 4, lastCost: 2 });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
node --test --experimental-test-isolation=none test/theodds_client.test.mjs
```

Expected: FAIL with `client.getScores is not a function`.

- [ ] **Step 3: Add the minimal client implementation**

Add this method beside `getOdds` in the object returned by
`createTheOddsApiClient`:

```javascript
    getScores({ sportKey, daysFrom = 3, dateFormat = "iso" }) {
      return request(`/sports/${sportKey}/scores`, { daysFrom, dateFormat });
    },
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```powershell
node --test --experimental-test-isolation=none test/theodds_client.test.mjs
```

Expected: all client tests PASS.

- [ ] **Step 5: Commit**

```powershell
git add provider-harness/src/theodds_client.mjs provider-harness/test/theodds_client.test.mjs
git commit -m "feat: add World Cup scores client"
```

---

### Task 2: Implement the pure paper-bet domain

**Files:**
- Create: `provider-harness/src/paper.mjs`
- Create: `provider-harness/test/paper.test.mjs`

**Interfaces:**
- Produces:
  - `PAPER_COLUMNS`
  - `paperBetKey(row)`
  - `mergePaperBets(existingRows, opportunities, { firstSeenAt })`
  - `settlePaperBets(rows, scoreEvents)`
  - `summarizePaperBets(rows)`
  - `findStalePending(rows, now, { days = 3 } = {})`
- `opportunities` entries use the existing `{ result, fixture, consensus }`
  shape; only `result` and `fixture` are consumed.

- [ ] **Step 1: Create failing tests for identity and merge behavior**

Create `test/paper.test.mjs`:

```javascript
import assert from "node:assert/strict";
import test from "node:test";

import {
  findStalePending,
  mergePaperBets,
  paperBetKey,
  settlePaperBets,
  summarizePaperBets,
} from "../src/paper.mjs";

function opportunity(overrides = {}) {
  return {
    fixture: {
      referenceEventId: "ref-1",
      bettableEventId: "bet-1",
      kickoffUtc: "2026-06-25T18:00:00.000Z",
      homeTeam: "Spain",
      awayTeam: "Cape Verde",
    },
    result: {
      bookmaker: "Stoiximan",
      market: "MATCH_RESULT",
      line: "",
      outcome: "X",
      decimalOdds: 7.5,
      fairOdds: 6.33,
      fairProbability: 0.158,
      ev: 0.185,
      status: "SUSPICIOUS",
      ...overrides,
    },
  };
}

function pending(overrides = {}) {
  const { rows } = mergePaperBets([], [opportunity()], {
    firstSeenAt: "2026-06-24T12:00:00.000Z",
  });
  return { ...rows[0], ...overrides };
}

test("paper bet identity includes event, bookmaker, market, line, and outcome", () => {
  const base = pending();
  assert.notEqual(paperBetKey(base), paperBetKey({ ...base, bookmaker: "Superbet" }));
  assert.notEqual(paperBetKey(base), paperBetKey({ ...base, outcome: "1" }));
  assert.notEqual(
    paperBetKey({ ...base, market: "TOTALS", line: "2.5", outcome: "OVER" }),
    paperBetKey({ ...base, market: "TOTALS", line: "3.5", outcome: "OVER" }),
  );
});

test("merge records a one-unit bet once and preserves first observed values", () => {
  const first = opportunity();
  const initial = mergePaperBets([], [first], {
    firstSeenAt: "2026-06-24T12:00:00.000Z",
  });
  const later = opportunity({ decimalOdds: 8, ev: 0.264, status: "SUSPICIOUS" });
  const repeated = mergePaperBets(initial.rows, [later], {
    firstSeenAt: "2026-06-24T13:00:00.000Z",
  });

  assert.equal(initial.added, 1);
  assert.equal(repeated.added, 0);
  assert.equal(repeated.duplicates, 1);
  assert.equal(repeated.rows.length, 1);
  assert.equal(repeated.rows[0].decimalOdds, "7.5000");
  assert.equal(repeated.rows[0].firstSeenAt, "2026-06-24T12:00:00.000Z");
  assert.equal(repeated.rows[0].stake, "1.00");
  assert.equal(repeated.rows[0].status, "PENDING");
});

test("same selection at two bookmakers creates two paper bets", () => {
  const merged = mergePaperBets(
    [],
    [opportunity(), opportunity({ bookmaker: "Superbet" })],
    { firstSeenAt: "2026-06-24T12:00:00.000Z" },
  );
  assert.equal(merged.added, 2);
  assert.equal(merged.rows.length, 2);
});

test("rejects malformed existing ledger rows instead of silently rewriting them", () => {
  assert.throws(
    () => mergePaperBets([{ referenceEventId: "ref-1" }], [], {
      firstSeenAt: "2026-06-24T12:00:00.000Z",
    }),
    /missing bookmaker/,
  );
});
```

- [ ] **Step 2: Run the domain tests and verify RED**

Run:

```powershell
node --test --experimental-test-isolation=none test/paper.test.mjs
```

Expected: FAIL because `src/paper.mjs` does not exist.

- [ ] **Step 3: Implement identity, validation, conversion, and merge**

Create `src/paper.mjs` with:

```javascript
export const PAPER_COLUMNS = [
  "referenceEventId", "bettableEventId", "firstSeenAt", "kickoffUtc",
  "homeTeam", "awayTeam", "bookmaker", "market", "line", "outcome",
  "decimalOdds", "fairOdds", "fairProbability", "ev", "tier", "stake",
  "status", "homeScore", "awayScore", "profit", "settledAt",
];

const TERMINAL_STATUSES = new Set(["WON", "LOST", "PUSH", "REVIEW"]);
const SETTLED_STATUSES = new Set(["WON", "LOST", "PUSH"]);
const VALID_STATUSES = new Set(["PENDING", ...TERMINAL_STATUSES]);

function finite(value, name) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid paper bet ${name}: ${value}`);
  return parsed;
}

function required(value, name) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`Invalid paper bet: missing ${name}`);
  return text;
}

function validateRow(row) {
  for (const name of [
    "referenceEventId", "bettableEventId", "firstSeenAt", "kickoffUtc",
    "homeTeam", "awayTeam", "bookmaker", "market", "outcome", "tier", "status",
  ]) {
    required(row[name], name);
  }
  finite(row.decimalOdds, "decimalOdds");
  finite(row.fairOdds, "fairOdds");
  finite(row.fairProbability, "fairProbability");
  finite(row.ev, "ev");
  finite(row.stake, "stake");
  if (!VALID_STATUSES.has(row.status)) {
    throw new Error(`Invalid paper bet status: ${row.status}`);
  }
}

export function paperBetKey(row) {
  return [
    row.referenceEventId,
    row.bookmaker,
    row.market,
    row.line ?? "",
    row.outcome,
  ].map((value) => String(value)).join("|");
}

function paperRow({ result, fixture }, firstSeenAt) {
  return {
    referenceEventId: String(fixture.referenceEventId),
    bettableEventId: String(fixture.bettableEventId),
    firstSeenAt,
    kickoffUtc: fixture.kickoffUtc,
    homeTeam: fixture.homeTeam,
    awayTeam: fixture.awayTeam,
    bookmaker: result.bookmaker,
    market: result.market,
    line: String(result.line ?? ""),
    outcome: result.outcome,
    decimalOdds: result.decimalOdds.toFixed(4),
    fairOdds: result.fairOdds.toFixed(4),
    fairProbability: result.fairProbability.toFixed(6),
    ev: result.ev.toFixed(6),
    tier: result.status,
    stake: "1.00",
    status: "PENDING",
    homeScore: "",
    awayScore: "",
    profit: "",
    settledAt: "",
  };
}

export function mergePaperBets(existingRows, opportunities, { firstSeenAt }) {
  for (const row of existingRows) validateRow(row);
  const rows = existingRows.map((row) => ({ ...row }));
  const keys = new Set(rows.map(paperBetKey));
  let added = 0;
  let duplicates = 0;

  for (const opportunity of opportunities) {
    const row = paperRow(opportunity, firstSeenAt);
    const key = paperBetKey(row);
    if (keys.has(key)) {
      duplicates += 1;
      continue;
    }
    keys.add(key);
    rows.push(row);
    added += 1;
  }

  return { rows, added, duplicates };
}
```

- [ ] **Step 4: Run the identity/merge tests and verify GREEN**

Run:

```powershell
node --test --experimental-test-isolation=none test/paper.test.mjs
```

Expected: the first four tests PASS.

- [ ] **Step 5: Add failing settlement, ROI, and stale tests**

Append to `test/paper.test.mjs`:

```javascript
const drawScore = [{
  id: "ref-1",
  completed: true,
  home_team: "Spain",
  away_team: "Cape Verde",
  scores: [
    { name: "Spain", score: "1" },
    { name: "Cape Verde", score: "1" },
  ],
  last_update: "2026-06-25T20:00:00Z",
}];

test("settles match-result home, draw, and away outcomes", () => {
  const rows = [
    pending({ outcome: "1", decimalOdds: "2.0000" }),
    pending({ outcome: "X", decimalOdds: "3.5000" }),
    pending({ outcome: "2", decimalOdds: "4.0000" }),
  ];
  const settled = settlePaperBets(rows, drawScore);
  assert.deepEqual(settled.map((row) => row.status), ["LOST", "WON", "LOST"]);
  assert.deepEqual(settled.map((row) => row.profit), ["-1.0000", "2.5000", "-1.0000"]);
});

test("settles totals wins, losses, pushes, and quarter lines", () => {
  const base = { market: "TOTALS", outcome: "OVER" };
  const rows = [
    pending({ ...base, line: "1.5", decimalOdds: "1.9000" }),
    pending({ ...base, line: "2.5", decimalOdds: "1.9000" }),
    pending({ ...base, line: "2", decimalOdds: "1.9000" }),
    pending({ ...base, line: "2.25", decimalOdds: "1.9000" }),
  ];
  const settled = settlePaperBets(rows, drawScore);
  assert.deepEqual(settled.map((row) => row.status), ["WON", "LOST", "PUSH", "REVIEW"]);
  assert.deepEqual(settled.map((row) => row.profit), ["0.9000", "-1.0000", "0.0000", ""]);
});

test("marks unknown markets and outcomes for review", () => {
  const rows = [
    pending({ outcome: "UNKNOWN" }),
    pending({ market: "BTTS", outcome: "YES" }),
  ];
  assert.deepEqual(
    settlePaperBets(rows, drawScore).map((row) => row.status),
    ["REVIEW", "REVIEW"],
  );
});

test("leaves missing, incomplete, and malformed score events pending", () => {
  const row = pending();
  assert.equal(settlePaperBets([row], [])[0].status, "PENDING");
  assert.equal(
    settlePaperBets([row], [{ ...drawScore[0], completed: false }])[0].status,
    "PENDING",
  );
  assert.equal(
    settlePaperBets([row], [{ ...drawScore[0], scores: [{ name: "Spain", score: "x" }] }])[0].status,
    "PENDING",
  );
});

test("does not recalculate terminal rows", () => {
  const won = pending({ status: "WON", profit: "6.5000", homeScore: "0", awayScore: "0" });
  assert.deepEqual(settlePaperBets([won], drawScore), [won]);
});

test("summarizes settled stake, net profit, ROI, and open statuses", () => {
  const rows = [
    pending({ status: "WON", profit: "2.5000" }),
    pending({ status: "LOST", profit: "-1.0000" }),
    pending({ status: "PUSH", profit: "0.0000" }),
    pending(),
    pending({ status: "REVIEW" }),
  ];
  assert.deepEqual(summarizePaperBets(rows), {
    total: 5,
    pending: 1,
    settled: 3,
    wins: 1,
    losses: 1,
    pushes: 1,
    review: 1,
    settledStake: 3,
    profit: 1.5,
    roi: 0.5,
  });
});

test("finds pending bets whose kickoff is beyond the scores window", () => {
  const rows = [
    pending({ kickoffUtc: "2026-06-20T12:00:00Z" }),
    pending({ kickoffUtc: "2026-06-23T13:00:00Z" }),
    pending({ kickoffUtc: "2026-06-20T12:00:00Z", status: "WON", profit: "1.0000" }),
  ];
  const stale = findStalePending(rows, new Date("2026-06-24T12:00:00Z"));
  assert.equal(stale.length, 1);
  assert.equal(stale[0].kickoffUtc, "2026-06-20T12:00:00Z");
});
```

- [ ] **Step 6: Run the domain tests and verify RED**

Run:

```powershell
node --test --experimental-test-isolation=none test/paper.test.mjs
```

Expected: FAIL because settlement and summary exports are missing.

- [ ] **Step 7: Implement settlement, ROI, and stale detection**

Append to `src/paper.mjs`:

```javascript
function scoreFor(event, team) {
  const item = event.scores?.find((score) => score.name === team);
  if (!item) return null;
  const value = Number(item.score);
  return Number.isFinite(value) ? value : null;
}

function isoOrBlank(value) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : "";
}

function resultStatus(row, homeScore, awayScore) {
  if (row.market === "MATCH_RESULT") {
    if (!["1", "X", "2"].includes(row.outcome)) return "REVIEW";
    const winner = homeScore > awayScore ? "1" : awayScore > homeScore ? "2" : "X";
    return row.outcome === winner ? "WON" : "LOST";
  }
  if (row.market !== "TOTALS") return "REVIEW";

  const line = Number(row.line);
  if (!Number.isFinite(line) || !Number.isInteger(line * 2)) return "REVIEW";
  if (!["OVER", "UNDER"].includes(row.outcome)) return "REVIEW";

  const total = homeScore + awayScore;
  if (total === line) return "PUSH";
  const over = total > line;
  return (row.outcome === "OVER") === over ? "WON" : "LOST";
}

function profitFor(row, status) {
  const stake = finite(row.stake, "stake");
  if (status === "WON") return ((finite(row.decimalOdds, "decimalOdds") - 1) * stake).toFixed(4);
  if (status === "LOST") return (-stake).toFixed(4);
  if (status === "PUSH") return "0.0000";
  return "";
}

export function settlePaperBets(rows, scoreEvents) {
  const byId = new Map(scoreEvents.map((event) => [String(event.id), event]));
  return rows.map((row) => {
    validateRow(row);
    if (TERMINAL_STATUSES.has(row.status)) return { ...row };
    if (row.status !== "PENDING") throw new Error(`Invalid paper bet status: ${row.status}`);

    const event = byId.get(String(row.referenceEventId));
    if (!event?.completed) return { ...row };
    const homeScore = scoreFor(event, row.homeTeam);
    const awayScore = scoreFor(event, row.awayTeam);
    if (homeScore === null || awayScore === null) return { ...row };

    const status = resultStatus(row, homeScore, awayScore);
    return {
      ...row,
      status,
      homeScore: String(homeScore),
      awayScore: String(awayScore),
      profit: profitFor(row, status),
      settledAt: isoOrBlank(event.last_update),
    };
  });
}

export function summarizePaperBets(rows) {
  const summary = {
    total: rows.length,
    pending: 0,
    settled: 0,
    wins: 0,
    losses: 0,
    pushes: 0,
    review: 0,
    settledStake: 0,
    profit: 0,
    roi: null,
  };
  for (const row of rows) {
    validateRow(row);
    if (row.status === "PENDING") summary.pending += 1;
    if (row.status === "REVIEW") summary.review += 1;
    if (!SETTLED_STATUSES.has(row.status)) continue;
    summary.settled += 1;
    if (row.status === "WON") summary.wins += 1;
    if (row.status === "LOST") summary.losses += 1;
    if (row.status === "PUSH") summary.pushes += 1;
    summary.settledStake += finite(row.stake, "stake");
    summary.profit += finite(row.profit, "profit");
  }
  if (summary.settledStake > 0) summary.roi = summary.profit / summary.settledStake;
  return summary;
}

export function findStalePending(rows, now, { days = 3 } = {}) {
  const cutoff = now.getTime() - days * 24 * 60 * 60 * 1000;
  return rows.filter((row) => {
    if (row.status !== "PENDING") return false;
    const kickoff = Date.parse(row.kickoffUtc);
    return Number.isFinite(kickoff) && kickoff < cutoff;
  });
}
```

- [ ] **Step 8: Run the domain tests and verify GREEN**

Run:

```powershell
node --test --experimental-test-isolation=none test/paper.test.mjs
```

Expected: all paper-domain tests PASS.

- [ ] **Step 9: Commit**

```powershell
git add provider-harness/src/paper.mjs provider-harness/test/paper.test.mjs
git commit -m "feat: add paper bet settlement model"
```

---

### Task 3: Persist unique paper bets during scans

**Files:**
- Modify: `provider-harness/src/cli.mjs`
- Modify: `provider-harness/test/cli_scan.test.mjs`

**Interfaces:**
- Consumes: `PAPER_COLUMNS`, `mergePaperBets`.
- Produces: `reports/paper-bets.csv` and scan output counts for added/duplicate bets.

- [ ] **Step 1: Add a failing scan-ledger test**

At the end of the existing scan test, after reading the regular reports, add:

```javascript
  const ledgerPath = join(reportsDir, "paper-bets.csv");
  const ledger = await readFile(ledgerPath, "utf8");
  assert.match(ledger, /referenceEventId,bettableEventId,firstSeenAt/);
  assert.match(ledger, /ref1,999,2026-06-24T12:00:05\.000Z/);
  assert.match(ledger, /Stoiximan,MATCH_RESULT,,X,7\.5000/);
  assert.match(out, /Recorded 1 new paper bet/);
  assert.doesNotMatch(ledger, new RegExp(ODDS_KEY));
  assert.doesNotMatch(ledger, new RegExp(THEODDS_KEY));
```

Then add this separate test, reusing the same fake clients:

```javascript
test("repeated scans do not duplicate the same paper bet", async () => {
  const calls = [];
  let out = "";
  const reportsDir = await mkdtemp(join(tmpdir(), "scan-dedup-"));
  const deps = {
    out: (text) => { out += text; },
    err: () => {},
    loadApiKey: async () => ODDS_KEY,
    loadTheOddsKey: async () => THEODDS_KEY,
    createClient: () => fakeOddsApiClient(calls),
    createTheOddsClient: () => fakeTheOddsClient(calls),
    reportsDir,
    now: () => new Date("2026-06-24T12:00:05.000Z"),
  };

  assert.equal(await runCli(["scan"], deps), 0);
  assert.equal(await runCli(["scan"], deps), 0);

  const rows = await readCsv(join(reportsDir, "paper-bets.csv"));
  assert.equal(rows.length, 1);
  assert.match(out, /Skipped 1 duplicate paper bet/);
});
```

Update imports at the top of `test/cli_scan.test.mjs`:

```javascript
import { readCsv } from "../src/csv.mjs";
```

- [ ] **Step 2: Run the scan test and verify RED**

Run:

```powershell
node --test --experimental-test-isolation=none test/cli_scan.test.mjs
```

Expected: FAIL because `paper-bets.csv` is not created.

- [ ] **Step 3: Add paper imports and a ledger reader**

In `src/cli.mjs`, add:

```javascript
import { PAPER_COLUMNS, mergePaperBets } from "./paper.mjs";
```

Add near `DEFAULT_REPORTS_DIR`:

```javascript
async function readCsvIfPresent(path) {
  return await defaultFileExists(path) ? readCsv(path) : [];
}
```

- [ ] **Step 4: Persist opportunities in `runScan`**

After writing the two scan reports, add:

```javascript
  const ledgerPath = join(reportsDir, "paper-bets.csv");
  const existingPaperBets = await readCsvIfPresent(ledgerPath);
  const merged = mergePaperBets(existingPaperBets, opportunities, {
    firstSeenAt: now().toISOString(),
  });
  await writeCsv(ledgerPath, merged.rows, PAPER_COLUMNS);
  out(`Recorded ${merged.added} new paper bet${merged.added === 1 ? "" : "s"}.\n`);
  out(`Skipped ${merged.duplicates} duplicate paper bet${merged.duplicates === 1 ? "" : "s"}.\n`);
```

This uses the existing `opportunities` array unchanged, preserving
`referenceEventId` from its matched fixture.

- [ ] **Step 5: Run scan tests and verify GREEN**

Run:

```powershell
node --test --experimental-test-isolation=none test/cli_scan.test.mjs
```

Expected: both scan tests PASS.

- [ ] **Step 6: Commit**

```powershell
git add provider-harness/src/cli.mjs provider-harness/test/cli_scan.test.mjs
git commit -m "feat: record unique scan alerts as paper bets"
```

---

### Task 4: Add settlement CLI and ROI output

**Files:**
- Modify: `provider-harness/src/cli.mjs`
- Create: `provider-harness/test/cli_settle.test.mjs`

**Interfaces:**
- Consumes: `client.getScores`, `settlePaperBets`, `summarizePaperBets`,
  `findStalePending`.
- Produces: `node src/cli.mjs settle`, updated ledger rows, aggregate output.

- [ ] **Step 1: Create failing CLI settlement tests**

Create `test/cli_settle.test.mjs`:

```javascript
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runCli } from "../src/cli.mjs";
import { readCsv, writeCsv } from "../src/csv.mjs";
import { PAPER_COLUMNS } from "../src/paper.mjs";

const KEY = "scores-secret";

function paperRow(overrides = {}) {
  return {
    referenceEventId: "ref1",
    bettableEventId: "999",
    firstSeenAt: "2026-06-24T12:00:05.000Z",
    kickoffUtc: "2026-06-25T18:00:00.000Z",
    homeTeam: "Spain",
    awayTeam: "Cape Verde",
    bookmaker: "Stoiximan",
    market: "MATCH_RESULT",
    line: "",
    outcome: "X",
    decimalOdds: "7.5000",
    fairOdds: "6.3300",
    fairProbability: "0.158000",
    ev: "0.185000",
    tier: "SUSPICIOUS",
    stake: "1.00",
    status: "PENDING",
    homeScore: "",
    awayScore: "",
    profit: "",
    settledAt: "",
    ...overrides,
  };
}

test("settle updates completed bets and prints realized ROI", async () => {
  const reportsDir = await mkdtemp(join(tmpdir(), "settle-"));
  await writeCsv(join(reportsDir, "paper-bets.csv"), [paperRow()], PAPER_COLUMNS);
  const calls = [];
  let out = "";
  const code = await runCli(["settle"], {
    out: (text) => { out += text; },
    err: () => {},
    loadTheOddsKey: async () => KEY,
    createTheOddsClient: ({ apiKey }) => {
      assert.equal(apiKey, KEY);
      return {
        async getScores(args) {
          calls.push(args);
          return {
            data: [{
              id: "ref1",
              completed: true,
              home_team: "Spain",
              away_team: "Cape Verde",
              scores: [
                { name: "Spain", score: "1" },
                { name: "Cape Verde", score: "1" },
              ],
              last_update: "2026-06-25T20:00:00Z",
            }],
            quota: { remaining: 496, used: 4, lastCost: 2 },
          };
        },
      };
    },
    reportsDir,
    now: () => new Date("2026-06-25T20:01:00Z"),
  });

  assert.equal(code, 0);
  assert.deepEqual(calls, [{ sportKey: "soccer_fifa_world_cup", daysFrom: 3 }]);
  const [row] = await readCsv(join(reportsDir, "paper-bets.csv"));
  assert.equal(row.status, "WON");
  assert.equal(row.profit, "6.5000");
  assert.match(out, /Wins: 1/);
  assert.match(out, /Net profit: \+6\.5000 units/);
  assert.match(out, /ROI: \+650\.0%/);
  assert.match(out, /aggregate score/i);
  assert.doesNotMatch(await readFile(join(reportsDir, "paper-bets.csv"), "utf8"), new RegExp(KEY));
});

test("settle avoids quota when the ledger is absent or has no pending bets", async () => {
  const reportsDir = await mkdtemp(join(tmpdir(), "settle-empty-"));
  let calls = 0;
  const deps = {
    out: () => {},
    err: () => {},
    loadTheOddsKey: async () => KEY,
    createTheOddsClient: () => ({
      async getScores() { calls += 1; return { data: [], quota: {} }; },
    }),
    reportsDir,
  };

  assert.equal(await runCli(["settle"], deps), 0);
  await writeCsv(
    join(reportsDir, "paper-bets.csv"),
    [paperRow({ status: "LOST", profit: "-1.0000" })],
    PAPER_COLUMNS,
  );
  assert.equal(await runCli(["settle"], deps), 0);
  assert.equal(calls, 0);
});

test("settle warns about pending bets outside the three-day window", async () => {
  const reportsDir = await mkdtemp(join(tmpdir(), "settle-stale-"));
  await writeCsv(
    join(reportsDir, "paper-bets.csv"),
    [paperRow({ kickoffUtc: "2026-06-20T12:00:00Z" })],
    PAPER_COLUMNS,
  );
  let out = "";
  const code = await runCli(["settle"], {
    out: (text) => { out += text; },
    err: () => {},
    loadTheOddsKey: async () => KEY,
    createTheOddsClient: () => ({
      async getScores() {
        return { data: [], quota: { remaining: 496, used: 4, lastCost: 2 } };
      },
    }),
    reportsDir,
    now: () => new Date("2026-06-24T12:00:00Z"),
  });
  assert.equal(code, 0);
  assert.match(out, /1 pending paper bet.*older than 3 days/i);
});
```

- [ ] **Step 2: Run the settlement tests and verify RED**

Run:

```powershell
node --test --experimental-test-isolation=none test/cli_settle.test.mjs
```

Expected: FAIL because `settle` is an unknown command.

- [ ] **Step 3: Add settlement imports and output formatter**

Replace the paper import in `src/cli.mjs` with:

```javascript
import {
  PAPER_COLUMNS,
  findStalePending,
  mergePaperBets,
  settlePaperBets,
  summarizePaperBets,
} from "./paper.mjs";
```

Add:

```javascript
function signed(value, digits = 4) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}`;
}

function printPaperSummary(out, rows) {
  const summary = summarizePaperBets(rows);
  const roi = summary.roi === null ? "N/A" : `${signed(summary.roi * 100, 1)}%`;
  out(
    [
      `Paper bets: ${summary.total}`,
      `Pending: ${summary.pending}`,
      `Settled: ${summary.settled}`,
      `Wins: ${summary.wins}`,
      `Losses: ${summary.losses}`,
      `Pushes: ${summary.pushes}`,
      `Review: ${summary.review}`,
      `Settled stake: ${summary.settledStake.toFixed(2)} units`,
      `Net profit: ${signed(summary.profit)} units`,
      `ROI: ${roi}`,
      "Settlement limitation: soccer ROI uses The Odds API aggregate score; extra-time period semantics are not documented.",
    ].join("\n") + "\n",
  );
}
```

- [ ] **Step 4: Implement `runSettle`**

Add above `runCli`:

```javascript
async function runSettle({
  loadTheOddsKey, createTheOddsClient, out, reportsDir, now,
}) {
  const ledgerPath = join(reportsDir, "paper-bets.csv");
  if (!await defaultFileExists(ledgerPath)) {
    out("No paper-bet ledger found. Run scan first.\n");
    return 0;
  }

  const rows = await readCsv(ledgerPath);
  if (rows.length === 0) {
    out("Paper-bet ledger is empty. Run scan first.\n");
    return 0;
  }
  if (!rows.some((row) => row.status === "PENDING")) {
    out("No pending paper bets to settle.\n");
    printPaperSummary(out, rows);
    return 0;
  }

  const client = createTheOddsClient({ apiKey: await loadTheOddsKey() });
  const response = await client.getScores({
    sportKey: WORLD_CUP_SPORT_KEY,
    daysFrom: 3,
  });
  const settled = settlePaperBets(rows, response.data ?? []);
  await writeCsv(ledgerPath, settled, PAPER_COLUMNS);
  printPaperSummary(out, settled);

  const stale = findStalePending(settled, now());
  if (stale.length > 0) {
    out(
      `Warning: ${stale.length} pending paper bet${stale.length === 1 ? "" : "s"} ` +
      "is older than 3 days and may be outside the free scores window.\n",
    );
  }
  out(`The Odds API quota remaining: ${response.quota?.remaining ?? "?"}\n`);
  return 0;
}
```

- [ ] **Step 5: Wire the command and usage**

Inside `runCli`, before `evaluate`, add:

```javascript
    if (command === "settle") {
      return await runSettle({
        loadTheOddsKey, createTheOddsClient, out, reportsDir, now,
      });
    }
```

Replace the unknown-command usage string with:

```javascript
      "usage: node src/cli.mjs <events | capture <eventId> | scan [--edge=N] | settle | evaluate <capture.csv>>\n" +
```

- [ ] **Step 6: Run settlement tests and verify GREEN**

Run:

```powershell
node --test --experimental-test-isolation=none test/cli_settle.test.mjs
```

Expected: all settlement CLI tests PASS.

- [ ] **Step 7: Run scan and CLI regression tests**

Run:

```powershell
node --test --experimental-test-isolation=none test/cli_scan.test.mjs test/cli.test.mjs
```

Expected: all tests PASS.

- [ ] **Step 8: Commit**

```powershell
git add provider-harness/src/cli.mjs provider-harness/test/cli_settle.test.mjs
git commit -m "feat: settle paper bets and report ROI"
```

---

### Task 5: Document and verify the complete workflow

**Files:**
- Modify: `provider-harness/README.md`

**Interfaces:**
- Documents the shipped `scan` → `paper-bets.csv` → `settle` workflow.

- [ ] **Step 1: Add the paper-tracking section**

Add this section after the existing `scan` documentation:

````markdown
### Paper ROI tracking

Every `scan` automatically records each unique value alert in
`reports/paper-bets.csv` as a paper bet with a fixed stake of **1 unit**.
Identity is `The Odds API event + bookmaker + market + exact line + outcome`,
so repeated scans do not duplicate or reprice the same bet. The first observed
odds, EV, tier, and timestamp are retained.

Settle completed bets with:

```text
node src/cli.mjs settle
```

`settle` requests World Cup scores for the previous three days, updates
`PENDING` bets to `WON`, `LOST`, `PUSH`, or `REVIEW`, and prints settled stake,
net paper profit, and realized ROI:

`ROI = settled paper profit / settled paper stake`

A win returns `odds - 1` units, a loss `-1`, and a push `0`. Pending and review
rows are excluded from ROI. The scores request costs 2 The Odds API credits
when `daysFrom=3`; unresolved bets older than three days require manual review.

This is paper-performance measurement, not proof of future profitability or an
authoritative bookmaker settlement record. The scores feed exposes an aggregate
soccer score but does not document whether knockout scores include extra time,
so those cases require caution.
````

- [ ] **Step 2: Run every test without worker-process isolation**

Run from `provider-harness/`:

```powershell
node --test --experimental-test-isolation=none
```

Expected: all tests PASS with zero failures.

- [ ] **Step 3: Verify formatting and repository scope**

Run from the repository root:

```powershell
git diff --check
git status --short
```

Expected:

- `git diff --check` exits 0.
- Only the README is uncommitted at this task boundary.
- `.planning/`, `agentify-desktop/`, and `world-cup-2026-predictor/` remain
  untouched and untracked.

- [ ] **Step 4: Commit documentation**

```powershell
git add provider-harness/README.md
git commit -m "docs: explain paper ROI workflow"
```

- [ ] **Step 5: Final verification**

Run:

```powershell
node --test --experimental-test-isolation=none
git log -5 --oneline
git status --short --branch
```

Expected:

- all tests PASS;
- the five implementation commits appear in order;
- no tracked changes remain;
- the three pre-existing untracked directories remain unchanged.

---

## Self-Review

- **Spec coverage:** Task 1 covers the official scores endpoint and quota. Task
  2 covers stable identity, first-price retention, settlement rules, P/L, ROI,
  unsupported lines, idempotence, and stale detection. Task 3 integrates
  automatic one-unit tracking into scans. Task 4 adds settlement, no-quota
  empty behavior, summaries, warnings, and secret-safe persistence. Task 5
  documents formulas and provider limitations.
- **Storage boundary:** `paper.mjs` is pure; only `cli.mjs` reads/writes CSV and
  calls providers.
- **Type consistency:** ledger rows remain CSV strings; calculations convert
  through validated numeric parsing. `referenceEventId` is the direct join key
  shared by odds and scores.
- **Scope:** no backfill, real betting, variable staking, database, dashboard,
  historical odds, or live tests are introduced.
