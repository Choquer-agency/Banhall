import { query, internalMutation, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc, Id } from "./_generated/dataModel";

type ModelPricing = {
  input: number;
  output: number;
  cacheCreationMultiplier: number;
  cacheReadMultiplier: number;
};

// USD per million tokens. Anthropic's default five-minute cache writes cost
// 1.25× base input and cache reads cost 0.1×. Voyage bills total processed
// tokens as input and has no output/cache charge.
const PRICING: Record<string, ModelPricing> = {
  "claude-sonnet-4-6": {
    input: 3,
    output: 15,
    cacheCreationMultiplier: 1.25,
    cacheReadMultiplier: 0.1,
  },
  "claude-opus-4-8": {
    input: 5,
    output: 25,
    cacheCreationMultiplier: 1.25,
    cacheReadMultiplier: 0.1,
  },
  "claude-haiku-4-5-20251001": {
    input: 1,
    output: 5,
    cacheCreationMultiplier: 1.25,
    cacheReadMultiplier: 0.1,
  },
  "claude-haiku-4-5": {
    input: 1,
    output: 5,
    cacheCreationMultiplier: 1.25,
    cacheReadMultiplier: 0.1,
  },
  "voyage-3-large": {
    input: 0.18,
    output: 0,
    cacheCreationMultiplier: 0,
    cacheReadMultiplier: 0,
  },
  "rerank-2.5": {
    input: 0.05,
    output: 0,
    cacheCreationMultiplier: 0,
    cacheReadMultiplier: 0,
  },
};
const FALLBACK_PRICING: ModelPricing = {
  input: 3,
  output: 15,
  cacheCreationMultiplier: 1.25,
  cacheReadMultiplier: 0.1,
};

function billableTokens(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function estimateCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheCreationInputTokens = 0,
  cacheReadInputTokens = 0
): number {
  const pricing = PRICING[model] ?? FALLBACK_PRICING;
  const inputCost =
    billableTokens(inputTokens) * pricing.input +
    billableTokens(cacheCreationInputTokens) *
      pricing.input *
      pricing.cacheCreationMultiplier +
    billableTokens(cacheReadInputTokens) *
      pricing.input *
      pricing.cacheReadMultiplier;
  const outputCost = billableTokens(outputTokens) * pricing.output;
  return (inputCost + outputCost) / 1_000_000;
}

// Manager rollout changes in one place. Both backend authorization and
// frontend visibility consume queries backed by this table.
const USAGE_REPORT_ROLES: Record<string, true> = { admin: true };

async function usageViewerOrNull(ctx: QueryCtx): Promise<Id<"users"> | null> {
  const userId = await getAuthUserId(ctx);
  if (!userId) return null;
  const user = await ctx.db.get(userId);
  return user?.role && USAGE_REPORT_ROLES[user.role] ? userId : null;
}

export const usageReportAccess = query({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => Boolean(await usageViewerOrNull(ctx)),
});

const usageArgs = {
  projectId: v.optional(v.id("projects")),
  userId: v.optional(v.string()),
  agentThreadId: v.optional(v.string()),
  brainSourceId: v.optional(v.id("brainSources")),
  callSite: v.string(),
  model: v.string(),
  inputTokens: v.number(),
  outputTokens: v.number(),
  cacheCreationInputTokens: v.optional(v.number()),
  cacheReadInputTokens: v.optional(v.number()),
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

    await ctx.db.insert("aiUsage", {
      ...(projectId ? { projectId } : {}),
      ...(userId ? { userId } : {}),
      ...(writerName ? { writerName } : {}),
      ...(args.agentThreadId ? { agentThreadId: args.agentThreadId } : {}),
      callSite: args.callSite,
      model: args.model,
      inputTokens,
      outputTokens,
      ...(cacheCreationInputTokens
        ? { cacheCreationInputTokens }
        : {}),
      ...(cacheReadInputTokens ? { cacheReadInputTokens } : {}),
      costUsd: estimateCostUsd(
        args.model,
        inputTokens,
        outputTokens,
        cacheCreationInputTokens,
        cacheReadInputTokens
      ),
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
