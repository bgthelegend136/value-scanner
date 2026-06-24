const ALIASES = new Map([
  ["bosnia and herzegovina", "bosnia"],
  ["bosnia herzegovina", "bosnia"],
  ["korea republic", "south korea"],
  ["republic of korea", "south korea"],
  ["united states", "usa"],
  ["united states of america", "usa"],
  ["turkiye", "turkey"],
  ["cote d ivoire", "ivory coast"],
  ["congo dr", "dr congo"],
  ["democratic republic of congo", "dr congo"],
  ["czech republic", "czechia"],
  ["china pr", "china"],
  ["ir iran", "iran"],
]);

export function normalizeTeamName(name) {
  let value = String(name ?? "").toLowerCase().trim();
  value = value.normalize("NFD").replace(/[̀-ͯ]/gu, "");
  value = value.replace(/[.&'-]/gu, " ").replace(/\s+/gu, " ").trim();
  return ALIASES.get(value) ?? value;
}

export function matchFixtures(referenceEvents, bettableEvents, { toleranceSeconds = 120 } = {}) {
  const pairs = [];
  for (const reference of referenceEvents) {
    const home = normalizeTeamName(reference.homeTeam);
    const away = normalizeTeamName(reference.awayTeam);
    const referenceTime = Date.parse(reference.kickoffUtc);
    const found = bettableEvents.find((bettable) => {
      const bettableTime = Date.parse(bettable.kickoffUtc);
      if (!Number.isFinite(referenceTime) || !Number.isFinite(bettableTime)) return false;
      if (Math.abs(referenceTime - bettableTime) > toleranceSeconds * 1000) return false;
      return normalizeTeamName(bettable.homeTeam) === home && normalizeTeamName(bettable.awayTeam) === away;
    });
    if (found) {
      pairs.push({
        referenceEventId: String(reference.eventId),
        bettableEventId: String(found.eventId),
        homeTeam: reference.homeTeam,
        awayTeam: reference.awayTeam,
        kickoffUtc: reference.kickoffUtc,
      });
    }
  }
  return pairs;
}
