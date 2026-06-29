import { readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";

// Snapshot reports are written with an ISO-ish timestamp embedded in the
// filename, e.g. `historical-calibration-2026-06-28T18-58-31.831Z.json`. A
// lexical sort on the full name therefore orders them chronologically, so we
// keep the newest `keep` of each (prefix, extension) group and drop the rest.
export const DEFAULT_SNAPSHOT_PREFIXES = ["historical-calibration-"];

export function planSnapshotPrune(
  filenames,
  { keep = 8, prefixes = DEFAULT_SNAPSHOT_PREFIXES } = {},
) {
  const keepCount = Math.max(0, keep);
  const toDelete = [];
  for (const prefix of prefixes) {
    const byExtension = new Map();
    for (const name of filenames) {
      if (!name.startsWith(prefix)) continue;
      const dot = name.lastIndexOf(".");
      const extension = dot >= 0 ? name.slice(dot + 1) : "";
      if (!byExtension.has(extension)) byExtension.set(extension, []);
      byExtension.get(extension).push(name);
    }
    for (const names of byExtension.values()) {
      names.sort();
      toDelete.push(...names.slice(0, Math.max(0, names.length - keepCount)));
    }
  }
  return toDelete;
}

export async function pruneReportsDir(
  dir,
  { keep = 8, prefixes = DEFAULT_SNAPSHOT_PREFIXES } = {},
) {
  let entries;
  try {
    entries = await readdir(dir);
  } catch {
    return { deleted: [], bytesFreed: 0 };
  }
  const targets = planSnapshotPrune(entries, { keep, prefixes });
  let bytesFreed = 0;
  const deleted = [];
  for (const name of targets) {
    const path = join(dir, name);
    try {
      const info = await stat(path);
      await unlink(path);
      bytesFreed += info.size;
      deleted.push(name);
    } catch {
      // File vanished or is locked — skip it; pruning is best-effort.
    }
  }
  return { deleted, bytesFreed };
}
