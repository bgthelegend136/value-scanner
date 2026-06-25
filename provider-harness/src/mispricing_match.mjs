// Event matching is market-agnostic. selectionKey supports both MATCH_RESULT and
// TOTALS keys (TOTALS is unused in v1 but the key format stays stable for v2).
const ALIASES = new Map([
  ["psg", "paris saint germain"],
  ["paris saint germain fc", "paris saint germain"],
  ["inter milan", "internazionale"],
  ["fc internazionale", "internazionale"],
]);

export function normalizeParticipant(value) {
  const normalized = String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\b(fc|cf|bc|basketball club)\b/gu, " ")
    .replace(/[^a-z0-9]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
  return ALIASES.get(normalized) ?? normalized;
}

export function matchCandidateEvent(
  candidate,
  referenceEvents,
  { toleranceSeconds = 120 } = {},
) {
  const kickoff = new Date(candidate.kickoffUtc).getTime();
  const one = normalizeParticipant(candidate.participantOne);
  const two = normalizeParticipant(candidate.participantTwo);
  const matches = (referenceEvents ?? []).filter((event) => {
    const referenceKickoff = new Date(event.commence_time).getTime();
    return Number.isFinite(referenceKickoff) &&
      Math.abs(referenceKickoff - kickoff) <= toleranceSeconds * 1000 &&
      normalizeParticipant(event.home_team) === one &&
      normalizeParticipant(event.away_team) === two;
  });
  if (matches.length === 0) return { event: null, reason: "NO_EVENT_MATCH" };
  if (matches.length > 1) return { event: null, reason: "AMBIGUOUS_EVENT_MATCH" };
  return { event: matches[0], reason: "" };
}

export function selectionKey({ market, line = "", outcome }) {
  return `${market}|${line}|${outcome}`;
}
