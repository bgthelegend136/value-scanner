// Minimal ESPN public scoreboard client, used only as a FREE settlement source
// for non-soccer (and non-football-data soccer) paper bets, so The Odds API
// credits stay reserved for CLV. The scoreboard endpoint is public and keyless:
//   GET site.api.espn.com/apis/site/v2/sports/{sport}/{league}/scoreboard?dates=YYYYMMDD
// It returns every event for that league on that date. No auth, no secret.
const BASE_URL = "https://site.api.espn.com/apis/site/v2/sports";

export function createEspnClient({ fetchImpl = fetch } = {}) {
  async function getScoreboard({ leaguePath, date }) {
    const url = `${BASE_URL}/${leaguePath}/scoreboard?dates=${date}`;
    const response = await fetchImpl(url);
    if (!response.ok) {
      // Nothing secret to leak; report only the league and status.
      throw new Error(`ESPN ${leaguePath} scoreboard failed: HTTP ${response.status}`);
    }
    const body = await response.json();
    return Array.isArray(body.events) ? body.events : [];
  }

  return { getScoreboard };
}
