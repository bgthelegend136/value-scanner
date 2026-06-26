// Minimal football-data.org v4 client, used only as a FREE settlement source for
// soccer paper bets (final scores), so The Odds API credits are reserved for the
// irreplaceable work (Pinnacle confirmation + CLV).
//
// Free tier: 10 requests/minute. The response carries the remaining budget in the
// `X-Requests-Available-Minute` header; the caller surfaces it so a multi-league
// settle never blows the limiter (docs: a breach returns HTTP 429).
const BASE_URL = "https://api.football-data.org/v4";

export function createFootballDataClient({ apiKey, fetchImpl = fetch } = {}) {
  if (!apiKey) throw new Error("football-data.org API key is required");

  async function listFinishedMatches({ competition }) {
    const url = `${BASE_URL}/competitions/${encodeURIComponent(competition)}/matches?status=FINISHED`;
    const response = await fetchImpl(url, { headers: { "X-Auth-Token": apiKey } });
    const requestsAvailableMinute = Number(
      response.headers?.get?.("x-requests-available-minute") ?? NaN,
    );
    if (!response.ok) {
      // Never leak the token; report only the status and competition.
      throw new Error(`football-data.org ${competition} request failed: HTTP ${response.status}`);
    }
    const body = await response.json();
    return { matches: Array.isArray(body.matches) ? body.matches : [], requestsAvailableMinute };
  }

  return { listFinishedMatches };
}
