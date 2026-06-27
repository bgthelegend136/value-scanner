import assert from "node:assert/strict";
import test from "node:test";

import {
  applyWsMessage,
  buildWsUrl,
  createLifetimeState,
  evaluateStrictEvMessage,
  evaluateStrictEvMessageWithAudit,
  liveShadowAuditPath,
  redactWsUrl,
} from "../scripts/ws-lifetime-probe.mjs";

const NOW = new Date("2026-06-25T09:00:00Z");
const KICKOFF = "2026-06-26T18:30:00Z";
const TIMESTAMP = Math.floor(NOW.getTime() / 1000);

function refBook(key, home, draw, away) {
  return {
    key,
    title: key,
    last_update: NOW.toISOString(),
    markets: [{
      key: "h2h",
      last_update: NOW.toISOString(),
      outcomes: [
        { name: "Japan", price: home },
        { name: "Sweden", price: away },
        { name: "Draw", price: draw },
      ],
    }],
  };
}

function referenceOdds({ lowHome = false } = {}) {
  const prices = lowHome
    ? [30.0, 1.08, 18.0]
    : [1.95, 3.6, 3.9];
  return [{
    id: "ref-501",
    sport_title: "FIFA World Cup",
    commence_time: KICKOFF,
    home_team: "Japan",
    away_team: "Sweden",
    bookmakers: [
      refBook("pinnacle", ...prices),
      refBook("betsson", ...prices),
      refBook("unibet", ...prices),
      refBook("williamhill", ...prices),
    ],
  }];
}

function referenceClient({ lowHome = false } = {}) {
  return {
    async listEvents() {
      return {
        data: [{ id: "ref-501", home_team: "Japan", away_team: "Sweden", commence_time: KICKOFF }],
      };
    },
    async getOdds() {
      return { data: referenceOdds({ lowHome }), receivedAt: NOW.toISOString(), quota: { remaining: 19900 } };
    },
  };
}

function wsMessage({
  seq = 10,
  timestamp = TIMESTAMP,
  homeOdds = "2.40",
  drawOdds = "3.05",
  awayOdds = "4.05",
  type = "created",
} = {}) {
  const odds = {};
  if (homeOdds !== null) odds.home = homeOdds;
  if (drawOdds !== null) odds.draw = drawOdds;
  if (awayOdds !== null) odds.away = awayOdds;
  return {
    type,
    seq,
    timestamp,
    id: "evt-501",
    bookie: "Stoiximan",
    event: {
      home: "Japan",
      away: "Sweden",
      date: KICKOFF,
      sport: "Football",
      league: "FIFA World Cup",
    },
    markets: [{
      name: "ML",
      updatedAt: NOW.toISOString(),
      odds: [odds],
    }],
  };
}

test("ws probe builds replayable URLs and redacts the API key for logs", () => {
  const url = buildWsUrl({
    apiKey: "odds-secret",
    markets: "ML",
    channels: "odds",
    sport: "football",
    status: "prematch",
    lastSeq: 482917,
  });

  const parsed = new URL(url);
  assert.equal(parsed.origin, "wss://api.odds-api.io");
  assert.equal(parsed.pathname, "/v3/ws");
  assert.equal(parsed.searchParams.get("apiKey"), "odds-secret");
  assert.equal(parsed.searchParams.get("markets"), "ML");
  assert.equal(parsed.searchParams.get("channels"), "odds");
  assert.equal(parsed.searchParams.get("sport"), "football");
  assert.equal(parsed.searchParams.get("status"), "prematch");
  assert.equal(parsed.searchParams.get("lastSeq"), "482917");

  const redacted = redactWsUrl(url);
  assert.doesNotMatch(redacted, /odds-secret/);
  assert.match(redacted, /apiKey=REDACTED/);
});

