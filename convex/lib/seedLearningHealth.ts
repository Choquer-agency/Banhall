import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { FIRM_TIME_ZONE } from "../../shared/firmTime";
import { resolveGatedWorkflow } from "./gatedWorkflow";
import { learningHealthReads } from "./learningHealthReads";
import { sha256Text, stableSerialize } from "./seedRevisions";

const MINUTE = 60_000;
const ACTIVE_GAP_LIMIT = 10 * MINUTE;
const SEED_CALL_PREFIXES = [
  "generation:seeds:",
  "generation:seedFeedback:",
];
const HALF_OPEN_INTERVAL: "[start,end)" = "[start,end)";
const SEED_WORKFLOW: "seeds" = "seeds";
const LATENCY_COMPARISON: "same project and model" = "same project and model";

export const SEED_HEALTH_LIMITS = {
  periodEvents: 5_000,
  periodUsage: 5_000,
  generationEvents: 2_000,
  roleFeedback: 500,
  seedsPerBatch: 256,
  reportsPerGeneration: 20,
  generationsPerProject: 200,
};

type TimedEvent = Pick<Doc<"seedDecisionEvents">, "at" | "_creationTime">;

export type Distribution = {
  samples: number;
  median: number | null;
  p95: number | null;
  min: number | null;
  max: number | null;
};

export function halfOpenContains(start: number, end: number, value: number) {
  return value >= start && value < end;
}

/** Nearest-rank p95, with the ordinary midpoint median for even populations. */
export function summarizeDistribution(values: readonly number[]): Distribution {
  if (values.length === 0) {
    return { samples: 0, median: null, p95: null, min: null, max: null };
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? (sorted[middle - 1] + sorted[middle]) / 2
      : sorted[middle];
  const p95 = sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)];
  return {
    samples: sorted.length,
    median,
    p95,
    min: sorted[0],
    max: sorted[sorted.length - 1],
  };
}

/** SM-2 event-gap proxy: only consecutive gaps strictly below ten minutes. */
export function activeTimeMs(
  events: readonly TimedEvent[],
  through: number,
): { activeMs: number; elapsedMs: number | null } {
  const ordered = events
    .filter((event) => event.at <= through)
    .sort(
      (left, right) =>
        left.at - right.at || left._creationTime - right._creationTime,
    );
  if (ordered.length === 0) return { activeMs: 0, elapsedMs: null };
  let activeMs = 0;
  for (let index = 1; index < ordered.length; index += 1) {
    const gap = ordered[index].at - ordered[index - 1].at;
    if (gap >= 0 && gap < ACTIVE_GAP_LIMIT) activeMs += gap;
  }
  return { activeMs, elapsedMs: through - ordered[0].at };
}

function isSeedCall(callSite: string) {
  return SEED_CALL_PREFIXES.some((prefix) => callSite.startsWith(prefix));
}

function increment(map: Map<string, number>, key: string) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

type CohortState = {
  generation: Doc<"generations">;
  project: Doc<"projects">;
  events: Doc<"seedDecisionEvents">[];
  eventsComplete: boolean;
  cancelled: boolean;
};

/**
 * Load and compute the AD-39 seed-workflow scorecard under one shared byte
 * budget. Primary timestamps come from the event/usage named by the contract;
 * entity and generation reads deliberately cross the requested window.
 */
