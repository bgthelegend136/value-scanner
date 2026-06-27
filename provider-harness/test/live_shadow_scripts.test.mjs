import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("live-shadow runner invokes websocket probe in measurement-only live mode", async () => {
  const source = await readFile(
    new URL("../scripts/run-live-shadow-probe.ps1", import.meta.url),
    "utf8",
  );

  assert.match(source, /node scripts[\\/]ws-lifetime-probe\.mjs/);
  assert.match(source, /--live-shadow/);
  assert.match(source, /--live-training/);
  assert.match(source, /--live-training-min-ev=-5/);
  assert.match(source, /--status=live/);
  assert.match(source, /--channels=odds,scores,status/);
  assert.match(source, /--markets=ML,Totals/);
  assert.match(source, /--target-bookmakers=ALL/);
  assert.match(source, /--duration-minutes=120/);
  assert.match(source, /reports[\\/]logs/);
  assert.match(source, /live-shadow-\$Stamp\.log/);
  assert.match(source, /Start-Transcript/);
  assert.match(source, /live shadow probe exited with code/);
  assert.doesNotMatch(source, /TELEGRAM_BOT_TOKEN|TELEGRAM_CHAT_ID|mispricing-scan/);
});

test("live-shadow installer repeats every 2 hours and validates provider keys only", async () => {
  const source = await readFile(
    new URL("../scripts/install-live-shadow-task.ps1", import.meta.url),
    "utf8",
  );

  assert.match(source, /Bet-Live-Shadow/);
  assert.match(source, /run-live-shadow-probe\.ps1/);
  assert.match(source, /-RepetitionInterval/);
  assert.match(source, /New-TimeSpan -Hours 2/);
  assert.match(source, /-Once\b/);
  assert.match(source, /MultipleInstances IgnoreNew/);
  assert.match(source, /-StartWhenAvailable\b(?!\s+\$)/);
  assert.match(source, /-WakeToRun\b(?!\s+\$)/);
  assert.match(source, /Register-ScheduledTask/);
  assert.match(source, /ODDS_API_IO_KEY/);
  assert.match(source, /THE_ODDS_API_KEY/);
  assert.match(source, /rev-parse --git-common-dir/);
  assert.match(source, /throw "Missing required scheduler configuration/);
  assert.doesNotMatch(source, /TELEGRAM_BOT_TOKEN|TELEGRAM_CHAT_ID/);
});
