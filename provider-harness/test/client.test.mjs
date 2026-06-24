import assert from "node:assert/strict";
import test from "node:test";

import { createOddsApiClient } from "../src/client.mjs";

function jsonResponse(data, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

test("calls documented events and odds endpoints", async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(String(url));
    return jsonResponse([], {
      headers: {
        "x-ratelimit-limit": "100",
        "x-ratelimit-remaining": "99",
        "x-ratelimit-reset": "2026-06-24T13:00:00Z",
      },
    });
  };
  const client = createOddsApiClient({
    apiKey: "secret",
    fetchImpl,
    baseUrl: "https://api.odds-api.io/v3",
  });

  const events = await client.listEvents({ sport: "football", limit: 5 });
  await client.getOdds({ eventId: "123", bookmakers: ["Superbet", "Stoiximan"] });

  const eventUrl = new URL(urls[0]);
  assert.equal(eventUrl.pathname, "/v3/events");
  assert.equal(eventUrl.searchParams.get("apiKey"), "secret");
  assert.equal(eventUrl.searchParams.get("sport"), "football");
  assert.equal(eventUrl.searchParams.get("limit"), "5");

  const oddsUrl = new URL(urls[1]);
  assert.equal(oddsUrl.pathname, "/v3/odds");
  assert.equal(oddsUrl.searchParams.get("eventId"), "123");
  assert.equal(oddsUrl.searchParams.get("bookmakers"), "Superbet,Stoiximan");
  assert.deepEqual(events.rateLimit, {
    limit: 100,
    remaining: 99,
    resetAt: "2026-06-24T13:00:00Z",
  });
});

test("redacts the key from provider failures", async () => {
  const key = "do-not-leak";
  const client = createOddsApiClient({
    apiKey: key,
    fetchImpl: async () => jsonResponse({ error: `bad key ${key}` }, { status: 401 }),
  });

  await assert.rejects(
    () => client.listEvents({ sport: "football", limit: 5 }),
    (error) => {
      assert.match(error.message, /Odds-API\.io request failed with status 401/);
      assert.doesNotMatch(error.message, new RegExp(key));
      return true;
    },
  );
});
