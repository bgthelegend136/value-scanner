import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  alertIdentity,
  buildClvTrackingRow,
  candidateIdentity,
  createMispricingState,
  mergeClvLedger,
  mergeQueue,
  selectSportGroups,
  shouldSendAlert,
  sportGroupKey,
} from "../src/mispricing_state.mjs";

function candidate(overrides = {}) {
  return {
    candidateId: "c1", providerEventId: "501", bookmaker: "Stoiximan",
    sportKey: "soccer_fifa_world_cup", kickoffUtc: "2026-06-25T18:30:00Z",
    market: "MATCH_RESULT", line: "", outcome: "1",
    offeredOdds: 2.4, providerExpectedValue: 0.15,
    firstQueuedAt: "2026-06-25T08:00:00Z",
    ...overrides,
  };
}

test("candidate identity includes event, bookmaker, market, line, and outcome", () => {
  assert.equal(
    candidateIdentity(candidate()),
    "501|Stoiximan|MATCH_RESULT||1",
  );
});

test("alert identity uses the matched reference event instead of the provider event", () => {
  assert.equal(
    alertIdentity(
      candidate({ providerEventId: "provider-a" }),
      { referenceEventId: "ref-501" },
    ),
    "ref-501|Stoiximan|MATCH_RESULT||1",
  );
});

test("queue keeps latest odds but preserves first queued time and removes started events", () => {
  const existing = [candidate({ offeredOdds: 2.2 })];
  const incoming = [candidate({ offeredOdds: 2.5, firstQueuedAt: "" })];
  const rows = mergeQueue(existing, incoming, {
    now: new Date("2026-06-25T09:00:00Z"),
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].offeredOdds, 2.5);
  assert.equal(rows[0].firstQueuedAt, "2026-06-25T08:00:00Z");
  assert.equal(
    mergeQueue(rows, [], { now: new Date("2026-06-25T19:00:00Z") }).length,
    0,
  );
});

test("selects at most two sport groups by EV, kickoff, then queue age", () => {
  const selected = selectSportGroups([
    candidate({ sportKey: "sport-a", providerExpectedValue: 0.12 }),
    candidate({ sportKey: "sport-b", providerExpectedValue: 0.40 }),
    candidate({ sportKey: "sport-c", providerExpectedValue: 0.30 }),
  ]);
  assert.deepEqual([...selected.keys()], ["sport-b", "sport-c"]);
});

test("keeps identical sports separate when reference sources differ", () => {
  const selected = selectSportGroups([
    candidate({ sportKey: "sport-a", referenceSource: "the-odds-api", providerExpectedValue: 0.30 }),
    candidate({ sportKey: "sport-a", referenceSource: "opticodds", providerExpectedValue: 0.40 }),
    candidate({ sportKey: "sport-b", referenceSource: "the-odds-api", providerExpectedValue: 0.10 }),
  ]);
  assert.equal(sportGroupKey(candidate({ sportKey: "sport-a" })), "sport-a");
  assert.deepEqual([...selected.keys()], ["opticodds|sport-a", "the-odds-api|sport-a"]);
});
test("dedup sends first alert and only updates after five percentage points", () => {
  assert.equal(shouldSendAlert(null, { minimumConfirmedEv: 0.14 }), true);
  assert.equal(
    shouldSendAlert({ minimumConfirmedEv: "0.14" }, { minimumConfirmedEv: 0.189 }),
    false,
  );
  assert.equal(
    shouldSendAlert({ minimumConfirmedEv: "0.14" }, { minimumConfirmedEv: 0.19 }),
    true,
  );
});

test("builds a PENDING CLV tracking row from a candidate and confirmation", () => {
  const row = buildClvTrackingRow(
    candidate(),
    { referenceEventId: "ref-501", pinnacleFairProbability: 0.416667 },
    { sentAt: "2026-06-25T09:00:00Z" },
  );
  assert.equal(row.identity, "ref-501|Stoiximan|MATCH_RESULT||1");
  assert.equal(row.referenceEventId, "ref-501");
  assert.equal(row.sportKey, "soccer_fifa_world_cup");
  assert.equal(row.decimalOdds, "2.4000");
  assert.equal(row.sendFairProbability, "0.416667");
  assert.equal(row.status, "PENDING");
  assert.equal(row.clv, "");
});

test("CLV ledger round-trips tracking rows and merges new identities only", async () => {
  const reportsDir = await mkdtemp(join(tmpdir(), "mispricing-clv-"));
  const state = createMispricingState({ reportsDir });
  const first = buildClvTrackingRow(
    candidate(),
    { referenceEventId: "ref-501", pinnacleFairProbability: 0.4 },
    { sentAt: "2026-06-25T09:00:00Z" },
  );
  await state.writeClvLedger([first]);
  const restored = await state.readClvLedger();
  assert.equal(restored.length, 1);
  assert.equal(restored[0].identity, "ref-501|Stoiximan|MATCH_RESULT||1");
  assert.equal(restored[0].status, "PENDING");
  assert.equal(restored[0].decimalOdds, "2.4000");

  const second = buildClvTrackingRow(
    candidate({ providerEventId: "777", outcome: "2" }),
    { referenceEventId: "ref-777", pinnacleFairProbability: 0.3 },
    { sentAt: "2026-06-25T10:00:00Z" },
  );
  const merged = mergeClvLedger(restored, [first, second]);
  assert.equal(merged.length, 2);
  assert.deepEqual(
    merged.map((row) => row.identity).sort(),
    ["ref-501|Stoiximan|MATCH_RESULT||1", "ref-777|Stoiximan|MATCH_RESULT||2"].sort(),
  );
});

test("repository refuses corrupt health JSON and writes CSV state", async () => {
  const reportsDir = await mkdtemp(join(tmpdir(), "mispricing-state-"));
  const state = createMispricingState({ reportsDir });
  await state.writeQueue([candidate()]);
  assert.match(await readFile(join(reportsDir, "mispricing-queue.csv"), "utf8"), /candidateId/);
  const restored = await state.readQueue();
  assert.equal(typeof restored[0].offeredOdds, "number");
  assert.equal(typeof restored[0].providerExpectedValue, "number");

  await writeFile(join(reportsDir, "mispricing-health.json"), "{broken");
  await assert.rejects(() => state.readHealth(), /invalid mispricing health state/);
  assert.equal(await readFile(join(reportsDir, "mispricing-health.json"), "utf8"), "{broken");
});

test("repository rejects malformed queue CSV without rewriting it", async () => {
  const reportsDir = await mkdtemp(join(tmpdir(), "mispricing-corrupt-csv-"));
  const path = join(reportsDir, "mispricing-queue.csv");
  const original = "candidateId,providerEventId\nc1,\n";
  await writeFile(path, original);
  const state = createMispricingState({ reportsDir });
  await assert.rejects(() => state.readQueue(), /invalid mispricing queue row/);
  assert.equal(await readFile(path, "utf8"), original);
});
