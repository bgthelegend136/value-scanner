# Multi-Sport Mispricing Telegram Alerts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a scheduled multi-sport scanner that sends Telegram alerts only when Stoiximan or Superbet offers strictly more than 20% EV against both de-vigged Pinnacle and a median consensus of at least three other international bookmakers.

**Architecture:** Odds-API.io's value-bets endpoint supplies cheap candidates. Explicit sport/league mappings route only supported candidates to The Odds API, where exact-event and exact-market confirmation is calculated. A persistent queue enforces the two-sport-key quota cap; Telegram delivery, deduplication, audit state, and Windows Task Scheduler integration are separate modules.

**Tech Stack:** Node.js 22 ES modules, built-in `fetch`, `node:test`, CSV/JSON local state, Telegram Bot HTTP API, PowerShell/Windows Task Scheduler. No runtime npm dependencies.

## Global Constraints

- Work only in `C:\Users\bgthe\Documents\bet\.worktrees\multisport-mispricing-alerts` on branch `codex/multisport-mispricing-alerts`.
- Preserve all existing `scan`, `settle`, `clv`, `boost`, capture, and evaluation behavior.
- Support only pre-match full-event `MATCH_RESULT` and featured `TOTALS`.
- Final alert threshold is strict: `pinnacleEv > 0.20` and `consensusEv > 0.20`; exactly 20.0% does not pass.
- Require Pinnacle plus at least three other complete international bookmaker markets.
- Require exact market, outcome, period, and totals-line equality.
- Candidate and reference timestamps must be valid and no more than 10 minutes old.
- Confirm at most two The Odds API sport keys and spend at most four reference credits per run.
- Stop confirmation when The Odds API remaining quota is at or below the 100-credit reserve.
- Never send a betting alert based only on Odds-API.io's EV.
- Never scrape, log in, place a bet, fabricate a bookmaker URL, or expose any API key/token.
- Accept only HTTPS deep links on explicit Stoiximan/Superbet domain allowlists.
- Scheduled execution is daily at 09:00, 15:00, and 21:00 local Windows time.
- Every production change follows red-green-refactor TDD and ends with a focused commit.

**Spec:** `docs/superpowers/specs/2026-06-25-multisport-mispricing-alerts-design.md`

---

## File Structure

Create:

- `provider-harness/src/value_bets_client.mjs` — Odds-API.io `/value-bets` client with redacted failures.
- `provider-harness/src/mispricing_normalize.mjs` — normalize/filter candidates and choose safe bookmaker links.
- `provider-harness/src/multisport_map.mjs` — exact sport/league registry lookup and active-sport validation.
- `provider-harness/src/mispricing_match.mjs` — team/player event matching and exact selection matching.
- `provider-harness/src/mispricing_confirm.mjs` — freshness, Pinnacle, median consensus, and strict threshold.
- `provider-harness/src/mispricing_state.mjs` — queue, audit, alerts, health, retries, and deduplication.
- `provider-harness/src/telegram.mjs` — Telegram HTTP client, message formatting, and inline button.
- `provider-harness/src/mispricing_scan.mjs` — candidate-first orchestration independent of CLI parsing.
- `provider-harness/config/multisport-map.json` — exact Odds-API.io league slug to The Odds API sport-key mappings.
- `provider-harness/scripts/run-mispricing-scan.ps1` — hidden scheduled runner with local logging.
- `provider-harness/scripts/install-mispricing-task.ps1` — idempotent Task Scheduler installer.
- fixtures and tests named after each module under `provider-harness/test/`.

Modify:

- `provider-harness/src/theodds_client.mjs` — list active sports and request filtered current odds.
- `provider-harness/src/cli.mjs` — add `mispricing-scan` and `telegram-test` commands and dependency injection.
- `provider-harness/README.md` and `provider-harness/USER-GUIDE.md` — setup, safety, schedule, and operation.
- `provider-harness/.env.example` — non-secret variable names only.

---

### Task 1: Odds-API.io Value-Bet Candidate Client

**Files:**

- Create: `provider-harness/src/value_bets_client.mjs`
- Create: `provider-harness/test/value_bets_client.test.mjs`

**Interfaces:**

- Produces: `createValueBetsClient({ apiKey, fetchImpl?, baseUrl? })`
- Produces method: `getValueBets({ bookmaker, includeEventDetails = true })`
- Returns: `{ data, receivedAt, rateLimit }`

- [ ] **Step 1: Write the failing client tests**

```javascript
import assert from "node:assert/strict";
import test from "node:test";

import { createValueBetsClient } from "../src/value_bets_client.mjs";

function jsonResponse(data, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

test("requests value bets for one bookmaker with event details", async () => {
  const urls = [];
  const client = createValueBetsClient({
    apiKey: "secret",
    fetchImpl: async (url) => {
      urls.push(String(url));
      return jsonResponse([], {
        headers: {
          "x-ratelimit-limit": "100",
          "x-ratelimit-remaining": "99",
          "x-ratelimit-reset": "2026-06-25T10:00:00Z",
        },
      });
    },
  });

  const response = await client.getValueBets({
    bookmaker: "Stoiximan",
  });

  const url = new URL(urls[0]);
  assert.equal(url.pathname, "/v3/value-bets");
  assert.equal(url.searchParams.get("apiKey"), "secret");
  assert.equal(url.searchParams.get("bookmaker"), "Stoiximan");
  assert.equal(url.searchParams.has("minExpectedValue"), false);
  assert.equal(url.searchParams.get("includeEventDetails"), "true");
  assert.deepEqual(response.rateLimit, {
    limit: 100,
    remaining: 99,
    resetAt: "2026-06-25T10:00:00Z",
  });
});

test("redacts provider body and key from value-bet failures", async () => {
  const key = "do-not-leak";
  const client = createValueBetsClient({
    apiKey: key,
    fetchImpl: async () =>
      jsonResponse({ message: `subscription denied ${key}` }, { status: 403 }),
  });

  await assert.rejects(
    () => client.getValueBets({ bookmaker: "Superbet" }),
    (error) => {
      assert.match(error.message, /Odds-API\.io value-bets request failed with status 403/);
      assert.doesNotMatch(error.message, new RegExp(key));
      assert.doesNotMatch(error.message, /subscription denied/);
      return true;
    },
  );
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
cd provider-harness
node --test test/value_bets_client.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/value_bets_client.mjs`.

- [ ] **Step 3: Implement the minimal client**

```javascript
function rateLimitFrom(headers) {
  const integer = (name) => {
    const value = Number(headers.get(name));
    return Number.isFinite(value) ? value : null;
  };
  return {
    limit: integer("x-ratelimit-limit"),
    remaining: integer("x-ratelimit-remaining"),
    resetAt: headers.get("x-ratelimit-reset"),
  };
}

export function createValueBetsClient({
  apiKey,
  fetchImpl = fetch,
  baseUrl = "https://api.odds-api.io/v3",
}) {
  return {
    async getValueBets({
      bookmaker,
      includeEventDetails = true,
    }) {
      const url = new URL(`${baseUrl.replace(/\/$/u, "")}/value-bets`);
      url.searchParams.set("apiKey", apiKey);
      url.searchParams.set("bookmaker", bookmaker);
      url.searchParams.set("includeEventDetails", String(includeEventDetails));

      const response = await fetchImpl(url);
      const receivedAt = new Date().toISOString();
      if (!response.ok) {
        throw new Error(
          `Odds-API.io value-bets request failed with status ${response.status}`,
        );
      }
      return {
        data: await response.json(),
        receivedAt,
        rateLimit: rateLimitFrom(response.headers),
      };
    },
  };
}
```

- [ ] **Step 4: Run focused and full tests**

Run:

```powershell
node --test test/value_bets_client.test.mjs
npm test
```

Expected: focused tests PASS; full suite PASS with zero failures.

- [ ] **Step 5: Commit**

```powershell
git add provider-harness/src/value_bets_client.mjs provider-harness/test/value_bets_client.test.mjs
git commit -m "feat: add value-bet candidate client"
```

---

### Task 2: Candidate Normalization, Market Filtering, and Safe Links

**Files:**

- Create: `provider-harness/src/mispricing_normalize.mjs`
- Create: `provider-harness/test/mispricing_normalize.test.mjs`
- Create: `provider-harness/test/fixtures/value-bets-response.json`

**Interfaces:**

- Produces: `normalizeValueBet(raw, { receivedAt, now, maxAgeMs? })`
- Produces: `normalizeValueBets(payload, options)` returning `{ candidates, rejected }`
- Produces candidate fields:

```javascript
{
  candidateId, providerEventId, bookmaker, providerExpectedValue,
  sportSlug, leagueSlug, sportName, leagueName,
  kickoffUtc, participantOne, participantTwo,
  market, line, outcome, offeredOdds, valueUpdatedAt,
  outcomeLink, marketLink, eventLink, linkDepth
}
```

- [ ] **Step 1: Create a representative provider fixture**

Create `provider-harness/test/fixtures/value-bets-response.json`:

```json
[
  {
    "id": "basket-1-Totals-over-Stoiximan-162.5",
    "expectedValue": 24.5,
    "expectedValueUpdatedAt": "2026-06-25T08:55:00.000Z",
    "betSide": "over",
    "bookmaker": "Stoiximan",
    "eventId": 501,
    "event": {
      "home": "Olympiacos",
      "away": "Real Madrid",
      "date": "2026-06-25T18:30:00.000Z",
      "sport": { "name": "Basketball", "slug": "basketball" },
      "league": { "name": "EuroLeague", "slug": "euroleague" }
    },
    "market": {
      "name": "Totals",
      "hdp": 162.5,
      "over": "2.40",
      "under": "1.55",
      "overDirectLink": "https://www.stoiximan.gr/addToBetslip/over-162-5",
      "href": "https://www.stoiximan.gr/match/501"
    },
    "bookmakerOdds": {
      "over": "2.40",
      "under": "1.55",
      "overDirectLink": "https://www.stoiximan.gr/addToBetslip/over-162-5",
      "href": "https://www.stoiximan.gr/match/501"
    }
  },
  {
    "id": "unsupported-spread",
    "expectedValue": 40,
    "expectedValueUpdatedAt": "2026-06-25T08:55:00.000Z",
    "betSide": "home",
    "bookmaker": "Superbet",
    "eventId": 502,
    "event": {
      "home": "A",
      "away": "B",
      "date": "2026-06-25T18:30:00.000Z",
      "sport": "Basketball",
      "league": "EuroLeague"
    },
    "market": { "name": "Spread", "hdp": -4.5 },
    "bookmakerOdds": { "home": "2.10", "away": "1.70" }
  }
]
```

- [ ] **Step 2: Write failing normalization tests**

```javascript
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  chooseBookmakerLink,
  normalizeValueBets,
} from "../src/mispricing_normalize.mjs";

const fixture = JSON.parse(
  await readFile(new URL("./fixtures/value-bets-response.json", import.meta.url), "utf8"),
);

test("normalizes a fresh main totals candidate and preserves exact line", () => {
  const result = normalizeValueBets(fixture, {
    receivedAt: "2026-06-25T08:56:00.000Z",
    now: new Date("2026-06-25T09:00:00.000Z"),
  });

  assert.equal(result.candidates.length, 1);
  assert.deepEqual(
    {
      bookmaker: result.candidates[0].bookmaker,
      sportSlug: result.candidates[0].sportSlug,
      leagueSlug: result.candidates[0].leagueSlug,
      market: result.candidates[0].market,
      line: result.candidates[0].line,
      outcome: result.candidates[0].outcome,
      offeredOdds: result.candidates[0].offeredOdds,
      linkDepth: result.candidates[0].linkDepth,
    },
    {
      bookmaker: "Stoiximan",
      sportSlug: "basketball",
      leagueSlug: "euroleague",
      market: "TOTALS",
      line: "162.5",
      outcome: "OVER",
      offeredOdds: 2.4,
      linkDepth: "OUTCOME",
    },
  );
  assert.equal(result.rejected[0].reason, "UNSUPPORTED_MARKET");
});

test("rejects below-20, stale, started, missing timestamp, and malformed odds", () => {
  const base = fixture[0];
  const mutations = [
    [{ ...base, expectedValue: 19.99 }, "CANDIDATE_EV_BELOW_20"],
    [{ ...base, expectedValueUpdatedAt: "2026-06-25T08:40:00Z" }, "STALE_CANDIDATE"],
    [{ ...base, expectedValueUpdatedAt: "" }, "INVALID_VALUE_TIMESTAMP"],
    [{ ...base, event: { ...base.event, date: "2026-06-25T08:59:00Z" } }, "EVENT_STARTED"],
    [{
      ...base,
      bookmakerOdds: { ...base.bookmakerOdds, over: "not-a-number" },
      market: { ...base.market, over: "not-a-number" },
    }, "INVALID_OFFERED_ODDS"],
  ];

  for (const [raw, reason] of mutations) {
    const result = normalizeValueBets([raw], {
      receivedAt: "2026-06-25T09:00:00Z",
      now: new Date("2026-06-25T09:00:00Z"),
    });
    assert.equal(result.candidates.length, 0);
    assert.equal(result.rejected[0].reason, reason);
  }
});

test("uses only allowlisted HTTPS links and falls back by depth", () => {
  assert.deepEqual(
    chooseBookmakerLink({
      bookmaker: "Superbet",
      outcomeLink: "https://superbet.gr/betslip/123",
      marketLink: "https://superbet.gr/event/123#totals",
      eventLink: "https://superbet.gr/event/123",
    }),
    { url: "https://superbet.gr/betslip/123", depth: "OUTCOME" },
  );
  assert.deepEqual(
    chooseBookmakerLink({
      bookmaker: "Stoiximan",
      outcomeLink: "javascript:alert(1)",
      marketLink: "https://evil.example/market",
      eventLink: "https://www.stoiximan.gr/match/501",
    }),
    { url: "https://www.stoiximan.gr/match/501", depth: "EVENT" },
  );
});
```

