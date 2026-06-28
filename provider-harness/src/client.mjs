function rateLimitFrom(headers) {
  const integer = (name) => {
    const value = Number(headers.get(name));
    return Number.isFinite(value) ? value : null;
  };
  return {
    limit: integer("x-ratelimit-limit"),
    remaining: integer("x-ratelimit-remaining"),
    resetAt: headers.get("x-ratelimit-reset"),
  };
}

function sequenceFrom(headers) {
  const value = Number(headers.get("x-oddsapi-seq"));
  return Number.isFinite(value) ? value : null;
}

export function createOddsApiClient({
  apiKey,
  fetchImpl = fetch,
  baseUrl = "https://api.odds-api.io/v3",
}) {
  async function request(path, parameters) {
    const url = new URL(`${baseUrl.replace(/\/$/u, "")}/${path}`);
    url.searchParams.set("apiKey", apiKey);
    for (const [name, value] of Object.entries(parameters)) {
      url.searchParams.set(name, String(value));
    }

    const response = await fetchImpl(url);
    const receivedAt = new Date().toISOString();
    if (!response.ok) {
      throw new Error(`Odds-API.io request failed with status ${response.status}`);
    }
    return {
      data: await response.json(),
      receivedAt,
      rateLimit: rateLimitFrom(response.headers),
      seq: sequenceFrom(response.headers),
    };
  }

  return {
    listSelectedBookmakers() {
      return request("bookmakers/selected", {});
    },
    listLiveEvents({ sport } = {}) {
      const parameters = {};
      if (sport) parameters.sport = sport;
      return request("events/live", parameters);
    },
    listEvents({
      sport = "football",
      limit = 5,
      league,
      status,
      from,
      to,
      bookmaker,
      skip,
    } = {}) {
      const parameters = { sport, limit };
      if (league) parameters.league = league;
      if (status) parameters.status = status;
      if (from) parameters.from = from;
      if (to) parameters.to = to;
      if (bookmaker) parameters.bookmaker = bookmaker;
      if (skip !== undefined) parameters.skip = skip;
      return request("events", parameters);
    },
    getOdds({ eventId, bookmakers }) {
      return request("odds", {
        eventId,
        bookmakers: bookmakers.join(","),
      });
    },
    getOddsMulti({ eventIds, bookmakers, includeSeq = false }) {
      const parameters = {
        eventIds: eventIds.join(","),
        bookmakers: bookmakers.join(","),
      };
      if (includeSeq) parameters.includeSeq = true;
      return request("odds/multi", parameters);
    },
    getOddsUpdated({ since, bookmaker, sport }) {
      return request("odds/updated", { since, bookmaker, sport });
    },
    getOddsMovements({ eventId, bookmaker, market, marketLine }) {
      const parameters = { eventId, bookmaker, market };
      if (marketLine !== undefined && marketLine !== "") parameters.marketLine = marketLine;
      return request("odds/movements", parameters);
    },
  };
}
