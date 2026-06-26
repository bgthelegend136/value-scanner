---
spike: 002
name: bookmaker-and-region-coverage
type: comparison
validates: "Given the target bookmaker list, when official catalogs are checked, then availability and Greece-facing confidence can be classified"
verdict: PARTIAL
related: [001]
tags: [bookmakers, region, greece]
---

# Spike 002: Bookmaker and Regional Feed Coverage

`GR-CONFIRMED` means the provider explicitly labels Greece/GR. Generic EU, Europe, or brand-only feeds are `UNVERIFIED`.

| Provider | Stoiximan | Novibet | Pamestoixima | Bet365 | Betsson | Bwin | Superbet | Vbet |
|---|---|---|---|---|---|---|---|---|
| OddsPapi | UNVERIFIED | ABSENT | **GR-CONFIRMED** | UNVERIFIED | UNVERIFIED | UNVERIFIED generic | NON-GR variants BR/PL/RO/RS | UNVERIFIED generic |
| SportsGameOdds free | ABSENT | ABSENT | ABSENT | ABSENT | ABSENT | ABSENT | ABSENT | ABSENT |
| SportsGameOdds paid | UNKNOWN | UNKNOWN | UNKNOWN | UNVERIFIED | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN |
| The Odds API | ABSENT | ABSENT | ABSENT | ABSENT | UNVERIFIED EU/SE | ABSENT | ABSENT | ABSENT |
| API-Football | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN |
| Odds-API.io | UNVERIFIED | UNVERIFIED | UNVERIFIED | UNVERIFIED | ABSENT | **NON-GR** ES/FR/IT | UNVERIFIED | UNVERIFIED |
| OpticOdds | ABSENT | ABSENT | ABSENT | UNVERIFIED | UNVERIFIED | UNVERIFIED | UNVERIFIED | ABSENT |
| Sportmonks | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN |
| SportsDataIO | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN |

## Evidence

- OddsPapi lists Stoiximan, `Pamestoixima GR`, Bet365, Betsson, generic Bwin, regional Superbet variants, and generic/regional Vbet. Novibet is absent.
- Odds-API.io lists Stoiximan, Novibet, Pamestoixima, Bet365, Superbet, and Vbet. Betsson is absent. Bwin is Spain/France/Italy only.
- OpticOdds lists Bet365, Betsson, bwin, and Superbet, without country-level identity.
- The Odds API lists Betsson under broad EU/SE regions, not Greece.
- SportsGameOdds' nine free books contain none of the target list. Bet365 is shown on Pro.
- API-Football and Sportmonks require authenticated bookmaker-catalog access.

## Official Sources

- [OddsPapi sportsbooks](https://oddspapi.io/sportsbooks)
- [Odds-API.io sportsbooks](https://odds-api.io/sportsbooks)
- [OpticOdds sportsbooks](https://developer.opticodds.com/docs/sportsbooks)
- [The Odds API bookmaker regions](https://the-odds-api.com/sports-odds-data/bookmaker-apis.html)
- [SportsGameOdds plans](https://sportsgameodds.com/)

## Investigation Trail

1. Matched exact brand and country-variant names.
2. Rejected broad regional labels as proof of Greece-facing prices.
3. Marked explicit non-Greek variants as ineligible.
4. Identified `Pamestoixima GR` at OddsPapi as the only public GR-confirmed target feed.

## Results

**Verdict: PARTIAL.** No provider publicly confirms two Greece-facing target books. Comparison alerts must remain disabled until at least two feeds receive `GR-CONFIRMED` status.
