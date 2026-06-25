import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readCsv, writeCsv } from "./csv.mjs";

export const QUEUE_COLUMNS = [
  "candidateId", "providerEventId", "bookmaker", "sportKey",
  "sportSlug", "leagueSlug", "sportName", "leagueName",
  "kickoffUtc", "participantOne", "participantTwo",
  "market", "line", "outcome", "offeredOdds", "providerExpectedValue",
  "valueUpdatedAt", "receivedAt", "link", "linkDepth", "firstQueuedAt",
];
export const ALERT_COLUMNS = [
  "identity", "sentAt", "candidateId", "providerEventId", "referenceEventId",
  "bookmaker", "market", "line", "outcome", "offeredOdds",
  "pinnacleEv", "consensusEv", "minimumConfirmedEv", "telegramMessageId",
];
export const AUDIT_COLUMNS = [
  "auditedAt", "runMode", "candidateId", "providerEventId", "bookmaker",
  "sportKey", "sportSlug", "leagueSlug", "sportName", "leagueName",
  "market", "line", "outcome", "status", "reason",
  "pinnacleEv", "consensusEv", "consensusBooks",
];
// One row per *sent* alert, kept so its closing-line value can be captured near
// kickoff. decimalOdds/market/line/outcome/referenceEventId mirror the field
// names paper.mjs applyClosingLine/summarizeClv already key on, so those proven
// CLV functions operate on these rows unchanged.
export const CLV_LEDGER_COLUMNS = [
  "identity", "sentAt", "referenceEventId", "sportKey", "bookmaker",
  "market", "line", "outcome", "decimalOdds", "kickoffUtc",
  "sendFairProbability", "status",
  "closingFairOdds", "clv", "clvCapturedAt",
];

const exists = (path) => access(path).then(() => true, () => false);

export function candidateIdentity(row) {
  return [
    row.providerEventId, row.bookmaker, row.market,
    String(row.line ?? ""), row.outcome,
  ].join("|");
}

export function mergeQueue(existing, incoming, { now }) {
  const byIdentity = new Map();
  for (const row of existing) {
    if (new Date(row.kickoffUtc).getTime() > now.getTime()) {
      byIdentity.set(candidateIdentity(row), row);
    }
  }
  for (const row of incoming) {
    if (new Date(row.kickoffUtc).getTime() <= now.getTime()) continue;
    const key = candidateIdentity(row);
    const prior = byIdentity.get(key);
    byIdentity.set(key, {
      ...prior,
      ...row,
      firstQueuedAt: prior?.firstQueuedAt || row.firstQueuedAt || now.toISOString(),
    });
  }
  return [...byIdentity.values()];
}

export function selectSportGroups(rows, { maxSports = 2 } = {}) {
  const bySport = new Map();
  for (const row of rows) {
    if (!bySport.has(row.sportKey)) bySport.set(row.sportKey, []);
    bySport.get(row.sportKey).push(row);
  }
  const ranked = [...bySport.entries()].sort(([, left], [, right]) => {
    const maxEv = (group) => Math.max(...group.map((row) => Number(row.providerExpectedValue)));
    const minKickoff = (group) => Math.min(...group.map((row) => new Date(row.kickoffUtc).getTime()));
    const minQueued = (group) => Math.min(...group.map((row) => new Date(row.firstQueuedAt).getTime()));
    return maxEv(right) - maxEv(left) ||
      minKickoff(left) - minKickoff(right) ||
      minQueued(left) - minQueued(right);
  });
  return new Map(ranked.slice(0, maxSports));
}

// Snapshot a just-sent alert as a PENDING CLV row. The "opening" Pinnacle fair
// probability is stored for reference; CLV itself is computed later against the
// *closing* line (see paper.mjs applyClosingLine).
export function buildClvTrackingRow(candidate, confirmation, { sentAt }) {
  return {
    identity: candidateIdentity(candidate),
    sentAt,
    referenceEventId: String(confirmation.referenceEventId),
    sportKey: candidate.sportKey,
    bookmaker: candidate.bookmaker,
    market: candidate.market,
    line: String(candidate.line ?? ""),
    outcome: candidate.outcome,
    decimalOdds: Number(candidate.offeredOdds).toFixed(4),
    kickoffUtc: candidate.kickoffUtc,
    sendFairProbability: Number(confirmation.pinnacleFairProbability).toFixed(6),
    status: "PENDING",
    closingFairOdds: "",
    clv: "",
    clvCapturedAt: "",
  };
}

