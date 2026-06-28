import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("production installer repeats every 15 minutes and prevents overlapping runs", async () => {
  const source = await readFile(
    new URL("../scripts/install-mispricing-task.ps1", import.meta.url),
    "utf8",
  );

  // Two-tier cadence: a frequent cheap detection pass, escalating only on a
  // fresh >=5% watchlist candidate (see runMispricingScan detection tier).
  assert.match(source, /-RepetitionInterval/);
  assert.match(source, /New-TimeSpan -Minutes 15/);
  assert.match(source, /-Once\b/);
  assert.doesNotMatch(source, /-At '09:00'|-At '15:00'|-At '21:00'/);
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

test("CLV installer registers a separate 15-minute task needing only the reference key", async () => {
  const source = await readFile(
    new URL("../scripts/install-mispricing-clv-task.ps1", import.meta.url),
    "utf8",
  );

  assert.match(source, /Bet-Mispricing-CLV/);
  assert.match(source, /run-mispricing-clv\.ps1/);
  assert.match(source, /-RepetitionInterval/);
  assert.match(source, /New-TimeSpan -Minutes 15/);
  assert.match(source, /-Once\b/);
  assert.match(source, /MultipleInstances IgnoreNew/);
  assert.match(source, /-StartWhenAvailable\b(?!\s+\$)/);
  assert.match(source, /-WakeToRun\b(?!\s+\$)/);
  assert.match(source, /Register-ScheduledTask/);
  assert.match(source, /THE_ODDS_API_KEY/);
  assert.match(source, /rev-parse --git-common-dir/);
  assert.match(source, /throw "Missing required scheduler configuration/);
  // CLV needs no Telegram, so it must not demand those keys.
  assert.doesNotMatch(source, /TELEGRAM_BOT_TOKEN|TELEGRAM_CHAT_ID/);
});

test("CLV runner invokes mispricing-clv and writes a transcript log", async () => {
  const source = await readFile(
    new URL("../scripts/run-mispricing-clv.ps1", import.meta.url),
    "utf8",
  );

  assert.match(source, /node src[\\/]cli\.mjs mispricing-clv/);
  assert.match(source, /reports[\\/]logs/);
  assert.match(source, /Start-Transcript/);
  assert.match(source, /mispricing-clv exited with code/);
  assert.doesNotMatch(source, /TELEGRAM_BOT_TOKEN|TELEGRAM_CHAT_ID/);
});
