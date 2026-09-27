/**
 * Private New project intake (2026-09-26, decision 65, stage 2; the rules
 * are the tenth amendment in docs/product-domain.md).
 *
 * While the writer sets up a new project, the page saves each transcript
 * and supporting document it has read (and the original file) to a draft
 * only its signed-in creator can see. The draft's Brief is prepared once
 * readable transcript text and the client name exist and edits have
 * settled for 2 seconds (convex/briefPreparations.ts, through the stage 1
 * service, limits and kill switch). Confirming promotes the draft into the
 * real project from the saved sources, with an exact source-key link for
 * each row, so the project's run can adopt the prepared Brief.
 *
 * Nothing here writes a project, a generation, an owner or a workflow
 * stage before promotion, and promotion writes the project exactly as
 * `createProject` does (`insertNewProject`). A draft expires 24 hours after
 * its last edit and 7 days after it was made; Discard, expiry and
 * promotion fence its pending work, and its content is purged in bounded
 * batches.
 */
import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { domainError } from "./lib/contracts";
import { sha256 } from "./lib/contracts";
import { requireCapability } from "./lib/roleCapabilities";
import { getCurrentUserOrNull } from "./lib/auth";
import { briefPreparationEnabled } from "./appSettings";
import { transcriptSourceFormatValidator, transcriptSpeakerRoleValidator } from "./lib/transcriptValidators";
import {
  MAX_EXCLUDED_SOURCE_KEYS,
  MAX_INTAKE_DOCUMENT_CHARS,
  MAX_INTAKE_DOCUMENTS,
  MAX_OPEN_DRAFTS_PER_USER,
  INTAKE_SPEAKER_SAMPLE_TURNS,
  buildIntakeStructure,
  draftExpiresAt,
  draftPlaceholderMap,
  listDraftSources,
  listIntakeSpeakers,
  parseIntakeTurns,
  requestIntakePreparation,
  requireOwnDraft,
  requireSourceKey,
  touchDraft,
} from "./lib/intakeDrafts";
import {
  MAX_TOTAL_TRANSCRIPT_CHARS,
  MAX_TRANSCRIPTS_PER_PROJECT,
  newStructureBuildId,
  requireTranscriptTextWithinCap,
} from "./lib/transcripts";
import { buildStructureStep } from "./lib/transcriptStructure";
import { needsModelRole } from "./lib/transcriptSpeakers";
import { getTeamRosterMemberOrNull } from "./lib/teamRoster";
import {
  deleteStorageIfUnreferenced,
  isStorageReferenced,
  requireFreshUpload,
  requireNotClaimedByAnother,
} from "./lib/storage";
import { deriveProcessingStatus } from "../shared/documentStatus";
import { insertNewProject } from "./projects";
import { endPreparation, purgePreparationContent } from "./briefPreparations";
import { MAX_BRIEF_ENTRY_ROWS } from "./lib/generations/brief";
import { MAX_TRANSCRIPT_FILE_BYTES } from "./lib/transcripts";
import { intakeDraftRefs } from "./lib/intakeDraftRefs";

/** Characters one promotion step installs; the rest follow in the next step. */
const PROMOTION_STEP_CHARS = 1_500_000;
/** A transcript this short has its turns built inside the promotion step. */
const INLINE_STRUCTURE_CHARS = 150_000;
/** Rows one purge step deletes. */
const INTAKE_PURGE_ROWS = 200;
/** Drafts one sweep looks at. */
const INTAKE_SWEEP_DRAFTS = 20;
const MAX_LABEL_CHARS = 300;
const MAX_CLIENT_NAME_CHARS = 200;
const MAX_INTERVIEWEES = 50;
const MAX_INTERVIEWEE_CHARS = 120;

const fileTypeValidator = v.union(
  v.literal("txt"),
  v.literal("md"),
  v.literal("pdf"),
  v.literal("docx"),
  v.literal("msg"),
  v.literal("eml"),
  v.literal("xlsx"),
  v.literal("image"),
  v.literal("other")
);

const categoryValidator = v.union(
  v.literal("previous_pd"),
  v.literal("scoping_notes"),
  v.literal("writer_notes"),
  v.literal("background"),
  v.literal("other")
);

/** The signed-in creator: an active internal role with `project.create`. */
async function requireCreator(ctx: MutationCtx): Promise<Doc<"users">> {
  const { user } = await requireCapability(ctx, "project.create");
  return user;
}

/** Ends a draft's preparations that have not produced anything anyone may adopt. */
async function fenceDraftPreparations(
  ctx: MutationCtx,
  draftId: Id<"intakeDrafts">,
  reason: string
): Promise<void> {
  for (const status of ["queued", "running", "ready"] as const) {
    const rows = await ctx.db
      .query("briefPreparations")
      .withIndex("by_intakeDraftId_and_status", (q) => q.eq("intakeDraftId", draftId).eq("status", status))
      .take(20);
    for (const row of rows) {
      // A promoted draft's preparation belongs to its project now.
      if (row.projectId) continue;
      // A running attempt becomes obsolete, as a superseded one does: its
      // late writes are dropped and its call holds the slot until it ends.
      await endPreparation(ctx, row, status === "queued" ? "cancelled" : "obsolete", reason);
    }
  }
}

/**
 * Starts a draft for the signed-in creator. A person may hold a few open
 * drafts (tabs); past that the oldest is discarded.
 */
