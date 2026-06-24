# World Cup Value-Bet Scanner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `scan` command that flags positive-EV World Cup value bets by comparing Stoiximan/Superbet prices (Odds-API.io) against Pinnacle's de-vigged fair price (The Odds API).

**Architecture:** A second provider client + normalizer feed the same canonical selection shape the existing harness uses. Pure modules handle cross-provider fixture matching, de-vig/EV maths, and alert formatting; the CLI wires discovery → fetch → match → value → alerts + sanitized report. All keys come from `.env.local`; raw responses are never retained.

**Tech Stack:** Node.js 22, built-in `fetch`, built-in `node:test`, ES modules. No runtime dependencies. Work in `provider-harness/`.

**Spec:** `docs/superpowers/specs/2026-06-24-value-bet-scanner-design.md`

---

## File Structure

- Create `provider-harness/src/theodds_client.mjs` — The Odds API HTTP calls + redacted quota headers.
- Create `provider-harness/src/theodds_normalize.mjs` — The Odds API payload → canonical selections.
- Create `provider-harness/src/match.mjs` — team-name aliasing + cross-provider fixture matching (pure).
- Create `provider-harness/src/value.mjs` — de-vig, EV, tier classification, reasons (pure).
- Create `provider-harness/src/alert.mjs` — format one alert block (pure).
- Modify `provider-harness/src/env.mjs` — add `requireKey(env, name)` helper.
- Modify `provider-harness/src/cli.mjs` — add the `scan` command.
- Create fixtures + tests under `provider-harness/test/`.

Canonical selection shape (already emitted by `src/normalize.mjs`, re-used everywhere):
`{ provider, bookmaker, eventId, competition, kickoffUtc, homeTeam, awayTeam, period, market, line, outcome, decimalOdds, quoteUpdatedAt, receivedAt, regionalStatus }`
where `market ∈ {MATCH_RESULT, TOTALS, BTTS, DOUBLE_CHANCE}` and `outcome ∈ {1,X,2,OVER,UNDER,YES,NO,1X,12,X2}`. The scanner uses only `MATCH_RESULT` and `TOTALS`.

---

### Task 1: Named-key helper in env

**Files:**
- Modify: `provider-harness/src/env.mjs`
- Test: `provider-harness/test/env.test.mjs`

- [ ] **Step 1: Write the failing test** (append to `test/env.test.mjs`)

```javascript
test("requireKey reads a named key and never leaks supplied values", async () => {
  const { requireKey } = await import("../src/env.mjs");
  assert.equal(requireKey({ THE_ODDS_API_KEY: " abc " }, "THE_ODDS_API_KEY"), "abc");
  assert.throws(
    () => requireKey({}, "THE_ODDS_API_KEY"),
    /THE_ODDS_API_KEY is missing from \.env\.local/,
  );
  const secret = "sensitive-value";
  try {
    requireKey({ THE_ODDS_API_KEY: "  " }, "THE_ODDS_API_KEY", secret);
  } catch (error) {
    assert.doesNotMatch(error.message, new RegExp(secret));
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd provider-harness && node --test test/env.test.mjs`
Expected: FAIL — `requireKey` is not exported.

- [ ] **Step 3: Write minimal implementation** (edit `src/env.mjs`; replace the `requireApiKey` function)

```javascript
export function requireKey(env, name) {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is missing from .env.local`);
  }
  return value;
}

export function requireApiKey(env) {
  return requireKey(env, "ODDS_API_IO_KEY");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd provider-harness && node --test test/env.test.mjs`
Expected: PASS (all env tests).

- [ ] **Step 5: Commit**

```bash
git add provider-harness/src/env.mjs provider-harness/test/env.test.mjs
git commit -m "feat: add named-key env helper for second provider"
```

---

### Task 2: The Odds API client

**Files:**
- Create: `provider-harness/src/theodds_client.mjs`
- Test: `provider-harness/test/theodds_client.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
import assert from "node:assert/strict";
import test from "node:test";

import { createTheOddsApiClient } from "../src/theodds_client.mjs";

function jsonResponse(data, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

test("calls documented events and odds endpoints with quota", async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(String(url));
    return jsonResponse([], {
      headers: { "x-requests-remaining": "498", "x-requests-used": "2", "x-requests-last": "2" },
    });
  };
  const client = createTheOddsApiClient({ apiKey: "secret", fetchImpl });

  const events = await client.listEvents({ sportKey: "soccer_fifa_world_cup" });
  await client.getOdds({ sportKey: "soccer_fifa_world_cup" });

  const eventsUrl = new URL(urls[0]);
  assert.equal(eventsUrl.pathname, "/v4/sports/soccer_fifa_world_cup/events");
  assert.equal(eventsUrl.searchParams.get("apiKey"), "secret");

  const oddsUrl = new URL(urls[1]);
  assert.equal(oddsUrl.pathname, "/v4/sports/soccer_fifa_world_cup/odds");
  assert.equal(oddsUrl.searchParams.get("regions"), "eu");
  assert.equal(oddsUrl.searchParams.get("markets"), "h2h,totals");
  assert.equal(oddsUrl.searchParams.get("oddsFormat"), "decimal");
  assert.deepEqual(events.quota, { remaining: 498, used: 2, lastCost: 2 });
});

