import assert from "node:assert/strict";
import test from "node:test";

import { buildProfitEngineReport } from "../src/profit_engine.mjs";

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
    status: "PENDING",
    homeScore: "",
    awayScore: "",
    profit: "",
    settledAt: "",
    closingFairOdds: "1.9417",
    clv: "0.030000",
    clvCapturedAt: "2026-06-28T17:40:00.000Z",
    sportKey: "soccer_fifa_world_cup",
    ...overrides,
  };
}

test("profit engine stays research-only when live feed has no market messages and samples are thin", () => {
  const report = buildProfitEngineReport({
    generatedAt: "2026-06-28T12:00:00.000Z",
    paperRows: [
      paperRow(),
      paperRow({
        referenceEventId: "event-2",
        tier: "CONTROL",
        ev: "-0.020000",
        clv: "-0.080000",
      }),
    ],
    liveFeedStatsRows: [
      { messageType: "welcome", trainingRows: "0", auditRows: "0", closedRows: "0" },
      { messageType: "score", trainingRows: "0", auditRows: "0", closedRows: "0" },
      { messageType: "status", trainingRows: "0", auditRows: "0", closedRows: "0" },
    ],
    liveStatusRows: [{ eventStatus: "live" }],
    liveTrainingRows: [],
    liveAuditRows: [],
    lifetimeRows: [],
    bankroll: 1000,
    maxStake: 10,
    kellyFraction: 0.25,
    stakeCapFraction: 0.02,
  });

  assert.equal(report.live.marketMessageRows, 0);
  assert.equal(report.live.trainingRows, 0);
  assert.equal(report.live.liquidityRows, 0);
  assert.equal(report.live.trainingConversionRate, null);
  assert.equal(report.paper.valueClvCaptured, 1);
  assert.equal(report.paper.controlClvCaptured, 1);
  assert.equal(report.signal.valueAverageClv, 0.03);
  assert.equal(report.signal.controlAverageClv, -0.08);
  assert.equal(report.signal.mainValueAverageClv, 0.03);
  assert.equal(report.capital.readiness, "RESEARCH_ONLY");
  assert.equal(report.capital.maxStake, 10);
  assert.ok(report.capital.sampleAverageStakeFraction > 0);
  assert.ok(report.warnings.includes("LIVE_FEED_HAS_NO_MARKET_MESSAGES"));
  assert.ok(report.warnings.includes("VALUE_CLV_BELOW_200"));
  assert.ok(report.warnings.includes("LIMITS_LIQUIDITY_NOT_MEASURED"));
  assert.equal(report.warnings.includes("MAIN_SIGNAL_NOT_POSITIVE"), false);
});

test("profit engine treats live maxBet rows as liquidity evidence", () => {
  const report = buildProfitEngineReport({
    generatedAt: "2026-06-28T12:00:00.000Z",
    paperRows: [paperRow()],
    liveFeedStatsRows: [
      { messageType: "updated", trainingRows: "1", auditRows: "1", closedRows: "0" },
    ],
    liveTrainingRows: [
      { sampleTier: "LIVE_VALUE", market: "MATCH_RESULT", maxBet: "250.0000" },
    ],
  });

  assert.equal(report.live.marketMessageRows, 1);
  assert.equal(report.live.trainingRows, 1);
  assert.equal(report.live.liquidityRows, 1);
  assert.equal(report.live.averageMaxBet, 250);
  assert.equal(report.warnings.includes("LIMITS_LIQUIDITY_NOT_MEASURED"), false);
});