export const createIntakeDraft = mutation({
  args: {},
  returns: v.id("intakeDrafts"),
  handler: async (ctx): Promise<Id<"intakeDrafts">> => {
    const user = await requireCreator(ctx);
    const open = await ctx.db
      .query("intakeDrafts")
      .withIndex("by_ownerId_and_status", (q) => q.eq("ownerId", user._id).eq("status", "open"))
      .take(MAX_OPEN_DRAFTS_PER_USER + 1);
    const now = Date.now();
    for (const old of open.slice(0, Math.max(0, open.length - MAX_OPEN_DRAFTS_PER_USER + 1))) {
      await closeDraft(ctx, old, "discarded");
    }
    return await ctx.db.insert("intakeDrafts", {
      ownerId: user._id,
      status: "open",
      createdAt: now,
      lastEditedAt: now,
      expiresAt: draftExpiresAt({ createdAt: now }, now),
      transcriptCount: 0,
    });
  },
});

/** Discards or expires an open draft: its work is fenced and its content purged. */
async function closeDraft(ctx: MutationCtx, draft: Doc<"intakeDrafts">, status: "discarded" | "expired") {
  if (draft.status !== "open") return;
  await ctx.db.patch(draft._id, { status, endedAt: Date.now() });
  await fenceDraftPreparations(ctx, draft._id, "draft_closed");
  await ctx.scheduler.runAfter(0, intakeDraftRefs.purgeIntakeDraft, { draftId: draft._id });
}

/** Schedules a draft transcript's turn and speaker build. */
async function scheduleIntakeStructure(ctx: MutationCtx, sourceId: Id<"intakeSources">) {
  await ctx.scheduler.runAfter(0, intakeDraftRefs.buildIntakeSourceStructure, { sourceId });
}

/**
 * Saves one readable transcript or supporting document under its source
 * key, or updates it (a new position, category or text). Transcript text
 * is capped as a project's is; the turn and speaker build starts at once.
 */
export const saveIntakeSource = mutation({
  args: {
    draftId: v.id("intakeDrafts"),
    sourceKey: v.string(),
    kind: v.union(v.literal("transcript"), v.literal("document")),
    position: v.number(),
    label: v.string(),
    content: v.string(),
    sourceFormat: v.optional(transcriptSourceFormatValidator),
    fileType: v.optional(fileTypeValidator),
    category: v.optional(categoryValidator),
    intake: v.optional(v.union(v.literal("file"), v.literal("pasted"))),
    extractionOutcome: v.optional(v.union(v.literal("ok"), v.literal("failed"))),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const user = await requireCreator(ctx);
    const draft = await requireOwnDraft(ctx, user, args.draftId);
    const sourceKey = requireSourceKey(args.sourceKey);
    const label = args.label.trim().slice(0, MAX_LABEL_CHARS);
    if (!label) domainError("INVALID_INPUT", "A file needs a name");
    if (!Number.isFinite(args.position) || args.position < 0) domainError("INVALID_INPUT", "Invalid position");
    if (args.kind === "transcript") {
      if (!args.content.trim()) domainError("INVALID_INPUT", "A transcript needs text");
      requireTranscriptTextWithinCap(args.content);
    } else if (args.content.length > MAX_INTAKE_DOCUMENT_CHARS) {
      domainError("INVALID_INPUT", "This file holds too much text to save");
    }
    const existing = await ctx.db
      .query("intakeSources")
      .withIndex("by_draftId_and_sourceKey", (q) => q.eq("draftId", draft._id).eq("sourceKey", sourceKey))
      .unique();
    if (existing && existing.kind !== args.kind) domainError("INVALID_INPUT", "A source cannot change kind");
    // The caps from the draft's counters: no other source's text is read.
    const transcriptCount = (draft.transcriptCount ?? 0) + (args.kind === "transcript" && !existing ? 1 : 0);
    const transcriptChars =
      (draft.transcriptChars ?? 0) + (args.kind === "transcript" ? args.content.length - (existing?.content.length ?? 0) : 0);
    const documentCount = (draft.documentCount ?? 0) + (args.kind === "document" && !existing ? 1 : 0);
    if (transcriptCount > MAX_TRANSCRIPTS_PER_PROJECT || transcriptChars > MAX_TOTAL_TRANSCRIPT_CHARS) {
      domainError("INVALID_INPUT", "A project takes at most 20 transcripts and 2,000k characters of transcript text");
    }
    if (documentCount > MAX_INTAKE_DOCUMENTS) {
      domainError("INVALID_INPUT", `A new project takes at most ${MAX_INTAKE_DOCUMENTS} supporting documents`);
    }
    const now = Date.now();
    const contentHash = existing?.content === args.content ? existing.contentHash : await sha256(args.content);
    const fields = {
      position: args.position,
      label,
      content: args.content,
      contentHash,
      ...(args.kind === "transcript"
        ? { sourceFormat: args.sourceFormat }
        : {
            fileType: args.fileType ?? "other",
            category: args.category,
            intake: args.intake,
            extractionOutcome: args.extractionOutcome,
            ...(user.role ? { uploaderRole: user.role } : {}),
          }),
      updatedAt: now,
    };
    let sourceId: Id<"intakeSources">;
    const textChanged = !existing || existing.content !== args.content;
    if (existing) {
      sourceId = existing._id;
      if (textChanged && args.kind === "transcript") {
        // New text: the old speakers described other turns.
        for (const row of await listIntakeSpeakers(ctx, existing._id)) await ctx.db.delete(row._id);
      }
      await ctx.db.patch(existing._id, {
        ...fields,
        ...(textChanged ? { parserVersion: undefined, speakerNames: undefined, speakerModel: undefined } : {}),
      });
    } else {
      sourceId = await ctx.db.insert("intakeSources", {
        draftId: draft._id,
        sourceKey,
        kind: args.kind,
        ...fields,
        createdAt: now,
      });
    }
    const touched = await touchDraft(ctx, draft, { transcriptCount, transcriptChars, documentCount });
    if (args.kind === "transcript" && textChanged) await scheduleIntakeStructure(ctx, sourceId);
    await requestIntakePreparation(ctx, touched, "source_saved");
    return null;
  },
});

