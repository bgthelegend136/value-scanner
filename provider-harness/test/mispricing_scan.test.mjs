import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runMispricingScan } from "../src/mispricing_scan.mjs";
import { createMispricingState } from "../src/mispricing_state.mjs";

const now = new Date("2026-06-25T09:00:00Z");
const KICKOFF = "2026-06-26T18:30:00Z";
const FRESH = "2026-06-25T08:58:00Z";

function rawCandidate({ bookmaker = "Stoiximan", eventId = 501 } = {}) {
  return {
    id: `${eventId}-ML-home-${bookmaker}`,
    expectedValue: 125,
    expectedValueUpdatedAt: FRESH,
    betSide: "home",
    bookmaker,
    eventId,
    event: {
      home: "Japan", away: "Sweden", date: KICKOFF,
      sport: "Football", league: "FIFA World Cup",
    },
    market: { name: "ML", home: "1.788", draw: "3.8", away: "5.0" },
    bookmakerOdds: { home: "2.40", draw: "3.05", away: "4.05", href: "https://en.stoiximan.gr/m/501" },
  };
}

function refBook(key, home, draw, away) {
  return {
    key, title: key, last_update: FRESH,
    markets: [{
      key: "h2h", last_update: FRESH,
      outcomes: [
        { name: "Japan", price: home },
        { name: "Sweden", price: away },
        { name: "Draw", price: draw },
      ],
    }],
  };
}

function referenceOdds() {
  return [{
    id: "ref-501", sport_title: "FIFA World Cup", commence_time: KICKOFF,
    home_team: "Japan", away_team: "Sweden",
    bookmakers: [
      refBook("pinnacle", 1.95, 3.6, 3.9),
      refBook("betsson", 1.95, 3.6, 3.9),
      refBook("unibet", 1.95, 3.6, 3.9),
      refBook("williamhill", 1.95, 3.6, 3.9),
    ],
  }];
}

function secondaryReferenceOdds() {
  return [{
    id: "secondary-501", sport_title: "FIFA World Cup", commence_time: KICKOFF,
    home_team: "Japan", away_team: "Sweden",
    bookmakers: [
      refBook("pinnacle", 1.95, 3.6, 3.9),
      refBook("betsson", 1.95, 3.6, 3.9),
      refBook("unibet", 1.95, 3.6, 3.9),
      refBook("williamhill", 1.95, 3.6, 3.9),
    ],
  }];
}
function deps({ reportsDir, state, sent = [], quotaRemaining = 19998 }) {
  return {
    valueBetsClient: {
      async getValueBets({ bookmaker }) {
        return { data: [rawCandidate({ bookmaker })], receivedAt: now.toISOString(), rateLimit: {} };
      },
    },
    referenceClient: {
      async listSports() { return { data: [{ key: "soccer_fifa_world_cup", active: true }] }; },
      async listEvents() {
        return { data: [{ id: "ref-501", home_team: "Japan", away_team: "Sweden", commence_time: KICKOFF }] };
      },
      async getOdds() {
        return { data: referenceOdds(), receivedAt: now.toISOString(), quota: { remaining: quotaRemaining, lastCost: 1 } };
      },
    },
    telegramClient: {
      async sendMispricing(candidate) { sent.push(candidate.bookmaker); return { messageId: String(sent.length) }; },
      async sendText() { return { messageId: "t" }; },
    },
    state,
    registry: new Map([["football|fifa-world-cup", "soccer_fifa_world_cup"]]),
    reportsDir, now,
  };
}

