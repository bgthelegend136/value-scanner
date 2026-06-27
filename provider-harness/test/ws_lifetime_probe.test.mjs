import assert from "node:assert/strict";
import test from "node:test";

import {
  applyWsMessage,
  buildWsUrl,
  createLifetimeState,
  redactWsUrl,
} from "../scripts/ws-lifetime-probe.mjs";

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

test("ws probe records a full high-price lifecycle when an update falls below threshold", () => {
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
