# P8 Live Betting Scope - Measurement First

Date: 2026-06-27

This is scope-only groundwork. It does not authorize scraping, login,
auto-betting, URL fabrication, Telegram floor changes, or alerting from
estimated legs.

## Product Boundary

Live betting means faster measurement and, later, faster alerts to the human.
The human decides and places any bet manually. Every automated alert still needs
the existing strict confirmation rule: Pinnacle fair probability plus 3-book
consensus EV over the floor. Missing, stale, ambiguous, or unsupported reference
data means no alert.

## Building Blocks

- Odds-API.io WebSocket `odds` channel for low-latency soft-book price changes.
- Odds-API.io WebSocket `scores` and `status` channels for in-play state.
- Odds-API.io `/events/live`, `/odds/movements`, and paid `/dropping-odds` for
  later cross-checking and post-move attribution.
- The Odds API historical odds for fair-probability calibration, not soft-book
  strategy backtesting.

## Current Probe

`provider-harness/scripts/ws-lifetime-probe.mjs` is the first concrete step. It
tracks how long strict confirmed Stoiximan/Novibet +EV windows stay alive using
Node 22's built-in `WebSocket`, `seq`/`lastSeq` replay, The Odds API reference
cross-checking, and local CSV logs.

The WebSocket odds payload itself does not include expected value, so the probe
derives it by matching the WS event to The Odds API and applying the existing
strict rule: Pinnacle fair EV plus 3-book consensus EV must both clear the 10%
floor. Raw longshot movement, such as 17 -> 12, is not enough unless it passes
that confirmation.

## Buy / Do Not Buy Rule

- If a meaningful share of observed strict confirmed >=10% edges closes
  in under roughly 2-5 minutes, WebSocket likely pays for itself.
- If most opportunities persist for more than roughly 10 minutes, improve polling
  cadence and do not pay for the add-on.

## Open Questions

- Whether The Odds API has enough in-play Pinnacle and consensus coverage for
  strict live confirmation.
- Whether Odds-API.io `/odds/movements` can reliably explain the Iraq 17 -> 12
  collapse as a real catchable price window versus stale display.
- Which live sports/leagues produce enough verified mistakes to justify any
  operational complexity beyond measurement.