- [ ] **Step 3: Run the tests and verify RED**

Run:

```powershell
node --test test/mispricing_normalize.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 4: Implement normalization and allowlisted fallback**

Implement `provider-harness/src/mispricing_normalize.mjs` with these constants and exports:

```javascript
const MAX_AGE_MS = 10 * 60 * 1000;
const ALLOWED_HOSTS = {
  Stoiximan: new Set(["stoiximan.gr", "www.stoiximan.gr"]),
  Superbet: new Set(["superbet.gr", "www.superbet.gr"]),
};

function text(value) {
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object") return String(value.name ?? "").trim();
  return "";
}

function slug(value) {
  if (value && typeof value === "object" && value.slug) {
    return String(value.slug).trim().toLowerCase();
  }
  return text(value)
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "");
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function safeUrl(bookmaker, value) {
  try {
    const url = new URL(String(value ?? ""));
    const allowed = ALLOWED_HOSTS[bookmaker] ?? new Set();
    return url.protocol === "https:" && allowed.has(url.hostname.toLowerCase())
      ? url.toString()
      : "";
  } catch {
    return "";
  }
}

export function chooseBookmakerLink({
  bookmaker,
  outcomeLink,
  marketLink,
  eventLink,
}) {
  for (const [depth, value] of [
    ["OUTCOME", outcomeLink],
    ["MARKET", marketLink],
    ["EVENT", eventLink],
  ]) {
    const url = safeUrl(bookmaker, value);
    if (url) return { url, depth };
  }
  return { url: "", depth: "NONE" };
}

function marketShape(raw) {
  const name = String(raw.market?.name ?? "").trim().toLowerCase();
  const side = String(raw.betSide ?? "").trim().toLowerCase();
  if (["ml", "moneyline", "match result", "head to head"].includes(name)) {
    const outcome = side === "home" ? "1" : side === "away" ? "2" : side === "draw" ? "X" : "";
    return outcome ? { market: "MATCH_RESULT", line: "", outcome } : null;
  }
  if (["totals", "goals over/under", "over/under"].includes(name)) {
    const outcome = side === "over" ? "OVER" : side === "under" ? "UNDER" : "";
    const line = finite(raw.market?.hdp ?? raw.market?.line ?? raw.market?.total);
    return outcome && line !== null
      ? { market: "TOTALS", line: String(line), outcome }
      : null;
  }
  return null;
}

function selectionValue(container, outcome) {
  const key = { "1": "home", X: "draw", "2": "away", OVER: "over", UNDER: "under" }[outcome];
  return key ? container?.[key] : undefined;
}

function selectionLink(container, outcome) {
  const key = {
    "1": "homeDirectLink",
    X: "drawDirectLink",
    "2": "awayDirectLink",
    OVER: "overDirectLink",
    UNDER: "underDirectLink",
  }[outcome];
  return key ? container?.[key] : "";
}

export function normalizeValueBet(
  raw,
  { receivedAt, now, maxAgeMs = MAX_AGE_MS },
) {
  const reject = (reason) => ({
    candidate: null,
    rejected: {
      candidateId: String(raw?.id ?? "UNKNOWN"),
      providerEventId: String(raw?.eventId ?? "UNKNOWN"),
      bookmaker: String(raw?.bookmaker ?? "UNKNOWN"),
      sportSlug: slug(raw?.event?.sport),
      leagueSlug: slug(raw?.event?.league),
      sportName: text(raw?.event?.sport),
      leagueName: text(raw?.event?.league),
      market: String(raw?.market?.name ?? ""),
      line: String(raw?.market?.hdp ?? raw?.market?.line ?? ""),
      outcome: String(raw?.betSide ?? ""),
      reason,
    },
  });
  if (!["Stoiximan", "Superbet"].includes(raw?.bookmaker)) return reject("UNSUPPORTED_BOOKMAKER");
  if (!(finite(raw.expectedValue) >= 20)) return reject("CANDIDATE_EV_BELOW_20");

  const valueUpdatedAt = new Date(raw.expectedValueUpdatedAt);
  if (!Number.isFinite(valueUpdatedAt.getTime())) return reject("INVALID_VALUE_TIMESTAMP");
  if (now.getTime() - valueUpdatedAt.getTime() > maxAgeMs) return reject("STALE_CANDIDATE");

  const kickoff = new Date(raw.event?.date);
  if (!Number.isFinite(kickoff.getTime())) return reject("INVALID_KICKOFF");
  if (kickoff.getTime() <= now.getTime()) return reject("EVENT_STARTED");

  const shape = marketShape(raw);
  if (!shape) return reject("UNSUPPORTED_MARKET");
  const offeredOdds = finite(
    selectionValue(raw.bookmakerOdds, shape.outcome) ??
      selectionValue(raw.market, shape.outcome),
  );
  if (!(offeredOdds > 1)) return reject("INVALID_OFFERED_ODDS");

  const event = raw.event ?? {};
  const participantOne = text(event.home);
  const participantTwo = text(event.away);
  if (!participantOne || !participantTwo) return reject("MISSING_PARTICIPANTS");

  const outcomeLink =
    selectionLink(raw.bookmakerOdds, shape.outcome) ||
    selectionLink(raw.market, shape.outcome);
  const marketLink = raw.market?.href ?? "";
  const eventLink = raw.bookmakerOdds?.href ?? event.href ?? raw.href ?? "";
  const selectedLink = chooseBookmakerLink({
    bookmaker: raw.bookmaker,
    outcomeLink,
    marketLink,
    eventLink,
  });

  return {
    candidate: {
      candidateId: String(raw.id),
      providerEventId: String(raw.eventId),
      bookmaker: raw.bookmaker,
      providerExpectedValue: Number(raw.expectedValue) / 100,
      sportSlug: slug(event.sport),
      leagueSlug: slug(event.league),
      sportName: text(event.sport),
      leagueName: text(event.league),
      kickoffUtc: kickoff.toISOString(),
      participantOne,
      participantTwo,
      market: shape.market,
      line: shape.line,
      outcome: shape.outcome,
      offeredOdds,
      valueUpdatedAt: valueUpdatedAt.toISOString(),
      receivedAt,
      link: selectedLink.url,
      linkDepth: selectedLink.depth,
    },
    rejected: null,
  };
}

export function normalizeValueBets(payload, options) {
  const candidates = [];
  const rejected = [];
  for (const raw of Array.isArray(payload) ? payload : []) {
    const result = normalizeValueBet(raw, options);
    if (result.candidate) candidates.push(result.candidate);
    else rejected.push(result.rejected);
  }
  return { candidates, rejected };
}
```

- [ ] **Step 5: Run focused and full tests**

Run:

```powershell
node --test test/mispricing_normalize.test.mjs
npm test
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```powershell
git add provider-harness/src/mispricing_normalize.mjs provider-harness/test/mispricing_normalize.test.mjs provider-harness/test/fixtures/value-bets-response.json
git commit -m "feat: normalize mispricing candidates safely"
```

---

### Task 3: Exact Multi-Sport Registry and Active-Sport Discovery

**Files:**

- Create: `provider-harness/config/multisport-map.json`
- Create: `provider-harness/src/multisport_map.mjs`
- Create: `provider-harness/test/multisport_map.test.mjs`
- Modify: `provider-harness/src/theodds_client.mjs`
- Modify: `provider-harness/test/theodds_client.test.mjs`

**Interfaces:**

- Produces: `loadSportRegistry(path)`
- Produces: `resolveSportKey(candidate, registry, activeSportKeys)`
- Extends The Odds client with `listSports({ all = false })`

- [ ] **Step 1: Add failing The Odds active-sports test**

Append to `provider-harness/test/theodds_client.test.mjs`:

```javascript
test("lists active sports without spending odds quota", async () => {
  const urls = [];
  const client = createTheOddsApiClient({
    apiKey: "secret",
    fetchImpl: async (url) => {
      urls.push(String(url));
      return jsonResponse([{ key: "basketball_euroleague", active: true }]);
    },
  });

  const response = await client.listSports();
  const url = new URL(urls[0]);
  assert.equal(url.pathname, "/v4/sports");
  assert.equal(url.searchParams.get("all"), "false");
  assert.deepEqual(response.data, [{ key: "basketball_euroleague", active: true }]);
});
```

- [ ] **Step 2: Create the exact registry fixture**

Create `provider-harness/config/multisport-map.json`:

```json
{
  "football|international-fifa-world-cup": "soccer_fifa_world_cup"
}
```

This seed contains only the mapping already verified by the existing scanner.
Live activation later records every unmapped candidate's exact sport and league
identifiers. Add new entries only after comparing those identifiers with the
active The Odds API sport list; never pre-populate guessed league slugs.

- [ ] **Step 3: Write failing registry tests**

```javascript
import assert from "node:assert/strict";
import { writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadSportRegistry, resolveSportKey } from "../src/multisport_map.mjs";

test("loads exact mappings and resolves only active sport keys", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sport-map-"));
  const path = join(dir, "map.json");
  await writeFile(path, JSON.stringify({
    "basketball|euroleague": "basketball_euroleague",
  }));
  const registry = await loadSportRegistry(path);
  const candidate = { sportSlug: "basketball", leagueSlug: "euroleague" };

  assert.deepEqual(
    resolveSportKey(candidate, registry, new Set(["basketball_euroleague"])),
    { sportKey: "basketball_euroleague", reason: "" },
  );
  assert.deepEqual(
    resolveSportKey(candidate, registry, new Set(["basketball_nba"])),
    { sportKey: "", reason: "INACTIVE_REFERENCE_SPORT" },
  );
});

test("does not fuzzy-match unknown leagues", () => {
  const registry = new Map([
    ["football|england-premier-league", "soccer_epl"],
  ]);
  assert.deepEqual(
    resolveSportKey(
      { sportSlug: "football", leagueSlug: "premier-league" },
      registry,
      new Set(["soccer_epl"]),
    ),
    { sportKey: "", reason: "UNMAPPED_SPORT_LEAGUE" },
  );
});

test("rejects malformed registry keys", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sport-map-invalid-"));
  const path = join(dir, "map.json");
  await writeFile(path, JSON.stringify({ bad: "soccer_epl" }));
  await assert.rejects(() => loadSportRegistry(path), /invalid sport registry key/);
});
```

- [ ] **Step 4: Run tests and verify RED**

Run:

```powershell
node --test test/multisport_map.test.mjs test/theodds_client.test.mjs
```

Expected: registry module missing and `listSports is not a function`.

- [ ] **Step 5: Implement registry and active-sports method**

Create `provider-harness/src/multisport_map.mjs`:

```javascript
import { readFile } from "node:fs/promises";

const KEY_PATTERN = /^[a-z0-9-]+\|[a-z0-9-]+$/u;

export async function loadSportRegistry(path) {
  const parsed = JSON.parse(await readFile(path, "utf8"));
  const entries = Object.entries(parsed);
  for (const [key, value] of entries) {
    if (!KEY_PATTERN.test(key)) throw new Error(`invalid sport registry key: ${key}`);
    if (!/^[a-z0-9_]+$/u.test(String(value))) {
      throw new Error(`invalid reference sport key for ${key}`);
    }
  }
  return new Map(entries);
}

export function resolveSportKey(candidate, registry, activeSportKeys) {
  const key = `${candidate.sportSlug}|${candidate.leagueSlug}`;
  const sportKey = registry.get(key);
  if (!sportKey) return { sportKey: "", reason: "UNMAPPED_SPORT_LEAGUE" };
  if (!activeSportKeys.has(sportKey)) {
    return { sportKey: "", reason: "INACTIVE_REFERENCE_SPORT" };
  }
  return { sportKey, reason: "" };
}
```

Add to the returned object in `createTheOddsApiClient`:

```javascript
listSports({ all = false } = {}) {
  return request("/sports", { all });
},
```

- [ ] **Step 6: Run focused and full tests**

Run:

```powershell
node --test test/multisport_map.test.mjs test/theodds_client.test.mjs
npm test
```

Expected: all tests PASS.

- [ ] **Step 7: Commit**

```powershell
git add provider-harness/config/multisport-map.json provider-harness/src/multisport_map.mjs provider-harness/src/theodds_client.mjs provider-harness/test/multisport_map.test.mjs provider-harness/test/theodds_client.test.mjs
git commit -m "feat: add exact multisport registry"
```

---

### Task 4: Multi-Sport Event and Exact Selection Matching

**Files:**

- Create: `provider-harness/src/mispricing_match.mjs`
- Create: `provider-harness/test/mispricing_match.test.mjs`

**Interfaces:**

- Produces: `normalizeParticipant(value)`
- Produces: `matchCandidateEvent(candidate, referenceEvents, { toleranceSeconds? })`
- Produces: `selectionKey({ market, line, outcome })`

- [ ] **Step 1: Write failing matcher tests**

