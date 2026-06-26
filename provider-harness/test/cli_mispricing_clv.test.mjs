import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runCli } from "../src/cli.mjs";
import { createMispricingState } from "../src/mispricing_state.mjs";

const KEY = "theodds-secret";

function clvRow(overrides = {}) {
  return {
    identity: "501|Stoiximan|MATCH_RESULT||1",
    sentAt: "2026-06-25T09:00:00Z",
    referenceEventId: "ref-501",
    sportKey: "soccer_fifa_world_cup",
    bookmaker: "Stoiximan",
    market: "MATCH_RESULT",
    line: "",
    outcome: "1",
    decimalOdds: "2.4000",
    kickoffUtc: "2026-06-26T18:30:00Z",
    sendFairProbability: "0.416667",
    status: "PENDING",
    closingFairOdds: "",
    clv: "",
    clvCapturedAt: "",
    ...overrides,
  };
}

const closingOdds = [{
  id: "ref-501",
  sport_title: "FIFA World Cup",
  commence_time: "2026-06-26T18:30:00Z",
  home_team: "Japan",
  away_team: "Sweden",
  bookmakers: [{
    key: "pinnacle",
    title: "Pinnacle",
    last_update: "2026-06-26T18:25:00Z",
    markets: [{
      key: "h2h",
      last_update: "2026-06-26T18:25:00Z",
      outcomes: [
        { name: "Japan", price: 2.10 },
        { name: "Sweden", price: 3.90 },
        { name: "Draw", price: 3.60 },
      ],
    }],
  }],
}];

test("mispricing-clv captures closing line value for pending alerts", async () => {
  const reportsDir = await mkdtemp(join(tmpdir(), "mclv-"));
  const state = createMispricingState({ reportsDir });
  await state.writeClvLedger([clvRow()]);
  const calls = [];
  let out = "";
  const code = await runCli(["mispricing-clv"], {
    out: (text) => { out += text; },
    err: () => {},
    loadTheOddsKey: async () => KEY,
    createTheOddsClient: ({ apiKey }) => {
      assert.equal(apiKey, KEY);
      return {
        async getOdds(args) {
          calls.push(args);
          return { data: closingOdds, receivedAt: "2026-06-26T18:25:00.000Z", quota: { remaining: 480 } };
        },
      };
    },
    reportsDir,
    now: () => new Date("2026-06-26T18:25:00.000Z"),
  });

  assert.equal(code, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].sportKey, "soccer_fifa_world_cup");
  assert.deepEqual(calls[0].eventIds, ["ref-501"]);
  assert.equal(calls[0].markets, "h2h");

  const [row] = await state.readClvLedger();
  assert.notEqual(row.clv, "");
  assert.notEqual(row.closingFairOdds, "");
  assert.equal(row.clvCapturedAt, "2026-06-26T18:25:00.000Z");
  assert.match(out, /Mispricing CLV captured: 1/);
  // The reference key must never leak into a written report.
  assert.doesNotMatch(
    await readFile(join(reportsDir, "mispricing-clv.csv"), "utf8"),
    new RegExp(KEY),
  );
});

test("mispricing-clv waits until kickoff is near before capturing the close", async () => {
  const reportsDir = await mkdtemp(join(tmpdir(), "mclv-early-"));
  const state = createMispricingState({ reportsDir });
  await state.writeClvLedger([clvRow()]); // kickoff 18:30
  let calls = 0;
  const code = await runCli(["mispricing-clv"], {
    out: () => {},
    err: () => {},
    loadTheOddsKey: async () => KEY,
    createTheOddsClient: () => ({ async getOdds() { calls += 1; return { data: [], quota: {} }; } }),
    reportsDir,
    now: () => new Date("2026-06-26T12:00:00.000Z"), // 6.5h before kickoff -> too early
  });
  assert.equal(code, 0);
  assert.equal(calls, 0); // no closing-line fetch yet
  const [row] = await state.readClvLedger();
  assert.equal(row.status, "PENDING"); // still awaiting the close
});

test("mispricing-clv does not recapture an alert that already has CLV", async () => {
  const reportsDir = await mkdtemp(join(tmpdir(), "mclv-already-captured-"));
  const state = createMispricingState({ reportsDir });
  await state.writeClvLedger([
    clvRow({
      closingFairOdds: "9.4448",
      clv: "-0.041798",
      clvCapturedAt: "2026-06-26T19:00:04.288Z",
    }),
  ]);
  let calls = 0;
  const code = await runCli(["mispricing-clv"], {
    out: () => {},
    err: () => {},
    loadTheOddsKey: async () => KEY,
    createTheOddsClient: () => ({ async getOdds() { calls += 1; return { data: [], quota: {} }; } }),
    reportsDir,
    now: () => new Date("2026-06-26T19:45:00.000Z"),
  });

  assert.equal(code, 0);
  assert.equal(calls, 0);
  const [row] = await state.readClvLedger();
  assert.equal(row.status, "PENDING");
  assert.equal(row.clv, "-0.041798");
  assert.equal(row.clvCapturedAt, "2026-06-26T19:00:04.288Z");
});

test("mispricing-clv spends no quota with no pending alerts", async () => {
  const reportsDir = await mkdtemp(join(tmpdir(), "mclv-empty-"));
  let calls = 0;
  const deps = {
    out: () => {},
    err: () => {},
    loadTheOddsKey: async () => KEY,
    createTheOddsClient: () => ({ async getOdds() { calls += 1; return { data: [], quota: {} }; } }),
    reportsDir,
    now: () => new Date("2026-06-26T18:25:00.000Z"),
  };

  // No ledger file at all.
  assert.equal(await runCli(["mispricing-clv"], deps), 0);

  // Ledger with only an already-captured (non-PENDING) row.
  const state = createMispricingState({ reportsDir });
  await state.writeClvLedger([clvRow({ status: "WON", clv: "0.050000" })]);
  assert.equal(await runCli(["mispricing-clv"], deps), 0);
  assert.equal(calls, 0);
});
