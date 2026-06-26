---
spike: 001
name: free-tier-and-terms
type: comparison
validates: "Given the candidate providers, when official plans and terms are reviewed, then usable quotas and storage rights can be identified"
verdict: PARTIAL
related: []
tags: [pricing, terms, storage]
---

# Spike 001: Free Tier and Terms

Research date: 2026-06-24. Only provider-owned pricing, documentation, and terms pages were treated as authoritative.

| Provider | Free access and limits | Paid path | Private snapshot storage |
|---|---|---|---|
| OddsPapi | Permanent: 250 requests/month; pre-game REST; public page claims unlimited sports/bookmakers | Custom/contact sales | **Unknown.** Standalone resale is prohibited, but persistent storage is not explicitly addressed. |
| SportsGameOdds | Permanent: 2,500 objects/month, 10 requests/minute, 10-minute updates, 8 leagues, 9 bookmakers | Rookie $99/month; Pro $299/month | **Conditional.** Application use is permitted, but data must be deleted within 30 days after termination. |
| The Odds API | Permanent: 500 credits/month; most books; all markets; no historical odds | $30/20k, $59/100k, $119/5m, $249/15m credits | **Unknown.** Analytical tools are encouraged; raw redistribution is prohibited. |
| API-Football | Permanent: 100 requests/day; all endpoints, limited seasons | $19/7,500 daily; $29/75,000; $39/150,000 | **Unknown.** Projects are allowed and direct resale is prohibited; competition rights remain the customer's responsibility. |
| Odds-API.io | Permanent: 2 selected books, 100 requests/hour, REST | £99/5 books, £179/10, £229/15; WebSocket doubles price | **Unknown.** Analytical use is allowed; redistribution is prohibited. |
| OpticOdds | No public permanent free quota | Contact sales | **Contract required.** Public terms do not clearly address API snapshot retention. |
| Sportmonks | Free plan only covers Danish Superliga and Scottish Premiership; paid plans get one 14-day trial | Starter from €29/month plus odds bundle; premium feed from €129/month | **Explicitly allowed.** Supplied data may be stored, but not resold without consent. |
| SportsDataIO | Limited trial; soccer trial is UEFA-Champions-League-only | Contact sales | **Contract required.** Public terms do not establish the necessary odds-retention license. |

## Official Sources

- [OddsPapi plans](https://oddspapi.io/sportsbooks), [terms](https://oddspapi.io/us/legal/terms)
- [SportsGameOdds pricing](https://sportsgameodds.com/), [terms](https://sportsgameodds.com/terms)
- [The Odds API pricing](https://the-odds-api.com/), [terms](https://the-odds-api.com/terms-and-conditions.html)
- [API-Football pricing](https://www.api-football.com/pricing), [terms](https://www.api-football.com/terms)
- [Odds-API.io pricing](https://odds-api.io/#pricing), [terms](https://odds-api.io/terms)
- [OpticOdds pricing](https://opticodds.com/pricing), [terms](https://opticodds.com/terms-of-service)
- [Sportmonks plans](https://www.sportmonks.com/football-api/), [terms](https://www.sportmonks.com/terms-of-service/)
- [SportsDataIO soccer docs](https://sportsdata.io/developers/api-documentation/soccer), [terms](https://sportsdata.io/terms-of-service)

## Investigation Trail

1. Separated permanent free tiers from trials.
2. Distinguished request quotas from SportsGameOdds' object quota.
3. Checked resale, storage, retention, and deletion clauses.
4. Did not infer storage permission where the terms were silent.

## Results

**Verdict: PARTIAL.** Quotas are documented, but persistent private snapshot rights remain unclear for most providers. Written confirmation is required before long-term retention, except where Sportmonks explicitly permits storage.