```javascript
import assert from "node:assert/strict";
import test from "node:test";

import {
  matchCandidateEvent,
  normalizeParticipant,
  selectionKey,
} from "../src/mispricing_match.mjs";

test("normalizes team and player punctuation without changing participant order", () => {
  assert.equal(normalizeParticipant("Paris Saint-Germain FC"), "paris saint germain");
  assert.equal(normalizeParticipant("Daniil Medvedev"), "daniil medvedev");
});

test("matches one exact team event inside a sport", () => {
  const candidate = {
    participantOne: "Olympiacos",
    participantTwo: "Real Madrid",
    kickoffUtc: "2026-06-25T18:30:00Z",
  };
  const result = matchCandidateEvent(candidate, [
    {
      id: "ref-1",
      home_team: "Olympiacos",
      away_team: "Real Madrid",
      commence_time: "2026-06-25T18:30:30Z",
    },
  ]);
  assert.equal(result.event.id, "ref-1");
  assert.equal(result.reason, "");
});

test("matches head-to-head players only in the same orientation", () => {
  const candidate = {
    participantOne: "Jannik Sinner",
    participantTwo: "Daniil Medvedev",
    kickoffUtc: "2026-06-25T12:00:00Z",
  };
  const reversed = [{
    id: "tennis-1",
    home_team: "Daniil Medvedev",
    away_team: "Jannik Sinner",
    commence_time: "2026-06-25T12:00:00Z",
  }];
  assert.equal(matchCandidateEvent(candidate, reversed).reason, "NO_EVENT_MATCH");
});

test("rejects kickoff mismatch and ambiguous duplicate matches", () => {
  const candidate = {
    participantOne: "A",
    participantTwo: "B",
    kickoffUtc: "2026-06-25T12:00:00Z",
  };
  assert.equal(
    matchCandidateEvent(candidate, [{
      id: "late", home_team: "A", away_team: "B",
      commence_time: "2026-06-25T12:10:00Z",
    }]).reason,
    "NO_EVENT_MATCH",
  );
  const duplicate = [
    { id: "1", home_team: "A", away_team: "B", commence_time: "2026-06-25T12:00:00Z" },
    { id: "2", home_team: "A", away_team: "B", commence_time: "2026-06-25T12:00:20Z" },
  ];
  assert.equal(matchCandidateEvent(candidate, duplicate).reason, "AMBIGUOUS_EVENT_MATCH");
});

test("builds exact market keys including totals line", () => {
  assert.equal(
    selectionKey({ market: "TOTALS", line: "162.5", outcome: "OVER" }),
    "TOTALS|162.5|OVER",
  );
  assert.equal(
    selectionKey({ market: "MATCH_RESULT", line: "", outcome: "1" }),
    "MATCH_RESULT||1",
  );
});
```

- [ ] **Step 2: Run and verify RED**

Run:

```powershell
node --test test/mispricing_match.test.mjs
```

Expected: FAIL with missing module.

- [ ] **Step 3: Implement exact event matching**

```javascript
const ALIASES = new Map([
  ["psg", "paris saint germain"],
  ["paris saint germain fc", "paris saint germain"],
  ["inter milan", "internazionale"],
  ["fc internazionale", "internazionale"],
]);

export function normalizeParticipant(value) {
  const normalized = String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\b(fc|cf|bc|basketball club)\b/gu, " ")
    .replace(/[^a-z0-9]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
  return ALIASES.get(normalized) ?? normalized;
}

export function matchCandidateEvent(
  candidate,
  referenceEvents,
  { toleranceSeconds = 120 } = {},
) {
  const kickoff = new Date(candidate.kickoffUtc).getTime();
  const one = normalizeParticipant(candidate.participantOne);
  const two = normalizeParticipant(candidate.participantTwo);
  const matches = (referenceEvents ?? []).filter((event) => {
    const referenceKickoff = new Date(event.commence_time).getTime();
    return Number.isFinite(referenceKickoff) &&
      Math.abs(referenceKickoff - kickoff) <= toleranceSeconds * 1000 &&
      normalizeParticipant(event.home_team) === one &&
      normalizeParticipant(event.away_team) === two;
  });
  if (matches.length === 0) return { event: null, reason: "NO_EVENT_MATCH" };
  if (matches.length > 1) return { event: null, reason: "AMBIGUOUS_EVENT_MATCH" };
  return { event: matches[0], reason: "" };
}

export function selectionKey({ market, line = "", outcome }) {
  return `${market}|${line}|${outcome}`;
}
```

- [ ] **Step 4: Run focused and full tests**

Run:

```powershell
node --test test/mispricing_match.test.mjs
npm test
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```powershell
git add provider-harness/src/mispricing_match.mjs provider-harness/test/mispricing_match.test.mjs
git commit -m "feat: match multisport candidate events exactly"
```

---

### Task 5: Pinnacle and Median-Consensus Confirmation Engine

**Files:**

- Create: `provider-harness/src/mispricing_confirm.mjs`
- Create: `provider-harness/test/mispricing_confirm.test.mjs`
- Modify: `provider-harness/src/theodds_client.mjs`
- Modify: `provider-harness/test/theodds_client.test.mjs`

**Interfaces:**

- Extends: `getOdds({ sportKey, eventIds?, regions?, markets?, oddsFormat?, includeLinks? })`
- Produces: `confirmCandidate(candidate, referenceEvent, normalizedSelections, { now, maxAgeMs? })`
- Returns:

```javascript
{
  status, reason, pinnacleFairProbability, pinnacleFairOdds, pinnacleEv,
  consensusFairProbability, consensusFairOdds, consensusEv, consensusBooks,
  minimumConfirmedEv, referenceEventId
}
```

- [ ] **Step 1: Add failing filtered-odds client test**

Append:

```javascript
test("filters odds by event ids and can request links", async () => {
  const urls = [];
  const client = createTheOddsApiClient({
    apiKey: "secret",
    fetchImpl: async (url) => {
      urls.push(String(url));
      return jsonResponse([]);
    },
  });
  await client.getOdds({
    sportKey: "basketball_euroleague",
    eventIds: ["a", "b"],
    includeLinks: true,
  });
  const url = new URL(urls[0]);
  assert.equal(url.searchParams.get("eventIds"), "a,b");
  assert.equal(url.searchParams.get("includeLinks"), "true");
});
```

- [ ] **Step 2: Write failing confirmation tests**

```javascript
import assert from "node:assert/strict";
import test from "node:test";

import { confirmCandidate, median } from "../src/mispricing_confirm.mjs";

const now = new Date("2026-06-25T09:00:00Z");
const candidate = {
  providerEventId: "501",
  offeredOdds: 2.5,
  market: "TOTALS",
  line: "162.5",
  outcome: "OVER",
  kickoffUtc: "2026-06-25T18:30:00Z",
};
const referenceEvent = { id: "ref-501" };

function market(bookmaker, over, under, updatedAt = "2026-06-25T08:58:00Z", line = "162.5") {
  return [
    { bookmaker, eventId: "ref-501", market: "TOTALS", line, outcome: "OVER", decimalOdds: over, quoteUpdatedAt: updatedAt },
    { bookmaker, eventId: "ref-501", market: "TOTALS", line, outcome: "UNDER", decimalOdds: under, quoteUpdatedAt: updatedAt },
  ];
}

test("median handles odd and even samples", () => {
  assert.equal(median([0.4, 0.5, 0.6]), 0.5);
  assert.equal(median([0.4, 0.5, 0.6, 0.7]), 0.55);
});

test("confirms only when both Pinnacle and 3-book median exceed strict 20%", () => {
  const rows = [
    ...market("pinnacle", 2.0, 1.9),
    ...market("betsson", 2.02, 1.88),
    ...market("unibet", 2.04, 1.86),
    ...market("williamhill", 2.01, 1.89),
  ];
  const result = confirmCandidate(candidate, referenceEvent, rows, { now });
  assert.equal(result.status, "CONFIRMED");
  assert.ok(result.pinnacleEv > 0.20);
  assert.ok(result.consensusEv > 0.20);
  assert.equal(result.consensusBooks, 3);
  assert.equal(result.minimumConfirmedEv, Math.min(result.pinnacleEv, result.consensusEv));
});

test("exactly 20 percent fails the strict boundary", () => {
  const result = confirmCandidate(
    { ...candidate, offeredOdds: 2.4 },
    referenceEvent,
    [
      ...market("pinnacle", 1.9, 1.9),
      ...market("betsson", 1.9, 1.9),
      ...market("unibet", 1.9, 1.9),
      ...market("williamhill", 1.9, 1.9),
    ],
    { now },
  );
  assert.ok(Math.abs(result.pinnacleEv - 0.20) < 1e-9);
  assert.ok(Math.abs(result.consensusEv - 0.20) < 1e-9);
  assert.notEqual(result.status, "CONFIRMED");
});

test("rejects fewer than three consensus books, wrong line, stale market, and missing Pinnacle", () => {
  const cases = [
    [
      [...market("pinnacle", 2, 1.9), ...market("betsson", 2, 1.9), ...market("unibet", 2, 1.9)],
      "INSUFFICIENT_CONSENSUS",
    ],
    [
      [
        ...market("pinnacle", 2, 1.9, undefined, "163.5"),
        ...market("a", 2, 1.9, undefined, "163.5"),
        ...market("b", 2, 1.9, undefined, "163.5"),
        ...market("c", 2, 1.9, undefined, "163.5"),
      ],
      "NO_EXACT_PINNACLE_MARKET",
    ],
    [
      [
        ...market("pinnacle", 2, 1.9, "2026-06-25T08:40:00Z"),
        ...market("a", 2, 1.9), ...market("b", 2, 1.9), ...market("c", 2, 1.9),
      ],
      "STALE_PINNACLE_MARKET",
    ],
    [
      [...market("a", 2, 1.9), ...market("b", 2, 1.9), ...market("c", 2, 1.9)],
      "NO_EXACT_PINNACLE_MARKET",
    ],
  ];
  for (const [rows, reason] of cases) {
    assert.equal(
      confirmCandidate(candidate, referenceEvent, rows, { now }).reason,
      reason,
    );
  }
});

test("rejects an incomplete football 1X2 market with no draw", () => {
  const football = {
    ...candidate,
    sportSlug: "football",
    market: "MATCH_RESULT",
    line: "",
    outcome: "1",
  };
  const rows = [
    { bookmaker: "pinnacle", eventId: "ref-501", market: "MATCH_RESULT", line: "", outcome: "1", decimalOdds: 1.5, quoteUpdatedAt: "2026-06-25T08:58:00Z" },
    { bookmaker: "pinnacle", eventId: "ref-501", market: "MATCH_RESULT", line: "", outcome: "2", decimalOdds: 3.0, quoteUpdatedAt: "2026-06-25T08:58:00Z" },
  ];
  assert.equal(
    confirmCandidate(football, referenceEvent, rows, { now }).reason,
    "NO_EXACT_PINNACLE_MARKET",
  );
});
```

- [ ] **Step 3: Run and verify RED**

Run:

```powershell
node --test test/mispricing_confirm.test.mjs test/theodds_client.test.mjs
```

Expected: missing confirmation module and filtered client assertions fail.

- [ ] **Step 4: Extend The Odds client filtering**

Replace `getOdds` in `theodds_client.mjs` with:

```javascript
getOdds({
  sportKey,
  regions = "eu",
  markets = "h2h,totals",
  oddsFormat = "decimal",
  eventIds,
  includeLinks = false,
}) {
  const parameters = { regions, markets, oddsFormat };
  if (eventIds?.length) parameters.eventIds = eventIds.join(",");
  if (includeLinks) parameters.includeLinks = true;
  return request(`/sports/${sportKey}/odds`, parameters);
},
```

- [ ] **Step 5: Implement confirmation logic**

Create `provider-harness/src/mispricing_confirm.mjs`:

```javascript
import { selectionKey } from "./mispricing_match.mjs";
import { devigPower } from "./value.mjs";

const MAX_AGE_MS = 10 * 60 * 1000;
const EXCLUDED_CONSENSUS = new Set(["pinnacle", "stoiximan", "superbet"]);

export function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function exactMarket(rows, candidate) {
  return rows.filter((row) =>
    row.market === candidate.market &&
    String(row.line ?? "") === String(candidate.line ?? ""),
  );
}

function validTimestamp(value, now, maxAgeMs) {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) &&
    now.getTime() - timestamp <= maxAgeMs &&
    timestamp <= now.getTime() + 60_000;
}

function expectedOutcomes(candidate) {
  if (candidate.market === "TOTALS") return new Set(["OVER", "UNDER"]);
  return candidate.sportSlug === "football"
    ? new Set(["1", "X", "2"])
    : new Set(["1", "2"]);
}

function fairForBook(rows, candidate) {
  const marketRows = exactMarket(rows, candidate);
  const actual = new Set(marketRows.map((row) => row.outcome));
  const expected = expectedOutcomes(candidate);
  if (
    actual.size !== expected.size ||
    [...expected].some((outcome) => !actual.has(outcome))
  ) {
    return { probability: undefined, rows: marketRows };
  }
  const key = selectionKey(candidate);
  return {
    probability: devigPower(marketRows).get(key),
    rows: marketRows,
  };
}

