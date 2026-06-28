import assert from "node:assert/strict";
import test from "node:test";

import { createTheOddsApiClient } from "../src/theodds_client.mjs";

function jsonResponse(data, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

test("calls documented events and odds endpoints with quota", async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(String(url));
    return jsonResponse([], {
      headers: { "x-requests-remaining": "498", "x-requests-used": "2", "x-requests-last": "2" },
    });
  };
  const client = createTheOddsApiClient({ apiKey: "secret", fetchImpl });

  const events = await client.listEvents({ sportKey: "soccer_fifa_world_cup" });
  await client.getOdds({ sportKey: "soccer_fifa_world_cup" });

  const eventsUrl = new URL(urls[0]);
  assert.equal(eventsUrl.pathname, "/v4/sports/soccer_fifa_world_cup/events");
  assert.equal(eventsUrl.searchParams.get("apiKey"), "secret");

  const oddsUrl = new URL(urls[1]);
  assert.equal(oddsUrl.pathname, "/v4/sports/soccer_fifa_world_cup/odds");
  assert.equal(oddsUrl.searchParams.get("regions"), "eu");
  assert.equal(oddsUrl.searchParams.get("markets"), "h2h,totals");
  assert.equal(oddsUrl.searchParams.get("oddsFormat"), "decimal");
  assert.deepEqual(events.quota, { remaining: 498, used: 2, lastCost: 2 });
});

test("calls the scores endpoint with a three-day completed-game window", async () => {
  const urls = [];
  const client = createTheOddsApiClient({
    apiKey: "secret",
    fetchImpl: async (url) => {
      urls.push(String(url));
      return jsonResponse([], {
        headers: {
          "x-requests-remaining": "496",
          "x-requests-used": "4",
          "x-requests-last": "2",
        },
      });
    },
  });

  const response = await client.getScores({
    sportKey: "soccer_fifa_world_cup",
  });

  const url = new URL(urls[0]);
  assert.equal(url.pathname, "/v4/sports/soccer_fifa_world_cup/scores");
  assert.equal(url.searchParams.get("daysFrom"), "3");
  assert.equal(url.searchParams.get("dateFormat"), "iso");
  assert.equal(url.searchParams.get("apiKey"), "secret");
  assert.deepEqual(response.quota, { remaining: 496, used: 4, lastCost: 2 });
});

test("redacts the key from provider failures", async () => {
  const key = "do-not-leak";
  const client = createTheOddsApiClient({
    apiKey: key,
    fetchImpl: async () => jsonResponse({ message: `bad ${key}` }, { status: 401 }),
  });
  await assert.rejects(
    () => client.listEvents({ sportKey: "soccer_fifa_world_cup" }),
    (error) => {
      assert.match(error.message, /The Odds API request failed with status 401/);
      assert.doesNotMatch(error.message, new RegExp(key));
      return true;
    },
  );
});

test("redacts the key from network-level provider failures", async () => {
  const key = "network-secret";
  const client = createTheOddsApiClient({
    apiKey: key,
    fetchImpl: async (url) => {
      throw new Error(`connection failed for ${url}`);
    },
  });

  await assert.rejects(
    () => client.listSports(),
    (error) => {
      assert.match(error.message, /The Odds API network request failed/);
      assert.doesNotMatch(error.message, new RegExp(key));
      assert.doesNotMatch(error.message, /apiKey=/);
      return true;
    },
  );
});

test("lists active sports without spending odds quota", async () => {
  const urls = [];
  const client = createTheOddsApiClient({
    apiKey: "secret",
    fetchImpl: async (url) => {
      urls.push(String(url));
      return jsonResponse([{ key: "basketball_euroleague", active: true }]);
    },
  });

  const response = await client.listSports();
  const url = new URL(urls[0]);
  assert.equal(url.pathname, "/v4/sports");
  assert.equal(url.searchParams.get("all"), "false");
  assert.deepEqual(response.data, [{ key: "basketball_euroleague", active: true }]);
});

test("filters odds by event ids and can request links", async () => {
  const urls = [];
  const client = createTheOddsApiClient({
    apiKey: "secret",
    fetchImpl: async (url) => {
      urls.push(String(url));
      return jsonResponse([]);
    },
  });
  await client.getOdds({
    sportKey: "basketball_euroleague",
    eventIds: ["a", "b"],
    includeLinks: true,
  });
  const url = new URL(urls[0]);
  assert.equal(url.searchParams.get("eventIds"), "a,b");
  assert.equal(url.searchParams.get("includeLinks"), "true");
});

