/**
 * Automatic model catalog (owner decision 21, 2026-09-24).
 *
 * A daily cron (convex/crons.ts) runs `refreshCatalog`: it pulls OpenRouter's
 * public model list (and Artificial Analysis scores when AA_API_KEY is set),
 * upserts the catalog, raises admin notices for models the app uses that are
 * renamed, expiring or gone, checks per-provider endpoint support for tools
 * and structured outputs, rolls back a switched role whose model is failing
 * in production, and schedules at most a few evaluations
 * (convex/ai/modelEvaluation.ts). A candidate that passes every gate is
 * promoted for its role automatically, logged in modelSwitchEvents and
 * announced to admins on the alerts board.
 *
 * Guardrails: generations freeze their models at reservation
 * (lib/modelRoles.ts freezeModelsForGeneration); every role keeps its
 * previous model for a one-call rollback; the `models.autoSwitch` setting is
 * a kill switch for every automatic switch; a per-role cost cap bounds
 * prices; evaluations are capped per run and per month.
 *
 * The decision logic lives in shared/modelCatalog.ts and is tested there.
 */
import { v } from "convex/values";
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
  EVAL_SET_VERSION,
  MODEL_ROLES,
  ROLE_POLICIES,
  artificialAnalysisScore,
  bestIntelligenceScore,
  diffCatalog,
  estimateEvaluationCostUsd,
  parseArtificialAnalysis,
  parseEndpointSupport,
  parseOpenRouterModels,
  prefilterCandidate,
  productionErrorVerdict,
  promotionGates,
  refreshedFields,
  seedCatalogModels,
  selectEvaluations,
  summarizeEvalRun,
  validCostCap,
  type EvaluationPlanItem,
  type ModelRole,
  type ParsedModel,
  type PrefilterModel,
} from "../shared/modelCatalog";
import { seedModelById } from "../shared/generationModels";
import {
  AUTO_SWITCH_KEY,
  EVAL_BUDGET_KEY,
  autoSwitchEnabled,
  catalogRow,
  costCapKey,
  evalSpendThisMonth,
  frozenEntryForModel,
  generationModelFreeze,
  monthlyEvalBudgetUsd,
  raiseAdminNotice,
  roleAssignment,
  roleCostCap,
  roleModelId,
  assignRoleModelByHand,
  rollbackRoleModel,
  switchRoleModel,
} from "./lib/modelRoles";
import {
  endpointSupportValidator,
  evalTaskResultValidator,
  frozenModelEntryValidator,
  modelFreezeValidator,
  modelRoleValidator,
  parsedModelValidator,
} from "./lib/modelCatalogValidators";
import {
  applyCatalogRefreshRef,
  checkProductionErrorsRef,
  endpointCheckTargetsRef,
  planEvaluationsRef,
  recordEndpointSupportRef,
  refreshCatalogRef,
  runEvaluationRef,
  seedCatalogRef,
} from "./lib/modelCatalogRefs";

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const OPENROUTER_ENDPOINTS_URL = (slug: string) =>
  `https://openrouter.ai/api/v1/models/${slug}/endpoints`;
const ARTIFICIAL_ANALYSIS_URL = "https://artificialanalysis.ai/api/v2/data/llms/models";
const FETCH_TIMEOUT_MS = 30_000;
/** Rows read per catalog pass: the full OpenRouter text catalog is ~400. */
const CATALOG_READ_LIMIT = 2000;
/** A running evaluation older than this died with its action. */
const STALE_EVALUATION_MS = 30 * 60 * 1000;
/** Minutes between the evaluations one refresh schedules. */
const EVALUATION_STAGGER_MS = 5 * 60 * 1000;

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

async function assignedModelIds(ctx: QueryCtx | MutationCtx): Promise<Set<string>> {
  const ids = new Set<string>();
  for (const role of MODEL_ROLES) ids.add(await roleModelId(ctx, role));
  return ids;
}

// ─── Seed and refresh ───────────────────────────────────────────────────────