test("redacts the key from provider failures", async () => {
  const key = "do-not-leak";
  const client = createTheOddsApiClient({
    apiKey: key,
    fetchImpl: async () => jsonResponse({ message: `bad ${key}` }, { status: 401 }),
  });
  await assert.rejects(
    () => client.listEvents({ sportKey: "soccer_fifa_world_cup" }),
    (error) => {
      assert.match(error.message, /The Odds API request failed with status 401/);
      assert.doesNotMatch(error.message, new RegExp(key));
      return true;
    },
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd provider-harness && node --test test/theodds_client.test.mjs`
Expected: FAIL — `src/theodds_client.mjs` does not exist.

- [ ] **Step 3: Write minimal implementation**

```javascript
function quotaFrom(headers) {
  const integer = (name) => {
    const value = Number(headers.get(name));
    return Number.isFinite(value) ? value : null;
  };
  return {
    remaining: integer("x-requests-remaining"),
    used: integer("x-requests-used"),
    lastCost: integer("x-requests-last"),
  };
}

export function createTheOddsApiClient({
  apiKey,
  fetchImpl = fetch,
  baseUrl = "https://api.the-odds-api.com/v4",
}) {
  async function request(path, parameters) {
    const url = new URL(`${baseUrl.replace(/\/$/u, "")}${path}`);
    url.searchParams.set("apiKey", apiKey);
    for (const [name, value] of Object.entries(parameters)) {
      url.searchParams.set(name, String(value));
    }
    const response = await fetchImpl(url);
    const receivedAt = new Date().toISOString();
    if (!response.ok) {
      throw new Error(`The Odds API request failed with status ${response.status}`);
    }
    return { data: await response.json(), receivedAt, quota: quotaFrom(response.headers) };
  }

  return {
    listEvents({ sportKey }) {
      return request(`/sports/${sportKey}/events`, {});
    },
    getOdds({ sportKey, regions = "eu", markets = "h2h,totals", oddsFormat = "decimal" }) {
      return request(`/sports/${sportKey}/odds`, { regions, markets, oddsFormat });
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd provider-harness && node --test test/theodds_client.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add provider-harness/src/theodds_client.mjs provider-harness/test/theodds_client.test.mjs
git commit -m "feat: add The Odds API client with redacted quota"
```

---

### Task 3: The Odds API normalizer

**Files:**
- Create: `provider-harness/src/theodds_normalize.mjs`
- Create: `provider-harness/test/fixtures/theodds-odds-response.json`
- Test: `provider-harness/test/theodds_normalize.test.mjs`

- [ ] **Step 1: Create the fixture** `test/fixtures/theodds-odds-response.json`

```json
[
  {
    "id": "evt_spain_cv",
    "sport_key": "soccer_fifa_world_cup",
    "sport_title": "FIFA World Cup",
    "commence_time": "2026-06-25T18:00:00Z",
    "home_team": "Spain",
    "away_team": "Cape Verde",
    "bookmakers": [
      {
        "key": "pinnacle",
        "title": "Pinnacle",
        "last_update": "2026-06-24T12:00:00Z",
        "markets": [
          {
            "key": "h2h",
            "last_update": "2026-06-24T12:00:00Z",
            "outcomes": [
              { "name": "Spain", "price": 1.30 },
              { "name": "Cape Verde", "price": 11.0 },
              { "name": "Draw", "price": 6.20 }
            ]
          },
          {
            "key": "totals",
            "last_update": "2026-06-24T12:00:00Z",
            "outcomes": [
              { "name": "Over", "price": 1.90, "point": 2.5 },
              { "name": "Under", "price": 1.95, "point": 2.5 }
            ]
          },
          {
            "key": "spreads",
            "last_update": "2026-06-24T12:00:00Z",
            "outcomes": [
              { "name": "Spain", "price": 1.90, "point": -1.5 },
              { "name": "Cape Verde", "price": 1.95, "point": 1.5 }
            ]
          }
        ]
      }
    ]
  }
]
```

- [ ] **Step 2: Write the failing test**

```javascript
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { normalizeTheOddsResponse } from "../src/theodds_normalize.mjs";

const fixture = JSON.parse(
  await readFile(new URL("./fixtures/theodds-odds-response.json", import.meta.url), "utf8"),
);
const receivedAt = "2026-06-24T12:00:05.000Z";

test("maps h2h to 1X2 with correct draw mapping", () => {
  const rows = normalizeTheOddsResponse(fixture, receivedAt);
  const draw = rows.find((r) => r.market === "MATCH_RESULT" && r.outcome === "X");
  assert.deepEqual(draw, {
    provider: "the-odds-api",
    bookmaker: "pinnacle",
    eventId: "evt_spain_cv",
    competition: "FIFA World Cup",
    kickoffUtc: "2026-06-25T18:00:00.000Z",
    homeTeam: "Spain",
    awayTeam: "Cape Verde",
    period: "FULL_TIME",
    market: "MATCH_RESULT",
    line: "",
    outcome: "X",
    decimalOdds: 6.2,
    quoteUpdatedAt: "2026-06-24T12:00:00.000Z",
    receivedAt,
    regionalStatus: "UNVERIFIED",
  });
  assert.equal(rows.find((r) => r.market === "MATCH_RESULT" && r.outcome === "1").decimalOdds, 1.3);
  assert.equal(rows.find((r) => r.market === "MATCH_RESULT" && r.outcome === "2").decimalOdds, 11);
});

test("maps totals with exact line and ignores unsupported markets", () => {
  const rows = normalizeTheOddsResponse(fixture, receivedAt);
  const under = rows.find((r) => r.market === "TOTALS" && r.outcome === "UNDER");
  assert.equal(under.line, "2.5");
  assert.equal(under.decimalOdds, 1.95);
  assert.equal(rows.some((r) => r.market === "SPREADS" || r.line === "-1.5"), false);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd provider-harness && node --test test/theodds_normalize.test.mjs`
Expected: FAIL — `src/theodds_normalize.mjs` does not exist.

- [ ] **Step 4: Write minimal implementation**

```javascript
function iso(value) {
  return value ? new Date(value).toISOString() : "";
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function normalizeTheOddsResponse(payload, receivedAt) {
  const events = Array.isArray(payload) ? payload : [];
  const rows = [];

  for (const event of events) {
    const base = {
      provider: "the-odds-api",
      eventId: String(event.id),
      competition: event.sport_title ?? "",
      kickoffUtc: iso(event.commence_time),
      homeTeam: event.home_team,
      awayTeam: event.away_team,
      period: "FULL_TIME",
      receivedAt,
      regionalStatus: "UNVERIFIED",
    };

    for (const bookmaker of event.bookmakers ?? []) {
      const key = bookmaker.key;
      const bookUpdated = iso(bookmaker.last_update);

      for (const market of bookmaker.markets ?? []) {
        const quoteUpdatedAt = iso(market.last_update) || bookUpdated;

        if (market.key === "h2h") {
          for (const outcome of market.outcomes ?? []) {
            const decimalOdds = number(outcome.price);
            if (decimalOdds === null) continue;
            let mapped = null;
            if (outcome.name === event.home_team) mapped = "1";
            else if (outcome.name === event.away_team) mapped = "2";
            else if (String(outcome.name).toLowerCase() === "draw") mapped = "X";
            if (!mapped) continue;
            rows.push({ ...base, bookmaker: key, market: "MATCH_RESULT", line: "", outcome: mapped, decimalOdds, quoteUpdatedAt });
          }
        } else if (market.key === "totals") {
          for (const outcome of market.outcomes ?? []) {
            const decimalOdds = number(outcome.price);
            if (decimalOdds === null || outcome.point === undefined || outcome.point === null) continue;
            const name = String(outcome.name).toLowerCase();
            const mapped = name === "over" ? "OVER" : name === "under" ? "UNDER" : null;
            if (!mapped) continue;
            rows.push({ ...base, bookmaker: key, market: "TOTALS", line: String(outcome.point), outcome: mapped, decimalOdds, quoteUpdatedAt });
          }
        }
      }
    }
  }

  return rows;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd provider-harness && node --test test/theodds_normalize.test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add provider-harness/src/theodds_normalize.mjs provider-harness/test/theodds_normalize.test.mjs provider-harness/test/fixtures/theodds-odds-response.json
git commit -m "feat: normalize The Odds API h2h/totals to canonical selections"
```

---

### Task 4: Cross-provider fixture matching

**Files:**
- Create: `provider-harness/src/match.mjs`
- Test: `provider-harness/test/match.test.mjs`

Input event shape (both providers adapted to this by the CLI):
`{ eventId, homeTeam, awayTeam, kickoffUtc }`.

- [ ] **Step 1: Write the failing test**

```javascript
import assert from "node:assert/strict";
import test from "node:test";

import { matchFixtures, normalizeTeamName } from "../src/match.mjs";

test("normalizes accents, punctuation, and national-team aliases", () => {
  assert.equal(normalizeTeamName("Korea Republic"), normalizeTeamName("South Korea"));
  assert.equal(normalizeTeamName("Bosnia & Herzegovina"), normalizeTeamName("Bosnia and Herzegovina"));
  assert.equal(normalizeTeamName("Côte d'Ivoire"), normalizeTeamName("Ivory Coast"));
  assert.equal(normalizeTeamName("Türkiye"), normalizeTeamName("Turkey"));
});

test("matches same fixture across providers and rejects mismatches", () => {
  const reference = [
    { eventId: "ref1", homeTeam: "South Korea", awayTeam: "Bosnia & Herzegovina", kickoffUtc: "2026-06-25T18:00:00.000Z" },
    { eventId: "ref2", homeTeam: "Spain", awayTeam: "Cape Verde", kickoffUtc: "2026-06-25T21:00:00.000Z" },
  ];
  const bettable = [
    { eventId: "bet1", homeTeam: "Korea Republic", awayTeam: "Bosnia and Herzegovina", kickoffUtc: "2026-06-25T18:00:30.000Z" },
    { eventId: "betX", homeTeam: "Cape Verde", awayTeam: "Spain", kickoffUtc: "2026-06-25T21:00:00.000Z" },
  ];

  const pairs = matchFixtures(reference, bettable, { toleranceSeconds: 120 });
  assert.equal(pairs.length, 1);
  assert.deepEqual(pairs[0], {
    referenceEventId: "ref1",
    bettableEventId: "bet1",
    homeTeam: "South Korea",
    awayTeam: "Bosnia & Herzegovina",
    kickoffUtc: "2026-06-25T18:00:00.000Z",
  });
});

test("rejects matches outside the kickoff tolerance", () => {
  const reference = [{ eventId: "r", homeTeam: "Spain", awayTeam: "Cape Verde", kickoffUtc: "2026-06-25T18:00:00.000Z" }];
  const bettable = [{ eventId: "b", homeTeam: "Spain", awayTeam: "Cape Verde", kickoffUtc: "2026-06-25T18:10:00.000Z" }];
  assert.equal(matchFixtures(reference, bettable, { toleranceSeconds: 120 }).length, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd provider-harness && node --test test/match.test.mjs`
Expected: FAIL — `src/match.mjs` does not exist.

- [ ] **Step 3: Write minimal implementation**

```javascript
const ALIASES = new Map([
  ["bosnia and herzegovina", "bosnia"],
  ["bosnia herzegovina", "bosnia"],
  ["korea republic", "south korea"],
  ["republic of korea", "south korea"],
  ["united states", "usa"],
  ["united states of america", "usa"],
  ["turkiye", "turkey"],
  ["cote d ivoire", "ivory coast"],
  ["czech republic", "czechia"],
  ["china pr", "china"],
  ["ir iran", "iran"],
]);

export function normalizeTeamName(name) {
  let value = String(name ?? "").toLowerCase().trim();
  value = value.normalize("NFD").replace(/[̀-ͯ]/gu, "");
  value = value.replace(/[.&'-]/gu, " ").replace(/\s+/gu, " ").trim();
  return ALIASES.get(value) ?? value;
}

export function matchFixtures(referenceEvents, bettableEvents, { toleranceSeconds = 120 } = {}) {
  const pairs = [];
  for (const reference of referenceEvents) {
    const home = normalizeTeamName(reference.homeTeam);
    const away = normalizeTeamName(reference.awayTeam);
    const referenceTime = Date.parse(reference.kickoffUtc);
    const found = bettableEvents.find((bettable) => {
      const bettableTime = Date.parse(bettable.kickoffUtc);
      if (!Number.isFinite(referenceTime) || !Number.isFinite(bettableTime)) return false;
      if (Math.abs(referenceTime - bettableTime) > toleranceSeconds * 1000) return false;
      return normalizeTeamName(bettable.homeTeam) === home && normalizeTeamName(bettable.awayTeam) === away;
    });
    if (found) {
      pairs.push({
        referenceEventId: String(reference.eventId),
        bettableEventId: String(found.eventId),
        homeTeam: reference.homeTeam,
        awayTeam: reference.awayTeam,
        kickoffUtc: reference.kickoffUtc,
      });
    }
  }
  return pairs;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd provider-harness && node --test test/match.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add provider-harness/src/match.mjs provider-harness/test/match.test.mjs
git commit -m "feat: add cross-provider fixture matching with team aliases"
```

---

### Task 5: De-vig and EV value model

**Files:**
- Create: `provider-harness/src/value.mjs`
- Test: `provider-harness/test/value.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
import assert from "node:assert/strict";
import test from "node:test";

import { buildReasons, classifyEv, devig, findValueBets } from "../src/value.mjs";

const reference = [
  { market: "MATCH_RESULT", line: "", outcome: "1", decimalOdds: 1.30 },
  { market: "MATCH_RESULT", line: "", outcome: "X", decimalOdds: 6.20 },
  { market: "MATCH_RESULT", line: "", outcome: "2", decimalOdds: 11.0 },
  { market: "TOTALS", line: "2.5", outcome: "OVER", decimalOdds: 1.90 },
  { market: "TOTALS", line: "2.5", outcome: "UNDER", decimalOdds: 1.95 },
];

test("de-vig fair probabilities sum to 1 per market group", () => {
  const fair = devig(reference);
  const mr = ["1", "X", "2"].reduce((sum, o) => sum + fair.get(`MATCH_RESULT||${o}`), 0);
  const totals = ["OVER", "UNDER"].reduce((sum, o) => sum + fair.get(`TOTALS|2.5|${o}`), 0);
  assert.ok(Math.abs(mr - 1) < 1e-9);
  assert.ok(Math.abs(totals - 1) < 1e-9);
});

test("classifies EV tiers by magnitude", () => {
  assert.equal(classifyEv(0.04), "VALUE");
  assert.equal(classifyEv(0.10), "VALUE_CHECK");
  assert.equal(classifyEv(0.20), "SUSPICIOUS");
});

test("flags value above threshold, reports NO_REFERENCE when unmatched", () => {
  // fair draw prob ~ (1/6.2)/(1/1.3+1/6.2+1/11) = 0.1613/(0.7692+0.1613+0.0909)=~0.1581
  // a book offering 7.50 on the draw: EV = 7.50*0.1581 - 1 = +0.186 -> SUSPICIOUS
  const bettable = [
    { bookmaker: "Stoiximan", market: "MATCH_RESULT", line: "", outcome: "X", decimalOdds: 7.50 },
    { bookmaker: "Superbet", market: "TOTALS", line: "3.5", outcome: "OVER", decimalOdds: 2.40 },
  ];
  const results = findValueBets(bettable, reference, { threshold: 0.03 });
  const draw = results.find((r) => r.outcome === "X");
  assert.equal(draw.status, "SUSPICIOUS");
  assert.ok(draw.ev > 0.15);
  assert.ok(draw.fairOdds > 6 && draw.fairOdds < 7);
  const over35 = results.find((r) => r.line === "3.5");
  assert.equal(over35.status, "NO_REFERENCE");
});

test("builds data-grounded reasons only", () => {
  const bet = { bookmaker: "Stoiximan", market: "MATCH_RESULT", line: "", outcome: "X", decimalOdds: 7.5, ev: 0.186, fairProbability: 0.1581, fairOdds: 6.33, status: "SUSPICIOUS" };
  const reasons = buildReasons(bet);
  assert.match(reasons[0], /EV \+18\.6%/);
  assert.match(reasons.join("\n"), /fair 6\.33/);
  assert.match(reasons.join("\n"), /high EV/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd provider-harness && node --test test/value.test.mjs`
Expected: FAIL — `src/value.mjs` does not exist.

- [ ] **Step 3: Write minimal implementation**

```javascript
export function devig(referenceSelections) {
  const groups = new Map();
  for (const selection of referenceSelections) {
    const groupKey = `${selection.market}|${selection.line}`;
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey).push(selection);
  }
  const fair = new Map();
  for (const selections of groups.values()) {
    const sumImplied = selections.reduce((sum, s) => sum + 1 / s.decimalOdds, 0);
    if (sumImplied <= 0) continue;
    for (const s of selections) {
      fair.set(`${s.market}|${s.line}|${s.outcome}`, 1 / s.decimalOdds / sumImplied);
    }
  }
  return fair;
}

export function classifyEv(ev) {
  if (ev >= 0.15) return "SUSPICIOUS";
  if (ev >= 0.05) return "VALUE_CHECK";
  return "VALUE";
}

export function findValueBets(bettableSelections, referenceSelections, { threshold = 0.03 } = {}) {
  const fair = devig(referenceSelections);
  const results = [];
  for (const selection of bettableSelections) {
    const fairProbability = fair.get(`${selection.market}|${selection.line}|${selection.outcome}`);
    if (fairProbability === undefined) {
      results.push({ ...selection, status: "NO_REFERENCE" });
      continue;
    }
    const ev = selection.decimalOdds * fairProbability - 1;
    const fairOdds = 1 / fairProbability;
    if (ev < threshold) {
      results.push({ ...selection, status: "NO_VALUE", ev, fairProbability, fairOdds });
      continue;
    }
    results.push({ ...selection, status: classifyEv(ev), ev, fairProbability, fairOdds });
  }
  return results;
}

export function buildReasons(bet) {
  const reasons = [
    `EV +${(bet.ev * 100).toFixed(1)}% (${bet.bookmaker} ${bet.decimalOdds.toFixed(2)} vs fair ${bet.fairOdds.toFixed(2)} from de-vigged Pinnacle)`,
    `Implied probability: offered ${(100 / bet.decimalOdds).toFixed(1)}% vs fair ${(bet.fairProbability * 100).toFixed(1)}%`,
  ];
  if (bet.status === "SUSPICIOUS") {
    reasons.push("Unusually high EV — likely a stale/mismatched line or palpable error; verify before trusting.");
  }
  return reasons;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd provider-harness && node --test test/value.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add provider-harness/src/value.mjs provider-harness/test/value.test.mjs
git commit -m "feat: add de-vig EV value model with confidence tiers"
```

---

### Task 6: Alert formatting

**Files:**
- Create: `provider-harness/src/alert.mjs`
- Test: `provider-harness/test/alert.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
import assert from "node:assert/strict";
import test from "node:test";

import { formatAlert } from "../src/alert.mjs";

test("formats an alert block with market label, EV, reasons and risk", () => {
  const bet = {
    bookmaker: "Stoiximan", market: "MATCH_RESULT", line: "", outcome: "X",
    decimalOdds: 7.5, ev: 0.103, fairProbability: 0.147, fairOdds: 6.8, status: "VALUE_CHECK",
  };
  const text = formatAlert(bet, { fixture: { homeTeam: "Spain", awayTeam: "Cape Verde" } });
  assert.match(text, /^ALERT:/);
  assert.match(text, /Match: Spain - Cape Verde/);
  assert.match(text, /Market: Draw/);
  assert.match(text, /Offered odd: 7\.50/);
  assert.match(text, /EV: \+10\.3%/);
  assert.match(text, /Reasons:/);
  assert.match(text, /Risk:/);
  assert.match(text, /Verify official lineup/);
});

test("labels totals markets with side and line", () => {
  const bet = {
    bookmaker: "Superbet", market: "TOTALS", line: "2.5", outcome: "UNDER",
    decimalOdds: 1.95, ev: 0.04, fairProbability: 0.53, fairOdds: 1.89, status: "VALUE",
  };
  const text = formatAlert(bet, { fixture: { homeTeam: "Spain", awayTeam: "Cape Verde" } });
  assert.match(text, /Market: UNDER 2\.5/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd provider-harness && node --test test/alert.test.mjs`
Expected: FAIL — `src/alert.mjs` does not exist.

- [ ] **Step 3: Write minimal implementation**

```javascript
import { buildReasons } from "./value.mjs";

const MATCH_RESULT_LABEL = { "1": "Home", X: "Draw", "2": "Away" };
const STATUS_LABEL = {
  VALUE: "VALUE",
  VALUE_CHECK: "POSSIBLE VALUE (verify)",
  SUSPICIOUS: "SUSPICIOUS VALUE",
};

export function formatAlert(bet, { fixture }) {
  const marketLabel =
    bet.market === "MATCH_RESULT" ? MATCH_RESULT_LABEL[bet.outcome] : `${bet.outcome} ${bet.line}`;
  const lines = [
    `ALERT: ${STATUS_LABEL[bet.status] ?? bet.status}`,
    "",
    `Match: ${fixture.homeTeam} - ${fixture.awayTeam}`,
    `Book: ${bet.bookmaker}`,
    `Market: ${marketLabel}`,
    `Offered odd: ${bet.decimalOdds.toFixed(2)}`,
    `Fair odd (Pinnacle de-vig): ${bet.fairOdds.toFixed(2)}`,
    `EV: +${(bet.ev * 100).toFixed(1)}%`,
    "",
    "Reasons:",
    ...buildReasons(bet).map((reason) => `- ${reason}`),
    "",
    "Risk:",
    "- Verify official lineup and the exact market/line before betting.",
    "- EV is modelled from Pinnacle's de-vigged price, not a guarantee. Odds move. No auto-betting.",
  ];
  return lines.join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd provider-harness && node --test test/alert.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add provider-harness/src/alert.mjs provider-harness/test/alert.test.mjs
git commit -m "feat: format value-bet alert blocks"
```

---

### Task 7: `scan` CLI command

**Files:**
- Modify: `provider-harness/src/cli.mjs`
- Test: `provider-harness/test/cli_scan.test.mjs`

The `scan` command flow: discover World Cup fixtures from The Odds API `/events`; discover Odds-API.io football fixtures via `listEvents`; match them; one The Odds API `/odds` call → keep Pinnacle reference selections per reference event; per matched fixture, one Odds-API.io `/odds` call for Superbet,Stoiximan → `findValueBets` vs that fixture's Pinnacle selections → alerts + report.

- [ ] **Step 1: Write the failing test**

```javascript
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runCli } from "../src/cli.mjs";

const ODDS_KEY = "oddsapi-secret";
const THEODDS_KEY = "theodds-secret";

// The Odds API: one WC fixture with a Pinnacle draw priced ~6.2 (fair draw ~15.8%)
const theOddsEvents = [
  { id: "ref1", home_team: "Spain", away_team: "Cape Verde", commence_time: "2026-06-25T18:00:00Z" },
];
const theOddsOdds = [
  {
    id: "ref1", sport_title: "FIFA World Cup", commence_time: "2026-06-25T18:00:00Z",
    home_team: "Spain", away_team: "Cape Verde",
    bookmakers: [
      { key: "pinnacle", title: "Pinnacle", last_update: "2026-06-24T12:00:00Z", markets: [
        { key: "h2h", last_update: "2026-06-24T12:00:00Z", outcomes: [
          { name: "Spain", price: 1.30 }, { name: "Cape Verde", price: 11.0 }, { name: "Draw", price: 6.20 },
        ] },
      ] },
    ],
  },
];
// Odds-API.io: same fixture (id 999), Stoiximan offering a juicy 7.50 draw
const oddsApiEvents = [
  { id: 999, home: "Spain", away: "Cape Verde", date: "2026-06-25T18:00:00Z", league: { name: "World Cup" } },
];
const oddsApiOdds = {
  id: 999, home: "Spain", away: "Cape Verde", date: "2026-06-25T18:00:00Z", league: { name: "World Cup" },
  bookmakers: {
    Stoiximan: [{ name: "ML", updatedAt: "2026-06-24T12:00:00Z", odds: [{ home: "1.28", draw: "7.50", away: "10.5" }] }],
    Superbet: [{ name: "ML", updatedAt: "2026-06-24T12:00:00Z", odds: [{ home: "1.29", draw: "6.10", away: "10.0" }] }],
  },
};

function fakeOddsApiClient(calls) {
  return {
    async listEvents(args) { calls.push(["oddsapi.events", args]); return { data: [oddsApiEvents[0]], receivedAt: "2026-06-24T12:00:05.000Z", rateLimit: { limit: 100, remaining: 99, resetAt: "x" } }; },
    async getOdds(args) { calls.push(["oddsapi.odds", args]); return { data: oddsApiOdds, receivedAt: "2026-06-24T12:00:05.000Z", rateLimit: { limit: 100, remaining: 98, resetAt: "x" } }; },
  };
}
function fakeTheOddsClient(calls) {
  return {
    async listEvents(args) { calls.push(["theodds.events", args]); return { data: theOddsEvents, receivedAt: "2026-06-24T12:00:05.000Z", quota: { remaining: 500, used: 0, lastCost: 0 } }; },
    async getOdds(args) { calls.push(["theodds.odds", args]); return { data: theOddsOdds, receivedAt: "2026-06-24T12:00:05.000Z", quota: { remaining: 498, used: 2, lastCost: 2 } }; },
  };
}

test("scan finds value vs Pinnacle, prints alerts, writes report, leaks no key", async () => {
  const calls = [];
  let out = "";
  const reportsDir = await mkdtemp(join(tmpdir(), "scan-"));
  const code = await runCli(["scan"], {
    out: (t) => { out += t; },
    err: () => {},
    loadApiKey: async () => ODDS_KEY,
    loadTheOddsKey: async () => THEODDS_KEY,
    createClient: ({ apiKey }) => { assert.equal(apiKey, ODDS_KEY); return fakeOddsApiClient(calls); },
    createTheOddsClient: ({ apiKey }) => { assert.equal(apiKey, THEODDS_KEY); return fakeTheOddsClient(calls); },
    reportsDir,
    now: () => new Date("2026-06-24T12:00:05.000Z"),
  });

  assert.equal(code, 0);
  // Stoiximan draw 7.50 vs fair ~6.3 -> high EV alert present
  assert.match(out, /ALERT:/);
  assert.match(out, /Match: Spain - Cape Verde/);
  assert.match(out, /Stoiximan/);
  // only one The Odds API odds call (batch), Superbet+Stoiximan requested from Odds-API.io
  assert.deepEqual(calls.find((c) => c[0] === "oddsapi.odds")[1], { eventId: "999", bookmakers: ["Superbet", "Stoiximan"] });
  assert.equal(calls.filter((c) => c[0] === "theodds.odds").length, 1);

  const files = await readdir(reportsDir);
  const report = files.find((f) => f.startsWith("scan-") && f.endsWith(".csv"));
  assert.ok(report);
  const raw = await readFile(join(reportsDir, report), "utf8");
  assert.doesNotMatch(raw, new RegExp(ODDS_KEY));
  assert.doesNotMatch(raw, new RegExp(THEODDS_KEY));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd provider-harness && node --test test/cli_scan.test.mjs`
Expected: FAIL — `scan` is an unknown command (exit 1, no alert output).

- [ ] **Step 3: Add imports and constants to `src/cli.mjs`** (top of file, with the other imports)

```javascript
import { createTheOddsApiClient } from "./theodds_client.mjs";
import { normalizeTheOddsResponse } from "./theodds_normalize.mjs";
import { matchFixtures } from "./match.mjs";
import { findValueBets } from "./value.mjs";
import { formatAlert } from "./alert.mjs";
import { loadEnvFile, requireApiKey, requireKey } from "./env.mjs";
```
(Replace the existing `./env.mjs` import line with the one above so `requireKey` is imported too.)

Add constants near `TARGET_BOOKMAKERS`:

```javascript
const WORLD_CUP_SPORT_KEY = "soccer_fifa_world_cup";
const REFERENCE_BOOKMAKER = "pinnacle";
const SCAN_COLUMNS = [
  "bookmaker", "eventId", "kickoffUtc", "homeTeam", "awayTeam",
  "market", "line", "outcome", "decimalOdds", "fairOdds", "fairProbability",
  "ev", "status",
];
```

Add the default loader for the second key (near `defaultLoadApiKey`):

```javascript
async function defaultLoadTheOddsKey() {
  const envPath = await resolveEnvPath(process.cwd());
  const env = await loadEnvFile(envPath);
  return requireKey(env, "THE_ODDS_API_KEY");
}
```

- [ ] **Step 4: Run the failing test again (still red, command not wired)**

Run: `cd provider-harness && node --test test/cli_scan.test.mjs`
Expected: FAIL — `scan` still unknown.

- [ ] **Step 5: Implement `runScan` in `src/cli.mjs`** (add this function above `runCli`)

```javascript
function toFixtureList(events, shape) {
  return events.map(shape).filter((e) => e.homeTeam && e.awayTeam && e.kickoffUtc);
}

async function runScan({
  loadApiKey, loadTheOddsKey, createClient, createTheOddsClient, out, reportsDir, now, threshold,
}) {
  const oddsClient = createClient({ apiKey: await loadApiKey() });
  const theOddsClient = createTheOddsClient({ apiKey: await loadTheOddsKey() });

  const referenceEventsRaw = await theOddsClient.listEvents({ sportKey: WORLD_CUP_SPORT_KEY });
  const referenceFixtures = toFixtureList(referenceEventsRaw.data ?? [], (e) => ({
    eventId: String(e.id), homeTeam: e.home_team, awayTeam: e.away_team, kickoffUtc: e.commence_time,
  }));

  const oddsEventsRaw = await oddsClient.listEvents({ sport: "football", limit: 50 });
  const oddsEvents = Array.isArray(oddsEventsRaw.data) ? oddsEventsRaw.data : oddsEventsRaw.data?.events ?? [];
  const worldCupOddsEvents = oddsEvents.filter((e) =>
    /world\s*cup|mundial/iu.test(String(e.league?.name ?? e.league ?? "")),
  );
  const bettableFixtures = toFixtureList(
    worldCupOddsEvents.length > 0 ? worldCupOddsEvents : oddsEvents,
    (e) => ({ eventId: String(e.id), homeTeam: e.home, awayTeam: e.away, kickoffUtc: e.date }),
  );

  const pairs = matchFixtures(referenceFixtures, bettableFixtures);

  const referenceOdds = await theOddsClient.getOdds({ sportKey: WORLD_CUP_SPORT_KEY });
  const referenceSelections = normalizeTheOddsResponse(referenceOdds.data, referenceOdds.receivedAt)
    .filter((row) => row.bookmaker === REFERENCE_BOOKMAKER);

  const alerts = [];
  const reportRows = [];
  for (const pair of pairs) {
    const refForFixture = referenceSelections.filter((s) => s.eventId === pair.referenceEventId);
    if (refForFixture.length === 0) continue;

    const oddsResponse = await oddsClient.getOdds({
      eventId: String(pair.bettableEventId),
      bookmakers: TARGET_BOOKMAKERS,
    });
    const bettable = normalizeOddsResponse(oddsResponse.data, oddsResponse.receivedAt)
      .filter((row) => TARGET_BOOKMAKERS.includes(row.bookmaker) && (row.market === "MATCH_RESULT" || row.market === "TOTALS"));

    for (const result of findValueBets(bettable, refForFixture, { threshold })) {
      if (result.status === "NO_REFERENCE" || result.status === "NO_VALUE") {
        if (result.status === "NO_VALUE") {
          reportRows.push(scanRow(result));
        }
        continue;
      }
      reportRows.push(scanRow(result));
      alerts.push(formatAlert(result, { fixture: pair }));
    }
  }

  const header = `World Cup value scan — ${pairs.length} matched fixtures, ${alerts.length} alerts (EV ≥ ${(threshold * 100).toFixed(1)}%).`;
  out(`${header}\n\n`);
  for (const alert of alerts) out(`${alert}\n\n`);
  out(`The Odds API quota remaining: ${referenceOdds.quota?.remaining ?? "?"}\n`);

  const reportPath = join(reportsDir, `scan-${stampFrom(now)}.csv`);
  await writeCsv(reportPath, reportRows, SCAN_COLUMNS);
  out(`Wrote scan report to ${reportPath}\n`);
  return 0;
}

function scanRow(result) {
  return {
    bookmaker: result.bookmaker,
    eventId: result.eventId,
    kickoffUtc: result.kickoffUtc ?? "",
    homeTeam: result.homeTeam ?? "",
    awayTeam: result.awayTeam ?? "",
    market: result.market,
    line: result.line,
    outcome: result.outcome,
    decimalOdds: result.decimalOdds,
    fairOdds: result.fairOdds !== undefined ? result.fairOdds.toFixed(4) : "",
    fairProbability: result.fairProbability !== undefined ? result.fairProbability.toFixed(4) : "",
    ev: result.ev !== undefined ? result.ev.toFixed(4) : "",
    status: result.status,
  };
}
```

- [ ] **Step 6: Wire the `scan` command into `runCli`** (add inside the `try` block in `runCli`, before the unknown-command error, and add `loadTheOddsKey`/`createTheOddsClient`/`threshold` to the destructured deps)

In the deps destructure at the top of `runCli`, add:
```javascript
    loadTheOddsKey = defaultLoadTheOddsKey,
    createTheOddsClient = createTheOddsApiClient,
```
Then add the command branch:
```javascript
    if (command === "scan") {
      const edgeArg = rest.find((a) => a.startsWith("--edge="));
      const threshold = edgeArg ? Number(edgeArg.split("=")[1]) / 100 : 0.03;
      return await runScan({
        loadApiKey, loadTheOddsKey, createClient, createTheOddsClient, out, reportsDir, now,
        threshold: Number.isFinite(threshold) ? threshold : 0.03,
      });
    }
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `cd provider-harness && node --test test/cli_scan.test.mjs`
Expected: PASS.

- [ ] **Step 8: Run the full suite**

Run: `cd provider-harness && node --test`
Expected: PASS (all prior + new tests).

- [ ] **Step 9: Commit**

```bash
git add provider-harness/src/cli.mjs provider-harness/test/cli_scan.test.mjs
git commit -m "feat: add scan command for World Cup value bets"
```

---

### Task 8: README + quota-safe live smoke

**Files:**
- Modify: `provider-harness/README.md`

- [ ] **Step 1: Document the `scan` command** — add a `### scan` section to `README.md` describing: requires `ODDS_API_IO_KEY` + `THE_ODDS_API_KEY`; usage `node src/cli.mjs scan [--edge=5]`; that it compares Stoiximan/Superbet vs Pinnacle de-vig; EV tiers (VALUE 3–5%, VALUE_CHECK 5–15%, SUSPICIOUS >15%); and the safety notes (no scraping, no auto-bet, keys never printed, raw responses not retained).

- [ ] **Step 2: Run the full test suite**

Run: `cd provider-harness && node --test`
Expected: PASS, no secret output.

- [ ] **Step 3: Live smoke — verify Odds-API.io exposes World Cup fixtures**

Run: `cd provider-harness && node src/cli.mjs events`
Expected: a fixture list. **Risk to confirm here:** the earlier `limit=5` probe returned non-World-Cup friendlies. If no World Cup fixtures appear, the bettable side of `scan` cannot match. If so, note it: the `scan` fixture filter (`/world\s*cup/`) found nothing and fell back to all football. Record whether Odds-API.io actually carries World Cup fixtures; if not, that is a finding to resolve (larger limit, a league filter, or accept reference-only output) before relying on `scan`.

- [ ] **Step 4: Live smoke — one real scan**

Run: `cd provider-harness && node src/cli.mjs scan --edge=5`
Expected: a header line, zero or more alerts, The Odds API quota line, and a written `reports/scan-*.csv`. Confirm the run spends ~2 The Odds API credits (one `/odds` batch) plus one Odds-API.io `/odds` per matched fixture.

- [ ] **Step 5: Verify report sanitation**

Open the newest `reports/scan-*.csv` and confirm it contains no API key, no request URL, no raw provider response, and only `pinnacle`-derived fair values plus Superbet/Stoiximan rows. (`reports/*.csv` is already git-ignored.)

- [ ] **Step 6: Commit**

```bash
git add provider-harness/README.md
git commit -m "docs: document scan command and live smoke"
```

---

## Self-Review Notes

- **Spec coverage:** two providers (Tasks 2–3), canonical shape reuse (Task 3), cross-provider matching with aliases (Task 4), de-vig + EV + tiers + NO_REFERENCE + exact-line (Task 5), data-grounded reasons + risk block (Tasks 5–6), `scan` wiring + sanitized report + key safety (Task 7), README + quota-safe live smoke (Task 8). BTTS is explicitly out of scope per spec.
- **Known live risk (flagged in Task 8 Step 3):** Odds-API.io World Cup fixture availability is unverified; `scan` degrades to "no matched fixtures" rather than failing if absent.
- **Type consistency:** `findValueBets`/`classifyEv`/`buildReasons` (Task 5) are consumed unchanged by `formatAlert` (Task 6) and `runScan` (Task 7); selection fields match `normalize.mjs` and `theodds_normalize.mjs`; `matchFixtures` pair shape (`referenceEventId`, `bettableEventId`, `homeTeam`, `awayTeam`, `kickoffUtc`) is consumed as `fixture` by `formatAlert`.
