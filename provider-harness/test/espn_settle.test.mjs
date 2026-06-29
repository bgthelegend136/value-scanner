import assert from "node:assert/strict";
import test from "node:test";

import { settlePaperBets } from "../src/paper.mjs";
import {
  espnLeagueFor,
  espnSettlementTargets,
  parseEspnScoreboard,
  synthesizeEspnScoreEvents,
} from "../src/espn_settle.mjs";

const scoreboard = (events) => events.map((e) => ({
  date: e.date,
  status: { type: { completed: e.completed ?? true, state: e.completed === false ? "pre" : "post" } },
  competitions: [{
    competitors: [
      { homeAway: "home", team: { displayName: e.home }, score: e.homeScore },
      { homeAway: "away", team: { displayName: e.away }, score: e.awayScore },
    ],
  }],
}));

const pendingRow = (over = {}) => ({
  referenceEventId: "evt-1",
  bettableEventId: "b-1",
  firstSeenAt: "2026-06-20T10:00:00Z",
  kickoffUtc: "2026-06-21T00:00:00Z",
  homeTeam: "Buffalo Bills",
  awayTeam: "Miami Dolphins",
  bookmaker: "Stoiximan",
  market: "MATCH_RESULT",
  line: "",
  outcome: "1",
  decimalOdds: "2.0000",
  fairOdds: "1.9000",
  fairProbability: "0.526316",
  ev: "0.052632",
  tier: "VALUE",
  stake: "1.00",
  status: "PENDING",
  homeScore: "",
  awayScore: "",
  profit: "",
  settledAt: "",
  closingFairOdds: "",
  clv: "",
  clvCapturedAt: "",
  sportKey: "americanfootball_nfl",
  ...over,
});

test("maps known sport keys to ESPN league paths and rejects unknown", () => {
  assert.equal(espnLeagueFor("americanfootball_nfl"), "football/nfl");
  assert.equal(espnLeagueFor("soccer_conmebol_copa_libertadores"), "soccer/conmebol.libertadores");
  assert.equal(espnLeagueFor("cricket_t20_blast"), null);
  assert.equal(espnLeagueFor("boxing_boxing"), null);
});

test("settlement targets are distinct league+date triples around the kickoff", () => {
  const targets = espnSettlementTargets([pendingRow(), pendingRow({ referenceEventId: "evt-2" })]);
  // one league, one kickoff date -> the ±1 day window = 3 dates, deduped across rows
  assert.deepEqual(
    targets.map((t) => `${t.leaguePath}|${t.date}`).sort(),
    ["football/nfl|20260620", "football/nfl|20260621", "football/nfl|20260622"],
  );
});

test("parses ESPN scoreboard competitors and completion state", () => {
  const parsed = parseEspnScoreboard(scoreboard([
    { date: "2026-06-21", home: "Buffalo Bills", away: "Miami Dolphins", homeScore: "24", awayScore: "17" },
    { date: "2026-06-21", home: "X", away: "Y", homeScore: "0", awayScore: "0", completed: false },
  ]));
  assert.equal(parsed.length, 2);
  assert.deepEqual(parsed[0], {
    date: "2026-06-21", completed: true, home: "Buffalo Bills", away: "Miami Dolphins",
    homeScore: 24, awayScore: 17,
  });
  assert.equal(parsed[1].completed, false);
});

test("synthesizes score events by names+date and settles them through settlePaperBets", () => {
  const rows = [pendingRow()];
  const parsed = parseEspnScoreboard(scoreboard([
    { date: "2026-06-21", home: "Buffalo Bills", away: "Miami Dolphins", homeScore: "24", awayScore: "17" },
  ]));
  const events = synthesizeEspnScoreEvents(rows, parsed);
  assert.equal(events.length, 1);
  const settled = settlePaperBets(rows, events);
  assert.equal(settled[0].status, "WON"); // backed home ("1"), home won 24-17
  assert.equal(settled[0].homeScore, "24");
});

test("ignores unfinished events and leaves unmatched bets pending", () => {
  const rows = [pendingRow()];
  const parsedIncomplete = parseEspnScoreboard(scoreboard([
    { date: "2026-06-21", home: "Buffalo Bills", away: "Miami Dolphins", homeScore: "0", awayScore: "0", completed: false },
  ]));
  assert.deepEqual(synthesizeEspnScoreEvents(rows, parsedIncomplete), []);

  const parsedOtherTeams = parseEspnScoreboard(scoreboard([
    { date: "2026-06-21", home: "Dallas Cowboys", away: "New York Giants", homeScore: "10", awayScore: "7" },
  ]));
  assert.deepEqual(synthesizeEspnScoreEvents(rows, parsedOtherTeams), []);
});
