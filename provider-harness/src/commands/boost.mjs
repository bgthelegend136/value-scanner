// Boost commands: price user-supplied boosted prices / Bet Builder parlays
// against sharp reference odds. Extracted from cli.mjs (Phase 3 command split);
// behaviour is identical — the CLI dispatcher just imports these handlers.
import { MARKET_MARGINS, analyzeBoost, comboOverround } from "../boost.mjs";
import { legFairProbabilities, parseLegPick } from "../boost_legs.mjs";
import { analyzeBoostMix, parseMixLeg, priceMixLeg } from "../boost_mix.mjs";
import { confirmCandidate } from "../mispricing_confirm.mjs";
import { matchCandidateEvent } from "../mispricing_match.mjs";
import { normalizeTheOddsResponse } from "../theodds_normalize.mjs";
import { signed } from "../cli_shared.mjs";

function flag(rest, name) {
  const hit = rest.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=")[1] : undefined;
}

export async function runBoostCheck(rest, { loadTheOddsKey, createTheOddsClient, out, err, now }) {
  const sportKey = flag(rest, "sport-key");
  const home = flag(rest, "home");
  const away = flag(rest, "away");
  const date = flag(rest, "date");
  const pick = flag(rest, "pick");
  const boosted = Number(flag(rest, "boost"));
  const baseFlag = flag(rest, "base");
  const base = baseFlag != null ? Number(baseFlag) : undefined;

  if (!sportKey || !home || !away || !date || !pick || !Number.isFinite(boosted) || boosted <= 1) {
    err("usage: boost-check --sport-key=K --home=H --away=A --date=ISO --pick=1|X|2 --boost=ODDS [--base=ODDS]\n");
    return 1;
  }
  const kickoff = new Date(date);
  if (!Number.isFinite(kickoff.getTime())) {
    err("boost-check: --date must be a valid ISO timestamp\n");
    return 1;
  }
  const outcome = String(pick).toUpperCase();
  if (!["1", "X", "2"].includes(outcome)) {
    err("boost-check: --pick must be 1, X, or 2\n");
    return 1;
  }

  // A boost is just a mispricing candidate the user supplies: feed it through the
  // same confirmation so offeredOdds = the boosted price yields its true EV.
  const candidate = {
    sportSlug: sportKey.startsWith("soccer") ? "football" : "other",
    leagueSlug: "",
    kickoffUtc: kickoff.toISOString(),
    participantOne: home,
    participantTwo: away,
    market: "MATCH_RESULT",
    line: "",
    outcome,
    offeredOdds: boosted,
  };

  const client = createTheOddsClient({ apiKey: await loadTheOddsKey() });
  const header = `Boost check: ${home} vs ${away} — pick ${outcome} @ ${boosted}${base ? ` (was ${base})` : ""}`;

  const events = await client.listEvents({ sportKey });
  const match = matchCandidateEvent(candidate, events.data ?? []);
  if (!match.event) {
    out(`${header}\n`);
    out(`The fixture could not be matched in the reference data (${match.reason}).\n`);
    return 0;
  }

  const odds = await client.getOdds({
    sportKey,
    eventIds: [String(match.event.id)],
    markets: "h2h",
  });
  const selections = normalizeTheOddsResponse(odds.data ?? [], odds.receivedAt);
  const result = confirmCandidate(candidate, match.event, selections, { now: now() });
  const quota = odds.quota?.remaining ?? "?";

  out(`${header}\n`);
  if (result.pinnacleEv === undefined) {
    out(`Could not verify against sharp odds (${result.reason}).\n`);
    out(`The Odds API quota remaining: ${quota}\n`);
    return 0;
  }

  out(`Pinnacle fair odds: ${result.pinnacleFairOdds.toFixed(2)} (EV ${signed(result.pinnacleEv * 100, 1)}%)\n`);
  out(`Consensus fair odds: ${result.consensusFairOdds.toFixed(2)} (EV ${signed(result.consensusEv * 100, 1)}%, ${result.consensusBooks} books)\n`);
  const positive = result.pinnacleEv > 0 && result.consensusEv > 0;
  out(`Verdict: ${positive ? "+EV — both sharp references agree" : "Not +EV"}\n`);
  out(`The Odds API quota remaining: ${quota}\n`);
  return 0;
}

