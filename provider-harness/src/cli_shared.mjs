// Small pure/IO helpers shared between the CLI entrypoint and extracted command
// modules. Kept in their own module so command modules can import them without a
// circular dependency on cli.mjs.
import { access } from "node:fs/promises";

import { readCsv } from "./csv.mjs";

export function signed(value, digits = 4) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}`;
}

export function optionValue(args, name, fallback = undefined) {
  const hit = args.find((arg) => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

export function numericArg(args, name, fallback) {
  const parsed = Number(optionValue(args, name, fallback));
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function splitArg(args, name) {
  return String(optionValue(args, name, ""))
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export const defaultFileExists = (path) => access(path).then(() => true, () => false);

export async function readCsvIfPresent(path) {
  return await defaultFileExists(path) ? readCsv(path) : [];
}
