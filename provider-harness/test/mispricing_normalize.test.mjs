import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  chooseBookmakerLink,
  normalizeValueBets,
} from "../src/mispricing_normalize.mjs";

const fixture = JSON.parse(
  await readFile(new URL("./fixtures/value-bets-response.json", import.meta.url), "utf8"),
);

test("normalizes a fresh ML candidate, fixes EV units, and drops totals in v1", () => {
  const result = normalizeValueBets(fixture, {
    receivedAt: "2026-06-25T08:56:00.000Z",
    now: new Date("2026-06-25T09:00:00.000Z"),
  });

  assert.equal(result.candidates.length, 1);
  assert.deepEqual(
    {
      bookmaker: result.candidates[0].bookmaker,
      sportSlug: result.candidates[0].sportSlug,
      leagueSlug: result.candidates[0].leagueSlug,
      market: result.candidates[0].market,
      line: result.candidates[0].line,
      outcome: result.candidates[0].outcome,
      offeredOdds: result.candidates[0].offeredOdds,
      providerExpectedValue: result.candidates[0].providerExpectedValue,
      linkDepth: result.candidates[0].linkDepth,
      link: result.candidates[0].link,
    },
    {
      bookmaker: "Stoiximan",
      sportSlug: "football",
      leagueSlug: "argentina-primera-division-a",
      market: "MATCH_RESULT",
      line: "",
      outcome: "1",
      offeredOdds: 2.4,
      // EV is an index ~ (offered/fair)*100; fraction = value/100 - 1.
      providerExpectedValue: 0.245,
      linkDepth: "EVENT",
      link: "https://en.stoiximan.gr/match-odds/banfield-gimnasia-la-plata/87733393/",
    },
  );
  assert.equal(result.rejected[0].reason, "UNSUPPORTED_MARKET");
});

test("normalizes a Pamestoixima candidate and keeps its allowlisted link", () => {
  const pamestoixima = {
    ...fixture[0],
    id: "ps-1",
    bookmaker: "Pamestoixima",
    bookmakerOdds: { ...fixture[0].bookmakerOdds, href: "https://www.pamestoixima.gr/event/1" },
  };
  const result = normalizeValueBets([pamestoixima], {
    receivedAt: "2026-06-25T08:56:00.000Z",
    now: new Date("2026-06-25T09:00:00.000Z"),
  });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].bookmaker, "Pamestoixima");
  assert.equal(result.candidates[0].link, "https://www.pamestoixima.gr/event/1");
  assert.equal(result.candidates[0].linkDepth, "EVENT");
});

test("rejects below-min EV, stale, started, missing timestamp, malformed odds, and unsupported book", () => {
  const base = fixture[0];
  const mutations = [
    // (104.9 - 100)/100 = 0.049 < 0.05 watchlist floor
    [{ ...base, expectedValue: 104.9 }, "CANDIDATE_EV_BELOW_MIN"],
    [{ ...base, expectedValueUpdatedAt: "2026-06-25T08:40:00Z" }, "STALE_CANDIDATE"],
    [{ ...base, expectedValueUpdatedAt: "" }, "INVALID_VALUE_TIMESTAMP"],
    [{ ...base, event: { ...base.event, date: "2026-06-25T08:59:00Z" } }, "EVENT_STARTED"],
    [{
      ...base,
      bookmakerOdds: { ...base.bookmakerOdds, home: "not-a-number" },
      market: { ...base.market, home: "not-a-number" },
    }, "INVALID_OFFERED_ODDS"],
    [{ ...base, bookmaker: "Bet365" }, "UNSUPPORTED_BOOKMAKER"],
  ];

  for (const [raw, reason] of mutations) {
    const result = normalizeValueBets([raw], {
      receivedAt: "2026-06-25T09:00:00Z",
      now: new Date("2026-06-25T09:00:00Z"),
    });
    assert.equal(result.candidates.length, 0, `expected 0 candidates for ${reason}`);
    assert.equal(result.rejected[0].reason, reason);
  }
});

test("EV prefilter still accepts urgent-tier candidates at 10 percent", () => {
  const result = normalizeValueBets([{ ...fixture[0], expectedValue: 110 }], {
    receivedAt: "2026-06-25T09:00:00Z",
    now: new Date("2026-06-25T09:00:00Z"),
  });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].providerExpectedValue, 0.1);
});

test("EV prefilter accepts research watchlist candidates at exactly the 5 percent floor", () => {
  const result = normalizeValueBets([{ ...fixture[0], expectedValue: 105 }], {
    receivedAt: "2026-06-25T09:00:00Z",
    now: new Date("2026-06-25T09:00:00Z"),
  });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].providerExpectedValue, 0.05);
});

test("uses only allowlisted HTTPS Stoiximan links and falls back by depth", () => {
  assert.deepEqual(
    chooseBookmakerLink({
      bookmaker: "Stoiximan",
      outcomeLink: "https://en.stoiximan.gr/betslip/123",
      marketLink: "https://en.stoiximan.gr/event/123#ml",
      eventLink: "https://en.stoiximan.gr/event/123",
    }),
    { url: "https://en.stoiximan.gr/betslip/123", depth: "OUTCOME" },
  );
  assert.deepEqual(
    chooseBookmakerLink({
      bookmaker: "Stoiximan",
      outcomeLink: "javascript:alert(1)",
      marketLink: "https://evil.example/market",
      eventLink: "https://www.stoiximan.gr/match/501",
    }),
    { url: "https://www.stoiximan.gr/match/501", depth: "EVENT" },
  );
  assert.deepEqual(
    chooseBookmakerLink({
      bookmaker: "Stoiximan",
      outcomeLink: "http://en.stoiximan.gr/insecure",
      marketLink: "",
      eventLink: "",
    }),
    { url: "", depth: "NONE" },
  );
});