test("calls the event odds endpoint for additional markets", async () => {
  const urls = [];
  const client = createTheOddsApiClient({
    apiKey: "secret",
    fetchImpl: async (url) => {
      urls.push(String(url));
      return jsonResponse({ id: "evt-1" }, {
        headers: {
          "x-requests-remaining": "441",
          "x-requests-used": "59",
          "x-requests-last": "6",
        },
      });
    },
  });

  const response = await client.getEventOdds({
    sportKey: "soccer_fifa_world_cup",
    eventId: "evt-1",
    markets: "btts,double_chance,team_totals",
  });

  const url = new URL(urls[0]);
  assert.equal(url.pathname, "/v4/sports/soccer_fifa_world_cup/events/evt-1/odds");
  assert.equal(url.searchParams.get("apiKey"), "secret");
  assert.equal(url.searchParams.get("regions"), "eu");
  assert.equal(url.searchParams.get("markets"), "btts,double_chance,team_totals");
  assert.equal(url.searchParams.get("oddsFormat"), "decimal");
  assert.deepEqual(response.data, { id: "evt-1" });
  assert.deepEqual(response.quota, { remaining: 441, used: 59, lastCost: 6 });
});

test("calls the historical odds endpoint and leaves wrapped data intact", async () => {
  const urls = [];
  const historicalPayload = {
    timestamp: "2025-08-16T14:55:00Z",
    previous_timestamp: "2025-08-16T14:50:00Z",
    next_timestamp: "2025-08-16T15:00:00Z",
    data: [{ id: "evt-1" }],
  };
  const client = createTheOddsApiClient({
    apiKey: "secret",
    fetchImpl: async (url) => {
      urls.push(String(url));
      return jsonResponse(historicalPayload, {
        headers: {
          "x-requests-remaining": "19980",
          "x-requests-used": "20",
          "x-requests-last": "20",
        },
      });
    },
  });

  const response = await client.getHistoricalOdds({
    sportKey: "soccer_epl",
    date: "2025-08-16T14:55:00Z",
    regions: "eu",
    markets: "h2h,totals",
  });

  const url = new URL(urls[0]);
  assert.equal(url.pathname, "/v4/historical/sports/soccer_epl/odds");
  assert.equal(url.searchParams.get("date"), "2025-08-16T14:55:00Z");
  assert.equal(url.searchParams.get("apiKey"), "secret");
  assert.equal(url.searchParams.get("regions"), "eu");
  assert.equal(url.searchParams.get("markets"), "h2h,totals");
  assert.equal(url.searchParams.get("oddsFormat"), "decimal");
  assert.deepEqual(response.data, historicalPayload);
  assert.deepEqual(response.quota, { remaining: 19980, used: 20, lastCost: 20 });
});

test("calls event markets and historical event-id endpoints", async () => {
  const urls = [];
  const client = createTheOddsApiClient({
    apiKey: "secret",
    fetchImpl: async (url) => {
      urls.push(String(url));
      return jsonResponse([], {
        headers: {
          "x-requests-remaining": "19877",
          "x-requests-used": "123",
          "x-requests-last": "1",
        },
      });
    },
  });

  await client.getEventMarkets({
    sportKey: "soccer_epl",
    eventId: "evt-1",
    regions: "eu",
  });
  await client.getHistoricalEvents({
    sportKey: "soccer_epl",
    date: "2025-08-16T12:00:00Z",
    eventIds: ["evt-1", "evt-2"],
    commenceTimeFrom: "2025-08-16T00:00:00Z",
    commenceTimeTo: "2025-08-17T00:00:00Z",
  });
  await client.getHistoricalEventOdds({
    sportKey: "soccer_epl",
    eventId: "evt-1",
    date: "2025-08-16T12:00:00Z",
    regions: "eu",
    markets: "h2h",
  });

  const marketsUrl = new URL(urls[0]);
  assert.equal(marketsUrl.pathname, "/v4/sports/soccer_epl/events/evt-1/markets");
  assert.equal(marketsUrl.searchParams.get("regions"), "eu");

  const historicalEventsUrl = new URL(urls[1]);
  assert.equal(historicalEventsUrl.pathname, "/v4/historical/sports/soccer_epl/events");
  assert.equal(historicalEventsUrl.searchParams.get("date"), "2025-08-16T12:00:00Z");
  assert.equal(historicalEventsUrl.searchParams.get("eventIds"), "evt-1,evt-2");
  assert.equal(historicalEventsUrl.searchParams.get("commenceTimeFrom"), "2025-08-16T00:00:00Z");
  assert.equal(historicalEventsUrl.searchParams.get("commenceTimeTo"), "2025-08-17T00:00:00Z");

  const historicalEventOddsUrl = new URL(urls[2]);
  assert.equal(historicalEventOddsUrl.pathname, "/v4/historical/sports/soccer_epl/events/evt-1/odds");
  assert.equal(historicalEventOddsUrl.searchParams.get("date"), "2025-08-16T12:00:00Z");
  assert.equal(historicalEventOddsUrl.searchParams.get("markets"), "h2h");
});
