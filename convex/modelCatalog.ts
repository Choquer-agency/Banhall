/**
 * Automatic model catalog (owner decision 21, 2026-09-24, amended
 * 2026-10-22: models follow the newest version of their tier).
 *
 * A daily cron (convex/crons.ts) runs `refreshCatalog`: it pulls OpenRouter's
 * public model list (and Artificial Analysis scores when AA_API_KEY is set),
 * upserts the catalog, logs catalog problems for admins (renamed, expiring
 * or gone models, missing endpoints), checks per-provider endpoint support
 * for tools and structured outputs, moves a track back when its new model is
 * failing in production, and moves each track (shared/modelTracks.ts) to its
 * newest version once that version passes a readiness check
 * (convex/ai/modelReadiness.ts). Every move is logged in modelSwitchEvents.
 *
 * Nothing here writes to the alerts board (errorReports): model notices go
 * to the admin-only log on /admin/models (modelAdminNotices). Evaluations no
 * longer run and never switch a role; their history stays readable.
 *
 * Guardrails: generations freeze their models at reservation
 * (lib/modelRoles.ts freezeModelsForGeneration); every track keeps its
 * previous model for a one-call move back; the `models.autoSwitch` setting
 * is a kill switch for every track upgrade and rollback; a per-role cost cap
 * bounds OpenRouter prices.
 *
 * The decision logic lives in shared/modelCatalog.ts and
 * shared/modelTracks.ts and is tested there.
 */
import { v, type Infer } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { getCurrentUserOrNull, requireRole } from "./lib/auth";
import { domainError } from "./lib/contracts";
import {
  AUTOMATION_THRESHOLDS,
  MODEL_ROLES,
  ROLE_POLICIES,
  artificialAnalysisScore,
  bestIntelligenceScore,
  diffCatalog,
  directRowFromListing,
  parseArtificialAnalysis,
  parseEndpointSupport,
  parseOpenRouterModels,
  productionErrorVerdict,
  promotionGates,
  readinessAllowsMove,
  refreshedFields,
  seedCatalogModels,
  summarizeEvalRun,
  trackUpgradeListing,
  validCostCap,
  type CatalogFields,
  type ParsedModel,
} from "../shared/modelCatalog";
import { RETIRED_SEED_LABELS, modelLabelOf, seedModelById } from "../shared/generationModels";
import {
  MODEL_TRACKS,
  MODEL_TRACK_IDS,
  trackLabelFor,
  trackOf,
  type ModelTrackId,
} from "../shared/modelTracks";
import { openRouterAnthropicRequestId } from "../shared/anthropicTransport";
import {
  AUTO_SWITCH_KEY,
  EVAL_BUDGET_KEY,
  assignRoleTrackByHand,
  autoSwitchEnabled,
  catalogRow,
  costCapKey,
  ensureTrackRow,
  frozenEntryForModel,
  generationModelFreeze,
  moveTrack,
  raiseAdminNotice,
  roleAssignment,
  roleCostCap,
  roleModelId,
  roleTrack,
  rolledBackFrom,
  trackModelId,
  trackRow,
  assignRoleModelByHand,
} from "./lib/modelRoles";
import {
  catalogFieldsValidator,
  endpointSupportValidator,
  evalEnvelopeValidator,
  evalPricingValidator,
  evalTaskKindValidator,
  evalTaskResultValidator,
  frozenModelEntryValidator,
  modelFreezeValidator,
  modelRoleValidator,
  modelTrackValidator,
  parsedModelValidator,
  type FrozenModelEntry,
} from "./lib/modelCatalogValidators";
import {
  applyCatalogRefreshRef,
  checkProductionErrorsRef,
  endpointCheckTargetsRef,
  pruneCallOutcomesRef,
  recordEndpointSupportRef,
  refreshCatalogRef,
  resolveModelCatalogAlertsRef,
  seedCatalogRef,
  upgradeTracksRef,
} from "./lib/modelCatalogRefs";

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const OPENROUTER_ENDPOINTS_URL = (slug: string) =>
  `https://openrouter.ai/api/v1/models/${slug}/endpoints`;
const ARTIFICIAL_ANALYSIS_URL = "https://artificialanalysis.ai/api/v2/data/llms/models";
const FETCH_TIMEOUT_MS = 30_000;
/** Rows read per catalog pass: the full OpenRouter text catalog is ~400. */
const CATALOG_READ_LIMIT = 2000;

async function setSetting(
  ctx: MutationCtx,
  key: string,
  value: string,
  updatedBy: Id<"users">
): Promise<void> {
  const existing = await ctx.db
    .query("appSettings")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
  const patch = { value, updatedBy, updatedAt: Date.now() };
  if (existing) await ctx.db.patch(existing._id, patch);
  else await ctx.db.insert("appSettings", { key, ...patch });
}

/** Every model a role or a track runs today. */
async function assignedModelIds(ctx: QueryCtx | MutationCtx): Promise<Set<string>> {
  const ids = new Set<string>();
  for (const role of MODEL_ROLES) ids.add(await roleModelId(ctx, role));
  for (const track of MODEL_TRACK_IDS) ids.add(await trackModelId(ctx, track));
  return ids;
}
// ─── Seed and refresh ───────────────────────────────────────────────────────

type SeedRow = ReturnType<typeof seedCatalogModels>[number];

/**
 * Whether an existing row may become the seed row for its id. A seed added
 * after the daily refresh already listed the same id from OpenRouter (GPT-6
 * Sol and Luna, 2026-09-25) sits in the table as an OpenRouter candidate,
 * which pickers hide. It is adopted only while nobody has acted on it: still
 * a candidate (every model a track moves to is enabled by moveTrack,
 * and an enabled row never goes back to candidate), still listed, on the
 * seed's gateway, and never rolled back from by any role under any of its
 * ids.
 */
async function adoptableAsSeed(
  ctx: MutationCtx,
  row: Doc<"modelCatalog">,
  seed: SeedRow
): Promise<boolean> {
  if (row.source !== "openrouter" || row.status !== "candidate") return false;
  if (row.gateway !== seed.gateway || row.missingSince !== undefined) return false;
  for (const role of MODEL_ROLES) {
    if (await rolledBackFrom(ctx, role, row.modelId)) return false;
  }
  return true;
}

/**
 * Insert every seed model the table does not hold yet, and enable a seed id
 * the refresh found first (adoptableAsSeed). An adopted row takes the seed's
 * label, description and reasoning and max-output declarations, and keeps
 * the provider's prices, slug and scores. A seed row the retire step below
 * retired (under a build without that seed) comes back enabled when its id
 * is a seed again (a build rolled back, then forward); an enabled seed row
 * whose id is no longer a seed is retired unless a role uses it. Role assignments, switch events and evaluations are never
 * touched. Idempotent.
 */
