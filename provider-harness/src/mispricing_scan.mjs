import { normalizeValueBets } from "./mispricing_normalize.mjs";
import { resolveSportKey } from "./multisport_map.mjs";
import { matchCandidateEvent } from "./mispricing_match.mjs";
import { confirmCandidate } from "./mispricing_confirm.mjs";
import {
  buildClvTrackingRow,
  candidateIdentity,
  mergeClvLedger,
  mergeQueue,
  selectSportGroups,
  shouldSendAlert,
} from "./mispricing_state.mjs";
import { normalizeTheOddsResponse } from "./theodds_normalize.mjs";

const BOOKMAKERS = ["Stoiximan", "Superbet"];
const QUOTA_RESERVE = 100;

async function maybeSendHealthWarning({
  telegramClient,
  health,
  countField,
  warningField,
  providerLabel,
}) {
  if (Number(health[countField] ?? 0) < 3 || health[warningField]) return;
  try {
    await telegramClient.sendText(
      `Health warning: ${providerLabel} failed for 3 consecutive runs.`,
    );
    health[warningField] = true;
    health.telegramFailures = 0;
  } catch {
    health.telegramFailures = Number(health.telegramFailures ?? 0) + 1;
  }
}

function auditRow(now, dryRun, row, fields) {
  return {
    auditedAt: now.toISOString(), runMode: dryRun ? "DRY_RUN" : "LIVE",
    candidateId: row.candidateId, providerEventId: row.providerEventId,
    bookmaker: row.bookmaker, sportKey: row.sportKey ?? "",
    sportSlug: row.sportSlug, leagueSlug: row.leagueSlug,
    sportName: row.sportName, leagueName: row.leagueName,
    market: row.market, line: row.line, outcome: row.outcome,
    ...fields,
  };
}

