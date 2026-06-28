import assert from "node:assert/strict";
import test from "node:test";

import {
  calibrationCsvRows,
  clubNameMatches,
  collectHistoricalCalibrationRows,
  filterFinishedMatches,
  findHistoricalEventForMatch,
  scoreCalibrationRows,
  snapshotIsoForKickoff,
  snapshotSpecsFromArg,
} from "../scripts/historical-calibration.mjs";

function event(eventId, kickoffUtc, method, probabilities, actualOutcome) {
  return { eventId, kickoffUtc, method, probabilities, actualOutcome };
}

test("historical calibration scores methods on a temporal out-of-sample split", () => {
  const rows = [
    event("a", "2025-08-01T14:00:00Z", "power", { 1: 0.72, X: 0.18, 2: 0.10 }, "1"),
    event("b", "2025-08-02T14:00:00Z", "power", { 1: 0.20, X: 0.20, 2: 0.60 }, "2"),
    event("c", "2025-08-03T14:00:00Z", "power", { 1: 0.70, X: 0.20, 2: 0.10 }, "1"),
    event("d", "2025-08-04T14:00:00Z", "power", { 1: 0.22, X: 0.58, 2: 0.20 }, "X"),
    event("a", "2025-08-01T14:00:00Z", "multiplicative", { 1: 0.34, X: 0.33, 2: 0.33 }, "1"),
    event("b", "2025-08-02T14:00:00Z", "multiplicative", { 1: 0.34, X: 0.33, 2: 0.33 }, "2"),
    event("c", "2025-08-03T14:00:00Z", "multiplicative", { 1: 0.34, X: 0.33, 2: 0.33 }, "1"),
    event("d", "2025-08-04T14:00:00Z", "multiplicative", { 1: 0.34, X: 0.33, 2: 0.33 }, "X"),
  ];

  const report = scoreCalibrationRows(rows, { bins: 5 });
  const power = report.methods.find((item) => item.method === "power");
  const flat = report.methods.find((item) => item.method === "multiplicative");

  assert.equal(power.train.events, 2);
  assert.equal(power.validate.events, 2);
  assert.equal(power.validate.outcomeRows, 6);
  assert.ok(power.validate.brier < flat.validate.brier);
  assert.ok(Number.isFinite(power.validate.logLoss));
  assert.ok(Number.isFinite(power.validate.baselineLogLoss));
  assert.equal(power.validate.reliability.reduce((sum, bin) => sum + bin.count, 0), 6);
});

test("historical calibration helpers filter finished outcome coverage and pick pre-kickoff snapshots", () => {
  const matches = filterFinishedMatches([
    {
      utcDate: "2025-08-16T15:00:00Z",
      status: "FINISHED",
      homeTeam: { name: "Liverpool" },
      awayTeam: { name: "Bournemouth" },
      score: { fullTime: { home: 2, away: 0 } },
    },
    {
      utcDate: "2025-08-17T15:00:00Z",
      status: "TIMED",
      homeTeam: { name: "Arsenal" },
      awayTeam: { name: "Chelsea" },
      score: { fullTime: { home: null, away: null } },
    },
  ], { from: "2025-08-01", to: "2025-08-31" });

  assert.equal(matches.length, 1);
  assert.equal(matches[0].actualOutcome, "1");
  assert.equal(snapshotIsoForKickoff("2025-08-16T15:00:00Z", 5), "2025-08-16T14:55:00Z");
});

test("clubNameMatches accepts prefix/suffix spelling variants but keeps distinct clubs apart", () => {
  // Real spelling differences seen in La Liga 2025/26 (FD vs The Odds API).
  assert.ok(clubNameMatches("Deportivo Alavés", "Alavés"));
  assert.ok(clubNameMatches("Levante UD", "Levante"));
  assert.ok(clubNameMatches("FC Barcelona", "Barcelona"));
  assert.ok(clubNameMatches("Real Madrid CF", "Real Madrid"));
  // Must NOT collapse two different clubs that share only a generic token.
  assert.ok(!clubNameMatches("Real Madrid", "Real Sociedad"));
  assert.ok(!clubNameMatches("Athletic Bilbao", "Athletic Club"));
  assert.ok(!clubNameMatches("", "Barcelona"));
});

test("findHistoricalEventForMatch pairs FD matches to snapshot events by tolerant name + day, failing closed on ambiguity", () => {
  const events = [
    { home_team: "Alavés", away_team: "Levante", commence_time: "2025-08-16T19:30:00Z" },
    { home_team: "Valencia", away_team: "Real Sociedad", commence_time: "2025-08-16T19:30:00Z" },
  ];
  const match = { homeTeam: "Deportivo Alavés", awayTeam: "Levante UD", kickoffUtc: "2025-08-16T19:30:00Z" };
  assert.equal(findHistoricalEventForMatch(events, match)?.home_team, "Alavés");
  // Wrong day → no pairing.
  assert.equal(findHistoricalEventForMatch(events, { ...match, kickoffUtc: "2025-08-17T19:30:00Z" }), null);
});

test("historical calibration CSV rows flatten validation metrics and reliability bins", () => {
  const report = scoreCalibrationRows([
    event("a", "2025-08-01T14:00:00Z", "power", { 1: 0.60, X: 0.25, 2: 0.15 }, "1"),
    event("b", "2025-08-02T14:00:00Z", "power", { 1: 0.25, X: 0.20, 2: 0.55 }, "2"),
  ], { bins: 2 });

  const rows = calibrationCsvRows(report);
  assert.ok(rows.some((row) => row.rowType === "summary" && row.method === "power"));
  assert.ok(rows.some((row) => row.rowType === "reliability" && row.method === "power"));
});