export async function ensureSeedCatalog(ctx: MutationCtx, now: number): Promise<number> {
  let written = 0;
  const seeds = seedCatalogModels(now);
  for (const seed of seeds) {
    const row = await catalogRow(ctx, seed.modelId);
    if (!row) {
      await ctx.db.insert("modelCatalog", { ...seed, updatedAt: now });
      written += 1;
      continue;
    }
    // Only the retire step below leaves a seed row not enabled: seeds are
    // inserted enabled, "gone" never retires an enabled row, and "returned"
    // only turns such a retired row into a candidate. So every non-enabled
    // seed row is undone here, with or without missingSince (fable-3 review
    // P3-1); an OpenRouter seed OpenRouter stopped listing keeps its
    // missingSince, as an enabled seed does.
    if (row.source === "seed" && row.status !== "enabled") {
      await ctx.db.patch(row._id, { status: "enabled", updatedAt: now });
      written += 1;
      continue;
    }
    if (!(await adoptableAsSeed(ctx, row, seed))) continue;
    await ctx.db.patch(row._id, {
      status: "enabled",
      source: "seed",
      displayName: seed.displayName,
      provider: seed.provider,
      ...(seed.description ? { description: seed.description } : {}),
      reasoning: seed.reasoning,
      ...(seed.maxCompletionTokens !== undefined
        ? { maxCompletionTokens: seed.maxCompletionTokens }
        : {}),
      ...(seed.forcedToolChoice === false ? { forcedToolChoice: false } : {}),
      updatedAt: now,
    });
    written += 1;
  }
  // A built-in model taken out of the seed list (Fable 5.1, owner decision
  // 2026-09-25) must stop being selectable. Retire its enabled seed row
  // unless a role still uses it; an assigned row stays until reassigned.
  const seedIds = new Set(seeds.map((seed) => seed.modelId));
  const inUse = await assignedModelIds(ctx);
  const enabled = await ctx.db
    .query("modelCatalog")
    .withIndex("by_status", (q) => q.eq("status", "enabled"))
    .take(200);
  for (const row of enabled) {
    if (row.source !== "seed" || seedIds.has(row.modelId) || inUse.has(row.modelId)) continue;
    await ctx.db.patch(row._id, { status: "retired", updatedAt: now });
    written += 1;
  }
  return written;
}

export const seedCatalog = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx): Promise<number> => await ensureSeedCatalog(ctx, Date.now()),
});

const refreshSummaryValidator = v.object({
  added: v.number(),
  updated: v.number(),
  renamed: v.number(),
  expiring: v.number(),
  gone: v.number(),
  returned: v.number(),
});

/**
 * Apply one OpenRouter pull. Notices (admin-only, the model log on
 * /admin/models) go only to models the app actually uses (enabled, or run
 * by a role or a track); the other few hundred rows change quietly. An
 * enabled model that disappears keeps its status on a flaky listing; admins
 * are told instead.
 */
export const applyCatalogRefresh = internalMutation({
  args: {
    models: v.array(parsedModelValidator),
    fetchedAt: v.number(),
    /** False when the pull looked partial: never mark anything gone then. */
    complete: v.boolean(),
  },
  returns: refreshSummaryValidator,
  handler: async (ctx, args) => {
    const now = args.fetchedAt;
    await ensureSeedCatalog(ctx, now);
    const rows = await ctx.db.query("modelCatalog").take(CATALOG_READ_LIMIT);
    const byModelId = new Map(rows.map((row) => [row.modelId, row]));
    const inUse = await assignedModelIds(ctx);
    const matters = (row: Doc<"modelCatalog">) =>
      row.status === "enabled" || inUse.has(row.modelId);
    const summary = { added: 0, updated: 0, renamed: 0, expiring: 0, gone: 0, returned: 0 };
    const changes = diffCatalog(rows, args.models as ParsedModel[], now);
    for (const change of changes) {
      if (change.kind === "new") {
        const { openRouterId, ...fields } = change.model;
        if (byModelId.has(openRouterId)) continue;
        const id = await ctx.db.insert("modelCatalog", {
          ...fields,
          modelId: openRouterId,
          status: "candidate",
          source: "openrouter",
          firstSeenAt: now,
          lastSeenAt: now,
          updatedAt: now,
        });
        const inserted = await ctx.db.get(id);
        if (inserted) byModelId.set(openRouterId, inserted);
        summary.added += 1;
        continue;
      }
      const row = byModelId.get(change.modelId);
      if (!row) continue;
      switch (change.kind) {
        case "update": {
          await ctx.db.patch(row._id, {
            ...refreshedFields(row, change.model),
            canonicalSlug: change.model.canonicalSlug,
            lastSeenAt: now,
            updatedAt: now,
          });
          summary.updated += 1;
          break;
        }
        case "renamed": {
          await ctx.db.patch(row._id, { renamedFrom: change.fromId, updatedAt: now });
          summary.renamed += 1;
          if (matters(row)) {
            await raiseAdminNotice(
              ctx,
              `${row.displayName} was renamed on OpenRouter from ${change.fromId} to ${change.toId}. Requests now use the new id.`,
              { modelId: row.modelId }
            );
          }
          break;
        }
        case "expiring": {
          summary.expiring += 1;
          if (matters(row) && row.expiryNoticeFor !== change.expirationDate) {
            await ctx.db.patch(row._id, { expiryNoticeFor: change.expirationDate });
            await raiseAdminNotice(
              ctx,
              `${row.displayName} (${row.modelId}) is retired on ${change.expirationDate}, in ${change.daysLeft} days. Its tier moves on when a newer version is listed.`,
              { modelId: row.modelId }
            );
          }
          break;
        }
        case "gone": {
          if (!args.complete) break;
          summary.gone += 1;
          await ctx.db.patch(row._id, {
            missingSince: now,
            ...(matters(row) ? {} : { status: "retired" as const }),
            updatedAt: now,
          });
          if (matters(row) && row.goneNoticeAt === undefined) {
            await ctx.db.patch(row._id, { goneNoticeAt: now });
            await raiseAdminNotice(
              ctx,
              `${row.displayName} (${row.modelId}) is no longer listed on OpenRouter. Generations frozen on it now run on its tier's current model.`,
              { modelId: row.modelId }
            );
          }
          break;
        }
        case "returned": {
          await ctx.db.patch(row._id, {
            missingSince: undefined,
            goneNoticeAt: undefined,
            ...(row.status === "retired" ? { status: "candidate" as const } : {}),
            updatedAt: now,
          });
          summary.returned += 1;
          break;
        }
      }
    }
    return summary;
  },
});