export function confirmCandidate(
  candidate,
  referenceEvent,
  normalizedSelections,
  { now, maxAgeMs = MAX_AGE_MS },
) {
  const rows = normalizedSelections.filter((row) => row.eventId === String(referenceEvent.id));
  const pinnacleRows = rows.filter((row) => row.bookmaker === "pinnacle");
  const pinnacle = fairForBook(pinnacleRows, candidate);
  if (pinnacle.probability === undefined) {
    return { status: "REJECTED", reason: "NO_EXACT_PINNACLE_MARKET" };
  }
  if (!pinnacle.rows.every((row) => validTimestamp(row.quoteUpdatedAt, now, maxAgeMs))) {
    return { status: "REJECTED", reason: "STALE_PINNACLE_MARKET" };
  }

  const byBook = new Map();
  for (const row of rows) {
    if (EXCLUDED_CONSENSUS.has(row.bookmaker)) continue;
    if (!byBook.has(row.bookmaker)) byBook.set(row.bookmaker, []);
    byBook.get(row.bookmaker).push(row);
  }
  const probabilities = [];
  for (const bookRows of byBook.values()) {
    const result = fairForBook(bookRows, candidate);
    if (result.probability === undefined) continue;
    if (!result.rows.every((row) => validTimestamp(row.quoteUpdatedAt, now, maxAgeMs))) continue;
    probabilities.push(result.probability);
  }
  if (probabilities.length < 3) {
    return { status: "REJECTED", reason: "INSUFFICIENT_CONSENSUS" };
  }

  const consensusFairProbability = median(probabilities);
  const pinnacleFairProbability = pinnacle.probability;
  const pinnacleEv = candidate.offeredOdds * pinnacleFairProbability - 1;
  const consensusEv = candidate.offeredOdds * consensusFairProbability - 1;
  const base = {
    referenceEventId: String(referenceEvent.id),
    pinnacleFairProbability,
    pinnacleFairOdds: 1 / pinnacleFairProbability,
    pinnacleEv,
    consensusFairProbability,
    consensusFairOdds: 1 / consensusFairProbability,
    consensusEv,
    consensusBooks: probabilities.length,
    minimumConfirmedEv: Math.min(pinnacleEv, consensusEv),
  };
  if (!(pinnacleEv > 0.20)) {
    return { ...base, status: "REJECTED", reason: "PINNACLE_EV_NOT_ABOVE_20" };
  }
  if (!(consensusEv > 0.20)) {
    return { ...base, status: "REJECTED", reason: "CONSENSUS_EV_NOT_ABOVE_20" };
  }
  return { ...base, status: "CONFIRMED", reason: "" };
}
```

- [ ] **Step 6: Run focused and full tests**

Run:

```powershell
node --test test/mispricing_confirm.test.mjs test/theodds_client.test.mjs
npm test
```

Expected: all tests PASS.

- [ ] **Step 7: Commit**

```powershell
git add provider-harness/src/mispricing_confirm.mjs provider-harness/src/theodds_client.mjs provider-harness/test/mispricing_confirm.test.mjs provider-harness/test/theodds_client.test.mjs
git commit -m "feat: confirm mispricing against sharp consensus"
```

---

### Task 6: Persistent Queue, Audit, Deduplication, and Health State

**Files:**

- Create: `provider-harness/src/mispricing_state.mjs`
- Create: `provider-harness/test/mispricing_state.test.mjs`

**Interfaces:**

- Produces constants: `QUEUE_COLUMNS`, `ALERT_COLUMNS`, `AUDIT_COLUMNS`
- Produces: `candidateIdentity(row)`
- Produces: `mergeQueue(existing, incoming, { now })`
- Produces: `selectSportGroups(rows, { maxSports = 2 })`
- Produces: `shouldSendAlert(previous, confirmation)`
- Produces async repository: `createMispricingState({ reportsDir })`

- [ ] **Step 1: Write failing pure-state and repository tests**

```javascript
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  candidateIdentity,
  createMispricingState,
  mergeQueue,
  selectSportGroups,
  shouldSendAlert,
} from "../src/mispricing_state.mjs";

function candidate(overrides = {}) {
  return {
    candidateId: "c1", providerEventId: "501", bookmaker: "Stoiximan",
    sportKey: "basketball_euroleague", kickoffUtc: "2026-06-25T18:30:00Z",
    market: "TOTALS", line: "162.5", outcome: "OVER",
    offeredOdds: 2.4, providerExpectedValue: 0.25,
    firstQueuedAt: "2026-06-25T08:00:00Z",
    ...overrides,
  };
}

test("candidate identity includes event, bookmaker, market, line, and outcome", () => {
  assert.equal(
    candidateIdentity(candidate()),
    "501|Stoiximan|TOTALS|162.5|OVER",
  );
});

test("queue keeps latest odds but preserves first queued time and removes started events", () => {
  const existing = [candidate({ offeredOdds: 2.2 })];
  const incoming = [candidate({ offeredOdds: 2.5, firstQueuedAt: "" })];
  const rows = mergeQueue(existing, incoming, {
    now: new Date("2026-06-25T09:00:00Z"),
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].offeredOdds, 2.5);
  assert.equal(rows[0].firstQueuedAt, "2026-06-25T08:00:00Z");
  assert.equal(
    mergeQueue(rows, [], { now: new Date("2026-06-25T19:00:00Z") }).length,
    0,
  );
});

test("selects at most two sport groups by EV, kickoff, then queue age", () => {
  const selected = selectSportGroups([
    candidate({ sportKey: "sport-a", providerExpectedValue: 0.22 }),
    candidate({ sportKey: "sport-b", providerExpectedValue: 0.40 }),
    candidate({ sportKey: "sport-c", providerExpectedValue: 0.30 }),
  ]);
  assert.deepEqual([...selected.keys()], ["sport-b", "sport-c"]);
});

test("dedup sends first alert and only updates after five percentage points", () => {
  assert.equal(shouldSendAlert(null, { minimumConfirmedEv: 0.24 }), true);
  assert.equal(
    shouldSendAlert({ minimumConfirmedEv: "0.24" }, { minimumConfirmedEv: 0.289 }),
    false,
  );
  assert.equal(
    shouldSendAlert({ minimumConfirmedEv: "0.24" }, { minimumConfirmedEv: 0.29 }),
    true,
  );
});

test("repository refuses corrupt health JSON and writes CSV state", async () => {
  const reportsDir = await mkdtemp(join(tmpdir(), "mispricing-state-"));
  const state = createMispricingState({ reportsDir });
  await state.writeQueue([candidate()]);
  assert.match(await readFile(join(reportsDir, "mispricing-queue.csv"), "utf8"), /candidateId/);
  const restored = await state.readQueue();
  assert.equal(typeof restored[0].offeredOdds, "number");
  assert.equal(typeof restored[0].providerExpectedValue, "number");

  await writeFile(join(reportsDir, "mispricing-health.json"), "{broken");
  await assert.rejects(() => state.readHealth(), /invalid mispricing health state/);
  assert.equal(await readFile(join(reportsDir, "mispricing-health.json"), "utf8"), "{broken");
});

test("repository rejects malformed queue CSV without rewriting it", async () => {
  const reportsDir = await mkdtemp(join(tmpdir(), "mispricing-corrupt-csv-"));
  const path = join(reportsDir, "mispricing-queue.csv");
  const original = "candidateId,providerEventId\nc1,\n";
  await writeFile(path, original);
  const state = createMispricingState({ reportsDir });
  await assert.rejects(() => state.readQueue(), /invalid mispricing queue row/);
  assert.equal(await readFile(path, "utf8"), original);
});
```

- [ ] **Step 2: Run and verify RED**

Run:

```powershell
node --test test/mispricing_state.test.mjs
```

Expected: missing module.

- [ ] **Step 3: Implement state module**

Implement `provider-harness/src/mispricing_state.mjs` using existing
`readCsv`/`writeCsv`, with these exact exports:

```javascript
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readCsv, writeCsv } from "./csv.mjs";

export const QUEUE_COLUMNS = [
  "candidateId", "providerEventId", "bookmaker", "sportKey",
  "sportSlug", "leagueSlug", "sportName", "leagueName",
  "kickoffUtc", "participantOne", "participantTwo",
  "market", "line", "outcome", "offeredOdds", "providerExpectedValue",
  "valueUpdatedAt", "receivedAt", "link", "linkDepth", "firstQueuedAt",
];
export const ALERT_COLUMNS = [
  "identity", "sentAt", "candidateId", "providerEventId", "referenceEventId",
  "bookmaker", "market", "line", "outcome", "offeredOdds",
  "pinnacleEv", "consensusEv", "minimumConfirmedEv", "telegramMessageId",
];
export const AUDIT_COLUMNS = [
  "auditedAt", "runMode", "candidateId", "providerEventId", "bookmaker",
  "sportKey", "sportSlug", "leagueSlug", "sportName", "leagueName",
  "market", "line", "outcome", "status", "reason",
  "pinnacleEv", "consensusEv", "consensusBooks",
];

const exists = (path) => access(path).then(() => true, () => false);

export function candidateIdentity(row) {
  return [
    row.providerEventId, row.bookmaker, row.market,
    String(row.line ?? ""), row.outcome,
  ].join("|");
}

export function mergeQueue(existing, incoming, { now }) {
  const byIdentity = new Map();
  for (const row of existing) {
    if (new Date(row.kickoffUtc).getTime() > now.getTime()) {
      byIdentity.set(candidateIdentity(row), row);
    }
  }
  for (const row of incoming) {
    if (new Date(row.kickoffUtc).getTime() <= now.getTime()) continue;
    const key = candidateIdentity(row);
    const prior = byIdentity.get(key);
    byIdentity.set(key, {
      ...prior,
      ...row,
      firstQueuedAt: prior?.firstQueuedAt || row.firstQueuedAt || now.toISOString(),
    });
  }
  return [...byIdentity.values()];
}

export function selectSportGroups(rows, { maxSports = 2 } = {}) {
  const bySport = new Map();
  for (const row of rows) {
    if (!bySport.has(row.sportKey)) bySport.set(row.sportKey, []);
    bySport.get(row.sportKey).push(row);
  }
  const ranked = [...bySport.entries()].sort(([, left], [, right]) => {
    const maxEv = (group) => Math.max(...group.map((row) => Number(row.providerExpectedValue)));
    const minKickoff = (group) => Math.min(...group.map((row) => new Date(row.kickoffUtc).getTime()));
    const minQueued = (group) => Math.min(...group.map((row) => new Date(row.firstQueuedAt).getTime()));
    return maxEv(right) - maxEv(left) ||
      minKickoff(left) - minKickoff(right) ||
      minQueued(left) - minQueued(right);
  });
  return new Map(ranked.slice(0, maxSports));
}

export function shouldSendAlert(previous, confirmation) {
  if (!previous) return true;
  return confirmation.minimumConfirmedEv - Number(previous.minimumConfirmedEv) >= 0.05;
}

