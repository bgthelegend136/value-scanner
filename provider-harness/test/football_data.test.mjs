import assert from "node:assert/strict";
import test from "node:test";

import { createFootballDataClient } from "../src/football_data_client.mjs";
import { fdCompetitionFor, synthesizeFdScoreEvents } from "../src/football_data_settle.mjs";

const fdMatch = (home, away, h, a, date, status = "FINISHED") => ({
  status,
  utcDate: `${date}T19:00:00Z`,
  homeTeam: { name: home },
  awayTeam: { name: away },
  score: { fullTime: { home: h, away: a } },
});

test("fdCompetitionFor maps free-tier soccer keys and ignores the rest", () => {
  assert.equal(fdCompetitionFor("soccer_fifa_world_cup"), "WC");
  assert.equal(fdCompetitionFor("soccer_epl"), "PL");
  assert.equal(fdCompetitionFor("baseball_mlb"), null);
  assert.equal(fdCompetitionFor("soccer_league_of_ireland"), null);
});

test("synthesize matches by names + date, keyed by referenceEventId", () => {
  const rows = [{ referenceEventId: "wc1", homeTeam: "Senegal", awayTeam: "Iraq", kickoffUtc: "2026-06-26T19:00:00Z" }];
  const events = synthesizeFdScoreEvents(rows, [fdMatch("Senegal", "Iraq", 5, 0, "2026-06-26")]);
  assert.deepEqual(events, [{
    id: "wc1", completed: true, home_team: "Senegal", away_team: "Iraq",
    scores: [{ name: "Senegal", score: "5" }, { name: "Iraq", score: "0" }],
  }]);
});

test("normalizes accents/punctuation and falls back to unique names when date differs", () => {
  const rows = [{ referenceEventId: "e1", homeTeam: "Cote d'Ivoire", awayTeam: "Sao Paulo", kickoffUtc: "2026-06-20T00:00:00Z" }];
  const events = synthesizeFdScoreEvents(rows, [fdMatch("Côte d’Ivoire", "São Paulo", 2, 1, "2026-06-21")]);
  assert.equal(events.length, 1);
  assert.equal(events[0].scores[0].score, "2");
});

test("skips unmatched, non-finished, and ambiguous (team plays twice, no date match)", () => {
  const ambiguous = [{ referenceEventId: "x", homeTeam: "Brazil", awayTeam: "Japan", kickoffUtc: "2026-07-01T00:00:00Z" }];
  const twice = [fdMatch("Brazil", "Japan", 1, 0, "2026-06-10"), fdMatch("Brazil", "Japan", 2, 2, "2026-06-20")];
  assert.equal(synthesizeFdScoreEvents(ambiguous, twice).length, 0);

  const inPlay = [{ referenceEventId: "y", homeTeam: "A", awayTeam: "B", kickoffUtc: "2026-06-10T00:00:00Z" }];
  assert.equal(synthesizeFdScoreEvents(inPlay, [fdMatch("A", "B", 1, 0, "2026-06-10", "IN_PLAY")]).length, 0);
});

test("client sends X-Auth-Token, returns matches, and reads the throttle header", async () => {
  let captured;
  const fetchImpl = async (url, opts) => {
    captured = { url, opts };
    return {
      ok: true, status: 200,
      headers: { get: (h) => (h === "x-requests-available-minute" ? "7" : null) },
      json: async () => ({ matches: [{ status: "FINISHED" }] }),
    };
  };
  const client = createFootballDataClient({ apiKey: "sekret", fetchImpl });
  const result = await client.listFinishedMatches({ competition: "WC" });
  assert.match(captured.url, /competitions\/WC\/matches\?status=FINISHED/);
  assert.equal(captured.opts.headers["X-Auth-Token"], "sekret");
  assert.equal(result.requestsAvailableMinute, 7);
  assert.equal(result.matches.length, 1);
});

test("client throws on non-200 without leaking the key", async () => {
  const fetchImpl = async () => ({ ok: false, status: 429, headers: { get: () => "0" }, json: async () => ({}) });
  const client = createFootballDataClient({ apiKey: "sekret", fetchImpl });
  await assert.rejects(
    () => client.listFinishedMatches({ competition: "WC" }),
    (e) => /HTTP 429/.test(e.message) && !/sekret/.test(e.message),
  );
});