/** OpenRouter models the app runs today, for the per-provider check. */
export const endpointCheckTargets = internalQuery({
  args: {},
  returns: v.array(v.object({ modelId: v.string(), canonicalSlug: v.string() })),
  handler: async (ctx) => {
    const inUse = await assignedModelIds(ctx);
    const enabled = await ctx.db
      .query("modelCatalog")
      .withIndex("by_status", (q) => q.eq("status", "enabled"))
      .take(100);
    const targets = new Map<string, { modelId: string; canonicalSlug: string }>();
    for (const row of enabled) {
      if (row.gateway === "openrouter") {
        targets.set(row.modelId, { modelId: row.modelId, canonicalSlug: row.canonicalSlug });
      }
    }
    for (const id of inUse) {
      const row = await catalogRow(ctx, id);
      if (row?.gateway === "openrouter") {
        targets.set(row.modelId, { modelId: row.modelId, canonicalSlug: row.canonicalSlug });
      }
    }
    return [...targets.values()].slice(0, 50);
  },
});

export const recordEndpointSupport = internalMutation({
  args: { modelId: v.string(), support: endpointSupportValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await catalogRow(ctx, args.modelId);
    if (!row) return null;
    const hadSupport =
      row.endpointSupport === undefined ||
      row.endpointSupport.toolsAndStructuredProviders.length > 0;
    await ctx.db.patch(row._id, { endpointSupport: args.support, updatedAt: Date.now() });
    if (hadSupport && args.support.toolsAndStructuredProviders.length === 0) {
      await raiseAdminNotice(
        ctx,
        `No OpenRouter provider serves ${row.displayName} (${row.modelId}) with both tool calls and structured outputs. Generations on it will fail until one does.`,
        { modelId: row.modelId }
      );
    }
    return null;
  },
});

// ─── Production error rollback ──────────────────────────────────────────────

const HOUR_MS = 60 * 60 * 1000;
const hourStartOf = (at: number) => Math.floor(at / HOUR_MS) * HOUR_MS;
/**
 * The daily check reaches a role at a slightly different time each day, so
 * "at most daily" allows an hour of slack: a notice a few minutes short of
 * 24 hours after the last one still goes out (round 9).
 */
const ERROR_NOTICE_MARGIN_MS = HOUR_MS;

/** Per-request outcome rows are kept this long (the window plus a day). */
const OUTCOME_ROW_RETENTION_MS = 2 * AUTOMATION_THRESHOLDS.errorWindowMs;

/**
 * Exact request outcomes for `model` in [since, now] (review D): full hours
 * inside the window come from the hourly buckets (both counts together, so
 * neither is ever truncated on its own), and the partial hours at either
 * edge are counted request by request, so calls before an assignment or
 * outside the rolling window never count.
 */
export async function outcomeCountsSince(
  ctx: QueryCtx | MutationCtx,
  model: string,
  since: number,
  now: number
): Promise<{ successes: number; failures: number }> {
  let successes = 0;
  let failures = 0;
  const countRows = async (from: number, to: number) => {
    if (to <= from) return;
    for await (const row of ctx.db
      .query("modelCallOutcomes")
      .withIndex("by_model_and_at", (q) => q.eq("model", model).gte("at", from).lt("at", to))) {
      if (row.outcome === "success") successes += 1;
      else failures += 1;
    }
  };
  const firstFullHour = Math.ceil(since / HOUR_MS) * HOUR_MS;
  const lastFullHourEnd = hourStartOf(now);
  if (firstFullHour >= lastFullHourEnd) {
    await countRows(since, now + 1);
    return { successes, failures };
  }
  await countRows(since, firstFullHour);
  for await (const bucket of ctx.db
    .query("modelCallBuckets")
    .withIndex("by_model_and_hourStart", (q) =>
      q.eq("model", model).gte("hourStart", firstFullHour).lt("hourStart", lastFullHourEnd)
    )) {
    successes += bucket.successes;
    failures += bucket.failures;
  }
  await countRows(lastFullHourEnd, now + 1);
  return { successes, failures };
}

/**
 * Move a track back when the model it moved to is failing (2026-10-22,
 * per track): over the last day, or since the move if later, at least
 * `errorMinCalls` calls were attempted and more than `maxErrorRate` of them
 * failed. The track returns to its previous model and the failing model is
 * recorded in `rolledBackFrom`, so the daily job never chooses it again for
 * that track. With the kill switch on, admins get a line in the model log
 * instead, at most daily. Nothing is written to the alerts board.
 */
export async function runProductionErrorCheck(
  ctx: MutationCtx,
  now: number
): Promise<Array<{ track: ModelTrackId; modelId: string; rolledBack: boolean }>> {
  const results: Array<{ track: ModelTrackId; modelId: string; rolledBack: boolean }> = [];
  const enabled = await autoSwitchEnabled(ctx);
  // Per-request rows past the retention window are no longer read; they
  // are deleted in bounded batches that continue until none are left.
  await ctx.scheduler.runAfter(0, pruneCallOutcomesRef, { before: now - OUTCOME_ROW_RETENTION_MS });
  for (const track of MODEL_TRACK_IDS) {
    const row = await trackRow(ctx, track);
    // Only a track that moved forward has a previous model to return to; a
    // move back clears it.
    if (!row?.previousModelId || row.switchedAt === undefined) continue;
    const since = Math.max(now - AUTOMATION_THRESHOLDS.errorWindowMs, row.switchedAt);
    const verdict = productionErrorVerdict(await outcomeCountsSince(ctx, row.modelId, since, now));
    if (!verdict.rollback) continue;
    const rate = `${Math.round(verdict.errorRate * 100)} percent of ${verdict.calls} calls`;
    const name = MODEL_TRACKS[track].name;
    if (!enabled) {
      if (
        row.errorNoticeAt === undefined ||
        now - row.errorNoticeAt >= AUTOMATION_THRESHOLDS.errorWindowMs - ERROR_NOTICE_MARGIN_MS
      ) {
        await ctx.db.patch(row._id, { errorNoticeAt: now });
        await raiseAdminNotice(
          ctx,
          `${modelLabelOf(row.modelId)} failed ${rate} on ${name}. Automatic updates are off, so it was not moved back.`,
          { track, modelId: row.modelId }
        );
      }
      results.push({ track, modelId: row.modelId, rolledBack: false });
      continue;
    }
    await moveTrack(ctx, {
      track,
      toModelId: row.previousModelId,
      kind: "rollback",
      reason: "production_error_rate",
      actor: "system",
      errorRate: { calls: verdict.calls, failures: verdict.failures, errorRate: verdict.errorRate },
    });
    results.push({ track, modelId: row.modelId, rolledBack: true });
  }
  return results;
}
/** Rows deleted per pruning transaction. */
export const OUTCOME_PRUNE_BATCH = 500;

/**
 * Deletes per-request outcome rows older than `before`, one bounded batch
 * per transaction, rescheduling itself while a batch comes back full so
 * retention keeps pace with any call volume (round 3, item 3).
 */
