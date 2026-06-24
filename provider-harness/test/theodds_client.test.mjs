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
