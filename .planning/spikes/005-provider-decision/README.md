---
spike: 005
name: provider-decision
type: standard
validates: "Given the evidence from spikes 001-004, when providers are ranked, then a defensible free-validation and paid-MVP recommendation can be made"
verdict: VALIDATED
related: [001, 002, 003, 004]
tags: [recommendation, decision]
---

# Spike 005: Provider Decision

Research date: 2026-06-24.

## 1. Best Provider for Free Validation

**Odds-API.io**, with alerts disabled until feed-region confirmation.

- 100 requests/hour and two selected books are adequate for a small real-data test.
- Stoiximan and Novibet appear in the public catalog.
- World Cup, 1X2, totals, and Double Chance are documented.
- Official SDKs and REST documentation reduce test effort.

Neither book is explicitly Greece-facing. The feed can validate authentication, fixtures, normalization, market availability, and timestamps, but cannot produce eligible comparison alerts.

**Runner-up: OddsPapi.** It has broader target coverage and the only explicit `Pamestoixima GR`, but only 250 requests/month, no Novibet, and no explicit public World Cup confirmation.

## 2. Best Provider for a Serious Paid MVP

**Conditional coverage winner: OddsPapi.**

It lists seven of eight target brands and explicitly identifies `Pamestoixima GR`. It becomes the preferred primary only if written confirmation establishes:

1. World Cup 2026 pre-match coverage.
2. Greece-facing Stoiximan and at least one additional target feed.
3. Exact target markets by bookmaker.
4. Private snapshot-storage rights.
5. Data provenance and update SLA.
6. Acceptable pricing.

**Operational secondary: OpticOdds.** It has the best timestamps, last-polled endpoint, historical support, and documentation, but only four target brands and none of the Greek trio.

**Established football alternative: Sportmonks Premium/TXODDS.** It documents World Cup coverage, 50+ books, 150+ markets, and storage permission. Its target-book and regional matrix must be proven in a trial.

No provider is unconditionally production-approved from public evidence.

## 3. Keep Odds-API.io?

**Keep it for the first provider test; do not lock the paid MVP to it.**

Its free quota and World Cup/core-market documentation make it the best starting probe. Its missing Greece-specific feed identity blocks production alerts.

## 4. Build a Tiny Provider-Test Script?

**Yes. Mandatory before the MVP.**

With user-owned free/trial keys, it should:

1. List bookmaker IDs.
2. List active World Cup fixtures.
3. Fetch one fixture for selected target books.
4. Enumerate markets, periods, outcomes, and lines.
5. Record provider, bookmaker-update, and local-receipt timestamps.
6. Assign `GR_CONFIRMED`, `UNVERIFIED`, or `NON_GR`.
7. Refuse comparisons unless two feeds are `GR_CONFIRMED`.
8. Retain only the test report until storage rights are confirmed.

First keys: Odds-API.io and OddsPapi. Consider Sportmonks or OpticOdds trials only afterward.

## Ranked Recommendation

| Rank/use | Provider | Decision |
|---|---|---|
| 1 — free validation | Odds-API.io | Best quota and documented World Cup/core markets; no alerts until region confirmation |
| 2 — free validation | OddsPapi | Best target catalog and one GR-confirmed feed; lower quota and World Cup uncertainty |
| 1 — paid coverage candidate | OddsPapi | Best target count; requires written contractual confirmation |
| 1 — paid operational secondary | OpticOdds | Best freshness observability; insufficient Greek coverage |
| 2 — paid football candidate | Sportmonks Premium/TXODDS | Broad documented product; target/regional matrix hidden |
| General fallback | The Odds API | Excellent transparency; only Betsson matches target list |
| Context-data candidate | API-Football | Useful later for fixtures/lineups; odds identity too opaque |
| Not suitable for free test | SportsGameOdds | Free plan is US-centric |
| Not suitable for free test | SportsDataIO | Free soccer trial excludes World Cup |

## Investigation Trail

1. Ranked free validation separately from paid production suitability.
2. Applied the Greece-facing rule before considering any provider alert-capable.
3. Preferred documented World Cup and market coverage over raw bookmaker-count claims.
4. Treated public gaps as test or contract gates rather than favorable assumptions.
5. Required a disposable provider harness before any MVP implementation.

## Results

**Verdict: VALIDATED.** Full MVP work remains paused. The next engineering action is a tiny Odds-API.io plus OddsPapi validation harness, followed by a provider decision based on real event-level output and written regional confirmation.