export const pruneCallOutcomes = internalMutation({
  args: { before: v.number() },
  returns: v.number(),
  handler: async (ctx, args): Promise<number> => {
    const expired = await ctx.db
      .query("modelCallOutcomes")
      .withIndex("by_at", (q) => q.lt("at", args.before))
      .take(OUTCOME_PRUNE_BATCH);
    for (const row of expired) await ctx.db.delete(row._id);
    if (expired.length === OUTCOME_PRUNE_BATCH) {
      await ctx.scheduler.runAfter(0, pruneCallOutcomesRef, { before: args.before });
    }
    return expired.length;
  },
});

export const checkProductionErrors = internalMutation({
  args: {},
  returns: v.array(
    v.object({ track: modelTrackValidator, modelId: v.string(), rolledBack: v.boolean() })
  ),
  handler: async (ctx) => await runProductionErrorCheck(ctx, Date.now()),
});

/**
 * One terminal outcome of one provider request (providers.ts
 * recordingOutcomes), added to its model's hourly bucket.
 */
export const recordCallOutcome = internalMutation({
  args: {
    model: v.string(),
    callSite: v.string(),
    outcome: v.union(v.literal("success"), v.literal("failure")),
    code: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const at = Date.now();
    const hourStart = hourStartOf(at);
    await ctx.db.insert("modelCallOutcomes", { model: args.model, at, outcome: args.outcome });
    const bucket = await ctx.db
      .query("modelCallBuckets")
      .withIndex("by_model_and_hourStart", (q) =>
        q.eq("model", args.model).eq("hourStart", hourStart)
      )
      .unique();
    const failure = args.outcome === "failure";
    const failureFields = failure
      ? { lastFailureCode: args.code ?? "unknown", lastFailureCallSite: args.callSite }
      : {};
    if (bucket) {
      await ctx.db.patch(bucket._id, {
        successes: bucket.successes + (failure ? 0 : 1),
        failures: bucket.failures + (failure ? 1 : 0),
        ...failureFields,
      });
    } else {
      await ctx.db.insert("modelCallBuckets", {
        model: args.model,
        hourStart,
        successes: failure ? 0 : 1,
        failures: failure ? 1 : 0,
        ...failureFields,
      });
    }
    return null;
  },
});
// ─── Evaluations (ended 2026-10-22) ─────────────────────────────────────────
//
// The daily job no longer plans evaluations and nothing promotes a model to
// a role any more: tracks follow the newest version of their tier instead.
// The functions below stay so an evaluation queued or running before the
// change settles cleanly, and its row stays readable on the admin page.

const claimedEvaluationValidator = v.object({
  evaluationId: v.id("modelEvaluations"),
  role: modelRoleValidator,
  candidate: frozenModelEntryValidator,
  incumbent: frozenModelEntryValidator,
  judge: frozenModelEntryValidator,
  tasks: v.array(evalTaskKindValidator),
  /** Frozen per-million prices for the usage meter, by model id. */
  pricing: v.record(v.string(), evalPricingValidator),
  reservedCostUsd: v.number(),
});

/** Why a queued evaluation is stopped at its claim. */
export const EVALUATIONS_ENDED =
  "Evaluations ended on 2026-10-22: each tier now follows its newest version";

/**
 * A queued evaluation is stopped before it starts: nothing is spent and no
 * request is sent. Always returns null, so runEvaluation does nothing.
 */
export const claimEvaluation = internalMutation({
  args: { evaluationId: v.id("modelEvaluations"), envelope: evalEnvelopeValidator },
  returns: v.union(v.null(), claimedEvaluationValidator),
  handler: async (ctx, args): Promise<Infer<typeof claimedEvaluationValidator> | null> => {
    const evaluation = await ctx.db.get(args.evaluationId);
    if (!evaluation || evaluation.status !== "queued") return null;
    const now = Date.now();
    await ctx.db.patch(evaluation._id, {
      status: "error",
      error: EVALUATIONS_ENDED,
      evalCostUsd: 0,
      completedAt: now,
      accountedAt: now,
    });
    return null;
  },
});

/**
 * Records the results of an evaluation that was already running when
 * evaluations ended. It never switches a role.
 */
export const completeEvaluation = internalMutation({
  args: {
    evaluationId: v.id("modelEvaluations"),
    candidateResults: v.array(evalTaskResultValidator),
    incumbentResults: v.array(evalTaskResultValidator),
    evalCostUsd: v.number(),
    /** Part of evalCostUsd that is reserved spend of unsettled requests. */
    unsettledCostUsd: v.optional(v.number()),
  },
  returns: v.union(v.literal("promoted"), v.literal("held"), v.literal("ignored")),
  handler: async (ctx, args): Promise<"promoted" | "held" | "ignored"> => {
    const evaluation = await ctx.db.get(args.evaluationId);
    if (!evaluation || evaluation.status !== "running") return "ignored";
    const now = Date.now();
    const candidate = summarizeEvalRun(args.candidateResults);
    const incumbent = summarizeEvalRun(args.incumbentResults);
    const row = await catalogRow(ctx, evaluation.modelId);
    const decision = promotionGates({
      candidate,
      incumbent,
      candidatePrices: { inputUsdPerMTok: row?.inputUsdPerMTok, outputUsdPerMTok: row?.outputUsdPerMTok },
      cap: await roleCostCap(ctx, evaluation.role),
    });
    await ctx.db.patch(evaluation._id, {
      candidate,
      incumbent,
      gates: decision.gates,
      evalCostUsd: args.evalCostUsd,
      ...(args.unsettledCostUsd ? { unsettledCostUsd: args.unsettledCostUsd } : {}),
      reservedCostUsd: undefined,
      completedAt: now,
      accountedAt: now,
      status: decision.passed ? "passed" : "failed",
      outcome: `not promoted: ${EVALUATIONS_ENDED.toLowerCase()}`,
    });
    return "held";
  },
});

export const failEvaluation = internalMutation({
  args: {
    evaluationId: v.id("modelEvaluations"),
    error: v.string(),
    evalCostUsd: v.number(),
    unsettledCostUsd: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const evaluation = await ctx.db.get(args.evaluationId);
    if (!evaluation || (evaluation.status !== "running" && evaluation.status !== "queued")) {
      return null;
    }
    await ctx.db.patch(evaluation._id, {
      status: "error",
      error: args.error.slice(0, 500),
      evalCostUsd: args.evalCostUsd,
      ...(args.unsettledCostUsd ? { unsettledCostUsd: args.unsettledCostUsd } : {}),
      reservedCostUsd: undefined,
      completedAt: Date.now(),
      accountedAt: Date.now(),
    });
    return null;
  },
});

// ─── Track upgrades (2026-10-22) ────────────────────────────────────────────

/** A catalog row's provider fields, without its bookkeeping. */
function catalogFieldsOf(row: Doc<"modelCatalog">): CatalogFields {
  const fields: Record<string, unknown> = {};
  for (const key of Object.keys(catalogFieldsValidator)) {
    const value = (row as unknown as Record<string, unknown>)[key];
    if (value !== undefined) fields[key] = value;
  }
  return fields as CatalogFields;
}

