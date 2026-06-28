import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runCli } from "../src/cli.mjs";
import { readCsv } from "../src/csv.mjs";

const NOW = new Date("2026-06-28T12:00:00Z");

test("live-updated-poll calls updated odds with a fresh since timestamp and writes feed/training rows", async () => {
  const calls = [];
  const reportsDir = await mkdtemp(join(tmpdir(), "live-updated-poll-"));

  const code = await runCli([
    "live-updated-poll",
    "--sport=Football",
    "--bookmakers=Stoiximan,Novibet",
    "--interval-seconds=45",
    "--duration-minutes=0",
    "--markets=ML,Totals",
  ], {
    out: () => {},
    err: () => {},
    reportsDir,
    now: () => NOW,
    loadApiKey: async () => "odds-api-io-secret",
    loadTheOddsKey: async () => { throw new Error("live-updated-poll must not load The Odds API key"); },
    createClient: () => ({
      async getOddsUpdated(args) {
        calls.push(args);
        if (args.bookmaker === "Novibet") return { data: [], receivedAt: NOW.toISOString() };
        return {
          data: [{
            id: 101,
            date: "2026-06-28T18:00:00Z",
            home: "Japan",
            away: "Sweden",
            league: { name: "World Cup" },
            sport: { name: "Football" },
            status: "live",
            bookmakers: {
              Stoiximan: [{
                name: "ML",
                updatedAt: NOW.toISOString(),
                odds: [{ home: "2.00", draw: "3.40", away: "3.80" }],
              }],
            },
          }],
          receivedAt: NOW.toISOString(),
        };
      },
    }),
  });

  assert.equal(code, 0);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.since >= Math.floor(NOW.getTime() / 1000) - 60));
  assert.deepEqual(calls.map((call) => call.bookmaker), ["Stoiximan", "Novibet"]);

  const feed = await readCsv(join(reportsDir, "ws-live-feed-stats.csv"));
  assert.equal(feed.length, 1);
  assert.equal(feed[0].messageType, "updated_poll");
  assert.equal(feed[0].providerEventId, "101");
  assert.equal(feed[0].bookmaker, "Stoiximan");
  assert.equal(feed[0].markets, "MATCH_RESULT");
  assert.equal(feed[0].trainingRows, "3");

  const training = await readCsv(join(reportsDir, "live-training-observations.csv"));
  assert.equal(training.length, 3);
  assert.equal(training[0].sampleTier, "LIVE_UNCONFIRMED");
  assert.equal(training[0].confirmationStatus, "UNCONFIRMED");
});
