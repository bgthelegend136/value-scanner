---
spike: 003
name: competition-and-market-coverage
type: comparison
validates: "Given the World Cup use case and target markets, when official catalogs and endpoints are checked, then event and market suitability can be classified"
verdict: PARTIAL
related: [001, 002]
tags: [world-cup, markets, prematch]
---

# Spike 003: World Cup and Market Coverage

Legend: `Y` documented, `P` broad family documented, `?` requires authenticated event-level validation, `N` unavailable on the relevant free tier.

| Provider | World Cup | 1X2/Draw | Double Chance | U2.5/U3.5 | Team Goals O/U | Free-tier fit |
|---|---:|---:|---:|---:|---:|---|
| OddsPapi | ? | Y | P | Y | P | Broad books, but tournament and exact markets require a key |
| SportsGameOdds | Y | Y | ? | Y | P via team props | World Cup is not listed in the free plan's 8 leagues |
| The Odds API | Y | Y | Y | Y | ? | Core markets available; only Betsson matches target list |
| API-Football | P/? | P | ? | P | ? | Current free-season and event-level coverage require a key |
| Odds-API.io | Y | Y | Y | Y | ? | Strongest documented two-book free-test fit |
| OpticOdds | Y | P | ? | P | P | Active markets are queryable; key required |
| Sportmonks | Y | P | P/? | P | P/? | Paid odds bundle claims 150+ markets; trial required |
| SportsDataIO | Y paid | P | ? | P | ? | Free soccer trial excludes the World Cup |

## Event-Level Validation Rule

Provider-level market claims do not prove:

`World Cup fixture × bookmaker × full-time period × requested line`

The validation harness must preserve:

- totals line (`2.5` versus `3.5`);
- team identity for team totals;
- period (`full match`);
- Double Chance outcome (`1X`, `X2`, `12`);
- provider and bookmaker update timestamps.

## Official Sources

- [OddsPapi overview](https://oddspapi.io/), [docs](https://oddspapi.io/us/docs)
- [SportsGameOdds World Cup claim](https://sportsgameodds.com/)
- [The Odds API sports](https://the-odds-api.com/sports-odds-data/sports-apis.html), [markets](https://the-odds-api.com/sports-odds-data/betting-markets.html)
- [Odds-API.io football](https://odds-api.io/sports/football)
- [OpticOdds leagues](https://developer.opticodds.com/docs/leagues), [market types](https://developer.opticodds.com/reference/get_market-types)
- [Sportmonks football API](https://www.sportmonks.com/football-api/)
- [SportsDataIO soccer docs](https://sportsdata.io/developers/api-documentation/soccer)

## Investigation Trail

1. Checked tournament coverage separately from generic international soccer.
2. Checked market families separately from event-level availability.
3. Verified public World Cup entries at The Odds API, Odds-API.io, OpticOdds, SportsGameOdds, and Sportmonks.
4. Kept OddsPapi World Cup support unresolved because it is not explicit in the public catalog.

## Results

**Verdict: PARTIAL.** No provider publishes the complete event/book/market/line matrix. Authenticated event-level validation is mandatory.
