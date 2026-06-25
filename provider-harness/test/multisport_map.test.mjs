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

test("rejects malformed registry keys", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sport-map-invalid-"));
  const path = join(dir, "map.json");
  await writeFile(path, JSON.stringify({ bad: "soccer_epl" }));
  await assert.rejects(() => loadSportRegistry(path), /invalid sport registry key/);
});

test("the shipped seed registry is valid and loadable", async () => {
  const seedPath = new URL("../config/multisport-map.json", import.meta.url);
  const registry = await loadSportRegistry(seedPath);
  assert.ok(registry.size >= 1);
  for (const [key, value] of registry) {
    assert.match(key, /^[a-z0-9-]+\|[a-z0-9-]+$/u);
    assert.match(String(value), /^[a-z0-9_]+$/u);
  }
});
