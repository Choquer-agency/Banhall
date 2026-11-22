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
  BRAIN_INDEX_FIELDS,
  BRAIN_SEARCH_RAGS,
  type BrainEntryMetadata,
  countKeys,
  deleteBrainSource,
  deleteKeptChunkNotes,
  entryIdIn,
  entryIsCurrent,
  heldEntries,
  INDEX_WRITE_LEASE_MS,
  needsFullImportanceEmbed,
  readBrainIndexState,
  vBrainIndexId,
  deleteSourceImportLinksPage,
  insertBrainSource,
  linkBrainSourceImportFile,
  patchBrainSource,
  revokedBySendBack,
  sourcesForImportFile,
  syncBrainSourceCard,
  type CountKey,
} from "./ai/brain/rag";
import { BRAIN_RERANK_MODELS, BRAIN_SEARCH_INDEXES, type BrainIndexId } from "./ai/brain/embeddings";
import { rerank } from "ai";
import {
  billedTokens,
  CALIBRATION_OFF_TOPIC_QUERIES,
  floorForPassRate,
  passRate,
  pickSpread,
  probeQueryFrom,
  summarizeScores,
  type ScoreSummary,
} from "../shared/brainCalibration";
import type { WorkId } from "@convex-dev/workpool";
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
import { sha256HexSync } from "./lib/sha256Sync";
import { turnOffWithdrawnPublishedSet, withdrawFeedback, withdrawSourceFeedback } from "./lib/learningWithdrawal";

// Serial embed queue with backoff — Voyage 429s on parallel bursts (the 10-PD
// seed lost 7/10 jobs at maxParallelism ∞). Bulk imports (BNH-17's ~500) drain
// safely through here instead of hammering the embeddings API.
const embedPool = new Workpool(components.embedPool, {
  maxParallelism: 1,
  retryActionsByDefault: true,
  defaultRetryBehavior: { maxAttempts: 6, initialBackoffMs: 15000, base: 2 },
});

/**
 * Queue a source for embedding (used by import/approve/reweight). The embed
 * adds to every written index (only `indexes`, when given) whose entry is
 * not current, or to each of them with `force` (2026-11-18 (fourth);
 * `embedTargets`, ingest.ts).
 */
async function scheduleEmbed(
  ctx: MutationCtx,
  sourceId: Id<"brainSources">,
  options: { indexes?: BrainIndexId[]; force?: boolean } = {}
): Promise<WorkId> {
  requireBrainConfigured();
  return await embedPool.enqueueAction(ctx, internal.ai.brain.ingest.embedSource, {
    sourceId,
    ...(options.indexes ? { indexes: options.indexes } : {}),
    ...(options.force ? { force: true } : {}),
  });
}

