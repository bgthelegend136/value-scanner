// Measurement-only Odds-API.io WebSocket probe.
//
// It records how long soft-book price windows stay above a configured odds
// threshold. The WebSocket odds channel does not include EV; the CSV keeps
// providerExpectedValue blank until a later reference cross-check is added.

import { access } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveEnvPath } from "../src/cli.mjs";
import { readCsv, writeCsv } from "../src/csv.mjs";
import { loadEnvFile, requireApiKey } from "../src/env.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPORTS_DIR = resolve(HERE, "..", "reports");
const DEFAULT_WS_BASE_URL = "wss://api.odds-api.io/v3/ws";
const TARGET_BOOKMAKERS = new Set(["Stoiximan", "Novibet"]);
const CSV_COLUMNS = [
  "openedAt", "closedAt", "lifetimeSeconds",
  "eventId", "bookmaker", "market", "line", "outcome",
  "firstOdds", "peakOdds", "lastOdds", "minOdds",
  "startSeq", "endSeq", "startTimestamp", "endTimestamp",
  "endReason", "providerExpectedValue",
];

function option(argv, name, fallback = undefined) {
  const hit = argv.find((arg) => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

function numericOption(argv, name, fallback) {
  const parsed = Number(option(argv, name, fallback));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function splitOption(argv, name) {
  return String(option(argv, name, ""))
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function finiteOdds(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 1 ? parsed : null;
}

function isoFromTimestamp(timestamp, fallback = new Date()) {
  const numeric = Number(timestamp);
  if (Number.isFinite(numeric)) {
    return new Date(numeric < 1e12 ? numeric * 1000 : numeric).toISOString();
  }
  return new Date(fallback).toISOString();
}

export function buildWsUrl({
  apiKey,
  baseUrl = DEFAULT_WS_BASE_URL,
  markets = "ML",
  channels = "odds",
  sport,
  leagues,
  eventIds,
  status,
  lastSeq = 0,
}) {
  const url = new URL(baseUrl);
  url.searchParams.set("apiKey", apiKey);
  if (channels) url.searchParams.set("channels", channels);
  if (markets) url.searchParams.set("markets", markets);
  if (sport) url.searchParams.set("sport", sport);
  if (leagues) url.searchParams.set("leagues", Array.isArray(leagues) ? leagues.join(",") : leagues);
  if (eventIds) url.searchParams.set("eventIds", Array.isArray(eventIds) ? eventIds.join(",") : eventIds);
  if (status) url.searchParams.set("status", status);
  if (Number(lastSeq) > 0) url.searchParams.set("lastSeq", String(lastSeq));
  return url.toString();
}

export function redactWsUrl(value) {
  const url = new URL(value);
  if (url.searchParams.has("apiKey")) url.searchParams.set("apiKey", "REDACTED");
  return url.toString();
}

export function createLifetimeState() {
  return {
    active: new Map(),
    lastSeq: 0,
    resyncRequired: null,
  };
}

function marketName(value) {
  return String(value ?? "").trim().toLowerCase();
}

function extractMlSelections(message) {
  const selections = [];
  for (const market of message.markets ?? []) {
    if (!["ml", "moneyline", "match result"].includes(marketName(market.name))) continue;
    for (const odds of market.odds ?? []) {
      for (const [field, outcome] of [["home", "1"], ["draw", "X"], ["away", "2"]]) {
        const decimalOdds = finiteOdds(odds[field]);
        if (!decimalOdds) continue;
        selections.push({
          eventId: String(message.id),
          bookmaker: String(message.bookie ?? ""),
          market: "MATCH_RESULT",
          line: "",
          outcome,
          decimalOdds,
          quoteUpdatedAt: market.updatedAt ?? "",
        });
      }
    }
  }
  return selections;
}

function identity(selection) {
  return [
    selection.eventId,
    selection.bookmaker,
    selection.market,
    selection.line,
    selection.outcome,
  ].join("|");
}

function closeEntry(entry, { reason, timestamp, seq, latestOdds = entry.lastOdds }) {
  const startMs = Number(entry.startTimestamp) * 1000;
  const endMs = Number(timestamp) * 1000;
  const lifetimeSeconds = Number.isFinite(startMs) && Number.isFinite(endMs)
    ? Math.max(0, (endMs - startMs) / 1000)
    : 0;
  return {
    openedAt: entry.openedAt,
    closedAt: isoFromTimestamp(timestamp),
    lifetimeSeconds: lifetimeSeconds.toFixed(3),
    eventId: entry.eventId,
    bookmaker: entry.bookmaker,
    market: entry.market,
    line: entry.line,
    outcome: entry.outcome,
    firstOdds: entry.firstOdds.toFixed(4),
    peakOdds: entry.peakOdds.toFixed(4),
    lastOdds: latestOdds.toFixed(4),
    minOdds: entry.minOdds.toFixed(4),
    startSeq: entry.startSeq,
    endSeq: seq ?? "",
    startTimestamp: entry.startTimestamp,
    endTimestamp: timestamp ?? "",
    endReason: reason,
    providerExpectedValue: "",
  };
}

function closeMatching(state, predicate, context) {
  const closed = [];
  for (const [key, entry] of [...state.active]) {
    if (!predicate(entry)) continue;
    closed.push(closeEntry(entry, context));
    state.active.delete(key);
  }
  return closed;
}

export function applyWsMessage(
  state,
  message,
  {
    minOdds = 5,
    targetBookmakers = TARGET_BOOKMAKERS,
    now = new Date(),
  } = {},
) {
  if (message?.seq) state.lastSeq = Number(message.seq);
  if (!message || message.type === "welcome" || message.type === "score" || message.type === "status") return [];
  if (message.type === "resync_required") {
    state.resyncRequired = message;
    return [];
  }

  const bookmaker = String(message.bookie ?? "");
  if (targetBookmakers?.size && bookmaker && !targetBookmakers.has(bookmaker)) return [];

  const timestamp = Number.isFinite(Number(message.timestamp))
    ? Number(message.timestamp)
    : Math.floor(new Date(now).getTime() / 1000);
  const seq = message.seq ?? "";

  if (message.type === "deleted" || message.type === "no_markets") {
    return closeMatching(
      state,
      (entry) => entry.eventId === String(message.id) && entry.bookmaker === bookmaker,
      { reason: message.type === "deleted" ? "DELETED" : "NO_MARKETS", timestamp, seq },
    );
  }

  if (message.type !== "created" && message.type !== "updated") return [];

  const seen = new Set();
  const closed = [];
  for (const selection of extractMlSelections(message)) {
    const key = identity(selection);
    seen.add(key);
    const active = state.active.get(key);
    if (selection.decimalOdds >= minOdds) {
      if (active) {
        active.lastOdds = selection.decimalOdds;
        active.peakOdds = Math.max(active.peakOdds, selection.decimalOdds);
        active.lastSeenAt = isoFromTimestamp(timestamp);
        active.lastSeq = seq;
      } else {
        state.active.set(key, {
          ...selection,
          openedAt: isoFromTimestamp(timestamp),
          startTimestamp: timestamp,
          firstOdds: selection.decimalOdds,
          peakOdds: selection.decimalOdds,
          lastOdds: selection.decimalOdds,
          minOdds,
          startSeq: seq,
        });
      }
    } else if (active) {
      closed.push(closeEntry(active, {
        reason: "UPDATED_BELOW_THRESHOLD",
        timestamp,
        seq,
        latestOdds: selection.decimalOdds,
      }));
      state.active.delete(key);
    }
  }

  closed.push(...closeMatching(
    state,
    (entry) => entry.eventId === String(message.id) && entry.bookmaker === bookmaker && !seen.has(identity(entry)),
    { reason: "SELECTION_MISSING", timestamp, seq },
  ));
  return closed;
}

async function fileExists(path) {
  return access(path).then(() => true, () => false);
}

async function appendCsvRows(path, rows) {
  if (rows.length === 0) return;
  const existing = await fileExists(path) ? await readCsv(path) : [];
  await writeCsv(path, [...existing, ...rows], CSV_COLUMNS);
}

async function dataAsText(data) {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("utf8");
  if (data?.text) return await data.text();
  return String(data ?? "");
}

async function runProbe(argv = process.argv.slice(2)) {
  if (typeof WebSocket === "undefined") {
    throw new Error("Node.js global WebSocket is unavailable; use Node 22+");
  }

  const envPath = await resolveEnvPath(process.cwd());
  const env = await loadEnvFile(envPath);
  const apiKey = requireApiKey(env);
  const state = createLifetimeState();
  const reportsDir = resolve(option(argv, "reports-dir", DEFAULT_REPORTS_DIR));
  const outputPath = resolve(option(argv, "output", join(reportsDir, "ws-lifetime-log.csv")));
  const minOdds = numericOption(argv, "min-odds", 5);
  const durationMinutes = numericOption(argv, "duration-minutes", 120);
  const targetBookmakers = new Set(splitOption(argv, "bookmakers"));
  const effectiveBookmakers = targetBookmakers.size ? targetBookmakers : TARGET_BOOKMAKERS;
  const startedAt = Date.now();
  const stopAt = startedAt + durationMinutes * 60_000;
  let reconnectAttempts = 0;
  let ws = null;

  const connect = () => {
    const url = buildWsUrl({
      apiKey,
      markets: option(argv, "markets", "ML"),
      channels: option(argv, "channels", "odds"),
      sport: option(argv, "sport", "football"),
      leagues: option(argv, "leagues"),
      eventIds: option(argv, "eventIds"),
      status: option(argv, "status", "prematch"),
      lastSeq: state.lastSeq,
    });
    console.log(`Connecting ${redactWsUrl(url)}`);
    ws = new WebSocket(url);

    ws.onopen = () => {
      reconnectAttempts = 0;
      console.log(`WebSocket connected; logging lifetimes >= ${minOdds.toFixed(2)} to ${outputPath}`);
    };

    ws.onmessage = async (event) => {
      let message;
      try {
        message = JSON.parse(await dataAsText(event.data));
      } catch {
        return;
      }
      if (message.type === "welcome") {
        console.log(`Welcome: channels=${(message.channels ?? []).join(",") || "?"}, bookmakers=${(message.bookmakers ?? []).join(",") || "?"}`);
      }
      const rows = applyWsMessage(state, message, { minOdds, targetBookmakers: effectiveBookmakers });
      await appendCsvRows(outputPath, rows);
      if (rows.length) console.log(`Closed ${rows.length} lifetime row(s); lastSeq=${state.lastSeq || "?"}`);
      if (state.resyncRequired) {
        console.error(`resync_required: ${state.resyncRequired.reason ?? "unknown"}; reconnecting with latest seq after close`);
        ws?.close();
      }
    };

    ws.onerror = () => {
      console.error("WebSocket error");
    };

    ws.onclose = () => {
      if (Date.now() >= stopAt) {
        console.log("WebSocket probe duration complete.");
        return;
      }
      reconnectAttempts += 1;
      const delay = Math.min(1000 * (2 ** reconnectAttempts), 30_000);
      setTimeout(connect, delay);
    };
  };

  connect();
  setTimeout(() => ws?.close(), Math.max(1_000, stopAt - Date.now()));
}

const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  runProbe().catch((error) => {
    console.error(`ws-lifetime-probe error: ${error.message}`);
    process.exitCode = 1;
  });
}