export function createMispricingState({ reportsDir }) {
  const paths = {
    queue: join(reportsDir, "mispricing-queue.csv"),
    alerts: join(reportsDir, "mispricing-alerts.csv"),
    audit: join(reportsDir, "mispricing-audit.csv"),
    health: join(reportsDir, "mispricing-health.json"),
  };
  const readRows = async (path) => await exists(path) ? readCsv(path) : [];
  const requireFields = (rows, fields, label) => {
    for (const row of rows) {
      for (const field of fields) {
        if (String(row[field] ?? "").trim() === "") {
          throw new Error(`invalid mispricing ${label} row: missing ${field}`);
        }
      }
    }
    return rows;
  };
  const hydrateQueue = (rows) => rows.map((row) => {
    const offeredOdds = Number(row.offeredOdds);
    const providerExpectedValue = Number(row.providerExpectedValue);
    if (!(offeredOdds > 1) || !Number.isFinite(providerExpectedValue)) {
      throw new Error("invalid mispricing queue row: invalid numeric field");
    }
    return { ...row, offeredOdds, providerExpectedValue };
  });
  return {
    async readQueue() {
      return hydrateQueue(
        requireFields(
          await readRows(paths.queue),
          ["candidateId", "providerEventId", "bookmaker", "sportKey", "kickoffUtc", "market", "outcome"],
          "queue",
        ),
      );
    },
    writeQueue: (rows) => writeCsv(paths.queue, rows, QUEUE_COLUMNS),
    async readAlerts() {
      return requireFields(
        await readRows(paths.alerts),
        ["identity", "sentAt", "candidateId", "bookmaker", "market", "outcome"],
        "alerts",
      );
    },
    writeAlerts: (rows) => writeCsv(paths.alerts, rows, ALERT_COLUMNS),
    async readAudit() {
      return requireFields(
        await readRows(paths.audit),
        ["auditedAt", "runMode", "candidateId", "bookmaker", "status"],
        "audit",
      );
    },
    writeAudit: (rows) => writeCsv(paths.audit, rows, AUDIT_COLUMNS),
    async readHealth() {
      if (!await exists(paths.health)) {
        return {
          oddsApiFailures: 0,
          referenceFailures: 0,
          telegramFailures: 0,
          oddsApiWarningSent: false,
          referenceWarningSent: false,
        };
      }
      try {
        return JSON.parse(await readFile(paths.health, "utf8"));
      } catch {
        throw new Error("invalid mispricing health state");
      }
    },
    async writeHealth(value) {
      await mkdir(reportsDir, { recursive: true });
      await writeFile(paths.health, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    },
  };
}
```

- [ ] **Step 4: Run focused and full tests**

Run:

```powershell
node --test test/mispricing_state.test.mjs
npm test
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```powershell
git add provider-harness/src/mispricing_state.mjs provider-harness/test/mispricing_state.test.mjs
git commit -m "feat: persist mispricing queue and alert state"
```

---

### Task 7: Telegram Client, Alert Formatting, and Inline Button

**Files:**

- Create: `provider-harness/src/telegram.mjs`
- Create: `provider-harness/test/telegram.test.mjs`

**Interfaces:**

- Produces: `formatMispricingMessage(candidate, confirmation)`
- Produces: `createTelegramClient({ token, chatId, fetchImpl?, baseUrl? })`
- Produces methods:
  - `sendMispricing(candidate, confirmation)`
  - `sendText(text)`

- [ ] **Step 1: Write failing formatting and HTTP tests**

```javascript
import assert from "node:assert/strict";
import test from "node:test";

import {
  createTelegramClient,
  formatMispricingMessage,
} from "../src/telegram.mjs";

const candidate = {
  bookmaker: "Stoiximan",
  sportName: "Basketball",
  leagueName: "EuroLeague",
  participantOne: "Olympiacos",
  participantTwo: "Real Madrid",
  kickoffUtc: "2026-06-25T18:30:00Z",
  market: "TOTALS",
  line: "162.5",
  outcome: "OVER",
  offeredOdds: 2.4,
  valueUpdatedAt: "2026-06-25T08:58:00Z",
  link: "https://www.stoiximan.gr/addToBetslip/over-162-5",
  linkDepth: "OUTCOME",
};
const confirmation = {
  pinnacleFairOdds: 1.91,
  pinnacleEv: 0.257,
  consensusFairOdds: 1.95,
  consensusEv: 0.231,
  consensusBooks: 6,
};

test("formats a Greece-time alert with exact pick and verification warning", () => {
  const text = formatMispricingMessage(candidate, confirmation);
  assert.match(text, /CONFIRMED MISPRICING >20%/);
  assert.match(text, /Basketball — EuroLeague/);
  assert.match(text, /Olympiacos vs Real Madrid/);
  assert.match(text, /Over 162\.5/);
  assert.match(text, /Pinnacle fair: 1\.91 \| EV: \+25\.7%/);
  assert.match(text, /Consensus fair: 1\.95 \| EV: \+23\.1% \| 6 books/);
  assert.match(text, /Verify the displayed price/);
});

test("sends Telegram message with exact-selection button", async () => {
  const calls = [];
  const client = createTelegramClient({
    token: "secret-token",
    chatId: "12345",
    fetchImpl: async (url, init) => {
      calls.push([String(url), JSON.parse(init.body)]);
      return new Response(JSON.stringify({ ok: true, result: { message_id: 77 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  const response = await client.sendMispricing(candidate, confirmation);
  assert.equal(response.messageId, "77");
  const [url, body] = calls[0];
  assert.match(url, /\/botsecret-token\/sendMessage$/);
  assert.equal(body.chat_id, "12345");
  assert.deepEqual(body.reply_markup.inline_keyboard, [[{
    text: "Open in Stoiximan",
    url: candidate.link,
  }]]);
});

test("omits the button when no safe link exists and redacts token on failure", async () => {
  let sentBody;
  const token = "never-print-this";
  const client = createTelegramClient({
    token,
    chatId: "12345",
    fetchImpl: async (_url, init) => {
      sentBody = JSON.parse(init.body);
      return new Response(JSON.stringify({ ok: false, description: token }), { status: 500 });
    },
  });
  await assert.rejects(
    () => client.sendMispricing({
      ...candidate,
      link: "https://evil.example/phishing",
      linkDepth: "OUTCOME",
    }, confirmation),
    (error) => {
      assert.match(error.message, /Telegram request failed with status 500/);
      assert.doesNotMatch(error.message, new RegExp(token));
      return true;
    },
  );
  assert.equal(sentBody.reply_markup, undefined);
});
```

- [ ] **Step 2: Run and verify RED**

Run:

```powershell
node --test test/telegram.test.mjs
```

Expected: missing module.

- [ ] **Step 3: Implement Telegram module**

```javascript
import { chooseBookmakerLink } from "./mispricing_normalize.mjs";

function pickLabel(candidate) {
  if (candidate.market === "TOTALS") {
    const side = candidate.outcome === "OVER" ? "Over" : "Under";
    return `${side} ${candidate.line}`;
  }
  return { "1": candidate.participantOne, X: "Draw", "2": candidate.participantTwo }[
    candidate.outcome
  ];
}

function percent(value) {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;
}

export function formatMispricingMessage(candidate, confirmation) {
  const kickoff = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Athens",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(candidate.kickoffUtc));
  const linkNote = candidate.linkDepth === "EVENT"
    ? "\nLink opens the event page; select the exact pick shown above."
    : "";
  return [
    "🚨 CONFIRMED MISPRICING >20%",
    "",
    `Sport: ${candidate.sportName} — ${candidate.leagueName}`,
    `Event: ${candidate.participantOne} vs ${candidate.participantTwo}`,
    `Start: ${kickoff} Greece`,
    `Book: ${candidate.bookmaker}`,
    `Pick: ${pickLabel(candidate)}`,
    `Offered: ${candidate.offeredOdds.toFixed(2)}`,
    "",
    `Pinnacle fair: ${confirmation.pinnacleFairOdds.toFixed(2)} | EV: ${percent(confirmation.pinnacleEv)}`,
    `Consensus fair: ${confirmation.consensusFairOdds.toFixed(2)} | EV: ${percent(confirmation.consensusEv)} | ${confirmation.consensusBooks} books`,
    "",
    "Verify the displayed price and exact market before betting.",
    linkNote,
  ].filter((line) => line !== "").join("\n");
}

export function createTelegramClient({
  token,
  chatId,
  fetchImpl = fetch,
  baseUrl = "https://api.telegram.org",
}) {
  async function send(body) {
    const response = await fetchImpl(
      `${baseUrl.replace(/\/$/u, "")}/bot${token}/sendMessage`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, ...body }),
      },
    );
    if (!response.ok) {
      throw new Error(`Telegram request failed with status ${response.status}`);
    }
    const payload = await response.json();
    if (!payload.ok) throw new Error("Telegram request returned ok=false");
    return { messageId: String(payload.result.message_id) };
  }

  return {
    sendText(text) {
      return send({ text });
    },
    sendMispricing(candidate, confirmation) {
      const body = { text: formatMispricingMessage(candidate, confirmation) };
      const safeLink = chooseBookmakerLink({
        bookmaker: candidate.bookmaker,
        outcomeLink: candidate.link,
      }).url;
      if (safeLink) {
        body.reply_markup = {
          inline_keyboard: [[{
            text: `Open in ${candidate.bookmaker}`,
            url: safeLink,
          }]],
        };
      }
      return send(body);
    },
  };
}
```

- [ ] **Step 4: Run focused and full tests**

Run:

```powershell
node --test test/telegram.test.mjs
npm test
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```powershell
git add provider-harness/src/telegram.mjs provider-harness/test/telegram.test.mjs
git commit -m "feat: send confirmed Telegram mispricing alerts"
```

---

### Task 8: Candidate-First Scanner Orchestration and Quota Guard

**Files:**

- Create: `provider-harness/src/mispricing_scan.mjs`
- Create: `provider-harness/test/mispricing_scan.test.mjs`

**Interfaces:**

- Produces:

```javascript
runMispricingScan({
  valueBetsClient, referenceClient, telegramClient, state, registry,
  reportsDir, now, dryRun = false, out = () => {}
})
```

- Uses Tasks 1–7 interfaces.
- Returns summary:

```javascript
{
  candidates, mapped, verifiedSports, confirmed, sent, deferred,
  rejected, dryRun, quotaRemaining
}
```

- [ ] **Step 1: Write failing end-to-end orchestration tests with injected fakes**

Create tests covering:

```javascript
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runMispricingScan } from "../src/mispricing_scan.mjs";
import { createMispricingState } from "../src/mispricing_state.mjs";

const now = new Date("2026-06-25T09:00:00Z");

function rawCandidate({
  bookmaker = "Stoiximan",
  eventId = 501,
  sportName = "Basketball",
  sportSlug = "basketball",
  leagueName = "EuroLeague",
  leagueSlug = "euroleague",
  home = "Olympiacos",
  away = "Real Madrid",
  date = "2026-06-25T18:30:00Z",
} = {}) {
  return {
    id: `${eventId}-Totals-over-${bookmaker}-162.5`,
    expectedValue: 25,
    expectedValueUpdatedAt: "2026-06-25T08:58:00Z",
    betSide: "over",
    bookmaker,
    eventId,
    event: {
      home, away, date,
      sport: { name: sportName, slug: sportSlug },
      league: { name: leagueName, slug: leagueSlug },
    },
    market: { name: "Totals", hdp: 162.5, over: "2.50", under: "1.50" },
    bookmakerOdds: { over: "2.50", under: "1.50" },
  };
}

function referenceOdds({
  eventId = "ref-501",
  title = "EuroLeague",
  home = "Olympiacos",
  away = "Real Madrid",
  date = "2026-06-25T18:30:00Z",
} = {}) {
  const book = (key, over, under) => ({
    key, title: key, last_update: "2026-06-25T08:58:00Z",
    markets: [{
      key: "totals", last_update: "2026-06-25T08:58:00Z",
      outcomes: [
        { name: "Over", point: 162.5, price: over },
        { name: "Under", point: 162.5, price: under },
      ],
    }],
  });
  return [{
    id: eventId, sport_title: title, commence_time: date,
    home_team: home, away_team: away,
    bookmakers: [
      book("pinnacle", 2.0, 1.9),
      book("betsson", 2.02, 1.88),
      book("unibet", 2.04, 1.86),
      book("williamhill", 2.01, 1.89),
    ],
  }];
}

function singleSportDeps({ reportsDir, state, sent = [], quotaRemaining = 498 }) {
  return {
    valueBetsClient: {
      async getValueBets({ bookmaker }) {
        return {
          data: [rawCandidate({ bookmaker })],
          receivedAt: "2026-06-25T09:00:00Z",
          rateLimit: { remaining: 90 },
        };
      },
    },
    referenceClient: {
      async listSports() {
        return { data: [{ key: "basketball_euroleague", active: true }] };
      },
      async listEvents() {
        return { data: [{
          id: "ref-501", home_team: "Olympiacos", away_team: "Real Madrid",
          commence_time: "2026-06-25T18:30:00Z",
        }] };
      },
      async getOdds() {
        return {
          data: referenceOdds(),
          receivedAt: "2026-06-25T09:00:00Z",
          quota: { remaining: quotaRemaining, used: 2, lastCost: 2 },
        };
      },
    },
    telegramClient: {
      async sendMispricing(candidate) {
        sent.push(candidate.bookmaker);
        return { messageId: String(sent.length) };
      },
    },
    state,
    registry: new Map([["basketball|euroleague", "basketball_euroleague"]]),
    reportsDir,
    now,
  };
}

test("confirms, sends once, records delivery, and does not duplicate", async () => {
  const reportsDir = await mkdtemp(join(tmpdir(), "mispricing-scan-"));
  const state = createMispricingState({ reportsDir });
  const sent = [];
  const deps = singleSportDeps({ reportsDir, state, sent });

  const first = await runMispricingScan(deps);
  const second = await runMispricingScan(deps);
  assert.equal(first.sent, 2);
  assert.equal(second.sent, 0);
  assert.deepEqual(sent.sort(), ["Stoiximan", "Superbet"]);
});

test("dry run verifies but sends and records no delivered alert", async () => {
  const reportsDir = await mkdtemp(join(tmpdir(), "mispricing-dry-"));
  const state = createMispricingState({ reportsDir });
  const sent = [];
  const summary = await runMispricingScan({
    ...singleSportDeps({ reportsDir, state, sent }),
    dryRun: true,
  });
  assert.equal(summary.confirmed, 2);
  assert.equal(summary.sent, 0);
  assert.deepEqual(sent, []);
  assert.deepEqual(await state.readAlerts(), []);
});

test("verifies at most two sport keys and defers remaining groups", async () => {
  const reportsDir = await mkdtemp(join(tmpdir(), "mispricing-cap-"));
  const state = createMispricingState({ reportsDir });
  const definitions = [
    {
      eventId: 501, sportName: "Basketball", sportSlug: "basketball",
      leagueName: "EuroLeague", leagueSlug: "euroleague",
      sportKey: "basketball_euroleague", referenceId: "ref-501",
      home: "Olympiacos", away: "Real Madrid",
    },
    {
      eventId: 601, sportName: "Baseball", sportSlug: "baseball",
      leagueName: "MLB", leagueSlug: "mlb",
      sportKey: "baseball_mlb", referenceId: "ref-601",
      home: "Yankees", away: "Red Sox",
    },
    {
      eventId: 701, sportName: "Ice Hockey", sportSlug: "ice-hockey",
      leagueName: "NHL", leagueSlug: "nhl",
      sportKey: "icehockey_nhl", referenceId: "ref-701",
      home: "Rangers", away: "Bruins",
    },
  ];
  let oddsCalls = 0;
  const summary = await runMispricingScan({
    valueBetsClient: {
      async getValueBets({ bookmaker }) {
        return {
          data: definitions.map((item) => rawCandidate({ bookmaker, ...item })),
          receivedAt: now.toISOString(),
        };
      },
    },
    referenceClient: {
      async listSports() {
        return { data: definitions.map((item) => ({ key: item.sportKey, active: true })) };
      },
      async listEvents({ sportKey }) {
        const item = definitions.find((entry) => entry.sportKey === sportKey);
        return { data: [{
          id: item.referenceId, home_team: item.home, away_team: item.away,
          commence_time: "2026-06-25T18:30:00Z",
        }] };
      },
      async getOdds({ sportKey }) {
        oddsCalls += 1;
        const item = definitions.find((entry) => entry.sportKey === sportKey);
        return {
          data: referenceOdds({
            eventId: item.referenceId,
            title: item.leagueName,
            home: item.home,
            away: item.away,
          }),
          receivedAt: now.toISOString(),
          quota: { remaining: 500 - oddsCalls * 2, lastCost: 2 },
        };
      },
    },
    telegramClient: { async sendMispricing() { return { messageId: "1" }; } },
    state,
    registry: new Map(definitions.map((item) => [
      `${item.sportSlug}|${item.leagueSlug}`, item.sportKey,
    ])),
    reportsDir,
    now,
  });
  assert.equal(oddsCalls, 2);
  assert.equal(summary.verifiedSports, 2);
  assert.ok(summary.deferred >= 2);
  assert.ok((await state.readQueue()).length >= 2);
});