/** Schedule the confirmed erasure of every entry a source holds, in both indexes. */
async function scheduleUnlearnAll(
  ctx: MutationCtx,
  s: Doc<"brainSources">,
  withSource: boolean
): Promise<number> {
  const held = heldEntries(s);
  for (const { index, entryId } of held) {
    await ctx.scheduler.runAfter(0, internal.brain.unlearnSource, {
      ragEntryId: entryId,
      ...(withSource ? { sourceId: s._id } : {}),
      index,
    });
  }
  return held.length;
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

/**
 * Legacy 32-bit FNV-1a fingerprint used by Brain sources written before the
 * SHA-256 upgrade. Kept only so `findImportMatch` still finds older rows when
 * paired with an exact `row.content === content` check.
 */
export function legacyContentHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${(h >>> 0).toString(16).padStart(8, "0")}-${s.length}`;
}

/** Stable collision-resistant content fingerprint for dedup (V8-safe SHA-256). */
export function contentHash(s: string): string {
  return sha256HexSync(s);
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
  /**
   * 2026-11-17 (Send back to review): the Import's Brain check passes true,
   * so a source revoked by Send back neither blocks nor is reused: the copy
   * a person just read becomes a new row (approved, with its own RAG key).
   * Every other caller still refuses any revoked match.
   */
  supersedeSentBack?: boolean;
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

/** The most sources one import file can be the first file of (one, besides Send back's). */
const IMPORT_FILE_SOURCES = 50;

/**
 * The most sources read for one text hash, and the most RAG keys tried for
 * one: one source per text, besides the ones Send back revoked before a new
 * copy. Past it, something is wrong, so it fails loudly.
 */
const TEXT_HASH_SOURCES = 50;

/**
 * The existing source an import matches: by the bytes of any import file
 * linked to a source first, then by the source's own first file, then by
 * text (the oldest match, as before). A source revoked by Send back to
 * review (2026-11-17) is passed over when another source has the same bytes
 * or text (the new copy its Brain check made), so every path finds that
 * one; with `skipSentBack` (the Import's Brain check) it is passed over even
 * when nothing else matches.
 */
export async function findImportMatch(
  ctx: MutationCtx,
  textHash: string,
  importContentHash: string | undefined,
  options: { skipSentBack?: boolean; content?: string } = {}
): Promise<Doc<"brainSources"> | null> {
  let sentBack: Doc<"brainSources"> | null = null;
  const consider = (row: Doc<"brainSources">): Doc<"brainSources"> | null => {
    if (!revokedBySendBack(row)) return row;
    sentBack ??= row;
    return null;
  };
  if (importContentHash) {
    for (const linked of await sourcesForImportFile(ctx, importContentHash)) {
      const found = consider(linked);
      if (found) return found;
    }
    // A source whose first file has no link row yet. A source's first file is
    // unique to it (a second file with those bytes always matches it here),
    // so two rows that Send back did not revoke is broken data and fails loudly.
    const byFile = await ctx.db
      .query("brainSources")
      .withIndex("by_importContentHash", (q) => q.eq("importContentHash", importContentHash))
      .take(IMPORT_FILE_SOURCES);
    const current = byFile.filter((row) => !revokedBySendBack(row));
    if (current.length > 1) {
      throw new Error(`Import file hash ${importContentHash} is the first file of ${current.length} Brain sources.`);
    }
    for (const row of byFile) {
      const found = consider(row);
      if (found) return found;
    }
  }
  const hashesToCheck =
    options.content !== undefined
      ? [...new Set([textHash, legacyContentHash(options.content)])]
      : [textHash];
  for (const hash of hashesToCheck) {
    const byText = await ctx.db
      .query("brainSources")
      .withIndex("by_hash", (q) => q.eq("sourceHash", hash))
      .take(TEXT_HASH_SOURCES + 1);
    for (const row of byText.slice(0, TEXT_HASH_SOURCES)) {
      // Never trust a hash alone (especially legacy 32-bit FNV-1a rows):
      // require exact text equality whenever caller supplied content.
      if (options.content !== undefined && row.content !== options.content) continue;
      const found = consider(row);
      if (found) return found;
    }
    if (byText.length > TEXT_HASH_SOURCES) {
      throw new Error(`Text hash ${hash} has more than ${TEXT_HASH_SOURCES} Brain sources, all revoked by Send back.`);
    }
  }
  return options.skipSentBack ? null : sentBack;
}

/**
 * The RAG key of a new source: `<kind>:<text hash>`, as before; when a
 * source revoked by Send back already holds that key (a new copy of the same
 * PD after its Brain check), a key of its own, so the embed's completion
 * (found by key) books against the new source and never the revoked one.
 */
async function newRagKey(ctx: MutationCtx, kind: string, hash: string): Promise<string> {
  const base = `${kind}:${hash}`;
  const taken = await ctx.db
    .query("brainSources")
    .withIndex("by_ragKey", (q) => q.eq("ragKey", base))
    .first();
  if (!taken) return base;
  for (let n = 2; n <= TEXT_HASH_SOURCES + 1; n += 1) {
    const key = `${base}:${n}`;
    const used = await ctx.db
      .query("brainSources")
      .withIndex("by_ragKey", (q) => q.eq("ragKey", key))
      .first();
    if (!used) return key;
  }
  throw new Error(`RAG key ${base} already has ${TEXT_HASH_SOURCES} newer copies.`);
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
  const existing = await findImportMatch(ctx, hash, args.importItem?.contentHash, {
    skipSentBack: args.supersedeSentBack === true,
    content: args.content,
  });
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
    // A science code added to an approved source needs no embed: retrieval
    // reads it from the source's card (servableBrainSources), and the
    // component would keep the entry anyway (same text, importance and filters).
    if (approveNow) await scheduleEmbed(ctx, existing._id);
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
    ragKey: args.supersedeSentBack ? await newRagKey(ctx, kind, hash) : `${kind}:${hash}`,
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
    await scheduleUnlearnAll(ctx, s, false);
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
 *
 * 2026-11-18 (fourth): it rebuilds the voyage3 index only, so after the
 * cutover it can never shrink the index search reads; before it, it shrinks
 * search while it runs, as it always did. It refuses once that index's drop
 * has started. A new model gets a new index and `brain:buildSearchIndex`,
 * which deletes nothing.
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
    if (!(await readBrainIndexState(ctx)).written.includes("voyage3")) {
      throw new Error("The voyage3 index is being dropped; there is nothing to rebuild.");
    }
    const page = await ctx.db
      .query("brainSourceCards")
      .withIndex("by_status_and_createdAt", (q) => q.eq("status", "approved"))
      .paginate({ cursor: args.cursor ?? null, numItems: REQUEUE_PAGE_SIZE });
    for (const card of page.page) {
      if (card.ragEntryId) {
        // Final review P3-3: the confirmed erasure clears the id the row
        // holds (unless the forced embed has already written a newer one),
        // so the pointer's check never passes on an entry that is gone.
        await ctx.scheduler.runAfter(0, internal.brain.unlearnSource, {
          ragEntryId: card.ragEntryId,
          sourceId: card.sourceId,
          index: "voyage3",
          requeued: true,
        });
      }
      await scheduleEmbed(ctx, card.sourceId, { indexes: ["voyage3"], force: true });
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.brain.requeueAllApprovedEmbeds, {
        cursor: page.continueCursor,
      });
    }
    return { requeued: page.page.length, done: page.isDone };
  },
});

// `needsFullImportanceEmbed` moved to rag.ts (the embed action reads it too);
// it describes the voyage3 index only, since every voyage4 entry is at 1.
export { needsFullImportanceEmbed };

/**
 * Whether a reweight or relabel of an approved source should embed it
 * again: its voyage3 vectors may not be at importance 1 (below 1, or none
 * recorded, read from the row before the tier changes), and the
 * voyage3 index is still written (2026-11-18 (fourth): it keeps the
 * rollback index as good as it was; once its drop starts, never).
 */
async function needsImportanceReembed(ctx: MutationCtx, s: Doc<"brainSources">): Promise<boolean> {
  if (s.status !== "approved" || !needsFullImportanceEmbed(s)) return false;
  return (await readBrainIndexState(ctx)).written.includes("voyage3");
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
 *
 * 2026-11-18 (fourth): it renews the voyage3 index only (the importance and
 * the notes it checks are that index's), and refuses once that index's drop
 * has started. When the Voyage 4 change ships with the Import stack it is
 * not run at all: `brain:buildSearchIndex` gives every source a voyage4
 * entry at importance 1 with current notes.
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
    if (!(await readBrainIndexState(ctx)).written.includes("voyage3")) {
      throw new Error("The voyage3 index is being dropped; there is nothing to renew.");
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
      await scheduleEmbed(ctx, card.sourceId, { indexes: ["voyage3"] });
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

// ─── Voyage 4 (2026-11-18 (fourth)): build, cutover, drop ───────────────────
// Two search indexes (convex/ai/brain/embeddings.ts). Owner-run steps 13 to
// 15, 17 and 18 of the Import stack's deploy order, all internal:
//   brain:buildSearchIndex          fill and renew both indexes, deleting nothing
//   brain:calibrateSearchIndexes    score report (steps 14 and 17), records only that it ran
//   brain:setServingSearchIndex     move the pointer (cutover, rollback)
//   brain:dropOldSearchIndex, then brain:deleteOldSearchNamespace   later

/** Approved cards read per step of `buildSearchIndex`. */
export const BUILD_PAGE_SIZE = 50;
/** How long a build step waits before checking its page's embeds again. */
export const BUILD_WAIT_MS = 30_000;
/** Approved cards one call of `setServingSearchIndex` checks at most (small rows). */
export const MOVE_CHECK_BUDGET = 4000;
/** A pointer check older than this starts again from the first card. */
export const MOVE_CHECK_MAX_AGE_MS = 60 * 60_000;

const buildTotals = v.object({
  approved: v.number(),
  present: v.number(),
  queued: v.number(),
  missing: v.number(),
});
type BuildTotals = typeof buildTotals.type;

/** Which index search reads, and whether the old one is still written. */
export const servingSearchIndex = internalQuery({
  args: {},
  returns: v.object({ serving: vBrainIndexId, oldIndexDropped: v.boolean() }),
  handler: async (ctx) => {
    const state = await readBrainIndexState(ctx);
    return { serving: state.serving, oldIndexDropped: !state.written.includes("voyage3") };
  },
});

/** Write the pointer row (made on first use; no row reads as voyage3 serving). */
async function writeIndexState(
  ctx: MutationCtx,
  patch: Partial<Omit<Doc<"brainSearchIndexState">, "_id" | "_creationTime" | "key">>
): Promise<void> {
  const { row } = await readBrainIndexState(ctx);
  if (row) {
    await ctx.db.patch(row._id, patch);
    return;
  }
  const fields = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
  await ctx.db.insert("brainSearchIndexState", {
    key: "search",
    serving: "voyage3",
    changedBy: "system",
    changedAt: Date.now(),
    ...fields,
  });
}

/** Chunk notes are on in this deployment (`BRAIN_CONTEXTUAL`), as the embed reads it. */
function chunkNotesOn(): boolean {
  return process.env.BRAIN_CONTEXTUAL === "1";
}

/** Why a card's entry in one index is not current, in a few plain words. */
function staleReason(card: Doc<"brainSourceCards">, index: BrainIndexId, notesOn: boolean): string {
  if (!entryIdIn(card, index)) return "no entry";
  if (index === "voyage3" && needsFullImportanceEmbed(card)) {
    return card.ragImportance === undefined ? "importance not recorded" : "an old weight's importance";
  }
  if (notesOn && card[BRAIN_INDEX_FIELDS[index].notesVersion] !== BRAIN_CHUNK_NOTES_VERSION) return "notes from an older prompt";
  return "current";
}

/**
 * Steps 13 (and, after review 51, the rollback index's renewal): fill the
 * search indexes. Pages approved cards (never a source's text), 50 a step,
 * and queues one embed for each source whose entry is not current in an
 * index it fills: no entry, notes from an older prompt when chunk notes are
 * on, or (voyage3) an old weight's importance. With no `index` it fills
 * every written index, so one embed renews the voyage3 entry and makes the
 * voyage4 one, with the chunk notes made once for both; with `index`, only
 * that one. It is throttled: a step that queued embeds waits (checking
 * every 30 seconds) until the embed pool has finished them before it reads
 * the next page, so the pool, which runs one embed at a time with retries
 * and backoff on Voyage's 429s, never holds more than one page of it and
 * approvals made meanwhile wait behind at most 50. Once a page's embeds
 * finish it counts any source still not current as missing (its embed
 * failed six times). The last step writes the totals on the pointer row
 * (`lastBuild`) and logs them.
 *
 * One pass runs at a time: the first step writes `buildRunning`, a second
 * start is refused while it is set, and the pointer does not move while it
 * is set. `restart: true` starts again when a pass stopped without its
 * last step (its steps then stop at their next run).
 *
 * It deletes nothing and search keeps reading the serving index throughout.
 * Safe to run again: a pass with nothing to renew costs reads only. With
 * chunk notes on, each queued source pays Haiku per piece once, unless one
 * index already has this prompt version's notes, which are reused.
 * Start it with no arguments; needs `backfillBrainSourceCards` finished first.
 */
export const buildSearchIndex = internalMutation({
  args: {
    index: v.optional(vBrainIndexId),
    restart: v.optional(v.boolean()),
    // Final review P2-1: start although old-page copies of unknown origin
    // are still undecided on /admin/brain.
    allowUnknownOrigin: v.optional(v.boolean()),
    runId: v.optional(v.number()),
    cursor: v.optional(v.union(v.string(), v.null())),
    finished: v.optional(v.boolean()),
    waitFor: v.optional(v.array(v.string())),
    waitSources: v.optional(v.array(v.id("brainSources"))),
    totals: v.optional(buildTotals),
  },
  returns: v.object({
    approved: v.number(),
    present: v.number(),
    queued: v.number(),
    missing: v.number(),
    waiting: v.boolean(),
    done: v.boolean(),
  }),
  handler: async (ctx, args) => {
    if (!(await cardsReady(ctx))) {
      throw new Error(
        "The Brain's list cards are not built yet. Run brain:backfillBrainSourceCards to the end first."
      );
    }
    const state = await readBrainIndexState(ctx);
    if (args.index && !state.written.includes(args.index)) {
      throw new Error(`The ${args.index} index is being dropped; there is nothing to build.`);
    }
    const targets = args.index ? [args.index] : state.written;
    const notesOn = chunkNotesOn();
    const totals: BuildTotals = { ...(args.totals ?? { approved: 0, present: 0, queued: 0, missing: 0 }) };

    let runId = args.runId;
    if (runId === undefined) {
      if (args.allowUnknownOrigin !== true) {
        const undecided = await ctx.db
          .query("brainOldPageCopies")
          .withIndex("by_status_and_outcome", (q) => q.eq("status", "open").eq("outcome", "unknown_origin"))
          .first();
        if (undecided) {
          throw new Error(
            'Brain copies the old-page send back could not trace are still undecided. Keep or remove each on /admin/brain (Old page copies), then start the build, or start it with {"allowUnknownOrigin":true}.'
          );
        }
      }
      const running = state.row?.buildRunning;
      if (running && args.restart !== true) {
        throw new Error(
          `A build pass is already running (started ${new Date(running.startedAt).toISOString()}). Wait until it logs "buildSearchIndex done", or start again with {"restart":true} if it stopped.`
        );
      }
      runId = Date.now();
      await writeIndexState(ctx, { buildRunning: { startedAt: runId, ...(args.index ? { index: args.index } : {}) } });
    } else if (state.row?.buildRunning?.startedAt !== runId) {
      console.log("buildSearchIndex: another pass has started since; this one stops");
      return { ...totals, waiting: false, done: false };
    }
    const isCurrent = (card: Doc<"brainSourceCards">) => targets.every((index) => entryIsCurrent(card, index, notesOn));

    if (args.waitFor && args.waitFor.length > 0) {
      const statuses = await embedPool.statusBatch(ctx, args.waitFor as WorkId[]);
      if (statuses.some((status) => status.state !== "finished")) {
        await ctx.scheduler.runAfter(BUILD_WAIT_MS, internal.brain.buildSearchIndex, { ...args, runId });
        return { ...totals, waiting: true, done: false };
      }
      for (const sourceId of args.waitSources ?? []) {
        const card = await ctx.db
          .query("brainSourceCards")
          .withIndex("by_sourceId", (q) => q.eq("sourceId", sourceId))
          .unique();
        if (card?.status === "approved" && !isCurrent(card)) totals.missing += 1;
      }
    }

    if (!args.finished) {
      const page = await ctx.db
        .query("brainSourceCards")
        .withIndex("by_status_and_createdAt", (q) => q.eq("status", "approved"))
        .paginate({ cursor: args.cursor ?? null, numItems: BUILD_PAGE_SIZE });
      const waitFor: string[] = [];
      const waitSources: Id<"brainSources">[] = [];
      for (const card of page.page) {
        totals.approved += 1;
        if (isCurrent(card)) {
          totals.present += 1;
          continue;
        }
        waitFor.push(await scheduleEmbed(ctx, card.sourceId, args.index ? { indexes: [args.index] } : {}));
        waitSources.push(card.sourceId);
        totals.queued += 1;
      }
      if (waitFor.length > 0 || !page.isDone) {
        await ctx.scheduler.runAfter(waitFor.length > 0 ? BUILD_WAIT_MS : 0, internal.brain.buildSearchIndex, {
          ...(args.index ? { index: args.index } : {}),
          ...(args.allowUnknownOrigin ? { allowUnknownOrigin: true } : {}),
          runId,
          cursor: page.continueCursor,
          finished: page.isDone,
          ...(waitFor.length > 0 ? { waitFor, waitSources } : {}),
          totals,
        });
        return { ...totals, waiting: false, done: false };
      }
    }

    await writeIndexState(ctx, {
      lastBuild: { finishedAt: Date.now(), ...totals, ...(args.index ? { index: args.index } : {}) },
      buildRunning: undefined,
    });
    console.log(
      `buildSearchIndex done (${targets.join(" and ")}): ${totals.approved} approved sources, ${totals.present} already current, ${totals.queued} queued, ${totals.missing} still missing`
    );
    return { ...totals, waiting: false, done: true };
  },
});

/**
 * Step 15 (cutover), and the rollback: point search at an index. Review 51:
 * the guard reads live state, the same for both directions. It refuses
 * while a build pass is running, and checks every approved card: each must
 * have a current entry in the target index (an entry, with this prompt
 * version's notes when chunk notes are on, and for voyage3 importance 1),
 * so a move never shrinks search and the rollback index is as good as the
 * serving one. It stops at the first card that is not current and says
 * which and why. Cards are small, but a call checks at most 4,000; a
 * longer check keeps its place on the pointer row (`moveCheck`) and the
 * call says to run it again, which goes on from there (a place older than
 * an hour starts again). Moving back to voyage3 is refused once its drop
 * has started. `force` skips the check and the build marker, for a
 * deliberate emergency move; the audit row says forced. Each move writes one
 * `switch_index` row in `brainAuditLog`. `actor` names who asked (the CLI
 * carries no identity); it is a label, not an authorization input.
 */
export const setServingSearchIndex = internalMutation({
  args: {
    index: vBrainIndexId,
    actor: v.optional(v.string()),
    reason: v.optional(v.string()),
    force: v.optional(v.boolean()),
  },
  returns: v.object({
    serving: vBrainIndexId,
    changed: v.boolean(),
    checked: v.number(),
    message: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const state = await readBrainIndexState(ctx);
    if (state.serving === args.index) return { serving: state.serving, changed: false, checked: 0 };
    if (!state.written.includes(args.index)) {
      throw new Error(`The ${args.index} index is being dropped, so search cannot move back to it.`);
    }
    const force = args.force === true;
    // PR #51 review (Greptile): the check reads the cards, so before the card
    // backfill has run to its end an empty or partial table would pass.
    if (!force && !(await cardsReady(ctx))) {
      throw new Error(
        "The Brain's list cards are not built yet. Run brain:backfillBrainSourceCards to the end first."
      );
    }
    if (state.row?.buildRunning && !force) {
      throw new Error('A build pass is running. Wait until it logs "buildSearchIndex done", then move the pointer.');
    }
    let checked = 0;
    if (!force) {
      const notesOn = chunkNotesOn();
      const now = Date.now();
      const kept = state.row?.moveCheck;
      const resume = kept && kept.index === args.index && now - kept.startedAt < MOVE_CHECK_MAX_AGE_MS ? kept : null;
      checked = resume?.checked ?? 0;
      // One page a call (Convex allows one paginate per function), at most
      // MOVE_CHECK_BUDGET small cards.
      const page = await ctx.db
        .query("brainSourceCards")
        .withIndex("by_status_and_createdAt", (q) => q.eq("status", "approved"))
        .paginate({ cursor: resume?.cursor ?? null, numItems: MOVE_CHECK_BUDGET });
      for (const card of page.page) {
        checked += 1;
        if (!entryIsCurrent(card, args.index, notesOn)) {
          await writeIndexState(ctx, { moveCheck: undefined });
          const fill = args.index === "voyage4" ? "brain:buildSearchIndex" : `brain:buildSearchIndex with {"index":"${args.index}"}`;
          return {
            serving: state.serving,
            changed: false,
            checked,
            message: `Not moved: approved source ${card.sourceId} has no current ${args.index} entry (${staleReason(card, args.index, notesOn)}). Run ${fill} to the end, then move the pointer again.`,
          };
        }
      }
      if (!page.isDone) {
        await writeIndexState(ctx, {
          moveCheck: { index: args.index, cursor: page.continueCursor, checked, startedAt: resume?.startedAt ?? now },
        });
        return {
          serving: state.serving,
          changed: false,
          checked,
          message: `Not moved yet: checked ${checked} approved sources so far and every one has a current ${args.index} entry. Run this again to check the rest.`,
        };
      }
    }
    // A command-line actor is stored as "cli:<name>", as /admin/brain shows actors.
    const actor = `cli:${args.actor?.trim() || "command line"}`;
    await writeIndexState(ctx, { serving: args.index, servingSince: Date.now(), changedBy: actor, changedAt: Date.now(), moveCheck: undefined });
    const from = BRAIN_SEARCH_INDEXES[state.serving].embeddingModelId;
    const to = BRAIN_SEARCH_INDEXES[args.index].embeddingModelId;
    await ctx.db.insert("brainAuditLog", {
      action: "switch_index",
      actorId: actor,
      reason: `Search moved from ${state.serving} (${from}) to ${args.index} (${to})${force ? ", forced" : ""}${args.reason?.trim() ? `: ${args.reason.trim()}` : ""}`,
      at: Date.now(),
    });
    return { serving: args.index, changed: true, checked };
  },
});

/** Most probe sources one calibration run reads. */
export const CALIBRATION_MAX_PROBES = 40;
/** Fewer probes than this is not a basis for a floor, and does not let the old index's drop go. */
export const CALIBRATION_MIN_PROBES = 20;
/** Approved cards a calibration run picks its probes from (small rows, newest first). */
export const CALIBRATION_CARD_POOL = 400;
/** Hits per probe search, as wide as a served search. */
export const CALIBRATION_SEARCH_LIMIT = 30;
/** Documents per rerank slate, as many as a served rerank. */
export const CALIBRATION_RERANK_SLATE = 12;

/** Probe sources: approved, with an entry in both indexes, spread over industries and science codes. */
export const calibrationProbes = internalQuery({
  args: { limit: v.number() },
  returns: v.object({
    approved: v.number(),
    probes: v.array(v.object({ sourceId: v.id("brainSources"), scienceCode: v.optional(v.string()) })),
  }),
  handler: async (ctx, args) => {
    const approvedRow = await ctx.db
      .query("brainSourceCounts")
      .withIndex("by_scope_and_key", (q) => q.eq("scope", "status").eq("key", "approved"))
      .unique();
    const cards = await ctx.db
      .query("brainSourceCards")
      .withIndex("by_status_and_createdAt", (q) => q.eq("status", "approved"))
      .order("desc")
      .take(CALIBRATION_CARD_POOL);
    const both = cards.filter((card) => card.ragEntryId && card.ragEntryIdV4);
    const probes = pickSpread(both, args.limit, (card) => `${card.industry}|${card.scienceCode ?? ""}`).map((card) => ({
      sourceId: card.sourceId,
      ...(card.scienceCode ? { scienceCode: card.scienceCode } : {}),
    }));
    return { approved: approvedRow?.count ?? 0, probes };
  },
});

/**
 * The one row a calibration run writes (final review P2-2): when it ran,
 * with how many probes, and which index served. `brain:dropOldSearchIndex`
 * waits for a run after the cutover with at least CALIBRATION_MIN_PROBES.
 */
export const recordCalibration = internalMutation({
  args: { probes: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { serving } = await readBrainIndexState(ctx);
    await writeIndexState(ctx, { lastCalibration: { at: Date.now(), probes: args.probes, serving } });
    return null;
  },
});

/** One probe's query, made from its own text (one source read per call, at most 1 MiB). */
export const calibrationProbeQuery = internalQuery({
  args: { sourceId: v.id("brainSources") },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    const source = await ctx.db.get(args.sourceId);
    if (!source || source.status !== "approved") return null;
    return probeQueryFrom(source.content) || null;
  },
});

type CalibrationIndexReport = {
  index: BrainIndexId;
  embeddingModelId: string;
  floor: number;
  ownEntry: ScoreSummary;
  sameScienceCode: ScoreSummary;
  otherScienceCode: ScoreSummary;
  offTopicTop: ScoreSummary;
  passRateAtFloor: number;
};

/**
 * Step 14 of the deploy order: a read-only report that helps set the
 * voyage4 floors before the cutover (owner-run, after `buildSearchIndex`),
 * and again after the first few hundred Brain checks (final review P2-2).
 * It writes one small record that it ran (`lastCalibration` on the pointer
 * row, which the old index's drop waits for) and nothing else: no usage
 * rows, no audit rows. A report on fewer than 20 probes says it is thin.
 *
 * Probes: up to `probes` (default 20, at most 40) approved sources with an
 * entry in both indexes, spread over industries and science codes, each
 * searched with a passage of its own text; plus five fixed off-topic
 * queries. Per index, a vector-only search with no floor, 30 hits: the
 * cosine of the probe's own entry, of other sources with the same science
 * code and with another, and the top cosine of each off-topic query (a
 * voyage3 entry still at an old weight's importance scores its cosine times
 * that weight, as it does when served). Then the floor for voyage4 that lets
 * through the share of hits voyage3's floor lets through today, and how many
 * of the sources voyage3 serves at its floor that floor and the provisional
 * one would drop. For the rerankers: the probe's top 12 voyage3 hits, reranked
 * by both rerank-2.5 and rerank-3, with the same report and floors.
 *
 * Costs query embeddings in both models and rerank tokens in both rerankers
 * (logged as totals). Logs one summary line with numbers only: never a query
 * or a company name.
 */
export const calibrateSearchIndexes = internalAction({
  args: { probes: v.optional(v.number()) },
  handler: async (ctx, args) => {
    requireBrainConfigured();
    const state = await ctx.runQuery(internal.brain.servingSearchIndex, {});
    if (state.oldIndexDropped) throw new Error("The voyage3 index is dropped; there is nothing to compare against.");
    const limit = Math.max(1, Math.min(CALIBRATION_MAX_PROBES, Math.floor(args.probes ?? 20)));
    const picked = await ctx.runQuery(internal.brain.calibrationProbes, { limit });
    const probes: { sourceId: string; scienceCode?: string; query: string }[] = [];
    for (const probe of picked.probes) {
      const query = await ctx.runQuery(internal.brain.calibrationProbeQuery, { sourceId: probe.sourceId });
      if (query) probes.push({ ...probe, query });
    }
    if (probes.length === 0) {
      if (picked.approved === 0) {
        throw new Error(
          "The Brain has no approved source yet, so there is nothing to calibrate. Keep the provisional floors, move the pointer, and run this again after the first few hundred Brain checks."
        );
      }
      throw new Error("No approved source has an entry in both indexes yet. Run brain:buildSearchIndex first.");
    }

    const tokens = { voyage3: 0, voyage4: 0, rerank3: 0, rerank4: 0 };
    type Hit = { sourceId: string | undefined; scienceCode: string | undefined; score: number; text: string };
    const searchHits = async (index: BrainIndexId, query: string): Promise<Hit[]> => {
      const { results, entries, usage } = await BRAIN_SEARCH_RAGS[index].search(ctx, {
        namespace: BRAIN_SEARCH_INDEXES[index].namespace,
        query,
        searchType: "vector",
        limit: CALIBRATION_SEARCH_LIMIT,
      });
      tokens[index] += usage.tokens;
      const byEntry = new Map(entries.map((entry) => [entry.entryId, entry.metadata as BrainEntryMetadata | undefined]));
      // Greptile on #51 (P2): each hit's science code as its source card
      // holds it now, as served search reads it (servableBrainSources). The
      // code saved with the vectors stays as it was when an Admin edits it
      // on Import (no new embed), and the probes are grouped by the card.
      // A hit served search would drop (its source no longer approved) is
      // dropped here too.
      const sourceIds = [
        ...new Set(
          results
            .map((result) => byEntry.get(result.entryId)?.sourceId)
            .filter((id): id is string => typeof id === "string" && id.length > 0)
        ),
      ];
      const cards = new Map(
        sourceIds.length > 0
          ? (await ctx.runQuery(internal.brain.servableBrainSources, { sourceIds })).map((row) => [row.sourceId, row])
          : []
      );
      const hits: Hit[] = [];
      for (const result of results) {
        const sourceId = byEntry.get(result.entryId)?.sourceId;
        const card = sourceId ? cards.get(sourceId) : undefined;
        if (sourceId && !card) continue;
        hits.push({
          sourceId,
          scienceCode: card?.scienceCode,
          score: result.score,
          text: result.content.map((c) => c.text).join("\n"),
        });
      }
      return hits;
    };
    const rerankScores = async (index: BrainIndexId, query: string, documents: string[]) => {
      if (documents.length === 0) return [] as number[];
      const result = await rerank({
        model: BRAIN_RERANK_MODELS[index],
        query,
        documents,
        topN: documents.length,
        // Review 51 (P3-6): an owner-run report; a 429 should not throw away
        // the embeddings already paid for.
        maxRetries: 4,
      });
      tokens[index === "voyage3" ? "rerank3" : "rerank4"] += billedTokens(result.response.body);
      const scores = new Array<number>(documents.length).fill(0);
      for (const ranked of result.ranking) scores[ranked.originalIndex] = ranked.score;
      return scores;
    };

    const indexes: BrainIndexId[] = ["voyage3", "voyage4"];
    const own: Record<BrainIndexId, number[]> = { voyage3: [], voyage4: [] };
    const same: Record<BrainIndexId, number[]> = { voyage3: [], voyage4: [] };
    const other: Record<BrainIndexId, number[]> = { voyage3: [], voyage4: [] };
    const offTop: Record<BrainIndexId, number[]> = { voyage3: [], voyage4: [] };
    const allHits: Record<BrainIndexId, number[]> = { voyage3: [], voyage4: [] };
    // Per probe, each index's best score per source (to count served sources).
    const perProbe: Record<BrainIndexId, Map<string, number>>[] = [];
    const rr = {
      own: { voyage3: [] as number[], voyage4: [] as number[] },
      others: { voyage3: [] as number[], voyage4: [] as number[] },
      offTop: { voyage3: [] as number[], voyage4: [] as number[] },
      pairs: [] as { old: number; next: number }[],
    };

    for (const probe of probes) {
      const best: Record<BrainIndexId, Map<string, number>> = { voyage3: new Map(), voyage4: new Map() };
      let slate: Hit[] = [];
      for (const index of indexes) {
        const hits = await searchHits(index, probe.query);
        if (index === "voyage3") slate = hits.slice(0, CALIBRATION_RERANK_SLATE);
        let ownBest: number | undefined;
        for (const hit of hits) {
          allHits[index].push(hit.score);
          if (!hit.sourceId) continue;
          best[index].set(hit.sourceId, Math.max(best[index].get(hit.sourceId) ?? -1, hit.score));
          if (hit.sourceId === probe.sourceId) ownBest = Math.max(ownBest ?? -1, hit.score);
          else if (probe.scienceCode && hit.scienceCode === probe.scienceCode) same[index].push(hit.score);
          else other[index].push(hit.score);
        }
        if (ownBest !== undefined) own[index].push(ownBest);
      }
      perProbe.push(best);
      const documents = slate.map((hit) => hit.text);
      const oldScores = await rerankScores("voyage3", probe.query, documents);
      const newScores = await rerankScores("voyage4", probe.query, documents);
      slate.forEach((hit, i) => {
        const bucket = hit.sourceId === probe.sourceId ? rr.own : rr.others;
        bucket.voyage3.push(oldScores[i]);
        bucket.voyage4.push(newScores[i]);
        rr.pairs.push({ old: oldScores[i], next: newScores[i] });
      });
    }
    for (const query of CALIBRATION_OFF_TOPIC_QUERIES) {
      let slate: Hit[] = [];
      for (const index of indexes) {
        const hits = await searchHits(index, query);
        if (index === "voyage3") slate = hits.slice(0, CALIBRATION_RERANK_SLATE);
        if (hits.length > 0) offTop[index].push(Math.max(...hits.map((hit) => hit.score)));
      }
      const documents = slate.map((hit) => hit.text);
      const oldScores = await rerankScores("voyage3", query, documents);
      const newScores = await rerankScores("voyage4", query, documents);
      if (oldScores.length > 0) rr.offTop.voyage3.push(Math.max(...oldScores));
      if (newScores.length > 0) rr.offTop.voyage4.push(Math.max(...newScores));
    }

    const oldFloor = BRAIN_SEARCH_INDEXES.voyage3.minVectorSimilarity;
    const provisionalFloor = BRAIN_SEARCH_INDEXES.voyage4.minVectorSimilarity;
    const oldRate = passRate(allHits.voyage3, oldFloor);
    const suggestedFloor = floorForPassRate(allHits.voyage4, oldRate);
    /** Sources voyage3 serves at its floor that voyage4 would not serve at `floor`, over all probes. */
    const dropped = (floor: number | null) => {
      let served = 0;
      let lost = 0;
      for (const best of perProbe) {
        for (const [sourceId, score] of best.voyage3) {
          if (score < oldFloor) continue;
          served += 1;
          if (floor === null || (best.voyage4.get(sourceId) ?? -1) < floor) lost += 1;
        }
      }
      return { served, dropped: lost };
    };
    const report = (index: BrainIndexId): CalibrationIndexReport => ({
      index,
      embeddingModelId: BRAIN_SEARCH_INDEXES[index].embeddingModelId,
      floor: BRAIN_SEARCH_INDEXES[index].minVectorSimilarity,
      ownEntry: summarizeScores(own[index]),
      sameScienceCode: summarizeScores(same[index]),
      otherScienceCode: summarizeScores(other[index]),
      offTopicTop: summarizeScores(offTop[index]),
      passRateAtFloor: Math.round(passRate(allHits[index], BRAIN_SEARCH_INDEXES[index].minVectorSimilarity) * 1000) / 1000,
    });

    const oldRerankFloor = BRAIN_SEARCH_INDEXES.voyage3.rerankRelevanceFloor;
    const provisionalRerankFloor = BRAIN_SEARCH_INDEXES.voyage4.rerankRelevanceFloor;
    const oldRerankAll = rr.pairs.map((pair) => pair.old);
    const newRerankAll = rr.pairs.map((pair) => pair.next);
    const oldRerankRate = passRate(oldRerankAll, oldRerankFloor);
    const suggestedRerankFloor = floorForPassRate(newRerankAll, oldRerankRate);
    const rerankDropped = (floor: number | null) => {
      const served = rr.pairs.filter((pair) => pair.old >= oldRerankFloor);
      return { served: served.length, dropped: served.filter((pair) => floor === null || pair.next < floor).length };
    };

    const result = {
      probes: probes.length,
      // Final review P2-2: a report on fewer probes is not a basis for a floor.
      thin: probes.length < CALIBRATION_MIN_PROBES,
      ...(probes.length < CALIBRATION_MIN_PROBES
        ? {
            note: `Only ${probes.length} probes: not a basis for a floor. Keep the provisional floors and run this again after the first few hundred Brain checks.`,
          }
        : {}),
      offTopicQueries: CALIBRATION_OFF_TOPIC_QUERIES.length,
      search: {
        voyage3: report("voyage3"),
        voyage4: report("voyage4"),
        suggestedVoyage4Floor: suggestedFloor,
        atProvisionalFloor: { floor: provisionalFloor, ...dropped(provisionalFloor) },
        atSuggestedFloor: { floor: suggestedFloor, ...dropped(suggestedFloor) },
      },
      rerank: {
        old: {
          modelId: BRAIN_SEARCH_INDEXES.voyage3.rerankModelId,
          floor: oldRerankFloor,
          ownEntry: summarizeScores(rr.own.voyage3),
          others: summarizeScores(rr.others.voyage3),
          offTopicTop: summarizeScores(rr.offTop.voyage3),
          passRateAtFloor: Math.round(oldRerankRate * 1000) / 1000,
        },
        next: {
          modelId: BRAIN_SEARCH_INDEXES.voyage4.rerankModelId,
          floor: provisionalRerankFloor,
          ownEntry: summarizeScores(rr.own.voyage4),
          others: summarizeScores(rr.others.voyage4),
          offTopicTop: summarizeScores(rr.offTop.voyage4),
          passRateAtFloor: Math.round(passRate(newRerankAll, provisionalRerankFloor) * 1000) / 1000,
        },
        suggestedRerank3Floor: suggestedRerankFloor,
        atProvisionalFloor: { floor: provisionalRerankFloor, ...rerankDropped(provisionalRerankFloor) },
        atSuggestedFloor: { floor: suggestedRerankFloor, ...rerankDropped(suggestedRerankFloor) },
      },
      tokens,
    };
    console.log(
      `calibrateSearchIndexes: ${JSON.stringify({
        probes: result.probes,
        suggestedVoyage4Floor: suggestedFloor,
        suggestedRerank3Floor: suggestedRerankFloor,
        searchDroppedAtProvisional: result.search.atProvisionalFloor.dropped,
        rerankDroppedAtProvisional: result.rerank.atProvisionalFloor.dropped,
        tokens,
      })}`
    );
    // The one write: that this report was made (final review P2-2).
    await ctx.runMutation(internal.brain.recordCalibration, { probes: probes.length });
    return result;
  },
});

/** Cards read per step of `dropOldSearchIndex`. */
export const DROP_PAGE_SIZE = 100;
/** The pause between steps of `dropOldSearchIndex`, so its erasures do not pile up at once. */
export const DROP_STEP_DELAY_MS = 10_000;

/**
 * Step 18, later: drop the voyage3 index, after the second calibration (step 17) and a period of
 * use with voyage4 serving. The first step marks the old index dropped, so
 * from then no embed writes to it and search can no longer move back; then
 * it pages every card (all statuses) and queues the confirmed erasure of
 * each voyage3 entry a source holds, which clears that id once confirmed.
 * Approved sources keep their voyage4 entry. Safe to run again. When its
 * last step logs "done", run `brain:deleteOldSearchNamespace`: it deletes
 * whatever the erasures did not and clears the ids they left (an erasure
 * that fails every attempt logs it). `confirm` must be "drop voyage3".
 */
export const dropOldSearchIndex = internalMutation({
  args: {
    confirm: v.literal("drop voyage3"),
    actor: v.optional(v.string()),
    cursor: v.optional(v.union(v.string(), v.null())),
    queued: v.optional(v.number()),
  },
  returns: v.object({ queued: v.number(), done: v.boolean() }),
  handler: async (ctx, args) => {
    const state = await readBrainIndexState(ctx);
    if (state.serving !== "voyage4") throw new Error("Search still reads the voyage3 index. Move it to voyage4 first.");
    if (!(await cardsReady(ctx))) {
      throw new Error(
        "The Brain's list cards are not built yet. Run brain:backfillBrainSourceCards to the end first."
      );
    }
    if (state.written.includes("voyage3")) {
      // Final review P3-4: not while a build pass runs (its next step would
      // throw and leave its marker set).
      if (state.row?.buildRunning) {
        throw new Error('A build pass is running. Wait until it logs "buildSearchIndex done", then drop the old index.');
      }
      // Final review P2-2: the floors the new index serves with were read
      // again on the PDs it actually serves, after the cutover.
      const calibration = state.row?.lastCalibration;
      const since = state.row?.servingSince ?? 0;
      if (!calibration || calibration.serving !== "voyage4" || calibration.at <= since || calibration.probes < CALIBRATION_MIN_PROBES) {
        throw new Error(
          `Run brain:calibrateSearchIndexes again first: the drop waits for a report made after the cutover, with voyage4 serving and at least ${CALIBRATION_MIN_PROBES} probes, so the floors have been checked on the PDs it serves.`
        );
      }
      const actor = `cli:${args.actor?.trim() || "command line"}`;
      await writeIndexState(ctx, { oldIndexDropped: true, changedBy: actor, changedAt: Date.now() });
      await ctx.db.insert("brainAuditLog", {
        action: "switch_index",
        actorId: actor,
        reason: "The voyage3 index (voyage-3-large) is being dropped; search reads voyage4 and cannot move back",
        at: Date.now(),
      });
    }
    const page = await ctx.db
      .query("brainSourceCards")
      .withIndex("by_createdAt")
      .paginate({ cursor: args.cursor ?? null, numItems: DROP_PAGE_SIZE });
    let queued = args.queued ?? 0;
    for (const card of page.page) {
      if (!card.ragEntryId) continue;
      await ctx.scheduler.runAfter(0, internal.brain.unlearnSource, {
        ragEntryId: card.ragEntryId,
        sourceId: card.sourceId,
        index: "voyage3",
        ...(card.status === "approved" ? { droppedIndex: true } : {}),
      });
      queued += 1;
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(DROP_STEP_DELAY_MS, internal.brain.dropOldSearchIndex, {
        confirm: args.confirm,
        ...(args.actor ? { actor: args.actor } : {}),
        cursor: page.continueCursor,
        queued,
      });
    } else {
      console.log(
        `dropOldSearchIndex done: ${queued} voyage3 entries queued for erasure. Now run brain:deleteOldSearchNamespace (it waits for adds still running).`
      );
    }
    return { queued, done: page.isDone };
  },
});

/** Whether an add to an index started within the last 15 minutes and has not finished. */
export const indexWritesInFlight = internalQuery({
  args: { index: vBrainIndexId },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const since = Date.now() - INDEX_WRITE_LEASE_MS;
    const live = await ctx.db
      .query("brainIndexWrites")
      .withIndex("by_index_and_startedAt", (q) => q.eq("index", args.index).gt("startedAt", since))
      .first();
    return live !== null;
  },
});

/**
 * The last part of step 18: delete every version of the voyage3 namespace
 * name ("brain": today's and any older one an earlier change left
 * replaced) with whatever is still in it (entries no row recorded, older
 * replaced entry versions), through the component's own
 * `deleteNamespaceSync`. It also deletes expired lease rows. Refused until the drop has
 * started, and while an embed is still adding to voyage3 (an add that
 * began before the drop; one would make the namespace again). Then it
 * sweeps every card in pages (`sweepOldIndexIds`) and queues a confirmed
 * erasure for each voyage3 id still recorded, which now finds its entry
 * gone and clears the id, including one whose drop erasure failed every
 * attempt. Safe to run again.
 */
export const deleteOldSearchNamespace = internalAction({
  args: {},
  returns: v.object({ deleted: v.boolean() }),
  handler: async (ctx): Promise<{ deleted: boolean }> => {
    const state = await ctx.runQuery(internal.brain.servingSearchIndex, {});
    if (!state.oldIndexDropped) throw new Error("Run brain:dropOldSearchIndex first.");
    if (await ctx.runQuery(internal.brain.indexWritesInFlight, { index: "voyage3" })) {
      throw new Error("An embed is still adding to the voyage3 index. Run this again in a few minutes.");
    }
    // Final review P3-5: every version of the "brain" name, the one that
    // matches today's model and any older one an earlier change left
    // "replaced", with whatever chunk text it holds. A bounded list: a name
    // has a version per shape change, so a handful.
    const versions = await ctx.runQuery(components.rag.namespaces.listNamespaceVersions, {
      namespace: BRAIN_SEARCH_INDEXES.voyage3.namespace,
      paginationOpts: { cursor: null, numItems: OLD_NAMESPACE_VERSIONS },
    });
    for (const version of versions.page) {
      await ctx.runAction(components.rag.namespaces.deleteNamespaceSync, { namespaceId: version.namespaceId });
    }
    if (!versions.isDone) {
      console.warn(`deleteOldSearchNamespace: more than ${OLD_NAMESPACE_VERSIONS} versions of "brain"; run it again for the rest`);
    }
    console.log(`deleteOldSearchNamespace: ${versions.page.length} versions of the voyage3 namespace deleted; sweeping leftover voyage3 ids`);
    await ctx.runMutation(internal.brain.sweepOldIndexIds, {});
    await ctx.runMutation(internal.brain.sweepExpiredIndexWrites, {});
    return { deleted: versions.page.length > 0 };
  },
});

/** Versions of the "brain" namespace one `deleteOldSearchNamespace` call deletes. */
export const OLD_NAMESPACE_VERSIONS = 20;
/** Expired lease rows one sweep deletes per index. */
export const LEASE_SWEEP_PAGE = 500;

/** Delete lease rows older than an action can run (their adds died); a page per index. */
export const sweepExpiredIndexWrites = internalMutation({
  args: {},
  returns: v.object({ deleted: v.number() }),
  handler: async (ctx) => {
    const before = Date.now() - INDEX_WRITE_LEASE_MS;
    let deleted = 0;
    for (const index of ["voyage3", "voyage4"] as const) {
      const stale = await ctx.db
        .query("brainIndexWrites")
        .withIndex("by_index_and_startedAt", (q) => q.eq("index", index).lt("startedAt", before))
        .take(LEASE_SWEEP_PAGE);
      for (const row of stale) await ctx.db.delete(row._id);
      deleted += stale.length;
    }
    return { deleted };
  },
});

/** Cards read per step of `sweepOldIndexIds`. */
export const SWEEP_PAGE_SIZE = 100;

/**
 * After the voyage3 namespace is deleted: page every card and queue a
 * confirmed erasure for each voyage3 id still recorded. The entry is gone,
 * so each one confirms as already absent and clears the id (an approved
 * source through the drop's rule, any other with its audit row). Logs its
 * total on the last page.
 */
export const sweepOldIndexIds = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())), queued: v.optional(v.number()) },
  returns: v.object({ queued: v.number(), done: v.boolean() }),
  handler: async (ctx, args) => {
    if ((await readBrainIndexState(ctx)).written.includes("voyage3")) {
      throw new Error("Run brain:dropOldSearchIndex first.");
    }
    const page = await ctx.db
      .query("brainSourceCards")
      .withIndex("by_createdAt")
      .paginate({ cursor: args.cursor ?? null, numItems: SWEEP_PAGE_SIZE });
    let queued = args.queued ?? 0;
    for (const card of page.page) {
      if (!card.ragEntryId) continue;
      await ctx.scheduler.runAfter(0, internal.brain.unlearnSource, {
        ragEntryId: card.ragEntryId,
        sourceId: card.sourceId,
        index: "voyage3",
        ...(card.status === "approved" ? { droppedIndex: true } : {}),
      });
      queued += 1;
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.brain.sweepOldIndexIds, { cursor: page.continueCursor, queued });
    } else {
      console.log(`sweepOldIndexIds done: ${queued} leftover voyage3 ids queued to clear`);
    }
    return { queued, done: page.isDone };
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
    const state = await readBrainIndexState(ctx);
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
      // 2026-11-18 (fourth): what each index holds, and which are written.
      ragEntryId: s.ragEntryId,
      ragImportance: s.ragImportance,
      chunkNotesVersion: s.chunkNotesVersion,
      ragEntryIdV4: s.ragEntryIdV4,
      chunkNotesVersionV4: s.chunkNotesVersionV4,
      indexState: { serving: state.serving, written: state.written },
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
    // Only a pending source is approved here (2026-11-17). A revoked one
    // never comes back (a source Send back revoked may already have a newer
    // copy of the same PD beside it), and an approved one stays as it is.
    if (s.status !== "pending") {
      domainError(
        "INVALID_STATE",
        s.status === "approved"
          ? "This source is already in the Brain."
          : "This source was removed from the Brain, so it cannot be approved again."
      );
    }
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
    await revokeBrainSourceRow(ctx, s, admin, args.reason);
  },
});

/**
 * The audited unlearn of one source (revokeSource's body, shared since
 * 2026-11-17 with Send back to review on Import, which passes
 * `sentBackItemId`). The caller checks who may do it.
 */
export async function revokeBrainSourceRow(
  ctx: MutationCtx,
  s: Doc<"brainSources">,
  actor: string,
  reason: string | undefined,
  options: { sentBackItemId?: Id<"ingestionItems"> } = {}
): Promise<void> {
  // Final review: notes an unfinished embed kept are not needed any more,
  // and an old-page copy an Admin was asked about is decided (removed).
  await deleteKeptChunkNotes(ctx, s._id);
  await closeOldPageCopies(ctx, s._id, "removed", actor);
  if (s.status === "revoked") {
    // Idempotent. A second revoke never writes a second `revoke` row. A
    // retained `ragEntryId` on a revoked row is failure evidence, and it
    // doubles as the remediation handle: retry deletion against it.
    // Phase E (E2a): it also withdraws feedback a revoke before E2a left.
    await withdrawSourceFeedback(ctx, s._id);
    await scheduleUnlearnAll(ctx, s, true);
    return;
  }
  await patchBrainSource(ctx, s, {
    status: "revoked",
    revokedFromStatus: s.status,
    ...(options.sentBackItemId ? { sentBackItemId: options.sentBackItemId } : {}),
  });
  await ctx.db.insert("brainAuditLog", {
    action: "revoke",
    sourceId: s._id,
    actorId: actor,
    reason,
    at: Date.now(),
  });
  // Phase E (E2a): the lessons drawn from it are withdrawn, and a
  // published set that drew on them is turned off.
  await withdrawSourceFeedback(ctx, s._id);
  // 2026-11-18 (fourth): an entry in each index the row holds, each erased
  // and confirmed on its own.
  if ((await scheduleUnlearnAll(ctx, s, true)) > 0) return;
  // Never embedded (or already erased): there is nothing remote to confirm,
  // so the erasure is confirmed by construction; record it here.
  await ctx.db.insert("brainAuditLog", {
    action: "unlearn_confirmed",
    sourceId: s._id,
    actorId: "system",
    reason: "No RAG entry to erase",
    at: Date.now(),
  });
}

// ─── Old-page copies an Admin decides (final review of #48 to #51, P2-1) ───

/** Rows one copy can have (one per copy is written, so this is generous). */
const OLD_PAGE_ROWS_PER_SOURCE = 20;
/** Undecided copies /admin/brain lists at once. */
export const OLD_PAGE_COPIES_LISTED = 100;

/** Close a copy's open rows as decided ("removed" by a revoke, or "kept"). */
async function closeOldPageCopies(
  ctx: MutationCtx,
  sourceId: Id<"brainSources">,
  status: "removed" | "kept",
  actor: string
): Promise<number> {
  const rows = await ctx.db
    .query("brainOldPageCopies")
    .withIndex("by_sourceId", (q) => q.eq("sourceId", sourceId))
    .take(OLD_PAGE_ROWS_PER_SOURCE);
  let closed = 0;
  for (const row of rows) {
    if (row.status !== "open") continue;
    await ctx.db.patch(row._id, { status, decidedBy: actor, decidedAt: Date.now() });
    closed += 1;
  }
  return closed;
}

/**
 * Record a copy the old-page job left approved (a real run only), once per
 * copy. A copy that is no longer approved needs no decision. Two old-page
 * files can share one copy: when a later file finds it of unknown origin
 * while its open row still says unlink only, the row is raised to unknown
 * origin, so the build still waits for an Admin to decide it. A row an
 * Admin already decided stays as decided.
 */
export async function recordOldPageCopy(
  ctx: MutationCtx,
  line: { sourceId: Id<"brainSources">; itemId: Id<"ingestionItems">; outcome: "unknown_origin" | "unlink_only"; detail: string }
): Promise<void> {
  const card = await ctx.db
    .query("brainSourceCards")
    .withIndex("by_sourceId", (q) => q.eq("sourceId", line.sourceId))
    .unique();
  if (card && card.status !== "approved") return;
  const known = await ctx.db
    .query("brainOldPageCopies")
    .withIndex("by_sourceId", (q) => q.eq("sourceId", line.sourceId))
    .first();
  if (known) {
    if (known.status === "open" && known.outcome === "unlink_only" && line.outcome === "unknown_origin") {
      await ctx.db.patch(known._id, { outcome: "unknown_origin", detail: line.detail, itemId: line.itemId });
    }
    return;
  }
  await ctx.db.insert("brainOldPageCopies", { ...line, status: "open", recordedAt: Date.now() });
}

/**
 * /admin/brain's Old page copies: the copies still waiting for an Admin's
 * decision, oldest first, at most 100 (and whether more wait), with what the
 * list card shows. Admins only; anyone else gets none.
 */
export const listOldPageCopies = query({
  args: {},
  handler: async (ctx) => {
    if (!(await adminOrNull(ctx))) return null;
    const rows = await ctx.db
      .query("brainOldPageCopies")
      .withIndex("by_status_and_recordedAt", (q) => q.eq("status", "open"))
      .take(OLD_PAGE_COPIES_LISTED + 1);
    const listed = [];
    for (const row of rows.slice(0, OLD_PAGE_COPIES_LISTED)) {
      const card = await ctx.db
        .query("brainSourceCards")
        .withIndex("by_sourceId", (q) => q.eq("sourceId", row.sourceId))
        .unique();
      listed.push({
        _id: row._id,
        sourceId: row.sourceId,
        outcome: row.outcome,
        detail: row.detail,
        title: card?.title ?? null,
        docType: card?.docType ?? null,
        status: card?.status ?? null,
        createdAt: card?.createdAt ?? null,
      });
    }
    return { copies: listed, more: rows.length > OLD_PAGE_COPIES_LISTED };
  },
});

/** Keep an old-page copy in the Brain (Admin only; audited). Removing one is the Brain's own revoke. */
export const keepOldPageCopy = mutation({
  args: { sourceId: v.id("brainSources") },
  handler: async (ctx, args) => {
    const admin = await assertAdmin(ctx);
    const closed = await closeOldPageCopies(ctx, args.sourceId, "kept", admin);
    if (closed === 0) domainError("INVALID_STATE", "This copy is already decided.");
    await ctx.db.insert("brainAuditLog", {
      action: "keep_old_page_copy",
      sourceId: args.sourceId,
      actorId: admin,
      reason: "Kept after the old Import page check",
      at: Date.now(),
    });
  },
});

/** What an edit after approval changes on an imported PD's Brain copy. */
export type ImportedSourceRelabel = { writerName?: string | null; writerTier?: number; scienceCode?: string | null };

/**
 * An imported PD's Brain copy follows an edit made to its Import file after
 * approval (2026-11-17, edit after approval): the writer's name and tier and
 * the science code it stores, its card with them, and one `relabel` audit
 * row naming what changed. The text, title, industry and fiscal year never
 * change here. Retrieval reads the writer's name, the science code and the
 * tier from the card (servableBrainSources), so none of them needs a new
 * embed: the component would keep the old entry anyway, since the text,
 * importance and filters are the same. Only a tier change on a source
 * whose voyage3 vectors may not be at importance 1 (below 1, or none
 * recorded: needsFullImportanceEmbed) is embedded once, as reweightSource
 * does.
 * Returns whether anything changed and whether it is embedded again.
 */
export async function relabelImportedSource(
  ctx: MutationCtx,
  s: Doc<"brainSources">,
  change: ImportedSourceRelabel,
  actor: string,
  // 2026-11-18 (second): the audit row's reason; a writer weight changed on
  // Team says so ("Writer weight changed on Team").
  reason = "Changed on Import after approval"
): Promise<{ changed: boolean; reembed: boolean }> {
  const patch: Partial<Doc<"brainSources">> = {};
  const said: string[] = [];
  if (change.writerName !== undefined) {
    const name = change.writerName?.trim() || undefined;
    if ((s.writerName ?? undefined) !== name) {
      patch.writerName = name;
      said.push(`writer ${s.writerName ?? "none"} → ${name ?? "none"}`);
    }
  }
  if (change.writerTier !== undefined && Number.isFinite(change.writerTier)) {
    const tier = Math.max(0, Math.min(1, change.writerTier));
    if (s.writerTier !== tier) {
      patch.writerTier = tier;
      said.push(`writerTier ${s.writerTier} → ${tier}`);
    }
  }
  if (change.scienceCode !== undefined) {
    const code = normalizeCraScienceCode(change.scienceCode ?? undefined) ?? undefined;
    if ((s.scienceCode ?? undefined) !== code) {
      patch.scienceCode = code;
      said.push(`science code ${s.scienceCode ?? "none"} → ${code ?? "none"}`);
    }
  }
  if (said.length === 0) return { changed: false, reembed: false };
  const reembed = "writerTier" in patch && (await needsImportanceReembed(ctx, s));
  await patchBrainSource(ctx, s, patch);
  await ctx.db.insert("brainAuditLog", {
    action: "relabel",
    sourceId: s._id,
    actorId: actor,
    reason: `${reason}: ${said.join("; ")}`,
    at: Date.now(),
  });
  if (reembed) await scheduleEmbed(ctx, s._id);
  return { changed: true, reembed };
}

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
 *
 * 2026-11-18 (fourth): `index` names the index the entry is in (a job
 * queued before then has none and is voyage3), so a failure keeps the id as
 * evidence in that index's field. `droppedIndex` marks the old index's drop
 * (`dropOldSearchIndex`): the source stays approved and only loses that
 * index's entry. The erase itself needs no index: the component reads and
 * deletes an entry by its id.
 */
const unlearnArgs = {
  ragEntryId: v.string(),
  sourceId: v.optional(v.id("brainSources")),
  attempt: v.optional(v.number()),
  index: v.optional(vBrainIndexId),
  droppedIndex: v.optional(v.boolean()),
  // The full requeue's erasure (final review P3-3): an approved source loses
  // this id once the erasure is confirmed, as with the drop.
  requeued: v.optional(v.boolean()),
};

export const unlearnSource = internalAction({
  args: unlearnArgs,
  handler: async (ctx, args) => {
    const attempt = args.attempt ?? 1;
    const where = {
      ...(args.sourceId ? { sourceId: args.sourceId } : {}),
      ...(args.index ? { index: args.index } : {}),
      ...(args.droppedIndex ? { droppedIndex: true } : {}),
      ...(args.requeued ? { requeued: true } : {}),
    };
    try {
      await eraseBrainEntry(ctx, args.ragEntryId);
    } catch (err) {
      await ctx.runMutation(internal.brain.recordUnlearnFailure, {
        ragEntryId: args.ragEntryId,
        ...where,
        attempt,
        error: err instanceof Error ? err.message : String(err),
      });
      // Surfaced to the caller: an unconfirmed erasure must never look like a
      // success. The entry id stays as the un-erased remote id (evidence).
      throw err;
    }
    await ctx.runMutation(internal.brain.recordUnlearnConfirmed, {
      ragEntryId: args.ragEntryId,
      ...where,
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

/** The entry id fields of a row that hold this id (normally one). */
function fieldsHolding(s: Doc<"brainSources">, ragEntryId: string): Partial<Doc<"brainSources">> {
  const patch: Partial<Doc<"brainSources">> = {};
  for (const { index, entryId } of heldEntries(s)) {
    if (entryId === ragEntryId) patch[BRAIN_INDEX_FIELDS[index].entryId] = undefined;
  }
  return patch;
}

/**
 * Success bookkeeping. Clears the entry id field ONLY if it still equals the
 * erased id (a re-ingest may have written a newer one), in whichever index
 * holds it, and writes the single `unlearn_confirmed` row. Guarded on a
 * still-existing, still-non-approved row so it can never resurrect a deleted
 * source or contradict a re-approval. The one exception is the old index's
 * drop (`droppedIndex`): the source stays approved and loses only that
 * index's entry, with no audit row (the drop logs its own totals).
 */
export const recordUnlearnConfirmed = internalMutation({
  args: {
    ragEntryId: v.string(),
    sourceId: v.optional(v.id("brainSources")),
    index: v.optional(vBrainIndexId),
    droppedIndex: v.optional(v.boolean()),
    requeued: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    if (!args.sourceId) return;
    const s = await ctx.db.get(args.sourceId);
    if (!s) return;
    if (s.status === "approved") {
      if ((args.droppedIndex || args.requeued) && args.index && entryIdIn(s, args.index) === args.ragEntryId) {
        await patchBrainSource(ctx, s, { [BRAIN_INDEX_FIELDS[args.index].entryId]: undefined });
      }
      return;
    }
    const clear = fieldsHolding(s, args.ragEntryId);
    if (Object.keys(clear).length > 0) await patchBrainSource(ctx, s, clear);
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
    index: v.optional(vBrainIndexId),
    droppedIndex: v.optional(v.boolean()),
    requeued: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    if (args.sourceId) {
      // A concurrent attempt may have confirmed erasure before this failure
      // arrived. Never restore its handle, log a stale failure, or retry it.
      if (await hasUnlearnConfirmation(ctx, args.sourceId, args.ragEntryId)) return;
      const s = await ctx.db.get(args.sourceId);
      // A drop's failure leaves the approved row's id as it is (still the
      // handle the drop retries with); it is logged by the retries below.
      if (s && s.status !== "approved") {
        // The evidence goes back in the field of the index the entry is in.
        const field = BRAIN_INDEX_FIELDS[args.index ?? "voyage3"].entryId;
        if (!s[field]) {
          await patchBrainSource(ctx, s, { [field]: args.ragEntryId });
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
          ...(args.index ? { index: args.index } : {}),
          ...(args.droppedIndex ? { droppedIndex: true } : {}),
          ...(args.requeued ? { requeued: true } : {}),
          attempt: args.attempt + 1,
        }
      );
    } else if (args.droppedIndex) {
      // Review 51 (P3-3): the drop's erasure gave up. Its approved row keeps
      // the old id; brain:deleteOldSearchNamespace deletes the entry with the
      // namespace and its sweep clears the id.
      console.error(
        `dropOldSearchIndex: erasing voyage3 entry ${args.ragEntryId} of source ${args.sourceId ?? "none"} failed ${args.attempt} times; brain:deleteOldSearchNamespace will delete it and clear the id`
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
  returns: v.array(
    v.object({
      sourceId: v.string(),
      writerTier: v.number(),
      // 2026-11-17 (edit after approval): the labels retrieval shows, as the
      // source stores them now, so an edit on Import needs no re-embed.
      writerName: v.optional(v.string()),
      scienceCode: v.optional(v.string()),
    })
  ),
  handler: async (ctx, args) => {
    const ownKeys = new Set(args.ownCompanyKeys ?? []);
    const itemKeys = new Map<Id<"ingestionItems">, string | undefined>();
    const servable: { sourceId: string; writerTier: number; writerName?: string; scienceCode?: string }[] = [];
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
      servable.push({
        sourceId: raw,
        writerTier: row.writerTier,
        ...(row.writerName ? { writerName: row.writerName } : {}),
        ...(row.scienceCode ? { scienceCode: row.scienceCode } : {}),
      });
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
    const reembed = await needsImportanceReembed(ctx, s);
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

/**
 * One row of the admin list, read from `brainSourceCards` (never a source's
 * text). `hasEntry`: the source has an entry in the index search reads.
 */
function listRow(card: Doc<"brainSourceCards">, serving: BrainIndexId = "voyage3") {
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
    hasEntry: !!entryIdIn(card, serving),
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
    const { serving } = await readBrainIndexState(ctx);
    return { ...result, page: result.page.map((card) => listRow(card, serving)) };
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
