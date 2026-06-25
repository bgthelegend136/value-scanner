import { readFile } from "node:fs/promises";

const KEY_PATTERN = /^[a-z0-9-]+\|[a-z0-9-]+$/u;

function normalized(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "");
}

function canonicalSport(value) {
  const sport = normalized(value);
  return sport === "football" ? "soccer" : sport;
}

function nameParts(value) {
  return String(value ?? "")
    .split(/\s+-\s+/u)
    .map(normalized)
    .filter(Boolean);
}

function sameParts(left, right) {
  if (left.length !== right.length) return false;
  const leftSorted = [...left].sort();
  const rightSorted = [...right].sort();
  return leftSorted.every((value, index) => value === rightSorted[index]);
}

function exactLeagueTitleMatch(candidate, referenceSport) {
  const candidateName = candidate.leagueName || candidate.leagueSlug;
  const candidateFull = normalized(candidateName);
  const referenceFull = normalized(referenceSport.title);
  const candidateParts = nameParts(candidateName);
  const referenceParts = nameParts(referenceSport.title);

  return candidateFull === referenceFull ||
    candidateParts.at(-1) === referenceFull ||
    referenceParts.at(-1) === candidateFull ||
    sameParts(candidateParts, referenceParts);
}

function inferActiveSportKey(candidate, activeSports) {
  const candidateSport = canonicalSport(candidate.sportName || candidate.sportSlug);
  const matches = (activeSports ?? []).filter((sport) =>
    sport.active !== false &&
    canonicalSport(sport.group) === candidateSport &&
    exactLeagueTitleMatch(candidate, sport),
  );
  return matches.length === 1 ? String(matches[0].key) : "";
}

export async function loadSportRegistry(path) {
  const parsed = JSON.parse(await readFile(path, "utf8"));
  const entries = Object.entries(parsed);
  for (const [key, value] of entries) {
    if (!KEY_PATTERN.test(key)) throw new Error(`invalid sport registry key: ${key}`);
    if (!/^[a-z0-9_]+$/u.test(String(value))) {
      throw new Error(`invalid reference sport key for ${key}`);
    }
  }
  return new Map(entries);
}

export function resolveSportKey(candidate, registry, activeSportKeys, activeSports = []) {
  const key = `${candidate.sportSlug}|${candidate.leagueSlug}`;
  const sportKey = registry.get(key);
  if (sportKey && !activeSportKeys.has(sportKey)) {
    return { sportKey: "", reason: "INACTIVE_REFERENCE_SPORT" };
  }
  if (sportKey) return { sportKey, reason: "" };

  const inferred = inferActiveSportKey(candidate, activeSports);
  return inferred
    ? { sportKey: inferred, reason: "" }
    : { sportKey: "", reason: "UNMAPPED_SPORT_LEAGUE" };
}