/** Removes one source (the writer removed the file or transcript). */
export const removeIntakeSource = mutation({
  args: { draftId: v.id("intakeDrafts"), sourceKey: v.string() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const user = await requireCreator(ctx);
    const draft = await requireOwnDraft(ctx, user, args.draftId);
    const source = await ctx.db
      .query("intakeSources")
      .withIndex("by_draftId_and_sourceKey", (q) => q.eq("draftId", draft._id).eq("sourceKey", requireSourceKey(args.sourceKey)))
      .unique();
    if (!source) return null;
    await deleteSource(ctx, source);
    const transcript = source.kind === "transcript";
    const touched = await touchDraft(ctx, draft, {
      transcriptCount: Math.max(0, (draft.transcriptCount ?? 0) - (transcript ? 1 : 0)),
      transcriptChars: Math.max(0, (draft.transcriptChars ?? 0) - (transcript ? source.content.length : 0)),
      documentCount: Math.max(0, (draft.documentCount ?? 0) - (transcript ? 0 : 1)),
      excludedSourceKeys: (draft.excludedSourceKeys ?? []).filter((key) => key !== source.sourceKey),
    });
    await requestIntakePreparation(ctx, touched, "source_removed");
    return null;
  },
});

/** Deletes a source, its speakers and (when nothing else holds it) its original file. */
async function deleteSource(ctx: MutationCtx, source: Doc<"intakeSources">): Promise<void> {
  for (const row of await listIntakeSpeakers(ctx, source._id)) await ctx.db.delete(row._id);
  await ctx.db.delete(source._id);
  if (source.storageId) await deleteStorageIfUnreferenced(ctx, source.storageId);
}

/**
 * Attaches an uploaded original file to a saved source. The file must be a
 * fresh upload nothing holds and no one else claimed. After promotion it
 * goes straight to the project row the source became (an upload still in
 * flight when the writer confirmed), unless that row already has one.
 */
export const attachIntakeOriginal = mutation({
  args: {
    draftId: v.id("intakeDrafts"),
    sourceKey: v.string(),
    storageId: v.id("_storage"),
    mimeType: v.optional(v.string()),
  },
  returns: v.boolean(),
  handler: async (ctx, args): Promise<boolean> => {
    const user = await requireCreator(ctx);
    const draft = await requireOwnDraft(ctx, user, args.draftId, ["open", "promoting", "promoted"]);
    const sourceKey = requireSourceKey(args.sourceKey);
    await requireFreshUpload(ctx, args.storageId);
    if (await isStorageReferenced(ctx, args.storageId)) {
      domainError("INVALID_INPUT", "The uploaded file is already in use. Upload it again.");
    }
    await requireNotClaimedByAnother(ctx, args.storageId, user._id);
    const mimeType = args.mimeType?.slice(0, 200);
    const link = await ctx.db
      .query("intakeSourceLinks")
      .withIndex("by_draftId_and_sourceKey", (q) => q.eq("draftId", draft._id).eq("sourceKey", sourceKey))
      .unique();
    if (link) {
      if (link.transcriptId) {
        const transcript = await ctx.db.get(link.transcriptId);
        const metadata = await ctx.db.system.get("_storage", args.storageId);
        if (transcript && !transcript.originalStorageId && (metadata?.size ?? 0) <= MAX_TRANSCRIPT_FILE_BYTES) {
          await ctx.db.patch(transcript._id, { originalStorageId: args.storageId });
          return true;
        }
      } else if (link.projectDocumentId) {
        const document = await ctx.db.get(link.projectDocumentId);
        if (document && !document.storageId) {
          await ctx.db.patch(document._id, { storageId: args.storageId, ...(mimeType ? { mimeType } : {}) });
          return true;
        }
      }
      await ctx.storage.delete(args.storageId);
      return false;
    }
    if (draft.status !== "open") {
      await ctx.storage.delete(args.storageId);
      return false;
    }
    const source = await ctx.db
      .query("intakeSources")
      .withIndex("by_draftId_and_sourceKey", (q) => q.eq("draftId", draft._id).eq("sourceKey", sourceKey))
      .unique();
    if (!source) {
      await ctx.storage.delete(args.storageId);
      return false;
    }
    if (source.kind === "transcript") {
      const metadata = await ctx.db.system.get("_storage", args.storageId);
      if ((metadata?.size ?? 0) > MAX_TRANSCRIPT_FILE_BYTES) domainError("INVALID_INPUT", "A transcript file can be at most 25 MB");
    }
    const previous = source.storageId;
    await ctx.db.patch(source._id, { storageId: args.storageId, ...(mimeType ? { mimeType } : {}), updatedAt: Date.now() });
    if (previous && previous !== args.storageId) await deleteStorageIfUnreferenced(ctx, previous);
    await touchDraft(ctx, draft);
    return true;
  },
});

