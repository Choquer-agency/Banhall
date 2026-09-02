import {
  query,
  mutation,
  internalQuery,
  internalMutation,
  internalAction,
  type QueryCtx,
  type MutationCtx,
} from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { Workpool } from "@convex-dev/workpool";
import { components, internal } from "./_generated/api";
import { brain } from "./ai/brain/rag";
import { requireBrainConfigured } from "./lib/providerConfig";
import { normalizeCraScienceCode } from "../shared/craScienceCodes";
import { extractPlainText } from "./lib/reportEdits";
import {
  getCurrentUserOrNull,
  requireInternalProjectAccess,
  requireRole,
} from "./lib/auth";
import { domainError } from "./lib/contracts";

// Serial embed queue with backoff — Voyage 429s on parallel bursts (the 10-PD
// seed lost 7/10 jobs at maxParallelism ∞). Bulk imports (BNH-17's ~500) drain
// safely through here instead of hammering the embeddings API.
const embedPool = new Workpool(components.embedPool, {
  maxParallelism: 1,
  retryActionsByDefault: true,
  defaultRetryBehavior: { maxAttempts: 6, initialBackoffMs: 15000, base: 2 },
});

/** Queue a source for embedding (used by import/approve/reweight). */
async function scheduleEmbed(
  ctx: MutationCtx,
  sourceId: Id<"brainSources">
) {
  requireBrainConfigured();
  await embedPool.enqueueAction(ctx, internal.ai.brain.ingest.embedSource, {
    sourceId,
  });
}

// ─── The Brain governance (BNH-10 / 18 / 39) ────────────────────────────────
// Everything here gatekeeps what reaches the RAG index. The index only ever
// holds APPROVED knowledge: approve → schedule embedSource; revoke → deleteByKey.
// Every change is written to brainAuditLog so the admin can see and revert it.

/** Admin-only guard (the Brain is sacred — only the admin curates it). */
async function assertAdmin(ctx: QueryCtx | MutationCtx): Promise<string> {
  const user = await getCurrentUserOrNull(ctx);
  if (!user) throw new Error("Not authenticated");
  if (user.role !== "admin") throw new Error("Admin only");
  return user._id;
}

/** Non-throwing variant for dashboard queries: null → render "sign in" state. */
async function adminOrNull(ctx: QueryCtx): Promise<string | null> {
  const user = await getCurrentUserOrNull(ctx);
  return user?.role === "admin" ? user._id : null;
}

