import assert from "node:assert/strict";
import { writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadSportRegistry, resolveSportKey } from "../src/multisport_map.mjs";

test("loads exact mappings and resolves only active sport keys", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sport-map-"));
  const path = join(dir, "map.json");
  await writeFile(path, JSON.stringify({
    "basketball|euroleague": "basketball_euroleague",
  }));
  const registry = await loadSportRegistry(path);
  const candidate = { sportSlug: "basketball", leagueSlug: "euroleague" };

  assert.deepEqual(
    resolveSportKey(candidate, registry, new Set(["basketball_euroleague"])),
    { sportKey: "basketball_euroleague", reason: "" },
  );
  assert.deepEqual(
    resolveSportKey(candidate, registry, new Set(["basketball_nba"])),
    { sportKey: "", reason: "INACTIVE_REFERENCE_SPORT" },
  );
});

test("does not fuzzy-match unknown leagues", () => {
  const registry = new Map([
    ["football|england-premier-league", "soccer_epl"],
  ]);
  assert.deepEqual(
    resolveSportKey(
      { sportSlug: "football", leagueSlug: "premier-league" },
      registry,
      new Set(["soccer_epl"]),
    ),
    { sportKey: "", reason: "UNMAPPED_SPORT_LEAGUE" },
  );
});

test("infers a unique active sport from exact normalized provider titles", () => {
  const activeSports = [
    { key: "americanfootball_nfl", group: "American Football", title: "NFL", active: true },
    { key: "soccer_italy_serie_a", group: "Soccer", title: "Serie A - Italy", active: true },
    { key: "soccer_sweden_superettan", group: "Soccer", title: "Superettan - Sweden", active: true },
  ];
  const activeKeys = new Set(activeSports.map((sport) => sport.key));

  assert.deepEqual(
    resolveSportKey(
      {
        sportSlug: "american-football",
        leagueSlug: "usa-nfl",
        sportName: "American Football",
        leagueName: "USA - NFL",
      },
      new Map(),
      activeKeys,
      activeSports,
    ),
    { sportKey: "americanfootball_nfl", reason: "" },
  );
  assert.deepEqual(
    resolveSportKey(
      {
        sportSlug: "football",
        leagueSlug: "italy-serie-a",
        sportName: "Football",
        leagueName: "Italy - Serie A",
      },
      new Map(),
      activeKeys,
      activeSports,
    ),
    { sportKey: "soccer_italy_serie_a", reason: "" },
  );
});

test("automatic mapping refuses non-exact and ambiguous league names", () => {
  const activeSports = [
    { key: "soccer_epl", group: "Soccer", title: "EPL", active: true },
    { key: "soccer_efl_champ", group: "Soccer", title: "Championship", active: true },
  ];
  const activeKeys = new Set(activeSports.map((sport) => sport.key));

  assert.deepEqual(
    resolveSportKey(
      {
        sportSlug: "football",
        leagueSlug: "england-premier-league",
        sportName: "Football",
        leagueName: "England - Premier League",
      },
      new Map(),
      activeKeys,
      activeSports,
    ),
    { sportKey: "", reason: "UNMAPPED_SPORT_LEAGUE" },
  );

  const duplicateTitles = [
    { key: "americanfootball_nfl_a", group: "American Football", title: "NFL", active: true },
    { key: "americanfootball_nfl_b", group: "American Football", title: "NFL", active: true },
  ];
  assert.deepEqual(
    resolveSportKey(
      {
        sportSlug: "american-football",
        leagueSlug: "usa-nfl",
        sportName: "American Football",
        leagueName: "USA - NFL",
      },
      new Map(),
      new Set(duplicateTitles.map((sport) => sport.key)),
      duplicateTitles,
    ),
    { sportKey: "", reason: "UNMAPPED_SPORT_LEAGUE" },
  );
});

test("rejects malformed registry keys", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sport-map-invalid-"));
  const path = join(dir, "map.json");
  await writeFile(path, JSON.stringify({ bad: "soccer_epl" }));
  await assert.rejects(() => loadSportRegistry(path), /invalid sport registry key/);
});

test("the shipped seed registry is valid and loadable", async () => {
  const seedPath = new URL("../config/multisport-map.json", import.meta.url);
  const registry = await loadSportRegistry(seedPath);
  assert.equal(registry.get("american-football|usa-nfl"), "americanfootball_nfl");
  assert.equal(
    registry.get("baseball|japan-professional-baseball-central-league"),
    "baseball_npb",
  );
  assert.equal(registry.get("football|england-premier-league"), "soccer_epl");
  for (const [key, value] of registry) {
    assert.match(key, /^[a-z0-9-]+\|[a-z0-9-]+$/u);
    assert.match(String(value), /^[a-z0-9_]+$/u);
  }
});
