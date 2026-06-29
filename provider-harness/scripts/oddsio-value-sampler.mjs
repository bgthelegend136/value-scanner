import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveEnvPath } from "../src/cli.mjs";
import { loadEnvFile, requireApiKey } from "../src/env.mjs";
import { createValueBetsClient } from "../src/value_bets_client.mjs";
import {
  DEFAULT_ODDSIO_VALUE_SAMPLER_BOOKMAKERS,
  runOddsIoValueSampler,
} from "../src/oddsio_value_sampler.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPORTS_DIR = resolve(HERE, "..", "reports");

function splitArg(name, fallback) {
  const hit = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  if (!hit) return fallback;
  return hit.slice(name.length + 3).split(",").map((item) => item.trim()).filter(Boolean);
}

async function main() {
  const envPath = await resolveEnvPath(process.cwd());
  const env = await loadEnvFile(envPath);
  const client = createValueBetsClient({ apiKey: requireApiKey(env) });
  const bookmakers = splitArg("bookmakers", DEFAULT_ODDSIO_VALUE_SAMPLER_BOOKMAKERS);

  const summary = await runOddsIoValueSampler({
    client,
    reportsDir: REPORTS_DIR,
    bookmakers,
  });

  console.log(
    `Odds-API.io sampler: bookmakers=${summary.bookmakers}, rows=${summary.rows}, remaining=${summary.rateLimitRemaining ?? "?"}.`,
  );
  console.log(`Appended ${summary.outputPath}`);
}

main().catch((error) => {
  console.error(`oddsio-value-sampler error: ${error.message}`);
  process.exitCode = 1;
});