/** Insert every seed model the table does not hold yet. Idempotent. */
export async function ensureSeedCatalog(ctx: MutationCtx, now: number): Promise<number> {
  let inserted = 0;
  for (const seed of seedCatalogModels(now)) {
    if (await catalogRow(ctx, seed.modelId)) continue;
    await ctx.db.insert("modelCatalog", { ...seed, updatedAt: now });
    inserted += 1;
  }
  return inserted;
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
 * Apply one OpenRouter pull. Notices go only to models the app actually
 * uses (enabled, or assigned to a role); the other few hundred rows change
 * quietly. An enabled model that disappears keeps its status so pickers do
 * not lose it on a flaky listing; admins are told instead.
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
              `${row.displayName} was renamed on OpenRouter from ${change.fromId} to ${change.toId}. Requests now use the new id.`
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
              `${row.displayName} (${row.modelId}) is retired on ${change.expirationDate}, in ${change.daysLeft} days. Switch any role that uses it before then.`
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
              `${row.displayName} (${row.modelId}) is no longer listed on OpenRouter. Calls to it may fail; switch the roles that use it.`
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
        `No OpenRouter provider serves ${row.displayName} (${row.modelId}) with both tool calls and structured outputs. Generations on it will fail until one does.`
      );
    }
    return null;
  },
});

// ─── Production error rollback ──────────────────────────────────────────────

async function countSince<T>(
  iterable: AsyncIterable<T>,
  limit: number
): Promise<number> {
  let count = 0;
  for await (const _row of iterable) {
    void _row;
    count += 1;
    if (count >= limit) break;
  }
  return count;
}

/**
 * Roll back a switched role whose model is failing: over the last day (or
 * since the switch, if later), more than the threshold share of its calls
 * failed. With the kill switch on, admins are told instead, at most daily.
 * Never flips back after a rollback: the next switch is a human's call.
 */
export async function runProductionErrorCheck(
  ctx: MutationCtx,
  now: number
): Promise<Array<{ role: ModelRole; modelId: string; rolledBack: boolean }>> {
  const results: Array<{ role: ModelRole; modelId: string; rolledBack: boolean }> = [];
  const enabled = await autoSwitchEnabled(ctx);
  for (const role of MODEL_ROLES) {
    const assignment = await roleAssignment(ctx, role);
    if (!assignment?.previousModelId) continue;
    const lastEvent = await ctx.db
      .query("modelSwitchEvents")
      .withIndex("by_role_and_at", (q) => q.eq("role", role))
      .order("desc")
      .first();
    if (lastEvent?.kind === "rollback") continue;
    const since = Math.max(now - AUTOMATION_THRESHOLDS.errorWindowMs, assignment.assignedAt);
    const successes = await countSince(
      ctx.db
        .query("aiUsage")
        .withIndex("by_model_and_createdAt", (q) =>
          q.eq("model", assignment.modelId).gte("createdAt", since)
        ),
      1000
    );
    const failures = await countSince(
      ctx.db
        .query("modelCallFailures")
        .withIndex("by_model_and_at", (q) => q.eq("model", assignment.modelId).gte("at", since)),
      1000
    );
    const verdict = productionErrorVerdict({ successes, failures });
    if (!verdict.rollback) continue;
    const rate = `${Math.round(verdict.errorRate * 100)} percent of ${verdict.calls} calls`;
    if (!enabled) {
      if (
        assignment.errorNoticeAt === undefined ||
        now - assignment.errorNoticeAt >= AUTOMATION_THRESHOLDS.errorWindowMs
      ) {
        await ctx.db.patch(assignment._id, { errorNoticeAt: now });
        await raiseAdminNotice(
          ctx,
          `${assignment.modelId} failed ${rate} for the ${ROLE_POLICIES[role].label} role. Automatic switching is off, so it was not rolled back.`
        );
      }
      results.push({ role, modelId: assignment.modelId, rolledBack: false });
      continue;
    }
    await rollbackRoleModel(ctx, {
      role,
      reason: "production_error_rate",
      actor: "system",
      errorRate: {
        calls: verdict.calls,
        failures: verdict.failures,
        errorRate: verdict.errorRate,
      },
    });
    await raiseAdminNotice(
      ctx,
      `Rolled the ${ROLE_POLICIES[role].label} role back from ${assignment.modelId} to ${assignment.previousModelId}: it failed ${rate}.`
    );
    results.push({ role, modelId: assignment.modelId, rolledBack: true });
  }
  return results;
}

export const checkProductionErrors = internalMutation({
  args: {},
  returns: v.array(
    v.object({ role: modelRoleValidator, modelId: v.string(), rolledBack: v.boolean() })
  ),
  handler: async (ctx) => await runProductionErrorCheck(ctx, Date.now()),
});

