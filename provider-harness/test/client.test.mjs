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

test("passes league and status filters when provided", async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(String(url));
    return jsonResponse([]);
  };
  const client = createOddsApiClient({ apiKey: "secret", fetchImpl });

  await client.listEvents({
    sport: "football",
    league: "international-fifa-world-cup",
    status: "pending",
    limit: 100,
  });

  const url = new URL(urls[0]);
  assert.equal(url.searchParams.get("league"), "international-fifa-world-cup");
  assert.equal(url.searchParams.get("status"), "pending");
  assert.equal(url.searchParams.get("limit"), "100");
});

test("omits league and status when not provided", async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(String(url));
    return jsonResponse([]);
  };
  const client = createOddsApiClient({ apiKey: "secret", fetchImpl });

  await client.listEvents({ sport: "football", limit: 5 });

  const url = new URL(urls[0]);
  assert.equal(url.searchParams.has("league"), false);
  assert.equal(url.searchParams.has("status"), false);
});

test("getOddsMulti requests /odds/multi with comma-joined ids and bookmakers", async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(String(url));
    return jsonResponse([]);
  };
  const client = createOddsApiClient({ apiKey: "secret", fetchImpl });

  await client.getOddsMulti({ eventIds: ["1", "2", "3"], bookmakers: ["Superbet", "Stoiximan"] });

  const url = new URL(urls[0]);
  assert.equal(url.pathname, "/v3/odds/multi");
  assert.equal(url.searchParams.get("eventIds"), "1,2,3");
  assert.equal(url.searchParams.get("bookmakers"), "Superbet,Stoiximan");
});

test("getOddsMulti can request includeSeq and returns the sequence header", async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(String(url));
    return jsonResponse([], { headers: { "x-oddsapi-seq": "482917" } });
  };
  const client = createOddsApiClient({ apiKey: "secret", fetchImpl });

  const response = await client.getOddsMulti({
    eventIds: ["1", "2"],
    bookmakers: ["Stoiximan"],
    includeSeq: true,
  });

  const url = new URL(urls[0]);
  assert.equal(url.pathname, "/v3/odds/multi");
  assert.equal(url.searchParams.get("includeSeq"), "true");
  assert.equal(response.seq, 482917);
});

test("calls selected bookmakers, live events, updated odds, and movements endpoints", async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(String(url));
    return jsonResponse([]);
  };
  const client = createOddsApiClient({ apiKey: "secret", fetchImpl });

  await client.listSelectedBookmakers();
  await client.listLiveEvents({ sport: "football" });
  await client.listEvents({
    sport: "football",
    status: "pending,live",
    from: "2026-06-28T00:00:00Z",
    to: "2026-06-29T00:00:00Z",
    bookmaker: "Stoiximan",
    limit: 100,
    skip: 50,
  });
  await client.getOddsUpdated({ since: 1_782_624_000, bookmaker: "Stoiximan", sport: "Football" });
  await client.getOddsMovements({ eventId: "evt-1", bookmaker: "Stoiximan", market: "ML" });

  assert.equal(new URL(urls[0]).pathname, "/v3/bookmakers/selected");

  const liveUrl = new URL(urls[1]);
  assert.equal(liveUrl.pathname, "/v3/events/live");
  assert.equal(liveUrl.searchParams.get("sport"), "football");

  const eventsUrl = new URL(urls[2]);
  assert.equal(eventsUrl.pathname, "/v3/events");
  assert.equal(eventsUrl.searchParams.get("from"), "2026-06-28T00:00:00Z");
  assert.equal(eventsUrl.searchParams.get("to"), "2026-06-29T00:00:00Z");
  assert.equal(eventsUrl.searchParams.get("bookmaker"), "Stoiximan");
  assert.equal(eventsUrl.searchParams.get("skip"), "50");

  const updatedUrl = new URL(urls[3]);
  assert.equal(updatedUrl.pathname, "/v3/odds/updated");
  assert.equal(updatedUrl.searchParams.get("since"), "1782624000");
  assert.equal(updatedUrl.searchParams.get("bookmaker"), "Stoiximan");
  assert.equal(updatedUrl.searchParams.get("sport"), "Football");

  const movementsUrl = new URL(urls[4]);
  assert.equal(movementsUrl.pathname, "/v3/odds/movements");
  assert.equal(movementsUrl.searchParams.get("eventId"), "evt-1");
  assert.equal(movementsUrl.searchParams.get("bookmaker"), "Stoiximan");
  assert.equal(movementsUrl.searchParams.get("market"), "ML");
  assert.equal(movementsUrl.searchParams.has("marketLine"), false);
});