test("confirms, sends once per selected Greek book, records delivery, and does not duplicate", async () => {
  const reportsDir = await mkdtemp(join(tmpdir(), "scan-confirm-"));
  const state = createMispricingState({ reportsDir });
  const sent = [];
  const d = deps({ reportsDir, state, sent });

  const first = await runMispricingScan(d);
  const second = await runMispricingScan(d);
  assert.equal(first.confirmed, 2);
  assert.equal(first.sent, 2);
  assert.equal(second.sent, 0);
  assert.deepEqual(sent.sort(), ["Pamestoixima", "Stoiximan"].sort());
  assert.equal((await state.readAlerts()).length, 2);

  const clv = await state.readClvLedger();
  assert.equal(clv.length, 2);
  assert.ok(clv.every((row) => row.status === "PENDING"));
  assert.ok(clv.every((row) => row.referenceEventId === "ref-501"));
  assert.ok(clv.every((row) => Number(row.decimalOdds) === 2.4));
  // The second run must not duplicate the tracking rows.
  assert.equal((await state.readClvLedger()).length, 2);
});
test("records a heartbeat with the last success time and summary", async () => {
  const reportsDir = await mkdtemp(join(tmpdir(), "scan-heartbeat-"));
  const state = createMispricingState({ reportsDir });
  const summary = await runMispricingScan(deps({ reportsDir, state, sent: [] }));
  const beat = await state.readHeartbeat();
  assert.equal(beat.lastSuccessAt, now.toISOString());
  assert.equal(beat.summary.confirmed, summary.confirmed);
});

test("records a heartbeat even on a no-op detection cycle", async () => {
  const reportsDir = await mkdtemp(join(tmpdir(), "scan-heartbeat-noop-"));
  const state = createMispricingState({ reportsDir });
  const d = deps({ reportsDir, state });
  d.valueBetsClient.getValueBets = async () => ({ data: [], receivedAt: now.toISOString() });
  d.referenceClient.listSports = async () => { throw new Error("must not be called"); };
  await runMispricingScan(d);
  assert.equal((await state.readHeartbeat()).lastSuccessAt, now.toISOString());
});

test("dry run verifies but sends nothing and records no delivered alert", async () => {
  const reportsDir = await mkdtemp(join(tmpdir(), "scan-dry-"));
  const state = createMispricingState({ reportsDir });
  const sent = [];
  const summary = await runMispricingScan({ ...deps({ reportsDir, state, sent }), dryRun: true });
  assert.equal(summary.confirmed, 2);
  assert.equal(summary.sent, 0);
  assert.deepEqual(sent, []);
  assert.deepEqual(await state.readAlerts(), []);
  assert.deepEqual(await state.readClvLedger(), []);
});

test("detection tier spends zero reference calls when nothing qualifies and the queue is empty", async () => {
  const reportsDir = await mkdtemp(join(tmpdir(), "scan-detect-noop-"));
  const state = createMispricingState({ reportsDir });
  const d = deps({ reportsDir, state });
  // No raw candidate clears the watchlist floor this cycle.
  d.valueBetsClient.getValueBets = async () => ({ data: [], receivedAt: now.toISOString(), rateLimit: {} });
  // The cheap detection pass must not touch The Odds API at all.
  d.referenceClient.listSports = async () => { throw new Error("listSports must not be called"); };
  d.referenceClient.listEvents = async () => { throw new Error("listEvents must not be called"); };
  d.referenceClient.getOdds = async () => { throw new Error("getOdds must not be called"); };

  const summary = await runMispricingScan(d);

  assert.equal(summary.candidates, 0);
  assert.equal(summary.verifiedSports, 0);
  assert.equal(summary.sent, 0);
  assert.equal((await state.readQueue()).length, 0);
});

test("reference failure sends nothing and keeps candidates queued", async () => {
  const reportsDir = await mkdtemp(join(tmpdir(), "scan-ref-fail-"));
  const state = createMispricingState({ reportsDir });
  const d = deps({ reportsDir, state });
  d.referenceClient.getOdds = async () => { throw new Error("reference down"); };
  const summary = await runMispricingScan(d);
  assert.equal(summary.sent, 0);
  assert.equal((await state.readQueue()).length, 2);
  assert.equal((await state.readHealth()).referenceFailures, 1);
});

test("active-sports lookup failure queues candidates with known exact mappings", async () => {
  const reportsDir = await mkdtemp(join(tmpdir(), "scan-sports-fail-"));
  const state = createMispricingState({ reportsDir });
  const d = deps({ reportsDir, state });
  d.referenceClient.listSports = async () => { throw new Error("sports down"); };

  await assert.rejects(() => runMispricingScan(d), /sports down/);

  const queue = await state.readQueue();
  assert.equal(queue.length, 2);
  assert.ok(queue.every((row) => row.sportKey === "soccer_fifa_world_cup"));
  assert.equal((await state.readHealth()).referenceFailures, 1);
});