/**
 * The names the placeholder map and the speaker rules read, as the project
 * will carry them: the client name, the interviewer and the interviewees.
 * A changed interviewer or interviewee list rebuilds the speakers; the
 * first client name lets the speaker model call and the preparation run.
 */
export const updateIntakeContext = mutation({
  args: {
    draftId: v.id("intakeDrafts"),
    clientName: v.string(),
    interviewerUserId: v.optional(v.id("users")),
    interviewees: v.array(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const user = await requireCreator(ctx);
    const draft = await requireOwnDraft(ctx, user, args.draftId);
    const clientName = args.clientName.trim().slice(0, MAX_CLIENT_NAME_CHARS);
    if (args.interviewees.length > MAX_INTERVIEWEES) domainError("INVALID_INPUT", "Too many interviewees");
    const interviewees = args.interviewees
      .map((name) => name.trim().slice(0, MAX_INTERVIEWEE_CHARS))
      .filter((name) => name.length > 0);
    const interviewerUserId =
      args.interviewerUserId && (await getTeamRosterMemberOrNull(ctx, args.interviewerUserId))
        ? args.interviewerUserId
        : undefined;
    const rolesChanged =
      interviewerUserId !== draft.interviewerUserId ||
      JSON.stringify(interviewees) !== JSON.stringify(draft.interviewees ?? []);
    const firstClientName = !draft.clientName?.trim() && clientName.length > 0;
    const changed = rolesChanged || clientName !== (draft.clientName ?? "");
    if (!changed) return null;
    const touched = await touchDraft(ctx, draft, {
      clientName: clientName || undefined,
      interviewerUserId,
      interviewees: interviewees.length ? interviewees : undefined,
    });
    if (rolesChanged || firstClientName) {
      for (const source of await listDraftSources(ctx, draft._id)) {
        if (source.kind === "transcript") await scheduleIntakeStructure(ctx, source._id);
      }
    }
    await requestIntakePreparation(ctx, touched, "identity_changed");
    return null;
  },
});

/**
 * The start dialog's leave-out list while it is open (decision 56): a
 * matching preparation starts for the files still ticked, without holding
 * up the confirmation.
 */
export const setIntakeSelection = mutation({
  args: { draftId: v.id("intakeDrafts"), excludedSourceKeys: v.array(v.string()) },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const user = await requireCreator(ctx);
    const draft = await requireOwnDraft(ctx, user, args.draftId);
    if (args.excludedSourceKeys.length > MAX_EXCLUDED_SOURCE_KEYS) domainError("INVALID_INPUT", "Too many files to leave out");
    const keys = [...new Set(args.excludedSourceKeys.map(requireSourceKey))].sort();
    const current = [...(draft.excludedSourceKeys ?? [])].sort();
    if (JSON.stringify(keys) === JSON.stringify(current)) return null;
    const touched = await touchDraft(ctx, draft, { excludedSourceKeys: keys.length ? keys : undefined });
    await requestIntakePreparation(ctx, touched, "selection_changed");
    return null;
  },
});

/** Discard: the writer left New project or cancelled. Its work stops and its content goes. */
export const discardIntakeDraft = mutation({
  args: { draftId: v.id("intakeDrafts") },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const user = await getCurrentUserOrNull(ctx);
    if (!user) return null;
    const draft = await ctx.db.get(args.draftId);
    // Someone else's, or already promoted or ended: nothing to do, and
    // nothing said about whether it exists.
    if (!draft || draft.ownerId !== user._id || draft.status !== "open") return null;
    await closeDraft(ctx, draft, "discarded");
    return null;
  },
});

/** The owner's view of a draft: what is saved, never its text. Null for anyone else. */
export const getIntakeDraft = query({
  args: { draftId: v.id("intakeDrafts") },
  returns: v.union(
    v.null(),
    v.object({
      status: v.union(
        v.literal("open"),
        v.literal("promoting"),
        v.literal("promoted"),
        v.literal("discarded"),
        v.literal("expired")
      ),
      projectId: v.union(v.id("projects"), v.null()),
      expiresAt: v.number(),
      sources: v.array(
        v.object({
          sourceKey: v.string(),
          kind: v.union(v.literal("transcript"), v.literal("document")),
          hasOriginal: v.boolean(),
        })
      ),
    })
  ),
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrNull(ctx);
    if (!user || user.isAnonymous === true || !user.role) return null;
    const draft = await ctx.db.get(args.draftId);
    if (!draft || draft.ownerId !== user._id) return null;
    const sources = draft.contentPurgedAt ? [] : await listDraftSources(ctx, draft._id);
    return {
      status: draft.status,
      projectId: draft.projectId ?? null,
      expiresAt: draft.expiresAt,
      sources: sources.map((row) => ({ sourceKey: row.sourceKey, kind: row.kind, hasOriginal: Boolean(row.storageId) })),
    };
  },
});

/**
 * A draft transcript's turn and speaker build, then the model's look at
 * speakers the rules could not place once the client name the call's
 * placeholders hide exists (and preparation is on).
 */
