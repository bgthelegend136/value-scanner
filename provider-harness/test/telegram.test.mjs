import assert from "node:assert/strict";
import test from "node:test";

import {
  createTelegramClient,
  formatMispricingMessage,
} from "../src/telegram.mjs";

const candidate = {
  bookmaker: "Stoiximan",
  sportName: "Football",
  leagueName: "FIFA World Cup",
  participantOne: "Japan",
  participantTwo: "Sweden",
  kickoffUtc: "2026-06-26T01:00:00Z",
  market: "MATCH_RESULT",
  line: "",
  outcome: "1",
  offeredOdds: 2.4,
  providerExpectedValue: 0.142,
  valueUpdatedAt: "2026-06-25T20:58:00Z",
  link: "https://en.stoiximan.gr/match/123",
  linkDepth: "EVENT",
};

const confirmation = {
  pinnacleFairOdds: 1.91,
  pinnacleEv: 0.157,
  consensusFairOdds: 1.95,
  consensusEv: 0.131,
  consensusBooks: 6,
};

test("formats a Greece-time urgent alert with the exact pick and verification warning", () => {
  const text = formatMispricingMessage(candidate, confirmation);
  assert.match(text, /URGENT MISPRICING WATCH/);
  assert.match(text, /Tier: URGENT_10_PLUS/);
  assert.match(text, /Football - FIFA World Cup/);
  assert.match(text, /Japan vs Sweden/);
  assert.match(text, /Greece/);
  assert.match(text, /Pick: Japan/);
  assert.match(text, /Provider EV: \+14\.2%/);
  assert.match(text, /Conservative EV: \+13\.1%/);
  assert.match(text, /Pinnacle fair: 1\.91 \| EV: \+15\.7%/);
  assert.match(text, /Consensus fair: 1\.95 \| EV: \+13\.1% \| 6 books/);
  assert.match(text, /Verify the displayed price/);
  assert.match(text, /Manual micro-test only/);
  // EVENT-depth link must tell the user to find the exact pick.
  assert.match(text, /select the exact pick/);
});

test("formats 5 to 10 percent confirmed EV as research watchlist without stake sizing", () => {
  const text = formatMispricingMessage(candidate, {
    ...confirmation,
    pinnacleEv: 0.082,
    consensusEv: 0.061,
    minimumConfirmedEv: 0.061,
    edgeOverDispersion: 2.4,
  });
  assert.match(text, /RESEARCH WATCHLIST/);
  assert.match(text, /Tier: WATCHLIST_5_10/);
  assert.match(text, /Conservative EV: \+6\.1%/);
  assert.match(text, /Research-only advisory/);
  assert.doesNotMatch(text, /Suggested stake/);
});

test("urgent alerts keep manual micro-test wording without stake sizing", () => {
  const text = formatMispricingMessage(
    { ...candidate, offeredOdds: 2.4 },
    { ...confirmation, minimumConfirmedEv: 0.13 },
  );
  assert.match(text, /Manual micro-test only/);
  assert.doesNotMatch(text, /Suggested stake/);
});

test("shows the edge-over-dispersion confidence when present", () => {
  const confident = formatMispricingMessage(candidate, { ...confirmation, edgeOverDispersion: 12.3 });
  assert.match(confident, /Edge confidence: 12\.3x the sharp books' disagreement/);

  const lockstep = formatMispricingMessage(candidate, { ...confirmation, edgeOverDispersion: null });
  assert.match(lockstep, /Edge confidence: sharp books in lockstep/);
});

test("sends a Telegram message with an exact-selection button", async () => {
  const calls = [];
  const client = createTelegramClient({
    token: "secret-token",
    chatId: "12345",
    fetchImpl: async (url, init) => {
      calls.push([String(url), JSON.parse(init.body)]);
      return new Response(JSON.stringify({ ok: true, result: { message_id: 77 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  const response = await client.sendMispricing(candidate, confirmation);
  assert.equal(response.messageId, "77");
  const [url, body] = calls[0];
  assert.match(url, /\/botsecret-token\/sendMessage$/);
  assert.equal(body.chat_id, "12345");
  assert.deepEqual(body.reply_markup.inline_keyboard, [[{
    text: "Open in Stoiximan",
    url: candidate.link,
  }]]);
});

test("omits the button when no safe link exists and redacts token on failure", async () => {
  let sentBody;
  const token = "never-print-this";
  const client = createTelegramClient({
    token,
    chatId: "12345",
    fetchImpl: async (_url, init) => {
      sentBody = JSON.parse(init.body);
      return new Response(JSON.stringify({ ok: false, description: token }), { status: 500 });
    },
  });
  await assert.rejects(
    () => client.sendMispricing({
      ...candidate,
      link: "https://evil.example/phishing",
      linkDepth: "OUTCOME",
    }, confirmation),
    (error) => {
      assert.match(error.message, /Telegram request failed with status 500/);
      assert.doesNotMatch(error.message, new RegExp(token));
      return true;
    },
  );
  assert.equal(sentBody.reply_markup, undefined);
});

test("sends a plain diagnostic text message", async () => {
  let body;
  const client = createTelegramClient({
    token: "t",
    chatId: "c",
    fetchImpl: async (_url, init) => {
      body = JSON.parse(init.body);
      return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  await client.sendText("hello");
  assert.equal(body.text, "hello");
  assert.equal(body.reply_markup, undefined);
});

test("redacts the bot token from network-level Telegram failures", async () => {
  const token = "network-token";
  const client = createTelegramClient({
    token,
    chatId: "c",
    fetchImpl: async (url) => {
      throw new Error(`connection failed for ${url}`);
    },
  });

  await assert.rejects(
    () => client.sendText("hello"),
    (error) => {
      assert.match(error.message, /Telegram network request failed/);
      assert.doesNotMatch(error.message, new RegExp(token));
      return true;
    },
  );
});
