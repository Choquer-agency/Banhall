import { query, internalMutation, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { getCurrentUserOrNull, requireRole } from "./lib/auth";
import {
  estimateCostFromTable,
  pricingFor,
  pricingFromPerMillion,
  type CostSource,
  type ModelPricing,
} from "../shared/modelPricing";
import { catalogRow } from "./lib/modelRoles";
import { settlePreparationUsage } from "./lib/briefPreparationBudget";

/**
 * Estimated USD cost from the shared price table (`shared/modelPricing.ts`,
 * which cites its sources). Kept as a positional wrapper for existing
 * callers; `cacheCreation1hInputTokens` is the part of the cache writes made
 * with the 1-hour TTL.
 */
export function estimateCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheCreationInputTokens = 0,
  cacheReadInputTokens = 0,
  cacheCreation1hInputTokens = 0
): number {
  return estimateCostFromTable(model, {
    inputTokens,
    outputTokens,
    cacheCreationInputTokens,
    cacheCreation1hInputTokens,
    cacheReadInputTokens,
  });
}

function billableTokens(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * The cost to store for one usage event, and whether it is the provider's own
 * figure (`native`, OpenRouter usage.cost) or computed from the price table
 * (`estimated`, every Anthropic and Voyage call and any gateway response that
 * carried no valid cost).
 */
export function resolveUsageCost(args: {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens?: number;
  cacheCreation1hInputTokens?: number;
  cacheReadInputTokens?: number;
  costUsd?: number;
  /** Catalog pricing for a model the static table does not list. */
  catalogPricing?: ModelPricing;
}): { costUsd: number; costSource: CostSource } {
  if (
    args.costUsd !== undefined &&
    Number.isFinite(args.costUsd) &&
    args.costUsd >= 0
  ) {
    return { costUsd: args.costUsd, costSource: "native" };
  }
  return {
    costUsd: estimateCostFromTable(args.model, args, args.catalogPricing),
    costSource: "estimated",
  };
}

// Manager rollout changes in one place. Both backend authorization and
// frontend visibility consume queries backed by this table.
const USAGE_REPORT_ROLES: Record<string, true> = { admin: true };

async function usageViewerOrNull(ctx: QueryCtx): Promise<Id<"users"> | null> {
  const user = await getCurrentUserOrNull(ctx);
  return user?.role && user.isAnonymous !== true && USAGE_REPORT_ROLES[user.role] ? user._id : null;
}

export const usageReportAccess = query({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => Boolean(await usageViewerOrNull(ctx)),
});

const usageArgs = {
  projectId: v.optional(v.id("projects")),
  generationId: v.optional(v.id("generations")),
  candidateRunId: v.optional(v.id("generationCandidateRuns")),
  durationMs: v.optional(v.number()),
  userId: v.optional(v.string()),
  agentThreadId: v.optional(v.string()),
  brainSourceId: v.optional(v.id("brainSources")),
  callSite: v.string(),
  model: v.string(),
  inputTokens: v.number(),
  outputTokens: v.number(),
  cacheCreationInputTokens: v.optional(v.number()),
  // The part of cacheCreationInputTokens written with the 1-hour TTL (billed
  // at 2x input instead of 1.25x). Absent means every write was 5-minute.
  cacheCreation1hInputTokens: v.optional(v.number()),
  cacheReadInputTokens: v.optional(v.number()),
  // Provider-reported exact cost (OpenRouter usage.cost, on either gateway).
  // When present and valid it wins over the price-table estimate.
  costUsd: v.optional(v.number()),
  // The provider's stop reason as reported (Anthropic `stop_reason`,
  // OpenRouter `finish_reason`). "max_tokens" or "length" marks an answer
  // cut off at the output limit.
  stopReason: v.optional(v.string()),
  // Owner decision 30: "openrouter" when an Anthropic-gateway call went
  // through OpenRouter, and the provider OpenRouter says served it.
  transport: v.optional(v.literal("openrouter")),
  servedProvider: v.optional(v.string()),
  // Decision 65: a Brief preparation's call names its preparation and attempt.
  briefPreparationId: v.optional(v.id("briefPreparations")),
  preparationAttemptId: v.optional(v.string()),
  // 2026-09-27 (second): a call stopped part way; see the schema.
  partial: v.optional(v.boolean()),
  // 2026-10-19 (chat parity Phase A): a chat step's effort and time to its
  // first output block; see the schema.
  effort: v.optional(v.string()),
  firstTokenMs: v.optional(v.number()),
  createdAt: v.optional(v.number()),
};

/** Persist one provider response's billed usage. */
export const logUsage = internalMutation({
  args: usageArgs,
  returns: v.null(),
  handler: async (ctx, args) => {
    let projectId = args.projectId;
    let candidateUserId = args.userId;

    // Agent chat only knows its component thread id. Missing mappings do not
    // discard the row: agentThreadId is retained for later repair.
    if (!projectId && args.agentThreadId) {
      const threads = await ctx.db
        .query("agentChatThreads")
        .withIndex("by_agentThreadId", (q) =>
          q.eq("agentThreadId", args.agentThreadId!)
        )
        .take(2);
      if (threads.length === 1) projectId = threads[0].projectId;
    }

    if (args.brainSourceId) {
      const source = await ctx.db.get(args.brainSourceId);
      if (!projectId) projectId = source?.sourceProjectId;
      if (!candidateUserId) candidateUserId = source?.createdBy;
    }

    const project = projectId ? await ctx.db.get(projectId) : null;
    if (projectId && (!project || project.deletionStartedAt !== undefined)) {
      projectId = undefined;
    }
    let userId = candidateUserId
      ? (ctx.db.normalizeId("users", candidateUserId) ?? undefined)
      : undefined;
    if (!userId && project) userId = project.createdBy;
    const user = userId ? await ctx.db.get(userId) : null;
    const writerName = user?.name ?? user?.email ?? undefined;
    const inputTokens = billableTokens(args.inputTokens);
    const outputTokens = billableTokens(args.outputTokens);
    const cacheCreationInputTokens = billableTokens(
      args.cacheCreationInputTokens ?? 0
    );
    const cacheReadInputTokens = billableTokens(
      args.cacheReadInputTokens ?? 0
    );
    const cacheCreation1hInputTokens = Math.min(
      billableTokens(args.cacheCreation1hInputTokens ?? 0),
      cacheCreationInputTokens
    );
    // A model the static price table lacks (one the model catalog added) is
    // priced from its catalog row rather than as the fallback model.
    let catalogPricing: ModelPricing | undefined;
    if (args.costUsd === undefined && !pricingFor(args.model)) {
      const row = await catalogRow(ctx, args.model);
      if (row?.inputUsdPerMTok !== undefined && row.outputUsdPerMTok !== undefined) {
        catalogPricing = pricingFromPerMillion({
          input: row.inputUsdPerMTok,
          output: row.outputUsdPerMTok,
          cacheRead: row.cacheReadUsdPerMTok,
          cacheWrite: row.cacheWriteUsdPerMTok,
          cacheWrite1h: row.cacheWrite1hUsdPerMTok,
        });
      }
    }
    const cost = resolveUsageCost({
      ...(catalogPricing ? { catalogPricing } : {}),
      model: args.model,
      inputTokens,
      outputTokens,
      cacheCreationInputTokens,
      cacheCreation1hInputTokens,
      cacheReadInputTokens,
      ...(args.costUsd !== undefined ? { costUsd: args.costUsd } : {}),
    });

    await ctx.db.insert("aiUsage", {
      ...(projectId ? { projectId } : {}),
      ...(args.generationId ? { generationId: args.generationId } : {}),
      ...(args.candidateRunId
        ? { candidateRunId: args.candidateRunId }
        : {}),
      ...(args.durationMs !== undefined &&
      Number.isFinite(args.durationMs) &&
      args.durationMs >= 0
        ? { durationMs: args.durationMs }
        : {}),
      ...(userId ? { userId } : {}),
      ...(writerName ? { writerName } : {}),
      ...(args.agentThreadId ? { agentThreadId: args.agentThreadId } : {}),
      callSite: args.callSite,
      model: args.model,
      inputTokens,
      outputTokens,
      ...(args.cacheCreationInputTokens !== undefined
        ? { cacheCreationInputTokens }
        : {}),
      ...(args.cacheReadInputTokens !== undefined
        ? { cacheReadInputTokens }
        : {}),
      ...(args.cacheCreation1hInputTokens !== undefined
        ? { cacheCreation1hInputTokens }
        : {}),
      costUsd: cost.costUsd,
      costSource: cost.costSource,
      ...(args.stopReason ? { stopReason: args.stopReason } : {}),
      ...(args.transport ? { transport: args.transport } : {}),
      ...(args.servedProvider ? { servedProvider: args.servedProvider } : {}),
      ...(args.briefPreparationId ? { briefPreparationId: args.briefPreparationId } : {}),
      ...(args.preparationAttemptId ? { preparationAttemptId: args.preparationAttemptId } : {}),
      ...(args.partial ? { partial: true } : {}),
      ...(args.effort ? { effort: args.effort } : {}),
      ...(args.firstTokenMs !== undefined &&
      Number.isFinite(args.firstTokenMs) &&
      args.firstTokenMs >= 0
        ? { firstTokenMs: args.firstTokenMs }
        : {}),
      createdAt: args.createdAt ?? Date.now(),
    });
    // Decision 65: the preparation's spend settles from its usage rows, in
    // the same transaction as the row, so it is counted once.
    if (args.briefPreparationId) {
      await settlePreparationUsage(ctx, args.briefPreparationId, cost.costUsd);
    }
    return null;
  },
});

/**
 * Agent component usage handlers do not expose a scheduler. This mutation
 * atomically hands the event to one, giving chat usage a durable retry path.
 */
export const queueUsage = internalMutation({
  args: usageArgs,
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    await ctx.scheduler.runAfter(0, internal.aiUsage.logUsage, args);
    return null;
  },
});