test("stops before verification when quota reserve is reached", async () => {
  const reportsDir = await mkdtemp(join(tmpdir(), "mispricing-quota-"));
  const state = createMispricingState({ reportsDir });
  const candidates = [
    rawCandidate({ eventId: 501 }),
    rawCandidate({
      eventId: 601, sportName: "Baseball", sportSlug: "baseball",
      leagueName: "MLB", leagueSlug: "mlb", home: "Yankees", away: "Red Sox",
    }),
  ];
  let oddsCalls = 0;
  const summary = await runMispricingScan({
    valueBetsClient: {
      async getValueBets({ bookmaker }) {
        return {
          data: candidates.map((row) => ({ ...row, bookmaker })),
          receivedAt: now.toISOString(),
        };
      },
    },
    referenceClient: {
      async listSports() {
        return { data: [
          { key: "basketball_euroleague", active: true },
          { key: "baseball_mlb", active: true },
        ] };
      },
      async listEvents({ sportKey }) {
        const baseball = sportKey === "baseball_mlb";
        return { data: [{
          id: baseball ? "ref-601" : "ref-501",
          home_team: baseball ? "Yankees" : "Olympiacos",
          away_team: baseball ? "Red Sox" : "Real Madrid",
          commence_time: "2026-06-25T18:30:00Z",
        }] };
      },
      async getOdds({ sportKey }) {
        oddsCalls += 1;
        const baseball = sportKey === "baseball_mlb";
        return {
          data: referenceOdds({
            eventId: baseball ? "ref-601" : "ref-501",
            title: baseball ? "MLB" : "EuroLeague",
            home: baseball ? "Yankees" : "Olympiacos",
            away: baseball ? "Red Sox" : "Real Madrid",
          }),
          receivedAt: now.toISOString(),
          quota: { remaining: 100, lastCost: 2 },
        };
      },
    },
    telegramClient: { async sendMispricing() { return { messageId: "1" }; } },
    state,
    registry: new Map([
      ["basketball|euroleague", "basketball_euroleague"],
      ["baseball|mlb", "baseball_mlb"],
    ]),
    reportsDir,
    now,
  });
  assert.equal(oddsCalls, 1);
  assert.equal(summary.quotaRemaining, 100);
  assert.ok(summary.deferred >= 2);
});

test("third consecutive candidate-provider failure sends one health warning", async () => {
  const reportsDir = await mkdtemp(join(tmpdir(), "mispricing-source-fail-"));
  const state = createMispricingState({ reportsDir });
  let referenceCalls = 0;
  const warnings = [];
  const deps = {
    valueBetsClient: { async getValueBets() { throw new Error("source down"); } },
    referenceClient: {
      async listSports() { referenceCalls += 1; return { data: [] }; },
    },
    telegramClient: {
      async sendText(text) {
        warnings.push(text);
        return { messageId: "health-1" };
      },
    },
    state,
    registry: new Map(),
    reportsDir,
    now,
  };
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await assert.rejects(() => runMispricingScan(deps), /source down/);
  }
  assert.equal(referenceCalls, 0);
  assert.equal((await state.readHealth()).oddsApiFailures, 4);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Odds-API\.io failed for 3 consecutive runs/);
});

test("reference failure sends nothing and keeps candidates queued", async () => {
  const reportsDir = await mkdtemp(join(tmpdir(), "mispricing-reference-fail-"));
  const state = createMispricingState({ reportsDir });
  let telegramCalls = 0;
  const deps = singleSportDeps({ reportsDir, state });
  deps.referenceClient.getOdds = async () => { throw new Error("reference down"); };
  deps.telegramClient.sendMispricing = async () => { telegramCalls += 1; };
  const summary = await runMispricingScan(deps);
  assert.equal(summary.sent, 0);
  assert.equal(telegramCalls, 0);
  assert.equal((await state.readQueue()).length, 2);
  assert.equal((await state.readHealth()).referenceFailures, 1);
});

test("active-sports lookup failure queues candidates with known exact mappings", async () => {
  const reportsDir = await mkdtemp(join(tmpdir(), "mispricing-sports-fail-"));
  const state = createMispricingState({ reportsDir });
  const deps = singleSportDeps({ reportsDir, state });
  deps.referenceClient.listSports = async () => { throw new Error("sports down"); };
  await assert.rejects(() => runMispricingScan(deps), /sports down/);
  const queue = await state.readQueue();
  assert.equal(queue.length, 2);
  assert.ok(queue.every((row) => row.sportKey === "basketball_euroleague"));
  assert.equal((await state.readHealth()).referenceFailures, 1);
});

test("Telegram failure records no delivery and leaves retryable queue", async () => {
  const reportsDir = await mkdtemp(join(tmpdir(), "mispricing-telegram-fail-"));
  const state = createMispricingState({ reportsDir });
  const deps = singleSportDeps({ reportsDir, state });
  deps.telegramClient.sendMispricing = async () => { throw new Error("telegram down"); };
  const summary = await runMispricingScan(deps);
  assert.equal(summary.sent, 0);
  assert.deepEqual(await state.readAlerts(), []);
  assert.equal((await state.readQueue()).length, 2);
  assert.equal((await state.readHealth()).telegramFailures, 2);
});
```

- [ ] **Step 2: Run and verify RED**

Run:

```powershell
node --test test/mispricing_scan.test.mjs
```

Expected: missing module.

- [ ] **Step 3: Implement orchestration**

Implement these stages in `runMispricingScan`:

```javascript
import { normalizeValueBets } from "./mispricing_normalize.mjs";
import { resolveSportKey } from "./multisport_map.mjs";
import { matchCandidateEvent } from "./mispricing_match.mjs";
import { confirmCandidate } from "./mispricing_confirm.mjs";
import {
  candidateIdentity,
  mergeQueue,
  selectSportGroups,
  shouldSendAlert,
} from "./mispricing_state.mjs";
import { normalizeTheOddsResponse } from "./theodds_normalize.mjs";

const BOOKMAKERS = ["Stoiximan", "Superbet"];
const QUOTA_RESERVE = 100;

async function maybeSendHealthWarning({
  telegramClient,
  health,
  countField,
  warningField,
  providerLabel,
}) {
  if (Number(health[countField] ?? 0) < 3 || health[warningField]) return;
  try {
    await telegramClient.sendText(
      `Health warning: ${providerLabel} failed for 3 consecutive runs.`,
    );
    health[warningField] = true;
    health.telegramFailures = 0;
  } catch {
    health.telegramFailures = Number(health.telegramFailures ?? 0) + 1;
  }
}

