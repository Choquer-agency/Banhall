import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { domainError, sha256 } from "./contracts";
import { isStorageReferenced } from "./storage";
import {
  TRANSCRIPT_PARSER_VERSION,
  type TranscriptSourceFormat,
} from "../../shared/transcriptParse";

type Ctx = QueryCtx | MutationCtx;

/** A project may carry at most this many transcripts. */
export const MAX_TRANSCRIPTS_PER_PROJECT = 20;

/**
 * Combined character cap across a project's transcripts. `reserveGeneration`
 * freezes every transcript into a `generationSources` row inside one mutation,
 * and Convex bounds the bytes a transaction may write; 20 rows at the browser's
 * per-file cap would approach that bound. `projects.createProject` enforces it
 * before it writes any row.
 */
export const MAX_TOTAL_TRANSCRIPT_CHARS = 2_000_000;

/** Per-transcript slice frozen into a `generationSources` row. */
export const FROZEN_TRANSCRIPT_CHARS = 500_000;

/**
 * 2026-09-24 (transcript method): one transcript's text may not exceed the
 * frozen slice, so freezing never cuts a new transcript and every turn and
 * fact offset stays valid on the frozen row. Rows written before the cap
 * keep working; generation still freezes their first 500 000 characters.
 */
export const MAX_TRANSCRIPT_CHARS = FROZEN_TRANSCRIPT_CHARS;

/** Largest uploaded original transcript file kept in storage. */
export const MAX_TRANSCRIPT_FILE_BYTES = 25 * 1024 * 1024;

/**
 * Rows one project's transcript history may hold, active and archived.
 * Replace archives rather than deletes, so Add and Replace refuse once a
 * project reaches it. Archived rows are counted on the project
 * (`projects.archivedTranscriptCount`), never read, to enforce it.
 */
export const MAX_TRANSCRIPT_HISTORY_ROWS = 200;

/**
 * Active rows one project read takes: the 20 transcripts plus room for the
 * empty placeholder rows older creation paths wrote.
 */
export const MAX_ACTIVE_TRANSCRIPT_ROWS_READ = 50;

/**
 * Combined frozen transcript characters above which a generation condenses
 * each transcript into a stored digest instead of feeding the full text.
 *
 * The three condensation sizes live here, not in the prompt program:
 * `convex/generations.ts` decides the mode in the default runtime and
 * `convex/ai/promptProgram.ts` is a `"use node"` module, so the program reads
 * them from here into `configuration.transcripts`. Starting values, not
 * measured.
 */
export const TRANSCRIPT_BUDGET_CHARS = 200_000;

/** Longest slice of one transcript a single condense call is given. */
export const CONDENSE_WINDOW_CHARS = 160_000;

/** Length the condense prompt asks each digest to land near. */
export const DIGEST_TARGET_CHARS = 24_000;

/**
 * Bumped by hand whenever the condense prompt, the digest schema or the size
 * constants change, so stored digests built under the old contract are never
 * reused. Part of the `transcriptDigests` lookup key.
 */
export const CONDENSE_VERSION = "1";

/** Label shown for rows written before transcripts carried one. */
export const DEFAULT_TRANSCRIPT_LABEL = "Interview transcript";

export type TranscriptMetadata = {
  _id: Id<"transcripts">;
  label: string;
  position?: number;
  createdAt: number;
  charCount: number;
  wordCount: number;
  contentHash?: string;
  sourceFormat?: TranscriptSourceFormat;
  speakerStatus?: "unchecked" | "needs_check" | "confirmed";
  factsStatus?: "none" | "queued" | "ready" | "failed";
  hasOriginal?: boolean;
};

export type TranscriptPart = { label: string; content: string };

export function transcriptLabel(doc: Doc<"transcripts">): string {
  return doc.label ?? DEFAULT_TRANSCRIPT_LABEL;
}

export function transcriptMetadata(
  doc: Doc<"transcripts">
): TranscriptMetadata {
  const trimmed = doc.content.trim();
  return {
    _id: doc._id,
    label: transcriptLabel(doc),
    position: doc.position,
    createdAt: doc.createdAt,
    charCount: doc.content.length,
    wordCount: trimmed === "" ? 0 : trimmed.split(/\s+/).length,
    contentHash: doc.contentHash,
    ...(doc.sourceFormat ? { sourceFormat: doc.sourceFormat } : {}),
    ...(doc.speakerStatus ? { speakerStatus: doc.speakerStatus } : {}),
    ...(doc.factsStatus ? { factsStatus: doc.factsStatus } : {}),
    ...(doc.originalStorageId ? { hasOriginal: true } : {}),
  };
}