const trackCandidateValidator = v.object({
  track: modelTrackValidator,
  fromModelId: v.string(),
  toModelId: v.string(),
  listingId: v.string(),
  label: v.string(),
  listing: v.object(catalogFieldsValidator),
});

/**
 * Marks every track as checked and returns the ones with a newer version
 * on OpenRouter that may move: the newest listing on the track, newer than
 * its model, never rolled back from on that track. With automatic updates
 * off nothing moves.
 */
export const planTrackUpgrades = internalMutation({
  args: {},
  returns: v.array(trackCandidateValidator),
  handler: async (ctx) => {
    const now = Date.now();
    const enabled = await autoSwitchEnabled(ctx);
    const rows = await ctx.db.query("modelCatalog").take(CATALOG_READ_LIMIT);
    const candidates: Array<Infer<typeof trackCandidateValidator>> = [];
    for (const track of MODEL_TRACK_IDS) {
      const row = await ensureTrackRow(ctx, track);
      const found = trackUpgradeListing({
        track,
        currentModelId: row.modelId,
        rows,
        rolledBackFrom: row.rolledBackFrom,
      });
      const note = !found
        ? `Up to date on ${modelLabelOf(row.modelId)}.`
        : !enabled
          ? `${trackLabelFor(found.appModelId) ?? found.appModelId} is available. Automatic updates are off.`
          : `Checking ${trackLabelFor(found.appModelId) ?? found.appModelId}.`;
      await ctx.db.patch(row._id, { lastCheckedAt: now, lastCheckNote: note });
      if (!found || !enabled) continue;
      candidates.push({
        track,
        fromModelId: row.modelId,
        toModelId: found.appModelId,
        listingId: found.listingId,
        label: trackLabelFor(found.appModelId) ?? found.appModelId,
        listing: catalogFieldsOf(found.row),
      });
    }
    return candidates;
  },
});

const readinessValidator = v.object({
  plainOk: v.boolean(),
  forcedToolChoice: v.boolean(),
  forcedRejected: v.boolean(),
  failure: v.optional(v.string()),
});

/**
 * Moves a track after its readiness check (convex/ai/modelReadiness.ts),
 * when automatic updates are still on, the track still runs the model the
 * check started from, and the check passed. The new model's catalog row is
 * written from its OpenRouter listing (a Claude track gets a direct
 * Anthropic row with the listing's limits and prices) and records whether it
 * takes a forced tool call. Logged as an upgrade in modelSwitchEvents.
 */
export const applyTrackUpgrade = internalMutation({
  args: { candidate: trackCandidateValidator, readiness: readinessValidator },
  returns: v.union(v.literal("moved"), v.literal("held")),
  handler: async (ctx, args): Promise<"moved" | "held"> => {
    const { candidate, readiness } = args;
    const now = Date.now();
    const row = await ensureTrackRow(ctx, candidate.track);
    const hold = async (note: string) => {
      await ctx.db.patch(row._id, { lastCheckedAt: now, lastCheckNote: note });
      return "held" as const;
    };
    if (!(await autoSwitchEnabled(ctx))) return await hold(`${candidate.label} is available. Automatic updates are off.`);
    if (row.modelId !== candidate.fromModelId) return await hold(`The track changed while ${candidate.label} was checked.`);
    if (row.rolledBackFrom.includes(candidate.toModelId)) {
      return await hold(`${candidate.label} was moved back from before, so it is not used again.`);
    }
    if (!readinessAllowsMove(readiness)) {
      return await hold(`${candidate.label} is not ready yet: ${readiness.failure ?? "the check failed"}. Checked again tomorrow.`);
    }
    const forcedToolChoice = readiness.forcedToolChoice && !readiness.forcedRejected;
    const existing = await catalogRow(ctx, candidate.toModelId);
    if (existing) {
      await ctx.db.patch(existing._id, {
        status: "enabled",
        ...(forcedToolChoice ? {} : { forcedToolChoice: false }),
        updatedAt: now,
      });
    } else if (MODEL_TRACKS[candidate.track].gateway === "anthropic") {
      await ctx.db.insert("modelCatalog", {
        ...directRowFromListing(candidate.listing as CatalogFields, candidate.toModelId, candidate.label, forcedToolChoice),
        status: "enabled",
        source: "openrouter",
        firstSeenAt: now,
        lastSeenAt: now,
        updatedAt: now,
      });
    } else {
      return await hold(`${candidate.label} is missing from the catalog.`);
    }
    await moveTrack(ctx, {
      track: candidate.track,
      toModelId: candidate.toModelId,
      kind: "upgrade",
      reason: "newer_version",
      actor: "system",
    });
    await ctx.db.patch(row._id, { lastCheckedAt: now, lastCheckNote: `Moved to ${candidate.label}.` });
    return "moved";
  },
});

/** Records why the readiness check could not run for a candidate. */
export const noteTrackCheck = internalMutation({
  args: { track: modelTrackValidator, note: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ensureTrackRow(ctx, args.track);
    await ctx.db.patch(row._id, { lastCheckedAt: Date.now(), lastCheckNote: args.note.slice(0, 300) });
    return null;
  },
});

// ─── One-off migrations (2026-10-22; run by hand, never on a schedule) ──────

/**
 * Points every role at its policy track: Sonnet roles at claude-sonnet, the
 * four Haiku roles at claude-haiku. Undoes the evaluation switches on the
 * stored rows (resolution already ignores them, lib/modelRoles.ts
 * roleTrack). The replaced model is kept as previousModelId for the record.
 * Idempotent. Run with
 * `npx convex run modelCatalog:pointRolesAtTracks`.
 */
export const pointRolesAtTracks = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx): Promise<number> => {
    let written = 0;
    for (const track of MODEL_TRACK_IDS) await ensureTrackRow(ctx, track);
    for (const role of MODEL_ROLES) {
      const assignment = await roleAssignment(ctx, role);
      const track = ROLE_POLICIES[role].track;
      if (!assignment || assignment.track === track) continue;
      await ctx.db.patch(assignment._id, {
        track,
        modelId: await trackModelId(ctx, track),
        previousModelId: assignment.modelId,
        assignedAt: Date.now(),
        assignedBy: "system",
        assignedByUserId: undefined,
        origin: undefined,
        errorNoticeAt: undefined,
      });
      written += 1;
    }
    return written;
  },
});

/** Open alerts resolved per transaction. */
const ALERT_RESOLVE_BATCH = 200;

/**
 * Resolves every open alerts-board row the model catalog wrote (source
 * "model-catalog"), a bounded page at a time, continuing until none are
 * left. Run once with
 * `npx convex run modelCatalog:resolveModelCatalogAlerts '{}'`.
 */
