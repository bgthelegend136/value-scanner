import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runCli } from "../src/cli.mjs";
import { readCsv } from "../src/csv.mjs";

test("market-availability writes reason buckets and honors the credit cap", async () => {
  const calls = [];
  const reportsDir = await mkdtemp(join(tmpdir(), "market-availability-"));

  const code = await runCli([
    "market-availability",
    "--sports=soccer_empty,soccer_epl",
    "--markets=btts,draw_no_bet,double_chance",
    "--regions=eu",
    "--event-limit=2",
    "--max-credits=1",
  ], {
    out: () => {},
    err: () => {},
    reportsDir,
    loadApiKey: async () => { throw new Error("market-availability must not use Odds-API.io"); },
    loadTheOddsKey: async () => "the-odds-secret",
    createTheOddsClient: () => ({
      async listEvents(args) {
        calls.push(["events", args]);
        if (args.sportKey === "soccer_empty") return { data: [] };
        return {
          data: [
            { id: "event-1", home_team: "A", away_team: "B", commence_time: "2026-06-28T18:00:00Z" },
            { id: "event-2", home_team: "C", away_team: "D", commence_time: "2026-06-28T20:00:00Z" },
          ],
        };
      },
      async getEventMarkets(args) {
        calls.push(["markets", args]);
        return {
          quota: { lastCost: 1, remaining: 19800 },
          data: [
            { key: "pinnacle", markets: [{ key: "btts" }, { key: "draw_no_bet" }] },
            { key: "betsson", markets: [{ key: "btts" }] },
            { key: "unibet", markets: [{ key: "btts" }] },
          ],
        };
      },
    }),
  });

  assert.equal(code, 0);
  assert.equal(calls.filter((call) => call[0] === "markets").length, 1);
  assert.deepEqual(calls.find((call) => call[0] === "markets")[1], {
    sportKey: "soccer_epl",
    eventId: "event-1",
    regions: "eu",
  });

  const rows = await readCsv(join(reportsDir, "market-availability.csv"));
  assert.equal(rows.find((row) => row.sportKey === "soccer_empty" && row.market === "btts").reason, "NO_EVENT");
  assert.equal(rows.find((row) => row.sportKey === "soccer_epl" && row.market === "btts").reason, "MARKET_AVAILABLE");
  assert.equal(rows.find((row) => row.sportKey === "soccer_epl" && row.market === "draw_no_bet").reason, "TOO_FEW_BOOKS");
  assert.equal(rows.find((row) => row.sportKey === "soccer_epl" && row.market === "double_chance").reason, "NO_MARKET");

  const json = JSON.parse(await readFile(join(reportsDir, "market-availability.json"), "utf8"));
  assert.equal(json.summary.creditsSpent, 1);
  assert.equal(json.summary.reasons.MARKET_AVAILABLE, 1);
  assert.equal(json.summary.stoppedByCreditCap, true);
});