type Aggregate = {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  costUsd: number;
};

function addUsage(aggregate: Aggregate, row: Doc<"aiUsage">): void {
  aggregate.calls += 1;
  aggregate.inputTokens += row.inputTokens;
  aggregate.outputTokens += row.outputTokens;
  aggregate.cacheCreationInputTokens += row.cacheCreationInputTokens ?? 0;
  aggregate.cacheReadInputTokens += row.cacheReadInputTokens ?? 0;
  aggregate.costUsd += row.costUsd;
}

function addGroupedUsage(
  groups: Map<string, Aggregate>,
  key: string,
  row: Doc<"aiUsage">
): void {
  let aggregate = groups.get(key);
  if (!aggregate) {
    aggregate = {
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      costUsd: 0,
    };
    groups.set(key, aggregate);
  }
  addUsage(aggregate, row);
}

function rankedRows(
  groups: Map<string, Aggregate>,
  labels: Map<string, string>
) {
  return [...groups.entries()]
    .map(([key, aggregate]) => ({
      key,
      label: labels.get(key) ?? key,
      ...aggregate,
    }))
    .sort((a, b) => b.costUsd - a.costUsd);
}

/**
 * Admin-only usage report for a date range. Aggregation streams the complete
 * indexed range instead of silently truncating at 10,000 rows. Project/user
 * IDs are the grouping keys; mutable display labels are attached afterward.
 */
