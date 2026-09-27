/**
 * Private New project intake (2026-09-26, decision 65, stage 2; the rules
 * are the tenth amendment in docs/product-domain.md).
 *
 * While the writer sets up a new project, the page saves each transcript
 * and supporting document it has read (and the original file) to a draft
 * only its signed-in creator can see. The draft's Brief is prepared once
 * readable transcript text and the client name exist, the names have stayed
 * unchanged for 5 seconds and edits have settled for 2 seconds
 * (convex/briefPreparations.ts, through the stage 1 service, limits and
 * kill switch). Confirming promotes the draft into the real project from
 * the saved sources, with an exact source-key link for each row, so the
 * project's run can adopt the prepared Brief.
 *
 * Nothing here writes a project, a generation, an owner or a workflow
 * stage before promotion, and promotion writes the project exactly as
 * `createProject` does (`insertNewProject`). A draft expires 24 hours after
 * its last edit and 7 days after it was made; Discard, expiry and
 * promotion fence its pending work, and its content is purged in bounded
 * batches. Source text lives in `intakeSourceTexts`, so reading a draft's
 * sources never reads their text.
 */
import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { domainError, sha256 } from "./lib/contracts";
import { requireCapability, userMayEditReport } from "./lib/roleCapabilities";
import { getCurrentUserOrNull } from "./lib/auth";
import { briefPreparationEnabled } from "./appSettings";
import { transcriptSourceFormatValidator, transcriptSpeakerRoleValidator } from "./lib/transcriptValidators";
import {
  CLOSED_DRAFT_KEEP_MS,
  INTAKE_SPEAKER_SAMPLE_TURNS,
  MAX_DRAFTS_PER_DAY,
  MAX_EXCLUDED_SOURCE_KEYS,
  MAX_INTAKE_DOCUMENT_CHARS,
  MAX_INTAKE_DOCUMENT_TEXT_CHARS,
  MAX_INTAKE_DOCUMENTS,
  MAX_OPEN_DRAFTS_PER_USER,
  MAX_SOURCE_TEXT_BYTES,
  MAX_SPEAKER_CALLS_PER_DAY,
  buildIntakeStructure,
  deleteSourceText,
  draftExpiresAt,
  draftPlaceholderMap,
  listDraftSources,
  listIntakeSpeakers,
  mergedAway,
  namesSettleAt,
  parseIntakeTurns,
  readSourceText,
  requestIntakePreparation,
  requireOwnDraft,
  requireSourceKey,
  speakerModelKey,
  touchDraft,
  userMayCreateProject,
  writeSourceText,
} from "./lib/intakeDrafts";
import {
  MAX_TOTAL_TRANSCRIPT_CHARS,
  MAX_TRANSCRIPT_FILE_BYTES,
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
  uploadClaimFor,
} from "./lib/storage";
import { deriveProcessingStatus } from "../shared/documentStatus";
import { TRANSCRIPT_PARSER_VERSION } from "../shared/transcriptParse";
import { firmDayNumber } from "../shared/firmTime";
import { insertNewProject } from "./projects";
import { endPreparation, purgePreparationContent } from "./briefPreparations";
import { MAX_BRIEF_ENTRY_ROWS } from "./lib/generations/brief";
import { intakeDraftRefs } from "./lib/intakeDraftRefs";

/** Characters one promotion step installs; the rest follow in the next step. */
const PROMOTION_STEP_CHARS = 1_500_000;
/** A transcript this short has its first turns built inside the promotion step. */
const INLINE_STRUCTURE_CHARS = 150_000;
/** How often a promotion waiting on its transcripts' turn builds looks again. */
const PROMOTION_RECHECK_MS = 1_500;
/**
 * How long promotion waits for the turn builds before it lets the project
 * be used anyway (the run then derives its own Brief if the key misses).
 */
const PROMOTION_STRUCTURE_WAIT_MS = 3 * 60 * 1000;
/** A promotion this old is resumed, or ended, by the sweep. */
const STUCK_PROMOTION_MS = 10 * 60 * 1000;
/**
 * A promotion is never "being set up" forever (review 2026-09-26, P2-A):
 * after this many resumes, or this long after it began, it ends with what
 * was installed and records the rest as not saved.
 */
const MAX_PROMOTION_RESUMES = 5;
const MAX_PROMOTION_MS = 30 * 60 * 1000;
/** An original may still reach a promoted project's row this long after promotion. */
const LATE_ORIGINAL_MS = 60 * 60 * 1000;
/** Rows one purge step deletes. */
const INTAKE_PURGE_ROWS = 200;
/** Drafts one sweep looks at, per kind. */
const INTAKE_SWEEP_DRAFTS = 20;
const MAX_LABEL_CHARS = 300;
const MAX_CLIENT_NAME_CHARS = 200;
const MAX_INTERVIEWEES = 50;
const MAX_INTERVIEWEE_CHARS = 120;
const MAX_LINKS_READ = MAX_TRANSCRIPTS_PER_PROJECT + MAX_INTAKE_DOCUMENTS + 10;

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