export const resolveModelCatalogAlerts = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  returns: v.number(),
  handler: async (ctx, args): Promise<number> => {
    const page = await ctx.db
      .query("errorReports")
      .withIndex("by_status", (q) => q.eq("status", "open"))
      .paginate({ numItems: ALERT_RESOLVE_BATCH, cursor: args.cursor ?? null });
    let resolved = 0;
    for (const report of page.page) {
      if (report.source !== "model-catalog") continue;
      await ctx.db.patch(report._id, { status: "resolved" });
      resolved += 1;
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, resolveModelCatalogAlertsRef, { cursor: page.continueCursor });
    }
    return resolved;
  },
});
// ─── Runtime resolution for actions ─────────────────────────────────────────

/**
 * The model a helper role runs now, as an entry an action can register, plus
 * the role's track's previous model as an OpenRouter fallback when both are
 * on that gateway and the track was never moved back from it.
 */
export const roleModelEntry = internalQuery({
  args: { role: modelRoleValidator },
  returns: v.object({
    entry: frozenModelEntryValidator,
    fallback: v.optional(frozenModelEntryValidator),
  }),
  handler: async (ctx, args) => {
    const cap = await roleCostCap(ctx, args.role);
    const modelId = await roleModelId(ctx, args.role);
    const entry =
      (await frozenEntryForModel(ctx, modelId, cap)) ??
      (await frozenEntryForModel(ctx, ROLE_POLICIES[args.role].defaultModelId, cap));
    if (!entry) throw new Error(`No model resolves for role ${args.role}`);
    const track = await trackRow(ctx, await roleTrack(ctx, args.role));
    const previousId = track?.previousModelId;
    const previous =
      previousId && !track.rolledBackFrom.includes(previousId)
        ? await frozenEntryForModel(ctx, previousId, cap)
        : null;
    return {
      entry,
      ...(previous && previous.gateway === "openrouter" && entry.gateway === "openrouter" && previous.id !== entry.id
        ? { fallback: previous }
        : {}),
    };
  },
});

export const generationModels = internalQuery({
  args: { generationId: v.id("generations") },
  returns: v.union(v.null(), modelFreezeValidator),
  handler: async (ctx, args) => {
    const generation = await ctx.db.get(args.generationId);
    return generation ? await generationModelFreeze(generation) : null;
  },
});

/** Resolve one model id for an action: frozen on the generation, else catalog. */
export const modelEntryForCall = internalQuery({
  args: { modelId: v.string(), generationId: v.optional(v.id("generations")) },
  returns: v.union(v.null(), frozenModelEntryValidator),
  handler: async (ctx, args) => {
    if (args.generationId) {
      const generation = await ctx.db.get(args.generationId);
      const frozen = generation
        ? (await generationModelFreeze(generation)).entries.find((entry) => entry.id === args.modelId)
        : undefined;
      if (frozen) return frozen;
    }
    return await frozenEntryForModel(ctx, args.modelId, await roleCostCap(ctx, "writing"));
  },
});

/**
 * Whether a frozen model is gone from its provider: an OpenRouter row that
 * OpenRouter stopped listing. A superseded model that is still listed is not
 * gone, and a direct Anthropic row never is.
 */
function goneFromProvider(row: Doc<"modelCatalog"> | null): boolean {
  return row !== null && row.gateway === "openrouter" && row.missingSince !== undefined;
}

const modelRedirectEntryValidator = v.object({
  fromModelId: v.string(),
  toModelId: v.string(),
  entry: frozenModelEntryValidator,
});

/**
 * For each model frozen on a generation that is gone from its provider, the
 * entry its calls run on instead (2026-10-22 decision): the frozen id is
 * kept, so stored rows and the prompt version stay as reserved, and the
 * request goes to its track's current model on the same gateway (a Claude
 * successor through its Anthropic-pinned OpenRouter listing). Empty for
 * every generation whose models are all still listed.
 */
export const generationModelRedirects = internalQuery({
  args: { generationId: v.id("generations") },
  returns: v.array(modelRedirectEntryValidator),
  handler: async (ctx, args) => {
    const generation = await ctx.db.get(args.generationId);
    if (!generation) return [];
    const freeze = generationModelFreeze(generation);
    const cap = await roleCostCap(ctx, "writing");
    const redirects: Array<Infer<typeof modelRedirectEntryValidator>> = [];
    for (const frozen of freeze.entries) {
      if (frozen.gateway !== "openrouter" || !goneFromProvider(await catalogRow(ctx, frozen.id))) continue;
      const track = trackOf(frozen.id);
      if (!track) continue;
      const toModelId = await trackModelId(ctx, track);
      if (toModelId === frozen.id) continue;
      const successor = await frozenEntryForModel(ctx, toModelId, cap);
      if (!successor) continue;
      let entry: FrozenModelEntry;
      if (successor.gateway === "openrouter") {
        entry = { ...successor, id: frozen.id, label: frozen.label, requestId: successor.requestId ?? successor.id };
      } else {
        // A Claude successor runs direct; on this frozen OpenRouter entry
        // it goes through its OpenRouter listing, pinned to Anthropic.
        const requestId = openRouterAnthropicRequestId(toModelId);
        if (!requestId) continue;
        const listing = await catalogRow(ctx, requestId);
        entry = {
          id: frozen.id,
          label: frozen.label,
          provider: successor.provider,
          gateway: "openrouter",
          reasoning: listing?.reasoning ?? true,
          maxCompletionTokens: listing?.maxCompletionTokens ?? successor.maxCompletionTokens ?? 128_000,
          requestId,
          ...(frozen.maxPrice ? { maxPrice: frozen.maxPrice } : {}),
          ...(successor.forcedToolChoice === false ? { forcedToolChoice: false } : {}),
        };
      }
      redirects.push({ fromModelId: frozen.id, toModelId, entry });
    }
    return redirects;
  },
});

/**
 * Records on the generation, once per frozen model, which track model its
 * calls went to, and logs it for admins. The freeze is never rewritten.
 */
export const recordGenerationModelRedirects = internalMutation({
  args: {
    generationId: v.id("generations"),
    redirects: v.array(v.object({ fromModelId: v.string(), toModelId: v.string() })),
  },
  returns: v.number(),
  handler: async (ctx, args): Promise<number> => {
    const generation = await ctx.db.get(args.generationId);
    if (!generation) return 0;
    const existing = generation.modelRedirects ?? [];
    const now = Date.now();
    const added = args.redirects
      .filter((redirect) => !existing.some((item) => item.fromModelId === redirect.fromModelId))
      .map((redirect) => ({ ...redirect, at: now }));
    if (added.length === 0) return 0;
    await ctx.db.patch(generation._id, { modelRedirects: [...existing, ...added] });
    for (const redirect of added) {
      await raiseAdminNotice(
        ctx,
        `${modelLabelOf(redirect.fromModelId)} is no longer listed, so a generation frozen on it now runs on ${modelLabelOf(redirect.toModelId)}.`,
        { modelId: redirect.fromModelId, ...(trackOf(redirect.toModelId) ? { track: trackOf(redirect.toModelId)! } : {}) }
      );
    }
    return added.length;
  },
});
// ─── The daily job ──────────────────────────────────────────────────────────