export const usageReport = query({
  args: {
    start: v.optional(v.number()),
    end: v.optional(v.number()),
    // Client's timezone offset (Date.getTimezoneOffset()) so daily buckets
    // match the viewer's local days, not UTC days.
    tzOffsetMinutes: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (!(await usageViewerOrNull(ctx))) return null;

    const start = args.start ?? 0;
    const end = args.end ?? Number.MAX_SAFE_INTEGER;
    const tzOffsetMs = (args.tzOffsetMinutes ?? 0) * 60_000;
    const totals: Aggregate = {
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      costUsd: 0,
    };
    const byProject = new Map<string, Aggregate>();
    const byWriter = new Map<string, Aggregate>();
    const byModel = new Map<string, Aggregate>();
    const byCallSite = new Map<string, Aggregate>();
    const byDay = new Map<string, Aggregate>();
    const projectIds = new Map<string, Id<"projects">>();
    const userIds = new Map<string, string>();

    const range = ctx.db
      .query("aiUsage")
      .withIndex("by_createdAt", (q) =>
        q.gte("createdAt", start).lte("createdAt", end)
      )
      .order("desc");
    for await (const row of range) {
      addUsage(totals, row);

      const projectKey = row.projectId ?? "project:unattributed";
      if (row.projectId) projectIds.set(projectKey, row.projectId);
      addGroupedUsage(byProject, projectKey, row);

      const writerKey = row.userId
        ? `user:${row.userId}`
        : "user:unattributed";
      if (row.userId) userIds.set(writerKey, row.userId);
      addGroupedUsage(byWriter, writerKey, row);
      addGroupedUsage(byModel, row.model, row);
      addGroupedUsage(byCallSite, row.callSite, row);
      const dayKey = new Date(row.createdAt - tzOffsetMs)
        .toISOString()
        .slice(0, 10);
      addGroupedUsage(byDay, dayKey, row);
    }

    const projectLabels = new Map<string, string>([
      ["project:unattributed", "No project"],
    ]);
    for (const [key, projectId] of projectIds) {
      const project = await ctx.db.get(projectId);
      projectLabels.set(
        key,
        project
          ? `${project.clientName} — ${project.title}`
          : `Deleted project · ${projectId.slice(-6)}`
      );
    }

    const writerLabels = new Map<string, string>([
      ["user:unattributed", "Unattributed"],
    ]);
    for (const [key, rawUserId] of userIds) {
      const userId = ctx.db.normalizeId("users", rawUserId);
      const user = userId ? await ctx.db.get(userId) : null;
      writerLabels.set(
        key,
        user
          ? user.name ?? user.email ?? `User · ${rawUserId.slice(-6)}`
          : `Deleted user · ${rawUserId.slice(-6)}`
      );
    }

    const modelLabels = new Map([...byModel.keys()].map((key) => [key, key]));
    const callSiteLabels = new Map(
      [...byCallSite.keys()].map((key) => [key, key])
    );

    return {
      totals,
      byProject: rankedRows(byProject, projectLabels),
      byWriter: rankedRows(byWriter, writerLabels),
      byModel: rankedRows(byModel, modelLabels),
      byCallSite: rankedRows(byCallSite, callSiteLabels),
      // Chronological daily buckets for the spend-over-time chart.
      byDay: [...byDay.entries()]
        .map(([day, aggregate]) => ({ day, ...aggregate }))
        .sort((a, b) => (a.day < b.day ? -1 : 1)),
    };
  },
});

