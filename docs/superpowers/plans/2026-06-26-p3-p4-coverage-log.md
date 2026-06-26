# P3/P4 coverage log - 2026-06-26

## Scope

Goal: reduce the scanner coverage gap without weakening the money-path confirmation rules.

Available provider keys are only:

- Odds-API.io: candidate discovery source.
- The Odds API: reference confirmation source.

No third sharp/reference provider is available in this workspace. Therefore P3 cannot be activated as a live second-provider confirmation path yet. Using Odds-API.io as both candidate source and confirmation source would be circular, so it remains excluded from reference confirmation.

## Implemented

- Added optional secondary reference-source plumbing inside `runMispricingScan`.
- Preserved strict confirmation: a secondary source can only be tried after coverage failures such as no event match, no exact Pinnacle market, or insufficient consensus. It does not override negative EV, stale data, ambiguity, quota reserve, or delivery failures.
- Added `referenceSource` to queue, alert, audit, and CLV rows so every future confirmed alert records which reference source produced it.
- Kept the production CLI on the existing providers only. No live secondary provider is configured or scheduled.
- Added explicit league-title aliases for observed unmapped leagues from the local audit: Puerto Rico BSN, club friendlies, and Victoria NPL women variants. These aliases only work against a unique active The Odds API sport, so the mapper still fails closed.

## Not implemented

- No OpticOdds adapter or other third-party adapter was added.
- No scheduler was enabled.
- No live API calls were required for this change.

## Live coverage check - 2026-06-26

A live dry-run was executed against a temporary reports directory, not the production reports folder.

Result:

```json
{"candidates":1,"mapped":0,"verifiedSports":0,"confirmed":0,"sent":0,"deferred":0,"rejected":110,"dryRun":true,"quotaRemaining":361}
```

The current live candidate was `basketball|indonesia-ibl-playoffs` (`Indonesia - IBL, Playoffs`). The Odds API active sports list had no Indonesia/IBL basketball sport and only one active basketball key (`basketball_wnba`), so this candidate correctly remains fail-closed as unmapped.

Additional P4 updates from observed audit/current active coverage:

- Added direct seed mappings for `baseball|usa-mlb`, `football|brazil-brasileiro-serie-a`, and `football|ireland-premier-division`.
- Added explicit title aliases for Brazil Serie A and League of Ireland naming differences.
- Did not map unsupported leagues such as Indonesia IBL, Australia NBL1, club friendlies, or low-tier regional football where The Odds API currently has no active matching sport.
## Verification

Focused verification passed:

```powershell
cd provider-harness
node --test test/mispricing_scan.test.mjs test/mispricing_state.test.mjs test/multisport_map.test.mjs
```

Result: 30/30 passing.

Additional focused mapping verification passed:

```powershell
cd provider-harness
node --test test/multisport_map.test.mjs
```

Result: 8/8 passing.

Full-suite verification passed:

```powershell
cd provider-harness
node --test
```

Result: 175/175 passing.

## Next practical step

With only the two current providers, the best coverage work is P4-style mapping and event alias expansion based on audit rows. True P3 live second-reference activation needs a third independent reference provider key and a small response sample for sports/events/odds.