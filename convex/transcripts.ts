import { internalMutation, internalQuery, mutation, query, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  getInternalProjectAccessOrNull,
  requireInternalProjectAccess,
} from "./lib/auth";
import { domainError, sha256 } from "./lib/contracts";
import { findActiveGeneration } from "./lib/activeGeneration";
import {
  transcriptSourceFormatValidator,
  transcriptSpeakerRoleValidator,
} from "./lib/transcriptValidators";
import { isProjectDeleting } from "./lib/projectDeletion";
import {
  buildStructureStep,
  listSpeakerRows,
  speakerStatusOf,
} from "./lib/transcriptStructure";
import { needsModelRole } from "./lib/transcriptSpeakers";
import { projectPlaceholderMap } from "./lib/transcriptPlaceholders";
import { TRANSCRIPT_PARSER_VERSION } from "../shared/transcriptParse";
import {
  adoptDerivedRows,
  insertTranscriptRow,
  listProjectTranscripts,
  MAX_TOTAL_TRANSCRIPT_CHARS,
  MAX_TRANSCRIPT_ROWS_READ,
  MAX_TRANSCRIPTS_PER_PROJECT,
  requireTranscriptTextWithinCap,
  transcriptLabel,
  transcriptMetadata,
  validatedOriginalStorage,
} from "./lib/transcripts";

/**
 * Metadata for every transcript on a project, in order. Deliberately carries no
 * content: a project page subscribes to this list and pulls one body at a time
 * through `getTranscriptContent`.
 */
export const listTranscripts = query({
  args: { projectId: v.id("projects") },
  returns: v.array(
    v.object({
      _id: v.id("transcripts"),
      label: v.string(),
      position: v.optional(v.number()),
      createdAt: v.number(),
      charCount: v.number(),
      wordCount: v.number(),
      contentHash: v.optional(v.string()),
      // 2026-09-24 (transcript method).
      sourceFormat: v.optional(transcriptSourceFormatValidator),
      speakerStatus: v.optional(
        v.union(v.literal("unchecked"), v.literal("needs_check"), v.literal("confirmed"))
      ),
      factsStatus: v.optional(
        v.union(v.literal("none"), v.literal("queued"), v.literal("ready"), v.literal("failed"))
      ),
      hasOriginal: v.optional(v.boolean()),
    })
  ),
  handler: async (ctx, args) => {
    if (!(await getInternalProjectAccessOrNull(ctx, args.projectId))) return [];

    const transcripts = await listProjectTranscripts(ctx, args.projectId);
    return transcripts.map(transcriptMetadata);
  },
});

/** One transcript body. Silent `null` without access, same policy as above. */
export const getTranscriptContent = query({
  args: { transcriptId: v.id("transcripts") },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("transcripts"),
      label: v.string(),
      content: v.string(),
    })
  ),
  handler: async (ctx, args) => {
    const transcript = await ctx.db.get(args.transcriptId);
    if (!transcript) return null;
    if (!(await getInternalProjectAccessOrNull(ctx, transcript.projectId))) {
      return null;
    }

    return {
      _id: transcript._id,
      label: transcriptLabel(transcript),
      content: transcript.content,
    };
  },
});

// ─── Turns and speakers (2026-09-24, the transcript method) ────────────────

/**
 * Builds one transcript's turns and rule-based speaker roles from its stored
 * text, one bounded batch per run, rescheduling itself until done. No model
 * call. Idempotent: a transcript already at the current parser version is
 * left alone, and a replayed batch inserts only what is missing.
 */
export const buildTranscriptStructure = internalMutation({
  args: {
    transcriptId: v.id("transcripts"),
    fromIndex: v.optional(v.number()),
    // New intake asks the model about speakers the rules could not place;
    // the backfill never does (no model call).
    modelRoles: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const transcript = await ctx.db.get(args.transcriptId);
    if (!transcript || (await isProjectDeleting(ctx, transcript.projectId))) return null;
    const step = await buildStructureStep(ctx, args.transcriptId, args.fromIndex ?? 0);
    if (step.kind === "continue") {
      await ctx.scheduler.runAfter(0, internal.transcripts.buildTranscriptStructure, {
        transcriptId: args.transcriptId,
        fromIndex: step.fromIndex,
        ...(args.modelRoles ? { modelRoles: true } : {}),
      });
    }
    if (step.kind === "done" && step.needsModelRoles && args.modelRoles) {
      await ctx.scheduler.runAfter(0, internal.ai.condense.classifySpeakerRoles, {
        transcriptId: args.transcriptId,
      });
    }
    return null;
  },
});

/** Transcripts one backfill page looks at. */
const BACKFILL_PAGE_SIZE = 20;