test("live shadow audit path is opt-in and can be overridden", () => {
  assert.equal(liveShadowAuditPath({ argv: [], reportsDir: "reports" }), "");
  assert.equal(
    liveShadowAuditPath({ argv: ["--live-shadow"], reportsDir: "reports" }),
    "reports\\ws-live-shadow-audit.csv",
  );
  assert.equal(
    liveShadowAuditPath({ argv: ["--audit-output=C:\\tmp\\audit.csv"], reportsDir: "reports" }),
    "C:\\tmp\\audit.csv",
  );
});

test("legacy ws probe records a raw high-price lifecycle when an update falls below threshold", () => {
  const state = createLifetimeState();
  const options = { minOdds: 15, targetBookmakers: new Set(["Stoiximan"]) };

  assert.deepEqual(applyWsMessage(state, {
    type: "created",
    seq: 10,
    timestamp: 1_000,
    id: "evt-1",
    bookie: "Stoiximan",
    markets: [{ name: "ML", updatedAt: "2026-06-27T10:00:00Z", odds: [{ home: "17.00", draw: "4.0", away: "1.5" }] }],
  }, options), []);

  const closed = applyWsMessage(state, {
    type: "updated",
    seq: 11,
    timestamp: 1_120,
    id: "evt-1",
    bookie: "Stoiximan",
    markets: [{ name: "ML", updatedAt: "2026-06-27T10:02:00Z", odds: [{ home: "12.00", draw: "4.0", away: "1.5" }] }],
  }, options);

  assert.equal(state.lastSeq, 11);
  assert.equal(closed.length, 1);
  assert.equal(closed[0].eventId, "evt-1");
  assert.equal(closed[0].bookmaker, "Stoiximan");
  assert.equal(closed[0].outcome, "1");
  assert.equal(closed[0].firstOdds, "17.0000");
  assert.equal(closed[0].lastOdds, "12.0000");
  assert.equal(closed[0].lifetimeSeconds, "120.000");
  assert.equal(closed[0].endReason, "UPDATED_BELOW_THRESHOLD");
});

test("strict EV ws probe opens and closes only around confirmed 10%+ EV", async () => {
  const state = createLifetimeState();
  const options = {
    referenceClient: referenceClient(),
    registry: new Map([["football|fifa-world-cup", "soccer_fifa_world_cup"]]),
    activeSports: [{ key: "soccer_fifa_world_cup", active: true, group: "Soccer", title: "FIFA World Cup" }],
    now: NOW,
  };

  assert.deepEqual(await evaluateStrictEvMessage(state, wsMessage(), options), []);
  assert.equal(state.active.size, 1);

  const closed = await evaluateStrictEvMessage(
    state,
    wsMessage({ seq: 11, timestamp: TIMESTAMP + 120, homeOdds: "1.90", type: "updated" }),
    options,
  );

  assert.equal(closed.length, 1);
  assert.equal(closed[0].providerEventId, "evt-501");
  assert.equal(closed[0].referenceEventId, "ref-501");
  assert.equal(closed[0].bookmaker, "Stoiximan");
  assert.equal(closed[0].outcome, "1");
  assert.equal(closed[0].firstOdds, "2.4000");
  assert.equal(closed[0].lastOdds, "1.9000");
  assert.equal(closed[0].lifetimeSeconds, "120.000");
  assert.equal(closed[0].endReason, "PINNACLE_EV_BELOW_MIN");
  assert.ok(Number(closed[0].firstPinnacleEv) > 0.1);
  assert.ok(Number(closed[0].firstConsensusEv) > 0.1);
  assert.ok(Number(closed[0].lastPinnacleEv) < 0.1);
  assert.equal(state.active.size, 0);
});

