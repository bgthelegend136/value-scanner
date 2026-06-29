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
  sportGroupKey,
} from "./mispricing_state.mjs";
import { normalizeTheOddsResponse } from "./theodds_normalize.mjs";

const BOOKMAKERS = ["Stoiximan", "Pamestoixima"];
const QUOTA_RESERVE = 1000;
const PRIMARY_REFERENCE_SOURCE = "the-odds-api";
const FALLBACK_REASONS = new Set([
  "NO_EVENT_MATCH",
  "NO_EXACT_PINNACLE_MARKET",
  "INSUFFICIENT_CONSENSUS",
]);

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
    bookmaker: row.bookmaker, referenceSource: row.referenceSource ?? "",
    sportKey: row.sportKey ?? "",
    sportSlug: row.sportSlug, leagueSlug: row.leagueSlug,
    sportName: row.sportName, leagueName: row.leagueName,
    market: row.market, line: row.line, outcome: row.outcome,
    ...fields,
  };
}

function normalizeReferenceSource(source, fallbackRegistry) {
  return {
    name: source.name,
    client: source.client,
    registry: source.registry ?? fallbackRegistry,
    normalizeOdds: source.normalizeOdds ?? normalizeTheOddsResponse,
  };
}

function identityOf(row) {
  return candidateIdentity(row);
}

function addCandidateMapping(mappingsByIdentity, candidate) {
  const identity = identityOf(candidate);
  if (!mappingsByIdentity.has(identity)) mappingsByIdentity.set(identity, []);
  mappingsByIdentity.get(identity).push(candidate);
}

function nextFallbackMapping(candidate, mappingsByIdentity, attemptedByIdentity) {
  const identity = identityOf(candidate);
  const attempted = attemptedByIdentity.get(identity) ?? new Set();
  return (mappingsByIdentity.get(identity) ?? []).find((row) =>
    !attempted.has(row.referenceSource ?? PRIMARY_REFERENCE_SOURCE),
  );
}

function groupRows(rows) {
  return selectSportGroups(rows, { maxSports: Number.POSITIVE_INFINITY });
}

