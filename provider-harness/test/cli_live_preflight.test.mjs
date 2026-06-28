import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runCli } from "../src/cli.mjs";
import { readCsv } from "../src/csv.mjs";

const KEY = "odds-api-io-secret";

function oddsEvent(id, bookmakers) {
  return {
    id,
    date: "2026-06-28T18:00:00Z",
    home: "Japan",
    away: "Sweden",
    league: { name: "World Cup", slug: "world-cup" },
    sport: { name: "Football", slug: "football" },
    status: "live",
    bookmakers,
  };
}

test("live-preflight writes selected-bookmaker, live-event, odds snapshot, and event id reports", async () => {
  const calls = [];
  let out = "";
  const reportsDir = await mkdtemp(join(tmpdir(), "live-preflight-"));

  const code = await runCli([
    "live-preflight",
    "--sport=football",
    "--bookmakers=Stoiximan,Novibet",
    "--markets=ML,Totals",
    "--max-events=50",
  ], {
    out: (text) => { out += text; },
    err: () => {},
    reportsDir,
    loadApiKey: async () => KEY,
    loadTheOddsKey: async () => { throw new Error("live-preflight must not load The Odds API key"); },
    createTheOddsClient: () => { throw new Error("live-preflight must not create The Odds API client"); },
    createClient: ({ apiKey }) => {
      assert.equal(apiKey, KEY);
      return {
        async listSelectedBookmakers() {
          calls.push(["selected"]);
          return {
            data: {
              bookmakers: {
                stoiximan: { name: "Stoiximan" },
                novibet: { name: "Novibet" },
              },
            },
          };
        },
        async listLiveEvents(args) {
          calls.push(["liveEvents", args]);
          return {
            data: [
              { id: 101, home: "Japan", away: "Sweden", bookmakerCount: 2, status: "live" },
              { id: 202, home: "Brazil", away: "Spain", bookmakerCount: 1, status: "live" },
            ],
          };
        },
        async getOddsMulti(args) {
          calls.push(["oddsMulti", args]);
          return {
            seq: 482917,
            receivedAt: "2026-06-28T12:00:00Z",
            data: [
              oddsEvent(101, {
                Stoiximan: [
                  {
                    name: "ML",
                    updatedAt: "2026-06-28T12:00:00Z",
                    odds: [{ home: "2.00", draw: "3.40", away: "3.80" }],
                  },
                ],
              }),
              oddsEvent(202, {}),
            ],
          };
        },
      };
    },
  });

  assert.equal(code, 0);
  assert.match(out, /Live preflight: usableEvents=1/);
  assert.deepEqual(calls, [
    ["selected"],
    ["liveEvents", { sport: "football" }],
    ["oddsMulti", { eventIds: ["101", "202"], bookmakers: ["Stoiximan", "Novibet"], includeSeq: true }],
  ]);

  const json = JSON.parse(await readFile(join(reportsDir, "live-preflight.json"), "utf8"));
  assert.equal(json.summary.selectedBookmakersVisible, true);
  assert.equal(json.summary.liveEventCount, 2);
  assert.equal(json.summary.usableEventCount, 1);
  assert.equal(json.summary.maxSeq, 482917);
  assert.deepEqual(json.usableEventIds, ["101"]);

  const rows = await readCsv(join(reportsDir, "live-preflight.csv"));
  assert.equal(rows.find((row) => row.eventId === "101").reason, "MARKET_AVAILABLE");
  assert.equal(rows.find((row) => row.eventId === "202").reason, "NO_MARKET");

  const eventIds = await readFile(join(reportsDir, "live-preflight-eventIds.txt"), "utf8");
  assert.equal(eventIds.trim(), "101");
});

test("live-preflight reports missing selected bookmakers and skips snapshot when there are no live events", async () => {
  const calls = [];
  const reportsDir = await mkdtemp(join(tmpdir(), "live-preflight-empty-"));

  const code = await runCli(["live-preflight", "--sport=football", "--bookmakers=Stoiximan"], {
    out: () => {},
    err: () => {},
    reportsDir,
    loadApiKey: async () => KEY,
    loadTheOddsKey: async () => { throw new Error("must not load The Odds API key"); },
    createClient: () => ({
      async listSelectedBookmakers() {
        calls.push(["selected"]);
        return { data: { bookmakers: ["Novibet"] } };
      },
      async listLiveEvents(args) {
        calls.push(["liveEvents", args]);
        return { data: [] };
      },
      async getOddsMulti() {
        throw new Error("no live events should skip snapshot calls");
      },
    }),
  });

  assert.equal(code, 0);
  assert.deepEqual(calls, [["selected"], ["liveEvents", { sport: "football" }]]);

  const json = JSON.parse(await readFile(join(reportsDir, "live-preflight.json"), "utf8"));
  assert.equal(json.summary.selectedBookmakersVisible, false);
  assert.equal(json.summary.liveEventCount, 0);
  assert.deepEqual(json.summary.reasons, { NO_LIVE_EVENTS: 1 });
});
