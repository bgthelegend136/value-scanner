import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runCli } from "../src/cli.mjs";
import { createMispricingState } from "../src/mispricing_state.mjs";

const KEY = "scores-secret";

function clvRow(overrides = {}) {
  return {
    identity: "501|Stoiximan|MATCH_RESULT||1",
    sentAt: "2026-06-25T09:00:00Z",
    referenceSource: "the-odds-api",
    referenceEventId: "ref-501",
    sportKey: "soccer_fifa_world_cup",
    bookmaker: "Stoiximan",
    market: "MATCH_RESULT",
    line: "",
    outcome: "1",
    decimalOdds: "9.0500",
    kickoffUtc: "2026-06-26T18:30:00Z",
    sendFairProbability: "0.416667",
    status: "PENDING",
    closingFairOdds: "9.4448",
    clv: "-0.041798",
    clvCapturedAt: "2026-06-26T18:25:00.000Z",
    homeScore: "",
    awayScore: "",
    profit: "",
    settledAt: "",
    ...overrides,
  };
}

test("mispricing-settle settles live Telegram alerts and preserves secrets", async () => {
  const reportsDir = await mkdtemp(join(tmpdir(), "mispricing-settle-"));
  const state = createMispricingState({ reportsDir });
  await state.writeClvLedger([clvRow()]);
  const calls = [];
  let out = "";
  const code = await runCli(["mispricing-settle"], {
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
              id: "ref-501",
              completed: true,
              home_team: "Norway",
              away_team: "France",
              scores: [
                { name: "Norway", score: "2" },
                { name: "France", score: "1" },
              ],
              last_update: "2026-06-26T21:00:00Z",
            }],
            quota: { remaining: 480 },
          };
        },
      };
    },
    reportsDir,
    now: () => new Date("2026-06-26T21:05:00.000Z"),
  });

  assert.equal(code, 0);
  assert.deepEqual(calls, [{ sportKey: "soccer_fifa_world_cup", daysFrom: 3 }]);
  const [row] = await state.readClvLedger();
  assert.equal(row.status, "WON");
  assert.equal(row.homeScore, "2");
  assert.equal(row.awayScore, "1");
  assert.equal(row.profit, "8.0500");
  assert.match(out, /Live alerts: 1/);
  assert.match(out, /ROI: \+805\.0%/);
  assert.doesNotMatch(
    await readFile(join(reportsDir, "mispricing-clv.csv"), "utf8"),
    new RegExp(KEY),
  );
});

test("mispricing-settle spends no quota when there are no pending live alerts", async () => {
  const reportsDir = await mkdtemp(join(tmpdir(), "mispricing-settle-empty-"));
  const state = createMispricingState({ reportsDir });
  await state.writeClvLedger([clvRow({ status: "LOST", profit: "-1.0000" })]);
  let calls = 0;
  const code = await runCli(["mispricing-settle"], {
    out: () => {},
    err: () => {},
    loadTheOddsKey: async () => KEY,
    createTheOddsClient: () => ({ async getScores() { calls += 1; return { data: [], quota: {} }; } }),
    reportsDir,
  });

  assert.equal(code, 0);
  assert.equal(calls, 0);
});