export async function runMispricingScan({
  valueBetsClient,
  referenceClient,
  telegramClient,
  state,
  registry,
  now,
  dryRun = false,
  out = () => {},
}) {
  const summary = {
    candidates: 0, mapped: 0, verifiedSports: 0, confirmed: 0,
    sent: 0, deferred: 0, rejected: 0, dryRun, quotaRemaining: null,
  };
  const audit = await state.readAudit();
  const existingQueue = await state.readQueue();
  const health = await state.readHealth();
  const discovered = [];
  for (const row of existingQueue) {
    if (new Date(row.kickoffUtc).getTime() <= now.getTime()) {
      audit.push({
        auditedAt: now.toISOString(), runMode: dryRun ? "DRY_RUN" : "LIVE",
        candidateId: row.candidateId, providerEventId: row.providerEventId,
        bookmaker: row.bookmaker, sportKey: row.sportKey,
        sportSlug: row.sportSlug, leagueSlug: row.leagueSlug,
        sportName: row.sportName, leagueName: row.leagueName,
        market: row.market, line: row.line, outcome: row.outcome,
        status: "EXPIRED", reason: "EVENT_STARTED",
      });
    }
  }

  try {
    for (const bookmaker of BOOKMAKERS) {
      const response = await valueBetsClient.getValueBets({ bookmaker });
      const normalized = normalizeValueBets(response.data, {
        receivedAt: response.receivedAt,
        now,
      });
      discovered.push(...normalized.candidates);
      summary.rejected += normalized.rejected.length;
      for (const rejected of normalized.rejected) {
        audit.push({
          auditedAt: now.toISOString(), runMode: dryRun ? "DRY_RUN" : "LIVE",
          candidateId: rejected.candidateId,
          providerEventId: rejected.providerEventId,
          bookmaker: rejected.bookmaker,
          sportKey: "", sportSlug: rejected.sportSlug,
          leagueSlug: rejected.leagueSlug, sportName: rejected.sportName,
          leagueName: rejected.leagueName, market: rejected.market,
          line: rejected.line, outcome: rejected.outcome,
          status: "REJECTED", reason: rejected.reason,
        });
      }
    }
    health.oddsApiFailures = 0;
    health.oddsApiWarningSent = false;
  } catch (error) {
    health.oddsApiFailures = Number(health.oddsApiFailures ?? 0) + 1;
    await maybeSendHealthWarning({
      telegramClient,
      health,
      countField: "oddsApiFailures",
      warningField: "oddsApiWarningSent",
      providerLabel: "Odds-API.io",
    });
    await state.writeHealth(health);
    throw error;
  }

  summary.candidates = discovered.length;
  let sportsResponse;
  try {
    sportsResponse = await referenceClient.listSports();
  } catch (error) {
    health.referenceFailures = Number(health.referenceFailures ?? 0) + 1;
    const recoverable = discovered.flatMap((candidate) => {
      const sportKey = registry.get(
        `${candidate.sportSlug}|${candidate.leagueSlug}`,
      );
      return sportKey ? [{ ...candidate, sportKey }] : [];
    });
    await state.writeQueue(
      mergeQueue(existingQueue, recoverable, { now }),
    );
    for (const candidate of recoverable) {
      audit.push({
        auditedAt: now.toISOString(), runMode: dryRun ? "DRY_RUN" : "LIVE",
        candidateId: candidate.candidateId,
        providerEventId: candidate.providerEventId,
        bookmaker: candidate.bookmaker, sportKey: candidate.sportKey,
        sportSlug: candidate.sportSlug, leagueSlug: candidate.leagueSlug,
        sportName: candidate.sportName, leagueName: candidate.leagueName,
        market: candidate.market, line: candidate.line, outcome: candidate.outcome,
        status: "ERROR", reason: "REFERENCE_SPORTS_LOOKUP_ERROR",
      });
    }
    await state.writeAudit(audit);
    await maybeSendHealthWarning({
      telegramClient,
      health,
      countField: "referenceFailures",
      warningField: "referenceWarningSent",
      providerLabel: "The Odds API",
    });
    await state.writeHealth(health);
    throw error;
  }
  summary.quotaRemaining =
    sportsResponse.quota?.remaining ?? summary.quotaRemaining;
  const active = new Set(
    (sportsResponse.data ?? []).filter((sport) => sport.active).map((sport) => sport.key),
  );
  const mapped = [];
  for (const candidate of discovered) {
    const resolution = resolveSportKey(candidate, registry, active);
    if (!resolution.sportKey) {
      audit.push({
        auditedAt: now.toISOString(), runMode: dryRun ? "DRY_RUN" : "LIVE",
        candidateId: candidate.candidateId, providerEventId: candidate.providerEventId,
        bookmaker: candidate.bookmaker, sportKey: "",
        sportSlug: candidate.sportSlug, leagueSlug: candidate.leagueSlug,
        sportName: candidate.sportName, leagueName: candidate.leagueName,
        market: candidate.market,
        line: candidate.line, outcome: candidate.outcome,
        status: "REJECTED", reason: resolution.reason,
      });
      summary.rejected += 1;
      continue;
    }
    mapped.push({ ...candidate, sportKey: resolution.sportKey });
  }
  summary.mapped = mapped.length;

  const queue = mergeQueue(existingQueue, mapped, { now });
  const groups = selectSportGroups(queue, { maxSports: 2 });
  const selectedKeys = new Set(groups.keys());
  const initiallyDeferred = queue.filter((row) => !selectedKeys.has(row.sportKey));
  summary.deferred = initiallyDeferred.length;
  for (const row of initiallyDeferred) {
    audit.push({
      auditedAt: now.toISOString(), runMode: dryRun ? "DRY_RUN" : "LIVE",
      candidateId: row.candidateId, providerEventId: row.providerEventId,
      bookmaker: row.bookmaker, sportKey: row.sportKey,
      sportSlug: row.sportSlug, leagueSlug: row.leagueSlug,
      sportName: row.sportName, leagueName: row.leagueName,
      market: row.market, line: row.line, outcome: row.outcome,
      status: "DEFERRED", reason: "SPORT_CAP",
    });
  }
  const delivered = await state.readAlerts();
  const deliveredByIdentity = new Map(delivered.map((row) => [row.identity, row]));
  const remainingQueue = queue.filter((row) => !selectedKeys.has(row.sportKey));
  let referenceSucceeded = false;
  let referenceFailed = false;

  for (const [sportKey, candidates] of groups) {
    if (summary.quotaRemaining !== null && summary.quotaRemaining <= QUOTA_RESERVE) {
      remainingQueue.push(...candidates);
      summary.deferred += candidates.length;
      for (const candidate of candidates) {
        audit.push({
          auditedAt: now.toISOString(), runMode: dryRun ? "DRY_RUN" : "LIVE",
          candidateId: candidate.candidateId,
          providerEventId: candidate.providerEventId,
          bookmaker: candidate.bookmaker, sportKey,
          sportSlug: candidate.sportSlug, leagueSlug: candidate.leagueSlug,
          sportName: candidate.sportName, leagueName: candidate.leagueName,
          market: candidate.market, line: candidate.line, outcome: candidate.outcome,
          status: "DEFERRED", reason: "QUOTA_RESERVE",
        });
      }
      continue;
    }
    try {
      const events = await referenceClient.listEvents({ sportKey });
      const eventMatches = candidates.map((candidate) => ({
        candidate,
        match: matchCandidateEvent(candidate, events.data ?? []),
      }));
      const eventIds = [...new Set(
        eventMatches.filter((item) => item.match.event).map((item) => String(item.match.event.id)),
      )];
      if (eventIds.length === 0) {
        for (const { candidate, match } of eventMatches) {
          audit.push({
            auditedAt: now.toISOString(), runMode: dryRun ? "DRY_RUN" : "LIVE",
            candidateId: candidate.candidateId,
            providerEventId: candidate.providerEventId,
            bookmaker: candidate.bookmaker, sportKey,
            sportSlug: candidate.sportSlug, leagueSlug: candidate.leagueSlug,
            sportName: candidate.sportName, leagueName: candidate.leagueName,
            market: candidate.market, line: candidate.line, outcome: candidate.outcome,
            status: "REJECTED", reason: match.reason,
          });
        }
        summary.rejected += candidates.length;
        continue;
      }
      const odds = await referenceClient.getOdds({ sportKey, eventIds });
      referenceSucceeded = true;
      summary.quotaRemaining = odds.quota?.remaining ?? summary.quotaRemaining;
      summary.verifiedSports += 1;
      const selections = normalizeTheOddsResponse(odds.data ?? [], odds.receivedAt);

      for (const { candidate, match } of eventMatches) {
        if (!match.event) {
          audit.push({
            auditedAt: now.toISOString(), runMode: dryRun ? "DRY_RUN" : "LIVE",
            candidateId: candidate.candidateId, providerEventId: candidate.providerEventId,
            bookmaker: candidate.bookmaker, sportKey,
            sportSlug: candidate.sportSlug, leagueSlug: candidate.leagueSlug,
            sportName: candidate.sportName, leagueName: candidate.leagueName,
            market: candidate.market,
            line: candidate.line, outcome: candidate.outcome,
            status: "REJECTED", reason: match.reason,
          });
          summary.rejected += 1;
          continue;
        }
        const confirmation = confirmCandidate(candidate, match.event, selections, { now });
        audit.push({
          auditedAt: now.toISOString(), runMode: dryRun ? "DRY_RUN" : "LIVE",
          candidateId: candidate.candidateId, providerEventId: candidate.providerEventId,
          bookmaker: candidate.bookmaker, sportKey,
          sportSlug: candidate.sportSlug, leagueSlug: candidate.leagueSlug,
          sportName: candidate.sportName, leagueName: candidate.leagueName,
          market: candidate.market,
          line: candidate.line, outcome: candidate.outcome,
          status: confirmation.status, reason: confirmation.reason,
          pinnacleEv: confirmation.pinnacleEv ?? "",
          consensusEv: confirmation.consensusEv ?? "",
          consensusBooks: confirmation.consensusBooks ?? "",
        });
        if (confirmation.status !== "CONFIRMED") {
          summary.rejected += 1;
          continue;
        }
        summary.confirmed += 1;
        const identity = candidateIdentity(candidate);
        if (dryRun || !shouldSendAlert(deliveredByIdentity.get(identity), confirmation)) continue;
        try {
          const telegram = await telegramClient.sendMispricing(candidate, confirmation);
          delivered.push({
            identity, sentAt: now.toISOString(), candidateId: candidate.candidateId,
            providerEventId: candidate.providerEventId,
            referenceEventId: confirmation.referenceEventId,
            bookmaker: candidate.bookmaker, market: candidate.market,
            line: candidate.line, outcome: candidate.outcome,
            offeredOdds: candidate.offeredOdds,
            pinnacleEv: confirmation.pinnacleEv,
            consensusEv: confirmation.consensusEv,
            minimumConfirmedEv: confirmation.minimumConfirmedEv,
            telegramMessageId: telegram.messageId,
          });
          deliveredByIdentity.set(identity, delivered.at(-1));
          summary.sent += 1;
          health.telegramFailures = 0;
        } catch {
          health.telegramFailures = Number(health.telegramFailures ?? 0) + 1;
          remainingQueue.push(candidate);
          audit.push({
            auditedAt: now.toISOString(), runMode: "LIVE",
            candidateId: candidate.candidateId,
            providerEventId: candidate.providerEventId,
            bookmaker: candidate.bookmaker, sportKey,
            sportSlug: candidate.sportSlug, leagueSlug: candidate.leagueSlug,
            sportName: candidate.sportName, leagueName: candidate.leagueName,
            market: candidate.market, line: candidate.line, outcome: candidate.outcome,
            status: "DELIVERY_FAILED", reason: "TELEGRAM_ERROR",
            pinnacleEv: confirmation.pinnacleEv,
            consensusEv: confirmation.consensusEv,
            consensusBooks: confirmation.consensusBooks,
          });
        }
      }
    } catch {
      referenceFailed = true;
      remainingQueue.push(...candidates);
      for (const candidate of candidates) {
        audit.push({
          auditedAt: now.toISOString(), runMode: dryRun ? "DRY_RUN" : "LIVE",
          candidateId: candidate.candidateId,
          providerEventId: candidate.providerEventId,
          bookmaker: candidate.bookmaker, sportKey,
          sportSlug: candidate.sportSlug, leagueSlug: candidate.leagueSlug,
          sportName: candidate.sportName, leagueName: candidate.leagueName,
          market: candidate.market, line: candidate.line, outcome: candidate.outcome,
          status: "ERROR", reason: "REFERENCE_PROVIDER_ERROR",
        });
      }
    }
  }

  if (referenceFailed && !referenceSucceeded) {
    health.referenceFailures = Number(health.referenceFailures ?? 0) + 1;
    await maybeSendHealthWarning({
      telegramClient,
      health,
      countField: "referenceFailures",
      warningField: "referenceWarningSent",
      providerLabel: "The Odds API",
    });
  } else if (referenceSucceeded) {
    health.referenceFailures = 0;
    health.referenceWarningSent = false;
  }

  await state.writeQueue(mergeQueue([], remainingQueue, { now }));
  await state.writeAlerts(delivered);
  await state.writeAudit(audit);
  await state.writeHealth(health);
  out(`${JSON.stringify(summary)}\n`);
  return summary;
}
```

During GREEN, preserve the exact fail-closed behavior in the tests. During
refactor, extract repeated audit-row construction into a private helper without
changing interfaces.

- [ ] **Step 4: Run focused and full tests**

Run:

```powershell
node --test test/mispricing_scan.test.mjs
npm test
```

Expected: all tests PASS, no network calls.

- [ ] **Step 5: Commit**

```powershell
git add provider-harness/src/mispricing_scan.mjs provider-harness/test/mispricing_scan.test.mjs
git commit -m "feat: orchestrate quota-safe mispricing scans"
```

---

### Task 9: CLI Commands, Environment Loading, Dry Run, and Health Warning

**Files:**

- Modify: `provider-harness/src/cli.mjs`
- Create: `provider-harness/test/cli_mispricing.test.mjs`
- Create: `provider-harness/.env.example`

**Interfaces:**

- New commands:
  - `mispricing-scan`
  - `mispricing-scan --dry-run`
  - `telegram-test`
- New injectable dependencies:
  - `createValueBetsClient`
  - `createTelegramClient`
  - `createState`
  - `loadRegistry`

- [ ] **Step 1: Write failing CLI tests**

```javascript
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runCli } from "../src/cli.mjs";

test("mispricing-scan loads all secrets and passes dry-run to orchestration", async () => {
  const calls = [];
  const code = await runCli(["mispricing-scan", "--dry-run"], {
    out: () => {},
    err: () => {},
    reportsDir: await mkdtemp(join(tmpdir(), "cli-mispricing-")),
    loadMispricingConfig: async () => ({
      oddsApiKey: "odds-key",
      theOddsApiKey: "reference-key",
      telegramToken: "telegram-token",
      telegramChatId: "telegram-chat",
    }),
    createValueBetsClient: ({ apiKey }) => ({ apiKey }),
    createTheOddsClient: ({ apiKey }) => ({ apiKey }),
    createTelegramClient: ({ token, chatId }) => ({ token, chatId }),
    loadRegistry: async () => new Map(),
    createState: () => ({}),
    runMispricing: async (args) => {
      calls.push(args);
      return { sent: 0 };
    },
    now: () => new Date("2026-06-25T09:00:00Z"),
  });
  assert.equal(code, 0);
  assert.equal(calls[0].dryRun, true);
  assert.equal(calls[0].valueBetsClient.apiKey, "odds-key");
  assert.equal(calls[0].referenceClient.apiKey, "reference-key");
  assert.equal(calls[0].telegramClient.token, "telegram-token");
});

test("telegram-test sends one non-betting diagnostic message", async () => {
  let text = "";
  const code = await runCli(["telegram-test"], {
    out: () => {},
    err: () => {},
    loadMispricingConfig: async () => ({
      oddsApiKey: "a", theOddsApiKey: "b",
      telegramToken: "c", telegramChatId: "d",
    }),
    createTelegramClient: () => ({
      async sendText(value) { text = value; return { messageId: "1" }; },
    }),
  });
  assert.equal(code, 0);
  assert.match(text, /Telegram connection test/);
});

test("unknown threshold flags are rejected because 20 percent is contractual", async () => {
  let error = "";
  const code = await runCli(["mispricing-scan", "--edge=10"], {
    err: (value) => { error += value; },
    out: () => {},
  });
  assert.equal(code, 1);
  assert.match(error, /unsupported mispricing-scan option/);
});
```

- [ ] **Step 2: Run and verify RED**

Run:

```powershell
node --test test/cli_mispricing.test.mjs
```

Expected: unknown command / missing dependencies.

- [ ] **Step 3: Add imports and default config loader**

Add imports:

```javascript
import { createValueBetsClient } from "./value_bets_client.mjs";
import { createTelegramClient } from "./telegram.mjs";
import { createMispricingState } from "./mispricing_state.mjs";
import { loadSportRegistry } from "./multisport_map.mjs";
import { runMispricingScan } from "./mispricing_scan.mjs";
```

Add:

```javascript
const DEFAULT_SPORT_MAP = resolve(HERE, "..", "config", "multisport-map.json");

async function defaultLoadMispricingConfig() {
  const envPath = await resolveEnvPath(process.cwd());
  const env = await loadEnvFile(envPath);
  return {
    oddsApiKey: requireKey(env, "ODDS_API_IO_KEY"),
    theOddsApiKey: requireKey(env, "THE_ODDS_API_KEY"),
    telegramToken: requireKey(env, "TELEGRAM_BOT_TOKEN"),
    telegramChatId: requireKey(env, "TELEGRAM_CHAT_ID"),
  };
}
```

- [ ] **Step 4: Extend dependency injection and command branches**

Add defaults in `runCli`:

```javascript
loadMispricingConfig = defaultLoadMispricingConfig,
createValueBetsClient: createValueBets = createValueBetsClient,
createTelegramClient: createTelegram = createTelegramClient,
createState = createMispricingState,
loadRegistry = loadSportRegistry,
runMispricing = runMispricingScan,
sportMapPath = DEFAULT_SPORT_MAP,
```

Add command handling before the unknown-command branch:

```javascript
if (command === "telegram-test") {
  const config = await loadMispricingConfig();
  const telegram = createTelegram({
    token: config.telegramToken,
    chatId: config.telegramChatId,
  });
  const result = await telegram.sendText(
    `Telegram connection test — ${now().toISOString()}`,
  );
  out(`Telegram test sent (message ${result.messageId}).\n`);
  return 0;
}

if (command === "mispricing-scan") {
  const unsupported = rest.filter((arg) => arg !== "--dry-run");
  if (unsupported.length > 0) {
    err(`unsupported mispricing-scan option: ${unsupported[0]}\n`);
    return 1;
  }
  const config = await loadMispricingConfig();
  await runMispricing({
    valueBetsClient: createValueBets({ apiKey: config.oddsApiKey }),
    referenceClient: createTheOddsClient({ apiKey: config.theOddsApiKey }),
    telegramClient: createTelegram({
      token: config.telegramToken,
      chatId: config.telegramChatId,
    }),
    state: createState({ reportsDir }),
    registry: await loadRegistry(sportMapPath),
    reportsDir,
    now: now(),
    dryRun: rest.includes("--dry-run"),
    out,
  });
  return 0;
}
```

Update usage text to include both commands.

- [ ] **Step 5: Add non-secret environment example**

Create `provider-harness/.env.example`:

```dotenv
ODDS_API_IO_KEY=
THE_ODDS_API_KEY=
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
```

- [ ] **Step 6: Run focused and full tests**

Run:

```powershell
node --test test/cli_mispricing.test.mjs
npm test
```

Expected: all tests PASS.

- [ ] **Step 7: Commit**

```powershell
git add provider-harness/src/cli.mjs provider-harness/test/cli_mispricing.test.mjs provider-harness/.env.example
git commit -m "feat: expose mispricing and Telegram CLI commands"
```

---

### Task 10: Windows Runner and Idempotent Task Scheduler Installer

**Files:**

- Create: `provider-harness/scripts/run-mispricing-scan.ps1`
- Create: `provider-harness/scripts/install-mispricing-task.ps1`
- Create: `provider-harness/test/scheduler_scripts.test.mjs`

**Interfaces:**

- Task name: `Bet-Mispricing-Scanner`
- Three daily triggers: `09:00`, `15:00`, `21:00`
- Runner writes logs under `provider-harness/reports/logs/`

- [ ] **Step 1: Write failing source-level scheduler tests**

```javascript
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("installer defines three daily local-time triggers and no parallel instance", async () => {
  const source = await readFile(
    new URL("../scripts/install-mispricing-task.ps1", import.meta.url),
    "utf8",
  );
  for (const time of ["09:00", "15:00", "21:00"]) {
    assert.match(source, new RegExp(`-At '${time}'`));
  }
  assert.match(source, /MultipleInstances IgnoreNew/);
  assert.match(source, /StartWhenAvailable \$true/);
  assert.match(source, /WakeToRun \$true/);
  assert.match(source, /Register-ScheduledTask/);
  assert.match(source, /Bet-Mispricing-Scanner/);
});