/** The caller's counts for today, made when missing. */
async function dailyCounts(ctx: MutationCtx, userId: Id<"users">, now: number): Promise<Doc<"intakeDailyCounts">> {
  const firmDay = firmDayNumber(now);
  const row = await ctx.db
    .query("intakeDailyCounts")
    .withIndex("by_userId_and_firmDay", (q) => q.eq("userId", userId).eq("firmDay", firmDay))
    .unique();
  if (row) return row;
  const id = await ctx.db.insert("intakeDailyCounts", { userId, firmDay, drafts: 0, speakerCalls: 0 });
  return (await ctx.db.get(id))!;
}

/**
 * Ends a draft's preparations that have not produced anything anyone may
 * adopt: a queued one is cancelled; a running or ready one becomes
 * obsolete, so its late writes are dropped and its call holds the slot
 * until it ends, as a superseded attempt does.
 */
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
      await endPreparation(ctx, row, status === "queued" ? "cancelled" : "obsolete", reason);
    }
  }
}

/**
 * Starts a draft for the signed-in creator: at most MAX_DRAFTS_PER_DAY a
 * firm day. A person may hold a few open drafts (tabs); past that the one
 * edited longest ago is discarded.
 */
export const createIntakeDraft = mutation({
  args: {},
  returns: v.id("intakeDrafts"),
  handler: async (ctx): Promise<Id<"intakeDrafts">> => {
    const user = await requireCreator(ctx);
    const now = Date.now();
    const counts = await dailyCounts(ctx, user._id, now);
    if (counts.drafts >= MAX_DRAFTS_PER_DAY) {
      domainError(
        "INTAKE_DRAFT_LIMIT",
        "You have started a lot of new projects today, so files are saved when you start instead."
      );
    }
    await ctx.db.patch(counts._id, { drafts: counts.drafts + 1 });
    const open = await ctx.db
      .query("intakeDrafts")
      .withIndex("by_ownerId_and_status", (q) => q.eq("ownerId", user._id).eq("status", "open"))
      .take(MAX_OPEN_DRAFTS_PER_USER + 1);
    const oldestEditFirst = [...open].sort((a, b) => a.lastEditedAt - b.lastEditedAt);
    for (const old of oldestEditFirst.slice(0, Math.max(0, open.length - MAX_OPEN_DRAFTS_PER_USER + 1))) {
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

/** Discards or expires a draft: its work is fenced and its content purged. */
async function closeDraft(ctx: MutationCtx, draft: Doc<"intakeDrafts">, status: "discarded" | "expired") {
  if (draft.status !== "open" && draft.status !== "promoting") return;
  await ctx.db.patch(draft._id, { status, endedAt: Date.now() });
  await fenceDraftPreparations(ctx, draft._id, "draft_closed");
  await ctx.scheduler.runAfter(0, intakeDraftRefs.purgeIntakeDraft, { draftId: draft._id });
}

/** Schedules a draft transcript's turn and speaker build. */
async function scheduleIntakeStructure(
  ctx: MutationCtx,
  sourceId: Id<"intakeSources">,
  options: { resetModelRoles?: boolean } = {}
) {
  await ctx.scheduler.runAfter(0, intakeDraftRefs.buildIntakeSourceStructure, {
    sourceId,
    ...(options.resetModelRoles ? { resetModelRoles: true } : {}),
  });
}

/**
 * Saves one readable transcript or supporting document under its source
 * key, or updates it (a new position, category or text). Transcript text
 * is capped as a project's is, and all document text at 3,000,000
 * characters; the text goes to chunked rows and the turn and speaker
 * build starts at once.
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
      domainError("INTAKE_TEXT_LIMIT", "This file holds too much text to save in a project.");
    }
    // What does not fit the project row it becomes is refused here, never
    // left to fail at promotion (review 2026-09-26, P2-A).
    if (new TextEncoder().encode(args.content).length > MAX_SOURCE_TEXT_BYTES) {
      domainError(
        "INTAKE_TEXT_LIMIT",
        args.kind === "transcript"
          ? "This transcript holds too much text for one project transcript. Split it into two transcripts."
          : "This file holds too much text to save in a project. Split it or remove some pages."
      );
    }
    const existing = await ctx.db
      .query("intakeSources")
      .withIndex("by_draftId_and_sourceKey", (q) => q.eq("draftId", draft._id).eq("sourceKey", sourceKey))
      .unique();
    if (existing && existing.kind !== args.kind) domainError("INVALID_INPUT", "A source cannot change kind");
    // The caps from the draft's counters: no other source's text is read.
    const previousLength = existing?.contentLength ?? 0;
    const transcriptCount = (draft.transcriptCount ?? 0) + (args.kind === "transcript" && !existing ? 1 : 0);
    const transcriptChars =
      (draft.transcriptChars ?? 0) + (args.kind === "transcript" ? args.content.length - previousLength : 0);
    const documentCount = (draft.documentCount ?? 0) + (args.kind === "document" && !existing ? 1 : 0);
    const documentChars =
      (draft.documentChars ?? 0) + (args.kind === "document" ? args.content.length - previousLength : 0);
    if (transcriptCount > MAX_TRANSCRIPTS_PER_PROJECT || transcriptChars > MAX_TOTAL_TRANSCRIPT_CHARS) {
      domainError("INTAKE_TEXT_LIMIT", "A project takes at most 20 transcripts and 2,000k characters of transcript text.");
    }
    if (documentCount > MAX_INTAKE_DOCUMENTS) {
      domainError("INTAKE_TEXT_LIMIT", `A new project takes at most ${MAX_INTAKE_DOCUMENTS} supporting documents.`);
    }
    if (documentChars > MAX_INTAKE_DOCUMENT_TEXT_CHARS) {
      domainError(
        "INTAKE_TEXT_LIMIT",
        "A new project takes at most 3,000k characters of supporting document text. Remove a file to add this one."
      );
    }
    const now = Date.now();
    const contentHash = await sha256(args.content);
    const textChanged = !existing || existing.contentHash !== contentHash;
    const fields = {
      position: args.position,
      label,
      contentHash,
      contentLength: args.content.length,
      hasText: args.content.trim().length > 0,
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
    let source: { _id: Id<"intakeSources">; draftId: Id<"intakeDrafts"> };
    if (existing) {
      source = existing;
      if (textChanged && args.kind === "transcript") {
        // New text: the old speakers described other turns.
        for (const row of await listIntakeSpeakers(ctx, existing._id)) await ctx.db.delete(row._id);
      }
      await ctx.db.patch(existing._id, {
        ...fields,
        ...(textChanged
          ? { parserVersion: undefined, speakerNames: undefined, speakerModel: undefined, speakerModelKey: undefined }
          : {}),
      });
    } else {
      const id = await ctx.db.insert("intakeSources", {
        draftId: draft._id,
        sourceKey,
        kind: args.kind,
        ...fields,
        createdAt: now,
      });
      source = { _id: id, draftId: draft._id };
    }
    if (textChanged) await writeSourceText(ctx, source, args.content);
    const touched = await touchDraft(ctx, draft, { transcriptCount, transcriptChars, documentCount, documentChars });
    if (args.kind === "transcript" && textChanged) await scheduleIntakeStructure(ctx, source._id);
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
      transcriptChars: Math.max(0, (draft.transcriptChars ?? 0) - (transcript ? source.contentLength : 0)),
      documentCount: Math.max(0, (draft.documentCount ?? 0) - (transcript ? 0 : 1)),
      documentChars: Math.max(0, (draft.documentChars ?? 0) - (transcript ? 0 : source.contentLength)),
      excludedSourceKeys: (draft.excludedSourceKeys ?? []).filter((key) => key !== source.sourceKey),
    });
    await requestIntakePreparation(ctx, touched, "source_removed");
    return null;
  },
});

/** Deletes a source, its text, its speakers and (when nothing else holds it) its original file. */
async function deleteSource(ctx: MutationCtx, source: Doc<"intakeSources">): Promise<void> {
  for (const row of await listIntakeSpeakers(ctx, source._id)) await ctx.db.delete(row._id);
  await deleteSourceText(ctx, source._id);
  await ctx.db.delete(source._id);
  if (source.storageId) await deleteStorageIfUnreferenced(ctx, source.storageId);
}

/**
 * Attaches an uploaded original file to a saved source whose text it came
 * from (`contentHash`: an original of replaced text is refused). The file
 * must be a fresh upload nothing holds and no one else claimed. While the
 * draft is promoting, a source not yet installed takes it, and one already
 * installed passes it to its project row; after promotion that happens
 * only within an hour, while the project is live and the caller may edit
 * it. A file that cannot be attached (the draft was discarded or expired,
 * the text changed, the row already has one) is deleted when the caller
 * claimed it, and false comes back; nobody else's upload is ever deleted.
 */
export const attachIntakeOriginal = mutation({
  args: {
    draftId: v.id("intakeDrafts"),
    sourceKey: v.string(),
    storageId: v.id("_storage"),
    contentHash: v.string(),
    mimeType: v.optional(v.string()),
  },
  returns: v.boolean(),
  handler: async (ctx, args): Promise<boolean> => {
    const user = await requireCreator(ctx);
    const draft = await ctx.db.get(args.draftId);
    if (!draft || draft.ownerId !== user._id) domainError("INTAKE_DRAFT_GONE", "This setup is no longer available");
    const sourceKey = requireSourceKey(args.sourceKey);
    await requireFreshUpload(ctx, args.storageId);
    const claim = await uploadClaimFor(ctx, args.storageId);
    if ((claim && claim.userId !== user._id) || (await isStorageReferenced(ctx, args.storageId))) {
      domainError("INVALID_INPUT", "The uploaded file is already in use. Upload it again.");
    }
    const release = async (): Promise<false> => {
      if (claim?.userId === user._id) await ctx.storage.delete(args.storageId);
      return false;
    };
    const now = Date.now();
    const open = draft.status === "open" && draft.expiresAt > now;
    if (!open && draft.status !== "promoting" && draft.status !== "promoted") return await release();
    const mimeType = args.mimeType?.slice(0, 200);
    const size = (await ctx.db.system.get("_storage", args.storageId))?.size ?? 0;
    const link = await ctx.db
      .query("intakeSourceLinks")
      .withIndex("by_draftId_and_sourceKey", (q) => q.eq("draftId", draft._id).eq("sourceKey", sourceKey))
      .unique();
    if (link) {
      // The project's row: only soon after promotion, on a live project the
      // caller may still edit, when the row has no original yet.
      if (draft.status === "promoted" && now > (draft.promotedAt ?? 0) + LATE_ORIGINAL_MS) return await release();
      const project = await ctx.db.get(link.projectId);
      if (!project || project.deletionStartedAt !== undefined || !(await userMayEditReport(ctx, user, project))) {
        return await release();
      }
      if (link.transcriptId) {
        const transcript = await ctx.db.get(link.transcriptId);
        if (
          transcript &&
          !transcript.originalStorageId &&
          transcript.contentHash === args.contentHash &&
          size <= MAX_TRANSCRIPT_FILE_BYTES
        ) {
          await ctx.db.patch(transcript._id, { originalStorageId: args.storageId });
          return true;
        }
      } else if (link.projectDocumentId) {
        const document = await ctx.db.get(link.projectDocumentId);
        if (document && !document.storageId && (await sha256(document.content)) === args.contentHash) {
          await ctx.db.patch(document._id, { storageId: args.storageId, ...(mimeType ? { mimeType } : {}) });
          return true;
        }
      }
      return await release();
    }
    if (!open && draft.status !== "promoting") return await release();
    const source = await ctx.db
      .query("intakeSources")
      .withIndex("by_draftId_and_sourceKey", (q) => q.eq("draftId", draft._id).eq("sourceKey", sourceKey))
      .unique();
    if (!source || source.contentHash !== args.contentHash) return await release();
    if (source.kind === "transcript" && size > MAX_TRANSCRIPT_FILE_BYTES) {
      await release();
      domainError("INVALID_INPUT", "A transcript file can be at most 25 MB");
    }
    const previous = source.storageId;
    await ctx.db.patch(source._id, { storageId: args.storageId, ...(mimeType ? { mimeType } : {}), updatedAt: now });
    if (previous && previous !== args.storageId) await deleteStorageIfUnreferenced(ctx, previous);
    if (open) await touchDraft(ctx, draft);
    return true;
  },
});

/**
 * The names the placeholder map and the speaker rules read, as the project
 * will carry them: the client name, the interviewer and the interviewees.
 * Any change restarts the 5-second settle the speaker model call and the
 * paid Brief wait for; a changed interviewer or interviewee list rebuilds
 * the speakers, and a changed client name asks the speaker model again.
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
    const clientChanged = clientName !== (draft.clientName ?? "");
    if (!rolesChanged && !clientChanged) return null;
    const now = Date.now();
    const touched = await touchDraft(ctx, draft, {
      clientName: clientName || undefined,
      interviewerUserId,
      interviewees: interviewees.length ? interviewees : undefined,
      contextChangedAt: now,
    });
    // The speakers are built again with the new names; roles the model
    // placed for the old names are asked for again once the names settle.
    for (const source of await listDraftSources(ctx, draft._id)) {
      if (source.kind !== "transcript") continue;
      await scheduleIntakeStructure(ctx, source._id, { resetModelRoles: source.speakerModelKey !== undefined });
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
    // Someone else's, or already promoting, promoted or ended: nothing to
    // do, and nothing said about whether it exists.
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
 * Asks the speaker model about a draft transcript's labels the rules could
 * not place, when it is due: only for names that have stayed unchanged for
 * NAMES_SETTLE_MS (else it is scheduled for then), with preparation on and
 * the owner still allowed to create projects, within MAX_SPEAKER_CALLS_PER_DAY
 * a firm day, and once per names and text (`speakerModelKey`).
 */
async function askSpeakersIfDue(ctx: MutationCtx, draft: Doc<"intakeDrafts">, sourceId: Id<"intakeSources">) {
  const source = await ctx.db.get(sourceId);
  if (!source || source.kind !== "transcript" || source.parserVersion !== TRANSCRIPT_PARSER_VERSION) return;
  const rows = await listIntakeSpeakers(ctx, source._id);
  const needsModel = rows.some((row) => row.roleSource === "heuristic" && needsModelRole(row));
  if (!needsModel) {
    if (source.speakerModel === "needed") await ctx.db.patch(source._id, { speakerModel: undefined });
    return;
  }
  const key = await speakerModelKey(ctx, draft, source);
  if (source.speakerModel !== "needed" && source.speakerModel !== undefined && source.speakerModelKey === key) return;
  const now = Date.now();
  const owner = await ctx.db.get(draft.ownerId);
  if (!draft.clientName?.trim() || !(await briefPreparationEnabled(ctx)) || !userMayCreateProject(owner)) {
    await ctx.db.patch(source._id, { speakerModel: "needed", speakerModelKey: undefined });
    return;
  }
  const settleAt = namesSettleAt(draft);
  if (now < settleAt) {
    await ctx.db.patch(source._id, { speakerModel: "needed", speakerModelKey: undefined });
    await ctx.scheduler.runAfter(settleAt - now, intakeDraftRefs.askIntakeSpeakers, { sourceId: source._id });
    return;
  }
  const counts = await dailyCounts(ctx, draft.ownerId, now);
  if (counts.speakerCalls >= MAX_SPEAKER_CALLS_PER_DAY) {
    // Over the day's cap the rules' roles stand, as after a failed call.
    await ctx.db.patch(source._id, { speakerModel: "failed", speakerModelKey: key });
    return;
  }
  await ctx.db.patch(counts._id, { speakerCalls: counts.speakerCalls + 1 });
  await ctx.db.patch(source._id, { speakerModel: "pending", speakerModelKey: key });
  await ctx.scheduler.runAfter(0, internal.ai.condense.classifyIntakeSpeakerRoles, { sourceId: source._id, key });
}

/** A draft transcript's turn and speaker build, then the speaker model look when due. */
export const buildIntakeSourceStructure = internalMutation({
  args: { sourceId: v.id("intakeSources"), resetModelRoles: v.optional(v.boolean()) },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const source = await ctx.db.get(args.sourceId);
    if (!source || source.kind !== "transcript") return null;
    const draft = await ctx.db.get(source.draftId);
    if (!draft || draft.status !== "open") return null;
    // Roles the model placed for other names are asked for again.
    const reset = args.resetModelRoles === true && source.speakerModelKey !== (await speakerModelKey(ctx, draft, source));
    await buildIntakeStructure(ctx, draft, source, { resetModelRoles: reset });
    await askSpeakersIfDue(ctx, draft, source._id);
    await requestIntakePreparation(ctx, draft, "structure_ready");
    return null;
  },
});

/** The speaker model look, once the names have settled (scheduled). */
export const askIntakeSpeakers = internalMutation({
  args: { sourceId: v.id("intakeSources") },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const source = await ctx.db.get(args.sourceId);
    if (!source) return null;
    const draft = await ctx.db.get(source.draftId);
    if (!draft || draft.status !== "open") return null;
    await askSpeakersIfDue(ctx, draft, source._id);
    await requestIntakePreparation(ctx, draft, "speakers_changed");
    return null;
  },
});

/**
 * What the one speaker-role model call needs for a draft transcript, the
 * way `transcripts.speakerRoleInput` builds it for a project's: each label
 * the rules left below the threshold with up to three of its turns, and
 * the draft's placeholder map. Null (the call is not made) when the ask is
 * no longer this one, the draft closed, preparation was switched off or
 * the owner may no longer create projects.
 */
export const intakeSpeakerRoleInput = internalQuery({
  args: { sourceId: v.id("intakeSources"), key: v.string() },
  handler: async (ctx, args) => {
    const source = await ctx.db.get(args.sourceId);
    if (!source || source.speakerModel !== "pending" || source.speakerModelKey !== args.key) return null;
    const draft = await ctx.db.get(source.draftId);
    if (!draft || draft.status !== "open" || !draft.clientName?.trim()) return null;
    if (!(await briefPreparationEnabled(ctx)) || !userMayCreateProject(await ctx.db.get(draft.ownerId))) return null;
    const rows = await listIntakeSpeakers(ctx, source._id);
    const unplaced = rows.filter((row) => row.roleSource === "heuristic" && needsModelRole(row));
    if (unplaced.length === 0) return null;
    const turns = parseIntakeTurns(await readSourceText(ctx, source._id), source).turns.slice(0, INTAKE_SPEAKER_SAMPLE_TURNS);
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
      contentHash: source.contentHash,
      samples,
      placeholders: await draftPlaceholderMap(ctx, draft, [source], samples.flatMap((sample) => sample.lines)),
    };
  },
});

/**
 * Stores the model's roles on a draft transcript, as
 * `transcripts.recordModelSpeakerRoles` does for a project's: only labels
 * still holding a rule-based role move, and "unknown" changes nothing. An
 * answer for other names or other text (its key and hash no longer the
 * source's) is dropped.
 */
export const recordIntakeSpeakerRoles = internalMutation({
  args: {
    sourceId: v.id("intakeSources"),
    key: v.string(),
    contentHash: v.optional(v.string()),
    roles: v.array(v.object({ label: v.string(), role: transcriptSpeakerRoleValidator, confidence: v.number() })),
    failed: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const source = await ctx.db.get(args.sourceId);
    if (!source || source.speakerModel !== "pending" || source.speakerModelKey !== args.key) return null;
    if (args.contentHash !== undefined && args.contentHash !== source.contentHash) return null;
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

const promotionReceiptValidator = v.union(
  // The draft's project was erased part way: the draft ended; no project.
  v.object({ ended: v.literal(true) }),
  v.object({
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
  })
);

type PromotionReceipt =
  | { ended: true }
  | {
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
 * link each; the promotion is complete once every transcript's turns are
 * built too, so the run reads the speaker evidence the preparation read.
 * A repeated confirm resumes the same project; one after the project was
 * erased part way ends the draft and builds nothing. The receipt maps
 * every source key to the project row it became.
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
    if (draft.status !== "open") {
      if (!draft.projectId) {
        await closeDraft(ctx, draft, "discarded");
        return { ended: true };
      }
      return await continuePromotion(ctx, draft._id, { schedule: false });
    }
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
    const now = Date.now();
    await ctx.db.patch(draft._id, {
      status: "promoting",
      projectId,
      promotionCommandId: args.commandId,
      promotionStartedAt: now,
      lastEditedAt: now,
    });
    return await continuePromotion(ctx, draft._id, { schedule: true });
  },
});

/** Background promotion steps: installs, then waits on the turn builds, until complete. */
export const continueIntakePromotion = internalMutation({
  args: { draftId: v.id("intakeDrafts") },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const draft = await ctx.db.get(args.draftId);
    if (!draft || draft.status !== "promoting") return null;
    if (!draft.projectId) {
      await closeDraft(ctx, draft, "discarded");
      return null;
    }
    await continuePromotion(ctx, draft._id, { schedule: true });
    return null;
  },
});

function comparePosition(a: Doc<"intakeSources">, b: Doc<"intakeSources">): number {
  if (a.position !== b.position) return a.position - b.position;
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  return a._id < b._id ? -1 : a._id > b._id ? 1 : 0;
}

async function promotionReceipt(
  ctx: MutationCtx,
  draftId: Id<"intakeDrafts">,
  projectId: Id<"projects">,
  complete: boolean
): Promise<PromotionReceipt> {
  const links = await ctx.db
    .query("intakeSourceLinks")
    .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
    .take(MAX_LINKS_READ);
  return {
    projectId,
    complete,
    sources: links
      .filter((link) => link.draftId === draftId)
      .map((link) => ({
        sourceKey: link.sourceKey,
        kind: link.kind,
        ...(link.transcriptId ? { transcriptId: link.transcriptId } : {}),
        ...(link.projectDocumentId ? { projectDocumentId: link.projectDocumentId } : {}),
      })),
  };
}

/**
 * One bounded promotion step: installs the next sources in order (every
 * transcript, then every document, as the preparation froze them) until
 * PROMOTION_STEP_CHARS; once all are in, moves the draft's preparations to
 * the project and waits until every installed transcript's turns are built
 * (at most PROMOTION_STRUCTURE_WAIT_MS), then completes. Only the
 * background chain (`schedule`) schedules the next step, so a page that
 * polls never starts a second chain. A project erased part way ends the
 * draft and purges it.
 */
async function continuePromotion(
  ctx: MutationCtx,
  draftId: Id<"intakeDrafts">,
  options: { schedule: boolean }
): Promise<PromotionReceipt> {
  const draft = (await ctx.db.get(draftId))!;
  const projectId = draft.projectId!;
  if (draft.status === "promoted") return await promotionReceipt(ctx, draft._id, projectId, true);
  const project = await ctx.db.get(projectId);
  if (!project || project.deletionStartedAt !== undefined) {
    await closeDraft(ctx, draft, "discarded");
    return { ended: true };
  }
  const owner = (await ctx.db.get(draft.ownerId))!;
  const sources = await listDraftSources(ctx, draft._id);
  const transcripts = sources.filter((row) => row.kind === "transcript").sort(comparePosition);
  const documents = sources.filter((row) => row.kind === "document").sort(comparePosition);
  const merged = mergedAway(sources);
  let budget = PROMOTION_STEP_CHARS;
  let installed = 0;
  let pending = false;
  for (const [index, source] of [...transcripts, ...documents].entries()) {
    if (source.transcriptId || source.projectDocumentId) continue;
    if (installed > 0 && source.contentLength > budget) {
      pending = true;
      break;
    }
    budget -= source.contentLength;
    installed += 1;
    if (source.kind === "transcript") {
      await installTranscript(ctx, draft, projectId, source, index);
    } else {
      const earlier = merged.get(source._id);
      const target = earlier ? (await ctx.db.get(earlier._id))?.projectDocumentId : undefined;
      if (target) await linkMergedDocument(ctx, draft, projectId, source, target);
      else await installDocument(ctx, draft, projectId, owner, source);
    }
  }
  if (pending) {
    if (options.schedule) {
      await ctx.scheduler.runAfter(0, intakeDraftRefs.continueIntakePromotion, { draftId: draft._id });
    }
    return await promotionReceipt(ctx, draft._id, projectId, false);
  }
  await moveDraftPreparations(ctx, draft, projectId);
  // Complete once every installed transcript's turns are built by the
  // current parser, so the run's speaker evidence matches the preparation's.
  const now = Date.now();
  // Each transcript's link records when its turn build finished, so the
  // wait reads the links only, never the transcripts' text.
  const links = await ctx.db
    .query("intakeSourceLinks")
    .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
    .take(MAX_LINKS_READ);
  const built = links.every((link) => link.draftId !== draft._id || link.kind !== "transcript" || link.builtAt !== undefined);
  if (!built && now < (draft.promotionStartedAt ?? now) + PROMOTION_STRUCTURE_WAIT_MS) {
    if (options.schedule) {
      await ctx.scheduler.runAfter(PROMOTION_RECHECK_MS, intakeDraftRefs.continueIntakePromotion, { draftId: draft._id });
    }
    return await promotionReceipt(ctx, draft._id, projectId, false);
  }
  await ctx.db.patch(draft._id, { status: "promoted", promotedAt: now, endedAt: now });
  await ctx.scheduler.runAfter(0, intakeDraftRefs.purgeIntakeDraft, { draftId: draft._id });
  return await promotionReceipt(ctx, draft._id, projectId, true);
}

/**
 * A draft transcript becomes a project transcript: its text, label, list
 * position, format and original file, and the roles the model placed. Its
 * turn build starts right here when it is short enough and is otherwise
 * scheduled; promotion completes only once it has finished. The model is
 * asked again only if the draft's own look did not finish, or the draft's
 * speakers were not built by the current parser.
 */
async function installTranscript(
  ctx: MutationCtx,
  draft: Doc<"intakeDrafts">,
  projectId: Id<"projects">,
  source: Doc<"intakeSources">,
  position: number
): Promise<void> {
  const now = Date.now();
  const content = await readSourceText(ctx, source._id);
  const transcriptId = await ctx.db.insert("transcripts", {
    projectId,
    content,
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
  const modelRoles =
    source.parserVersion !== TRANSCRIPT_PARSER_VERSION ||
    source.speakerModel === "needed" ||
    source.speakerModel === "pending" ||
    source.speakerModel === "failed";
  let builtAt: number | undefined;
  if (content.length <= INLINE_STRUCTURE_CHARS) {
    const step = await buildStructureStep(ctx, transcriptId, 0, undefined, { modelRoles });
    if (step.kind === "done" || step.kind === "current" || step.kind === "missing") builtAt = now;
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
    ...(builtAt !== undefined ? { builtAt } : {}),
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
  const content = await readSourceText(ctx, source._id);
  const derived = deriveProcessingStatus({
    fileName: source.label,
    content,
    extractionFailed: source.extractionOutcome === "failed",
    intake: source.intake,
  });
  const projectDocumentId = await ctx.db.insert("projectDocuments", {
    projectId,
    fileName: source.label,
    fileType: source.fileType ?? "other",
    content,
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
 * A second file with the same name and the same text as an earlier one
 * merges into that file's row, as `documents.uploadDocument` merges it;
 * its original fills the row if the row has none.
 */
async function linkMergedDocument(
  ctx: MutationCtx,
  draft: Doc<"intakeDrafts">,
  projectId: Id<"projects">,
  source: Doc<"intakeSources">,
  projectDocumentId: Id<"projectDocuments">
): Promise<void> {
  const document = await ctx.db.get(projectDocumentId);
  if (document && !document.storageId && source.storageId) {
    await ctx.db.patch(projectDocumentId, {
      storageId: source.storageId,
      ...(source.mimeType ? { mimeType: source.mimeType } : {}),
    });
  }
  await ctx.db.insert("intakeSourceLinks", {
    draftId: draft._id,
    projectId,
    sourceKey: source.sourceKey,
    kind: "document",
    projectDocumentId,
    createdAt: Date.now(),
  });
  await ctx.db.patch(source._id, { projectDocumentId });
}

/**
 * The draft's live or ready preparations move to the project (their frozen
 * rows then name the project's transcripts and files through the links, so
 * the run's adoption maps them exactly), and a queued one ends. Idempotent.
 */
async function moveDraftPreparations(ctx: MutationCtx, draft: Doc<"intakeDrafts">, projectId: Id<"projects">) {
  const links = await ctx.db
    .query("intakeSourceLinks")
    .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
    .take(MAX_LINKS_READ);
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
}

/**
 * Ends a promotion that could not finish (its steps kept failing, or it ran
 * past MAX_PROMOTION_MS): the project keeps what was installed and is no
 * longer "being set up"; every source that did not install is recorded as a
 * file that was not saved on the project's receipt, so the writer sees it
 * and can add it again; the draft's own preparations end and its content
 * is purged.
 */
async function endIncompletePromotion(ctx: MutationCtx, draft: Doc<"intakeDrafts">, projectId: Id<"projects">) {
  const now = Date.now();
  for (const source of await listDraftSources(ctx, draft._id)) {
    if (source.transcriptId || source.projectDocumentId) continue;
    await ctx.db.insert("documentUploadAttempts", {
      projectId,
      attemptKey: crypto.randomUUID(),
      fileName: source.label.slice(0, 200),
      fileSizeBytes: source.contentLength,
      origin: "context_input",
      status: "failed",
      failureCode: "upload_failed",
      createdBy: draft.ownerId,
      createdAt: now,
      updatedAt: now,
    });
  }
  await fenceDraftPreparations(ctx, draft._id, "promotion_incomplete");
  await ctx.db.patch(draft._id, { status: "promoted", promotedAt: now, endedAt: now, promotionIncomplete: true });
  await ctx.scheduler.runAfter(0, intakeDraftRefs.purgeIntakeDraft, { draftId: draft._id });
}

/**
 * Deletes a closed draft's content in bounded batches: speaker rows, text,
 * sources (with an original file nothing else holds: a promoted draft's
 * files belong to the project now and stay), the content of its
 * preparations that did not move to a project, and the names on the
 * draft. The draft row stays, content-free, until CLOSED_DRAFT_KEEP_MS.
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
      const texts = await ctx.db
        .query("intakeSourceTexts")
        .withIndex("by_draftId", (q) => q.eq("draftId", draft._id))
        .take(Math.min(budget, 20));
      for (const row of texts) await ctx.db.delete(row._id);
      budget -= texts.length;
    }
    if (budget > 0) {
      const sources = await ctx.db
        .query("intakeSources")
        .withIndex("by_draftId_and_position", (q) => q.eq("draftId", draft._id))
        .take(Math.min(budget, 20));
      for (const source of sources) await deleteSource(ctx, source);
      budget -= sources.length;
    }
    // Only preparations whose content is still there, through an index, so
    // rows past the first batch are reached too (review Fable P2-4).
    const unpurged = async () =>
      (
        await ctx.db
          .query("briefPreparations")
          .withIndex("by_intakeDraftId_and_contentPurgedAt", (q) =>
            q.eq("intakeDraftId", draft._id).eq("contentPurgedAt", undefined)
          )
          .take(50)
      ).filter((row) => !row.projectId && row.status !== "queued" && row.status !== "running");
    if (budget > 0) {
      for (const preparation of await unpurged()) {
        if (budget <= 0) break;
        const done = await purgePreparationContent(ctx, preparation, budget);
        budget -= Math.max(1, done.deleted);
      }
    }
    if (budget > 0) {
      const leftover =
        (await ctx.db.query("intakeSourceSpeakers").withIndex("by_draftId", (q) => q.eq("draftId", draft._id)).first()) ??
        (await ctx.db.query("intakeSourceTexts").withIndex("by_draftId", (q) => q.eq("draftId", draft._id)).first()) ??
        (await ctx.db
          .query("intakeSources")
          .withIndex("by_draftId_and_position", (q) => q.eq("draftId", draft._id))
          .first());
      if (!leftover && (await unpurged()).length === 0) {
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
 * fenced); a promotion stuck for 10 minutes is resumed when its project is
 * live and otherwise ended and purged; every closed draft whose content is
 * not yet purged gets its purge, so expired content is gone within the
 * hour; content-free closed drafts older than 30 days are deleted.
 */
export const sweepIntakeDrafts = internalMutation({
  args: {},
  returns: v.object({ expired: v.number(), purging: v.number(), stuck: v.number(), deleted: v.number() }),
  handler: async (ctx): Promise<{ expired: number; purging: number; stuck: number; deleted: number }> => {
    const now = Date.now();
    const due = await ctx.db
      .query("intakeDrafts")
      .withIndex("by_status_and_expiresAt", (q) => q.eq("status", "open").lte("expiresAt", now))
      .take(INTAKE_SWEEP_DRAFTS);
    for (const draft of due) await closeDraft(ctx, draft, "expired");
    const stuck = await ctx.db
      .query("intakeDrafts")
      .withIndex("by_status_and_promotionStartedAt", (q) =>
        q.eq("status", "promoting").lte("promotionStartedAt", now - STUCK_PROMOTION_MS)
      )
      .take(INTAKE_SWEEP_DRAFTS);
    for (const draft of stuck) {
      const project = draft.projectId ? await ctx.db.get(draft.projectId) : null;
      if (!project || project.deletionStartedAt !== undefined) {
        await closeDraft(ctx, draft, "discarded");
      } else if (
        (draft.promotionResumes ?? 0) >= MAX_PROMOTION_RESUMES ||
        now - (draft.promotionStartedAt ?? now) >= MAX_PROMOTION_MS
      ) {
        await endIncompletePromotion(ctx, draft, project._id);
      } else {
        await ctx.db.patch(draft._id, { promotionResumes: (draft.promotionResumes ?? 0) + 1 });
        await ctx.scheduler.runAfter(0, intakeDraftRefs.continueIntakePromotion, { draftId: draft._id });
      }
    }
    let purging = 0;
    let deleted = 0;
    for (const status of ["expired", "discarded", "promoted"] as const) {
      const rows = await ctx.db
        .query("intakeDrafts")
        .withIndex("by_status_and_contentPurgedAt", (q) => q.eq("status", status).eq("contentPurgedAt", undefined))
        .take(INTAKE_SWEEP_DRAFTS);
      for (const draft of rows) {
        await ctx.scheduler.runAfter(0, intakeDraftRefs.purgeIntakeDraft, { draftId: draft._id });
        purging += 1;
      }
      // Content-free rows kept 30 days, then deleted. A promoted draft's
      // links stay with its project (the key names it by the draft's id).
      const old = await ctx.db
        .query("intakeDrafts")
        .withIndex("by_status_and_contentPurgedAt", (q) =>
          q.eq("status", status).gt("contentPurgedAt", 0).lte("contentPurgedAt", now - CLOSED_DRAFT_KEEP_MS)
        )
        .take(INTAKE_SWEEP_DRAFTS);
      for (const draft of old) {
        await ctx.db.delete(draft._id);
        deleted += 1;
      }
    }
    if (due.length === INTAKE_SWEEP_DRAFTS) await ctx.scheduler.runAfter(0, intakeDraftRefs.sweepIntakeDrafts, {});
    return { expired: due.length, purging, stuck: stuck.length, deleted };
  },
});