/**
 * The one definition of "a project's transcripts": ordered by `position` then
 * `createdAt` then `_id`, with empty rows dropped (ingestion writes a
 * placeholder row with empty content), archived rows dropped, and at most
 * `MAX_TRANSCRIPTS_PER_PROJECT` returned. Full documents, because server-side
 * callers need the text; clients read metadata through `listTranscripts` and
 * one body at a time through `getTranscriptContent`.
 */
export async function listProjectTranscripts(
  ctx: Ctx,
  projectId: Id<"projects">
): Promise<Doc<"transcripts">[]> {
  return projectTranscriptsFrom(await listActiveTranscriptRows(ctx, projectId));
}

/**
 * Every row of a project that is not archived, empty placeholder rows
 * included, in index order. Archived rows (Replace and Remove, 2026-09-24)
 * stay whole for the generations that froze them but are not the project's
 * transcripts any more, and they are never read here: the index range stops
 * at `archivedAt` absent, so a project's reads do not grow with its history.
 */
export async function listActiveTranscriptRows(
  ctx: Ctx,
  projectId: Id<"projects">
): Promise<Doc<"transcripts">[]> {
  return await ctx.db
    .query("transcripts")
    .withIndex("by_projectId_and_archivedAt", (q) =>
      q.eq("projectId", projectId).eq("archivedAt", undefined)
    )
    .take(MAX_ACTIVE_TRANSCRIPT_ROWS_READ);
}

/** A project's transcripts out of its active rows, as `listProjectTranscripts` returns them. */
export function projectTranscriptsFrom(
  rows: readonly Doc<"transcripts">[]
): Doc<"transcripts">[] {
  return rows
    .filter((row) => row.content.trim() !== "" && row.archivedAt === undefined)
    .sort(compareTranscripts)
    .slice(0, MAX_TRANSCRIPTS_PER_PROJECT);
}

/**
 * The frozen transcript set of a generation, in the order it was fed to the
 * model. A generation written before the set existed carries only
 * `transcriptId`, which is that same set of one; a docs-only generation
 * carries an empty set, which is not the same as an unknown one.
 */
export function generationTranscriptIds(
  generation:
    | Pick<Doc<"generations">, "transcriptId" | "transcriptIds">
    | undefined
    | null
): Id<"transcripts">[] | undefined {
  if (!generation) return undefined;
  if (generation.transcriptIds) return generation.transcriptIds;
  return generation.transcriptId ? [generation.transcriptId] : undefined;
}

function compareTranscripts(a: Doc<"transcripts">, b: Doc<"transcripts">) {
  const positionDelta =
    (a.position ?? Number.POSITIVE_INFINITY) -
    (b.position ?? Number.POSITIVE_INFINITY);
  if (positionDelta !== 0 && !Number.isNaN(positionDelta)) return positionDelta;
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  return a._id < b._id ? -1 : a._id > b._id ? 1 : 0;
}

/**
 * Prompt text for a set of transcripts. A single transcript is passed through
 * byte-for-byte, so a one-transcript project produces exactly the text it does
 * today and provenance offsets keep pointing at the frozen source row.
 */
export function buildTranscriptPromptText(parts: TranscriptPart[]): string {
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0].content;
  return parts
    .map(
      (part, index) =>
        `=== Transcript ${index + 1}: ${part.label} ===\n${part.content}`
    )
    .join("\n\n");
}

/**
 * A project's transcripts as one prompt string: the definition every backend
 * reader shares, so the review agent and the science-code suggester see the
 * same text a generation freezes.
 */
export async function projectTranscriptPromptText(
  ctx: Ctx,
  projectId: Id<"projects">
): Promise<string> {
  const rows = await listProjectTranscripts(ctx, projectId);
  return buildTranscriptPromptText(
    rows.map((row) => ({ label: transcriptLabel(row), content: row.content }))
  );
}

/**
 * Locates a verbatim quote inside one part, so a claim can be cited against the
 * frozen source row it actually came from rather than the assembled prompt.
 * First match wins.
 */
export function findQuoteInParts(
  parts: TranscriptPart[],
  quote: string
): { partIndex: number; startOffset: number } | null {
  if (quote === "") return null;
  for (let partIndex = 0; partIndex < parts.length; partIndex++) {
    const startOffset = parts[partIndex].content.indexOf(quote);
    if (startOffset !== -1) return { partIndex, startOffset };
  }
  return null;
}

/** A frozen transcript source row, ready to be cited. */
export type TranscriptPromptPart = TranscriptPart & {
  sourceId: Id<"generationSources">;
  contentHash: string;
};

export type TranscriptCitation = {
  generationSourceId: Id<"generationSources">;
  sourceContentHash: string;
  exactExcerpt: string;
  startOffset: number;
  endOffset: number;
};

