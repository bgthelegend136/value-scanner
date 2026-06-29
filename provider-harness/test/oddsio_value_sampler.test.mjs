import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runOddsIoValueSampler, ODDSIO_VALUE_SAMPLER_COLUMNS } from "../src/oddsio_value_sampler.mjs";
import { readCsv } from "../src/csv.mjs";

const NOW = new Date("2026-06-29T00:00:00.000Z");

function rawValueBet({
  id = "evt-1-ML-home-Stoiximan",
  bookmaker = "Stoiximan",
  market = "ML",
  side = "home",
  expectedValue = 108.5,
  updatedAt = "2026-06-28T23:58:00.000Z",
  kickoff = "2026-06-29T10:00:00.000Z",
  home = "Greece",
  away = "Italy",
  odds = "2.10",
} = {}) {
  return {
    id,
    bookmaker,
    expectedValue,
    expectedValueUpdatedAt: updatedAt,
    betSide: side,
    eventId: id.split("-")[0],
    event: {
      home,
      away,
      date: kickoff,
      sport: { name: "Football" },
      league: { name: "World Cup" },
    },
    market: { name: market, hdp: "", home: odds, draw: "3.20", away: "3.60" },
    bookmakerOdds: { home: odds, draw: "3.20", away: "3.60" },
  };
}

test("oddsio value sampler appends raw rows for both selected books without reference calls", async () => {
  const reportsDir = await mkdtemp(join(tmpdir(), "oddsio-sampler-"));
  const calls = [];
  const client = {
    async getValueBets({ bookmaker }) {
      calls.push(bookmaker);
      return {
        receivedAt: NOW.toISOString(),
        rateLimit: { limit: 100, remaining: bookmaker === "Stoiximan" ? 88 : 87, resetAt: "2026-06-29T01:00:00Z" },
        data: [
          rawValueBet({ bookmaker, id: `raw-${bookmaker}-1` }),
          rawValueBet({
            bookmaker,
            id: `raw-${bookmaker}-2`,
            market: "Totals",
            side: "away",
            expectedValue: 99.5,
            odds: "1.85",
          }),
        ],
      };
    },
  };

  const summary = await runOddsIoValueSampler({
    client,
    reportsDir,
    now: () => NOW,
  });

  assert.deepEqual(calls, ["Stoiximan", "Pamestoixima"]);
  assert.equal(summary.rows, 4);
  assert.equal(summary.bookmakers, "Stoiximan,Pamestoixima");
  assert.equal(summary.rateLimitRemaining, 87);

  const rows = await readCsv(join(reportsDir, "oddsio-value-sampler.csv"));
  assert.equal(rows.length, 4);
  assert.equal(rows[0].sampledAt, NOW.toISOString());
  assert.equal(rows[0].bookmaker, "Stoiximan");
  assert.equal(rows[0].market, "ML");
  assert.equal(rows[0].ev, "0.085000");
  assert.equal(rows[0].hoursToKickoff, "10.000000");
  assert.equal(rows[0].inNext24h, "true");
  assert.equal(rows[0].rateLimitRemaining, "88");
  assert.deepEqual(Object.keys(rows[0]), ODDSIO_VALUE_SAMPLER_COLUMNS);

  const afterSecondRun = await runOddsIoValueSampler({
    client,
    reportsDir,
    now: () => new Date("2026-06-29T00:02:00.000Z"),
  });
  assert.equal(afterSecondRun.rows, 4);
  assert.equal((await readCsv(join(reportsDir, "oddsio-value-sampler.csv"))).length, 8);
});

test("oddsio value sampler scripts install a two-minute measurement-only task", async () => {
  const runner = await readFile(new URL("../scripts/run-oddsio-value-sampler.ps1", import.meta.url), "utf8");
  assert.match(runner, /node scripts[\\/]oddsio-value-sampler\.mjs/);
  assert.match(runner, /reports[\\/]logs/);
  assert.match(runner, /Start-Transcript/);
  assert.doesNotMatch(runner, /TELEGRAM_BOT_TOKEN|THE_ODDS_API_KEY/);

  const installer = await readFile(new URL("../scripts/install-oddsio-value-sampler-task.ps1", import.meta.url), "utf8");
  assert.match(installer, /Bet-OddsIo-Sampler/);
  assert.match(installer, /run-oddsio-value-sampler\.ps1/);
  assert.match(installer, /New-TimeSpan -Minutes 2/);
  assert.match(installer, /MultipleInstances IgnoreNew/);
  assert.match(installer, /ODDS_API_IO_KEY/);
  assert.doesNotMatch(installer, /THE_ODDS_API_KEY|TELEGRAM_BOT_TOKEN|TELEGRAM_CHAT_ID/);
}
);