async function fetchJson(url: string, headers: Record<string, string> = {}): Promise<unknown> {
  const response = await fetch(url, {
    headers: { Accept: "application/json", ...headers },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return await response.json();
}

/**
 * The daily refresh. OpenRouter's catalog needs no key. Artificial Analysis
 * is read only when AA_API_KEY is set (internal use; attribution on the
 * admin page; never shown to clients). After the refresh, a failing new
 * track model is moved back, then every track is checked for a newer
 * version (convex/ai/modelReadiness.ts upgradeTracks).
 */
export const refreshCatalog = internalAction({
  args: {},
  returns: v.object({
    fetched: v.number(),
    summary: refreshSummaryValidator,
    tracksMoved: v.number(),
  }),
  handler: async (ctx): Promise<{
    fetched: number;
    summary: { added: number; updated: number; renamed: number; expiring: number; gone: number; returned: number };
    tracksMoved: number;
  }> => {
    const fetchedAt = Date.now();
    await ctx.runMutation(seedCatalogRef, {});
    const parsed = parseOpenRouterModels(await fetchJson(OPENROUTER_MODELS_URL), fetchedAt);
    const aaKey = process.env.AA_API_KEY?.trim();
    if (aaKey) {
      try {
        const index = parseArtificialAnalysis(
          await fetchJson(ARTIFICIAL_ANALYSIS_URL, { "x-api-key": aaKey })
        );
        for (const model of parsed.models) {
          const value = artificialAnalysisScore(model, index);
          if (value !== undefined) {
            model.benchmarks.push({
              source: "artificial_analysis",
              metric: "intelligence_index",
              value,
              fetchedAt,
            });
          }
        }
      } catch (error) {
        console.warn("Artificial Analysis refresh failed; using OpenRouter scores", error);
      }
    }
    const complete = parsed.models.length >= AUTOMATION_THRESHOLDS.minPlausibleCatalogSize;
    const summary = await ctx.runMutation(applyCatalogRefreshRef, {
      models: parsed.models,
      fetchedAt,
      complete,
    });
    const targets = await ctx.runQuery(endpointCheckTargetsRef, {});
    for (const target of targets) {
      try {
        const support = parseEndpointSupport(
          await fetchJson(OPENROUTER_ENDPOINTS_URL(target.canonicalSlug)),
          Date.now()
        );
        await ctx.runMutation(recordEndpointSupportRef, { modelId: target.modelId, support });
      } catch (error) {
        console.warn(`Endpoint check failed for ${target.modelId}`, error);
      }
    }
    await ctx.runMutation(checkProductionErrorsRef, {});
    // A partial pull could make an old version look newest; wait a day.
    if (!complete) return { fetched: parsed.models.length, summary, tracksMoved: 0 };
    // The readiness check sends real requests through the Node SDKs.
    const moved = await ctx.runAction(upgradeTracksRef, {});
    return {
      fetched: parsed.models.length,
      summary,
      tracksMoved: moved.filter((item) => item.outcome === "moved").length,
    };
  },
});

// ─── Admin surface ──────────────────────────────────────────────────────────

async function adminOrNull(ctx: QueryCtx) {
  const user = await getCurrentUserOrNull(ctx);
  return user && user.role === "admin" && user.isAnonymous !== true ? user : null;
}

/** Rows the admin table shows: enabled and in-use first, then top scores. */
const ADMIN_CATALOG_ROWS = 60;
/** Lines the model log shows, newest first. */
const ADMIN_LOG_ROWS = 40;

const REASON_WORDS: Readonly<Record<string, string>> = {
  newer_version: "a newer version passed its check",
  production_error_rate: "too many calls failed",
  admin_move_back: "moved back by an admin",
  admin_rollback: "rolled back by an admin",
  admin_choice: "chosen by an admin",
  evaluation_passed: "passed its evaluation",
};

export const adminState = query({
  args: {},
  handler: async (ctx) => {
    if (!(await adminOrNull(ctx))) return null;
    const rows = await ctx.db.query("modelCatalog").take(CATALOG_READ_LIMIT);
    const inUse = await assignedModelIds(ctx);
    const scored = rows.map((row) => ({ row, score: bestIntelligenceScore(row.benchmarks) }));
    scored.sort((a, b) => {
      const rank = (item: (typeof scored)[number]) =>
        item.row.status === "enabled" || inUse.has(item.row.modelId) ? 0 : item.row.status === "candidate" ? 1 : 2;
      return rank(a) - rank(b) || (b.score?.value ?? -1) - (a.score?.value ?? -1);
    });
    const catalog = scored.slice(0, ADMIN_CATALOG_ROWS).map(({ row, score }) => ({
      modelId: row.modelId,
      displayName: row.displayName,
      provider: row.provider,
      gateway: row.gateway,
      status: row.status,
      inUse: inUse.has(row.modelId),
      inputUsdPerMTok: row.inputUsdPerMTok ?? null,
      outputUsdPerMTok: row.outputUsdPerMTok ?? null,
      cacheReadUsdPerMTok: row.cacheReadUsdPerMTok ?? null,
      contextLength: row.contextLength ?? null,
      maxOutputTokens: row.maxOutputTokens ?? null,
      supportsTools: row.supportsTools,
      supportsStructuredOutputs: row.supportsStructuredOutputs,
      reasoning: row.reasoning,
      score: score?.value ?? null,
      scoreSource: score?.source ?? null,
      expirationDate: row.expirationDate ?? null,
      missing: row.missingSince !== undefined,
      lastSeenAt: row.lastSeenAt,
    }));
    const labelOf = (id: string | undefined) => {
      if (!id) return null;
      return trackLabelFor(id) ?? rows.find((item) => item.modelId === id)?.displayName ?? seedModelById(id)?.label ?? RETIRED_SEED_LABELS[id] ?? id;
    };
    const tracks = [];
    for (const track of MODEL_TRACK_IDS) {
      const row = await trackRow(ctx, track);
      const modelId = await trackModelId(ctx, track);
      tracks.push({
        track,
        name: MODEL_TRACKS[track].name,
        modelId,
        modelLabel: labelOf(modelId) ?? modelId,
        previousModelId: row?.previousModelId ?? null,
        previousLabel: labelOf(row?.previousModelId),
        switchedAt: row?.switchedAt ?? null,
        lastCheckedAt: row?.lastCheckedAt ?? null,
        lastCheckNote: row?.lastCheckNote ?? null,
        rolledBackFrom: (row?.rolledBackFrom ?? []).map((id) => labelOf(id) ?? id),
      });
    }
    const roles = [];
    for (const role of MODEL_ROLES) {
      const policy = ROLE_POLICIES[role];
      const track = await roleTrack(ctx, role);
      const modelId = await roleModelId(ctx, role);
      const assignment = await roleAssignment(ctx, role);
      roles.push({
        role,
        label: policy.label,
        description: policy.description,
        track,
        trackName: MODEL_TRACKS[track].name,
        chosenByAdmin: assignment?.track !== undefined && assignment.assignedBy === "user",
        modelId,
        modelLabel: labelOf(modelId) ?? modelId,
        cap: await roleCostCap(ctx, role),
      });
    }
    const events = await ctx.db.query("modelSwitchEvents").withIndex("by_at").order("desc").take(ADMIN_LOG_ROWS);
    const notices = await ctx.db.query("modelAdminNotices").withIndex("by_at").order("desc").take(ADMIN_LOG_ROWS);
    const eventText = (event: Doc<"modelSwitchEvents">): string => {
      const from = labelOf(event.fromModelId);
      const to = labelOf(event.toModelId) ?? event.toModelId;
      const why = REASON_WORDS[event.reason] ?? event.reason.replace(/_/g, " ");
      const rate = event.errorRate ? ` (${Math.round(event.errorRate.errorRate * 100)} percent of ${event.errorRate.calls} calls failed)` : "";
      const subject = event.track && !event.role
        ? MODEL_TRACKS[event.track].name
        : event.role
          ? ROLE_POLICIES[event.role].label
          : "A model";
      if (event.kind === "manual" && event.role && event.track) {
        return `${subject} now follows ${MODEL_TRACKS[event.track].name} (${to}), chosen by an admin.`;
      }
      const verb = event.kind === "rollback" ? "moved back" : event.kind === "upgrade" ? "moved" : "switched";
      return `${subject} ${verb} ${from ? `from ${from} ` : ""}to ${to}: ${why}${rate}.`;
    };
    const log = [
      ...events.map((event) => ({
        id: event._id as string,
        at: event.at,
        kind: event.kind,
        automatic: event.actor === "system",
        text: eventText(event),
      })),
      ...notices.map((notice) => ({
        id: notice._id as string,
        at: notice.at,
        kind: "notice" as const,
        automatic: true,
        text: notice.message,
      })),
    ]
      .sort((a, b) => b.at - a.at)
      .slice(0, ADMIN_LOG_ROWS);
    const evaluations = await ctx.db
      .query("modelEvaluations")
      .withIndex("by_createdAt")
      .order("desc")
      .take(20);
    return {
      autoSwitch: await autoSwitchEnabled(ctx),
      lastRefreshAt: rows.reduce<number | null>(
        (latest, row) => (row.source === "openrouter" && (latest === null || row.lastSeenAt > latest) ? row.lastSeenAt : latest),
        null
      ),
      catalogSize: rows.length,
      thresholds: {
        maxErrorRate: AUTOMATION_THRESHOLDS.maxErrorRate,
        errorMinCalls: AUTOMATION_THRESHOLDS.errorMinCalls,
      },
      hasArtificialAnalysisScores: catalog.some((row) => row.scoreSource !== null),
      tracks,
      roles,
      log,
      catalog,
      // Evaluations ended on 2026-10-22; the last ones stay readable.
      evaluations: evaluations.map((evaluation) => ({
        id: evaluation._id,
        roleLabel: ROLE_POLICIES[evaluation.role].label,
        modelLabel: labelOf(evaluation.modelId) ?? evaluation.modelId,
        incumbentLabel: labelOf(evaluation.incumbentModelId) ?? evaluation.incumbentModelId,
        status: evaluation.status,
        outcome: evaluation.outcome ?? null,
        error: evaluation.error ?? null,
        evalCostUsd: evaluation.evalCostUsd ?? null,
        estimatedCostUsd: evaluation.estimatedCostUsd,
        createdAt: evaluation.createdAt,
      })),
    };
  },
});

/** The kill switch for every track upgrade and rollback. */
export const setAutoSwitch = mutation({
  args: { enabled: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, ["admin"]);
    const wasEnabled = await autoSwitchEnabled(ctx);
    await setSetting(ctx, AUTO_SWITCH_KEY, args.enabled ? "on" : "off", user._id);
    // Turned back on: a track held while it was off is logged again at once.
    if (args.enabled && !wasEnabled) {
      for (const track of MODEL_TRACK_IDS) {
        const row = await trackRow(ctx, track);
        if (row?.errorNoticeAt !== undefined) await ctx.db.patch(row._id, { errorNoticeAt: undefined });
      }
    }
    return null;
  },
});

export const setRoleCostCap = mutation({
  args: {
    role: modelRoleValidator,
    maxInputUsdPerMTok: v.number(),
    maxOutputUsdPerMTok: v.number(),
    maxCostRatio: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, ["admin"]);
    const cap = {
      maxInputUsdPerMTok: args.maxInputUsdPerMTok,
      maxOutputUsdPerMTok: args.maxOutputUsdPerMTok,
      maxCostRatio: args.maxCostRatio,
    };
    if (!validCostCap(cap)) domainError("INVALID_INPUT", "Cost caps must be positive numbers");
    await setSetting(ctx, costCapKey(args.role), JSON.stringify(cap), user._id);
    return null;
  },
});