test("uses exact active-sport metadata when the static registry has no entry", async () => {
  const reportsDir = await mkdtemp(join(tmpdir(), "scan-auto-map-"));
  const state = createMispricingState({ reportsDir });
  const sent = [];
  const d = deps({ reportsDir, state, sent });
  d.registry = new Map();
  d.referenceClient.listSports = async () => ({
    data: [{
      key: "soccer_fifa_world_cup",
      group: "Soccer",
      title: "FIFA World Cup",
      active: true,
    }],
  });

  const summary = await runMispricingScan(d);

  assert.equal(summary.mapped, 2);
  assert.equal(summary.sent, 2);
});

test("uses a secondary reference source when the primary source cannot map the league", async () => {
  const reportsDir = await mkdtemp(join(tmpdir(), "scan-secondary-map-"));
  const state = createMispricingState({ reportsDir });
  const sent = [];
  const secondaryCalls = [];
  const d = deps({ reportsDir, state, sent });
  d.registry = new Map();
  d.referenceClient.listSports = async () => ({
    data: [{ key: "soccer_other", group: "Soccer", title: "Other Soccer", active: true }],
  });

  const summary = await runMispricingScan({
    ...d,
    secondaryReferenceClients: [{
      name: "secondary-reference",
      client: {
        async listSports() {
          secondaryCalls.push("listSports");
          return {
            data: [{
              key: "soccer_fifa_world_cup",
              group: "Soccer",
              title: "FIFA World Cup",
              active: true,
            }],
          };
        },
        async listEvents() {
          secondaryCalls.push("listEvents");
          return { data: [{ id: "secondary-501", home_team: "Japan", away_team: "Sweden", commence_time: KICKOFF }] };
        },
        async getOdds() {
          secondaryCalls.push("getOdds");
          return { data: secondaryReferenceOdds(), receivedAt: now.toISOString(), quota: { remaining: 450, lastCost: 1 } };
        },
      },
    }],
  });

  assert.equal(summary.mapped, 2);
  assert.equal(summary.confirmed, 2);
  assert.equal(summary.sent, 2);
  assert.ok(secondaryCalls.includes("getOdds"));
  const audit = await state.readAudit();
  assert.ok(audit.some((row) => row.referenceSource === "secondary-reference" && row.status === "CONFIRMED"));
});

test("falls back to a secondary reference source when primary odds lack Pinnacle coverage", async () => {
  const reportsDir = await mkdtemp(join(tmpdir(), "scan-secondary-confirm-"));
  const state = createMispricingState({ reportsDir });
  const sent = [];
  const d = deps({ reportsDir, state, sent });
  d.referenceClient.getOdds = async () => ({
    data: [{
      id: "ref-501",
      sport_title: "FIFA World Cup",
      commence_time: KICKOFF,
      home_team: "Japan",
      away_team: "Sweden",
      bookmakers: [
        refBook("betsson", 1.95, 3.6, 3.9),
        refBook("unibet", 1.95, 3.6, 3.9),
        refBook("williamhill", 1.95, 3.6, 3.9),
      ],
    }],
    receivedAt: now.toISOString(),
    quota: { remaining: 19998, lastCost: 1 },
  });

  const summary = await runMispricingScan({
    ...d,
    secondaryReferenceClients: [{
      name: "secondary-reference",
      client: {
        async listSports() {
          return { data: [{ key: "soccer_fifa_world_cup", active: true }] };
        },
        async listEvents() {
          return { data: [{ id: "secondary-501", home_team: "Japan", away_team: "Sweden", commence_time: KICKOFF }] };
        },
        async getOdds() {
          return { data: secondaryReferenceOdds(), receivedAt: now.toISOString(), quota: { remaining: 450, lastCost: 1 } };
        },
      },
    }],
  });

  assert.equal(summary.confirmed, 2);
  assert.equal(summary.sent, 2);
  const audit = await state.readAudit();
  assert.ok(audit.some((row) => row.referenceSource === "the-odds-api" && row.reason === "NO_EXACT_PINNACLE_MARKET"));
  assert.ok(audit.some((row) => row.referenceSource === "secondary-reference" && row.status === "CONFIRMED"));
});