export const buildIntakeSourceStructure = internalMutation({
  args: { sourceId: v.id("intakeSources") },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const source = await ctx.db.get(args.sourceId);
    if (!source || source.kind !== "transcript") return null;
    const draft = await ctx.db.get(source.draftId);
    if (!draft || draft.status !== "open") return null;
    const { needsModel } = await buildIntakeStructure(ctx, draft, source);
    const settled = source.speakerModel === "done" || source.speakerModel === "failed" || source.speakerModel === "pending";
    if (!needsModel) {
      if (source.speakerModel === "needed") await ctx.db.patch(source._id, { speakerModel: undefined });
    } else if (!settled) {
      const canAsk = Boolean(draft.clientName?.trim()) && (await briefPreparationEnabled(ctx));
      await ctx.db.patch(source._id, { speakerModel: canAsk ? "pending" : "needed" });
      if (canAsk) await ctx.scheduler.runAfter(0, internal.ai.condense.classifyIntakeSpeakerRoles, { sourceId: source._id });
    }
    await requestIntakePreparation(ctx, draft, "structure_ready");
    return null;
  },
});

/**
 * What the one speaker-role model call needs for a draft transcript, the
 * way `transcripts.speakerRoleInput` builds it for a project's: each label
 * the rules left below the threshold with up to three of its turns, and
 * the draft's placeholder map.
 */
export const intakeSpeakerRoleInput = internalQuery({
  args: { sourceId: v.id("intakeSources") },
  handler: async (ctx, args) => {
    const source = await ctx.db.get(args.sourceId);
    if (!source || source.speakerModel !== "pending") return null;
    const draft = await ctx.db.get(source.draftId);
    if (!draft || draft.status !== "open" || !draft.clientName?.trim()) return null;
    const rows = await listIntakeSpeakers(ctx, source._id);
    const unplaced = rows.filter((row) => row.roleSource === "heuristic" && needsModelRole(row));
    if (unplaced.length === 0) return null;
    const turns = parseIntakeTurns(source).turns.slice(0, INTAKE_SPEAKER_SAMPLE_TURNS);
    const samples = unplaced.map((row) => ({
      label: row.label,
      lines: turns
        .filter((turn) => turn.speakerLabel === row.label && turn.cleanText.length > 0)
        .sort((a, b) => b.cleanText.length - a.cleanText.length)
        .slice(0, 3)
        .sort((a, b) => a.index - b.index)
        .map((turn) => turn.cleanText.slice(0, 600)),
    }));
    return {
      ownerId: draft.ownerId,
      samples,
      placeholders: await draftPlaceholderMap(ctx, draft, [source], samples.flatMap((sample) => sample.lines)),
    };
  },
});

/**
 * Stores the model's roles on a draft transcript, as
 * `transcripts.recordModelSpeakerRoles` does for a project's: only labels
 * still holding a rule-based role move, and "unknown" changes nothing.
 */
export const recordIntakeSpeakerRoles = internalMutation({
  args: {
    sourceId: v.id("intakeSources"),
    roles: v.array(v.object({ label: v.string(), role: transcriptSpeakerRoleValidator, confidence: v.number() })),
    failed: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const source = await ctx.db.get(args.sourceId);
    if (!source || source.speakerModel !== "pending") return null;
    const draft = await ctx.db.get(source.draftId);
    if (!draft || draft.status !== "open") return null;
    const rows = await listIntakeSpeakers(ctx, source._id);
    for (const answer of args.roles) {
      const row = rows.find((candidate) => candidate.label === answer.label);
      if (!row || row.roleSource !== "heuristic" || answer.role === "unknown") continue;
      await ctx.db.patch(row._id, {
        role: answer.role,
        roleSource: "model",
        confidence: Math.max(0, Math.min(1, answer.confidence)),
      });
    }
    await ctx.db.patch(source._id, { speakerModel: args.failed ? "failed" : "done" });
    await requestIntakePreparation(ctx, draft, "speakers_changed");
    return null;
  },
});

/** The project fields the page confirms with (Write a new PD). */
const newProjectFieldsValidator = v.object({
  title: v.string(),
  sredTitle: v.optional(v.string()),
  clientName: v.string(),
  interviewerUserId: v.optional(v.id("users")),
  interviewees: v.optional(v.array(v.string())),
  tagIds: v.optional(v.array(v.id("tags"))),
  fiscalYearEnd: v.optional(v.number()),
  industry: v.optional(v.string()),
  scienceCode: v.optional(v.string()),
  projectNumber: v.optional(v.string()),
});

const promotionReceiptValidator = v.object({
  projectId: v.id("projects"),
  complete: v.boolean(),
  sources: v.array(
    v.object({
      sourceKey: v.string(),
      kind: v.union(v.literal("transcript"), v.literal("document")),
      transcriptId: v.optional(v.id("transcripts")),
      projectDocumentId: v.optional(v.id("projectDocuments")),
    })
  ),
});

type PromotionReceipt = {
  projectId: Id<"projects">;
  complete: boolean;
  sources: Array<{
    sourceKey: string;
    kind: "transcript" | "document";
    transcriptId?: Id<"transcripts">;
    projectDocumentId?: Id<"projectDocuments">;
  }>;
};

/**
 * Confirm: the draft becomes the project, once. `sourceKeys` is what the
 * page shows, in its order; a source the page no longer has is dropped and
 * one it lists that is not saved is refused (the page then saves it the
 * old way). The project is created as `createProject` creates it, then the
 * saved sources are installed in bounded steps with an exact source-key
 * link each. A repeated confirm, or a crash part way, resumes the same
 * project: the draft holds its project from the first step on. The
 * receipt maps every source key to the project row it became.
 */
