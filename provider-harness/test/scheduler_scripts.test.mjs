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

test("Betsson POC installer repeats every thirty minutes with only The Odds API key", async () => {
  const source = await readFile(
    new URL("../scripts/install-betsson-poc-task.ps1", import.meta.url),
    "utf8",
  );

  assert.match(source, /Bet-Betsson-Poc/);
  assert.match(source, /run-betsson-poc\.ps1/);
  assert.match(source, /-RepetitionInterval/);
  assert.match(source, /New-TimeSpan -Minutes 30/);
  assert.match(source, /MultipleInstances IgnoreNew/);
  assert.match(source, /THE_ODDS_API_KEY/);
  assert.match(source, /rev-parse --git-common-dir/);
  assert.match(source, /throw "Missing required scheduler configuration/);
  assert.doesNotMatch(source, /ODDS_API_IO_KEY|TELEGRAM_BOT_TOKEN|TELEGRAM_CHAT_ID/);
});

test("Betsson POC runner invokes the one-API h2h command and writes a transcript log", async () => {
  const source = await readFile(
    new URL("../scripts/run-betsson-poc.ps1", import.meta.url),
    "utf8",
  );

  assert.match(source, /node src[\\/]cli\.mjs theodds-betsson-poc/);
  assert.match(source, /--sports=soccer_fifa_world_cup/);
  assert.match(source, /--sample-min-ev=-2/);
  assert.match(source, /reports[\\/]logs/);
  assert.match(source, /Start-Transcript/);
  assert.match(source, /betsson-poc exited with code/);
  assert.doesNotMatch(source, /ODDS_API_IO_KEY|TELEGRAM_BOT_TOKEN|TELEGRAM_CHAT_ID/);
});

test("Betsson one-api scan installer disables legacy tasks and needs only The Odds API key", async () => {
  const source = await readFile(
    new URL("../scripts/install-betsson-oneapi-scan-task.ps1", import.meta.url),
    "utf8",
  );

  assert.match(source, /Bet-Betsson-OneApi-Scan/);
  assert.match(source, /run-betsson-oneapi-scan\.ps1/);
  assert.match(source, /New-TimeSpan -Minutes 30/);
  assert.match(source, /MultipleInstances IgnoreNew/);
  assert.match(source, /THE_ODDS_API_KEY/);
  assert.match(source, /Disable-ScheduledTask.+Bet-Mispricing-Scanner/s);
  assert.match(source, /Disable-ScheduledTask.+Bet-OddsIo-Sampler/s);
  assert.match(source, /Disable-ScheduledTask.+Bet-Betsson-Poc/s);
  assert.doesNotMatch(source, /ODDS_API_IO_KEY|TELEGRAM_BOT_TOKEN|TELEGRAM_CHAT_ID/);
});

test("Betsson one-api scan runner includes World Cup and sends Betsson watchlist alerts", async () => {
  const source = await readFile(
    new URL("../scripts/run-betsson-oneapi-scan.ps1", import.meta.url),
    "utf8",
  );

  assert.match(source, /node src[\\/]cli\.mjs theodds-betsson-poc/);
  assert.match(source, /--market-profile=soccer-core/);
  assert.match(source, /--markets=h2h/);
  assert.match(source, /--sports=soccer_fifa_world_cup,soccer_brazil_campeonato,soccer_brazil_serie_b,soccer_sweden_allsvenskan,soccer_norway_eliteserien,soccer_finland_veikkausliiga,soccer_league_of_ireland/);
  assert.match(source, /--edge=1\b/);
  assert.match(source, /--max-event-credits=60/);
  assert.match(source, /--quota-floor=150/);
  assert.match(source, /--telegram-watchlist/);
  assert.doesNotMatch(source, /ODDS_API_IO_KEY|TELEGRAM_BOT_TOKEN|TELEGRAM_CHAT_ID/);
});

test("Betsson h2h Telegram watchlist floor is five percent", async () => {
  const source = await readFile(new URL("../src/cli.mjs", import.meta.url), "utf8");

  assert.match(source, /function isCleanBetssonH2hWatchlist/u);
  assert.match(source, /row\.ev >= 0\.05/u);
  assert.doesNotMatch(source, /row\.ev >= 0\.08/u);
});

test("Betsson one-api CLV and settle installers use dedicated commands", async () => {
  const clvInstall = await readFile(
    new URL("../scripts/install-betsson-oneapi-clv-task.ps1", import.meta.url),
    "utf8",
  );
  const settleInstall = await readFile(
    new URL("../scripts/install-betsson-oneapi-settle-task.ps1", import.meta.url),
    "utf8",
  );
  const clvRun = await readFile(
    new URL("../scripts/run-betsson-oneapi-clv.ps1", import.meta.url),
    "utf8",
  );
  const settleRun = await readFile(
    new URL("../scripts/run-betsson-oneapi-settle.ps1", import.meta.url),
    "utf8",
  );

  assert.match(clvInstall, /Bet-Betsson-OneApi-CLV/);
  assert.match(clvInstall, /New-TimeSpan -Minutes 10/);
  assert.match(settleInstall, /Bet-Betsson-OneApi-Settle/);
  assert.match(settleInstall, /New-TimeSpan -Hours 6/);
  for (const source of [clvInstall, settleInstall, clvRun, settleRun]) {
    assert.match(source, /THE_ODDS_API_KEY|betsson-oneapi/u);
    assert.doesNotMatch(source, /ODDS_API_IO_KEY|TELEGRAM_BOT_TOKEN|TELEGRAM_CHAT_ID/);
  }
  assert.match(clvRun, /node src[\\/]cli\.mjs betsson-oneapi-clv --window-minutes=40/);
  assert.match(settleRun, /node src[\\/]cli\.mjs betsson-oneapi-settle/);
});
