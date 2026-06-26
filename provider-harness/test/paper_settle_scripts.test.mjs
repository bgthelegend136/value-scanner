import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("paper-settle runner runs settle and writes a transcript log", async () => {
  const source = await readFile(
    new URL("../scripts/run-paper-settle.ps1", import.meta.url),
    "utf8",
  );

  assert.match(source, /node src[\\/]cli\.mjs settle/);
  assert.match(source, /node src[\\/]cli\.mjs mispricing-settle/);
  assert.match(source, /reports[\\/]logs/);
  assert.match(source, /paper-settle-\$Stamp\.log/);
  assert.match(source, /Start-Transcript/);
  assert.match(source, /settle exited with code/);
  assert.match(source, /mispricing-settle exited with code/);
  assert.doesNotMatch(source, /TELEGRAM_BOT_TOKEN|TELEGRAM_CHAT_ID|ODDS_API_IO_KEY|mispricing-scan/);
});

test("paper-settle installer runs daily and needs only The Odds API key", async () => {
  const source = await readFile(
    new URL("../scripts/install-paper-settle-task.ps1", import.meta.url),
    "utf8",
  );

  assert.match(source, /Bet-Paper-Settle/);
  assert.match(source, /run-paper-settle\.ps1/);
  assert.match(source, /New-ScheduledTaskTrigger -Daily -At '07:30'/);
  assert.match(source, /MultipleInstances IgnoreNew/);
  assert.match(source, /-StartWhenAvailable\b(?!\s+\$)/);
  assert.match(source, /Register-ScheduledTask/);
  assert.match(source, /THE_ODDS_API_KEY/);
  assert.match(source, /rev-parse --git-common-dir/);
  assert.match(source, /throw "Missing required scheduler configuration/);
  assert.doesNotMatch(source, /ODDS_API_IO_KEY|TELEGRAM_BOT_TOKEN|TELEGRAM_CHAT_ID/);
});
