import assert from "node:assert/strict";
import test from "node:test";

import { matchFixtures, normalizeTeamName } from "../src/match.mjs";

test("normalizes accents, punctuation, and national-team aliases", () => {
  assert.equal(normalizeTeamName("Korea Republic"), normalizeTeamName("South Korea"));
  assert.equal(normalizeTeamName("Bosnia & Herzegovina"), normalizeTeamName("Bosnia and Herzegovina"));
  assert.equal(normalizeTeamName("Côte d'Ivoire"), normalizeTeamName("Ivory Coast"));
  assert.equal(normalizeTeamName("Türkiye"), normalizeTeamName("Turkey"));
});

test("matches same fixture across providers and rejects mismatches", () => {
  const reference = [
    { eventId: "ref1", homeTeam: "South Korea", awayTeam: "Bosnia & Herzegovina", kickoffUtc: "2026-06-25T18:00:00.000Z" },
    { eventId: "ref2", homeTeam: "Spain", awayTeam: "Cape Verde", kickoffUtc: "2026-06-25T21:00:00.000Z" },
  ];
  const bettable = [
    { eventId: "bet1", homeTeam: "Korea Republic", awayTeam: "Bosnia and Herzegovina", kickoffUtc: "2026-06-25T18:00:30.000Z" },
    { eventId: "betX", homeTeam: "Cape Verde", awayTeam: "Spain", kickoffUtc: "2026-06-25T21:00:00.000Z" },
  ];

  const pairs = matchFixtures(reference, bettable, { toleranceSeconds: 120 });
  assert.equal(pairs.length, 1);
  assert.deepEqual(pairs[0], {
    referenceEventId: "ref1",
    bettableEventId: "bet1",
    homeTeam: "South Korea",
    awayTeam: "Bosnia & Herzegovina",
    kickoffUtc: "2026-06-25T18:00:00.000Z",
  });
});

test("rejects matches outside the kickoff tolerance", () => {
  const reference = [{ eventId: "r", homeTeam: "Spain", awayTeam: "Cape Verde", kickoffUtc: "2026-06-25T18:00:00.000Z" }];
  const bettable = [{ eventId: "b", homeTeam: "Spain", awayTeam: "Cape Verde", kickoffUtc: "2026-06-25T18:10:00.000Z" }];
  assert.equal(matchFixtures(reference, bettable, { toleranceSeconds: 120 }).length, 0);
});
