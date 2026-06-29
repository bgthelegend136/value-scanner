import { join } from "node:path";

import { readCsv, writeCsv } from "./csv.mjs";

export const DEFAULT_ODDSIO_VALUE_SAMPLER_BOOKMAKERS = ["Stoiximan", "Pamestoixima"];

export const ODDSIO_VALUE_SAMPLER_COLUMNS = [
  "sampledAt",
  "receivedAt",
  "bookmaker",
  "candidateId",
  "providerEventId",
  "sportName",
  "leagueName",
  "homeTeam",
  "awayTeam",
  "kickoffUtc",
  "hoursToKickoff",
  "inNext24h",
  "market",
  "line",
  "side",
  "expectedValueIndex",
  "ev",
  "offeredOdds",
  "valueUpdatedAt",
  "ageSeconds",
  "rateLimitLimit",
  "rateLimitRemaining",
  "rateLimitResetAt",
];

function text(value) {
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object") return String(value.name ?? "").trim();
  return "";
}

function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function decimal(value) {
  return value === null || value === undefined ? "" : Number(value).toFixed(6);
}

function selectionValue(raw, side) {
  const key = side === "home" ? "home" : side === "away" ? "away" : side === "draw" ? "draw" : "";
  return key ? raw.bookmakerOdds?.[key] ?? raw.market?.[key] : undefined;
}

function samplerRow(raw, { sampledAt, receivedAt, rateLimit, now }) {
  const event = raw.event ?? {};
  const kickoffMs = Date.parse(event.date);
  const updatedMs = Date.parse(raw.expectedValueUpdatedAt);
  const expectedValueIndex = numberOrNull(raw.expectedValue);
  const ev = expectedValueIndex === null ? null : (expectedValueIndex - 100) / 100;
  const hoursToKickoff = Number.isFinite(kickoffMs) ? (kickoffMs - now.getTime()) / 3_600_000 : null;
  const ageSeconds = Number.isFinite(updatedMs) ? (now.getTime() - updatedMs) / 1000 : null;
  const side = String(raw.betSide ?? "");

  return {
    sampledAt,
    receivedAt,
    bookmaker: String(raw.bookmaker ?? ""),
    candidateId: String(raw.id ?? ""),
    providerEventId: String(raw.eventId ?? ""),
    sportName: text(event.sport),
    leagueName: text(event.league),
    homeTeam: text(event.home),
    awayTeam: text(event.away),
    kickoffUtc: Number.isFinite(kickoffMs) ? new Date(kickoffMs).toISOString() : "",
    hoursToKickoff: decimal(hoursToKickoff),
    inNext24h: String(hoursToKickoff !== null && hoursToKickoff >= 1 && hoursToKickoff <= 24),
    market: String(raw.market?.name ?? ""),
    line: String(raw.market?.hdp ?? raw.market?.line ?? ""),
    side,
    expectedValueIndex: decimal(expectedValueIndex),
    ev: decimal(ev),
    offeredOdds: decimal(numberOrNull(selectionValue(raw, side))),
    valueUpdatedAt: Number.isFinite(updatedMs) ? new Date(updatedMs).toISOString() : "",
    ageSeconds: decimal(ageSeconds),
    rateLimitLimit: String(rateLimit?.limit ?? ""),
    rateLimitRemaining: String(rateLimit?.remaining ?? ""),
    rateLimitResetAt: String(rateLimit?.resetAt ?? ""),
  };
}

export async function runOddsIoValueSampler({
  client,
  reportsDir,
  now = () => new Date(),
  bookmakers = DEFAULT_ODDSIO_VALUE_SAMPLER_BOOKMAKERS,
  outputPath = join(reportsDir, "oddsio-value-sampler.csv"),
} = {}) {
  const sampledAtDate = now();
  const sampledAt = sampledAtDate.toISOString();
  const rows = [];
  let rateLimitRemaining = null;

  for (const bookmaker of bookmakers) {
    const response = await client.getValueBets({ bookmaker, includeEventDetails: true });
    rateLimitRemaining = response.rateLimit?.remaining ?? rateLimitRemaining;
    for (const raw of Array.isArray(response.data) ? response.data : []) {
      rows.push(samplerRow(raw, {
        sampledAt,
        receivedAt: response.receivedAt,
        rateLimit: response.rateLimit,
        now: sampledAtDate,
      }));
    }
  }

  let existing = [];
  try {
    existing = await readCsv(outputPath);
  } catch {
    existing = [];
  }
  await writeCsv(outputPath, [...existing, ...rows], ODDSIO_VALUE_SAMPLER_COLUMNS);

  return {
    sampledAt,
    bookmakers: bookmakers.join(","),
    rows: rows.length,
    outputPath,
    rateLimitRemaining,
  };
}
