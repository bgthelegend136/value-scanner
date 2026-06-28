import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  applyLiveEventState,
  applyWsMessage,
  buildWsUrl,
  createSerializedCsvAppender,
  createLifetimeState,
  evaluateStrictEvMessage,
  evaluateStrictEvMessageWithAudit,
  liveEventStatusPath,
  liveEventStatusRow,
  liveFeedStatsPath,
  liveFeedStatsRow,
  liveTrainingPath,
  liveShadowAuditPath,
  targetBookmakersFromArgv,
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
    markets: [
      {
        key: "h2h",
        last_update: NOW.toISOString(),
        outcomes: [
          { name: "Japan", price: home },
          { name: "Sweden", price: away },
          { name: "Draw", price: draw },
        ],
      },
      {
        key: "totals",
        last_update: NOW.toISOString(),
        outcomes: [
          { name: "Over", point: 2.5, price: 2.10 },
          { name: "Under", point: 2.5, price: 1.80 },
        ],
      },
    ],
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
  maxBet = "250",
  type = "created",
} = {}) {
  const odds = {};
  if (homeOdds !== null) odds.home = homeOdds;
  if (drawOdds !== null) odds.draw = drawOdds;
  if (awayOdds !== null) odds.away = awayOdds;
  if (maxBet !== null) odds.max = maxBet;
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

test("live training path is opt-in and can be overridden", () => {
  assert.equal(liveTrainingPath({ argv: [], reportsDir: "reports" }), "");
  assert.equal(
    liveTrainingPath({ argv: ["--live-training"], reportsDir: "reports" }),
    "reports\\live-training-observations.csv",
  );
  assert.equal(
    liveTrainingPath({ argv: ["--training-output=C:\\tmp\\training.csv"], reportsDir: "reports" }),
    "C:\\tmp\\training.csv",
  );
});

test("live event status path follows live training and can be overridden", () => {
  assert.equal(liveEventStatusPath({ argv: [], reportsDir: "reports" }), "");
  assert.equal(
    liveEventStatusPath({ argv: ["--live-training"], reportsDir: "reports" }),
    "reports\\live-event-status.csv",
  );
  assert.equal(
    liveEventStatusPath({ argv: ["--status-output=C:\\tmp\\status.csv"], reportsDir: "reports" }),
    "C:\\tmp\\status.csv",
  );
});

test("live feed stats path is enabled for shadow or training probes", () => {
  assert.equal(liveFeedStatsPath({ argv: [], reportsDir: "reports" }), "");
  assert.equal(
    liveFeedStatsPath({ argv: ["--live-shadow"], reportsDir: "reports" }),
    "reports\\ws-live-feed-stats.csv",
  );
  assert.equal(
    liveFeedStatsPath({ argv: ["--live-training"], reportsDir: "reports" }),
    "reports\\ws-live-feed-stats.csv",
  );
  assert.equal(
    liveFeedStatsPath({ argv: ["--feed-stats-output=C:\\tmp\\feed.csv"], reportsDir: "reports" }),
    "C:\\tmp\\feed.csv",
  );
});

test("target bookmaker option can widen measurement-only live training", () => {
  assert.deepEqual([...targetBookmakersFromArgv([])], ["Stoiximan", "Novibet"]);
  assert.equal(targetBookmakersFromArgv(["--target-bookmakers=ALL"]), null);
  assert.deepEqual(
    [...targetBookmakersFromArgv(["--target-bookmakers=Bet365,Unibet"])],
    ["Bet365", "Unibet"],
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

test("live training records EV-banded control and value observations", async () => {
  const state = createLifetimeState();
  const { closed, audit, training } = await evaluateStrictEvMessageWithAudit(state, wsMessage({
    homeOdds: "1.90",
  }), {
    referenceClient: referenceClient(),
    registry: new Map([["football|fifa-world-cup", "soccer_fifa_world_cup"]]),
    activeSports: [{ key: "soccer_fifa_world_cup", active: true, group: "Soccer", title: "FIFA World Cup" }],
    now: NOW,
    trainingMinEv: -0.10,
  });

  assert.deepEqual(closed, []);
  assert.equal(audit.length, 3);
  assert.ok(training.length >= 1);
  const home = training.find((row) => row.outcome === "1");
  assert.equal(home.sampleTier, "LIVE_CONTROL");
  assert.equal(home.confirmationStatus, "REJECTED");
  assert.equal(home.rejectionReason, "PINNACLE_EV_BELOW_MIN");
  assert.equal(home.referenceEventId, "ref-501");
  assert.equal(home.bookmaker, "Stoiximan");
  assert.equal(home.market, "MATCH_RESULT");
  assert.equal(home.maxBet, "250.0000");
  assert.match(home.pinnacleFairProbability, /^\d+\.\d{6}$/u);
  assert.match(home.minimumConfirmedEv, /^-/u);
});

test("live training enriches odds observations with latest score and status state", async () => {
  const state = createLifetimeState();
  const liveEventStates = new Map();
  applyLiveEventState(liveEventStates, {
    type: "status",
    id: "evt-501",
    timestamp: TIMESTAMP - 10,
    status: "live",
    scores: { home: 2, away: 1 },
  });

  const { training } = await evaluateStrictEvMessageWithAudit(state, wsMessage({
    homeOdds: "1.90",
  }), {
    referenceClient: referenceClient(),
    registry: new Map([["football|fifa-world-cup", "soccer_fifa_world_cup"]]),
    activeSports: [{ key: "soccer_fifa_world_cup", active: true, group: "Soccer", title: "FIFA World Cup" }],
    now: NOW,
    scoreStateByEvent: liveEventStates,
    trainingMinEv: -0.10,
  });

  assert.equal(training[0].liveStatus, "live");
  assert.equal(training[0].homeScore, "2");
  assert.equal(training[0].awayScore, "1");
});

test("live event status rows persist score/status messages for later settlement joins", () => {
  assert.equal(liveEventStatusRow({ type: "welcome" }), null);
  assert.deepEqual(liveEventStatusRow({
    type: "status",
    id: "evt-501",
    timestamp: TIMESTAMP,
    status: "settled",
    scores: { home: 2, away: 1 },
  }), {
    observedAt: NOW.toISOString(),
    providerEventId: "evt-501",
    eventStatus: "settled",
    homeScore: "2",
    awayScore: "1",
  });
});

test("live feed stats rows explain websocket messages without leaking secrets", () => {
  const row = liveFeedStatsRow(wsMessage(), {
    audit: [
      { status: "REJECTED", reason: "PINNACLE_EV_BELOW_MIN" },
      { status: "CONFIRMED", reason: "" },
    ],
    training: [{ sampleTier: "LIVE_CONTROL" }],
    closed: [{ endReason: "PINNACLE_EV_BELOW_MIN" }],
  });

  assert.equal(row.messageType, "created");
  assert.equal(row.providerEventId, "evt-501");
  assert.equal(row.bookmaker, "Stoiximan");
  assert.equal(row.markets, "ML");
  assert.equal(row.auditRows, "2");
  assert.equal(row.trainingRows, "1");
  assert.equal(row.closedRows, "1");
  assert.equal(row.rejectionReasons, "PINNACLE_EV_BELOW_MIN:1");
  assert.doesNotMatch(JSON.stringify(row), /secret|apiKey/i);
});

test("strict EV live probe evaluates totals markets against totals reference odds", async () => {
  const state = createLifetimeState();
  const message = {
    ...wsMessage({ homeOdds: null, drawOdds: null, awayOdds: null }),
    markets: [{
      name: "Totals",
      updatedAt: NOW.toISOString(),
      odds: [{ hdp: 2.5, over: "2.50", under: "1.60" }],
    }],
  };

  const { audit, training } = await evaluateStrictEvMessageWithAudit(state, message, {
    referenceClient: referenceClient(),
    registry: new Map([["football|fifa-world-cup", "soccer_fifa_world_cup"]]),
    activeSports: [{ key: "soccer_fifa_world_cup", active: true, group: "Soccer", title: "FIFA World Cup" }],
    now: NOW,
    trainingMinEv: -0.10,
  });

  assert.equal(audit.length, 2);
  assert.equal(audit[0].market, "TOTALS");
  assert.equal(audit[0].line, "2.5");
  assert.equal(audit[0].reason, "");
  assert.equal(audit[0].status, "CONFIRMED");
  assert.ok(training.length >= 1);
  const over = training.find((row) => row.outcome === "OVER");
  assert.equal(over.market, "TOTALS");
  assert.equal(over.sampleTier, "STRICT_CONFIRMED");
});

test("serialized CSV appender preserves concurrent websocket audit writes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ws-audit-"));
  const output = join(dir, "audit.csv");
  const append = createSerializedCsvAppender(["seq", "status"]);

  await Promise.all(Array.from({ length: 20 }, (_, index) =>
    append(output, [{ seq: String(index), status: "REJECTED" }]),
  ));

  const lines = (await readFile(output, "utf8")).trim().split(/\r?\n/u);
  assert.equal(lines[0], "seq,status");
  assert.equal(lines.filter((line) => line === "seq,status").length, 1);
  assert.equal(lines.length, 21);
  assert.deepEqual(
    new Set(lines.slice(1).map((line) => line.split(",")[0])),
    new Set(Array.from({ length: 20 }, (_, index) => String(index))),
  );
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
