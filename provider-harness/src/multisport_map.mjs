import { readFile } from "node:fs/promises";

const KEY_PATTERN = /^[a-z0-9-]+\|[a-z0-9-]+$/u;

const LEAGUE_TITLE_ALIASES = new Map([
  ["basketball|puerto-rico-bsn", ["BSN", "Baloncesto Superior Nacional"]],
  ["football|brazil-brasileiro-serie-a", ["Brazil Serie A", "Brazil Série A"]],
  ["football|ireland-premier-division", ["League of Ireland", "Airtricity League Premier Division"]],
  ["football|international-clubs-club-friendly-games", ["Club Friendlies", "Club Friendly Games"]],
  ["football|australia-victoria-npl-women", ["Victoria NPL Women", "NPL Victoria Women"]],
  ["football|australia-u20-victoria-npl-women", ["U20 Victoria NPL Women", "Victoria NPL U20 Women"]],
]);

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

function exactTitleMatch(candidateName, referenceTitle) {
  const candidateFull = normalized(candidateName);
  const referenceFull = normalized(referenceTitle);
  const candidateParts = nameParts(candidateName);
  const referenceParts = nameParts(referenceTitle);

  return candidateFull === referenceFull ||
    candidateParts.at(-1) === referenceFull ||
    referenceParts.at(-1) === candidateFull ||
    sameParts(candidateParts, referenceParts);
}

function leagueTitleVariants(candidate) {
  const registryKey = `${candidate.sportSlug}|${candidate.leagueSlug}`;
  const values = [
    candidate.leagueName,
    candidate.leagueSlug,
    ...(LEAGUE_TITLE_ALIASES.get(registryKey) ?? []),
  ];
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function exactLeagueTitleMatch(candidate, referenceSport) {
  return leagueTitleVariants(candidate).some((candidateName) =>
    exactTitleMatch(candidateName, referenceSport.title),
  );
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
