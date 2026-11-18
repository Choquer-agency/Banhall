import { isEvaluationProject } from "./lib/evaluationProjects";
import { readReportContent } from "./lib/reportBodies";
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
import { paginationOptsValidator } from "convex/server";
import type { Doc, Id } from "./_generated/dataModel";
import { Workpool } from "@convex-dev/workpool";
import { components, internal } from "./_generated/api";
import { eraseBrainEntry } from "./ai/brain/erase";
import {
  BRAIN_CHUNK_NOTES_VERSION,
  countKeys,
  deleteBrainSource,
  deleteSourceImportLinksPage,
  insertBrainSource,
  linkBrainSourceImportFile,
  patchBrainSource,
  sourceIdForImportFile,
  syncBrainSourceCard,
  type CountKey,
} from "./ai/brain/rag";
import { requireBrainConfigured } from "./lib/providerConfig";
import { normalizeCraScienceCode } from "../shared/craScienceCodes";
import { extractPlainText } from "./lib/reportEdits";
import { deidentify } from "./lib/deidentify";
import { companyOtherNames } from "./lib/clients";
import { dashboardCompanyKey } from "../shared/dashboardProjection";
import {
  getCurrentUserOrNull,
  requireInternalProjectAccess,
  requireRole,
} from "./lib/auth";
import { domainError } from "./lib/contracts";
import { turnOffWithdrawnPublishedSet, withdrawFeedback, withdrawSourceFeedback } from "./lib/learningWithdrawal";

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
// holds APPROVED knowledge: approve → schedule embedSource; revoke → confirmed
// erasure through unlearnSource (a retained ragEntryId on a revoked row is
// failure evidence, never a servable entry).
// Every change is written to brainAuditLog so the admin can see and revert it.

/** Admin-only guard (the Brain is sacred — only the admin curates it). */
async function assertAdmin(ctx: QueryCtx | MutationCtx): Promise<string> {
  const user = await getCurrentUserOrNull(ctx);
  if (!user || user.isAnonymous === true) throw new Error("Not authenticated");
  if (user.role !== "admin") throw new Error("Admin only");
  return user._id;
}

/** Non-throwing variant for dashboard queries: null → render "sign in" state. */
async function adminOrNull(ctx: QueryCtx): Promise<string | null> {
  const user = await getCurrentUserOrNull(ctx);
  return user?.role === "admin" && user.isAnonymous !== true ? user._id : null;
}

/** Stable content fingerprint for dedup (FNV-1a, V8-safe — no node crypto). */
export function contentHash(s: string): string {
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
  /**
   * The import file this source is made from (2026-11-17). Its
   * `ingestionItems.contentHash` is matched before the text hash, and every
   * file linked to a source is remembered (`brainSourceImportFiles`), so a
   * copy of any linked file finds its source even if its text was read
   * differently.
   */
  importItem?: { itemId: Id<"ingestionItems">; contentHash: string };
};

/** What the refusal calls the thing being imported, from its doc type. */
function docNoun(docType: string): string {
  if (docType === "pd") return "PD";
  if (docType === "transcript") return "transcript";
  if (docType === "cra_letter") return "CRA letter";
  return "file";
}

/**
 * Shown when an import matches a revoked source. It says why when the row
 * tells: rejected from the queue, or removed after it was approved. There is
 * no way to approve it again here yet (that comes later, as a new row).
 */
export function revokedMatchMessage(
  docType: string,
  revokedFromStatus: Doc<"brainSources">["revokedFromStatus"]
): string {
  const noun = docNoun(docType);
  if (revokedFromStatus === "pending") {
    return `This ${noun} matches a Brain source an Admin rejected, so it cannot be approved here.`;
  }
  if (revokedFromStatus === "approved") {
    return `This ${noun} matches a Brain source an Admin removed from the Brain, so it cannot be approved here.`;
  }
  return `This ${noun} matches a Brain source that was rejected or removed, so it cannot be approved here.`;
}

/**
 * What `importSource` did (2026-11-17). `added`: a new row. `matched`: an
 * existing pending or approved row is reused (and approved now when the
 * caller asked to approve a pending one). `revoked`: the match was removed
 * from the Brain, so nothing is reused, approved or written; the caller
 * shows `message` or handles the revoked source itself.
 */
export type ImportSourceResult =
  | { outcome: "added" | "matched"; sourceId: Id<"brainSources">; status: "pending" | "approved" }
  | { outcome: "revoked"; sourceId: Id<"brainSources">; message: string };

/**
 * The existing source an import matches: by the bytes of any import file
 * linked to a source first, then by text.
 */
export async function findImportMatch(
  ctx: MutationCtx,
  textHash: string,
  importContentHash: string | undefined
): Promise<Doc<"brainSources"> | null> {
  if (importContentHash) {
    const linkedId = await sourceIdForImportFile(ctx, importContentHash);
    const linked = linkedId ? await ctx.db.get("brainSources", linkedId) : null;
    if (linked) return linked;
    // A source whose first file has no link row yet. A source's first file is
    // unique to it (a second file with those bytes always matches it here),
    // so two rows is broken data and fails loudly.
    const byFile = await ctx.db
      .query("brainSources")
      .withIndex("by_importContentHash", (q) => q.eq("importContentHash", importContentHash))
      .unique();
    if (byFile) return byFile;
  }
  return await ctx.db
    .query("brainSources")
    .withIndex("by_hash", (q) => q.eq("sourceHash", textHash))
    .first();
}

