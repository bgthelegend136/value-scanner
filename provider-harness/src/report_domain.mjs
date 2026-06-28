export const PRIMARY_MARKET = "MATCH_RESULT";
export const VALUE_TIERS = new Set(["VALUE", "VALUE_CHECK", "SUSPICIOUS"]);
export const SETTLED_STATUSES = new Set(["WON", "LOST", "PUSH", "HALF_WON", "HALF_LOST"]);

export function optionalNumber(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function isSettled(row) {
  return SETTLED_STATUSES.has(String(row.status ?? ""));
}

export function isValueTier(row) {
  return VALUE_TIERS.has(String(row.tier ?? ""));
}

export function tierGroup(row) {
  const tier = String(row.tier ?? "").trim();
  if (tier === "VALUE") return "VALUE";
  if (tier === "CONTROL") return "CONTROL";
  return tier || "(blank)";
}

export function isPrimaryMarket(row) {
  return String(row.market ?? "") === PRIMARY_MARKET;
}

export function hasClv(row) {
  return optionalNumber(row.clv) !== null;
}

export function selectionKey(row) {
  return [
    row.referenceEventId,
    row.bookmaker,
    row.market,
    row.line ?? "",
    row.outcome,
  ].map((value) => String(value ?? "")).join("|");
}

export function eventSelectionKey(row) {
  return [
    row.referenceEventId,
    row.market,
    row.line ?? "",
    row.outcome,
  ].map((value) => String(value ?? "")).join("|");
}

export function oddsBucket(odds) {
  if (!(odds > 0)) return "(unknown)";
  if (odds < 1.50) return "<1.50";
  if (odds <= 2.00) return "1.50..2.00";
  if (odds < 3.00) return "2.00..3.00";
  if (odds < 5.00) return "3.00..5.00";
  return "5.00+";
}

export function evBucket(ev) {
  if (ev === null) return "(unknown)";
  if (ev < -0.05) return "<-5%";
  if (ev < 0) return "-5..0%";
  if (ev < 0.02) return "0..2%";
  if (ev < 0.05) return "2..5%";
  if (ev < 0.10) return "5..10%";
  return "10%+";
}

export function timeToCloseBucket(row) {
  const kickoff = Date.parse(row.kickoffUtc);
  const captured = Date.parse(row.clvCapturedAt || row.firstSeenAt);
  if (!Number.isFinite(kickoff) || !Number.isFinite(captured)) return "(unknown)";
  const minutes = Math.max(0, Math.round((kickoff - captured) / 60_000));
  if (minutes <= 360) return "0..360m";
  if (minutes <= 1440) return "6..24h";
  return "24h+";
}

export function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function average(values) {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function decimal(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(6);
  return String(value);
}