/**
 * Exact units for a finite USD number's canonical decimal representation.
 * 324 decimal places covers every finite Number, including 5e-324. BigInt
 * retains all those places, so this is not rounding to a currency quantum.
 * These local arithmetic values are never persisted or returned over Convex.
 */
export function usdDecimalUnits(value: number): bigint {
  const [mantissa, exponent = "0"] = String(value).split("e");
  const [whole, fraction = ""] = mantissa.split(".");
  const power = 324 + Number(exponent) - fraction.length;
  return BigInt(whole + fraction) * 10n ** BigInt(power);
}

/** Complete inclusive rolling spend, in the exact units of usdDecimalUnits. */
export async function projectRollingCostUsdUnits(
  ctx: Pick<QueryCtx, "db">,
  { projectId, now }: { projectId: Id<"projects">; now: number }
): Promise<bigint> {
  const rows = ctx.db.query("aiUsage")
    .withIndex("by_projectId_and_createdAt", (q) => q
      .eq("projectId", projectId)
      .gte("createdAt", now - 24 * 60 * 60 * 1000)
      .lte("createdAt", now));
  let costUsd = 0n;
  for await (const row of rows) costUsd += usdDecimalUnits(row.costUsd);
  return costUsd;
}

// ─── Chat timing report (chat parity Phase B, 2026-10-20) ───────────────────

/** The report chat's usage rows (`streamChatReply`'s usage handler). */
const CHAT_USAGE_CALL_SITE = "chat_v2";
/** Default window: the last seven days. */
const CHAT_TIMING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** Newest chat step rows read, at most. */
export const CHAT_TIMING_MAX_ROWS = 2_000;
/** Threads whose turns are read to count steps per turn, at most. */
const CHAT_TIMING_MAX_THREADS = 200;
/** Turns read per thread, at most. */
const CHAT_TIMING_TURNS_PER_THREAD = 200;
/** Turns read in all, at most, so rows and turns stay well under a query's read limits. */
export const CHAT_TIMING_MAX_TURNS = 4_000;
/** A turn may have started this long before the window and still count. */
const CHAT_TIMING_TURN_LEAD_MS = 15 * 60 * 1000;

type Percentiles = { p50: number | null; p90: number | null };

/** Nearest-rank percentiles of `values`; null when there are none. */
export function percentiles(values: readonly number[]): Percentiles {
  if (values.length === 0) return { p50: null, p90: null };
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (p: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))]!;
  return { p50: rank(0.5), p90: rank(0.9) };
}

/**
 * Admin only: how long report chat steps take. For the chat's usage rows
 * since `sinceMs` (default the last seven days, newest 2,000 rows), the p50
 * and p90 of each step's duration and time to first token by effort, the
 * stop reasons, and how many steps each turn took (each step matched to the
 * newest turn of its thread that started at or before it). Numbers only: no
 * names, no text, no ids.
 */