/**
 * Batched, self-rescheduling backfill of turns and heuristic speaker roles
 * for every transcript row written before the transcript method. Run once
 * from the dashboard (`transcripts:backfillTranscriptStructure` with `{}`);
 * safe to run again, since rows already at the current parser version are
 * skipped. Archived and empty rows are skipped too.
 */
export const backfillTranscriptStructure = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  returns: v.object({ scheduled: v.number(), isDone: v.boolean() }),
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("transcripts")
      .paginate({ cursor: args.cursor ?? null, numItems: BACKFILL_PAGE_SIZE });
    let scheduled = 0;
    for (const row of page.page) {
      if (row.parserVersion === TRANSCRIPT_PARSER_VERSION) continue;
      if (row.archivedAt !== undefined || row.content.trim() === "") continue;
      await ctx.scheduler.runAfter(0, internal.transcripts.buildTranscriptStructure, {
        transcriptId: row._id,
      });
      scheduled += 1;
    }
    if (!page.isDone) {
      // Spaced out so the builds of one page finish before the next starts.
      await ctx.scheduler.runAfter(2_000, internal.transcripts.backfillTranscriptStructure, {
        cursor: page.continueCursor,
      });
    }
    return { scheduled, isDone: page.isDone };
  },
});

// ─── Add, Replace and Remove after creation (2026-09-24) ───────────────────

const ACTIVE_GENERATION_STATUSES = [
  "reserved",
  "running",
  "awaiting_selection",
  "awaiting_input",
] as const;

/** Text a new or replacing transcript row starts from, as uploaded. */
const transcriptUploadArgs = {
  content: v.string(),
  label: v.optional(v.string()),
  sourceFormat: v.optional(transcriptSourceFormatValidator),
  originalStorageId: v.optional(v.id("_storage")),
};

/**
 * The checks every change to a project's transcript list shares: the caller
 * can upload to the project (the `uploadDocument` access check), no
 * generation is active, and the result stays inside the caps. `replacing`
 * is left out of the counts and the duplicate check.
 */
async function requireTranscriptChange(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  change: { content?: string; replacing?: Id<"transcripts"> }
) {
  const { project, user } = await requireInternalProjectAccess(ctx, projectId);
  if (await findActiveGeneration(ctx, project, ACTIVE_GENERATION_STATUSES)) {
    domainError(
      "GENERATION_ACTIVE",
      "Transcripts can't change while a report is generating. Try again when it finishes."
    );
  }
  const rows = await ctx.db
    .query("transcripts")
    .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
    .take(MAX_TRANSCRIPT_ROWS_READ);
  const active = await listProjectTranscripts(ctx, projectId);
  const others = active.filter((row) => row._id !== change.replacing);
  if (change.content !== undefined) {
    if (change.content.trim() === "") {
      domainError("INVALID_INPUT", "The transcript has no text");
    }
    requireTranscriptTextWithinCap(change.content);
    if (rows.length >= MAX_TRANSCRIPT_ROWS_READ) {
      domainError("INVALID_INPUT", "This project has reached its transcript history limit");
    }
    if (others.length >= MAX_TRANSCRIPTS_PER_PROJECT) {
      domainError(
        "INVALID_INPUT",
        `A project may carry at most ${MAX_TRANSCRIPTS_PER_PROJECT} transcripts`
      );
    }
    const total = others.reduce((sum, row) => sum + row.content.length, 0) + change.content.length;
    if (total > MAX_TOTAL_TRANSCRIPT_CHARS) {
      domainError("INVALID_INPUT", "Combined transcript text is too large");
    }
    const hash = await sha256(change.content);
    const duplicate = active.find(
      (row) => (row.contentHash ?? "") === hash || row.content === change.content
    );
    if (duplicate) {
      domainError("INVALID_INPUT", `This transcript is already added (${transcriptLabel(duplicate)})`);
    }
  }
  return { project, user, active, rows };
}

/**
 * Another transcript row holding the same text in a project the caller can
 * read, so its confirmed roles and facts carry over with no model call.
 */
async function sameTextElsewhere(
  ctx: MutationCtx,
  contentHash: string,
  except: Id<"transcripts">
): Promise<Doc<"transcripts"> | null> {
  const candidates = await ctx.db
    .query("transcripts")
    .withIndex("by_contentHash", (q) => q.eq("contentHash", contentHash))
    .take(10);
  for (const row of candidates) {
    if (row._id === except) continue;
    if (await getInternalProjectAccessOrNull(ctx, row.projectId)) return row;
  }
  return null;
}

