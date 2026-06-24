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
    const response = await fetchImpl(url);
    const receivedAt = new Date().toISOString();
    if (!response.ok) {
      throw new Error(`The Odds API request failed with status ${response.status}`);
    }
    return { data: await response.json(), receivedAt, quota: quotaFrom(response.headers) };
  }

  return {
    listEvents({ sportKey }) {
      return request(`/sports/${sportKey}/events`, {});
    },
    getOdds({ sportKey, regions = "eu", markets = "h2h,totals", oddsFormat = "decimal" }) {
      return request(`/sports/${sportKey}/odds`, { regions, markets, oddsFormat });
    },
  };
}
