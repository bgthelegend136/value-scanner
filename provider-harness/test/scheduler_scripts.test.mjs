import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("production installer registers three daily triggers and prevents overlapping runs", async () => {
  const source = await readFile(
    new URL("../scripts/install-mispricing-task.ps1", import.meta.url),
    "utf8",
  );

  for (const time of ["09:00", "15:00", "21:00"]) {
    assert.match(source, new RegExp(`-At '${time}'`));
  }
  assert.doesNotMatch(source, /-At '13:00'|-At '17:00'/);
  assert.match(source, /Bet-Mispricing-Scanner/);
  assert.match(source, /MultipleInstances IgnoreNew/);
  assert.match(source, /-StartWhenAvailable\b(?!\s+\$)/);
  assert.match(source, /-WakeToRun\b(?!\s+\$)/);
  assert.match(source, /Register-ScheduledTask/);
  assert.match(source, /Disable-ScheduledTask.+Bet-Mispricing-Funnel/s);
  assert.match(source, /\.env\.local/);
  assert.match(source, /TELEGRAM_BOT_TOKEN/);
  assert.match(source, /TELEGRAM_CHAT_ID/);
  assert.match(source, /rev-parse --git-common-dir/);
  assert.match(source, /throw "Missing required scheduler configuration/);
});

test("production runner invokes mispricing-scan and writes a transcript log", async () => {
  const source = await readFile(
    new URL("../scripts/run-mispricing-scan.ps1", import.meta.url),
    "utf8",
  );

  assert.match(source, /node src[\\/]cli\.mjs mispricing-scan/);
  assert.match(source, /reports[\\/]logs/);
  assert.match(source, /Start-Transcript/);
  assert.match(source, /mispricing-scan exited with code/);
  assert.doesNotMatch(source, /TELEGRAM_BOT_TOKEN|TELEGRAM_CHAT_ID/);
});