test("Telegram failure records no delivery and leaves a retryable queue", async () => {
  const reportsDir = await mkdtemp(join(tmpdir(), "scan-tg-fail-"));
  const state = createMispricingState({ reportsDir });
  const d = deps({ reportsDir, state });
  d.telegramClient.sendMispricing = async () => { throw new Error("telegram down"); };
  const summary = await runMispricingScan(d);
  assert.equal(summary.sent, 0);
  assert.deepEqual(await state.readAlerts(), []);
  assert.deepEqual(await state.readClvLedger(), []);
  assert.equal((await state.readQueue()).length, 2);
  assert.equal((await state.readHealth()).telegramFailures, 2);
});

test("stops before verification when the 1000-credit quota reserve is reached", async () => {
  const reportsDir = await mkdtemp(join(tmpdir(), "scan-quota-"));
  const state = createMispricingState({ reportsDir });
  // Two sports; first getOdds reports remaining=1000 so the second is deferred.
  let oddsCalls = 0;
  const summary = await runMispricingScan({
    valueBetsClient: {
      async getValueBets({ bookmaker }) {
        return {
          data: [
            rawCandidate({ bookmaker, eventId: 501 }),
            { ...rawCandidate({ bookmaker, eventId: 601 }),
              event: { home: "Yankees", away: "Red Sox", date: KICKOFF, sport: "Baseball", league: "MLB" } },
          ],
          receivedAt: now.toISOString(),
        };
      },
    },
    referenceClient: {
      async listSports() {
        return { data: [{ key: "soccer_fifa_world_cup", active: true }, { key: "baseball_mlb", active: true }] };
      },
      async listEvents({ sportKey }) {
        const mlb = sportKey === "baseball_mlb";
        return { data: [{
          id: mlb ? "ref-601" : "ref-501",
          home_team: mlb ? "Yankees" : "Japan",
          away_team: mlb ? "Red Sox" : "Sweden",
          commence_time: KICKOFF,
        }] };
      },
      async getOdds() {
        oddsCalls += 1;
        return { data: referenceOdds(), receivedAt: now.toISOString(), quota: { remaining: 1000, lastCost: 1 } };
      },
    },
    telegramClient: { async sendMispricing() { return { messageId: "1" }; }, async sendText() { return { messageId: "t" }; } },
    state,
    registry: new Map([
      ["football|fifa-world-cup", "soccer_fifa_world_cup"],
      ["baseball|mlb", "baseball_mlb"],
    ]),
    reportsDir, now,
  });
  assert.equal(oddsCalls, 1);
  assert.equal(summary.quotaRemaining, 1000);
  assert.ok(summary.deferred >= 1);
});

test("third consecutive candidate-provider failure sends one health warning", async () => {
  const reportsDir = await mkdtemp(join(tmpdir(), "scan-source-fail-"));
  const state = createMispricingState({ reportsDir });
  const warnings = [];
  const d = {
    valueBetsClient: { async getValueBets() { throw new Error("source down"); } },
    referenceClient: { async listSports() { return { data: [] }; } },
    telegramClient: {
      async sendText(text) { warnings.push(text); return { messageId: "h1" }; },
      async sendMispricing() { return { messageId: "1" }; },
    },
    state, registry: new Map(), reportsDir, now,
  };
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await assert.rejects(() => runMispricingScan(d), /source down/);
  }
  assert.equal((await state.readHealth()).oddsApiFailures, 4);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Odds-API\.io failed for 3 consecutive runs/);
});

test("third consecutive reference failure sends one health warning", async () => {
  const reportsDir = await mkdtemp(join(tmpdir(), "scan-ref-health-"));
  const state = createMispricingState({ reportsDir });
  const warnings = [];
  const d = deps({ reportsDir, state });
  d.referenceClient.getOdds = async () => { throw new Error("reference down"); };
  d.telegramClient.sendText = async (text) => {
    warnings.push(text);
    return { messageId: "h1" };
  };

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const summary = await runMispricingScan(d);
    assert.equal(summary.sent, 0);
  }

  assert.equal((await state.readHealth()).referenceFailures, 4);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /The Odds API failed for 3 consecutive runs/);
});
