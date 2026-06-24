import assert from "node:assert/strict";
import { access, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { resolveEnvPath, runCli } from "../src/cli.mjs";
import { readCsv, writeCsv } from "../src/csv.mjs";

const API_KEY = "secret-test-key-do-not-leak";
const RATE_LIMIT = { limit: 100, remaining: 97, resetAt: "2026-06-24T13:00:00Z" };

const oddsFixture = JSON.parse(
  await readFile(new URL("./fixtures/odds-response.json", import.meta.url), "utf8"),
);

function collector() {
  let text = "";
  return { write: (chunk) => { text += chunk; }, get text() { return text; } };
}

function fakeClient({ events = [], odds = {}, calls }) {
  return {
    async listEvents(args) {
      calls.push(["events", args]);
      return { data: events, receivedAt: "2026-06-24T12:00:05.000Z", rateLimit: RATE_LIMIT };
    },
    async getOdds(args) {
      calls.push(["odds", args]);
      return { data: odds, receivedAt: "2026-06-24T12:00:05.000Z", rateLimit: RATE_LIMIT };
    },
  };
}

test("rejects unknown commands without making requests", async () => {
  const err = collector();
  const calls = [];
  const code = await runCli(["frobnicate"], {
    err: err.write,
    out: () => {},
    loadApiKey: async () => API_KEY,
    createClient: () => fakeClient({ calls }),
  });
  assert.equal(code, 1);
  assert.match(err.text, /usage/i);
  assert.equal(calls.length, 0);
});

test("requires an event id for capture and a path for evaluate", async () => {
  const err = collector();
  const captureCode = await runCli(["capture"], { err: err.write, out: () => {} });
  const evaluateCode = await runCli(["evaluate"], { err: err.write, out: () => {} });
  assert.equal(captureCode, 1);
  assert.equal(evaluateCode, 1);
  assert.match(err.text, /eventId/i);
  assert.match(err.text, /csv|path/i);
});

test("events prints a bounded readable fixture list with rate limit, no raw json or key", async () => {
  const out = collector();
  const calls = [];
  const events = [
    { id: 555, home: "Greece", away: "Italy", date: "2026-06-25T18:00:00Z", league: { name: "International" } },
    { id: 556, home: "Spain", away: "France", date: "2026-06-26T18:00:00Z", league: { name: "Friendly" } },
  ];
  const code = await runCli(["events"], {
    out: out.write,
    err: () => {},
    loadApiKey: async () => API_KEY,
    createClient: ({ apiKey }) => {
      assert.equal(apiKey, API_KEY);
      return fakeClient({ events, calls });
    },
  });

  assert.equal(code, 0);
  assert.deepEqual(calls[0], ["events", { sport: "football", limit: 5 }]);
  assert.match(out.text, /Greece/);
  assert.match(out.text, /555/);
  assert.match(out.text, /97/); // remaining quota surfaced
  assert.doesNotMatch(out.text, new RegExp(API_KEY));
  assert.doesNotMatch(out.text, /"home"/); // no raw JSON dump
});

test("capture requests only Superbet and Stoiximan and writes canonical rows with blank manual columns", async () => {
  const out = collector();
  const calls = [];
  const reportsDir = await mkdtemp(join(tmpdir(), "odds-capture-"));
  const code = await runCli(["capture", "123456"], {
    out: out.write,
    err: () => {},
    loadApiKey: async () => API_KEY,
    createClient: () => fakeClient({ odds: oddsFixture, calls }),
    reportsDir,
    now: () => new Date("2026-06-24T12:00:05.000Z"),
  });

  assert.equal(code, 0);
  assert.deepEqual(calls[0], ["odds", { eventId: "123456", bookmakers: ["Superbet", "Stoiximan"] }]);

  const files = await readdir(reportsDir);
  assert.equal(files.length, 1);
  const csvPath = join(reportsDir, files[0]);
  const rows = await readCsv(csvPath);

  assert.ok(rows.length > 0);
  for (const row of rows) {
    assert.ok(["Superbet", "Stoiximan"].includes(row.bookmaker));
    assert.equal(row.siteOdds, "");
    assert.equal(row.siteObservedAt, "");
    assert.equal(row.notes, "");
  }

  const raw = await readFile(csvPath, "utf8");
  assert.doesNotMatch(raw, new RegExp(API_KEY));
  assert.match(out.text, /97/); // rate limit reported
});

test("evaluate reports each bookmaker-market separately, treats Superbet Double Chance as not applicable, rejects skew", async () => {
  const reportsDir = await mkdtemp(join(tmpdir(), "odds-eval-"));
  const inputPath = join(reportsDir, "capture.csv");
  const columns = [
    "provider", "bookmaker", "eventId", "competition", "kickoffUtc", "homeTeam",
    "awayTeam", "period", "market", "line", "outcome", "decimalOdds",
    "quoteUpdatedAt", "receivedAt", "regionalStatus", "siteOdds", "siteObservedAt", "notes",
  ];
  const base = {
    provider: "Odds-API.io", eventId: "123456", competition: "International",
    kickoffUtc: "2026-06-25T18:00:00.000Z", homeTeam: "Greece", awayTeam: "Italy",
    period: "FULL_TIME", quoteUpdatedAt: "2026-06-24T12:00:00.000Z",
    receivedAt: "2026-06-24T12:00:05.000Z", regionalStatus: "UNVERIFIED", notes: "",
  };
  const rows = [
    { ...base, bookmaker: "Stoiximan", market: "TOTALS", line: "2.5", outcome: "UNDER", decimalOdds: "1.95", siteOdds: "1.96", siteObservedAt: "2026-06-24T12:00:00.000Z" },
    { ...base, bookmaker: "Stoiximan", market: "TOTALS", line: "2.5", outcome: "OVER", decimalOdds: "1.90", siteOdds: "1.90", siteObservedAt: "2026-06-24T12:00:03.000Z" },
    { ...base, bookmaker: "Superbet", market: "MATCH_RESULT", line: "", outcome: "1", decimalOdds: "2.12", siteOdds: "2.12", siteObservedAt: "2026-06-24T12:00:04.000Z" },
    { ...base, bookmaker: "Superbet", market: "DOUBLE_CHANCE", line: "", outcome: "1X", decimalOdds: "", siteOdds: "", siteObservedAt: "" },
    { ...base, bookmaker: "Stoiximan", market: "BTTS", line: "", outcome: "YES", decimalOdds: "1.80", siteOdds: "1.80", siteObservedAt: "2026-06-24T11:59:50.000Z" },
  ];
  await writeCsv(inputPath, rows, columns);

  const out = collector();
  const code = await runCli(["evaluate", inputPath], { out: out.write, err: () => {}, reportsDir });

  assert.equal(code, 0);
  assert.match(out.text, /Stoiximan.*TOTALS|TOTALS.*Stoiximan/s);
  assert.match(out.text, /Superbet.*MATCH_RESULT|MATCH_RESULT.*Superbet/s);
  assert.match(out.text, /NOT_APPLICABLE/);
  assert.match(out.text, /REJECTED|rejected|skew/i);

  const files = await readdir(reportsDir);
  assert.ok(files.some((name) => name !== "capture.csv" && name.endsWith(".csv")));
});

test("resolveEnvPath walks up parent directories to find .env.local", async () => {
  const dir = await mkdtemp(join(tmpdir(), "odds-env-walk-"));
  const sub = join(dir, "nested", "deep");
  await mkdtemp(join(tmpdir(), "ignored-")); // noise
  const { mkdir } = await import("node:fs/promises");
  await mkdir(sub, { recursive: true });
  await writeFile(join(dir, ".env.local"), "ODDS_API_IO_KEY=x\n");

  const fileExists = async (path) => access(path).then(() => true, () => false);
  const resolved = await resolveEnvPath(sub, {
    fileExists,
    runGit: async () => { throw new Error("git should not be consulted"); },
  });
  assert.equal(resolved, join(dir, ".env.local"));
});

test("resolveEnvPath falls back to the git common directory parent", async () => {
  const mainRoot = await mkdtemp(join(tmpdir(), "odds-main-"));
  const worktree = await mkdtemp(join(tmpdir(), "odds-worktree-"));
  await writeFile(join(mainRoot, ".env.local"), "ODDS_API_IO_KEY=x\n");

  const fileExists = async (path) => access(path).then(() => true, () => false);
  const resolved = await resolveEnvPath(worktree, {
    fileExists,
    runGit: async () => join(mainRoot, ".git"),
  });
  assert.equal(resolved, join(mainRoot, ".env.local"));
});