/** Stable content fingerprint for dedup (FNV-1a, V8-safe — no node crypto). */
function contentHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${(h >>> 0).toString(16).padStart(8, "0")}-${s.length}`;
}

// ─── Ingestion inputs ───────────────────────────────────────────────────────

const importArgs = {
  kind: v.optional(
    v.union(
      v.literal("pd_pair"),
      v.literal("cra_letter"),
      v.literal("writer_feedback")
    )
  ),
  title: v.string(),
  industry: v.string(),
  writerName: v.optional(v.string()),
  writerTier: v.number(),
  docType: v.string(),
  fiscalYear: v.optional(v.number()),
  craOutcome: v.optional(
    v.union(v.literal("approved"), v.literal("rejected"), v.literal("disputed"))
  ),
  content: v.string(),
  scienceCode: v.optional(v.string()),
  sourceProjectId: v.optional(v.id("projects")),
  approve: v.optional(v.boolean()),
};

type ImportSourceArgs = {
  kind?: "pd_pair" | "cra_letter" | "writer_feedback";
  title: string;
  industry: string;
  writerName?: string;
  writerTier: number;
  docType: string;
  fiscalYear?: number;
  craOutcome?: "approved" | "rejected" | "disputed";
  content: string;
  scienceCode?: string;
  sourceProjectId?: import("./_generated/dataModel").Id<"projects">;
  approve?: boolean;
};

export async function importSource(
  ctx: MutationCtx,
  args: ImportSourceArgs,
  actor: string
) {
  const explicitScienceCode = normalizeCraScienceCode(args.scienceCode);
  if (args.scienceCode?.trim() && !explicitScienceCode) {
    throw new Error("Invalid CRA field of science or technology code");
  }
  const sourceProject = args.sourceProjectId
    ? await ctx.db.get(args.sourceProjectId)
    : null;
  const projectScienceCode = normalizeCraScienceCode(sourceProject?.scienceCode);
  const scienceCode = projectScienceCode ?? explicitScienceCode;
  const hash = contentHash(args.content);

  // Dedup by content (BNH-17). A later project-linked import may enrich an
  // existing legacy row with structured science routing metadata.
  const existing = await ctx.db
    .query("brainSources")
    .withIndex("by_hash", (q) => q.eq("sourceHash", hash))
    .first();
  if (existing) {
    if (scienceCode && existing.scienceCode !== scienceCode) {
      await ctx.db.patch(existing._id, { scienceCode });
      if (existing.status === "approved") await scheduleEmbed(ctx, existing._id);
    }
    return existing._id;
  }

  const kind = args.kind ?? "pd_pair";
  const status = args.approve ? "approved" : "pending";
  const sourceId = await ctx.db.insert("brainSources", {
    kind,
    status,
    title: args.title,
    industry: args.industry,
    writerName: args.writerName,
    writerTier: args.writerTier,
    docType: args.docType,
    fiscalYear: args.fiscalYear,
    craOutcome: args.craOutcome,
    scienceCode,
    content: args.content,
    ragKey: `${kind}:${hash}`,
    sourceHash: hash,
    sourceProjectId: args.sourceProjectId,
    createdBy: actor,
    createdAt: Date.now(),
  });

  await ctx.db.insert("brainAuditLog", {
    action: args.approve ? "approve" : "ingest",
    sourceId,
    actorId: actor,
    reason: args.approve ? "Imported & auto-approved (curated)" : "Imported (pending review)",
    at: Date.now(),
  });

  if (args.approve) {
    await scheduleEmbed(ctx, sourceId);
  }
  return sourceId;
}

/**
 * Add a curated gold PD (or transcript/CRA letter) to The Brain. For the
 * hand-picked ~10 (BNH-10 Phase 0) pass approve=true to ingest immediately;
 * for the bulk 500 (BNH-17) insert as pending and let the admin approve.
 */
export const importPdPair = mutation({
  args: importArgs,
  handler: async (ctx, args) => {
    const admin = await assertAdmin(ctx);
    return await importSource(ctx, args, admin);
  },
});

/**
 * CLI seeding path (scripts/seed-brain.mjs): `npx convex run` carries no user
 * identity, so assertAdmin would reject it. Internal = only callable with the
 * deployment's admin key, so the auth ceremony is the deploy key itself.
 */
export const seedPdPair = internalMutation({
  args: importArgs,
  handler: async (ctx, args) => {
    return await importSource(ctx, args, "cli:seed");
  },
});

/**
 * Learning loop (auto-nomination): when a writer rates a finished report
 * highly, nominate its text as a PENDING Brain source. The admin still
 * gatekeeps every entry — this only feeds the existing review queue, it never
 * ingests. Dedup by content hash makes repeat nominations no-ops.
 */
export const nominateFromReport = internalMutation({
  args: {
    reportId: v.id("reports"),
    writerName: v.optional(v.string()),
    score: v.number(),
    // CAP-4b: the persisted writerReviews row this nomination came from.
    // Optional (additive) so jobs queued before the field existed still
    // validate; recorded in the actor string so the audit trail links back
    // to the review that triggered the nomination.
    reviewId: v.optional(v.id("writerReviews")),
  },
  handler: async (ctx, args) => {
    const report = await ctx.db.get(args.reportId);
    if (!report) return;
    const project = await ctx.db.get(report.projectId);
    if (!project) return;
    const content = extractPlainText(report.content);
    if (!content.trim()) return;
    await importSource(
      ctx,
      {
        kind: "pd_pair",
        title: `${project.title} (writer-rated ${args.score}/100)`,
        industry: project.industry ?? "general",
        writerName: args.writerName,
        // Conservative default weight; the admin reweights on approval.
        writerTier: 0.4,
        docType: "pd",
        fiscalYear: project.fiscalYearEnd
          ? new Date(project.fiscalYearEnd).getFullYear()
          : undefined,
        content,
        sourceProjectId: report.projectId,
        // Never auto-approve: the nomination lands in the pending queue.
      },
      `auto-nominate:score-${args.score}${
        args.reviewId ? `:review-${args.reviewId}` : ""
      }`
    );
  },
});

/**
 * Hard-delete a source row (CLI/test cleanup, bad crawler imports). Refuses
 * approved sources — those must go through revokeSource so the unlearn is
 * audited. Cleans up the RAG entry if one was ever created.
 */
export const removeSourcePermanently = internalMutation({
  args: { sourceId: v.id("brainSources") },
  handler: async (ctx, args) => {
    const s = await ctx.db.get(args.sourceId);
    if (!s) return;
    if (s.status === "approved") {
      throw new Error("Source is approved — revoke it first (audited unlearn).");
    }
    if (s.ragEntryId) {
      await ctx.scheduler.runAfter(0, internal.brain.unlearnSource, {
        ragEntryId: s.ragEntryId,
      });
    }
    await ctx.db.delete(args.sourceId);
  },
});

/**
 * Re-embed every approved source through the throttled pool, unlearning each
 * row's previous RAG entry first. For index-shape migrations (namespace or
 * embedding-model changes) — content and governance rows are untouched.
 */
export const requeueAllApprovedEmbeds = internalMutation({
  args: {},
  handler: async (ctx) => {
    const approved = await ctx.db
      .query("brainSources")
      .withIndex("by_status", (q) => q.eq("status", "approved"))
      .collect();
    for (const s of approved) {
      if (s.ragEntryId) {
        await ctx.scheduler.runAfter(0, internal.brain.unlearnSource, {
          ragEntryId: s.ragEntryId,
        });
      }
      await scheduleEmbed(ctx, s._id);
    }
    return { requeued: approved.length };
  },
});

/** Internal: only an approved row may cross into the vector index. */
export const getBrainSourceForIngest = internalQuery({
  args: { sourceId: v.id("brainSources") },
  handler: async (ctx, args) => {
    const s = await ctx.db.get(args.sourceId);
    if (!s || s.status !== "approved") return null;
    return {
      title: s.title,
      content: s.content,
      industry: s.industry,
      writerName: s.writerName,
      writerTier: s.writerTier,
      docType: s.docType,
      fiscalYear: s.fiscalYear,
      craOutcome: s.craOutcome,
      scienceCode: normalizeCraScienceCode(s.scienceCode),
      ragKey: s.ragKey,
      sourceHash: s.sourceHash,
    };
  },
});

// ─── Admin actions on the queue ─────────────────────────────────────────────

export const approveSource = mutation({
  args: { sourceId: v.id("brainSources"), reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const admin = await assertAdmin(ctx);
    const s = await ctx.db.get(args.sourceId);
    if (!s) throw new Error("Source not found");
    await ctx.db.patch(args.sourceId, { status: "approved" });
    await ctx.db.insert("brainAuditLog", {
      action: "approve",
      sourceId: args.sourceId,
      actorId: admin,
      reason: args.reason,
      at: Date.now(),
    });
    await scheduleEmbed(ctx, args.sourceId);
  },
});

/** Unlearn: "wipe this from the brain." Revoke → delete from the RAG. */
export const revokeSource = mutation({
  args: { sourceId: v.id("brainSources"), reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const admin = await assertAdmin(ctx);
    const s = await ctx.db.get(args.sourceId);
    if (!s) throw new Error("Source not found");
    await ctx.db.patch(args.sourceId, { status: "revoked" });
    await ctx.db.insert("brainAuditLog", {
      action: "revoke",
      sourceId: args.sourceId,
      actorId: admin,
      reason: args.reason,
      at: Date.now(),
    });
    if (s.ragEntryId) {
      await ctx.scheduler.runAfter(0, internal.brain.unlearnSource, {
        ragEntryId: s.ragEntryId,
      });
    }
  },
});

/** Deleting from the RAG needs an action (component delete runs in actions). */
export const unlearnSource = internalAction({
  args: { ragEntryId: v.string() },
  handler: async (ctx, args) => {
    await brain.delete(ctx, { entryId: args.ragEntryId as never });
  },
});

/** Change a writer's weight for an entry and re-ingest (replace by key). */
export const reweightSource = mutation({
  args: { sourceId: v.id("brainSources"), writerTier: v.number() },
  handler: async (ctx, args) => {
    const admin = await assertAdmin(ctx);
    const s = await ctx.db.get(args.sourceId);
    if (!s) throw new Error("Source not found");
    const tier = Math.max(0, Math.min(1, args.writerTier));
    await ctx.db.patch(args.sourceId, { writerTier: tier });
    await ctx.db.insert("brainAuditLog", {
      action: "reweight",
      sourceId: args.sourceId,
      actorId: admin,
      reason: `writerTier → ${tier}`,
      at: Date.now(),
    });
    if (s.status === "approved") {
      await scheduleEmbed(ctx, args.sourceId);
    }
  },
});

// ─── Writer → admin feedback conduit (BNH-39) ───────────────────────────────

/** Input bounds for submitBrainFeedback; oversize payloads are INVALID_INPUT. */
export const MAX_BRAIN_FEEDBACK_BODY_CHARS = 10_000;
export const MAX_BRAIN_FEEDBACK_RULE_CHARS = 1_000;

/**
 * CAP-5: feedback may only reference a report and project the caller can
 * access, and the two must belong together. Every check below runs before
 * the insert, so a rejected call writes nothing.
 */
export const submitBrainFeedback = mutation({
  args: {
    body: v.string(),
    suggestedRule: v.optional(v.string()),
    reportId: v.optional(v.id("reports")),
    projectId: v.optional(v.id("projects")),
  },
  handler: async (ctx, args) => {
    // Scope. A supplied projectId is checked first through the CAP-1 helper,
    // which refuses anonymous and role-less callers before any lookup; a
    // supplied reportId must exist and belong to that project. With only a
    // reportId, access is checked against the report's own project, which is
    // then stored on the row so the admin queue always carries the project.
    // With neither id, an active internal role is still required.
    let user: Doc<"users">;
    let projectId: Id<"projects"> | undefined;
    if (args.projectId) {
      ({ user } = await requireInternalProjectAccess(ctx, args.projectId));
      projectId = args.projectId;
      if (args.reportId) {
        const report = await ctx.db.get(args.reportId);
        if (!report) domainError("NOT_FOUND", "Report not found");
        if (report.projectId !== args.projectId) {
          domainError("NOT_AUTHORIZED", "Report does not belong to this project");
        }
      }
    } else if (args.reportId) {
      const report = await ctx.db.get(args.reportId);
      if (!report) domainError("NOT_FOUND", "Report not found");
      ({ user } = await requireInternalProjectAccess(ctx, report.projectId));
      projectId = report.projectId;
    } else {
      user = await requireRole(ctx, ["writer", "manager", "admin"]);
    }

    const body = args.body.trim();
    if (!body) domainError("INVALID_INPUT", "Feedback body is required");
    if (body.length > MAX_BRAIN_FEEDBACK_BODY_CHARS) {
      domainError(
        "INVALID_INPUT",
        `Feedback body must be at most ${MAX_BRAIN_FEEDBACK_BODY_CHARS} characters`
      );
    }
    const suggestedRule = args.suggestedRule?.trim() || undefined;
    if (suggestedRule && suggestedRule.length > MAX_BRAIN_FEEDBACK_RULE_CHARS) {
      domainError(
        "INVALID_INPUT",
        `Suggested rule must be at most ${MAX_BRAIN_FEEDBACK_RULE_CHARS} characters`
      );
    }

    return await ctx.db.insert("brainFeedbackQueue", {
      fromUserId: user._id,
      fromName: user.name,
      reportId: args.reportId,
      projectId,
      body,
      suggestedRule,
      status: "pending",
      createdAt: Date.now(),
    });
  },
});

/**
 * Feedback shorter than this carries no promotable knowledge (a bare "thanks"
 * or emoji). The decision is still recorded; only source nomination is skipped.
 * Exported: the distillation query (learning.getApprovedBrainFeedbackForDigest)
 * must count exactly the rows this mutation promotes.
 */
export const MIN_PROMOTABLE_FEEDBACK_CHARS = 40;

export const reviewFeedback = mutation({
  args: {
    feedbackId: v.id("brainFeedbackQueue"),
    decision: v.union(v.literal("approved"), v.literal("rejected")),
    reviewNote: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const admin = await assertAdmin(ctx);
    const fb = await ctx.db.get(args.feedbackId);
    if (!fb) throw new Error("Feedback not found");
    // Status fence: a decided item is final. The admin UI only renders pending
    // rows (listFeedbackQueue filters by status), so a second decision can only
    // come from a stale client — reject it instead of silently rewriting the
    // recorded decision (and re-nominating a source).
    if (fb.status !== "pending") {
      throw new Error(`Feedback already reviewed (${fb.status})`);
    }
    await ctx.db.patch(args.feedbackId, {
      status: args.decision,
      reviewedBy: admin,
      reviewNote: args.reviewNote,
    });

    // Approved feedback with usable content is routed into the Brain pipeline
    // instead of being discarded (the pre-existing gap: approve used to only
    // flip status). It lands PENDING, not approved: approving the feedback
    // says "this writer signal is valid", not "this exact text, at this
    // weight/industry, belongs in the retrieval index". The sources queue is
    // where the admin curates tier/industry/content with the full review pane
    // — the same reason nominateFromReport never auto-approves — and it keeps
    // the invariant that every vector-index entry traces to an explicit
    // approve on a brainSources row. Content-hash dedup (importSource) makes
    // repeat nomination a no-op.
    let sourceId: Id<"brainSources"> | undefined;
    if (args.decision === "approved") {
      const rule = fb.suggestedRule?.trim();
      const body = fb.body.trim();
      const promotable =
        !!rule || body.length >= MIN_PROMOTABLE_FEEDBACK_CHARS;
      if (promotable) {
        const project = fb.projectId ? await ctx.db.get(fb.projectId) : null;
        sourceId = await importSource(
          ctx,
          {
            kind: "writer_feedback",
            title: `Writer feedback: ${(rule ?? body).slice(0, 80)}`,
            industry: project?.industry ?? "general",
            writerName: fb.fromName,
            // Conservative default weight; the admin reweights on approval.
            writerTier: 0.4,
            docType: "writer_feedback",
            content: rule ? `Suggested rule: ${rule}\n\n${body}` : body,
            sourceProjectId: fb.projectId,
            // Never auto-approve: the nomination lands in the pending queue.
          },
          admin
        );
        // Learning loop: approved feedback is also distillation signal for the
        // draft-style digest (immutable candidates, admin publication ledger)
        // — the governed channel through which feedback reaches prompts. The
        // delay coalesces a review session's worth of decisions; the action
        // no-ops when the newest candidate already covers this approval.
        await ctx.scheduler.runAfter(
          10 * 60 * 1000,
          internal.ai.learning.generateDraftStyleDigest,
          {}
        );
      }
    }

    await ctx.db.insert("brainAuditLog", {
      action: args.decision === "approved" ? "approve" : "reject",
      feedbackId: args.feedbackId,
      // Links the decision to the nominated source (if any) for provenance.
      sourceId,
      actorId: admin,
      reason: args.reviewNote,
      at: Date.now(),
    });
  },
});

// ─── Admin dashboard reads (reactive) ───────────────────────────────────────

export const listBrainSources = query({
  args: {
    status: v.optional(
      v.union(v.literal("pending"), v.literal("approved"), v.literal("revoked"))
    ),
  },
  handler: async (ctx, args) => {
    if (!(await adminOrNull(ctx))) return null;
    const rows = args.status
      ? await ctx.db
          .query("brainSources")
          .withIndex("by_status", (q) => q.eq("status", args.status!))
          .order("desc")
          .collect()
      : await ctx.db.query("brainSources").order("desc").take(200);
    // Don't ship full content to the list view.
    return rows.map((r) => ({
      _id: r._id,
      title: r.title,
      status: r.status,
      kind: r.kind,
      industry: r.industry,
      writerName: r.writerName ?? null,
      writerTier: r.writerTier,
      docType: r.docType,
      craOutcome: r.craOutcome ?? null,
      scienceCode: normalizeCraScienceCode(r.scienceCode) ?? null,
      hasEntry: !!r.ragEntryId,
      createdAt: r.createdAt,
    }));
  },
});

/** Full row (incl. content) for the review pane — list views strip content. */
export const getBrainSource = query({
  args: { sourceId: v.id("brainSources") },
  handler: async (ctx, args) => {
    if (!(await adminOrNull(ctx))) return null;
    return await ctx.db.get(args.sourceId);
  },
});

export const listFeedbackQueue = query({
  args: {},
  handler: async (ctx) => {
    if (!(await adminOrNull(ctx))) return null;
    return await ctx.db
      .query("brainFeedbackQueue")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .order("desc")
      .collect();
  },
});

export const listBrainAudit = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    if (!(await adminOrNull(ctx))) return null;
    return await ctx.db
      .query("brainAuditLog")
      .withIndex("by_at")
      .order("desc")
      .take(args.limit ?? 100);
  },
});

export const brainStats = query({
  args: {},
  handler: async (ctx) => {
    if (!(await adminOrNull(ctx))) return null;
    const approved = await ctx.db
      .query("brainSources")
      .withIndex("by_status", (q) => q.eq("status", "approved"))
      .collect();
    const pending = await ctx.db
      .query("brainSources")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .collect();
    const byIndustry: Record<string, number> = {};
    for (const s of approved) byIndustry[s.industry] = (byIndustry[s.industry] ?? 0) + 1;
    return { approved: approved.length, pending: pending.length, byIndustry };
  },
});