export const setEvalBudget = mutation({
  args: { monthlyUsd: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, ["admin"]);
    if (!Number.isFinite(args.monthlyUsd) || args.monthlyUsd < 0 || args.monthlyUsd > 10_000) {
      domainError("INVALID_INPUT", "The evaluation budget must be between 0 and 10000 USD");
    }
    await setSetting(ctx, EVAL_BUDGET_KEY, String(args.monthlyUsd), user._id);
    return null;
  },
});

/**
 * Moves a track back to its previous model, by an admin. The model it left
 * is recorded as moved back from, so the daily job does not move the track
 * forward to it again.
 */
export const moveTrackBack = mutation({
  args: { track: modelTrackValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, ["admin"]);
    const row = await trackRow(ctx, args.track);
    if (!row?.previousModelId || row.previousModelId === row.modelId) {
      domainError("INVALID_STATE", "This tier has no previous model to move back to");
    }
    await moveTrack(ctx, {
      track: args.track,
      toModelId: row.previousModelId,
      kind: "rollback",
      reason: "admin_move_back",
      actor: "user",
      actorUserId: user._id,
    });
    return null;
  },
});

/** Points a role at a track by hand (logged as a manual switch). */
export const setRoleTrack = mutation({
  args: { role: modelRoleValidator, track: modelTrackValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, ["admin"]);
    await assignRoleTrackByHand(ctx, args.role, args.track, user._id);
    return null;
  },
});

/** Points a role at the track of a model id (kept for older admin pages). */
export const setRoleModel = mutation({
  args: { role: modelRoleValidator, modelId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, ["admin"]);
    await assignRoleModelByHand(ctx, args.role, args.modelId, user._id);
    return null;
  },
});

export const requestCatalogRefresh = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    await requireRole(ctx, ["admin"]);
    await ctx.scheduler.runAfter(0, refreshCatalogRef, {});
    return null;
  },
});