/** Provider calls the model is answerable for (see providers.ts). */
export const recordCallFailure = internalMutation({
  args: { model: v.string(), callSite: v.string(), code: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert("modelCallFailures", { ...args, at: Date.now() });
    return null;
  },
});

// ─── Evaluation planning ────────────────────────────────────────────────────

function prefilterView(row: Doc<"modelCatalog">): PrefilterModel {
  return {
    modelId: row.modelId,
    gateway: row.gateway,
    status: row.status,
    inputUsdPerMTok: row.inputUsdPerMTok,
    outputUsdPerMTok: row.outputUsdPerMTok,
    contextLength: row.contextLength,
    maxOutputTokens: row.maxOutputTokens,
    supportsTools: row.supportsTools,
    supportsStructuredOutputs: row.supportsStructuredOutputs,
    endpointSupport: row.endpointSupport,
    expirationDate: row.expirationDate,
    benchmarks: row.benchmarks,
    missingSince: row.missingSince,
  };
}

async function blockedForRole(
  ctx: MutationCtx,
  role: ModelRole,
  modelId: string,
  now: number
): Promise<boolean> {
  const recent = await ctx.db
    .query("modelEvaluations")
    .withIndex("by_role_and_modelId", (q) => q.eq("role", role).eq("modelId", modelId))
    .order("desc")
    .first();
  if (recent && now - recent.createdAt < AUTOMATION_THRESHOLDS.evaluationCooldownMs) return true;
  const events = await ctx.db
    .query("modelSwitchEvents")
    .withIndex("by_role_and_at", (q) => q.eq("role", role))
    .order("desc")
    .take(50);
  return events.some((event) => event.kind === "rollback" && event.fromModelId === modelId);
}

/**
 * Prefilter every catalog row for every automatic role, then queue at most
 * `maxEvaluationsPerRun` evaluations the month's budget can cover. Nothing
 * is queued with the kill switch on, or for a role with one still pending.
 */
export async function planEvaluationRun(
  ctx: MutationCtx,
  now: number
): Promise<Id<"modelEvaluations">[]> {
  // An evaluation action that died (deploy, timeout) never completes its
  // row; release it so the role can be evaluated again.
  for (const stale of await ctx.db
    .query("modelEvaluations")
    .withIndex("by_status", (q) => q.eq("status", "running"))
    .take(20)) {
    if (now - (stale.startedAt ?? stale.createdAt) > STALE_EVALUATION_MS) {
      await ctx.db.patch(stale._id, {
        status: "error",
        error: "The evaluation stopped before it finished",
        evalCostUsd: stale.evalCostUsd ?? stale.estimatedCostUsd,
        completedAt: now,
      });
    }
  }
  if (!(await autoSwitchEnabled(ctx))) return [];
  const pending = [
    ...(await ctx.db.query("modelEvaluations").withIndex("by_status", (q) => q.eq("status", "queued")).take(20)),
    ...(await ctx.db.query("modelEvaluations").withIndex("by_status", (q) => q.eq("status", "running")).take(20)),
  ];
  const busyRoles = new Set(pending.map((evaluation) => evaluation.role));
  const rows = (await ctx.db.query("modelCatalog").take(CATALOG_READ_LIMIT)).filter(
    (row) => row.status !== "retired"
  );
  const judgeRow = await catalogRow(ctx, await roleModelId(ctx, "writing"));
  const eligible: Array<EvaluationPlanItem & { incumbentModelId: string; incumbentScore: number | null }> = [];
  for (const role of MODEL_ROLES) {
    const policy = ROLE_POLICIES[role];
    if (!policy.autoSwitch || busyRoles.has(role)) continue;
    const incumbentId = await roleModelId(ctx, role);
    const incumbentRow = rows.find((row) => row.modelId === incumbentId) ?? (await catalogRow(ctx, incumbentId));
    const incumbent = incumbentRow ? prefilterView(incumbentRow) : null;
    const cap = await roleCostCap(ctx, role);
    for (const row of rows) {
      const paper = prefilterCandidate({ role, candidate: prefilterView(row), incumbent, cap, now });
      if (!paper.ok || paper.score === null) continue;
      if (await blockedForRole(ctx, role, row.modelId, now)) continue;
      eligible.push({
        role,
        modelId: row.modelId,
        score: paper.score,
        incumbentModelId: incumbentId,
        incumbentScore: paper.incumbentScore,
        estimatedCostUsd: estimateEvaluationCostUsd([
          row,
          ...(incumbentRow ? [incumbentRow] : []),
          ...(judgeRow ? [judgeRow] : []),
        ]),
      });
    }
  }
  const budget = await monthlyEvalBudgetUsd(ctx);
  const spent = await evalSpendThisMonth(ctx, now);
  const { selected } = selectEvaluations({
    eligible,
    budgetRemainingUsd: Math.max(0, budget - spent),
  });
  const ids: Id<"modelEvaluations">[] = [];
  for (const item of selected) {
    const source = eligible.find((e) => e.role === item.role && e.modelId === item.modelId);
    ids.push(
      await ctx.db.insert("modelEvaluations", {
        role: item.role,
        modelId: item.modelId,
        incumbentModelId: source?.incumbentModelId ?? (await roleModelId(ctx, item.role)),
        evalSetVersion: EVAL_SET_VERSION,
        status: "queued",
        benchmarkScore: item.score,
        ...(source?.incumbentScore !== null && source?.incumbentScore !== undefined
          ? { incumbentBenchmarkScore: source.incumbentScore }
          : {}),
        estimatedCostUsd: item.estimatedCostUsd,
        createdAt: now,
      })
    );
  }
  return ids;
}

