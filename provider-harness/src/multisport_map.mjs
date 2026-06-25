import { readFile } from "node:fs/promises";

const KEY_PATTERN = /^[a-z0-9-]+\|[a-z0-9-]+$/u;

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

export function resolveSportKey(candidate, registry, activeSportKeys) {
  const key = `${candidate.sportSlug}|${candidate.leagueSlug}`;
  const sportKey = registry.get(key);
  if (!sportKey) return { sportKey: "", reason: "UNMAPPED_SPORT_LEAGUE" };
  if (!activeSportKeys.has(sportKey)) {
    return { sportKey: "", reason: "INACTIVE_REFERENCE_SPORT" };
  }
  return { sportKey, reason: "" };
}
