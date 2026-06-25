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

export function createValueBetsClient({
  apiKey,
  fetchImpl = fetch,
  baseUrl = "https://api.odds-api.io/v3",
}) {
  return {
    async getValueBets({
      bookmaker,
      includeEventDetails = true,
    }) {
      const url = new URL(`${baseUrl.replace(/\/$/u, "")}/value-bets`);
      url.searchParams.set("apiKey", apiKey);
      url.searchParams.set("bookmaker", bookmaker);
      url.searchParams.set("includeEventDetails", String(includeEventDetails));

      let response;
      try {
        response = await fetchImpl(url);
      } catch {
        throw new Error("Odds-API.io value-bets network request failed");
      }
      const receivedAt = new Date().toISOString();
      if (!response.ok) {
        throw new Error(
          `Odds-API.io value-bets request failed with status ${response.status}`,
        );
      }
      return {
        data: await response.json(),
        receivedAt,
        rateLimit: rateLimitFrom(response.headers),
      };
    },
  };
}
