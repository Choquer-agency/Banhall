import { internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  getInternalProjectAccessOrNull,
  requireInternalActor,
  requireInternalProjectAccess,
  requireRole,
} from "./lib/auth";
import { domainError, sha256 } from "./lib/contracts";
import { deleteStorageIfUnreferenced, isStorageReferenced } from "./lib/storage";
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
import { FACTS_VERSION } from "./lib/transcriptFacts";
import {
  excludedSpeakerLabels,
  FACT_RUN_STALE_MS,
  factRunIsCurrent,
  findFactRun,
  listFacts,
  loadFactTurns,
  MAX_FACTS_PER_TRANSCRIPT,
  transcriptHash,
} from "./lib/transcriptFactRows";
import { transcriptFactTypeValidator } from "./lib/transcriptValidators";
import { storageSweepMode, transcriptFactsMode, transcriptPlaceholdersEnabled } from "./appSettings";
import { TRANSCRIPT_PARSER_VERSION } from "../shared/transcriptParse";
import {
  adoptDerivedRows,
  insertTranscriptRow,
  listActiveTranscriptRows,
  listProjectTranscripts,
  MAX_TOTAL_TRANSCRIPT_CHARS,
  MAX_TRANSCRIPT_HISTORY_ROWS,
  MAX_TRANSCRIPTS_PER_PROJECT,
  projectTranscriptsFrom,
  scheduleStructureRebuildIfStale,
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
 * left alone, and a replayed batch inserts only what is missing. A call
 * without `buildId` starts a new chain, which takes the build over from any
 * chain still running for the same transcript (`buildStructureStep`).
 */
export const buildTranscriptStructure = internalMutation({
  args: {
    transcriptId: v.id("transcripts"),
    fromIndex: v.optional(v.number()),
    // New intake asks the model about speakers the rules could not place;
    // the backfill never does (no model call).
    modelRoles: v.optional(v.boolean()),
    // The chain this step belongs to; absent on a chain's first step.
    buildId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const transcript = await ctx.db.get(args.transcriptId);
    if (!transcript || (await isProjectDeleting(ctx, transcript.projectId))) return null;
    const step = await buildStructureStep(ctx, args.transcriptId, args.fromIndex ?? 0, args.buildId, {
      modelRoles: args.modelRoles === true,
    });
    if (step.kind === "continue") {
      await ctx.scheduler.runAfter(0, internal.transcripts.buildTranscriptStructure, {
        transcriptId: args.transcriptId,
        fromIndex: step.fromIndex,
        buildId: step.buildId,
        ...(args.modelRoles ? { modelRoles: true } : {}),
      });
    }
    // The request is read from the row, so a build another chain took over
    // from an upload still asks.
    if (step.kind === "done" && step.needsModelRoles && step.modelRoles) {
      await ctx.scheduler.runAfter(0, internal.ai.condense.classifySpeakerRoles, {
        transcriptId: args.transcriptId,
      });
    }
    return null;
  },
});

/**
 * Transcripts one backfill page looks at, and the bytes it may read: a page
 * of rows written before the per-transcript cap can be large.
 */
const BACKFILL_PAGE_SIZE = 10;
const BACKFILL_MAX_BYTES_READ = 4 * 1024 * 1024;

/**
 * Batched, self-rescheduling backfill of turns and heuristic speaker roles
 * for every transcript row written before the transcript method. Run once
 * from the dashboard (`transcripts:backfillTranscriptStructure` with `{}`);
 * safe to run again, since rows already at the current parser version are
 * skipped. Archived and empty rows are skipped too, and so is a row a build
 * already holds (an upload's, say), so the backfill never takes it over.
 */
export const backfillTranscriptStructure = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  returns: v.object({ scheduled: v.number(), isDone: v.boolean() }),
  handler: async (ctx, args) => {
    const page = await ctx.db.query("transcripts").paginate({
      cursor: args.cursor ?? null,
      numItems: BACKFILL_PAGE_SIZE,
      maximumBytesRead: BACKFILL_MAX_BYTES_READ,
    });
    let scheduled = 0;
    for (const row of page.page) {
      if (await scheduleStructureRebuildIfStale(ctx, row)) scheduled += 1;
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
 * is left out of the counts and the duplicate check, so a transcript can be
 * replaced with the same text (with its original file, say); the Sources tab
 * checks the same way before it uploads anything.
 *
 * Reads the project's active rows once, through the index that skips
 * archived rows; archived rows are counted on the project, never read.
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
  const activeRows = await listActiveTranscriptRows(ctx, projectId);
  const active = projectTranscriptsFrom(activeRows);
  const others = active.filter((row) => row._id !== change.replacing);
  let contentHash: string | undefined;
  if (change.content !== undefined) {
    if (change.content.trim() === "") {
      domainError("INVALID_INPUT", "The transcript has no text");
    }
    requireTranscriptTextWithinCap(change.content);
    // Add and Replace each write one more row; Replace archives the old one.
    if (activeRows.length + (project.archivedTranscriptCount ?? 0) >= MAX_TRANSCRIPT_HISTORY_ROWS) {
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
    contentHash = hash;
    const duplicate = others.find(
      (row) => (row.contentHash ?? "") === hash || row.content === change.content
    );
    if (duplicate) {
      domainError("INVALID_INPUT", `This transcript is already added (${transcriptLabel(duplicate)})`);
    }
  }
  return { project, user, active, contentHash };
}

/**
 * Each active row's list position. Rows written before transcripts carried
 * a position sort after every positioned row (`compareTranscripts`), so a
 * new row given a position would jump ahead of them. When any active row
 * has none, every active row first takes its current list index, which
 * keeps the order the project shows today. `except` (a row about to be
 * archived) is not written.
 */
async function settlePositions(
  ctx: MutationCtx,
  active: readonly Doc<"transcripts">[],
  except?: Id<"transcripts">
): Promise<Map<Id<"transcripts">, number>> {
  const settle = active.some((row) => row.position === undefined);
  const positions = new Map<Id<"transcripts">, number>();
  for (const [index, row] of active.entries()) {
    const position = settle ? index : row.position!;
    if (settle && row.position !== index && row._id !== except) {
      await ctx.db.patch(row._id, { position: index });
    }
    positions.set(row._id, position);
  }
  return positions;
}

function nextPosition(positions: Map<Id<"transcripts">, number>): number {
  return Math.max(-1, ...positions.values()) + 1;
}

/** Rows holding the same text that `sameTextElsewhere` looks at, newest first. */
const SAME_TEXT_CANDIDATES = 2;

/**
 * Another transcript row holding the same text in a project the caller can
 * read, so its confirmed roles and facts carry over with no model call.
 * Called before the new row is written, and bounded: each candidate may hold
 * 500 000 characters.
 */
async function sameTextElsewhere(
  ctx: MutationCtx,
  contentHash: string
): Promise<Doc<"transcripts"> | null> {
  const candidates = await ctx.db
    .query("transcripts")
    .withIndex("by_contentHash", (q) => q.eq("contentHash", contentHash))
    .order("desc")
    .take(SAME_TEXT_CANDIDATES);
  for (const row of candidates) {
    if (await getInternalProjectAccessOrNull(ctx, row.projectId)) return row;
  }
  return null;
}

async function insertUploadedTranscript(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  args: {
    content: string;
    contentHash: string;
    label?: string;
    sourceFormat?: Doc<"transcripts">["sourceFormat"];
    originalStorageId?: Id<"_storage">;
    position: number;
  }
): Promise<Id<"transcripts">> {
  const originalStorageId = args.originalStorageId
    ? await validatedOriginalStorage(ctx, args.originalStorageId)
    : undefined;
  const source = await sameTextElsewhere(ctx, args.contentHash);
  const transcriptId = await insertTranscriptRow(ctx, {
    projectId,
    content: args.content,
    label: args.label?.trim() || undefined,
    position: args.position,
    ...(args.sourceFormat ? { sourceFormat: args.sourceFormat } : {}),
    ...(originalStorageId ? { originalStorageId } : {}),
  });
  if (!transcriptId) domainError("INVALID_INPUT", "The transcript has no text");
  if (source) await adoptDerivedRows(ctx, transcriptId, source);
  return transcriptId;
}

/** Adds a transcript to the end of a project's list. */
export const addTranscript = mutation({
  args: { projectId: v.id("projects"), ...transcriptUploadArgs },
  returns: v.id("transcripts"),
  handler: async (ctx, args) => {
    const { active, contentHash } = await requireTranscriptChange(ctx, args.projectId, {
      content: args.content,
    });
    const position = nextPosition(await settlePositions(ctx, active));
    const transcriptId = await insertUploadedTranscript(ctx, args.projectId, {
      ...args,
      contentHash: contentHash!,
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
    // Who may call first: an ineligible caller learns nothing about the row.
    await requireInternalActor(ctx);
    const old = await ctx.db.get(args.transcriptId);
    if (!old) domainError("NOT_FOUND", "Transcript not found");
    if (old.archivedAt !== undefined) {
      await requireInternalProjectAccess(ctx, old.projectId);
      domainError("INVALID_STATE", "This transcript was already replaced or removed");
    }
    const { project, active, contentHash } = await requireTranscriptChange(ctx, old.projectId, {
      content: args.content,
      replacing: old._id,
    });
    const positions = await settlePositions(ctx, active, old._id);
    const replacementId = await insertUploadedTranscript(ctx, old.projectId, {
      content: args.content,
      contentHash: contentHash!,
      label: args.label ?? transcriptLabel(old),
      sourceFormat: args.sourceFormat,
      originalStorageId: args.originalStorageId,
      position: positions.get(old._id) ?? nextPosition(positions),
    });
    const now = Date.now();
    await ctx.db.patch(old._id, { archivedAt: now, supersededById: replacementId });
    await ctx.db.patch(old.projectId, {
      updatedAt: now,
      archivedTranscriptCount: (project.archivedTranscriptCount ?? 0) + 1,
    });
    return replacementId;
  },
});

/** How recent an upload `discardTranscriptOriginals` may release. */
const DISCARD_ORIGINAL_WINDOW_MS = 60 * 60 * 1000;

/**
 * Releases original files the browser uploaded for an Add, a Replace or a
 * new project that was then refused (duplicate, caps, active generation).
 * The bytes go to storage before the server checks anything, so without
 * this a refusal left interview text in storage that no row points to and
 * project erasure can never find. Only files no row holds and that were
 * uploaded in the last hour are deleted; anything else is left alone.
 */
export const discardTranscriptOriginals = mutation({
  args: { storageIds: v.array(v.id("_storage")) },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireInternalActor(ctx);
    const now = Date.now();
    for (const storageId of args.storageIds.slice(0, MAX_TRANSCRIPTS_PER_PROJECT)) {
      const metadata = await ctx.db.system.get("_storage", storageId);
      if (!metadata || now - metadata._creationTime > DISCARD_ORIGINAL_WINDOW_MS) continue;
      await deleteStorageIfUnreferenced(ctx, storageId);
    }
    return null;
  },
});

/**
 * Files younger than this are left alone by `sweepUnreferencedStorage`: an
 * upload whose save has not run yet is still on its way to its row.
 */
export const UNREFERENCED_STORAGE_GRACE_MS = 24 * 60 * 60 * 1000;

/**
 * Files one sweep transaction looks at. Each held file costs one full row
 * read in `isStorageReferenced` (a transcript or a document can hold up to
 * 1 MB of text), so a page stays far inside the 16 MiB a transaction may
 * read.
 */
export const STORAGE_SWEEP_PAGE_SIZE = 10;

/** Sweep runs kept for admins to read; older ones are pruned. */
export const STORAGE_SWEEP_RUNS_KEPT = 30;

/** File ids one run keeps as a sample of what it found. */
export const STORAGE_SWEEP_SAMPLE_SIZE = 20;

const storageSweepResultValidator = v.union(
  v.null(),
  v.object({
    runId: v.id("storageSweepRuns"),
    mode: v.union(v.literal("report"), v.literal("delete")),
    checked: v.number(),
    unreferenced: v.number(),
    deleted: v.number(),
    isDone: v.boolean(),
  })
);

/**
 * The daily sweep of stored files no row holds once they are a day old. The
 * case it exists for is a transcript original whose save never ran (the tab
 * closed after the upload, the connection dropped, or the release after a
 * refusal failed): the file holds interview text that project erasure can
 * never find. It looks at every file, not only transcripts.
 *
 * The admin setting `storage.sweepUnreferenced` (`storageSweepMode`)
 * decides what it does:
 * - `report` (default): counts and records what it would delete (one
 *   `storageSweepRuns` row, a log line, and a notice on the alerts board
 *   when the count changes) and deletes nothing;
 * - `delete`: deletes those files as well;
 * - `off`: does nothing.
 * The setting is read on every page, so switching away from `delete` stops
 * a run's deletions at once.
 *
 * Pages `_storage` oldest first, one bounded page per transaction, and
 * reschedules itself with the run's cut-off until done. A file counts only
 * when `isStorageReferenced` finds no row holding it through any of the
 * schema's storage fields (`STORAGE_REFERENCE_FIELDS`). Runs daily
 * (`crons.ts`); safe to run again.
 */
export const sweepUnreferencedStorage = internalMutation({
  args: {
    runId: v.optional(v.id("storageSweepRuns")),
    cursor: v.optional(v.union(v.string(), v.null())),
  },
  returns: storageSweepResultValidator,
  handler: async (ctx, args) => {
    const mode = await storageSweepMode(ctx);
    let run = args.runId ? await ctx.db.get(args.runId) : null;
    if (args.runId && (!run || run.finishedAt !== undefined)) return null;
    if (mode === "off") {
      if (run) await ctx.db.patch(run._id, { finishedAt: Date.now() });
      return null;
    }
    if (!run) {
      await pruneStorageSweepRuns(ctx);
      const now = Date.now();
      const runId = await ctx.db.insert("storageSweepRuns", {
        mode,
        before: now - UNREFERENCED_STORAGE_GRACE_MS,
        startedAt: now,
        checked: 0,
        unreferenced: 0,
        unreferencedBytes: 0,
        sampleFileIds: [],
        deleted: 0,
      });
      run = (await ctx.db.get(runId))!;
    }
    // Deletes only while both the run and the setting say so.
    const deleting = run.mode === "delete" && mode === "delete";
    const before = run.before;
    const page = await ctx.db.system
      .query("_storage")
      .withIndex("by_creation_time", (q) => q.lt("_creationTime", before))
      .paginate({ cursor: args.cursor ?? null, numItems: STORAGE_SWEEP_PAGE_SIZE });
    let unreferenced = 0;
    let bytes = 0;
    let deleted = 0;
    let oldest = run.oldestCreatedAt;
    let newest = run.newestCreatedAt;
    const sample = [...run.sampleFileIds];
    for (const file of page.page) {
      if (await isStorageReferenced(ctx, file._id)) continue;
      unreferenced += 1;
      bytes += file.size;
      oldest = oldest === undefined ? file._creationTime : Math.min(oldest, file._creationTime);
      newest = newest === undefined ? file._creationTime : Math.max(newest, file._creationTime);
      if (sample.length < STORAGE_SWEEP_SAMPLE_SIZE) sample.push(file._id);
      if (deleting) {
        await ctx.storage.delete(file._id);
        deleted += 1;
      }
    }
    const totals = {
      checked: run.checked + page.page.length,
      unreferenced: run.unreferenced + unreferenced,
      unreferencedBytes: run.unreferencedBytes + bytes,
      ...(oldest !== undefined ? { oldestCreatedAt: oldest } : {}),
      ...(newest !== undefined ? { newestCreatedAt: newest } : {}),
      sampleFileIds: sample,
      deleted: run.deleted + deleted,
    };
    if (!page.isDone) {
      await ctx.db.patch(run._id, totals);
      await ctx.scheduler.runAfter(0, internal.transcripts.sweepUnreferencedStorage, {
        runId: run._id,
        cursor: page.continueCursor,
      });
    } else {
      await ctx.db.patch(run._id, { ...totals, finishedAt: Date.now() });
      await reportStorageSweep(ctx, { ...run, ...totals });
    }
    return {
      runId: run._id,
      mode: run.mode,
      checked: page.page.length,
      unreferenced,
      deleted,
      isDone: page.isDone,
    };
  },
});

async function pruneStorageSweepRuns(ctx: MutationCtx): Promise<void> {
  const runs = await ctx.db
    .query("storageSweepRuns")
    .withIndex("by_startedAt")
    .order("desc")
    .take(STORAGE_SWEEP_RUNS_KEPT + 10);
  for (const old of runs.slice(STORAGE_SWEEP_RUNS_KEPT - 1)) await ctx.db.delete(old._id);
}

function describeBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function describeDay(at: number | undefined): string {
  return at === undefined ? "unknown" : new Date(at).toISOString().slice(0, 10);
}

/**
 * The finished run's log line, and a notice on the alerts board when a
 * report found files and the count differs from the run before, so the
 * board gets one notice per change rather than one a day.
 */
async function reportStorageSweep(ctx: MutationCtx, run: Doc<"storageSweepRuns">): Promise<void> {
  const summary =
    `${run.unreferenced} stored ${run.unreferenced === 1 ? "file is" : "files are"} more than a day old and held by no row ` +
    `(${describeBytes(run.unreferencedBytes)}, oldest ${describeDay(run.oldestCreatedAt)}, newest ${describeDay(run.newestCreatedAt)}).`;
  console.log(
    run.mode === "delete"
      ? `Storage sweep: ${summary} Deleted ${run.deleted}.`
      : `Storage sweep (report only): ${summary} Nothing was deleted.`
  );
  if (run.mode !== "report" || run.unreferenced === 0) return;
  const previous = (
    await ctx.db.query("storageSweepRuns").withIndex("by_startedAt").order("desc").take(STORAGE_SWEEP_RUNS_KEPT)
  ).find((row) => row._id !== run._id && row.finishedAt !== undefined);
  if (previous?.mode === "report" && previous.unreferenced === run.unreferenced) return;
  await ctx.db.insert("errorReports", {
    kind: "auto",
    reportType: "bug",
    // No file ids: anyone signed in can read the alerts board, and an id
    // is all it takes to attach a file. The sample stays on the admin-only
    // run row (getStorageSweepStatus).
    message:
      `Storage sweep (report only): ${summary} Nothing was deleted. ` +
      `An admin can read the run and set storage.sweepUnreferenced to "delete" to remove them.`,
    source: "storage-sweep",
    url: "/alerts",
    breadcrumbs: [],
    status: "open",
    createdAt: Date.now(),
  });
}

/** The sweep's mode and its latest run, for admins. */
export const getStorageSweepStatus = query({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, ["admin"]);
    const latest = await ctx.db.query("storageSweepRuns").withIndex("by_startedAt").order("desc").first();
    return { mode: await storageSweepMode(ctx), latestRun: latest };
  },
});

/** Removes a transcript from the project's list by archiving it. */
export const removeTranscript = mutation({
  args: { transcriptId: v.id("transcripts") },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Who may call first: an ineligible caller learns nothing about the row.
    await requireInternalActor(ctx);
    const row = await ctx.db.get(args.transcriptId);
    if (!row) domainError("NOT_FOUND", "Transcript not found");
    const { project } = await requireTranscriptChange(ctx, row.projectId, {});
    if (row.archivedAt !== undefined) return null;
    const now = Date.now();
    await ctx.db.patch(row._id, { archivedAt: now });
    await ctx.db.patch(row.projectId, {
      updatedAt: now,
      archivedTranscriptCount: (project.archivedTranscriptCount ?? 0) + 1,
    });
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
      placeholders: [
        ...(await projectPlaceholderMap(
          ctx,
          project,
          [transcript],
          samples.flatMap((sample) => sample.lines)
        )),
      ],
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
    // Review 2026-09-25: moving a speaker away from interviewer (or other)
    // brings words back that the ready facts left out, so those facts are
    // stale now (`factRunIsCurrent`) and the next request extracts again.
    const run = await findFactRun(ctx, transcript._id, await transcriptHash(transcript));
    const stale = run?.status === "ready" && !(await factRunIsCurrent(ctx, run));
    await ctx.db.patch(transcript._id, {
      speakerStatus: await speakerStatusOf(ctx, transcript._id),
      ...(stale ? { factsStatus: "none" as const } : {}),
    });
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

// ─── Facts (2026-09-24; owner decisions 25 to 27) ───────────────────────────

/**
 * The transcripts whose speakers an extraction hides: this one, then every
 * transcript of the generation (its frozen list, archived rows included) or
 * of the project, each once.
 */
async function speakerSourceTranscripts(
  ctx: QueryCtx,
  transcript: Doc<"transcripts">,
  projectId: Id<"projects">,
  generation: Doc<"generations"> | null
): Promise<Doc<"transcripts">[]> {
  const others =
    generation?.projectId === projectId && generation.transcriptIds
      ? (await Promise.all(generation.transcriptIds.map((id) => ctx.db.get(id)))).filter(
          (row): row is Doc<"transcripts"> => row !== null
        )
      : await listProjectTranscripts(ctx, projectId);
  const seen = new Set<Id<"transcripts">>([transcript._id]);
  const out = [transcript];
  for (const row of others) {
    if (seen.has(row._id)) continue;
    seen.add(row._id);
    out.push(row);
  }
  return out;
}

/**
 * What one extraction needs: the verbatim text and its hash, the turns with
 * their current roles, and the placeholder map for the call. This map is
 * the only one an extraction uses, inside a generation too: it hides the
 * names in every window and restores every answer (review 2026-09-25). It
 * covers the speakers of every transcript of the generation (or of the
 * project, outside one), so a person who speaks in one interview and is
 * named in another is hidden in both.
 */
export const factsInput = internalQuery({
  args: { transcriptId: v.id("transcripts"), generationId: v.optional(v.id("generations")) },
  handler: async (ctx, args) => {
    const transcript = await ctx.db.get(args.transcriptId);
    if (!transcript || transcript.content.trim() === "") return null;
    const project = await ctx.db.get(transcript.projectId);
    if (!project || project.deletionStartedAt !== undefined) return null;
    const generation = args.generationId ? await ctx.db.get(args.generationId) : null;
    const placeholders = (await transcriptPlaceholdersEnabled(ctx))
      ? [
          ...(await projectPlaceholderMap(
            ctx,
            project,
            await speakerSourceTranscripts(ctx, transcript, project._id, generation),
            [transcript.content]
          )),
        ]
      : [];
    const { turns, parserVersion: turnsVersion } = await loadFactTurns(ctx, transcript._id);
    return {
      projectId: project._id,
      label: transcriptLabel(transcript),
      content: transcript.content,
      sourceContentHash: await transcriptHash(transcript),
      // Ready only when every turn was built with the current parser
      // version: never mid-rebuild (2026-09-25), and never turns an older
      // parser built (a stale row is rebuilt when facts are requested).
      structureReady:
        transcript.parserVersion === TRANSCRIPT_PARSER_VERSION && turnsVersion === TRANSCRIPT_PARSER_VERSION,
      parserVersion: transcript.parserVersion,
      turns,
      // Recorded on the run, so a later role correction makes it stale.
      excludedLabels: excludedSpeakerLabels(turns),
      placeholders,
    };
  },
});

/**
 * Claims one extraction of this exact text under the current FACTS_VERSION.
 * `ready` means facts exist and nothing needs to run; `busy` means another
 * run started recently. A claim clears facts a failed or stale run left.
 */
export const claimFactRun = internalMutation({
  args: {
    transcriptId: v.id("transcripts"),
    sourceContentHash: v.string(),
    model: v.string(),
    adapter: v.union(v.literal("citations"), v.literal("structured")),
    excludedLabels: v.optional(v.array(v.string())),
    parserVersion: v.optional(v.string()),
  },
  returns: v.union(
    v.object({ kind: v.literal("ready") }),
    v.object({ kind: v.literal("busy") }),
    v.object({ kind: v.literal("gone") }),
    v.object({ kind: v.literal("claimed"), runId: v.id("transcriptFactRuns") })
  ),
  handler: async (ctx, args) => {
    const transcript = await ctx.db.get(args.transcriptId);
    if (!transcript || (await isProjectDeleting(ctx, transcript.projectId))) return { kind: "gone" as const };
    const run = await findFactRun(ctx, transcript._id, args.sourceContentHash);
    const now = Date.now();
    // A ready run whose left-out speakers have since become clients is
    // stale: its facts are cleared and extracted again.
    if (run && (await factRunIsCurrent(ctx, run))) return { kind: "ready" as const };
    if (run && (run.status === "running" || run.status === "queued") && now - run.startedAt < FACT_RUN_STALE_MS) {
      return { kind: "busy" as const };
    }
    for (const fact of await listFacts(ctx, transcript._id)) await ctx.db.delete(fact._id);
    const runId = await ctx.db.insert("transcriptFactRuns", {
      transcriptId: transcript._id,
      projectId: transcript.projectId,
      sourceContentHash: args.sourceContentHash,
      factsVersion: FACTS_VERSION,
      model: args.model,
      adapter: args.adapter,
      status: "running",
      counts: { proposed: 0, verified: 0, dropped: 0 },
      startedAt: now,
      ...(args.excludedLabels ? { excludedLabels: args.excludedLabels } : {}),
      ...(args.parserVersion !== undefined ? { parserVersion: args.parserVersion } : {}),
    });
    await ctx.db.patch(transcript._id, { factsStatus: "queued" });
    return { kind: "claimed" as const, runId };
  },
});

const factValidator = v.object({
  key: v.string(),
  type: transcriptFactTypeValidator,
  claim: v.string(),
  turnIndexes: v.array(v.number()),
  quotes: v.array(
    v.object({
      charStart: v.number(),
      charEnd: v.number(),
      exactExcerpt: v.string(),
      match: v.union(v.literal("exact"), v.literal("normalized")),
    })
  ),
  speakerLabel: v.optional(v.string()),
  confidence: v.number(),
});

/** Writes one batch of verified facts for a claimed run. */
export const recordFactBatch = internalMutation({
  args: { runId: v.id("transcriptFactRuns"), facts: v.array(factValidator) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || run.status !== "running") return null;
    const transcript = await ctx.db.get(run.transcriptId);
    if (!transcript || (await isProjectDeleting(ctx, transcript.projectId))) return null;
    for (const fact of args.facts.slice(0, MAX_FACTS_PER_TRANSCRIPT)) {
      // The verifier already byte-checked every quote; the stored text is
      // the ground truth, so check once more against it before writing.
      if (fact.quotes.some((quote) => transcript.content.slice(quote.charStart, quote.charEnd) !== quote.exactExcerpt)) {
        continue;
      }
      await ctx.db.insert("transcriptFacts", {
        transcriptId: transcript._id,
        projectId: transcript.projectId,
        sourceContentHash: run.sourceContentHash,
        factsVersion: run.factsVersion,
        ...fact,
      });
    }
    return null;
  },
});

export const completeFactRun = internalMutation({
  args: {
    runId: v.id("transcriptFactRuns"),
    counts: v.object({ proposed: v.number(), verified: v.number(), dropped: v.number() }),
    usage: v.optional(
      v.object({ inputTokens: v.number(), outputTokens: v.number(), costUsd: v.optional(v.number()) })
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || run.status !== "running") return null;
    await ctx.db.patch(run._id, {
      status: "ready",
      counts: args.counts,
      ...(args.usage ? { usage: args.usage } : {}),
      finishedAt: Date.now(),
    });
    const transcript = await ctx.db.get(run.transcriptId);
    if (transcript) await ctx.db.patch(transcript._id, { factsStatus: "ready", factsVersion: run.factsVersion });
    return null;
  },
});

export const failFactRun = internalMutation({
  args: { runId: v.id("transcriptFactRuns"), error: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || run.status !== "running") return null;
    await ctx.db.patch(run._id, { status: "failed", error: args.error.slice(0, 500), finishedAt: Date.now() });
    const transcript = await ctx.db.get(run.transcriptId);
    if (transcript) await ctx.db.patch(transcript._id, { factsStatus: "failed" });
    return null;
  },
});

/**
 * A consultant opened a transcript: extract its facts in the background if
 * the transcript method is on and they do not exist yet. Silent otherwise.
 */
export const requestTranscriptFacts = mutation({
  args: { transcriptId: v.id("transcripts") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const transcript = await ctx.db.get(args.transcriptId);
    if (!transcript || transcript.archivedAt !== undefined) return null;
    if (!(await getInternalProjectAccessOrNull(ctx, transcript.projectId))) return null;
    if ((await transcriptFactsMode(ctx)) === "off") return null;
    // Facts read turns. Turns an older parser built, or a build still
    // running, are not ready: rebuild if nothing holds the row, and extract
    // on the next open rather than queue an extraction that cannot run.
    if (transcript.parserVersion !== TRANSCRIPT_PARSER_VERSION) {
      await scheduleStructureRebuildIfStale(ctx, transcript);
      return null;
    }
    const run = await findFactRun(ctx, transcript._id, await transcriptHash(transcript));
    if (run && (await factRunIsCurrent(ctx, run))) return null;
    // A recent attempt that is still running or just failed is left alone;
    // a ready run made stale by a role correction is extracted again now.
    if (run && run.status !== "ready" && Date.now() - run.startedAt < FACT_RUN_STALE_MS) return null;
    await ctx.db.patch(transcript._id, { factsStatus: "queued" });
    await ctx.scheduler.runAfter(0, internal.ai.condense.extractTranscriptFactsInBackground, {
      transcriptId: transcript._id,
    });
    return null;
  },
});

/** Facts one copy step writes. */
const FACT_COPY_BATCH = 200;

/**
 * Copies ready facts from another row holding the same text (a duplicated
 * project, or the same transcript added to another project). No model call.
 * Bounded batches, rescheduling itself; idempotent through the run row.
 */
export const copyTranscriptFacts = internalMutation({
  args: {
    fromTranscriptId: v.id("transcripts"),
    toTranscriptId: v.id("transcripts"),
    offset: v.optional(v.number()),
    runId: v.optional(v.id("transcriptFactRuns")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const [source, target] = await Promise.all([ctx.db.get(args.fromTranscriptId), ctx.db.get(args.toTranscriptId)]);
    if (!source || !target || (await isProjectDeleting(ctx, target.projectId))) return null;
    const hash = await transcriptHash(source);
    if ((await transcriptHash(target)) !== hash) return null;
    const sourceRun = await findFactRun(ctx, source._id, hash);
    if (!sourceRun || !(await factRunIsCurrent(ctx, sourceRun))) return null;
    let runId = args.runId;
    if (!runId) {
      const existing = await findFactRun(ctx, target._id, hash);
      if (existing?.status === "ready" || existing?.status === "running") return null;
      runId = await ctx.db.insert("transcriptFactRuns", {
        transcriptId: target._id,
        projectId: target.projectId,
        sourceContentHash: hash,
        factsVersion: FACTS_VERSION,
        model: sourceRun.model,
        adapter: "copy",
        status: "running",
        counts: sourceRun.counts,
        startedAt: Date.now(),
        ...(sourceRun.excludedLabels ? { excludedLabels: sourceRun.excludedLabels } : {}),
        // Stale on the copy if its turns are built with another version.
        ...(sourceRun.parserVersion !== undefined ? { parserVersion: sourceRun.parserVersion } : {}),
      });
    }
    const facts = (await listFacts(ctx, source._id)).sort((a, b) => a.key.localeCompare(b.key));
    const offset = args.offset ?? 0;
    for (const fact of facts.slice(offset, offset + FACT_COPY_BATCH)) {
      const { _id, _creationTime, transcriptId: _t, projectId: _p, ...rest } = fact;
      await ctx.db.insert("transcriptFacts", { ...rest, transcriptId: target._id, projectId: target.projectId });
    }
    if (offset + FACT_COPY_BATCH < facts.length) {
      await ctx.scheduler.runAfter(0, internal.transcripts.copyTranscriptFacts, {
        ...args,
        offset: offset + FACT_COPY_BATCH,
        runId,
      });
      return null;
    }
    await ctx.db.patch(runId, { status: "ready", finishedAt: Date.now() });
    await ctx.db.patch(target._id, { factsStatus: "ready", factsVersion: FACTS_VERSION });
    return null;
  },
});
