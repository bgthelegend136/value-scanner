import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runCli } from "../src/cli.mjs";
import { readCsv, writeCsv } from "../src/csv.mjs";
import { PAPER_COLUMNS } from "../src/paper.mjs";

function paperRow(overrides = {}) {
  return {
    referenceEventId: "wc1", bettableEventId: "111", firstSeenAt: "2026-06-26T12:00:00.000Z",
    kickoffUtc: "2026-06-26T19:00:00.000Z", homeTeam: "Senegal", awayTeam: "Iraq",
    bookmaker: "Stoiximan", market: "MATCH_RESULT", line: "", outcome: "1",
    decimalOdds: "1.2100", fairOdds: "1.2500", fairProbability: "0.800000", ev: "0.020000",
    tier: "VALUE", stake: "1.00", status: "PENDING", homeScore: "", awayScore: "", profit: "",
    settledAt: "", closingFairOdds: "", clv: "", clvCapturedAt: "", sportKey: "soccer_fifa_world_cup",
    ...overrides,
  };
}

test("fd-settle settles soccer via football-data and leaves non-soccer pending", async () => {
  const reportsDir = await mkdtemp(join(tmpdir(), "fd-settle-"));
  await writeCsv(join(reportsDir, "paper-bets.csv"), [
    paperRow(), // World Cup, Senegal win, finished 5-0 -> WON
    paperRow({
      referenceEventId: "mlb1", bettableEventId: "222", homeTeam: "Yankees", awayTeam: "Red Sox",
      outcome: "1", sportKey: "baseball_mlb",
    }),
  ], PAPER_COLUMNS);

  const competitionsCalled = [];
  let out = "";
  const code = await runCli(["fd-settle"], {
    out: (t) => { out += t; },
    err: () => {},
    loadFootballDataKey: async () => "fd-secret",
    createFootballDataClient: ({ apiKey }) => {
      assert.equal(apiKey, "fd-secret");
      return {
        async listFinishedMatches({ competition }) {
          competitionsCalled.push(competition);
          return {
            requestsAvailableMinute: 9,
            matches: [{
              status: "FINISHED", utcDate: "2026-06-26T19:00:00Z",
              homeTeam: { name: "Senegal" }, awayTeam: { name: "Iraq" },
              score: { fullTime: { home: 5, away: 0 } },
            }],
          };
        },
      };
    },
    reportsDir,
    now: () => new Date("2026-06-26T22:00:00Z"),
  });

  assert.equal(code, 0);
  assert.deepEqual(competitionsCalled, ["WC"]); // only the WC competition, once
  assert.match(out, /requests available this minute: 9/);
  const rows = await readCsv(join(reportsDir, "paper-bets.csv"));
  assert.equal(rows.find((r) => r.referenceEventId === "wc1").status, "WON");
  assert.equal(rows.find((r) => r.referenceEventId === "mlb1").status, "PENDING"); // non-soccer untouched
  assert.doesNotMatch(out, /The Odds API quota/); // no Odds API credits spent
});