test("strict EV ws probe ignores raw longshot prices that fail dual confirmation", async () => {
  const state = createLifetimeState();
  const closed = await evaluateStrictEvMessage(state, wsMessage({
    homeOdds: "17.00",
    drawOdds: null,
    awayOdds: null,
  }), {
    referenceClient: referenceClient({ lowHome: true }),
    registry: new Map([["football|fifa-world-cup", "soccer_fifa_world_cup"]]),
    activeSports: [{ key: "soccer_fifa_world_cup", active: true, group: "Soccer", title: "FIFA World Cup" }],
    now: NOW,
  });

  assert.deepEqual(closed, []);
  assert.equal(state.active.size, 0);
});

test("live shadow audit records rejected strict-EV candidate evaluations", async () => {
  const state = createLifetimeState();
  const { closed, audit } = await evaluateStrictEvMessageWithAudit(state, wsMessage({
    homeOdds: "1.90",
  }), {
    referenceClient: referenceClient(),
    registry: new Map([["football|fifa-world-cup", "soccer_fifa_world_cup"]]),
    activeSports: [{ key: "soccer_fifa_world_cup", active: true, group: "Soccer", title: "FIFA World Cup" }],
    now: NOW,
  });

  assert.deepEqual(closed, []);
  assert.equal(audit.length, 3);
  const home = audit.find((row) => row.outcome === "1");
  assert.equal(home.status, "REJECTED");
  assert.equal(home.reason, "PINNACLE_EV_BELOW_MIN");
  assert.equal(home.providerEventId, "evt-501");
  assert.equal(home.bookmaker, "Stoiximan");
  assert.equal(home.match, "Japan - Sweden");
  assert.equal(home.sportKey, "soccer_fifa_world_cup");
  assert.equal(home.offeredOdds, "1.9000");
  assert.doesNotMatch(JSON.stringify(home), /secret|apiKey/i);
});

test("strict EV ws probe closes confirmed lifetimes when markets disappear", async () => {
  const state = createLifetimeState();
  const options = {
    referenceClient: referenceClient(),
    registry: new Map([["football|fifa-world-cup", "soccer_fifa_world_cup"]]),
    activeSports: [{ key: "soccer_fifa_world_cup", active: true, group: "Soccer", title: "FIFA World Cup" }],
    now: NOW,
  };

  await evaluateStrictEvMessage(state, wsMessage(), options);
  assert.equal(state.active.size, 1);

  const closed = await evaluateStrictEvMessage(state, {
    type: "no_markets",
    seq: 12,
    timestamp: TIMESTAMP + 180,
    id: "evt-501",
    bookie: "Stoiximan",
  }, options);

  assert.equal(closed.length, 1);
  assert.equal(closed[0].providerEventId, "evt-501");
  assert.equal(closed[0].referenceEventId, "ref-501");
  assert.equal(closed[0].lifetimeSeconds, "180.000");
  assert.equal(closed[0].endReason, "NO_MARKETS");
  assert.equal(state.active.size, 0);
});

test("ws probe closes active lifetimes on deleted/no_markets and ignores other books", () => {
  const state = createLifetimeState();
  const options = { minOdds: 5, targetBookmakers: new Set(["Novibet"]) };

  applyWsMessage(state, {
    type: "created",
    seq: 20,
    timestamp: 2_000,
    id: "evt-2",
    bookie: "Stoiximan",
    markets: [{ name: "ML", odds: [{ home: "9.00", draw: "3.0", away: "1.8" }] }],
  }, options);
  assert.equal(state.active.size, 0);

  applyWsMessage(state, {
    type: "created",
    seq: 21,
    timestamp: 2_010,
    id: "evt-2",
    bookie: "Novibet",
    markets: [{ name: "ML", odds: [{ home: "9.00", draw: "3.0", away: "1.8" }] }],
  }, options);
  assert.equal(state.active.size, 1);

  const closed = applyWsMessage(state, {
    type: "deleted",
    seq: 22,
    timestamp: 2_070,
    id: "evt-2",
    bookie: "Novibet",
  }, options);

  assert.equal(closed.length, 1);
  assert.equal(closed[0].endReason, "DELETED");
  assert.equal(state.active.size, 0);
});