export async function importSource(
  ctx: MutationCtx,
  args: ImportSourceArgs,
  actor: string
): Promise<ImportSourceResult> {
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

  // Dedup that respects status (2026-11-17; BNH-17 dedup by content). A
  // revoked match is never reused: nothing re-approves or re-ingests it here.
  const existing = await findImportMatch(ctx, hash, args.importItem?.contentHash);
  if (existing?.status === "revoked") {
    return {
      outcome: "revoked",
      sourceId: existing._id,
      message: revokedMatchMessage(args.docType, existing.revokedFromStatus),
    };
  }
  if (existing) {
    // A later project-linked import may enrich an existing legacy row with
    // structured science routing metadata; a file import links its bytes
    // (the source keeps its first file; every file is remembered below).
    const patch: Partial<Doc<"brainSources">> = {};
    if (scienceCode && existing.scienceCode !== scienceCode) patch.scienceCode = scienceCode;
    if (args.importItem && !existing.importContentHash) {
      patch.importContentHash = args.importItem.contentHash;
      if (!existing.importItemId) patch.importItemId = args.importItem.itemId;
    }
    const approveNow = args.approve === true && existing.status === "pending";
    if (approveNow) {
      // The approver's metadata wins over the nomination's defaults, in the
      // same patch, so the counts and the embed's filters follow it.
      patch.status = "approved";
      patch.industry = args.industry;
      patch.writerTier = args.writerTier;
      // A blank writer clears the nomination's, so the source and its card
      // show what the approver chose.
      patch.writerName = args.writerName;
      if (args.title.trim()) patch.title = args.title;
    }
    if (Object.keys(patch).length > 0) await patchBrainSource(ctx, existing, patch);
    if (args.importItem) await linkBrainSourceImportFile(ctx, existing._id, args.importItem);
    if (approveNow) {
      await ctx.db.insert("brainAuditLog", {
        action: "approve",
        sourceId: existing._id,
        actorId: actor,
        reason: "Imported again and approved (it matched a pending source)",
        at: Date.now(),
      });
    }
    if (approveNow || (existing.status === "approved" && patch.scienceCode)) {
      await scheduleEmbed(ctx, existing._id);
    }
    return {
      outcome: "matched",
      sourceId: existing._id,
      status: approveNow ? "approved" : existing.status,
    };
  }

  const kind = args.kind ?? "pd_pair";
  const status = args.approve ? "approved" : "pending";
  const sourceId = await insertBrainSource(ctx, {
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
    importItemId: args.importItem?.itemId,
    importContentHash: args.importItem?.contentHash,
  });
  if (args.importItem) await linkBrainSourceImportFile(ctx, sourceId, args.importItem);

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
  return { outcome: "added", sourceId, status };
}

/**
 * The source id for callers that show a refusal: a revoked match throws
 * `BRAIN_SOURCE_REVOKED` with the plain message, so nothing is written.
 */
export function sourceIdOrRefuse(result: ImportSourceResult): Id<"brainSources"> {
  if (result.outcome === "revoked") {
    domainError("BRAIN_SOURCE_REVOKED", result.message, { sourceId: result.sourceId });
  }
  return result.sourceId;
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
    return sourceIdOrRefuse(await importSource(ctx, args, admin));
  },
});

/**
 * CLI seeding path (scripts/seed-brain.mjs): `npx convex run` carries no user
 * identity, so assertAdmin would reject it. Internal = only callable with the
 * deployment's admin key, so the auth ceremony is the deploy key itself.
 */
/**
 * The next page of a removed Brain source's import file links
 * (deleteBrainSource deletes the first page and schedules this for the rest).
 */
export const deleteBrainSourceImportLinks = internalMutation({
  args: { sourceId: v.id("brainSources") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const more = await deleteSourceImportLinksPage(ctx, args.sourceId);
    if (more) {
      await ctx.scheduler.runAfter(0, internal.brain.deleteBrainSourceImportLinks, { sourceId: args.sourceId });
    }
    return null;
  },
});