// Resolve one combo leg to its de-vigged fair probabilities (Pinnacle + consensus)
// across market types (1X2, double chance, totals — see boost_legs.mjs). The leg
// pick token decides the market, so a Bet Builder boost can mix leg types.
async function priceBoostLeg(client, leg, now) {
  const spec = parseLegPick(leg.pick);
  if (!spec) return { ok: false, reason: "UNSUPPORTED_LEG_PICK", leg };
  const candidate = {
    kickoffUtc: new Date(leg.date).toISOString(),
    participantOne: leg.home,
    participantTwo: leg.away,
  };
  const events = await client.listEvents({ sportKey: leg.sportKey });
  const match = matchCandidateEvent(candidate, events.data ?? []);
  if (!match.event) return { ok: false, reason: match.reason, leg };
  // Totals legs need the totals market; everything else rides the h2h line.
  const markets = spec.market === "TOTALS" ? "totals" : "h2h";
  const odds = await client.getOdds({
    sportKey: leg.sportKey,
    eventIds: [String(match.event.id)],
    markets,
  });
  const selections = normalizeTheOddsResponse(odds.data ?? [], odds.receivedAt);
  const fair = legFairProbabilities(selections, match.event.id, spec, { now: now() });
  const quota = odds.quota?.remaining;
  if (!(fair.pinnacleFairProbability > 0)) {
    return { ok: false, reason: fair.reason, leg, quota };
  }
  return {
    ok: true,
    leg,
    spec,
    pinnacleFairProbability: fair.pinnacleFairProbability,
    consensusFairProbability: fair.consensusFairProbability,
    quota,
  };
}

function marketsForMixSpec(spec) {
  if (spec.market === "MATCH_RESULT") return "h2h";
  if (spec.market === "DOUBLE_CHANCE") return "h2h,double_chance";
  if (spec.market === "TOTALS") return "totals,alternate_totals";
  if (spec.market === "BTTS") return "btts";
  if (spec.market === "TEAM_TOTALS") return "team_totals,alternate_team_totals";
  if (spec.market === "CORNERS_TOTALS") return "alternate_totals_corners";
  if (spec.market === "CARDS_SPREAD") return "alternate_spreads_cards";
  if (spec.market === "PLAYER_GOALSCORER") return "player_goal_scorer_anytime";
  if (spec.market === "PLAYER_SHOTS") return "player_shots";
  if (spec.market === "PLAYER_SHOTS_ON_TARGET") return "player_shots_on_target";
  return "h2h";
}

async function priceBoostMixLeg(client, leg, now) {
  const spec = parseMixLeg(leg.pick);
  if (!spec) return { status: "UNVERIFIABLE", reason: "UNSUPPORTED_LEG", leg };
  const candidate = {
    kickoffUtc: new Date(leg.date).toISOString(),
    participantOne: leg.home,
    participantTwo: leg.away,
  };
  const events = await client.listEvents({ sportKey: leg.sportKey });
  const match = matchCandidateEvent(candidate, events.data ?? []);
  if (!match.event) return { status: "UNVERIFIABLE", reason: match.reason, leg, spec };
  const odds = await client.getEventOdds({
    sportKey: leg.sportKey,
    eventId: String(match.event.id),
    markets: marketsForMixSpec(spec),
  });
  const eventPayload = Array.isArray(odds.data) ? odds.data : [odds.data];
  const selections = normalizeTheOddsResponse(eventPayload, odds.receivedAt);
  return {
    ...priceMixLeg(selections, match.event.id, spec, { now: now() }),
    leg,
    quota: odds.quota?.remaining,
  };
}

function parseLegs(rest) {
  return rest
    .filter((arg) => arg.startsWith("--leg="))
    .map((arg) => {
      const [sportKey, home, away, date, pick] = arg.slice("--leg=".length).split(";");
      return { sportKey, home, away, date, pick: String(pick ?? "") };
    });
}

// Both boost commands price a parlay as the *product* of each leg's de-vigged
// fair probability, which assumes the legs are independent. That holds across
// different fixtures, but Bet Builder boosts routinely stack legs from the same
// match (e.g. Over 2.5 + BTTS), whose outcomes are correlated. We can't recover
// that correlation from one-sided sharp prices, so we surface it: the combined
// EV for any same-event group is an independence approximation, not a true price.
function sameEventLegWarning(legs) {
  const groups = new Map();
  legs.forEach((leg, index) => {
    const key = [leg.sportKey, leg.home, leg.away, leg.date]
      .map((part) => String(part ?? "").trim().toLowerCase())
      .join("|");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(index + 1);
  });
  const correlated = [...groups.values()].filter((indices) => indices.length > 1);
  if (correlated.length === 0) return "";
  const groupsText = correlated.map((indices) => `legs ${indices.join("+")}`).join(", ");
  return `Note: ${groupsText} are on the same event and are priced as independent; ` +
    "real correlation is not modeled, so the combined EV is approximate.\n";
}