export async function readSeedLearningHealth(
  ctx: QueryCtx,
  args: { start: number; end: number },
) {
  const truncated = new Set<string>();
  const reads = learningHealthReads(truncated);
  let missingJoins = 0;
  let invalidDurations = 0;

  const periodEventRead = await reads.list(
    "seed period events",
    ctx.db
      .query("seedDecisionEvents")
      .withIndex("by_at", (query) =>
        query.gte("at", args.start).lt("at", args.end),
      )
      .order("asc"),
    SEED_HEALTH_LIMITS.periodEvents,
  );
  const periodUsageRead = await reads.list(
    "seed period usage",
    ctx.db
      .query("aiUsage")
      .withIndex("by_createdAt", (query) =>
        query.gte("createdAt", args.start).lt("createdAt", args.end),
      )
      .order("asc"),
    SEED_HEALTH_LIMITS.periodUsage,
  );

  const cohortCache = new Map<Id<"generations">, CohortState | null>();
  const feedbackCache = new Map<string, Doc<"seedFeedbackRequests">[]>();
  const reportCache = new Map<Id<"generations">, Doc<"reports">[]>();
  const batchCache = new Map<Id<"seedBatches">, Doc<"seedBatches"> | null>();
  const seedCache = new Map<Id<"seeds">, Doc<"seeds"> | null>();

  async function loadBatch(id: Id<"seedBatches">) {
    const known = batchCache.get(id);
    if (known !== undefined) return known;
    const loaded = await reads.one("seedBatches joins", () =>
      ctx.db.get("seedBatches", id),
    );
    if (loaded.kind === "not-loaded") return null;
    if (loaded.value === null) missingJoins += 1;
    batchCache.set(id, loaded.value);
    return loaded.value;
  }

  async function loadSeed(id: Id<"seeds">) {
    const known = seedCache.get(id);
    if (known !== undefined) return known;
    const loaded = await reads.one("seeds joins", () =>
      ctx.db.get("seeds", id),
    );
    if (loaded.kind === "not-loaded") return null;
    if (loaded.value === null) missingJoins += 1;
    seedCache.set(id, loaded.value);
    return loaded.value;
  }

  async function cohort(generationId: Id<"generations">) {
    if (cohortCache.has(generationId)) return cohortCache.get(generationId) ?? null;
    const generationRead = await reads.one("generation joins", () =>
      ctx.db.get("generations", generationId),
    );
    if (generationRead.kind === "not-loaded" || !generationRead.value) {
      if (generationRead.kind === "loaded") missingJoins += 1;
      cohortCache.set(generationId, null);
      return null;
    }
    const generation = generationRead.value;
    if (resolveGatedWorkflow(generation) !== "seeds") {
      cohortCache.set(generationId, null);
      return null;
    }
    const projectRead = await reads.one("project joins", () =>
      ctx.db.get("projects", generation.projectId),
    );
    if (projectRead.kind === "not-loaded" || !projectRead.value) {
      if (projectRead.kind === "loaded") missingJoins += 1;
      cohortCache.set(generationId, null);
      return null;
    }
    if (projectRead.value.usedInDevelopment === true) {
      cohortCache.set(generationId, null);
      return null;
    }
    const generationEventRead = await reads.list(
      "generation event joins",
      ctx.db
        .query("seedDecisionEvents")
        .withIndex("by_generationId_and_at", (query) =>
          query.eq("generationId", generationId),
        )
        .order("asc"),
      SEED_HEALTH_LIMITS.generationEvents,
    );
    const state: CohortState = {
      generation,
      project: projectRead.value,
      events: generationEventRead.rows,
      eventsComplete: generationEventRead.complete,
      cancelled: generationEventRead.rows.some((event) => event.kind === "cancel"),
    };
    cohortCache.set(generationId, state);
    return state;
  }

  async function feedbackForRole(
    generationId: Id<"generations">,
    roleId: Doc<"seedFeedbackRequests">["roleId"],
  ) {
    const key = `${generationId}:${roleId}`;
    const known = feedbackCache.get(key);
    if (known) return known;
    const result = await reads.list(
      "feedback joins",
      ctx.db
        .query("seedFeedbackRequests")
        .withIndex("by_generationId_and_roleId", (query) =>
          query.eq("generationId", generationId).eq("roleId", roleId),
        ),
      SEED_HEALTH_LIMITS.roleFeedback,
    );
    feedbackCache.set(key, result.rows);
    return result.rows;
  }

  async function reportsForGeneration(generationId: Id<"generations">) {
    const known = reportCache.get(generationId);
    if (known) return known;
    const result = await reads.list(
      "report joins",
      ctx.db
        .query("reports")
        .withIndex("by_generationId", (query) =>
          query.eq("generationId", generationId),
        ),
      SEED_HEALTH_LIMITS.reportsPerGeneration,
    );
    reportCache.set(generationId, result.rows);
    return result.rows;
  }

  const requestsByGeneration = new Map<string, number>();
  let requests = 0;
  let cancelledRequests = 0;
  let costUsd = 0;
  for (const usage of periodUsageRead.rows) {
    if (!usage.generationId || !isSeedCall(usage.callSite)) continue;
    const state = await cohort(usage.generationId);
    if (!state) continue;
    requests += 1;
    increment(requestsByGeneration, String(usage.generationId));
    if (state.cancelled) cancelledRequests += 1;
    else costUsd += usage.costUsd;
  }

  let batchesCompleted = 0;
  let batchesViewed = 0;
  let seedsViewed = 0;
  let selections = 0;
  let edits = 0;
  let regenerates = 0;
  let signOffs = 0;
  const dispatchToResultMs: number[] = [];
  const foregroundToFirstRenderMs: number[] = [];
  const activeMs: number[] = [];
  const elapsedMs: number[] = [];
  const seedProseMs: number[] = [];
  const signOffStates: Array<{
    event: Doc<"seedDecisionEvents">;
    state: CohortState;
  }> = [];

  const feedback = {
    requests: 0,
    withdrawals: 0,
    unresolved: 0,
    firstApproveExposure: {
      selected: 0,
      notSelected: 0,
      responseNotAvailable: 0,
    },
    eligible: { selected: 0, notSelected: 0 },
  };
  const stale = {
    opened: 0,
    open: 0,
    resolved: 0,
    bypassed: 0,
    freshAttemptUsed: 0,
    confirmedOnly: 0,
  };
  const resolvedStaleMs: number[] = [];

  for (const event of periodEventRead.rows) {
    const state = await cohort(event.generationId);
    if (!state || state.cancelled) continue;

    if (event.kind === "batchCompleted" || event.kind === "batchFailed") {
      if (!event.batchId) {
        missingJoins += 1;
      } else {
        const batch = await loadBatch(event.batchId);
        if (batch) {
          const duration = event.at - batch.queuedAt;
          if (duration >= 0) dispatchToResultMs.push(duration);
          else invalidDurations += 1;
          if (event.kind === "batchCompleted") batchesCompleted += 1;
        }
      }
    }

    if (event.kind === "batchViewed") {
      batchesViewed += 1;
      if (!event.batchId) {
        missingJoins += 1;
      } else {
        const batch = await loadBatch(event.batchId);
        if (batch) {
          const seedRead = await reads.list(
            "viewed seed joins",
            ctx.db
              .query("seeds")
              .withIndex("by_batchId", (query) => query.eq("batchId", batch._id)),
            SEED_HEALTH_LIMITS.seedsPerBatch,
          );
          seedsViewed += seedRead.rows.length;
          if (batch.roleOpen === true) {
            const duration = event.at - batch.queuedAt;
            if (duration >= 0) foregroundToFirstRenderMs.push(duration);
            else invalidDurations += 1;
          }
        }
      }
    }

    if (event.kind === "select") selections += 1;
    if (event.kind === "edit") edits += 1;
    if (event.kind === "regenerate") regenerates += 1;

    if (event.kind === "feedbackRequested") {
      feedback.requests += 1;
      if (!event.feedbackRequestId) {
        missingJoins += 1;
      } else {
        const feedbackRequestId = event.feedbackRequestId;
        const loaded = await reads.one("feedback request joins", () =>
          ctx.db.get("seedFeedbackRequests", feedbackRequestId),
        );
        if (loaded.kind === "loaded") {
          if (!loaded.value) missingJoins += 1;
          else if (!loaded.value.eligibleScore) feedback.unresolved += 1;
        }
      }
    }
    if (event.kind === "feedbackWithdrawn") feedback.withdrawals += 1;

    if (event.kind === "approve") {
      const roleFeedback = await feedbackForRole(event.generationId, event.roleId);
      for (const request of roleFeedback) {
        if (request.firstApproveExposure?.approveEventId === event._id) {
          switch (request.firstApproveExposure.outcome) {
            case "selected":
              feedback.firstApproveExposure.selected += 1;
              break;
            case "not_selected":
              feedback.firstApproveExposure.notSelected += 1;
              break;
            case "response_not_available":
              feedback.firstApproveExposure.responseNotAvailable += 1;
              break;
          }
        }
        if (request.eligibleScore?.approveEventId === event._id) {
          if (request.eligibleScore.selected) feedback.eligible.selected += 1;
          else feedback.eligible.notSelected += 1;
        }
      }
    }

    if (event.kind === "staleOpened") {
      stale.opened += 1;
      if (!event.staleEpisodeId) {
        missingJoins += 1;
      } else {
        const staleEpisodeId = event.staleEpisodeId;
        const loaded = await reads.one("stale episode joins", () =>
          ctx.db.get("seedStaleEpisodes", staleEpisodeId),
        );
        if (loaded.kind === "loaded") {
          if (!loaded.value) missingJoins += 1;
          else if (loaded.value.disposedAt === undefined) stale.open += 1;
        }
      }
    }
    if (event.kind === "staleDisposed") {
      if (!event.staleEpisodeId) {
        missingJoins += 1;
      } else {
        const staleEpisodeId = event.staleEpisodeId;
        const loaded = await reads.one("stale episode joins", () =>
          ctx.db.get("seedStaleEpisodes", staleEpisodeId),
        );
        if (loaded.kind === "loaded") {
          const episode = loaded.value;
          if (!episode || episode.disposedAt === undefined || !episode.disposition) {
            missingJoins += 1;
          } else if (episode.disposition === "bypassed") {
            stale.bypassed += 1;
          } else {
            stale.resolved += 1;
            if (episode.freshAttemptCompleted === true) stale.freshAttemptUsed += 1;
            else if (episode.olderSelectionsConfirmed === true) stale.confirmedOnly += 1;
            const duration = episode.disposedAt - episode.openedAt;
            if (duration >= 0) resolvedStaleMs.push(duration);
            else invalidDurations += 1;
          }
        }
      }
    }

    if (event.kind === "signOff") {
      signOffs += 1;
      signOffStates.push({ event, state });
      if (state.eventsComplete) {
        const effort = activeTimeMs(state.events, event.at);
        activeMs.push(effort.activeMs);
        if (effort.elapsedMs !== null && effort.elapsedMs >= 0) {
          elapsedMs.push(effort.elapsedMs);
        }
      }
      const reports = await reportsForGeneration(event.generationId);
      const created = reports
        .filter((report) => report.generatedAt >= event.at)
        .sort((left, right) => left.generatedAt - right.generatedAt)[0];
      if (created) seedProseMs.push(created.generatedAt - event.at);
    }
  }

  let approvedSubsections = 0;
  let withUneditedOriginal = 0;
  for (const { event } of signOffStates) {
    const byRole = new Map<string, boolean>();
    for (const item of event.snapshot?.items ?? []) {
      const seed = await loadSeed(item.seedId);
      if (!seed) continue;
      const originalHash = await sha256Text(stableSerialize(seed.bullets));
      const lands =
        seed.revisionOfSeedId === undefined && item.wordingHash === originalHash;
      byRole.set(seed.roleId, (byRole.get(seed.roleId) ?? false) || lands);
    }
    approvedSubsections += byRole.size;
    for (const lands of byRole.values()) if (lands) withUneditedOriginal += 1;
  }

  const singleBaselineMs: number[] = [];
  const baselineReportIds = new Set<Id<"reports">>();
  for (const { state } of signOffStates) {
    const model = state.generation.singleModelId;
    if (!model) continue;
    const generationRead = await reads.list(
      "single-mode comparison generations",
      ctx.db
        .query("generations")
        .withIndex("by_projectId", (query) =>
          query.eq("projectId", state.project._id),
        ),
      SEED_HEALTH_LIMITS.generationsPerProject,
    );
    for (const generation of generationRead.rows) {
      if (
        generation.candidateMode !== "single" ||
        generation.singleModelId !== model
      ) {
        continue;
      }
      const reports = await reportsForGeneration(generation._id);
      for (const report of reports) {
        if (
          baselineReportIds.has(report._id) ||
          !halfOpenContains(args.start, args.end, report.generatedAt)
        ) {
          continue;
        }
        const requestedAt = generation.requestedAt ?? generation.startedAt;
        const duration = report.generatedAt - requestedAt;
        if (duration >= 0) {
          baselineReportIds.add(report._id);
          singleBaselineMs.push(duration);
        } else invalidDurations += 1;
      }
    }
  }

  const incomplete =
    truncated.size > 0 || missingJoins > 0 || invalidDurations > 0;
  const eligibleScores = feedback.eligible.selected + feedback.eligible.notSelected;
  return {
    window: {
      start: args.start,
      end: args.end,
      interval: HALF_OPEN_INTERVAL,
      timeZone: FIRM_TIME_ZONE,
    },
    gatedWorkflow: SEED_WORKFLOW,
    incomplete,
    usage: {
      requests,
      cancelledRequests,
      costUsd,
      perGeneration: summarizeDistribution([...requestsByGeneration.values()]),
    },
    batches: { completed: batchesCompleted, viewed: batchesViewed },
    seeds: { viewed: seedsViewed, selected: selections, edited: edits },
    feedback: {
      ...feedback,
      eligible: {
        ...feedback.eligible,
        denominator: eligibleScores,
        selectedRate:
          eligibleScores === 0 ? null : feedback.eligible.selected / eligibleScores,
      },
    },
    regenerates,
    stale: {
      ...stale,
      resolvedDurationMs: summarizeDistribution(resolvedStaleMs),
    },
    signOff: {
      count: signOffs,
      activeTimeMs: summarizeDistribution(activeMs),
      elapsedTimeMs: summarizeDistribution(elapsedMs),
      seedsLand: {
        approvedSubsections,
        withUneditedOriginal,
        rate:
          approvedSubsections === 0
            ? null
            : withUneditedOriginal / approvedSubsections,
      },
    },
    latency: {
      dispatchToValidatedResultMs: summarizeDistribution(dispatchToResultMs),
      foregroundDispatchToFirstRenderMs: summarizeDistribution(
        foregroundToFirstRenderMs,
      ),
      signOffToReportCreatedMs: summarizeDistribution(seedProseMs),
      singleModeRequestToReportCreatedMs: summarizeDistribution(singleBaselineMs),
      comparison: LATENCY_COMPARISON,
    },
    coverage: {
      periodEvents: periodEventRead.rows.length,
      periodUsageRows: periodUsageRead.rows.length,
      missingJoins,
      invalidDurations,
      truncated: [...truncated],
      limits: SEED_HEALTH_LIMITS,
      byteBudget: reads.snapshot(),
    },
  };
}