export const seedPdPair = internalMutation({
  args: importArgs,
  handler: async (ctx, args) => {
    return sourceIdOrRefuse(await importSource(ctx, args, "cli:seed"));
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
    // Phase E (E3): an evaluation project's report is never nominated.
    if (!project || isEvaluationProject(project)) return;
    const rawContent = extractPlainText(await readReportContent(ctx, report));
    if (!rawContent.trim()) return;
    // CAP-1: this row becomes firm-wide Brain knowledge, and both its content
    // and its title reach drafting prompts (the title as the exemplar label).
    // Scrub client identifiers out of both before they leave the project.
    const content = deidentify(rawContent, project);
    // A match an Admin revoked is left alone (no new nomination).
    await importSource(
      ctx,
      {
        kind: "pd_pair",
        title: `${deidentify(project.title, project)} (writer-rated ${args.score}/100)`,
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
    // Phase E (E2a): removing a source withdraws the lessons drawn from it,
    // as revoking does, before its feedback loses the link.
    await withdrawSourceFeedback(ctx, args.sourceId);
    // Every link, page by page (review: not only the first 200).
    for (;;) {
      const linked = await ctx.db
        .query("brainFeedbackQueue")
        .withIndex("by_brainSourceId", (q) => q.eq("brainSourceId", args.sourceId))
        .take(200);
      for (const row of linked) await ctx.db.patch(row._id, { brainSourceId: undefined });
      if (linked.length < 200) break;
    }
    if (s.ragEntryId) {
      await ctx.scheduler.runAfter(0, internal.brain.unlearnSource, {
        ragEntryId: s.ragEntryId,
      });
    }
    await deleteBrainSource(ctx, args.sourceId);
  },
});

/** Approved sources re-queued per page of `requeueAllApprovedEmbeds`. */
export const REQUEUE_PAGE_SIZE = 50;

/**
 * Re-embed every approved source through the throttled pool, unlearning each
 * row's previous RAG entry first. For index-shape migrations (namespace or
 * embedding-model changes) — content and governance rows are untouched.
 *
 * 2026-11-17: one page of approved list cards per run (no source text is
 * read), then it schedules the next page, so it works for thousands of
 * sources. Start it with no arguments; needs `backfillBrainSourceCards`
 * finished first, since it walks the cards.
 */
export const requeueAllApprovedEmbeds = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  returns: v.object({ requeued: v.number(), done: v.boolean() }),
  handler: async (ctx, args) => {
    if (!(await cardsReady(ctx))) {
      throw new Error(
        "The Brain's list cards are not built yet. Run brain:backfillBrainSourceCards to the end first."
      );
    }
    const page = await ctx.db
      .query("brainSourceCards")
      .withIndex("by_status_and_createdAt", (q) => q.eq("status", "approved"))
      .paginate({ cursor: args.cursor ?? null, numItems: REQUEUE_PAGE_SIZE });
    for (const card of page.page) {
      if (card.ragEntryId) {
        await ctx.scheduler.runAfter(0, internal.brain.unlearnSource, {
          ragEntryId: card.ragEntryId,
        });
      }
      await scheduleEmbed(ctx, card.sourceId);
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.brain.requeueAllApprovedEmbeds, {
        cursor: page.continueCursor,
      });
    }
    return { requeued: page.page.length, done: page.isDone };
  },
});

/**
 * Whether a source's vectors still carry its writer tier as importance
 * (2026-11-17). Embeds since then record `ragImportance` (always 1); an
 * older row's importance was its tier, clamped, as of its last embed.
 */
export function needsFullImportanceEmbed(source: Pick<Doc<"brainSources">, "ragImportance" | "writerTier">): boolean {
  const stored = source.ragImportance ?? Math.max(0, Math.min(1, source.writerTier));
  return stored < 1;
}

/**
 * The deploy step of 2026-11-17 (relevance floor on raw similarity):
 * re-embeds, at importance 1, every approved source whose vectors still
 * carry its tier and, when chunk notes are on (`BRAIN_CONTEXTUAL=1`), every
 * one whose notes predate BRAIN_CHUNK_NOTES_VERSION (older notes may name
 * the company), one page of 50 approved cards per run, scheduling the next.
 * Unlike `requeueAllApprovedEmbeds` it deletes nothing first: the embed adds
 * under the same key, and the RAG component replaces an entry whose
 * importance or content hash differs, so the Brain never shrinks during the
 * run. Sources already at importance 1 (tier 1.0, or embedded since) with
 * current notes, or with notes off, are skipped. Each
 * re-embed pays Voyage and, when chunk notes are on, Haiku again. Needs
 * `backfillBrainSourceCards` finished first.
 */
export const reembedBelowFullImportance = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  returns: v.object({ queued: v.number(), skipped: v.number(), done: v.boolean() }),
  handler: async (ctx, args) => {
    if (!(await cardsReady(ctx))) {
      throw new Error(
        "The Brain's list cards are not built yet. Run brain:backfillBrainSourceCards to the end first."
      );
    }
    const page = await ctx.db
      .query("brainSourceCards")
      .withIndex("by_status_and_createdAt", (q) => q.eq("status", "approved"))
      .paginate({ cursor: args.cursor ?? null, numItems: REQUEUE_PAGE_SIZE });
    // Chunk notes are on in this deployment: notes from an older prompt
    // (which asked for the company) are renewed too, tier 1.0 included.
    const notesOn = process.env.BRAIN_CONTEXTUAL === "1";
    let queued = 0;
    for (const card of page.page) {
      const oldNotes = notesOn && card.chunkNotesVersion !== BRAIN_CHUNK_NOTES_VERSION;
      if (!needsFullImportanceEmbed(card) && !oldNotes) continue;
      await scheduleEmbed(ctx, card.sourceId);
      queued += 1;
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.brain.reembedBelowFullImportance, {
        cursor: page.continueCursor,
      });
    }
    return { queued, skipped: page.page.length - queued, done: page.isDone };
  },
});

