import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("paper-clv runner invokes clv and writes a transcript log", async () => {
  const source = await readFile(
    new URL("../scripts/run-paper-clv.ps1", import.meta.url),
    "utf8",
  );

  assert.match(source, /node src[\\/]cli\.mjs clv --window-minutes=40/);
  assert.match(source, /reports[\\/]logs/);
  assert.match(source, /paper-clv-\$Stamp\.log/);
  assert.match(source, /Start-Transcript/);
  assert.match(source, /clv exited with code/);
  assert.doesNotMatch(source, /TELEGRAM_BOT_TOKEN|TELEGRAM_CHAT_ID|ODDS_API_IO_KEY|mispricing-scan/);
});

test("paper-clv installer repeats every 10 minutes and needs only The Odds API key", async () => {
  const source = await readFile(
    new URL("../scripts/install-paper-clv-task.ps1", import.meta.url),
    "utf8",
  );

  assert.match(source, /Bet-Paper-CLV/);
  assert.match(source, /run-paper-clv\.ps1/);
  assert.match(source, /-RepetitionInterval/);
  assert.match(source, /New-TimeSpan -Minutes 10/);
  assert.match(source, /-Once\b/);
  assert.match(source, /MultipleInstances IgnoreNew/);
  assert.match(source, /-StartWhenAvailable\b(?!\s+\$)/);
  assert.match(source, /-WakeToRun\b(?!\s+\$)/);
  assert.match(source, /Register-ScheduledTask/);
  assert.match(source, /THE_ODDS_API_KEY/);
  assert.match(source, /rev-parse --git-common-dir/);
  assert.match(source, /throw "Missing required scheduler configuration/);
  assert.doesNotMatch(source, /ODDS_API_IO_KEY|TELEGRAM_BOT_TOKEN|TELEGRAM_CHAT_ID/);
});
