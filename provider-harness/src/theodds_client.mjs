function quotaFrom(headers) {
  const integer = (name) => {
    const value = Number(headers.get(name));
    return Number.isFinite(value) ? value : null;
  };
  return {
    remaining: integer("x-requests-remaining"),
    used: integer("x-requests-used"),
    lastCost: integer("x-requests-last"),
  };
}

export function createTheOddsApiClient({
  apiKey,
  fetchImpl = fetch,
  baseUrl = "https://api.the-odds-api.com/v4",
}) {
  async function request(path, parameters) {
    const url = new URL(`${baseUrl.replace(/\/$/u, "")}${path}`);
    url.searchParams.set("apiKey", apiKey);
    for (const [name, value] of Object.entries(parameters)) {
      url.searchParams.set(name, String(value));
    }
    let response;
    try {
      response = await fetchImpl(url);
    } catch {
      throw new Error("The Odds API network request failed");
    }
    const receivedAt = new Date().toISOString();
    if (!response.ok) {
      throw new Error(`The Odds API request failed with status ${response.status}`);
    }
    return { data: await response.json(), receivedAt, quota: quotaFrom(response.headers) };
  }

  return {
    listSports({ all = false } = {}) {
      return request("/sports", { all });
    },
    listEvents({ sportKey }) {
      return request(`/sports/${sportKey}/events`, {});
    },
    getOdds({
      sportKey,
      regions = "eu",
      markets = "h2h,totals",
      oddsFormat = "decimal",
      eventIds,
      includeLinks = false,
    }) {
      const parameters = { regions, markets, oddsFormat };
      if (eventIds?.length) parameters.eventIds = eventIds.join(",");
      if (includeLinks) parameters.includeLinks = true;
      return request(`/sports/${sportKey}/odds`, parameters);
    },
    getEventOdds({
      sportKey,
      eventId,
      regions = "eu",
      markets,
      oddsFormat = "decimal",
    }) {
      return request(`/sports/${sportKey}/events/${eventId}/odds`, { regions, markets, oddsFormat });
    },
    getEventMarkets({
      sportKey,
      eventId,
      regions = "eu",
      dateFormat = "iso",
    }) {
      return request(`/sports/${sportKey}/events/${eventId}/markets`, { regions, dateFormat });
    },
    getHistoricalOdds({
      sportKey,
      date,
      regions = "eu",
      markets = "h2h,totals",
      oddsFormat = "decimal",
    }) {
      return request(`/historical/sports/${sportKey}/odds`, { date, regions, markets, oddsFormat });
    },
    getHistoricalEvents({
      sportKey,
      date,
      dateFormat = "iso",
      eventIds,
      commenceTimeFrom,
      commenceTimeTo,
    }) {
      const parameters = { date, dateFormat };
      if (eventIds?.length) parameters.eventIds = eventIds.join(",");
      if (commenceTimeFrom) parameters.commenceTimeFrom = commenceTimeFrom;
      if (commenceTimeTo) parameters.commenceTimeTo = commenceTimeTo;
      return request(`/historical/sports/${sportKey}/events`, parameters);
    },
    getHistoricalEventOdds({
      sportKey,
      eventId,
      date,
      regions = "eu",
      markets = "h2h",
      dateFormat = "iso",
      oddsFormat = "decimal",
    }) {
      return request(`/historical/sports/${sportKey}/events/${eventId}/odds`, {
        date,
        regions,
        markets,
        dateFormat,
        oddsFormat,
      });
    },
    getScores({ sportKey, daysFrom = 3, dateFormat = "iso" }) {
      return request(`/sports/${sportKey}/scores`, { daysFrom, dateFormat });
    },
  };
}