export const planEvaluations = internalMutation({
  args: {},
  returns: v.array(v.id("modelEvaluations")),
  handler: async (ctx): Promise<Id<"modelEvaluations">[]> =>
    await planEvaluationRun(ctx, Date.now()),
});

const claimedEvaluationValidator = v.object({
  evaluationId: v.id("modelEvaluations"),
  role: modelRoleValidator,
  candidate: frozenModelEntryValidator,
  incumbent: frozenModelEntryValidator,
  judge: frozenModelEntryValidator,
  tasks: v.array(
    v.union(v.literal("seed_batch"), v.literal("section_draft"), v.literal("qa_structured"))
  ),
});

/** Move a queued evaluation to running and hand the action its models. */
export const claimEvaluation = internalMutation({
  args: { evaluationId: v.id("modelEvaluations") },
  returns: v.union(v.null(), claimedEvaluationValidator),
  handler: async (ctx, args) => {
    const evaluation = await ctx.db.get(args.evaluationId);
    if (!evaluation || evaluation.status !== "queued") return null;
    const now = Date.now();
    const stop = async (reason: string) => {
      await ctx.db.patch(evaluation._id, {
        status: "error",
        error: reason,
        evalCostUsd: 0,
        completedAt: now,
      });
      return null;
    };
    if (!(await autoSwitchEnabled(ctx))) return await stop("Automatic switching is off");
    const cap = await roleCostCap(ctx, evaluation.role);
    const candidate = await frozenEntryForModel(ctx, evaluation.modelId, cap);
    const incumbent = await frozenEntryForModel(ctx, evaluation.incumbentModelId, cap);
    const judge = await frozenEntryForModel(
      ctx,
      await roleModelId(ctx, "writing"),
      await roleCostCap(ctx, "writing")
    );
    if (!candidate || !incumbent || !judge) return await stop("A model is missing from the catalog");
    await ctx.db.patch(evaluation._id, { status: "running", startedAt: now });
    return {
      evaluationId: evaluation._id,
      role: evaluation.role,
      candidate,
      incumbent,
      judge,
      tasks: [...ROLE_POLICIES[evaluation.role].evalTasks],
    };
  },
});

/**
 * Record an evaluation's results and apply the promotion rule. A pass
 * switches the role only when automatic switching is still on and the role
 * still runs the incumbent the candidate was measured against.
 */
