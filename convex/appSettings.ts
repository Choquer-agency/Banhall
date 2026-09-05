/**
 * Admin-tunable app settings (one row per key). First setting: the default
 * generation model — used whenever a writer doesn't explicitly pick a model
 * (single/iterative modes, and the "Default" picker option). Falls back to
 * the registry default (shared/generationModels MODEL) when unset.
 */
import { mutation, internalQuery, internalMutation, type QueryCtx, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { requireRole } from "./lib/auth";
import { domainError } from "./lib/contracts";
import { MODEL, modelById } from "../shared/generationModels";
import type { Id } from "./_generated/dataModel";
import {
  DEFAULT_CONTEXT_BUDGET,
  type ContextBudget,
} from "./ai/trustedContext";
import {
  DEFAULT_CHAT_EVIDENCE_BUDGET,
  type ChatEvidenceBudget,
} from "./ai/chatEvidence";

const DEFAULT_MODEL_KEY = "defaultModel";
const ANALYZER_CONTEXT_BUDGET_KEY = "ai.analyzerContextBudgetTokens";
const ANALYZER_TRANSCRIPT_BUDGET_KEY = "ai.analyzerTranscriptBudgetTokens";
const ANALYZER_DOCUMENT_BUDGET_KEY = "ai.analyzerDocumentBudgetTokens";
const ANALYZER_MAX_DOCUMENTS_KEY = "ai.analyzerMaxContextDocuments";
const CHAT_EVIDENCE_BUDGET_KEY = "ai.chatEvidenceBudgetTokens";
const CHAT_EVIDENCE_DOCUMENT_BUDGET_KEY = "ai.chatEvidenceDocumentBudgetTokens";
const CHAT_MAX_EVIDENCE_DOCUMENTS_KEY = "ai.chatMaxEvidenceDocuments";
const MY_WORK_KILL_SWITCH_KEY = "myWork.killSwitch";
const MY_WORK_DEFAULT_VIEW_KEY = "myWork.defaultView";
const MY_WORK_READINESS_KEY = "myWork.readiness";

async function setSetting(ctx: MutationCtx, key: string, value: string, updatedBy: Id<"users">) {
  const existing = await ctx.db.query("appSettings").withIndex("by_key", (q) => q.eq("key", key)).unique();
  const patch = { value, updatedBy, updatedAt: Date.now() };
  if (existing) await ctx.db.patch(existing._id, patch);
  else await ctx.db.insert("appSettings", { key, ...patch });
}

async function assertMyWorkReady(ctx: MutationCtx) {
  const latestVerified = await ctx.db
    .query("myWorkBackfillRuns")
    .withIndex("by_status_and_dryRun_and_updatedAt", (q) => q.eq("status", "completed").eq("dryRun", false))
    .order("desc")
    .first();
  if (!latestVerified || !latestVerified.verifiedAt || latestVerified.verificationMismatches !== 0) {
    domainError("INVALID_STATE", "Complete and verify the My work backfill before enabling the dashboard");
  }
  for (const status of ["running", "failed"] as const) {
    const run = await ctx.db.query("myWorkBackfillRuns").withIndex("by_status_and_dryRun_and_updatedAt", (q) => q.eq("status", status).eq("dryRun", false)).first();
    if (run) domainError("INVALID_STATE", "Resolve the incomplete My work backfill before enabling the dashboard");
  }
  for (const status of ["pending", "running", "failed"] as const) {
    const rebuild = await ctx.db.query("oversightRebuilds").withIndex("by_status_and_updatedAt", (q) => q.eq("status", status)).first();
    if (rebuild) domainError("INVALID_STATE", "Resolve ownership reconciliation before enabling the dashboard");
  }
  if (await ctx.db.query("oversightSyncing").first()) {
    domainError("INVALID_STATE", "Wait for ownership reconciliation before enabling the dashboard");
  }
}

export async function defaultModelId(ctx: QueryCtx | MutationCtx): Promise<string> {
  const row = await ctx.db
    .query("appSettings")
    .withIndex("by_key", (q) => q.eq("key", DEFAULT_MODEL_KEY))
    .unique();
  // A stale setting (model removed from the registry) falls back to the
  // registry default rather than breaking generations.
  return row && modelById(row.value) ? row.value : MODEL;
}

/**
 * One admin-tunable positive integer. Shared by every budget reader so the
 * silent-fallback rule is written once: absent, unparseable or non-positive
 * means the module constant, never an exception.
 */
async function readPositiveInt(
  ctx: QueryCtx | MutationCtx,
  key: string,
  fallback: number
): Promise<number> {
  const row = await ctx.db
    .query("appSettings")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
  if (!row) return fallback;
  // Plain decimal digits only: Number() would happily read "1e9" or
  // "0x2710" as a valid positive integer that means nothing like what an
  // admin typed.
  const raw = row.value.trim();
  if (!/^\d+$/.test(raw)) return fallback;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Admin-tunable analyzer context budget. Each field is read independently and
 * falls back to its module constant when the row is absent, unparseable or
 * non-positive — same rule as `defaultModelId`: a stale or fat-fingered
 * setting must never break generations.
 */
export async function analyzerContextBudget(
  ctx: QueryCtx | MutationCtx
): Promise<ContextBudget> {
  return {
    totalTokens: await readPositiveInt(
      ctx,
      ANALYZER_CONTEXT_BUDGET_KEY,
      DEFAULT_CONTEXT_BUDGET.totalTokens
    ),
    transcriptTokens: await readPositiveInt(
      ctx,
      ANALYZER_TRANSCRIPT_BUDGET_KEY,
      DEFAULT_CONTEXT_BUDGET.transcriptTokens
    ),
    perDocumentTokens: await readPositiveInt(
      ctx,
      ANALYZER_DOCUMENT_BUDGET_KEY,
      DEFAULT_CONTEXT_BUDGET.perDocumentTokens
    ),
    maxDocuments: await readPositiveInt(
      ctx,
      ANALYZER_MAX_DOCUMENTS_KEY,
      DEFAULT_CONTEXT_BUDGET.maxDocuments
    ),
  };
}

/**
 * Admin-tunable chat evidence budget (CAP-4). Only the three knobs the SPEC
 * names are settings: the total, the per-document cap and the document count.
 * The report, analysis and prior-decision caps stay module constants because
 * they are internal allocation of that total, not a policy an admin tunes.
 * Same silent per-field fallback as the analyzer's budget.
 */
export async function chatEvidenceBudget(
  ctx: QueryCtx | MutationCtx
): Promise<ChatEvidenceBudget> {
  return {
    ...DEFAULT_CHAT_EVIDENCE_BUDGET,
    totalTokens: await readPositiveInt(
      ctx,
      CHAT_EVIDENCE_BUDGET_KEY,
      DEFAULT_CHAT_EVIDENCE_BUDGET.totalTokens
    ),
    perDocumentTokens: await readPositiveInt(
      ctx,
      CHAT_EVIDENCE_DOCUMENT_BUDGET_KEY,
      DEFAULT_CHAT_EVIDENCE_BUDGET.perDocumentTokens
    ),
    maxDocuments: await readPositiveInt(
      ctx,
      CHAT_MAX_EVIDENCE_DOCUMENTS_KEY,
      DEFAULT_CHAT_EVIDENCE_BUDGET.maxDocuments
    ),
  };
}

export const getDefaultModel = internalQuery({
  args: {},
  handler: async (ctx) => defaultModelId(ctx),
});

export const setMyWorkRolloutInternal = internalMutation({
  args: {
    killSwitch: v.boolean(),
    defaultView: v.union(v.literal("my_work"), v.literal("all_projects")),
    ready: v.boolean(),
    adminId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const admin = await ctx.db.get(args.adminId);
    if (!admin || admin.role !== "admin" || admin.isAnonymous === true) throw new Error("An active administrator is required");
    if (args.ready) await assertMyWorkReady(ctx);
    await setSetting(ctx, MY_WORK_KILL_SWITCH_KEY, args.killSwitch ? "on" : "off", admin._id);
    await setSetting(ctx, MY_WORK_DEFAULT_VIEW_KEY, args.defaultView, admin._id);
    await setSetting(ctx, MY_WORK_READINESS_KEY, args.ready ? "ready" : "not_ready", admin._id);
  },
});

export const setMyWorkRollout = mutation({
  args: {
    killSwitch: v.boolean(),
    defaultView: v.union(v.literal("my_work"), v.literal("all_projects")),
    ready: v.boolean(),
  },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, ["admin"]);
    if (args.ready) await assertMyWorkReady(ctx);
    await setSetting(ctx, MY_WORK_KILL_SWITCH_KEY, args.killSwitch ? "on" : "off", user._id);
    await setSetting(ctx, MY_WORK_DEFAULT_VIEW_KEY, args.defaultView, user._id);
    await setSetting(ctx, MY_WORK_READINESS_KEY, args.ready ? "ready" : "not_ready", user._id);
  },
});

