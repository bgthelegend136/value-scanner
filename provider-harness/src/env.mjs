import { readFile } from "node:fs/promises";

export async function loadEnvFile(path) {
  const contents = await readFile(path, "utf8");
  const values = {};

  for (const rawLine of contents.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    values[key] = value;
  }

  return values;
}

export function requireApiKey(env) {
  const key = env.ODDS_API_IO_KEY?.trim();
  if (!key) {
    throw new Error("ODDS_API_IO_KEY is missing from .env.local");
  }
  return key;
}
