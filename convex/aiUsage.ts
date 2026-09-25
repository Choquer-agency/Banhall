import { query, internalMutation, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { getCurrentUserOrNull } from "./lib/auth";
import {
  estimateCostFromTable,
  type CostSource,
} from "../shared/modelPricing";

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
}): { costUsd: number; costSource: CostSource } {
  if (
    args.costUsd !== undefined &&
    Number.isFinite(args.costUsd) &&
    args.costUsd >= 0
  ) {
    return { costUsd: args.costUsd, costSource: "native" };
  }
  return {
    costUsd: estimateCostFromTable(args.model, args),
    costSource: "estimated",
  };
}

// Manager rollout changes in one place. Both backend authorization and
// frontend visibility consume queries backed by this table.
const USAGE_REPORT_ROLES: Record<string, true> = { admin: true };

async function usageViewerOrNull(ctx: QueryCtx): Promise<Id<"users"> | null> {
  const user = await getCurrentUserOrNull(ctx);
  return user?.role && USAGE_REPORT_ROLES[user.role] ? user._id : null;
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
  // Provider-reported exact cost (OpenRouter usage.cost). When present and
  // valid it wins over the price-table estimate.
  costUsd: v.optional(v.number()),
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
    const cost = resolveUsageCost({
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
      createdAt: args.createdAt ?? Date.now(),
    });
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