export const promoteIntakeDraft = mutation({
  args: {
    draftId: v.id("intakeDrafts"),
    commandId: v.string(),
    sourceKeys: v.array(v.string()),
    project: newProjectFieldsValidator,
  },
  returns: promotionReceiptValidator,
  handler: async (ctx, args): Promise<PromotionReceipt> => {
    const user = await requireCreator(ctx);
    const draft = await requireOwnDraft(ctx, user, args.draftId, ["open", "promoting", "promoted"]);
    if (draft.projectId) return await continuePromotion(ctx, draft._id);
    if (args.commandId.length === 0 || args.commandId.length > 64) domainError("INVALID_INPUT", "Invalid command");
    if (args.sourceKeys.length > MAX_TRANSCRIPTS_PER_PROJECT + MAX_INTAKE_DOCUMENTS) {
      domainError("INVALID_INPUT", "Too many files");
    }
    const keys = args.sourceKeys.map(requireSourceKey);
    if (new Set(keys).size !== keys.length) domainError("INVALID_INPUT", "A file is listed twice");
    const sources = await listDraftSources(ctx, draft._id);
    const byKey = new Map(sources.map((row) => [row.sourceKey, row]));
    for (const key of keys) {
      if (!byKey.has(key)) domainError("INVALID_INPUT", "A file is not saved yet");
    }
    // What the page no longer shows does not become part of the project.
    const wanted = new Set(keys);
    for (const source of sources) if (!wanted.has(source.sourceKey)) await deleteSource(ctx, source);

    const projectId = await insertNewProject(ctx, user, { ...args.project, mode: "generate" });
    await ctx.db.patch(draft._id, {
      status: "promoting",
      projectId,
      promotionCommandId: args.commandId,
      lastEditedAt: Date.now(),
    });
    return await continuePromotion(ctx, draft._id);
  },
});

/** Background resume of a promotion the page did not finish (a closed tab, a crash). */
export const continueIntakePromotion = internalMutation({
  args: { draftId: v.id("intakeDrafts") },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const draft = await ctx.db.get(args.draftId);
    if (!draft || draft.status !== "promoting" || !draft.projectId) return null;
    await continuePromotion(ctx, draft._id);
    return null;
  },
});

function comparePosition(a: Doc<"intakeSources">, b: Doc<"intakeSources">): number {
  if (a.position !== b.position) return a.position - b.position;
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  return a._id < b._id ? -1 : a._id > b._id ? 1 : 0;
}

/**
 * One bounded promotion step: installs the next sources in order (every
 * transcript, then every document, as the preparation froze them) until
 * PROMOTION_STEP_CHARS, then either schedules the next step or finishes.
 */
async function continuePromotion(ctx: MutationCtx, draftId: Id<"intakeDrafts">): Promise<PromotionReceipt> {
  const draft = (await ctx.db.get(draftId))!;
  const projectId = draft.projectId!;
  const receipt = async (complete: boolean): Promise<PromotionReceipt> => {
    const links = await ctx.db
      .query("intakeSourceLinks")
      .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
      .take(MAX_TRANSCRIPTS_PER_PROJECT + MAX_INTAKE_DOCUMENTS + 10);
    return {
      projectId,
      complete,
      sources: links
        .filter((link) => link.draftId === draft._id)
        .map((link) => ({
          sourceKey: link.sourceKey,
          kind: link.kind,
          ...(link.transcriptId ? { transcriptId: link.transcriptId } : {}),
          ...(link.projectDocumentId ? { projectDocumentId: link.projectDocumentId } : {}),
        })),
    };
  };
  if (draft.status === "promoted") return await receipt(true);
  const project = await ctx.db.get(projectId);
  if (!project || project.deletionStartedAt !== undefined) domainError("NOT_FOUND", "Project not found");
  const owner = (await ctx.db.get(draft.ownerId))!;
  const sources = await listDraftSources(ctx, draft._id);
  const transcripts = sources.filter((row) => row.kind === "transcript").sort(comparePosition);
  const documents = sources.filter((row) => row.kind === "document").sort(comparePosition);
  let budget = PROMOTION_STEP_CHARS;
  let installed = 0;
  let pending = false;
  for (const [index, source] of [...transcripts, ...documents].entries()) {
    if (source.transcriptId || source.projectDocumentId) continue;
    if (installed > 0 && source.content.length > budget) {
      pending = true;
      break;
    }
    budget -= source.content.length;
    installed += 1;
    if (source.kind === "transcript") {
      await installTranscript(ctx, draft, projectId, source, index);
    } else {
      await installDocument(ctx, draft, projectId, owner, source);
    }
  }
  if (pending) {
    await ctx.scheduler.runAfter(0, intakeDraftRefs.continueIntakePromotion, { draftId: draft._id });
    return await receipt(false);
  }
  await finishPromotion(ctx, draft, projectId);
  return await receipt(true);
}

/**
 * A draft transcript becomes a project transcript: its text, label, list
 * position, format and original file, and the roles the model placed. Its
 * turns are built right here when it is short enough (the run then finds
 * the same speaker evidence the draft's preparation read), otherwise by
 * the usual scheduled build. The model is asked again only if the draft's
 * own look did not finish.
 */