// Price a multi-leg boosted parlay (e.g. a Stoiximan Bet Builder boost) against
// real sharp odds: fair combo probability is the product of each leg's de-vigged
// fair probability, so EV = boostedOdds * product - 1. v1: MATCH_RESULT legs only.
export async function runBoostCombo(rest, { loadTheOddsKey, createTheOddsClient, out, err, now }) {
  const boosted = Number(flag(rest, "boost"));
  const legs = parseLegs(rest);
  if (!Number.isFinite(boosted) || boosted <= 1 || legs.length < 2) {
    err('usage: boost-combo --boost=ODDS --leg="sportKey;home;away;date;pick" --leg=... (>=2 legs, pick 1|X|2)\n');
    return 1;
  }
  for (const leg of legs) {
    if (!leg.sportKey || !leg.home || !leg.away || !leg.date || !parseLegPick(leg.pick) ||
      !Number.isFinite(new Date(leg.date).getTime())) {
      err('boost-combo: each --leg needs "sportKey;home;away;date;pick"; pick = 1|X|2, double chance 1X|12|X2, or totals O2.5|U2.5\n');
      return 1;
    }
  }

  const client = createTheOddsClient({ apiKey: await loadTheOddsKey() });
  out(`Boost combo: ${legs.length} legs @ ${boosted}\n`);
  const correlationNote = sameEventLegWarning(legs);
  if (correlationNote) out(correlationNote);

  const priced = [];
  let quota = "?";
  for (const leg of legs) {
    const result = await priceBoostLeg(client, leg, now);
    if (result.quota !== undefined) quota = result.quota;
    priced.push(result);
  }

  priced.forEach((p, index) => {
    const label = `Leg ${index + 1}: ${p.leg.home} vs ${p.leg.away} pick ${p.leg.pick}`;
    out(p.ok
      ? `  ${label} — fair ${(1 / p.pinnacleFairProbability).toFixed(2)}\n`
      : `  ${label} — could not price (${p.reason})\n`);
  });

  if (priced.some((p) => !p.ok)) {
    out("Combo cannot be verified: at least one leg is unpriced.\n");
    out(`The Odds API quota remaining: ${quota}\n`);
    return 0;
  }

  const comboPinnacle = priced.reduce((acc, p) => acc * p.pinnacleFairProbability, 1);
  const comboConsensus = priced.reduce((acc, p) => acc * p.consensusFairProbability, 1);
  const evPinnacle = boosted * comboPinnacle - 1;
  const evConsensus = boosted * comboConsensus - 1;
  out(`Pinnacle fair odds (combo): ${(1 / comboPinnacle).toFixed(2)} (EV ${signed(evPinnacle * 100, 1)}%)\n`);
  out(`Consensus fair odds (combo): ${(1 / comboConsensus).toFixed(2)} (EV ${signed(evConsensus * 100, 1)}%)\n`);
  const positive = evPinnacle > 0 && evConsensus > 0;
  out(`Verdict: ${positive ? "+EV — both sharp references agree" : "Not +EV"}\n`);
  out(`The Odds API quota remaining: ${quota}\n`);
  return 0;
}