/**
 * Resolves one claim's supporting quote to the frozen source row it came from.
 * The offsets are relative to that row's content, which is what
 * `reports.createProvenance` byte-checks; an offset into the assembled prompt
 * text would point past the headers and be rejected.
 */
export function mapClaimToPart(
  parts: TranscriptPromptPart[],
  claim: { sourceQuote?: string }
): TranscriptCitation | null {
  if (!claim.sourceQuote) return null;
  const found = findQuoteInParts(parts, claim.sourceQuote);
  if (!found) return null;
  const part = parts[found.partIndex];
  return {
    generationSourceId: part.sourceId,
    sourceContentHash: part.contentHash,
    exactExcerpt: claim.sourceQuote,
    startOffset: found.startOffset,
    endOffset: found.startOffset + claim.sourceQuote.length,
  };
}

/** The generation progress log's first line, shared by both pipelines. */
export function describeTranscriptInput(parts: TranscriptPart[]): string {
  const words = parts.reduce(
    (total, part) => total + part.content.split(/\s+/).filter(Boolean).length,
    0
  );
  if (words === 0) {
    return "No interview transcript — drafting from context documents only.";
  }
  const count = words.toLocaleString();
  return parts.length === 1
    ? `Read frozen interview transcript — ${count} words.`
    : `Read ${parts.length} frozen interview transcripts — ${count} words.`;
}

/**
 * Writes one transcript row with its hash, in list position. Empty text is not
 * a transcript: the row is skipped and `null` comes back, so a project created
 * from context documents alone carries no transcript rows at all.
 *
 * 2026-09-24: schedules the server-side turn and speaker build
 * (`transcripts.buildTranscriptStructure`); turns are never taken from the
 * client.
 */
export async function insertTranscriptRow(
  ctx: MutationCtx,
  args: {
    projectId: Id<"projects">;
    content: string;
    label?: string;
    position: number;
    sourceFormat?: TranscriptSourceFormat;
    originalStorageId?: Id<"_storage">;
  }
): Promise<Id<"transcripts"> | null> {
  if (args.content.trim() === "") return null;
  const transcriptId = await ctx.db.insert("transcripts", {
    projectId: args.projectId,
    content: args.content,
    label: args.label ?? DEFAULT_TRANSCRIPT_LABEL,
    position: args.position,
    contentHash: await sha256(args.content),
    createdAt: Date.now(),
    ...(args.sourceFormat ? { sourceFormat: args.sourceFormat } : {}),
    ...(args.originalStorageId ? { originalStorageId: args.originalStorageId } : {}),
  });
  await scheduleTranscriptStructure(ctx, transcriptId);
  return transcriptId;
}

/**
 * Copies an existing transcript into another project by reference: the text
 * never leaves the backend, so the duplicate wizard does not download and
 * re-upload a megabyte of interview.
 *
 * 2026-09-24: turns are rebuilt from the copied text (deterministic, no model
 * call), and the source's confirmed or model-placed speaker roles come along
 * (`adoptDerivedRows`). The original file stays with the source row.
 */
export async function copyTranscriptRow(
  ctx: MutationCtx,
  source: Doc<"transcripts">,
  args: { projectId: Id<"projects">; position: number }
): Promise<Id<"transcripts">> {
  const transcriptId = await ctx.db.insert("transcripts", {
    projectId: args.projectId,
    content: source.content,
    label: transcriptLabel(source),
    position: args.position,
    contentHash: source.contentHash ?? (await sha256(source.content)),
    createdAt: Date.now(),
    ...(source.sourceFormat ? { sourceFormat: source.sourceFormat } : {}),
  });
  await adoptDerivedRows(ctx, transcriptId, source);
  await scheduleTranscriptStructure(ctx, transcriptId);
  return transcriptId;
}

/**
 * A build chain older than this that never finished (its step threw, say)
 * no longer holds the transcript: the backfill or a facts request may start
 * a new one.
 */
export const STRUCTURE_BUILD_STALE_MS = 10 * 60_000;