export const completeEvaluation = internalMutation({
  args: {
    evaluationId: v.id("modelEvaluations"),
    candidateResults: v.array(evalTaskResultValidator),
    incumbentResults: v.array(evalTaskResultValidator),
    evalCostUsd: v.number(),
  },
  returns: v.union(v.literal("promoted"), v.literal("held"), v.literal("ignored")),
  handler: async (ctx, args): Promise<"promoted" | "held" | "ignored"> => {
    const evaluation = await ctx.db.get(args.evaluationId);
    if (!evaluation || evaluation.status !== "running") return "ignored";
    const now = Date.now();
    const candidate = summarizeEvalRun(args.candidateResults);
    const incumbent = summarizeEvalRun(args.incumbentResults);
    const row = await catalogRow(ctx, evaluation.modelId);
    const cap = await roleCostCap(ctx, evaluation.role);
    const decision = promotionGates({
      candidate,
      incumbent,
      candidatePrices: {
        inputUsdPerMTok: row?.inputUsdPerMTok,
        outputUsdPerMTok: row?.outputUsdPerMTok,
      },
      cap,
    });
    const base = {
      candidate,
      incumbent,
      gates: decision.gates,
      evalCostUsd: args.evalCostUsd,
      completedAt: now,
    };
    if (!decision.passed) {
      const failed = decision.gates.filter((gate) => !gate.passed).map((gate) => gate.gate);
      await ctx.db.patch(evaluation._id, {
        ...base,
        status: "failed",
        outcome: `held back: ${failed.join(", ")}`,
      });
      return "held";
    }
    const policy = ROLE_POLICIES[evaluation.role];
    const current = await roleModelId(ctx, evaluation.role);
    const blocker = !(await autoSwitchEnabled(ctx))
      ? "passed; automatic switching is off"
      : !policy.autoSwitch
        ? "passed; this role never switches on its own"
        : current !== evaluation.incumbentModelId
          ? "passed; the role changed while it ran"
          : null;
    if (blocker) {
      await ctx.db.patch(evaluation._id, { ...base, status: "passed", outcome: blocker });
      return "held";
    }
    await ctx.db.patch(evaluation._id, { ...base, status: "passed", outcome: "promoted" });
    await switchRoleModel(ctx, {
      role: evaluation.role,
      toModelId: evaluation.modelId,
      kind: "promotion",
      reason: "evaluation_passed",
      actor: "system",
      evaluationId: evaluation._id,
      evalResults: { candidate, incumbent, gates: decision.gates },
    });
    await raiseAdminNotice(
      ctx,
      `Switched the ${policy.label} role from ${evaluation.incumbentModelId} to ${evaluation.modelId} after it passed every evaluation gate (rubric ${candidate.rubricScore.toFixed(1)} vs ${incumbent.rubricScore.toFixed(1)}). Roll back on /admin/models if needed.`
    );
    return "promoted";
  },
});

export const failEvaluation = internalMutation({
  args: {
    evaluationId: v.id("modelEvaluations"),
    error: v.string(),
    evalCostUsd: v.number(),
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
      completedAt: Date.now(),
    });
    return null;
  },
});

// ─── Runtime resolution for actions ─────────────────────────────────────────

/**
 * The model a helper role runs now, as an entry an action can register, plus
 * the role's previous model as an OpenRouter fallback when both are on that
 * gateway.
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
    const assignment = await roleAssignment(ctx, args.role);
    const previous = assignment?.previousModelId
      ? await frozenEntryForModel(ctx, assignment.previousModelId, cap)
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
 * admin page; never shown to clients).
 */
