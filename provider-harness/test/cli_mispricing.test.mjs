import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runCli } from "../src/cli.mjs";

test("mispricing-scan loads all secrets and passes dry-run to orchestration", async () => {
  const calls = [];
  const code = await runCli(["mispricing-scan", "--dry-run"], {
    out: () => {},
    err: () => {},
    reportsDir: await mkdtemp(join(tmpdir(), "cli-mispricing-")),
    loadMispricingConfig: async () => ({
      oddsApiKey: "odds-key",
      theOddsApiKey: "reference-key",
      telegramToken: "telegram-token",
      telegramChatId: "telegram-chat",
    }),
    createValueBetsClient: ({ apiKey }) => ({ apiKey }),
    createTheOddsClient: ({ apiKey }) => ({ apiKey }),
    createTelegramClient: ({ token, chatId }) => ({ token, chatId }),
    loadRegistry: async () => new Map(),
    createState: () => ({}),
    runMispricing: async (args) => {
      calls.push(args);
      return { sent: 0 };
    },
    now: () => new Date("2026-06-25T09:00:00Z"),
  });
  assert.equal(code, 0);
  assert.equal(calls[0].dryRun, true);
  assert.equal(calls[0].valueBetsClient.apiKey, "odds-key");
  assert.equal(calls[0].referenceClient.apiKey, "reference-key");
  assert.equal(calls[0].telegramClient.token, "telegram-token");
});

test("telegram-test sends one non-betting diagnostic message", async () => {
  let text = "";
  const code = await runCli(["telegram-test"], {
    out: () => {},
    err: () => {},
    loadMispricingConfig: async () => ({
      oddsApiKey: "a", theOddsApiKey: "b",
      telegramToken: "c", telegramChatId: "d",
    }),
    createTelegramClient: () => ({
      async sendText(value) { text = value; return { messageId: "1" }; },
    }),
  });
  assert.equal(code, 0);
  assert.match(text, /Telegram connection test/);
});

test("unknown mispricing-scan flags are rejected", async () => {
  let error = "";
  const code = await runCli(["mispricing-scan", "--edge=10"], {
    err: (value) => { error += value; },
    out: () => {},
  });
  assert.equal(code, 1);
  assert.match(error, /unsupported mispricing-scan option/);
});