function historicalOddsEvent(id = "hist-1") {
  const book = (key, home, draw, away) => ({
    key,
    title: key,
    markets: [{
      key: "h2h",
      outcomes: [
        { name: "Japan", price: home },
        { name: "Sweden", price: away },
        { name: "Draw", price: draw },
      ],
    }],
  });
  return {
    id,
    commence_time: "2025-08-16T15:00:00Z",
    home_team: "Japan",
    away_team: "Sweden",
    bookmakers: [
      book("pinnacle", 2.00, 3.40, 3.80),
      book("betsson", 2.02, 3.35, 3.70),
      book("unibet", 1.98, 3.45, 3.75),
      book("williamhill", 2.01, 3.38, 3.72),
    ],
  };
}

test("multi-snapshot historical collection reuses historical event ids and labels snapshots", async () => {
  const calls = [];
  const matches = [{
    matchId: "fd-1",
    kickoffUtc: "2025-08-16T15:00:00Z",
    homeTeam: "Japan",
    awayTeam: "Sweden",
    actualOutcome: "1",
  }];
  const oddsClient = {
    async getHistoricalEvents(args) {
      calls.push(["events", args]);
      return { data: { data: [{ id: "hist-1", home_team: "Japan", away_team: "Sweden", commence_time: "2025-08-16T15:00:00Z" }] } };
    },
    async getHistoricalEventOdds(args) {
      calls.push(["eventOdds", args]);
      return {
        data: { timestamp: args.date, data: historicalOddsEvent(args.eventId) },
        receivedAt: args.date,
        quota: { lastCost: 10, remaining: 19000 },
      };
    },
  };

  const result = await collectHistoricalCalibrationRows({
    matches,
    oddsClient,
    sportKey: "soccer_spain_la_liga",
    regions: "eu",
    markets: "h2h",
    snapshots: snapshotSpecsFromArg("24h,10m"),
    maxCredits: 100,
  });

  assert.equal(calls.filter((call) => call[0] === "events").length, 1);
  assert.deepEqual(
    calls.filter((call) => call[0] === "eventOdds").map((call) => call[1].eventId),
    ["hist-1", "hist-1"],
  );
  assert.deepEqual([...new Set(result.rows.map((row) => row.snapshotLabel))], ["24h", "10m"]);
  assert.equal(result.meta.creditsSpent, 20);
  assert.equal(result.meta.stoppedByCreditCap, false);
});

test("multi-snapshot historical collection stops before exceeding max credits", async () => {
  let eventOddsCalls = 0;
  const result = await collectHistoricalCalibrationRows({
    matches: [{
      matchId: "fd-1",
      kickoffUtc: "2025-08-16T15:00:00Z",
      homeTeam: "Japan",
      awayTeam: "Sweden",
      actualOutcome: "1",
    }],
    oddsClient: {
      async getHistoricalEvents() {
        return { data: { data: [{ id: "hist-1", home_team: "Japan", away_team: "Sweden", commence_time: "2025-08-16T15:00:00Z" }] } };
      },
      async getHistoricalEventOdds(args) {
        eventOddsCalls += 1;
        return {
          data: { timestamp: args.date, data: historicalOddsEvent(args.eventId) },
          receivedAt: args.date,
          quota: { lastCost: 10, remaining: 19000 },
        };
      },
    },
    sportKey: "soccer_spain_la_liga",
    regions: "eu",
    markets: "h2h",
    snapshots: snapshotSpecsFromArg("24h,10m"),
    maxCredits: 10,
  });

  assert.equal(eventOddsCalls, 1);
  assert.equal(result.meta.creditsSpent, 10);
  assert.equal(result.meta.stoppedByCreditCap, true);
  assert.equal(result.rows.every((row) => row.market === undefined), true);
});

test("multi-snapshot historical collection stops when the quota reserve is reached", async () => {
  let eventOddsCalls = 0;
  const result = await collectHistoricalCalibrationRows({
    matches: [{
      matchId: "fd-1",
      kickoffUtc: "2025-08-16T15:00:00Z",
      homeTeam: "Japan",
      awayTeam: "Sweden",
      actualOutcome: "1",
    }],
    oddsClient: {
      async getHistoricalEvents() {
        return { data: { data: [{ id: "hist-1", home_team: "Japan", away_team: "Sweden", commence_time: "2025-08-16T15:00:00Z" }] } };
      },
      async getHistoricalEventOdds(args) {
        eventOddsCalls += 1;
        return {
          data: { timestamp: args.date, data: historicalOddsEvent(args.eventId) },
          receivedAt: args.date,
          quota: { lastCost: 10, remaining: 1999 },
        };
      },
    },
    sportKey: "soccer_spain_la_liga",
    regions: "eu",
    markets: "h2h",
    snapshots: snapshotSpecsFromArg("24h,10m"),
    maxCredits: 100,
    reserveCredits: 2000,
  });

  assert.equal(eventOddsCalls, 1);
  assert.equal(result.meta.quotaRemaining, 1999);
  assert.equal(result.meta.stoppedByReserve, true);
});
