import { buildReasons } from "./value.mjs";

const MATCH_RESULT_LABEL = { "1": "Home", X: "Draw", "2": "Away" };
const STATUS_LABEL = {
  VALUE: "VALUE",
  VALUE_CHECK: "POSSIBLE VALUE (verify)",
  SUSPICIOUS: "SUSPICIOUS VALUE",
};

export function formatAlert(bet, { fixture }) {
  const marketLabel =
    bet.market === "MATCH_RESULT" ? MATCH_RESULT_LABEL[bet.outcome] : `${bet.outcome} ${bet.line}`;
  const lines = [
    `ALERT: ${STATUS_LABEL[bet.status] ?? bet.status}`,
    "",
    `Match: ${fixture.homeTeam} - ${fixture.awayTeam}`,
    `Book: ${bet.bookmaker}`,
    `Market: ${marketLabel}`,
    `Offered odd: ${bet.decimalOdds.toFixed(2)}`,
    `Fair odd (Pinnacle de-vig): ${bet.fairOdds.toFixed(2)}`,
    `EV: +${(bet.ev * 100).toFixed(1)}%`,
    "",
    "Reasons:",
    ...buildReasons(bet).map((reason) => `- ${reason}`),
    "",
    "Risk:",
    "- Verify official lineup and the exact market/line before betting.",
    "- EV is modelled from Pinnacle's de-vigged price, not a guarantee. Odds move. No auto-betting.",
  ];
  return lines.join("\n");
}