export async function runBoostMix(rest, { loadTheOddsKey, createTheOddsClient, out, err, now }) {
  const boosted = Number(flag(rest, "boost"));
  const legs = parseLegs(rest);
  if (!Number.isFinite(boosted) || boosted <= 1 || legs.length < 2) {
    err('usage: boost-mix --boost=ODDS --leg="sportKey;home;away;date;pick" --leg=... (>=2 legs)\n');
    return 1;
  }
  for (const leg of legs) {
    if (!leg.sportKey || !leg.home || !leg.away || !leg.date ||
      !Number.isFinite(new Date(leg.date).getTime())) {
      err('boost-mix: each --leg needs "sportKey;home;away;date;pick"\n');
      return 1;
    }
  }

  const client = createTheOddsClient({ apiKey: await loadTheOddsKey() });
  out(`Boost mix: ${legs.length} legs @ ${boosted}\n`);
  const correlationNote = sameEventLegWarning(legs);
  if (correlationNote) out(correlationNote);

  const priced = [];
  let quota = "?";
  for (const leg of legs) {
    const result = await priceBoostMixLeg(client, leg, now);
    if (result.quota !== undefined) quota = result.quota;
    priced.push(result);
  }

  priced.forEach((p, index) => {
    const label = `Leg ${index + 1}: ${p.leg.home} vs ${p.leg.away} pick ${p.leg.pick}`;
    if (p.status === "VERIFIED") {
      out(`  ${label} - VERIFIED, fair ${(1 / p.pinnacleFairProbability).toFixed(2)} Pinnacle / ${(1 / p.consensusFairProbability).toFixed(2)} consensus\n`);
    } else if (p.status === "ESTIMATE_ONLY") {
      out(`  ${label} - estimate only, fair about ${(1 / p.estimateProbability).toFixed(2)} (${p.reason})\n`);
    } else {
      out(`  ${label} - unverified (${p.reason})\n`);
    }
  });

  const analysis = analyzeBoostMix({ boostedOdds: boosted, legResults: priced });
  out(`Status: ${analysis.status}\n`);
  if (analysis.status === "FULLY_VERIFIED") {
    out(`Pinnacle fair odds: ${analysis.pinnacleFairOdds.toFixed(2)} (EV ${signed(analysis.pinnacleEv * 100, 1)}%)\n`);
    out(`Consensus fair odds: ${analysis.consensusFairOdds.toFixed(2)} (EV ${signed(analysis.consensusEv * 100, 1)}%)\n`);
  } else if (analysis.status === "MIXED_ESTIMATE") {
    out(`Estimated fair odds: ${analysis.estimatedFairOdds.toFixed(2)} (EV ${signed(analysis.estimatedEv * 100, 1)}%)\n`);
    out("Warning: estimate only legs are not strict verified value and must not be used for alerts.\n");
  } else {
    out("Combo cannot be priced: at least one leg is unsupported or has no usable reference.\n");
  }
  out(`The Odds API quota remaining: ${quota}\n`);
  return 0;
}

// `boost` is pure arithmetic — no network, no keys, no quota.
export function runBoost(rest, { out, err }) {
  const baseOdds = Number(flag(rest, "base"));
  const boostedOdds = Number(flag(rest, "boost"));
  if (!Number.isFinite(baseOdds) || !Number.isFinite(boostedOdds)) {
    err("usage: boost --base=<odds> --boost=<odds> [--market=<type> [--legs=N] | --margin=<percent>]\n");
    return 1;
  }

  const marginFlag = flag(rest, "margin");
  const marketFlag = flag(rest, "market");
  const legs = Number(flag(rest, "legs") ?? 1);

  let overround;
  let assumption;
  if (marginFlag != null) {
    overround = Number(marginFlag) / 100;
    assumption = `assumed total margin ${Number(marginFlag).toFixed(1)}%`;
  } else if (marketFlag != null) {
    const perLeg = MARKET_MARGINS[marketFlag];
    if (perLeg === undefined) {
      err(`unknown market: ${marketFlag}\nknown markets: ${Object.keys(MARKET_MARGINS).join(", ")}\n`);
      return 1;
    }
    overround = comboOverround(perLeg, legs);
    assumption = `${marketFlag} ×${legs} leg(s) → overround ${(overround * 100).toFixed(1)}%`;
  }

  let analysis;
  try {
    analysis = analyzeBoost({ baseOdds, boostedOdds, overround });
  } catch (error) {
    err(`error: ${error.message}\n`);
    return 1;
  }

  const lines = [
    `Boost check: ${baseOdds} → ${boostedOdds}`,
    `Boost multiplier: ×${analysis.multiplier.toFixed(3)} (${signed(analysis.breakEvenMargin * 100, 1)}%)`,
    `Break-even: +EV as long as the base-market margin is under ${(analysis.breakEvenMargin * 100).toFixed(1)}%.`,
  ];

  if (analysis.ev === undefined) {
    lines.push("");
    lines.push("No market given — typical TOTAL margins to compare against:");
    for (const [name, margin] of Object.entries(MARKET_MARGINS)) {
      lines.push(`  ${name.padEnd(11)} ${(margin * 100).toFixed(0)}%`);
    }
    lines.push("Re-run with --market=<type> [--legs=N] or --margin=<percent> for a verdict.");
  } else {
    lines.push("");
    lines.push(`Market: ${assumption}`);
    lines.push(`Fair odds needed: ${analysis.fairBoostOdds.toFixed(2)} (you have ${boostedOdds})`);
    lines.push(`EV: ${signed(analysis.ev * 100, 1)}%  →  ${analysis.verdict}`);
  }

  out(lines.join("\n") + "\n");
  return 0;
}
