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
    };
  }

  return {
    listEvents({ sport = "football", limit = 5, league, status } = {}) {
      const parameters = { sport, limit };
      if (league) parameters.league = league;
      if (status) parameters.status = status;
      return request("events", parameters);
    },
    getOdds({ eventId, bookmakers }) {
      return request("odds", {
        eventId,
        bookmakers: bookmakers.join(","),
      });
    },
  };
}
