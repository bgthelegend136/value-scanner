# Provider Spike Conventions

## Evidence Levels

- `DOCUMENTED`: provider-owned documentation, pricing, or terms.
- `OBSERVED`: returned by an official endpoint during the spike.
- `SALES CLAIM`: marketing statement not demonstrated by an endpoint.
- `UNKNOWN`: unavailable publicly or without credentials.

## Regional Confidence

- `GR_CONFIRMED`: provider explicitly labels Greece/GR.
- `UNVERIFIED`: brand exists but country identity is missing.
- `NON_GR`: another country/region is explicit.

## Alert Safety

Only `GR_CONFIRMED` feeds may participate in comparisons. At least two eligible feeds are required.

## Validation Pattern

1. Public documentation and terms review.
2. Authenticated event-level probe using user-owned credentials.
3. Written confirmation for region identity, storage, provenance, SLA, and paid coverage.