export async function runMispricingScan({
  valueBetsClient,
  referenceClient,
  secondaryReferenceClients = [],
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
  // The Odds API at all, so the frequent cadence spends zero reference credits
  // on the common no-op cycle.
  if (discovered.length === 0 && existingQueue.length === 0) {
    await state.writeQueue([]);
    await state.writeHealth(health);
    await state.writeHeartbeat({ lastSuccessAt: now.toISOString(), summary });
    out(`${JSON.stringify(summary)}\n`);
    return summary;
  }

  const sourceContexts = [];
  let sportsResponse;
  try {
    sportsResponse = await referenceClient.listSports();
  } catch (error) {
    health.referenceFailures = Number(health.referenceFailures ?? 0) + 1;
    const recoverable = discovered.flatMap((candidate) => {
      const sportKey = registry.get(`${candidate.sportSlug}|${candidate.leagueSlug}`);
      return sportKey ? [{ ...candidate, referenceSource: PRIMARY_REFERENCE_SOURCE, sportKey }] : [];
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
  const primaryActiveSports = (sportsResponse.data ?? []).filter((sport) => sport.active);
  sourceContexts.push({
    name: PRIMARY_REFERENCE_SOURCE,
    client: referenceClient,
    registry,
    activeSports: primaryActiveSports,
    active: new Set(primaryActiveSports.map((sport) => sport.key)),
    normalizeOdds: normalizeTheOddsResponse,
  });

  for (const source of secondaryReferenceClients.map((item) => normalizeReferenceSource(item, registry))) {
    try {
      const response = await source.client.listSports();
      const activeSports = (response.data ?? []).filter((sport) => sport.active !== false);
      sourceContexts.push({
        ...source,
        activeSports,
        active: new Set(activeSports.map((sport) => sport.key)),
      });
    } catch {
      // A secondary source is optional coverage. If it is unavailable, the scan
      // keeps the primary fail-closed behavior rather than failing open.
    }
  }
  const sourceByName = new Map(sourceContexts.map((source) => [source.name, source]));

  const mappingsByIdentity = new Map();
  const preferredMapped = [];
  for (const candidate of discovered) {
    const mappedForCandidate = [];
    for (const source of sourceContexts) {
      const resolution = resolveSportKey(candidate, source.registry, source.active, source.activeSports);
      if (!resolution.sportKey) continue;
      mappedForCandidate.push({
        ...candidate,
        referenceSource: source.name,
        sportKey: resolution.sportKey,
      });
    }
    if (mappedForCandidate.length === 0) {
      audit.push(auditRow(now, dryRun, candidate, {
        sportKey: "", status: "REJECTED", reason: "UNMAPPED_SPORT_LEAGUE",
      }));
      summary.rejected += 1;
      continue;
    }
    summary.mapped += 1;
    for (const row of mappedForCandidate) addCandidateMapping(mappingsByIdentity, row);
    preferredMapped.push(mappedForCandidate[0]);
  }

  const queue = mergeQueue(existingQueue, preferredMapped, { now }).map((row) => ({
    ...row,
    referenceSource: row.referenceSource || PRIMARY_REFERENCE_SOURCE,
  }));
  for (const row of queue) {
    if (!mappingsByIdentity.has(identityOf(row))) addCandidateMapping(mappingsByIdentity, row);
  }

  const groups = selectSportGroups(queue, { maxSports: 2 });
  const selectedKeys = new Set(groups.keys());
  const initiallyDeferred = queue.filter((row) => !selectedKeys.has(sportGroupKey(row)));
  summary.deferred = initiallyDeferred.length;
  for (const row of initiallyDeferred) {
    audit.push(auditRow(now, dryRun, row, { status: "DEFERRED", reason: "SPORT_CAP" }));
  }

  const delivered = await state.readAlerts();
  const deliveredByIdentity = new Map(delivered.map((row) => [row.identity, row]));
  const remainingQueue = queue.filter((row) => !selectedKeys.has(sportGroupKey(row)));
  const attemptedByIdentity = new Map();
  let referenceSucceeded = false;
  let referenceFailed = false;
  let groupsToProcess = groups;

  while (groupsToProcess.size > 0) {
    const fallbackRows = [];

    for (const [, candidates] of groupsToProcess) {
      const referenceSource = candidates[0]?.referenceSource || PRIMARY_REFERENCE_SOURCE;
      const source = sourceByName.get(referenceSource);
      if (!source) {
        remainingQueue.push(...candidates);
        continue;
      }
      const sportKey = candidates[0].sportKey;
      if (summary.quotaRemaining !== null && summary.quotaRemaining <= QUOTA_RESERVE) {
        remainingQueue.push(...candidates);
        summary.deferred += candidates.length;
        for (const candidate of candidates) {
          audit.push(auditRow(now, dryRun, candidate, { sportKey, status: "DEFERRED", reason: "QUOTA_RESERVE" }));
        }
        continue;
      }
      try {
        const events = await source.client.listEvents({ sportKey });
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
            const attempted = attemptedByIdentity.get(identityOf(candidate)) ?? new Set();
            attempted.add(referenceSource);
            attemptedByIdentity.set(identityOf(candidate), attempted);
            const fallback = nextFallbackMapping(candidate, mappingsByIdentity, attemptedByIdentity);
            if (fallback && FALLBACK_REASONS.has(match.reason)) fallbackRows.push(fallback);
            else summary.rejected += 1;
          }
          continue;
        }
        const odds = await source.client.getOdds({ sportKey, eventIds, markets: "h2h" });
        referenceSucceeded = true;
        summary.quotaRemaining = odds.quota?.remaining ?? summary.quotaRemaining;
        summary.verifiedSports += 1;
        const selections = source.normalizeOdds(odds.data ?? [], odds.receivedAt);

        for (const { candidate, match } of eventMatches) {
          const attempted = attemptedByIdentity.get(identityOf(candidate)) ?? new Set();
          attempted.add(referenceSource);
          attemptedByIdentity.set(identityOf(candidate), attempted);

          if (!match.event) {
            audit.push(auditRow(now, dryRun, candidate, { sportKey, status: "REJECTED", reason: match.reason }));
            const fallback = nextFallbackMapping(candidate, mappingsByIdentity, attemptedByIdentity);
            if (fallback && FALLBACK_REASONS.has(match.reason)) fallbackRows.push(fallback);
            else summary.rejected += 1;
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
            const fallback = nextFallbackMapping(candidate, mappingsByIdentity, attemptedByIdentity);
            if (fallback && FALLBACK_REASONS.has(confirmation.reason)) fallbackRows.push(fallback);
            else summary.rejected += 1;
            continue;
          }
          summary.confirmed += 1;
          const identity = identityOf(candidate);
          if (dryRun || !shouldSendAlert(deliveredByIdentity.get(identity), confirmation)) continue;
          try {
            const telegram = await telegramClient.sendMispricing(candidate, confirmation);
            delivered.push({
              identity, sentAt: now.toISOString(), candidateId: candidate.candidateId,
              providerEventId: candidate.providerEventId,
              referenceSource: candidate.referenceSource,
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

    groupsToProcess = groupRows(fallbackRows);
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
  await state.writeHeartbeat({ lastSuccessAt: now.toISOString(), summary });
  out(`${JSON.stringify(summary)}\n`);
  return summary;
}
