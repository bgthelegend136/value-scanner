import { chooseBookmakerLink } from "./mispricing_normalize.mjs";
import { MIN_CONFIRMED_EV } from "./mispricing_thresholds.mjs";

const CONFIRMED_PCT = (MIN_CONFIRMED_EV * 100).toFixed(0);
const URGENT_EV = 0.10;

// v1 supports MATCH_RESULT only.
function pickLabel(candidate) {
  return { "1": candidate.participantOne, X: "Draw", "2": candidate.participantTwo }[
    candidate.outcome
  ];
}

function percent(value) {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;
}

function finite(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function conservativeEv(confirmation) {
  const explicit = finite(confirmation.minimumConfirmedEv);
  if (explicit !== null) return explicit;
  return Math.min(confirmation.pinnacleEv, confirmation.consensusEv);
}

function alertTier(confirmation) {
  const edge = conservativeEv(confirmation);
  if (edge >= URGENT_EV) {
    return {
      code: "URGENT_10_PLUS",
      title: "URGENT MISPRICING WATCH >=10%",
      note: "Manual micro-test only: verify price, market, kickoff, and stake cap before acting.",
    };
  }
  return {
    code: "WATCHLIST_5_10",
    title: `RESEARCH WATCHLIST >=${CONFIRMED_PCT}%`,
    note: "Research-only advisory: collect CLV/ROI evidence; no staking gate has passed.",
  };
}

// How decisively the edge beats the sharp books' own disagreement. Higher is
// safer; a value near 1 means the edge is barely outside the noise.
function confidenceLine(confirmation) {
  const ratio = confirmation.edgeOverDispersion;
  if (ratio === undefined) return "";
  if (ratio === null) return "Edge confidence: sharp books in lockstep";
  return `Edge confidence: ${ratio.toFixed(1)}x the sharp books' disagreement`;
}

export function formatMispricingMessage(candidate, confirmation) {
  const kickoff = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Athens",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(candidate.kickoffUtc));
  const tier = alertTier(confirmation);
  const providerEv = finite(candidate.providerExpectedValue);
  const providerLine = providerEv === null ? "" : `Provider EV: ${percent(providerEv)}`;
  const linkNote = candidate.linkDepth === "EVENT"
    ? "\nLink opens the event page; select the exact pick shown above."
    : "";

  return [
    tier.title,
    "",
    `Tier: ${tier.code}`,
    `Sport: ${candidate.sportName} - ${candidate.leagueName}`,
    `Event: ${candidate.participantOne} vs ${candidate.participantTwo}`,
    `Start: ${kickoff} Greece`,
    `Book: ${candidate.bookmaker}`,
    `Pick: ${pickLabel(candidate)}`,
    `Offered: ${candidate.offeredOdds.toFixed(2)}`,
    "",
    providerLine,
    `Conservative EV: ${percent(conservativeEv(confirmation))}`,
    `Pinnacle fair: ${confirmation.pinnacleFairOdds.toFixed(2)} | EV: ${percent(confirmation.pinnacleEv)}`,
    `Consensus fair: ${confirmation.consensusFairOdds.toFixed(2)} | EV: ${percent(confirmation.consensusEv)} | ${confirmation.consensusBooks} books`,
    confidenceLine(confirmation),
    tier.note,
    "",
    "Verify the displayed price and exact market before recording any micro-test.",
    linkNote,
  ].filter((line) => line !== "").join("\n");
}

export function createTelegramClient({
  token,
  chatId,
  fetchImpl = fetch,
  baseUrl = "https://api.telegram.org",
}) {
  async function send(body) {
    let response;
    try {
      response = await fetchImpl(
        `${baseUrl.replace(/\/$/u, "")}/bot${token}/sendMessage`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, ...body }),
        },
      );
    } catch {
      throw new Error("Telegram network request failed");
    }
    if (!response.ok) {
      throw new Error(`Telegram request failed with status ${response.status}`);
    }
    const payload = await response.json();
    if (!payload.ok) throw new Error("Telegram request returned ok=false");
    return { messageId: String(payload.result.message_id) };
  }

  return {
    sendText(text) {
      return send({ text });
    },
    sendMispricing(candidate, confirmation) {
      const body = { text: formatMispricingMessage(candidate, confirmation) };
      const safeLink = chooseBookmakerLink({
        bookmaker: candidate.bookmaker,
        outcomeLink: candidate.link,
      }).url;
      if (safeLink) {
        body.reply_markup = {
          inline_keyboard: [[{
            text: `Open in ${candidate.bookmaker}`,
            url: safeLink,
          }]],
        };
      }
      return send(body);
    },
  };
}