/**
 * Sources read per page of `backfillBrainSourceCards`. Small, because each
 * row still carries its full text (up to 1 MiB) until the text moves off
 * the row.
 */
export const CARD_BACKFILL_PAGE_SIZE = 10;

const CARDS_READY = { scope: "meta" as const, key: "cards_ready" };

/** Whether the card backfill has run to its last page (the re-embed needs it). */
async function cardsReady(ctx: QueryCtx | MutationCtx): Promise<boolean> {
  const marker = await ctx.db
    .query("brainSourceCounts")
    .withIndex("by_scope_and_key", (q) => q.eq("scope", CARDS_READY.scope).eq("key", CARDS_READY.key))
    .unique();
  return marker !== null;
}

/** The count rows of one scope, as a map (bounded: 3 statuses, industries in the hundreds). */
async function countRows(ctx: QueryCtx | MutationCtx, scope: "status" | "industry") {
  return await ctx.db
    .query("brainSourceCounts")
    .withIndex("by_scope_and_key", (q) => q.eq("scope", scope))
    .take(1000);
}

/**
 * One-time, owner-run right after the backend deploy (2026-11-17): builds the
 * list card and the stored counts for every source written before them. One
 * page per run; it schedules the next. Idempotent: rows already in step
 * change nothing, so running it again, or while Admins work, never double
 * counts. The last page writes the "cards ready" marker and logs the totals.
 */
export const backfillBrainSourceCards = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    synced: v.optional(v.number()),
  },
  returns: v.object({
    synced: v.number(),
    total: v.number(),
    done: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("brainSources")
      .paginate({ cursor: args.cursor ?? null, numItems: CARD_BACKFILL_PAGE_SIZE });
    for (const source of page.page) await syncBrainSourceCard(ctx, source._id, source);
    const total = (args.synced ?? 0) + page.page.length;
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.brain.backfillBrainSourceCards, {
        cursor: page.continueCursor,
        synced: total,
      });
    } else {
      const marker = await ctx.db
        .query("brainSourceCounts")
        .withIndex("by_scope_and_key", (q) => q.eq("scope", CARDS_READY.scope).eq("key", CARDS_READY.key))
        .unique();
      if (marker) await ctx.db.patch(marker._id, { count: total });
      else await ctx.db.insert("brainSourceCounts", { ...CARDS_READY, count: total });
      const byStatus = Object.fromEntries((await countRows(ctx, "status")).map((r) => [r.key, r.count]));
      console.log(`backfillBrainSourceCards done: ${total} sources synced; counts ${JSON.stringify(byStatus)}`);
    }
    return { synced: page.page.length, total, done: page.isDone, continueCursor: page.continueCursor };
  },
});

/** Cards read per page of `recountBrainSourceCounts` (small rows, no text). */
export const RECOUNT_PAGE_SIZE = 500;

const countEntry = v.object({
  scope: v.union(v.literal("status"), v.literal("industry")),
  key: v.string(),
  count: v.number(),
});

/**
 * Repair (2026-11-17): counts every card again, a page at a time, and on the
 * last page rewrites the status and industry count rows to match. Run it
 * when `bumpCount` logs a missing row. Start it with no arguments; best run
 * while nobody is approving or revoking, since a write between its pages can
 * be counted before or after its change.
 */
export const recountBrainSourceCounts = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    totals: v.optional(v.array(countEntry)),
  },
  returns: v.object({ done: v.boolean(), changed: v.number() }),
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("brainSourceCards")
      .paginate({ cursor: args.cursor ?? null, numItems: RECOUNT_PAGE_SIZE });
    const id = (k: CountKey) => `${k.scope}:${k.key}`;
    const totals = new Map((args.totals ?? []).map((t) => [id(t), { ...t }]));
    for (const card of page.page) {
      for (const k of countKeys(card)) {
        const entry = totals.get(id(k)) ?? { ...k, count: 0 };
        entry.count += 1;
        totals.set(id(k), entry);
      }
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.brain.recountBrainSourceCounts, {
        cursor: page.continueCursor,
        totals: [...totals.values()],
      });
      return { done: false, changed: 0 };
    }
    let changed = 0;
    for (const scope of ["status", "industry"] as const) {
      for (const row of await countRows(ctx, scope)) {
        const key = id({ scope, key: row.key });
        const want = totals.get(key);
        totals.delete(key);
        if (!want) {
          await ctx.db.delete(row._id);
          changed += 1;
        } else if (want.count !== row.count) {
          await ctx.db.patch(row._id, { count: want.count });
          changed += 1;
        }
      }
    }
    for (const missing of totals.values()) {
      await ctx.db.insert("brainSourceCounts", missing);
      changed += 1;
    }
    console.log(`recountBrainSourceCounts done: ${changed} count rows fixed`);
    return { done: true, changed };
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
    await patchBrainSource(ctx, s, { status: "approved" });
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