/** A fresh build chain id: its start time, then random hex. */
export function newStructureBuildId(now = Date.now()): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return `${now.toString(36)}-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/** When the chain holding this id started; undefined for an id without a time. */
export function structureBuildStartedAt(buildId: string | undefined): number | undefined {
  const match = buildId ? /^([0-9a-z]+)-[0-9a-f]+$/.exec(buildId) : null;
  if (!match) return undefined;
  const at = parseInt(match[1], 36);
  return Number.isFinite(at) ? at : undefined;
}

/** Whether a build chain holds this transcript right now. */
export function structureBuildIsLive(transcript: Doc<"transcripts">, now = Date.now()): boolean {
  const started = structureBuildStartedAt(transcript.structureBuildId);
  return started !== undefined && now - started < STRUCTURE_BUILD_STALE_MS;
}

/**
 * Starts the turn build of a new row, asking for the model's look at
 * speakers. The row is marked before the build is scheduled, so the backfill
 * leaves it to this build and a chain that takes it over still asks.
 */
export async function scheduleTranscriptStructure(
  ctx: MutationCtx,
  transcriptId: Id<"transcripts">
): Promise<void> {
  await ctx.db.patch(transcriptId, {
    structureBuildId: newStructureBuildId(),
    structureModelRoles: true,
  });
  await ctx.scheduler.runAfter(0, internal.transcripts.buildTranscriptStructure, {
    transcriptId,
    modelRoles: true,
  });
}

/**
 * Schedules a rule-only rebuild of a row whose turns are not at the current
 * parser version, unless a build already holds it. Marks the row first, so
 * repeated calls schedule once. Returns whether it scheduled one.
 */
export async function scheduleStructureRebuildIfStale(
  ctx: MutationCtx,
  transcript: Doc<"transcripts">
): Promise<boolean> {
  if (transcript.parserVersion === TRANSCRIPT_PARSER_VERSION) return false;
  if (transcript.archivedAt !== undefined || transcript.content.trim() === "") return false;
  const now = Date.now();
  if (structureBuildIsLive(transcript, now)) return false;
  await ctx.db.patch(transcript._id, { structureBuildId: newStructureBuildId(now) });
  await ctx.scheduler.runAfter(0, internal.transcripts.buildTranscriptStructure, {
    transcriptId: transcript._id,
  });
  return true;
}

/** Speaker rows a copy may carry over. */
const ADOPT_SPEAKER_LIMIT = 100;

/**
 * Carries what was learned about a transcript's text to a new row holding the
 * same text: speaker roles a consultant confirmed or the model placed, and
 * its verified facts (`transcripts.copyTranscriptFacts`, scheduled). No
 * model call. Rule-based roles are not copied; the rebuild derives
 * them again against the new project's names.
 */
export async function adoptDerivedRows(
  ctx: MutationCtx,
  transcriptId: Id<"transcripts">,
  source: Doc<"transcripts">
): Promise<void> {
  const target = await ctx.db.get(transcriptId);
  if (!target) return;
  const speakers = await ctx.db
    .query("transcriptSpeakers")
    .withIndex("by_transcriptId_and_label", (q) => q.eq("transcriptId", source._id))
    .take(ADOPT_SPEAKER_LIMIT);
  // Ready facts of the same text come along in the background, batched.
  await ctx.scheduler.runAfter(0, internal.transcripts.copyTranscriptFacts, {
    fromTranscriptId: source._id,
    toTranscriptId: transcriptId,
  });
  for (const row of speakers) {
    if (row.roleSource === "heuristic") continue;
    await ctx.db.insert("transcriptSpeakers", {
      transcriptId,
      projectId: target.projectId,
      label: row.label,
      role: row.role,
      roleSource: row.roleSource,
      confidence: row.confidence,
      turnCount: row.turnCount,
      ...(row.sampleTurnIndex !== undefined ? { sampleTurnIndex: row.sampleTurnIndex } : {}),
      ...(row.confirmedBy ? { confirmedBy: row.confirmedBy } : {}),
      ...(row.confirmedAt ? { confirmedAt: row.confirmedAt } : {}),
    });
  }
}

/** Refuses text longer than one transcript may hold. */
export function requireTranscriptTextWithinCap(content: string): void {
  if (content.length > MAX_TRANSCRIPT_CHARS) {
    domainError(
      "INVALID_INPUT",
      `A transcript can hold at most ${MAX_TRANSCRIPT_CHARS.toLocaleString("en-US")} characters. Split it into two transcripts.`
    );
  }
}

/**
 * The uploaded original file, if it exists, fits the file limit and no row
 * holds it yet. A file over the limit is refused (the client checks the size
 * before uploading). A file another row already holds is refused too: the
 * transcript's reference would keep that row's file alive when its own
 * project is erased (`deleteStorageIfUnreferenced`).
 */
export async function validatedOriginalStorage(
  ctx: MutationCtx,
  storageId: Id<"_storage">
): Promise<Id<"_storage">> {
  const metadata = await ctx.db.system.get("_storage", storageId);
  if (!metadata) domainError("INVALID_INPUT", "The uploaded transcript file was not found");
  if (metadata.size > MAX_TRANSCRIPT_FILE_BYTES) {
    domainError("INVALID_INPUT", "A transcript file can be at most 25 MB");
  }
  if (await isStorageReferenced(ctx, storageId)) {
    domainError("INVALID_INPUT", "The uploaded transcript file is already in use. Upload it again.");
  }
  return storageId;
}
