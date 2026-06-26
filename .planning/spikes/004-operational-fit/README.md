---
spike: 004
name: operational-fit
type: comparison
validates: "Given the scanner workflow, when freshness metadata, documentation, implementation effort, and upgrades are reviewed, then operational risks can be compared"
verdict: VALIDATED
related: [001, 002, 003]
tags: [latency, docs, integration, observability]
---

# Spike 004: Operational Fit

| Provider | Update/latency evidence | Freshness metadata | Docs | Effort | Main risk |
|---|---|---|---|---|---|
| OddsPapi | Real-time push/on-demand pull claim; no numeric SLA found | Example `updatedAt` and outcome `changedAt` | Good, but public bookmaker counts conflict | Low–medium | World Cup and GR identity unresolved |
| SportsGameOdds | Free 10 min; Rookie 3 min; Pro sub-minute | Key required for exact schema validation | Excellent docs, SDKs, examples | Low | Free books/leagues do not fit |
| The Odds API | 60 sec pre-match for 1X2/spreads/totals and additional markets | Per-book `last_update` | Excellent and transparent | Low | Very weak target-book coverage |
| API-Football | Frequencies are explicitly indicative, not guaranteed | Key required | Broad docs; catalog discovery is gated | Medium | Bookmaker/region identity opaque |
| Odds-API.io | REST ~1 sec update and <150 ms response claims; WS sub-100 ms | Key required for response audit | Good docs and official SDKs | Low | Regional identity absent |
| OpticOdds | Streaming plus per-odd timestamps | Best: odd `timestamp` and `/sportsbooks/last-polled` | Excellent OpenAPI/Markdown | Medium | No public pricing and Greek books absent |
| Sportmonks | No precise public odds cadence; premium TXODDS advertises high frequency | Trial required | Good football docs | Medium | Exact book/market list gated |
| SportsDataIO | Enterprise feed and historical warehouse | Contract/product access required | Excellent | Medium–high | Free trial excludes World Cup |

## Unauthenticated Endpoint Probe

| Provider | Observed result |
|---|---|
| OddsPapi | 401 |
| SportsGameOdds | 401 `Missing API key` |
| The Odds API | 401 `MISSING_KEY` |
| API-Football | 403 missing application key |
| Odds-API.io | 200 for public `/v3/sports` |
| OpticOdds | 401 |
| Sportmonks | Current public bookmaker endpoint path could not be confirmed |

Meaningful bookmaker/event/market comparison therefore requires user-owned free/trial keys.

## Official Sources

- [OddsPapi docs](https://oddspapi.io/us/docs)
- [SportsGameOdds docs](https://sportsgameodds.com/docs)
- [The Odds API update intervals](https://the-odds-api.com/sports-odds-data/update-intervals.html)
- [API-Football docs](https://www.api-football.com/documentation-v3)
- [Odds-API.io docs](https://docs.odds-api.io/)
- [OpticOdds fixture odds](https://developer.opticodds.com/reference/get_fixtures-odds), [last-polled](https://developer.opticodds.com/reference/get_sportsbooks-last-polled)
- [Sportmonks football API](https://www.sportmonks.com/football-api/)
- [SportsDataIO soccer docs](https://sportsdata.io/developers/api-documentation/soccer)

## Investigation Trail

1. Separated update cadence from HTTP response latency.
2. Checked per-odd timestamps and provider last-polled metadata.
3. Probed official endpoints without credentials to document authentication gates.
4. Rated implementation effort from schemas, SDKs, examples, and discovery endpoints.

## Results

**Verdict: VALIDATED.** Coverage and regional identity are larger risks than integration complexity. OpticOdds has the best freshness observability; The Odds API has the clearest cadence; Odds-API.io is the easiest relevant free integration.