export async function runMispricingScan({
  valueBetsClient,
  referenceClient,
  telegramClient,
  state,
  registry,
  now,
  dryRun = false,
  out = () => {},
}) {
  const summary = {
    candidates: 0, mapped: 0, verifiedSports: 0, confirmed: 0,
    sent: 0, deferred: 0, rejected: 0, dryRun, quotaRemaining: null,
  };
  const audit = await state.readAudit();
  const existingQueue = await state.readQueue();
  const existingClv = await state.readClvLedger();
  const health = await state.readHealth();
  const discovered = [];
  const clvTracked = [];

  for (const row of existingQueue) {
    if (new Date(row.kickoffUtc).getTime() <= now.getTime()) {
      audit.push(auditRow(now, dryRun, row, { status: "EXPIRED", reason: "EVENT_STARTED" }));
    }
  }

  try {
    for (const bookmaker of BOOKMAKERS) {
      const response = await valueBetsClient.getValueBets({ bookmaker });
      const normalized = normalizeValueBets(response.data, {
        receivedAt: response.receivedAt,
        now,
      });
      discovered.push(...normalized.candidates);
      summary.rejected += normalized.rejected.length;
      for (const rejected of normalized.rejected) {
        audit.push(auditRow(now, dryRun, rejected, {
          sportKey: "", status: "REJECTED", reason: rejected.reason,
        }));
      }
    }
    health.oddsApiFailures = 0;
    health.oddsApiWarningSent = false;
  } catch (error) {
    health.oddsApiFailures = Number(health.oddsApiFailures ?? 0) + 1;
    await maybeSendHealthWarning({
      telegramClient, health,
      countField: "oddsApiFailures", warningField: "oddsApiWarningSent",
      providerLabel: "Odds-API.io",
    });
    await state.writeHealth(health);
    throw error;
  }

  summary.candidates = discovered.length;

  // Detection tier: when nothing fresh clears the EV floor and no earlier
  // candidate is still queued, there is nothing to confirm. Exit before touching
  // The Odds API at all, so the frequent (e.g. 15-min) cadence spends zero
  // reference credits on the common no-op cycle and only the confirmation tier
  // ever calls listSports/listEvents/getOdds.
  if (discovered.length === 0 && existingQueue.length === 0) {
    await state.writeQueue([]);
    await state.writeHealth(health);
    out(`${JSON.stringify(summary)}\n`);
    return summary;
  }

  let sportsResponse;
  try {
    sportsResponse = await referenceClient.listSports();
  } catch (error) {
    health.referenceFailures = Number(health.referenceFailures ?? 0) + 1;
    const recoverable = discovered.flatMap((candidate) => {
      const sportKey = registry.get(`${candidate.sportSlug}|${candidate.leagueSlug}`);
      return sportKey ? [{ ...candidate, sportKey }] : [];
    });
    await state.writeQueue(mergeQueue(existingQueue, recoverable, { now }));
    for (const candidate of recoverable) {
      audit.push(auditRow(now, dryRun, candidate, {
        status: "ERROR", reason: "REFERENCE_SPORTS_LOOKUP_ERROR",
      }));
    }
    await state.writeAudit(audit);
    await maybeSendHealthWarning({
      telegramClient, health,
      countField: "referenceFailures", warningField: "referenceWarningSent",
      providerLabel: "The Odds API",
    });
    await state.writeHealth(health);
    throw error;
  }
  summary.quotaRemaining = sportsResponse.quota?.remaining ?? summary.quotaRemaining;
  const activeSports = (sportsResponse.data ?? []).filter((sport) => sport.active);
  const active = new Set(activeSports.map((sport) => sport.key));

  const mapped = [];
  for (const candidate of discovered) {
    const resolution = resolveSportKey(candidate, registry, active, activeSports);
    if (!resolution.sportKey) {
      audit.push(auditRow(now, dryRun, candidate, {
        sportKey: "", status: "REJECTED", reason: resolution.reason,
      }));
      summary.rejected += 1;
      continue;
    }
    mapped.push({ ...candidate, sportKey: resolution.sportKey });
  }
  summary.mapped = mapped.length;

  const queue = mergeQueue(existingQueue, mapped, { now });
  const groups = selectSportGroups(queue, { maxSports: 2 });
  const selectedKeys = new Set(groups.keys());
  const initiallyDeferred = queue.filter((row) => !selectedKeys.has(row.sportKey));
  summary.deferred = initiallyDeferred.length;
  for (const row of initiallyDeferred) {
    audit.push(auditRow(now, dryRun, row, { status: "DEFERRED", reason: "SPORT_CAP" }));
  }

  const delivered = await state.readAlerts();
  const deliveredByIdentity = new Map(delivered.map((row) => [row.identity, row]));
  const remainingQueue = queue.filter((row) => !selectedKeys.has(row.sportKey));
  let referenceSucceeded = false;
  let referenceFailed = false;

  for (const [sportKey, candidates] of groups) {
    if (summary.quotaRemaining !== null && summary.quotaRemaining <= QUOTA_RESERVE) {
      remainingQueue.push(...candidates);
      summary.deferred += candidates.length;
      for (const candidate of candidates) {
        audit.push(auditRow(now, dryRun, candidate, { sportKey, status: "DEFERRED", reason: "QUOTA_RESERVE" }));
      }
      continue;
    }
    try {
      const events = await referenceClient.listEvents({ sportKey });
      const eventMatches = candidates.map((candidate) => ({
        candidate,
        match: matchCandidateEvent(candidate, events.data ?? []),
      }));
      const eventIds = [...new Set(
        eventMatches.filter((item) => item.match.event).map((item) => String(item.match.event.id)),
      )];
      if (eventIds.length === 0) {
        for (const { candidate, match } of eventMatches) {
          audit.push(auditRow(now, dryRun, candidate, { sportKey, status: "REJECTED", reason: match.reason }));
        }
        summary.rejected += candidates.length;
        continue;
      }
      // markets=h2h only: v1 is MATCH_RESULT, so 1 credit/sport not 2.
      const odds = await referenceClient.getOdds({ sportKey, eventIds, markets: "h2h" });
      referenceSucceeded = true;
      summary.quotaRemaining = odds.quota?.remaining ?? summary.quotaRemaining;
      summary.verifiedSports += 1;
      const selections = normalizeTheOddsResponse(odds.data ?? [], odds.receivedAt);

      for (const { candidate, match } of eventMatches) {
        if (!match.event) {
          audit.push(auditRow(now, dryRun, candidate, { sportKey, status: "REJECTED", reason: match.reason }));
          summary.rejected += 1;
          continue;
        }
        const confirmation = confirmCandidate(candidate, match.event, selections, { now });
        audit.push(auditRow(now, dryRun, candidate, {
          sportKey, status: confirmation.status, reason: confirmation.reason,
          pinnacleEv: confirmation.pinnacleEv ?? "",
          consensusEv: confirmation.consensusEv ?? "",
          consensusBooks: confirmation.consensusBooks ?? "",
          edgeOverDispersion: confirmation.edgeOverDispersion ?? "",
        }));
        if (confirmation.status !== "CONFIRMED") {
          summary.rejected += 1;
          continue;
        }
        summary.confirmed += 1;
        const identity = candidateIdentity(candidate);
        if (dryRun || !shouldSendAlert(deliveredByIdentity.get(identity), confirmation)) continue;
        try {
          const telegram = await telegramClient.sendMispricing(candidate, confirmation);
          delivered.push({
            identity, sentAt: now.toISOString(), candidateId: candidate.candidateId,
            providerEventId: candidate.providerEventId,
            referenceEventId: confirmation.referenceEventId,
            bookmaker: candidate.bookmaker, market: candidate.market,
            line: candidate.line, outcome: candidate.outcome,
            offeredOdds: candidate.offeredOdds,
            pinnacleEv: confirmation.pinnacleEv,
            consensusEv: confirmation.consensusEv,
            minimumConfirmedEv: confirmation.minimumConfirmedEv,
            telegramMessageId: telegram.messageId,
          });
          deliveredByIdentity.set(identity, delivered.at(-1));
          clvTracked.push(buildClvTrackingRow(candidate, confirmation, { sentAt: now.toISOString() }));
          summary.sent += 1;
          health.telegramFailures = 0;
        } catch {
          health.telegramFailures = Number(health.telegramFailures ?? 0) + 1;
          remainingQueue.push(candidate);
          audit.push(auditRow(now, dryRun, candidate, {
            sportKey, status: "DELIVERY_FAILED", reason: "TELEGRAM_ERROR",
            pinnacleEv: confirmation.pinnacleEv,
            consensusEv: confirmation.consensusEv,
            consensusBooks: confirmation.consensusBooks,
          }));
        }
      }
    } catch {
      referenceFailed = true;
      remainingQueue.push(...candidates);
      for (const candidate of candidates) {
        audit.push(auditRow(now, dryRun, candidate, { sportKey, status: "ERROR", reason: "REFERENCE_PROVIDER_ERROR" }));
      }
    }
  }

  if (referenceFailed && !referenceSucceeded) {
    health.referenceFailures = Number(health.referenceFailures ?? 0) + 1;
    await maybeSendHealthWarning({
      telegramClient, health,
      countField: "referenceFailures", warningField: "referenceWarningSent",
      providerLabel: "The Odds API",
    });
  } else if (referenceSucceeded) {
    health.referenceFailures = 0;
    health.referenceWarningSent = false;
  }

  await state.writeQueue(mergeQueue([], remainingQueue, { now }));
  await state.writeAlerts(delivered);
  await state.writeClvLedger(mergeClvLedger(existingClv, clvTracked));
  await state.writeAudit(audit);
  await state.writeHealth(health);
  out(`${JSON.stringify(summary)}\n`);
  return summary;
}
