const IDENTITY_FIELDS = [
  "bookmaker",
  "eventId",
  "kickoffUtc",
  "period",
  "market",
  "line",
  "outcome",
];

function impliedProbability(decimalOdds) {
  return 1 / decimalOdds;
}

export function compareObservation(selection, manual) {
  for (const field of IDENTITY_FIELDS) {
    if (String(selection[field] ?? "") !== String(manual[field] ?? "")) {
      throw new Error(`identity mismatch: ${field}`);
    }
  }

  const apiTime = Date.parse(selection.receivedAt);
  const siteTime = Date.parse(manual.siteObservedAt);
  if (!Number.isFinite(apiTime) || !Number.isFinite(siteTime)) {
    throw new Error("invalid observation timestamp");
  }
  const observationSkewSeconds = Math.abs(apiTime - siteTime) / 1000;
  if (observationSkewSeconds > 10) {
    throw new Error("observation skew exceeds 10 seconds");
  }

  const siteOdds = Number(manual.siteOdds);
  if (!Number.isFinite(siteOdds) || siteOdds <= 1) {
    throw new Error("siteOdds must be a decimal price greater than 1");
  }

  const absoluteDifference = Math.abs(selection.decimalOdds - siteOdds);
  const impliedProbabilityDifferencePp =
    (impliedProbability(selection.decimalOdds) - impliedProbability(siteOdds)) * 100;
  let classification = "MISMATCH";
  if (absoluteDifference <= 0.0100000001) classification = "EXACT";
  else if (
    absoluteDifference <= 0.0200000001 ||
    Math.abs(impliedProbabilityDifferencePp) <= 0.5
  ) {
    classification = "ACCEPTABLE";
  } else if (absoluteDifference > 0.05) {
    classification = "LARGE_MISMATCH";
  }

  return {
    ...selection,
    siteOdds,
    siteObservedAt: manual.siteObservedAt,
    observationSkewSeconds,
    absoluteDifference,
    impliedProbabilityDifferencePp,
    classification,
    notes: manual.notes ?? "",
  };
}

export function summarizeComparisons(results) {
  const groups = new Map();
  for (const result of results) {
    const key = `${result.bookmaker}\u0000${result.market}`;
    const group = groups.get(key) ?? {
      bookmaker: result.bookmaker,
      market: result.market,
      observations: 0,
      exact: 0,
      acceptableOrBetter: 0,
      largeMismatches: 0,
      signedProbabilityDifferenceTotal: 0,
    };
    group.observations += 1;
    if (result.classification === "EXACT") group.exact += 1;
    if (result.classification === "EXACT" || result.classification === "ACCEPTABLE") {
      group.acceptableOrBetter += 1;
    }
    if (result.classification === "LARGE_MISMATCH") group.largeMismatches += 1;
    group.signedProbabilityDifferenceTotal += result.impliedProbabilityDifferencePp;
    groups.set(key, group);
  }

  return [...groups.values()].map((group) => ({
    bookmaker: group.bookmaker,
    market: group.market,
    observations: group.observations,
    exactRate: group.exact / group.observations,
    acceptableRate: group.acceptableOrBetter / group.observations,
    largeMismatchRate: group.largeMismatches / group.observations,
    meanSignedImpliedProbabilityDifferencePp:
      group.signedProbabilityDifferenceTotal / group.observations,
  }));
}