export const setDefaultModel = mutation({
  args: { modelId: v.string() },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, ["admin"]);
    if (!modelById(args.modelId)) {
      domainError("INVALID_INPUT", "Unknown model id");
    }
    const now = Date.now();
    const existing = await ctx.db
      .query("appSettings")
      .withIndex("by_key", (q) => q.eq("key", DEFAULT_MODEL_KEY))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        value: args.modelId,
        updatedBy: user._id,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("appSettings", {
        key: DEFAULT_MODEL_KEY,
        value: args.modelId,
        updatedBy: user._id,
        updatedAt: now,
      });
    }
  },
});

const CHAT_DAILY_BUDGET_KEY = "ai.chatDailyBudgetUsd";
const CHAT_MAX_QUEUED_TURNS_KEY = "ai.chatMaxQueuedTurns";

export async function chatAdmissionLimits(ctx: QueryCtx | MutationCtx) {
  const row = await ctx.db.query("appSettings")
    .withIndex("by_key", (q) => q.eq("key", CHAT_DAILY_BUDGET_KEY)).unique();
  const raw = row?.value.trim() ?? "";
  // Accept decimal/scientific notation emitted by String(number), not hex.
  const parsed = /^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(raw)
    ? Number(raw) : NaN;
  return {
    dailyBudgetUsd: Number.isFinite(parsed) && parsed > 0 ? parsed : 50,
    maxQueuedTurns: await readPositiveInt(ctx, CHAT_MAX_QUEUED_TURNS_KEY, 3),
  };
}

export const setChatAdmissionLimits = mutation({
  args: { dailyBudgetUsd: v.number(), maxQueuedTurns: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, ["admin"]);
    if (!Number.isFinite(args.dailyBudgetUsd) || args.dailyBudgetUsd <= 0 ||
        !Number.isSafeInteger(args.maxQueuedTurns) || args.maxQueuedTurns <= 0) {
      domainError("INVALID_INPUT", "Chat limits require positive finite USD and a positive safe integer queue count");
    }
    await setSetting(ctx, CHAT_DAILY_BUDGET_KEY, String(args.dailyBudgetUsd), user._id);
    await setSetting(ctx, CHAT_MAX_QUEUED_TURNS_KEY, String(args.maxQueuedTurns), user._id);
    return null;
  },
});
