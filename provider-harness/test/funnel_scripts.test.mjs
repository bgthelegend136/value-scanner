import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("installer registers the funnel task with four daily local-time triggers", async () => {
  const source = await readFile(
    new URL("../scripts/install-mispricing-funnel-task.ps1", import.meta.url),
    "utf8",
  );
  for (const time of ["09:00", "13:00", "17:00", "21:00"]) {
    assert.match(source, new RegExp(`-At '${time}'`));
  }
  assert.match(source, /Bet-Mispricing-Funnel/);
  assert.match(source, /MultipleInstances IgnoreNew/);
  // -StartWhenAvailable is a switch in Windows PowerShell 5.1: bare, no $true.
  assert.match(source, /-StartWhenAvailable\b(?!\s+\$)/);
  assert.match(source, /Register-ScheduledTask/);
});

test("runner invokes the funnel with --append-csv and logs a transcript", async () => {
  const source = await readFile(
    new URL("../scripts/run-mispricing-funnel.ps1", import.meta.url),
    "utf8",
  );
  assert.match(source, /node scripts[\\/]mispricing-funnel\.mjs --append-csv/);
  assert.match(source, /reports[\\/]logs/);
  assert.match(source, /Start-Transcript/);
});
