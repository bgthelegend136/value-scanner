import assert from "node:assert/strict";
import test from "node:test";

import {
  matchCandidateEvent,
  normalizeParticipant,
  selectionKey,
} from "../src/mispricing_match.mjs";

test("normalizes team and player punctuation without changing participant order", () => {
  assert.equal(normalizeParticipant("Paris Saint-Germain FC"), "paris saint germain");
  assert.equal(normalizeParticipant("Daniil Medvedev"), "daniil medvedev");
});

test("matches one exact team event inside a sport", () => {
  const candidate = {
    participantOne: "Olympiacos",
    participantTwo: "Real Madrid",
    kickoffUtc: "2026-06-25T18:30:00Z",
  };
  const result = matchCandidateEvent(candidate, [
    {
      id: "ref-1",
      home_team: "Olympiacos",
      away_team: "Real Madrid",
      commence_time: "2026-06-25T18:30:30Z",
    },
  ]);
  assert.equal(result.event.id, "ref-1");
  assert.equal(result.reason, "");
});

test("matches head-to-head players only in the same orientation", () => {
  const candidate = {
    participantOne: "Jannik Sinner",
    participantTwo: "Daniil Medvedev",
    kickoffUtc: "2026-06-25T12:00:00Z",
  };
  const reversed = [{
    id: "tennis-1",
    home_team: "Daniil Medvedev",
    away_team: "Jannik Sinner",
    commence_time: "2026-06-25T12:00:00Z",
  }];
  assert.equal(matchCandidateEvent(candidate, reversed).reason, "NO_EVENT_MATCH");
});

test("rejects kickoff mismatch and ambiguous duplicate matches", () => {
  const candidate = {
    participantOne: "A",
    participantTwo: "B",
    kickoffUtc: "2026-06-25T12:00:00Z",
  };
  assert.equal(
    matchCandidateEvent(candidate, [{
      id: "late", home_team: "A", away_team: "B",
      commence_time: "2026-06-25T12:10:00Z",
    }]).reason,
    "NO_EVENT_MATCH",
  );
  const duplicate = [
    { id: "1", home_team: "A", away_team: "B", commence_time: "2026-06-25T12:00:00Z" },
    { id: "2", home_team: "A", away_team: "B", commence_time: "2026-06-25T12:00:20Z" },
  ];
  assert.equal(matchCandidateEvent(candidate, duplicate).reason, "AMBIGUOUS_EVENT_MATCH");
});

test("builds exact market keys including totals line", () => {
  assert.equal(
    selectionKey({ market: "TOTALS", line: "162.5", outcome: "OVER" }),
    "TOTALS|162.5|OVER",
  );
  assert.equal(
    selectionKey({ market: "MATCH_RESULT", line: "", outcome: "1" }),
    "MATCH_RESULT||1",
  );
});