export const chatTimingReport = query({
  args: { sinceMs: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["admin"]);
    const since = args.sinceMs ?? Date.now() - CHAT_TIMING_WINDOW_MS;
    const read = await ctx.db
      .query("aiUsage")
      .withIndex("by_callSite_and_createdAt", (q) =>
        q.eq("callSite", CHAT_USAGE_CALL_SITE).gte("createdAt", since)
      )
      .order("desc")
      .take(CHAT_TIMING_MAX_ROWS + 1);
    const rows = read.slice(0, CHAT_TIMING_MAX_ROWS);

    const byEffort = new Map<string, { durations: number[]; firstTokens: number[]; steps: number }>();
    const stopReasons = new Map<string, number>();
    const byThread = new Map<string, number[]>();
    for (const row of rows) {
      const effort = row.effort ?? "unknown";
      const entry = byEffort.get(effort) ?? { durations: [], firstTokens: [], steps: 0 };
      entry.steps += 1;
      if (typeof row.durationMs === "number") entry.durations.push(row.durationMs);
      if (typeof row.firstTokenMs === "number") entry.firstTokens.push(row.firstTokenMs);
      byEffort.set(effort, entry);
      const reason = row.stopReason ?? "unknown";
      stopReasons.set(reason, (stopReasons.get(reason) ?? 0) + 1);
      if (row.agentThreadId) {
        const times = byThread.get(row.agentThreadId) ?? [];
        times.push(row.createdAt);
        byThread.set(row.agentThreadId, times);
      }
    }

    // Steps per turn: each row goes to the newest turn of its thread that
    // started at or before it. Bounded per thread, in threads and in turns
    // read in all, so the query stays within its read limits and says it
    // was cut instead (review P3-9).
    const stepsPerTurn = new Map<number, number>();
    let turnsCounted = 0;
    let turnsLeft = CHAT_TIMING_MAX_TURNS;
    let turnsCut = false;
    const threads = [...byThread.entries()].slice(0, CHAT_TIMING_MAX_THREADS);
    for (const [agentThreadId, times] of threads) {
      if (turnsLeft <= 0) {
        turnsCut = true;
        break;
      }
      const allowed = Math.min(CHAT_TIMING_TURNS_PER_THREAD, turnsLeft);
      const turns = await ctx.db
        .query("chatTurns")
        .withIndex("by_agentThreadId_and_startedAt", (q) =>
          q.eq("agentThreadId", agentThreadId).gte("startedAt", since - CHAT_TIMING_TURN_LEAD_MS)
        )
        .take(allowed);
      turnsLeft -= turns.length;
      // The total cap, not the thread, ended this read: it may be cut.
      if (allowed < CHAT_TIMING_TURNS_PER_THREAD && turns.length === allowed) turnsCut = true;
      const starts = turns
        .map((turn) => turn.startedAt)
        .filter((start): start is number => typeof start === "number")
        .sort((a, b) => a - b);
      const counts = new Map<number, number>();
      for (const time of times) {
        let owner: number | undefined;
        for (const start of starts) {
          if (start <= time) owner = start;
          else break;
        }
        if (owner !== undefined) counts.set(owner, (counts.get(owner) ?? 0) + 1);
      }
      for (const steps of counts.values()) {
        stepsPerTurn.set(steps, (stepsPerTurn.get(steps) ?? 0) + 1);
        turnsCounted += 1;
      }
    }

    return {
      since,
      steps: rows.length,
      /** The window holds more rows or threads than the report reads. */
      truncated: read.length > CHAT_TIMING_MAX_ROWS || byThread.size > CHAT_TIMING_MAX_THREADS || turnsCut,
      byEffort: [...byEffort.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([effort, entry]) => ({
          effort,
          steps: entry.steps,
          durationMs: percentiles(entry.durations),
          firstTokenMs: percentiles(entry.firstTokens),
        })),
      stopReasons: [...stopReasons.entries()]
        .sort(([nameA, a], [nameB, b]) => b - a || (nameA < nameB ? -1 : nameA > nameB ? 1 : 0))
        .map(([stopReason, count]) => ({ stopReason, count })),
      stepsPerTurn: [...stepsPerTurn.entries()]
        .sort(([a], [b]) => a - b)
        .map(([steps, turns]) => ({ steps, turns })),
      turnsCounted,
    };
  },
});
