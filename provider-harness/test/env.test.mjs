import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadEnvFile, requireApiKey } from "../src/env.mjs";

test("loads simple environment values and ignores comments", async () => {
  const directory = await mkdtemp(join(tmpdir(), "odds-env-"));
  const path = join(directory, ".env.local");
  await writeFile(path, "# local secret\nODDS_API_IO_KEY=secret-value\nOTHER=x\n");

  const env = await loadEnvFile(path);

  assert.equal(env.ODDS_API_IO_KEY, "secret-value");
  assert.equal(env.OTHER, "x");
});

test("requires a non-empty API key without leaking supplied values", () => {
  assert.throws(
    () => requireApiKey({ ODDS_API_IO_KEY: "   " }),
    /ODDS_API_IO_KEY is missing from \.env\.local/,
  );

  const key = "sensitive-value";
  try {
    requireApiKey({});
  } catch (error) {
    assert.doesNotMatch(error.message, new RegExp(key));
  }
});
