import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { readCsv, writeCsv } from "../src/csv.mjs";

test("round trips commas, quotes, newlines, and blank values", async () => {
  const directory = await mkdtemp(join(tmpdir(), "odds-csv-"));
  const path = join(directory, "report.csv");
  const rows = [
    { eventId: "1", notes: "comma, quote \" and\nnewline", siteOdds: "" },
    { eventId: "2", notes: "", siteOdds: "1.95" },
  ];

  await writeCsv(path, rows, ["eventId", "siteOdds", "notes"]);
  const parsed = await readCsv(path);

  assert.deepEqual(parsed, rows);
  assert.deepEqual(Object.keys(parsed[0]), ["eventId", "siteOdds", "notes"]);
});