async function insertUploadedTranscript(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  args: {
    content: string;
    label?: string;
    sourceFormat?: Doc<"transcripts">["sourceFormat"];
    originalStorageId?: Id<"_storage">;
    position: number;
  }
): Promise<Id<"transcripts">> {
  const originalStorageId = args.originalStorageId
    ? await validatedOriginalStorage(ctx, args.originalStorageId)
    : undefined;
  const transcriptId = await insertTranscriptRow(ctx, {
    projectId,
    content: args.content,
    label: args.label?.trim() || undefined,
    position: args.position,
    ...(args.sourceFormat ? { sourceFormat: args.sourceFormat } : {}),
    ...(originalStorageId ? { originalStorageId } : {}),
  });
  if (!transcriptId) domainError("INVALID_INPUT", "The transcript has no text");
  const inserted = await ctx.db.get(transcriptId);
  if (inserted?.contentHash) {
    const source = await sameTextElsewhere(ctx, inserted.contentHash, transcriptId);
    if (source) await adoptDerivedRows(ctx, transcriptId, source);
  }
  return transcriptId;
}

/** Adds a transcript to the end of a project's list. */
export const addTranscript = mutation({
  args: { projectId: v.id("projects"), ...transcriptUploadArgs },
  returns: v.id("transcripts"),
  handler: async (ctx, args) => {
    const { active } = await requireTranscriptChange(ctx, args.projectId, {
      content: args.content,
    });
    const position =
      active.reduce((max, row) => Math.max(max, row.position ?? -1), -1) + 1;
    const transcriptId = await insertUploadedTranscript(ctx, args.projectId, {
      ...args,
      label: args.label ?? `Transcript ${active.length + 1}`,
      position,
    });
    await ctx.db.patch(args.projectId, { updatedAt: Date.now() });
    return transcriptId;
  },
});

/**
 * Replaces a transcript: a new row takes the old row's place in the list and
 * the old row is archived, never edited, so every generation that froze it
 * keeps its sources.
 */
export const replaceTranscript = mutation({
  args: { transcriptId: v.id("transcripts"), ...transcriptUploadArgs },
  returns: v.id("transcripts"),
  handler: async (ctx, args) => {
    const old = await ctx.db.get(args.transcriptId);
    if (!old) domainError("NOT_FOUND", "Transcript not found");
    await requireTranscriptChange(ctx, old.projectId, {
      content: args.content,
      replacing: old._id,
    });
    if (old.archivedAt !== undefined) {
      domainError("INVALID_STATE", "This transcript was already replaced or removed");
    }
    const replacementId = await insertUploadedTranscript(ctx, old.projectId, {
      content: args.content,
      label: args.label ?? transcriptLabel(old),
      sourceFormat: args.sourceFormat,
      originalStorageId: args.originalStorageId,
      position: old.position ?? 0,
    });
    const now = Date.now();
    await ctx.db.patch(old._id, { archivedAt: now, supersededById: replacementId });
    await ctx.db.patch(old.projectId, { updatedAt: now });
    return replacementId;
  },
});

/** Removes a transcript from the project's list by archiving it. */
export const removeTranscript = mutation({
  args: { transcriptId: v.id("transcripts") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.transcriptId);
    if (!row) domainError("NOT_FOUND", "Transcript not found");
    await requireTranscriptChange(ctx, row.projectId, {});
    if (row.archivedAt !== undefined) return null;
    const now = Date.now();
    await ctx.db.patch(row._id, { archivedAt: now });
    await ctx.db.patch(row.projectId, { updatedAt: now });
    return null;
  },
});

// ─── Speaker roles (2026-09-24; owner decision 24: warn, never block) ─────

/** Turns a speaker's sample line and the model's samples draw from. */
const SPEAKER_SAMPLE_TURNS = 400;
const SAMPLE_LINE_CHARS = 240;

/**
 * What the one speaker-role model call needs: each label the rules left
 * below the threshold with up to three of its turns, and the placeholder
 * map that hides the names before the call.
 */
export const speakerRoleInput = internalQuery({
  args: { transcriptId: v.id("transcripts") },
  handler: async (ctx, args) => {
    const transcript = await ctx.db.get(args.transcriptId);
    if (!transcript || transcript.archivedAt !== undefined) return null;
    const project = await ctx.db.get(transcript.projectId);
    if (!project || project.deletionStartedAt !== undefined) return null;
    const rows = await listSpeakerRows(ctx, transcript._id);
    const unplaced = rows.filter((row) => row.roleSource === "heuristic" && needsModelRole(row));
    if (unplaced.length === 0) return null;
    const turns = await ctx.db
      .query("transcriptTurns")
      .withIndex("by_transcriptId_and_index", (q) => q.eq("transcriptId", transcript._id))
      .take(SPEAKER_SAMPLE_TURNS);
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
      projectId: project._id,
      samples,
      placeholders: [...(await projectPlaceholderMap(ctx, project, [transcript._id]))],
    };
  },
});

/**
 * Stores the model's roles. Only labels still holding a rule-based role move:
 * a consultant's choice always wins, and an "unknown" answer changes nothing.
 */
