import assert from "node:assert/strict";
import test from "node:test";

import { createValueBetsClient } from "../src/value_bets_client.mjs";

function jsonResponse(data, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

test("requests value bets for one bookmaker with event details", async () => {
  const urls = [];
  const client = createValueBetsClient({
    apiKey: "secret",
    fetchImpl: async (url) => {
      urls.push(String(url));
      return jsonResponse([], {
        headers: {
          "x-ratelimit-limit": "100",
          "x-ratelimit-remaining": "99",
          "x-ratelimit-reset": "2026-06-25T10:00:00Z",
        },
      });
    },
  });

  const response = await client.getValueBets({
    bookmaker: "Stoiximan",
  });

  const url = new URL(urls[0]);
  assert.equal(url.pathname, "/v3/value-bets");
  assert.equal(url.searchParams.get("apiKey"), "secret");
  assert.equal(url.searchParams.get("bookmaker"), "Stoiximan");
  assert.equal(url.searchParams.has("minExpectedValue"), false);
  assert.equal(url.searchParams.get("includeEventDetails"), "true");
  assert.deepEqual(response.rateLimit, {
    limit: 100,
    remaining: 99,
    resetAt: "2026-06-25T10:00:00Z",
  });
});

test("redacts provider body and key from value-bet failures", async () => {
  const key = "do-not-leak";
  const client = createValueBetsClient({
    apiKey: key,
    fetchImpl: async () =>
      jsonResponse({ message: `subscription denied ${key}` }, { status: 403 }),
  });

  await assert.rejects(
    () => client.getValueBets({ bookmaker: "Superbet" }),
    (error) => {
      assert.match(error.message, /Odds-API\.io value-bets request failed with status 403/);
      assert.doesNotMatch(error.message, new RegExp(key));
      assert.doesNotMatch(error.message, /subscription denied/);
      return true;
    },
  );
});

test("redacts the key from network-level value-bet failures", async () => {
  const key = "network-secret";
  const client = createValueBetsClient({
    apiKey: key,
    fetchImpl: async (url) => {
      throw new Error(`connection failed for ${url}`);
    },
  });

  await assert.rejects(
    () => client.getValueBets({ bookmaker: "Stoiximan" }),
    (error) => {
      assert.match(error.message, /Odds-API\.io value-bets network request failed/);
      assert.doesNotMatch(error.message, new RegExp(key));
      assert.doesNotMatch(error.message, /apiKey=/);
      return true;
    },
  );
});