/**
 * Deletion-only remediation bound. A failed erasure reschedules `unlearnSource`
 * (never `embedSource` — nothing may re-approve or re-ingest a revoked source)
 * with exponential backoff until this many attempts have been made; after that
 * the retained `ragEntryId` plus the `unlearn_failed` audit rows are the
 * standing evidence, and a fresh `revokeSource` call restarts remediation.
 */
export const UNLEARN_MAX_ATTEMPTS = 5;
export const UNLEARN_RETRY_BASE_MS = 60_000;

/** Unlearn: "wipe this from the brain." Revoke → confirmed erasure from the RAG. */
export const revokeSource = mutation({
  args: { sourceId: v.id("brainSources"), reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const admin = await assertAdmin(ctx);
    const s = await ctx.db.get(args.sourceId);
    if (!s) throw new Error("Source not found");
    if (s.status === "revoked") {
      // Idempotent. A second revoke never writes a second `revoke` row. A
      // retained `ragEntryId` on a revoked row is failure evidence, and it
      // doubles as the remediation handle: retry deletion against it.
      // Phase E (E2a): it also withdraws feedback a revoke before E2a left.
      await withdrawSourceFeedback(ctx, args.sourceId);
      if (s.ragEntryId) {
        await ctx.scheduler.runAfter(0, internal.brain.unlearnSource, {
          ragEntryId: s.ragEntryId,
          sourceId: args.sourceId,
        });
      }
      return;
    }
    await patchBrainSource(ctx, s, { status: "revoked", revokedFromStatus: s.status });
    await ctx.db.insert("brainAuditLog", {
      action: "revoke",
      sourceId: args.sourceId,
      actorId: admin,
      reason: args.reason,
      at: Date.now(),
    });
    // Phase E (E2a): the lessons drawn from it are withdrawn, and a
    // published set that drew on them is turned off.
    await withdrawSourceFeedback(ctx, args.sourceId);
    if (s.ragEntryId) {
      await ctx.scheduler.runAfter(0, internal.brain.unlearnSource, {
        ragEntryId: s.ragEntryId,
        sourceId: args.sourceId,
      });
      return;
    }
    // Never embedded (or already erased): there is nothing remote to confirm,
    // so the erasure is confirmed by construction — record it here.
    await ctx.db.insert("brainAuditLog", {
      action: "unlearn_confirmed",
      sourceId: args.sourceId,
      actorId: "system",
      reason: "No RAG entry to erase",
      at: Date.now(),
    });
  },
});

/**
 * Confirmed erasure + governance bookkeeping. The single path for BOTH
 * revoke-time unlearn and late-embed compensation: each reduces to "erase, then
 * record", differing only in whether `ragEntryId` was already on the row.
 *
 * Deleting from the RAG needs an action (component delete runs in actions), and
 * bookkeeping must be transactional, hence the two internal mutations below.
 *
 * `sourceId` is optional: `removeSourcePermanently` (row is gone) and
 * `requeueAllApprovedEmbeds` (entry is about to be replaced) want deletion with
 * no governance bookkeeping at all.
 */
export const unlearnSource = internalAction({
  args: {
    ragEntryId: v.string(),
    sourceId: v.optional(v.id("brainSources")),
    attempt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const attempt = args.attempt ?? 1;
    try {
      await eraseBrainEntry(ctx, args.ragEntryId);
    } catch (err) {
      await ctx.runMutation(internal.brain.recordUnlearnFailure, {
        ragEntryId: args.ragEntryId,
        ...(args.sourceId ? { sourceId: args.sourceId } : {}),
        attempt,
        error: err instanceof Error ? err.message : String(err),
      });
      // Surfaced to the caller: an unconfirmed erasure must never look like a
      // success. `ragEntryId` stays as the un-erased remote id (evidence).
      throw err;
    }
    await ctx.runMutation(internal.brain.recordUnlearnConfirmed, {
      ragEntryId: args.ragEntryId,
      ...(args.sourceId ? { sourceId: args.sourceId } : {}),
    });
  },
});

// Persisted compatibility contract: historical audit rows use this exact text.
function unlearnConfirmationReason(ragEntryId: string): string {
  return `Erasure confirmed for entry ${ragEntryId}`;
}

/** Existing audit evidence is the durable source/entry fence, including old rows. */
async function hasUnlearnConfirmation(
  ctx: MutationCtx,
  sourceId: Id<"brainSources">,
  ragEntryId: string,
): Promise<boolean> {
  const reason = unlearnConfirmationReason(ragEntryId);
  for await (const row of ctx.db
    .query("brainAuditLog")
    .withIndex("by_source", (q) => q.eq("sourceId", sourceId))) {
    if (row.action === "unlearn_confirmed" && row.reason === reason) return true;
  }
  return false;
}

/**
 * Success bookkeeping. Clears `ragEntryId` ONLY if it still equals the erased
 * id (a re-ingest may have written a newer one) and writes the single
 * `unlearn_confirmed` row. Guarded on a still-existing, still-non-approved row
 * so it can never resurrect a deleted source or contradict a re-approval.
 */