export const recordModelSpeakerRoles = internalMutation({
  args: {
    transcriptId: v.id("transcripts"),
    roles: v.array(
      v.object({ label: v.string(), role: transcriptSpeakerRoleValidator, confidence: v.number() })
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const transcript = await ctx.db.get(args.transcriptId);
    if (!transcript || (await isProjectDeleting(ctx, transcript.projectId))) return null;
    const rows = await listSpeakerRows(ctx, transcript._id);
    for (const answer of args.roles) {
      const row = rows.find((candidate) => candidate.label === answer.label);
      if (!row || row.roleSource !== "heuristic" || answer.role === "unknown") continue;
      await ctx.db.patch(row._id, {
        role: answer.role,
        roleSource: "model",
        confidence: Math.max(0, Math.min(1, answer.confidence)),
      });
    }
    await ctx.db.patch(transcript._id, { speakerStatus: await speakerStatusOf(ctx, transcript._id) });
    return null;
  },
});

const speakerRowValidator = v.object({
  label: v.string(),
  role: transcriptSpeakerRoleValidator,
  roleSource: v.union(v.literal("heuristic"), v.literal("model"), v.literal("consultant")),
  turnCount: v.number(),
  sample: v.optional(v.string()),
});

/** The Speakers popover: one row per label with a verbatim sample line. */
export const getTranscriptSpeakers = query({
  args: { transcriptId: v.id("transcripts") },
  returns: v.union(v.null(), v.array(speakerRowValidator)),
  handler: async (ctx, args) => {
    const transcript = await ctx.db.get(args.transcriptId);
    if (!transcript) return null;
    if (!(await getInternalProjectAccessOrNull(ctx, transcript.projectId))) return null;
    const rows = await listSpeakerRows(ctx, transcript._id);
    const out = [];
    for (const row of rows) {
      let sample: string | undefined;
      if (row.sampleTurnIndex !== undefined) {
        const turn = await ctx.db
          .query("transcriptTurns")
          .withIndex("by_transcriptId_and_index", (q) =>
            q.eq("transcriptId", transcript._id).eq("index", row.sampleTurnIndex!)
          )
          .first();
        if (turn) {
          const verbatim = transcript.content.slice(turn.charStart, turn.charEnd).replace(/\s+/g, " ");
          sample =
            verbatim.length > SAMPLE_LINE_CHARS ? `${verbatim.slice(0, SAMPLE_LINE_CHARS).trimEnd()}...` : verbatim;
        }
      }
      out.push({
        label: row.label,
        role: row.role,
        roleSource: row.roleSource,
        turnCount: row.turnCount,
        ...(sample ? { sample } : {}),
      });
    }
    return out;
  },
});

async function requireSpeakerChange(ctx: MutationCtx, transcriptId: Id<"transcripts">) {
  const transcript = await ctx.db.get(transcriptId);
  if (!transcript) domainError("NOT_FOUND", "Transcript not found");
  const { user } = await requireInternalProjectAccess(ctx, transcript.projectId);
  return { transcript, user };
}

/**
 * A consultant sets one speaker's role. Roles are joined to turns when a
 * fact pack is rendered, so this reaches the next generation; a frozen
 * generation keeps the roles it froze.
 */
export const setSpeakerRole = mutation({
  args: {
    transcriptId: v.id("transcripts"),
    label: v.string(),
    role: v.union(v.literal("interviewer"), v.literal("client"), v.literal("other")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { transcript, user } = await requireSpeakerChange(ctx, args.transcriptId);
    const row = (await listSpeakerRows(ctx, transcript._id)).find((candidate) => candidate.label === args.label);
    if (!row) domainError("NOT_FOUND", "Speaker not found");
    await ctx.db.patch(row._id, {
      role: args.role,
      roleSource: "consultant",
      confidence: 1,
      confirmedBy: user._id,
      confirmedAt: Date.now(),
    });
    await ctx.db.patch(transcript._id, { speakerStatus: await speakerStatusOf(ctx, transcript._id) });
    return null;
  },
});

/** "Looks right": a consultant confirms every detected role as it stands. */
export const confirmSpeakers = mutation({
  args: { transcriptId: v.id("transcripts") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { transcript, user } = await requireSpeakerChange(ctx, args.transcriptId);
    const now = Date.now();
    for (const row of await listSpeakerRows(ctx, transcript._id)) {
      if (row.roleSource === "consultant") continue;
      await ctx.db.patch(row._id, {
        roleSource: "consultant",
        confidence: 1,
        confirmedBy: user._id,
        confirmedAt: now,
      });
    }
    await ctx.db.patch(transcript._id, { speakerStatus: await speakerStatusOf(ctx, transcript._id) });
    return null;
  },
});
