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