export const recordUnlearnConfirmed = internalMutation({
  args: {
    ragEntryId: v.string(),
    sourceId: v.optional(v.id("brainSources")),
  },
  handler: async (ctx, args) => {
    if (!args.sourceId) return;
    const s = await ctx.db.get(args.sourceId);
    if (!s || s.status === "approved") return;
    if (s.ragEntryId === args.ragEntryId) {
      await patchBrainSource(ctx, s, { ragEntryId: undefined });
    }
    if (await hasUnlearnConfirmation(ctx, args.sourceId, args.ragEntryId)) return;
    await ctx.db.insert("brainAuditLog", {
      action: "unlearn_confirmed",
      sourceId: args.sourceId,
      actorId: "system",
      reason: unlearnConfirmationReason(args.ragEntryId),
      at: Date.now(),
    });
  },
});

/**
 * Failure bookkeeping. Keeps the un-erased remote id on the row as evidence
 * (and as the remediation handle), records `unlearn_failed`, and schedules the
 * next deletion-only attempt while under the cap.
 */
export const recordUnlearnFailure = internalMutation({
  args: {
    ragEntryId: v.string(),
    sourceId: v.optional(v.id("brainSources")),
    attempt: v.number(),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    if (args.sourceId) {
      // A concurrent attempt may have confirmed erasure before this failure
      // arrived. Never restore its handle, log a stale failure, or retry it.
      if (await hasUnlearnConfirmation(ctx, args.sourceId, args.ragEntryId)) return;
      const s = await ctx.db.get(args.sourceId);
      if (s && s.status !== "approved") {
        if (!s.ragEntryId) {
          await patchBrainSource(ctx, s, { ragEntryId: args.ragEntryId });
        }
        await ctx.db.insert("brainAuditLog", {
          action: "unlearn_failed",
          sourceId: args.sourceId,
          actorId: "system",
          reason: `Erasure failed for entry ${args.ragEntryId} (attempt ${args.attempt}/${UNLEARN_MAX_ATTEMPTS}): ${args.error}`,
          at: Date.now(),
        });
      }
    }
    if (args.attempt < UNLEARN_MAX_ATTEMPTS) {
      await ctx.scheduler.runAfter(
        UNLEARN_RETRY_BASE_MS * 2 ** (args.attempt - 1),
        internal.brain.unlearnSource,
        {
          ragEntryId: args.ragEntryId,
          ...(args.sourceId ? { sourceId: args.sourceId } : {}),
          attempt: args.attempt + 1,
        }
      );
    }
  },
});

/**
 * The company keys a project's company has had: its own key, its company's
 * key and the keys of the company's other names (renames, merges). An import
 * file whose company key is among them is that company's file.
 */
async function projectCompanyKeys(ctx: QueryCtx, projectId: Id<"projects">): Promise<Set<string>> {
  const keys = new Set<string>();
  const project = await ctx.db.get(projectId);
  if (!project) return keys;
  if (project.dashboardCompanyKey) keys.add(project.dashboardCompanyKey);
  if (project.clientName?.trim()) keys.add(dashboardCompanyKey(project.clientName));
  const client = project.clientId ? await ctx.db.get(project.clientId) : null;
  if (client) {
    keys.add(client.nameKey);
    let others: string[] = client.formerNames ?? [];
    try {
      others = await companyOtherNames(ctx, client);
    } catch {
      // Too many merges to read: the kept history still counts.
    }
    for (const name of others) keys.add(dashboardCompanyKey(name));
  }
  return keys;
}

/**
 * The company keys of a project's company when that company has import
 * files with a Brain source (`ingestionItems.brainSourceId`, set when an
 * import file is approved into the Brain), else null (2026-11-17). One
 * indexed read per key; retrieval fetches extra hits only when it is not null.
 */
export const ownCompanyImports = internalQuery({
  args: { projectId: v.id("projects") },
  returns: v.union(v.null(), v.object({ companyKeys: v.array(v.string()) })),
  handler: async (ctx, args) => {
    const keys = await projectCompanyKeys(ctx, args.projectId);
    for (const key of keys) {
      const linked = await ctx.db
        .query("ingestionItems")
        .withIndex("by_companyKey_and_brainSourceId", (q) =>
          // Every id sorts after "", and a missing id before it.
          q.eq("companyKey", key).gt("brainSourceId", "" as Id<"brainSources">)
        )
        .first();
      if (linked) return { companyKeys: [...keys] };
    }
    return null;
  },
});

/**
 * The most import file links `servableBrainSources` reads for one source. A
 * source with more is left out of the search of any company that has
 * imported PDs in the Brain, since its files cannot all be checked.
 */
export const SERVABLE_SOURCE_LINK_CAP = 20;

/**
 * Whether a source is linked to an import file of a company with these keys
 * (2026-11-17): its first file, every file in `brainSourceImportFiles` (up to
 * SERVABLE_SOURCE_LINK_CAP; more counts as yes), and any of the company's
 * files approved with it (`ingestionItems.brainSourceId`, which also covers a
 * file whose bytes match another company's file, so it has no link row of its
 * own). `itemKeys` caches each file's company key across sources.
 */