test("runner invokes the fixed command and appends local logs", async () => {
  const source = await readFile(
    new URL("../scripts/run-mispricing-scan.ps1", import.meta.url),
    "utf8",
  );
  assert.match(source, /node src\/cli\.mjs mispricing-scan/);
  assert.match(source, /reports\\logs/);
  assert.match(source, /Start-Transcript/);
});
```

- [ ] **Step 2: Run and verify RED**

Run:

```powershell
node --test test/scheduler_scripts.test.mjs
```

Expected: `ENOENT` for missing scripts.

- [ ] **Step 3: Create the scheduled runner**

`provider-harness/scripts/run-mispricing-scan.ps1`:

```powershell
$ErrorActionPreference = 'Stop'
$HarnessRoot = Split-Path -Parent $PSScriptRoot
$LogDir = Join-Path $HarnessRoot 'reports\logs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$Stamp = Get-Date -Format 'yyyy-MM-dd'
$LogPath = Join-Path $LogDir "mispricing-$Stamp.log"

Push-Location $HarnessRoot
try {
  Start-Transcript -Path $LogPath -Append
  node src/cli.mjs mispricing-scan
  if ($LASTEXITCODE -ne 0) {
    throw "mispricing-scan exited with code $LASTEXITCODE"
  }
} finally {
  try { Stop-Transcript | Out-Null } catch {}
  Pop-Location
}
```

- [ ] **Step 4: Create the idempotent installer**

`provider-harness/scripts/install-mispricing-task.ps1`:

```powershell
$ErrorActionPreference = 'Stop'
$TaskName = 'Bet-Mispricing-Scanner'
$Runner = Join-Path $PSScriptRoot 'run-mispricing-scan.ps1'
$PowerShell = (Get-Command powershell.exe).Source

$Action = New-ScheduledTaskAction `
  -Execute $PowerShell `
  -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$Runner`""

$Triggers = @(
  New-ScheduledTaskTrigger -Daily -At '09:00'
  New-ScheduledTaskTrigger -Daily -At '15:00'
  New-ScheduledTaskTrigger -Daily -At '21:00'
)

$Settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable $true `
  -WakeToRun $true `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 30)

$Principal = New-ScheduledTaskPrincipal `
  -UserId $env:USERNAME `
  -LogonType Interactive `
  -RunLevel Limited

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $Action `
  -Trigger $Triggers `
  -Settings $Settings `
  -Principal $Principal `
  -Description 'Scans Stoiximan and Superbet for independently confirmed >20% EV mispricings.' `
  -Force | Out-Null

Get-ScheduledTask -TaskName $TaskName
```

- [ ] **Step 5: Run source tests and PowerShell parser validation**

Run:

```powershell
node --test test/scheduler_scripts.test.mjs
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile(
  (Resolve-Path scripts\run-mispricing-scan.ps1),
  [ref]$null,
  [ref]$errors
) | Out-Null
if ($errors.Count) { $errors | Format-List; exit 1 }
[System.Management.Automation.Language.Parser]::ParseFile(
  (Resolve-Path scripts\install-mispricing-task.ps1),
  [ref]$null,
  [ref]$errors
) | Out-Null
if ($errors.Count) { $errors | Format-List; exit 1 }
npm test
```

Expected: scripts tests PASS, parser reports no errors, full suite PASS.

- [ ] **Step 6: Commit**

```powershell
git add provider-harness/scripts/run-mispricing-scan.ps1 provider-harness/scripts/install-mispricing-task.ps1 provider-harness/test/scheduler_scripts.test.mjs
git commit -m "feat: add scheduled Windows mispricing runner"
```

---

### Task 11: Documentation, Live Capability Check, and Activation

**Files:**

- Modify: `provider-harness/README.md`
- Modify: `provider-harness/USER-GUIDE.md`
- Modify: `provider-harness/config/multisport-map.json` only for exact mappings verified during live capability inspection.

**Interfaces:**

- User commands:
  - `node src/cli.mjs telegram-test`
  - `node src/cli.mjs mispricing-scan --dry-run`
  - `node src/cli.mjs mispricing-scan`
  - `powershell -ExecutionPolicy Bypass -File scripts/install-mispricing-task.ps1`

- [ ] **Step 1: Add exact operating documentation**

Add a `Multi-Sport Mispricing Alerts` section to README containing:

```markdown
## Multi-Sport Mispricing Alerts

This mode scans Odds-API.io candidates for Stoiximan and Superbet, then sends a
Telegram alert only when the exact pre-match moneyline/1X2 or featured
Over/Under selection has strictly more than 20% EV against both:

1. de-vigged Pinnacle; and
2. the median de-vigged probability of at least three other international
   bookmakers.

It does not scrape bookmaker sites, log in, place bets, or treat Odds-API.io's
candidate EV as confirmation.

Required `.env.local` keys:

    ODDS_API_IO_KEY=...
    THE_ODDS_API_KEY=...
    TELEGRAM_BOT_TOKEN=...
    TELEGRAM_CHAT_ID=...

Safe activation order:

    node src/cli.mjs telegram-test
    node src/cli.mjs mispricing-scan --dry-run
    node src/cli.mjs mispricing-scan
    powershell -ExecutionPolicy Bypass -File scripts/install-mispricing-task.ps1

The Windows task runs at 09:00, 15:00, and 21:00 local time. The computer must
be powered on and online. The scanner confirms at most two sports per run and
keeps a 100-credit reserve in The Odds API quota.
```

Add this Greek section to `USER-GUIDE.md`:

```markdown
## Ειδοποιήσεις μεγάλων αποκλίσεων σε όλα τα αθλήματα

Η εντολή:

    node src/cli.mjs mispricing-scan

ξεκινά από υποψήφιες αποδόσεις Stoiximan/Superbet και στέλνει Telegram μόνο
όταν η ίδια ακριβώς επιλογή έχει αυστηρά πάνω από 20% EV τόσο απέναντι στη
de-vigged Pinnacle όσο και απέναντι στη median fair πιθανότητα τουλάχιστον
τριών άλλων διεθνών bookmakers. Το 20,0% ακριβώς δεν περνά.

Υποστηρίζονται μόνο pre-match νικητής αγώνα/1Χ2 και η κύρια γραμμή
Over/Under. Δεν γίνεται scraping, login ή αυτόματο ποντάρισμα.

### Ρύθμιση Telegram

1. Άνοιξε το `@BotFather`, δημιούργησε bot και κράτησε το token ιδιωτικό.
2. Στείλε ένα μήνυμα στο νέο bot.
3. Βρες το προσωπικό chat id από την επίσημη Telegram Bot API μέθοδο
   `getUpdates`.
4. Πρόσθεσε στο root `.env.local`:

       TELEGRAM_BOT_TOKEN=...
       TELEGRAM_CHAT_ID=...

5. Έλεγξε τη σύνδεση:

       node src/cli.mjs telegram-test

Μην επικολλάς token σε logs, screenshots, commits ή μηνύματα.

### Ασφαλής ενεργοποίηση

    node src/cli.mjs mispricing-scan --dry-run
    node src/cli.mjs mispricing-scan
    powershell -ExecutionPolicy Bypass -File scripts\install-mispricing-task.ps1

Το task τρέχει στις 09:00, 15:00 και 21:00 τοπική ώρα Windows. Έλεγχος:

    Get-ScheduledTask -TaskName Bet-Mispricing-Scanner

Προσωρινή απενεργοποίηση:

    Disable-ScheduledTask -TaskName Bet-Mispricing-Scanner

Επανενεργοποίηση:

    Enable-ScheduledTask -TaskName Bet-Mispricing-Scanner

### Αρχεία κατάστασης

- `reports/mispricing-queue.csv`: candidates που περιμένουν επιβεβαίωση.
- `reports/mispricing-alerts.csv`: επιτυχημένες Telegram αποστολές.
- `reports/mispricing-audit.csv`: confirmed, rejected, deferred και errors.
- `reports/mispricing-health.json`: συνεχόμενες τεχνικές αποτυχίες.
- `reports/logs/`: ημερήσια logs του Windows task.

Το κουμπί Telegram ανοίγει κατά προτεραιότητα το ακριβές betslip, μετά την
αγορά και τέλος τη σελίδα αγώνα. Πάντα έλεγξε χειροκίνητα bookmaker, αγώνα,
αγορά, γραμμή, επιλογή και τρέχουσα απόδοση πριν κάνεις οτιδήποτε.
```

- [ ] **Step 2: Run the complete offline verification suite**

Run:

```powershell
npm test
git diff --check
```

Expected: all tests PASS; no whitespace errors.

- [ ] **Step 3: Verify provider capability without sending alerts**

Run:

```powershell
node src/cli.mjs mispricing-scan --dry-run
```

Expected:

- Odds-API.io `/value-bets` access succeeds for both Stoiximan and Superbet;
- no Telegram alert is sent;
- `mispricing-audit.csv` contains `DRY_RUN` rows;
- The Odds API quota usage is no more than four credits;
- no key/token appears in console output or reports.

If the endpoint returns HTTP 403, stop activation and report that the current
Odds-API.io subscription lacks required value-bets access. Do not implement a
less reliable fallback.

- [ ] **Step 4: Review unmapped candidate leagues**

Inspect:

```powershell
Import-Csv reports\mispricing-audit.csv |
  Where-Object reason -eq 'UNMAPPED_SPORT_LEAGUE' |
  Select-Object sportSlug, leagueSlug, sportName, leagueName -Unique

@'
import { resolveEnvPath } from "./src/cli.mjs";
import { loadEnvFile, requireKey } from "./src/env.mjs";
import { createTheOddsApiClient } from "./src/theodds_client.mjs";
const env = await loadEnvFile(await resolveEnvPath(process.cwd()));
const client = createTheOddsApiClient({
  apiKey: requireKey(env, "THE_ODDS_API_KEY"),
});
const response = await client.listSports();
console.table(
  response.data
    .filter((sport) => sport.active)
    .map(({ key, group, title }) => ({ key, group, title })),
);
'@ | node --input-type=module -
```

For each unmapped item, compare its exact Odds-API.io sport/league identifiers
with the active The Odds API table. Add a registry entry only when the
competition identity is exact and documented. Re-run `npm test` after each
registry edit.

- [ ] **Step 5: Send a Telegram connection test**

Run:

```powershell
node src/cli.mjs telegram-test
```

Expected: one non-betting test message arrives in the configured chat.

- [ ] **Step 6: Run one manual live scan**

Run:

```powershell
node src/cli.mjs mispricing-scan
```

Expected:

- zero or more alerts;
- every alert has both EV values above 20%;
- any button points to an allowlisted HTTPS Stoiximan/Superbet URL;
- repeated immediate run sends no duplicate unless minimum confirmed EV has
  increased by at least five percentage points.

- [ ] **Step 7: Install and inspect the Windows task**

Run:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-mispricing-task.ps1
Get-ScheduledTask -TaskName Bet-Mispricing-Scanner |
  Select-Object TaskName, State, Triggers, Settings
```

Expected: one task with three daily triggers at 09:00, 15:00, and 21:00,
`IgnoreNew`, `StartWhenAvailable`, and `WakeToRun`.

- [ ] **Step 8: Final full verification**

Run:

```powershell
npm test
git status --short
git diff --check HEAD
```

Expected: all tests PASS; only intended documentation/mapping changes remain
before commit; no whitespace errors.

- [ ] **Step 9: Commit**

```powershell
git add provider-harness/README.md provider-harness/USER-GUIDE.md provider-harness/config/multisport-map.json
git commit -m "docs: document and activate multisport alerts"
```

---

## Plan Self-Review

### Spec coverage

- Candidate endpoint and subscription failure: Task 1 and Task 11.
- Strict candidate filtering, freshness, supported markets, and links: Task 2.
- Explicit non-fuzzy sport mapping and active-sport validation: Task 3.
- Team/player event matching and exact totals line: Task 4.
- Pinnacle power de-vig, median consensus, three-book minimum, strict `>20%`:
  Task 5.
- Queue, two-sport cap, deduplication, CSV/JSON state, and corruption handling:
  Task 6.
- Telegram formatting, redaction, and inline link fallback: Task 7.
- Candidate-first flow, fail-closed behavior, quota reserve, retries, dry run:
  Task 8.
- CLI secrets and commands: Task 9.
- Three daily Windows triggers and non-overlap: Task 10.
- Documentation, live capability gate, mapping inventory, Telegram test, and
  scheduler activation: Task 11.

### Type consistency

- Candidate fields originate in Task 2 and are consumed unchanged in Tasks
  3–9.
- `sportKey` is added after Task 3 resolution and persisted by Task 6.
- Confirmation fields originate in Task 5 and match Task 6 alert columns and
  Task 7 formatting.
- The orchestration interface in Task 8 matches the dependency injection added
  in Task 9.

### Known execution gate

Live activation depends on the user's Odds-API.io subscription allowing
`/v3/value-bets` for Stoiximan and Superbet. The implementation fails closed on
403 and does not substitute a weaker alerting model.