// Append-only by identity: an alert that re-fires (improved EV) keeps its first
// tracking row, so the opening snapshot reflects when we first acted on it.
export function mergeClvLedger(existing, incoming) {
  const byIdentity = new Map(existing.map((row) => [row.identity, row]));
  for (const row of incoming) {
    if (!byIdentity.has(row.identity)) byIdentity.set(row.identity, row);
  }
  return [...byIdentity.values()];
}

export function shouldSendAlert(previous, confirmation) {
  if (!previous) return true;
  // Resend only on a >=5 percentage-point improvement. Subtract an epsilon so
  // an exact 5pp delta (e.g. 0.19 - 0.14 === 0.04999999999999999) still counts.
  return confirmation.minimumConfirmedEv - Number(previous.minimumConfirmedEv) >= 0.05 - 1e-9;
}

export function createMispricingState({ reportsDir }) {
  const paths = {
    queue: join(reportsDir, "mispricing-queue.csv"),
    alerts: join(reportsDir, "mispricing-alerts.csv"),
    audit: join(reportsDir, "mispricing-audit.csv"),
    clv: join(reportsDir, "mispricing-clv.csv"),
    health: join(reportsDir, "mispricing-health.json"),
  };
  const readRows = async (path) => await exists(path) ? readCsv(path) : [];
  const requireFields = (rows, fields, label) => {
    for (const row of rows) {
      for (const field of fields) {
        if (String(row[field] ?? "").trim() === "") {
          throw new Error(`invalid mispricing ${label} row: missing ${field}`);
        }
      }
    }
    return rows;
  };
  const hydrateQueue = (rows) => rows.map((row) => {
    const offeredOdds = Number(row.offeredOdds);
    const providerExpectedValue = Number(row.providerExpectedValue);
    if (!(offeredOdds > 1) || !Number.isFinite(providerExpectedValue)) {
      throw new Error("invalid mispricing queue row: invalid numeric field");
    }
    return { ...row, offeredOdds, providerExpectedValue };
  });
  return {
    async readQueue() {
      return hydrateQueue(
        requireFields(
          await readRows(paths.queue),
          ["candidateId", "providerEventId", "bookmaker", "sportKey", "kickoffUtc", "market", "outcome"],
          "queue",
        ),
      );
    },
    writeQueue: (rows) => writeCsv(paths.queue, rows, QUEUE_COLUMNS),
    async readAlerts() {
      return requireFields(
        await readRows(paths.alerts),
        ["identity", "sentAt", "candidateId", "bookmaker", "market", "outcome"],
        "alerts",
      );
    },
    writeAlerts: (rows) => writeCsv(paths.alerts, rows, ALERT_COLUMNS),
    async readAudit() {
      return requireFields(
        await readRows(paths.audit),
        ["auditedAt", "runMode", "candidateId", "bookmaker", "status"],
        "audit",
      );
    },
    writeAudit: (rows) => writeCsv(paths.audit, rows, AUDIT_COLUMNS),
    async readClvLedger() {
      return requireFields(
        await readRows(paths.clv),
        ["identity", "referenceEventId", "market", "outcome", "decimalOdds", "status"],
        "clv",
      );
    },
    writeClvLedger: (rows) => writeCsv(paths.clv, rows, CLV_LEDGER_COLUMNS),
    async readHealth() {
      if (!await exists(paths.health)) {
        return {
          oddsApiFailures: 0,
          referenceFailures: 0,
          telegramFailures: 0,
          oddsApiWarningSent: false,
          referenceWarningSent: false,
        };
      }
      try {
        return JSON.parse(await readFile(paths.health, "utf8"));
      } catch {
        throw new Error("invalid mispricing health state");
      }
    },
    async writeHealth(value) {
      await mkdir(reportsDir, { recursive: true });
      await writeFile(paths.health, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    },
  };
}