async function ownCompanyImport(
  ctx: QueryCtx,
  sourceId: Id<"brainSources">,
  firstItemId: Id<"ingestionItems"> | undefined,
  ownKeys: ReadonlySet<string>,
  itemKeys: Map<Id<"ingestionItems">, string | undefined>
): Promise<boolean> {
  const links = await ctx.db
    .query("brainSourceImportFiles")
    .withIndex("by_sourceId", (q) => q.eq("sourceId", sourceId))
    .take(SERVABLE_SOURCE_LINK_CAP + 1);
  if (links.length > SERVABLE_SOURCE_LINK_CAP) return true;
  const itemIds = new Set(links.map((link) => link.importItemId));
  if (firstItemId) itemIds.add(firstItemId);
  for (const itemId of itemIds) {
    if (!itemKeys.has(itemId)) {
      const item = await ctx.db.get(itemId);
      itemKeys.set(
        itemId,
        item?.companyKey ?? (item?.clientName ? dashboardCompanyKey(item.clientName) : undefined)
      );
    }
    const key = itemKeys.get(itemId);
    if (key !== undefined && ownKeys.has(key)) return true;
  }
  for (const key of ownKeys) {
    const approved = await ctx.db
      .query("ingestionItems")
      .withIndex("by_companyKey_and_brainSourceId", (q) =>
        q.eq("companyKey", key).eq("brainSourceId", sourceId)
      )
      .first();
    if (approved) return true;
  }
  return false;
}

/**
 * Served-result status join (CAP-10 g), since 2026-11-17 by card. A revoked
 * source's RAG entry still carries `approved: true` in its own filter value
 * until deletion succeeds, so retrieval joins each hit's `metadata.sourceId`
 * back to governance and drops anything not currently approved. Ids are
 * normalized: metadata is a plain string and may be stale.
 *
 * The hits retrieval may serve (2026-11-17): the approved sources among
 * `sourceIds`, with each one's current writer tier, leaving out a source
 * linked to any import file of the searching project's company (its
 * `ownCompanyKeys`, from `ownCompanyImports`; those PDs
 * already reach the company's drafts as company files, and the Brain must
 * not hand a company its own PD as a "never copy facts" exemplar).
 *
 * One source can hold several companies' files: two PDs that differ only by
 * the company's name scrub to the same text, so the second import reuses the
 * first one's source. So every file linked to the source counts, not only its
 * first (`ownCompanyImport`).
 *
 * Reads each source's list card, never its text; a source with no card yet
 * (before brain:backfillBrainSourceCards) is read whole, as before.
 */
export const servableBrainSources = internalQuery({
  args: {
    sourceIds: v.array(v.string()),
    ownCompanyKeys: v.optional(v.array(v.string())),
  },
  returns: v.array(v.object({ sourceId: v.string(), writerTier: v.number() })),
  handler: async (ctx, args) => {
    const ownKeys = new Set(args.ownCompanyKeys ?? []);
    const itemKeys = new Map<Id<"ingestionItems">, string | undefined>();
    const servable: { sourceId: string; writerTier: number }[] = [];
    for (const raw of args.sourceIds) {
      const id = ctx.db.normalizeId("brainSources", raw);
      if (!id) continue;
      const card = await ctx.db
        .query("brainSourceCards")
        .withIndex("by_sourceId", (q) => q.eq("sourceId", id))
        .unique();
      const row = card ?? (await ctx.db.get(id));
      if (row?.status !== "approved") continue;
      if (ownKeys.size > 0 && (await ownCompanyImport(ctx, id, row.importItemId, ownKeys, itemKeys))) continue;
      servable.push({ sourceId: raw, writerTier: row.writerTier });
    }
    return servable;
  },
});

/**
 * Change a writer's weight for an entry. Since 2026-11-17 retrieval reads
 * the weight from the source's card and every entry has RAG importance 1,
 * so a source already embedded at 1 is not re-embedded; one whose vectors
 * still carry its old tier is re-embedded once.
 */