async function installTranscript(
  ctx: MutationCtx,
  draft: Doc<"intakeDrafts">,
  projectId: Id<"projects">,
  source: Doc<"intakeSources">,
  position: number
): Promise<void> {
  const now = Date.now();
  const transcriptId = await ctx.db.insert("transcripts", {
    projectId,
    content: source.content,
    label: source.label,
    position,
    contentHash: source.contentHash,
    createdAt: now,
    ...(source.sourceFormat ? { sourceFormat: source.sourceFormat } : {}),
    ...(source.storageId ? { originalStorageId: source.storageId } : {}),
  });
  for (const row of await listIntakeSpeakers(ctx, source._id)) {
    if (row.roleSource === "heuristic") continue;
    await ctx.db.insert("transcriptSpeakers", {
      transcriptId,
      projectId,
      label: row.label,
      role: row.role,
      roleSource: row.roleSource,
      confidence: row.confidence,
      turnCount: row.turnCount,
      ...(row.sampleTurnIndex !== undefined ? { sampleTurnIndex: row.sampleTurnIndex } : {}),
    });
  }
  const modelRoles = source.speakerModel !== "done" && source.speakerModel !== undefined;
  if (source.content.length <= INLINE_STRUCTURE_CHARS) {
    const step = await buildStructureStep(ctx, transcriptId, 0, undefined, { modelRoles });
    if (step.kind === "continue") {
      await ctx.scheduler.runAfter(0, internal.transcripts.buildTranscriptStructure, {
        transcriptId,
        fromIndex: step.fromIndex,
        buildId: step.buildId,
        ...(modelRoles ? { modelRoles: true } : {}),
      });
    } else if (step.kind === "done" && step.needsModelRoles && step.modelRoles) {
      await ctx.scheduler.runAfter(0, internal.ai.condense.classifySpeakerRoles, { transcriptId });
    }
  } else {
    await ctx.db.patch(transcriptId, {
      structureBuildId: newStructureBuildId(),
      ...(modelRoles ? { structureModelRoles: true } : {}),
    });
    await ctx.scheduler.runAfter(0, internal.transcripts.buildTranscriptStructure, {
      transcriptId,
      ...(modelRoles ? { modelRoles: true } : {}),
    });
  }
  await ctx.db.insert("intakeSourceLinks", {
    draftId: draft._id,
    projectId,
    sourceKey: source.sourceKey,
    kind: "transcript",
    transcriptId,
    createdAt: now,
  });
  await ctx.db.patch(source._id, { transcriptId });
}

/** A draft document becomes a project file, as `documents.uploadDocument` writes one. */
async function installDocument(
  ctx: MutationCtx,
  draft: Doc<"intakeDrafts">,
  projectId: Id<"projects">,
  owner: Doc<"users">,
  source: Doc<"intakeSources">
): Promise<void> {
  const now = Date.now();
  const derived = deriveProcessingStatus({
    fileName: source.label,
    content: source.content,
    extractionFailed: source.extractionOutcome === "failed",
    intake: source.intake,
  });
  const projectDocumentId = await ctx.db.insert("projectDocuments", {
    projectId,
    fileName: source.label,
    fileType: source.fileType ?? "other",
    content: source.content,
    ...(source.storageId ? { storageId: source.storageId } : {}),
    ...(source.mimeType ? { mimeType: source.mimeType } : {}),
    ...(source.category ? { category: source.category } : {}),
    source: "context_input",
    processingStatus: derived.status,
    processingDetail: derived.detail,
    uploadedBy: owner._id,
    ...(source.uploaderRole ? { uploaderRole: source.uploaderRole } : {}),
    createdAt: now,
  });
  await ctx.db.insert("intakeSourceLinks", {
    draftId: draft._id,
    projectId,
    sourceKey: source.sourceKey,
    kind: "document",
    projectDocumentId,
    createdAt: now,
  });
  await ctx.db.patch(source._id, { projectDocumentId });
}

/**
 * The last promotion step: the draft's live or ready preparations move to
 * the project (their frozen rows now name the project's transcripts and
 * files through the links, so the run's adoption maps them exactly), a
 * queued one ends, and the draft's now redundant content is purged.
 */
async function finishPromotion(ctx: MutationCtx, draft: Doc<"intakeDrafts">, projectId: Id<"projects">) {
  const links = await ctx.db
    .query("intakeSourceLinks")
    .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
    .take(MAX_TRANSCRIPTS_PER_PROJECT + MAX_INTAKE_DOCUMENTS + 10);
  const byKey = new Map(links.filter((link) => link.draftId === draft._id).map((link) => [link.sourceKey, link]));
  for (const status of ["ready", "running"] as const) {
    const rows = await ctx.db
      .query("briefPreparations")
      .withIndex("by_intakeDraftId_and_status", (q) => q.eq("intakeDraftId", draft._id).eq("status", status))
      .take(10);
    for (const row of rows) {
      if (row.projectId) continue;
      await ctx.db.patch(row._id, { projectId });
      const frozen = await ctx.db
        .query("briefPreparationSources")
        .withIndex("by_preparationId", (q) => q.eq("preparationId", row._id))
        .take(200);
      for (const source of frozen) {
        const link = source.sourceKey ? byKey.get(source.sourceKey) : undefined;
        await ctx.db.patch(source._id, {
          projectId,
          ...(link?.transcriptId ? { transcriptId: link.transcriptId } : {}),
          ...(link?.projectDocumentId ? { projectDocumentId: link.projectDocumentId } : {}),
        });
      }
      const entries = await ctx.db
        .query("briefPreparationEntries")
        .withIndex("by_preparationId", (q) => q.eq("preparationId", row._id))
        .take(MAX_BRIEF_ENTRY_ROWS + 1);
      for (const entry of entries) await ctx.db.patch(entry._id, { projectId });
      const facts = await ctx.db
        .query("briefPreparationFacts")
        .withIndex("by_preparationId_and_attemptId_and_seq", (q) => q.eq("preparationId", row._id))
        .take(500);
      for (const fact of facts) await ctx.db.patch(fact._id, { projectId });
    }
  }
  const queued = await ctx.db
    .query("briefPreparations")
    .withIndex("by_intakeDraftId_and_status", (q) => q.eq("intakeDraftId", draft._id).eq("status", "queued"))
    .take(10);
  for (const row of queued) await endPreparation(ctx, row, "cancelled", "promoted");
  const now = Date.now();
  await ctx.db.patch(draft._id, { status: "promoted", promotedAt: now, endedAt: now });
  await ctx.scheduler.runAfter(0, intakeDraftRefs.purgeIntakeDraft, { draftId: draft._id });
}

