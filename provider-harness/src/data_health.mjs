import {
  hasClv,
  isPrimaryMarket,
  isSettled,
  isValueTier,
  optionalNumber,
  selectionKey,
} from "./report_domain.mjs";

export const DATA_HEALTH_COLUMNS = [
  "severity", "code", "rowIndex", "referenceEventId", "selectionKey", "message",
];

const REQUIRED_FIELDS = [
  "referenceEventId",
  "bookmaker",
  "market",
  "outcome",
  "kickoffUtc",
];

function issue(row, index, severity, code, message) {
  return {
    severity,
    code,
    rowIndex: String(index + 1),
    referenceEventId: String(row.referenceEventId ?? ""),
    selectionKey: selectionKey(row),
    message,
  };
}

export function buildDataHealthReport({ rows = [], generatedAt = new Date().toISOString(), now = new Date() } = {}) {
  const issues = [];
  const seen = new Map();
  const nowMs = now.getTime();
  const clvWindowMs = 40 * 60_000;
  const earlyClvMs = 60 * 60_000;

  rows.forEach((row, index) => {
    const key = selectionKey(row);
    if (seen.has(key)) {
      issues.push(issue(row, index, "WARN", "DUPLICATE_SELECTION", `Duplicate of row ${seen.get(key) + 1}`));
    } else {
      seen.set(key, index);
    }

    for (const field of REQUIRED_FIELDS) {
      if (!String(row[field] ?? "").trim()) {
        issues.push(issue(row, index, "ERROR", "MISSING_REQUIRED_FIELD", `Missing ${field}`));
      }
    }

    const decimalOdds = optionalNumber(row.decimalOdds);
    if (decimalOdds === null || decimalOdds <= 1) {
      issues.push(issue(row, index, "ERROR", "INVALID_DECIMAL_ODDS", `Invalid decimalOdds=${row.decimalOdds ?? ""}`));
    }
    const ev = optionalNumber(row.ev);
    if (ev === null) {
      issues.push(issue(row, index, "ERROR", "INVALID_EV", `Invalid ev=${row.ev ?? ""}`));
    }

    const kickoffMs = Date.parse(row.kickoffUtc);
    if (!Number.isFinite(kickoffMs)) {
      issues.push(issue(row, index, "ERROR", "INVALID_KICKOFF", `Invalid kickoffUtc=${row.kickoffUtc ?? ""}`));
    }

    if (isSettled(row) && optionalNumber(row.profit) === null) {
      issues.push(issue(row, index, "ERROR", "SETTLED_MISSING_PROFIT", "Settled row has no numeric profit"));
    }

    if (String(row.status ?? "") === "PENDING" && Number.isFinite(kickoffMs) && kickoffMs < nowMs) {
      issues.push(issue(row, index, "WARN", "PENDING_PAST_KICKOFF", "Pending row is past kickoff"));
    }

    if (
      isValueTier(row) &&
      String(row.status ?? "") === "PENDING" &&
      !hasClv(row) &&
      Number.isFinite(kickoffMs) &&
      kickoffMs <= nowMs + clvWindowMs
    ) {
      issues.push(issue(row, index, "WARN", "VALUE_PENDING_WITHOUT_CLV_AFTER_WINDOW", "VALUE row reached CLV window without CLV"));
    }

    const clvCapturedMs = Date.parse(row.clvCapturedAt);
    if (Number.isFinite(kickoffMs) && Number.isFinite(clvCapturedMs)) {
      if (clvCapturedMs < kickoffMs - earlyClvMs) {
        issues.push(issue(row, index, "WARN", "CLV_CAPTURE_TOO_EARLY", "CLV captured more than 60 minutes before kickoff"));
      }
      if (clvCapturedMs > kickoffMs) {
        issues.push(issue(row, index, "ERROR", "CLV_CAPTURE_AFTER_KICKOFF", "CLV captured after kickoff"));
      }
    }

    if (!isPrimaryMarket(row)) {
      issues.push(issue(row, index, "INFO", "NON_PRIMARY_MARKET_EXCLUDED", "Non-MATCH_RESULT row is excluded from primary readiness"));
    }
  });

  const summary = { ERROR: 0, WARN: 0, INFO: 0 };
  for (const item of issues) summary[item.severity] += 1;
  return { generatedAt, summary, issues };
}