export const reweightSource = mutation({
  args: { sourceId: v.id("brainSources"), writerTier: v.number() },
  handler: async (ctx, args) => {
    const admin = await assertAdmin(ctx);
    if (!Number.isFinite(args.writerTier)) throw new Error("Weight must be a number from 0 to 1.");
    const s = await ctx.db.get(args.sourceId);
    if (!s) throw new Error("Source not found");
    const tier = Math.max(0, Math.min(1, args.writerTier));
    // Read before the patch: a source not yet re-embedded at importance 1
    // still has its old tier in its vectors, so it is re-embedded once now.
    const reembed = s.status === "approved" && needsFullImportanceEmbed(s);
    await patchBrainSource(ctx, s, { writerTier: tier });
    await ctx.db.insert("brainAuditLog", {
      action: "reweight",
      sourceId: args.sourceId,
      actorId: admin,
      reason: `writerTier → ${tier}`,
      at: Date.now(),
    });
    if (reembed) await scheduleEmbed(ctx, args.sourceId);
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
      const project = fb.projectId ? await ctx.db.get(fb.projectId) : null;
      // Phase E (E3): feedback on an evaluation project is never nominated.
      if (promotable && !isEvaluationProject(project)) {
        // A revoked match is linked, not reused: the item is withdrawn below.
        const nominated = await importSource(
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
        sourceId = nominated.sourceId;
        // Phase E (E2a): the source this item's lessons come from, so
        // removing it withdraws them (a duplicate links the existing one).
        await ctx.db.patch(args.feedbackId, { brainSourceId: sourceId });
        // A duplicate of a source already revoked is withdrawn at once
        // (review): its lessons were removed with that source.
        const linked = await ctx.db.get(sourceId);
        if (linked?.status === "revoked") {
          const row = await ctx.db.get(args.feedbackId);
          if (row) await withdrawFeedback(ctx, row, sourceId, Date.now());
        }
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

/**
 * Phase E (E2a), one-off, owner-run, dev first: links approved feedback made
 * before E2a to its Brain source through its approval's audit row, and
 * withdraws feedback whose source was already revoked or removed, so the gap
 * before E2a closes too. One page per run; it schedules the next.
 */
export const linkBrainFeedbackSources = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  returns: v.object({ linked: v.number(), withdrawn: v.number(), done: v.boolean() }),
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("brainFeedbackQueue")
      .withIndex("by_status", (q) => q.eq("status", "approved"))
      .paginate({ cursor: args.cursor ?? null, numItems: 100 });
    const now = Date.now();
    let linked = 0;
    let withdrawn = 0;
    for (const row of page.page) {
      let sourceId = row.brainSourceId;
      if (!sourceId) {
        const audits = await ctx.db
          .query("brainAuditLog")
          .withIndex("by_feedbackId", (q) => q.eq("feedbackId", row._id))
          .take(20);
        sourceId = audits.find((audit) => audit.action === "approve" && audit.sourceId)?.sourceId;
        if (sourceId) {
          await ctx.db.patch(row._id, { brainSourceId: sourceId });
          linked += 1;
        }
      }
      if (!sourceId || row.withdrawnAt !== undefined) continue;
      const source = await ctx.db.get(sourceId);
      if ((!source || source.status === "revoked") && (await withdrawFeedback(ctx, row, sourceId, now))) withdrawn += 1;
    }
    if (withdrawn > 0) await turnOffWithdrawnPublishedSet(ctx, now);
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.brain.linkBrainFeedbackSources, { cursor: page.continueCursor });
    }
    return { linked, withdrawn, done: page.isDone };
  },
});

// ─── Admin dashboard reads (reactive) ───────────────────────────────────────

/** One row of the admin list, read from `brainSourceCards` (never a source's text). */
function listRow(card: Doc<"brainSourceCards">) {
  return {
    _id: card.sourceId,
    title: card.title,
    status: card.status,
    kind: card.kind,
    industry: card.industry,
    writerName: card.writerName ?? null,
    writerTier: card.writerTier,
    docType: card.docType,
    craOutcome: card.craOutcome ?? null,
    scienceCode: normalizeCraScienceCode(card.scienceCode) ?? null,
    hasEntry: !!card.ragEntryId,
    createdAt: card.createdAt,
  };
}

/**
 * The admin list, newest first, a page at a time (2026-11-17). It reads only
 * the small list cards, so it never reads a source's text. A signed-out or
 * non-admin caller gets an empty last page.
 */
export const listBrainSources = query({
  args: {
    status: v.optional(
      v.union(v.literal("pending"), v.literal("approved"), v.literal("revoked"))
    ),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    if (!(await adminOrNull(ctx))) {
      const none: ReturnType<typeof listRow>[] = [];
      return { page: none, isDone: true, continueCursor: "" };
    }
    const status = args.status;
    const cards = status
      ? ctx.db
          .query("brainSourceCards")
          .withIndex("by_status_and_createdAt", (q) => q.eq("status", status))
      : ctx.db.query("brainSourceCards").withIndex("by_createdAt");
    const result = await cards.order("desc").paginate(args.paginationOpts);
    return { ...result, page: result.page.map(listRow) };
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

/**
 * Counts for the admin page, from the stored counts (2026-11-17): a few
 * small rows, never a scan of the sources. `byIndustry` counts approved
 * sources only.
 */
export const brainStats = query({
  args: {},
  handler: async (ctx) => {
    if (!(await adminOrNull(ctx))) return null;
    const byStatus: Record<string, number> = {};
    for (const row of await ctx.db
      .query("brainSourceCounts")
      .withIndex("by_scope_and_key", (q) => q.eq("scope", "status"))
      .take(10)) {
      byStatus[row.key] = row.count;
    }
    const byIndustry: Record<string, number> = {};
    for (const row of await ctx.db
      .query("brainSourceCounts")
      .withIndex("by_scope_and_key", (q) => q.eq("scope", "industry"))
      .take(500)) {
      byIndustry[row.key] = row.count;
    }
    return {
      approved: byStatus.approved ?? 0,
      pending: byStatus.pending ?? 0,
      revoked: byStatus.revoked ?? 0,
      byIndustry,
    };
  },
});
