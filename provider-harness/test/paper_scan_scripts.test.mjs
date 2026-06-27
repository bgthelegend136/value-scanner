import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("paper-scan runner runs scan only and writes a transcript log", async () => {
  const source = await readFile(
    new URL("../scripts/run-paper-scan.ps1", import.meta.url),
    "utf8",
  );

  assert.match(source, /node src[\\/]cli\.mjs scan --edge=0 --sample-min-ev=-5 --sample-limit=250\b/);
  assert.doesNotMatch(source, /node src[\\/]cli\.mjs scan[^\r\n]*--sample-repeat/);
  assert.doesNotMatch(source, /node src[\\/]cli\.mjs clv/);
  assert.match(source, /reports[\\/]logs/);
  assert.match(source, /Start-Transcript/);
  assert.match(source, /scan exited with code/);
  // Paper path is Telegram-free.
  assert.doesNotMatch(source, /TELEGRAM_BOT_TOKEN|TELEGRAM_CHAT_ID|mispricing-scan/);
});

test("paper-scan installer repeats hourly without a 3-day auto-stop and needs no Telegram keys", async () => {
  const source = await readFile(
    new URL("../scripts/install-paper-scan-task.ps1", import.meta.url),
    "utf8",
  );

  assert.match(source, /Bet-Paper-Scan/);
  assert.match(source, /run-paper-scan\.ps1/);
  assert.match(source, /-RepetitionInterval/);
  assert.match(source, /New-TimeSpan -Hours 1/);
  assert.doesNotMatch(source, /New-TimeSpan -Days 3\b/);
  assert.doesNotMatch(source, /StopAtDurationEnd/);
  assert.match(source, /-Once\b/);
  assert.match(source, /MultipleInstances IgnoreNew/);
  assert.match(source, /-StartWhenAvailable\b(?!\s+\$)/);
  assert.match(source, /Register-ScheduledTask/);
  assert.match(source, /ODDS_API_IO_KEY/);
  assert.match(source, /THE_ODDS_API_KEY/);
  assert.match(source, /rev-parse --git-common-dir/);
  assert.match(source, /throw "Missing required scheduler configuration/);
  // Paper path must not demand Telegram keys.
  assert.doesNotMatch(source, /TELEGRAM_BOT_TOKEN|TELEGRAM_CHAT_ID/);
});
