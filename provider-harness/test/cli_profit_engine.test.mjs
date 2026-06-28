import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runCli } from "../src/cli.mjs";
import { readCsv, writeCsv } from "../src/csv.mjs";
import { PAPER_COLUMNS } from "../src/paper.mjs";

function paperRow(overrides = {}) {
  return {
    referenceEventId: "event-1",
    bettableEventId: "bet-1",
    firstSeenAt: "2026-06-28T10:00:00.000Z",
    kickoffUtc: "2026-06-28T18:00:00.000Z",
    homeTeam: "Spain",
    awayTeam: "Italy",
    bookmaker: "Stoiximan",
    market: "MATCH_RESULT",
    line: "",
    outcome: "1",
    decimalOdds: "2.0000",
    fairOdds: "1.9000",
    fairProbability: "0.526316",
    ev: "0.030000",
    tier: "VALUE",
    stake: "1.00",
    status: "WON",
    homeScore: "2",
    awayScore: "1",
    profit: "1.0000",
    settledAt: "2026-06-28T20:00:00.000Z",
    closingFairOdds: "1.9417",
    clv: "0.030000",
    clvCapturedAt: "2026-06-28T17:40:00.000Z",
    sportKey: "soccer_fifa_world_cup",
    ...overrides,
  };
}

test("profit-engine writes offline readiness, live efficiency, and staking diagnostics", async () => {
  const reportsDir = await mkdtemp(join(tmpdir(), "profit-engine-"));
  await writeCsv(join(reportsDir, "paper-bets.csv"), [
    paperRow(),
    paperRow({
      referenceEventId: "event-2",
      tier: "CONTROL",
      ev: "-0.020000",
      clv: "-0.010000",
      status: "LOST",
      profit: "-1.0000",
    }),
  ], PAPER_COLUMNS);
  await writeCsv(join(reportsDir, "ws-live-feed-stats.csv"), [
    { observedAt: "2026-06-28T12:00:00Z", messageType: "score", seq: "", providerEventId: "live-1", bookmaker: "", markets: "", auditRows: "0", trainingRows: "0", closedRows: "0", rejectionReasons: "" },
  ], ["observedAt", "messageType", "seq", "providerEventId", "bookmaker", "markets", "auditRows", "trainingRows", "closedRows", "rejectionReasons"]);
  await writeCsv(join(reportsDir, "live-event-status.csv"), [
    { observedAt: "2026-06-28T12:00:00Z", providerEventId: "live-1", eventStatus: "live", homeScore: "0", awayScore: "0" },
  ], ["observedAt", "providerEventId", "eventStatus", "homeScore", "awayScore"]);

  let out = "";
  const code = await runCli(["profit-engine", "--bankroll=1000", "--max-stake=10"], {
    reportsDir,
    out: (text) => { out += text; },
    err: () => {},
    now: () => new Date("2026-06-28T13:00:00.000Z"),
    loadApiKey: async () => { throw new Error("must not load Odds-API.io key"); },
    loadTheOddsKey: async () => { throw new Error("must not load The Odds API key"); },
  });

  assert.equal(code, 0);
  assert.match(out, /Profit engine: RESEARCH_ONLY/u);
  assert.match(out, /Live market messages: 0/u);

  const rows = await readCsv(join(reportsDir, "profit-engine-report.csv"));
  assert.ok(rows.some((row) => row.scope === "capital" && row.key === "readiness" && row.value === "RESEARCH_ONLY"));
  assert.ok(rows.some((row) => row.scope === "live" && row.key === "marketMessageRows" && row.value === "0"));
  assert.ok(rows.some((row) => row.scope === "warning" && row.key === "LIVE_FEED_HAS_NO_MARKET_MESSAGES"));

  const json = JSON.parse(await readFile(join(reportsDir, "profit-engine-report.json"), "utf8"));
  assert.equal(json.generatedAt, "2026-06-28T13:00:00.000Z");
  assert.equal(json.capital.readiness, "RESEARCH_ONLY");
  assert.equal(json.live.marketMessageRows, 0);
});

