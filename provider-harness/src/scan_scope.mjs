// Sports we can neither settle for free (football-data.org covers soccer; ESPN
// covers NFL/NCAAF/NBA/WNBA/MLB/AFL + a few soccer cups) nor have a soft-book
// edge in. Paper bets in these just rot as PENDING and add noise to ROI and
// calibration, so the scan skips them by default. Override with
// `--include-all-sports`.
export const UNSCANNABLE_SPORT_PATTERNS = [
  /^boxing/u,
  /^mma/u,
  /^cricket/u,
  /^baseball_kbo$/u,
  /^baseball_npb$/u,
];

export function isPaperScannableSport(sportKey) {
  const key = String(sportKey ?? "");
  return !UNSCANNABLE_SPORT_PATTERNS.some((pattern) => pattern.test(key));
}

export function filterScannableSports(sportKeys) {
  return sportKeys.filter(isPaperScannableSport);
}