/**
 * Deletes a closed draft's content in bounded batches: speaker rows,
 * sources (with an original file nothing else holds: a promoted draft's
 * files belong to the project now and stay), the content of its
 * preparations that did not move to a project, and the names on the
 * draft. The draft row stays, content-free.
 */
export const purgeIntakeDraft = internalMutation({
  args: { draftId: v.id("intakeDrafts") },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const draft = await ctx.db.get(args.draftId);
    if (!draft || draft.status === "open" || draft.status === "promoting" || draft.contentPurgedAt) return null;
    if (draft.status !== "promoted") await fenceDraftPreparations(ctx, draft._id, "draft_closed");
    let budget = INTAKE_PURGE_ROWS;
    const speakers = await ctx.db
      .query("intakeSourceSpeakers")
      .withIndex("by_draftId", (q) => q.eq("draftId", draft._id))
      .take(budget);
    for (const row of speakers) await ctx.db.delete(row._id);
    budget -= speakers.length;
    if (budget > 0) {
      const sources = await ctx.db
        .query("intakeSources")
        .withIndex("by_draftId_and_position", (q) => q.eq("draftId", draft._id))
        .take(Math.min(budget, 20));
      for (const source of sources) await deleteSource(ctx, source);
      budget -= sources.length;
    }
    if (budget > 0) {
      const preparations = await ctx.db
        .query("briefPreparations")
        .withIndex("by_intakeDraftId", (q) => q.eq("intakeDraftId", draft._id))
        .take(50);
      for (const preparation of preparations) {
        if (budget <= 0) break;
        if (preparation.projectId || preparation.contentPurgedAt) continue;
        if (preparation.status === "queued" || preparation.status === "running") continue;
        const done = await purgePreparationContent(ctx, preparation, budget);
        budget -= Math.max(1, done.deleted);
      }
    }
    if (budget > 0) {
      const leftover =
        (await ctx.db.query("intakeSourceSpeakers").withIndex("by_draftId", (q) => q.eq("draftId", draft._id)).first()) ??
        (await ctx.db
          .query("intakeSources")
          .withIndex("by_draftId_and_position", (q) => q.eq("draftId", draft._id))
          .first());
      const preparationLeft = (
        await ctx.db
          .query("briefPreparations")
          .withIndex("by_intakeDraftId", (q) => q.eq("intakeDraftId", draft._id))
          .take(50)
      ).some(
        (row) =>
          !row.projectId &&
          !row.contentPurgedAt &&
          (row.status === "ready" || row.status === "failed" || row.status === "obsolete" || row.status === "cancelled")
      );
      if (!leftover && !preparationLeft) {
        await ctx.db.patch(draft._id, {
          contentPurgedAt: Date.now(),
          clientName: undefined,
          interviewerUserId: undefined,
          interviewees: undefined,
          excludedSourceKeys: undefined,
        });
        return null;
      }
    }
    await ctx.scheduler.runAfter(0, intakeDraftRefs.purgeIntakeDraft, { draftId: draft._id });
    return null;
  },
});

/**
 * Every 15 minutes: open drafts past their expiry are expired (their work
 * fenced) and every closed draft whose content is not yet purged gets its
 * purge, so expired content is gone within the hour.
 */
export const sweepIntakeDrafts = internalMutation({
  args: {},
  returns: v.object({ expired: v.number(), purging: v.number() }),
  handler: async (ctx): Promise<{ expired: number; purging: number }> => {
    const now = Date.now();
    const due = await ctx.db
      .query("intakeDrafts")
      .withIndex("by_status_and_expiresAt", (q) => q.eq("status", "open").lte("expiresAt", now))
      .take(INTAKE_SWEEP_DRAFTS);
    for (const draft of due) await closeDraft(ctx, draft, "expired");
    let purging = 0;
    for (const status of ["expired", "discarded", "promoted"] as const) {
      const rows = await ctx.db
        .query("intakeDrafts")
        .withIndex("by_status_and_contentPurgedAt", (q) => q.eq("status", status).eq("contentPurgedAt", undefined))
        .take(INTAKE_SWEEP_DRAFTS);
      for (const draft of rows) {
        await ctx.scheduler.runAfter(0, intakeDraftRefs.purgeIntakeDraft, { draftId: draft._id });
        purging += 1;
      }
    }
    if (due.length === INTAKE_SWEEP_DRAFTS) await ctx.scheduler.runAfter(0, intakeDraftRefs.sweepIntakeDrafts, {});
    return { expired: due.length, purging };
  },
});