export const refreshCatalog = internalAction({
  args: {},
  returns: v.object({
    fetched: v.number(),
    summary: refreshSummaryValidator,
    evaluationsQueued: v.number(),
  }),
  handler: async (ctx): Promise<{
    fetched: number;
    summary: { added: number; updated: number; renamed: number; expiring: number; gone: number; returned: number };
    evaluationsQueued: number;
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
    const summary = await ctx.runMutation(applyCatalogRefreshRef, {
      models: parsed.models,
      fetchedAt,
      complete: parsed.models.length >= AUTOMATION_THRESHOLDS.minPlausibleCatalogSize,
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
    const evaluationIds = await ctx.runMutation(planEvaluationsRef, {});
    for (const [index, evaluationId] of evaluationIds.entries()) {
      await ctx.scheduler.runAfter(index * EVALUATION_STAGGER_MS, runEvaluationRef, { evaluationId });
    }
    return { fetched: parsed.models.length, summary, evaluationsQueued: evaluationIds.length };
  },
});

// ─── Admin surface ──────────────────────────────────────────────────────────

async function adminOrNull(ctx: QueryCtx) {
  const user = await getCurrentUserOrNull(ctx);
  return user && user.role === "admin" && user.isAnonymous !== true ? user : null;
}

/** Rows the admin table shows: enabled and in-use first, then top scores. */
const ADMIN_CATALOG_ROWS = 60;

export const adminState = query({
  args: {},
  handler: async (ctx) => {
    if (!(await adminOrNull(ctx))) return null;
    const now = Date.now();
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
      const row = rows.find((item) => item.modelId === id);
      return row?.displayName ?? seedModelById(id)?.label ?? id;
    };
    const roles = [];
    for (const role of MODEL_ROLES) {
      const policy = ROLE_POLICIES[role];
      const assignment = await roleAssignment(ctx, role);
      const modelId = await roleModelId(ctx, role);
      const history = await ctx.db
        .query("modelSwitchEvents")
        .withIndex("by_role_and_at", (q) => q.eq("role", role))
        .order("desc")
        .take(10);
      roles.push({
        role,
        label: policy.label,
        description: policy.description,
        autoSwitch: policy.autoSwitch,
        modelId,
        modelLabel: labelOf(modelId) ?? modelId,
        previousModelId: assignment?.previousModelId ?? null,
        previousLabel: labelOf(assignment?.previousModelId),
        assignedAt: assignment?.assignedAt ?? null,
        assignedBy: assignment?.assignedBy ?? null,
        cap: await roleCostCap(ctx, role),
        history: history.map((event) => ({
          id: event._id,
          kind: event.kind,
          reason: event.reason,
          fromLabel: labelOf(event.fromModelId),
          toLabel: labelOf(event.toModelId) ?? event.toModelId,
          actor: event.actor,
          at: event.at,
          rubric: event.evalResults
            ? { candidate: event.evalResults.candidate.rubricScore, incumbent: event.evalResults.incumbent.rubricScore }
            : null,
          errorRate: event.errorRate?.errorRate ?? null,
        })),
      });
    }
    const evaluations = await ctx.db
      .query("modelEvaluations")
      .withIndex("by_createdAt")
      .order("desc")
      .take(20);
    const budget = await monthlyEvalBudgetUsd(ctx);
    return {
      autoSwitch: await autoSwitchEnabled(ctx),
      evalBudget: { monthlyUsd: budget, spentUsd: await evalSpendThisMonth(ctx, now) },
      lastRefreshAt: rows.reduce<number | null>(
        (latest, row) => (row.source === "openrouter" && (latest === null || row.lastSeenAt > latest) ? row.lastSeenAt : latest),
        null
      ),
      catalogSize: rows.length,
      thresholds: {
        benchmarkMargin: AUTOMATION_THRESHOLDS.benchmarkMargin,
        rubricMargin: AUTOMATION_THRESHOLDS.rubricMargin,
        maxEvaluationsPerRun: AUTOMATION_THRESHOLDS.maxEvaluationsPerRun,
        maxErrorRate: AUTOMATION_THRESHOLDS.maxErrorRate,
        errorMinCalls: AUTOMATION_THRESHOLDS.errorMinCalls,
      },
      hasArtificialAnalysisScores: catalog.some((row) => row.scoreSource !== null),
      roles,
      catalog,
      evaluations: evaluations.map((evaluation) => ({
        id: evaluation._id,
        role: evaluation.role,
        roleLabel: ROLE_POLICIES[evaluation.role].label,
        modelLabel: labelOf(evaluation.modelId) ?? evaluation.modelId,
        incumbentLabel: labelOf(evaluation.incumbentModelId) ?? evaluation.incumbentModelId,
        status: evaluation.status,
        outcome: evaluation.outcome ?? null,
        error: evaluation.error ?? null,
        candidate: evaluation.candidate ?? null,
        incumbent: evaluation.incumbent ?? null,
        gates: evaluation.gates ?? [],
        evalCostUsd: evaluation.evalCostUsd ?? null,
        estimatedCostUsd: evaluation.estimatedCostUsd,
        createdAt: evaluation.createdAt,
      })),
    };
  },
});

export const setAutoSwitch = mutation({
  args: { enabled: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, ["admin"]);
    await setSetting(ctx, AUTO_SWITCH_KEY, args.enabled ? "on" : "off", user._id);
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

/** One-call rollback for a role, by an admin. */
export const rollbackRole = mutation({
  args: { role: modelRoleValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, ["admin"]);
    const event = await rollbackRoleModel(ctx, {
      role: args.role,
      reason: "admin_rollback",
      actor: "user",
      actorUserId: user._id,
    });
    if (!event) domainError("INVALID_STATE", "This role has no previous model to roll back to");
    return null;
  },
});

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
