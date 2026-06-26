# Provider Discovery Spike Manifest

## Idea

Evaluate legal free or free-tier sports-odds APIs for a FIFA World Cup pre-match odds scanner before any MVP implementation begins.

## Requirements

- Do not build the full MVP during this spike.
- Do not scrape bookmaker websites.
- Do not implement auto-betting.
- Target bookmakers: Stoiximan, Novibet, Pamestoixima, Bet365, Betsson, Bwin, Superbet, and Vbet.
- Target markets: 1X2 (including Draw), Double Chance, Under 2.5, Under 3.5, and Team Goals Over/Under.
- A bookmaker feed is ineligible for alerts unless the provider confirms that it is Greece-facing.
- Region-unverified feeds must be marked `UNVERIFIED` and excluded from alerts by default.
- Distinguish documented facts, observed API behavior, provider sales claims, and unknowns.
- Treat private snapshot-storage rights as unknown unless official terms or written provider confirmation address them.

## Spikes

| # | Name | Type | Validates | Verdict | Tags |
|---|------|------|-----------|---------|------|
| 001 | free-tier-and-terms | comparison | Given the candidate providers, when official plans and terms are reviewed, then usable quotas and storage rights can be identified | PARTIAL | pricing, terms, storage |
| 002 | bookmaker-and-region-coverage | comparison | Given the target bookmaker list, when official catalogs are checked, then availability and Greece-facing confidence can be classified | PARTIAL | bookmakers, region |
| 003 | competition-and-market-coverage | comparison | Given the World Cup use case and target markets, when official catalogs and endpoints are checked, then event and market suitability can be classified | PARTIAL | world-cup, markets |
| 004 | operational-fit | comparison | Given the scanner workflow, when freshness metadata, documentation, implementation effort, and upgrades are reviewed, then operational risks can be compared | VALIDATED | latency, docs, integration |
| 005 | provider-decision | standard | Given the evidence from spikes 001-004, when providers are ranked, then a defensible free-validation and paid-MVP recommendation can be made | VALIDATED | recommendation |
