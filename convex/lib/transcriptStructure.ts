/**
 * Server-side turn and speaker structure of one transcript (phase 3, the
 * transcript method). Turns are always parsed here from the stored text,
 * never taken from the client, and written in bounded batches so a
 * 500 000-character transcript never approaches a transaction's write limit.
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  parseTranscriptTurns,
  TRANSCRIPT_PARSER_VERSION,
  type TranscriptTurn,
} from "../../shared/transcriptParse";
import { listTeamRoster, userDisplayLabel } from "./teamRoster";
import {
  inferSpeakerRoles,
  needsModelRole,
  type SpeakerRoleContext,
  type SpeakerRoleGuess,
} from "./transcriptSpeakers";

/** Turn rows written by one mutation. */
export const TURN_BATCH_SIZE = 400;

/** Old-version turn rows deleted by one mutation before a rebuild. */
export const TURN_DELETE_BATCH_SIZE = 500;

/** Speaker labels one transcript may carry rows for. */
export const MAX_SPEAKERS_PER_TRANSCRIPT = 100;

type Ctx = QueryCtx | MutationCtx;

/** Names the role rules match labels against. */
export async function speakerRoleContext(
  ctx: Ctx,
  project: Doc<"projects">
): Promise<SpeakerRoleContext> {
  const roster = await listTeamRoster(ctx);
  const staffNames = [
    project.interviewer,
    project.writer,
    ...roster.map((user) => userDisplayLabel(user)),
  ].filter((name): name is string => !!name && name.trim().length >= 2);
  const clientNames = (project.interviewees ?? []).filter((name) => name.trim().length >= 2);
  return { staffNames, clientNames };
}

export type StructureStep =
  | { kind: "missing" }
  | { kind: "current" }
  /** A newer chain took this transcript's build over; this chain stops. */
  | { kind: "superseded" }
  | { kind: "continue"; fromIndex: number; buildId: string }
  | { kind: "done"; needsModelRoles: boolean };

function newBuildId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * One bounded step of building a transcript's turns and speakers. Call
 * without `buildId` to start a chain, then with whatever `continue` returns
 * until `done`.
 *
 * Every insert and the backfill start a chain, so two can run for the same
 * transcript. The chain that starts last owns the build: it stamps its id on
 * the transcript and starts over from no turns, and every step of an older
 * chain finds another id there and stops without writing. Only the owning
 * chain's own complete set of turns is ever marked current. A step replayed
 * within its chain inserts only the turns still missing, and a transcript
 * already at the current parser version is left alone.
 */
export async function buildStructureStep(
  ctx: MutationCtx,
  transcriptId: Id<"transcripts">,
  fromIndex: number,
  buildId?: string
): Promise<StructureStep> {
  const transcript = await ctx.db.get(transcriptId);
  if (!transcript || transcript.content.trim() === "") return { kind: "missing" };
  if (transcript.parserVersion === TRANSCRIPT_PARSER_VERSION) return { kind: "current" };

  let chain = buildId;
  if (chain === undefined) {
    chain = newBuildId();
    await ctx.db.patch(transcript._id, { structureBuildId: chain });
    fromIndex = 0;
  } else if (transcript.structureBuildId !== chain) {
    return { kind: "superseded" };
  }

  if (fromIndex === 0) {
    // A (re)build starts from no turns: rows of an older parser version, or
    // of a chain that stopped part way, go first, in bounded batches.
    const stale = await ctx.db
      .query("transcriptTurns")
      .withIndex("by_transcriptId_and_index", (q) => q.eq("transcriptId", transcriptId))
      .take(TURN_DELETE_BATCH_SIZE);
    for (const turn of stale) await ctx.db.delete(turn._id);
    if (stale.length === TURN_DELETE_BATCH_SIZE) return { kind: "continue", fromIndex: 0, buildId: chain };
  }

  const turns = parseTranscriptTurns(transcript.content);
  const batch = turns.slice(fromIndex, fromIndex + TURN_BATCH_SIZE);
  if (batch.length > 0) {
    const existing = await ctx.db
      .query("transcriptTurns")
      .withIndex("by_transcriptId_and_index", (q) =>
        q
          .eq("transcriptId", transcriptId)
          .gte("index", fromIndex)
          .lt("index", fromIndex + TURN_BATCH_SIZE)
      )
      .take(TURN_BATCH_SIZE);
    const present = new Set(
      existing
        .filter((turn) => turn.parserVersion === TRANSCRIPT_PARSER_VERSION)
        .map((turn) => turn.index)
    );
    for (const turn of batch) {
      if (present.has(turn.index)) continue;
      await ctx.db.insert("transcriptTurns", turnRow(transcript, turn));
    }
  }
  if (fromIndex + TURN_BATCH_SIZE < turns.length) {
    return { kind: "continue", fromIndex: fromIndex + TURN_BATCH_SIZE, buildId: chain };
  }

  const project = await ctx.db.get(transcript.projectId);
  const guesses = project
    ? inferSpeakerRoles(turns, await speakerRoleContext(ctx, project))
    : inferSpeakerRoles(turns, { staffNames: [], clientNames: [] });
  const needsModelRoles = await upsertSpeakers(ctx, transcript, guesses);
  await ctx.db.patch(transcript._id, {
    parserVersion: TRANSCRIPT_PARSER_VERSION,
    structureBuildId: undefined,
    speakerStatus: guesses.length === 0 ? "unchecked" : await speakerStatusOf(ctx, transcript._id),
  });
  return { kind: "done", needsModelRoles };
}

function turnRow(transcript: Doc<"transcripts">, turn: TranscriptTurn) {
  return {
    transcriptId: transcript._id,
    projectId: transcript.projectId,
    parserVersion: TRANSCRIPT_PARSER_VERSION,
    index: turn.index,
    ...(turn.speakerLabel !== undefined ? { speakerLabel: turn.speakerLabel } : {}),
    ...(turn.startMs !== undefined ? { startMs: turn.startMs } : {}),
    ...(turn.endMs !== undefined ? { endMs: turn.endMs } : {}),
    charStart: turn.charStart,
    charEnd: turn.charEnd,
    cleanText: turn.cleanText,
  };
}

export async function listSpeakerRows(
  ctx: Ctx,
  transcriptId: Id<"transcripts">
): Promise<Doc<"transcriptSpeakers">[]> {
  return await ctx.db
    .query("transcriptSpeakers")
    .withIndex("by_transcriptId_and_label", (q) => q.eq("transcriptId", transcriptId))
    .take(MAX_SPEAKERS_PER_TRANSCRIPT);
}

/**
 * Writes the rule-based roles. A role a consultant set, or one the model
 * placed, survives a rebuild; labels the new parse no longer finds are
 * removed. Returns whether any label still needs the model's look.
 */
export async function upsertSpeakers(
  ctx: MutationCtx,
  transcript: Doc<"transcripts">,
  guesses: readonly SpeakerRoleGuess[]
): Promise<boolean> {
  const rows = await listSpeakerRows(ctx, transcript._id);
  const byLabel = new Map(rows.map((row) => [row.label, row]));
  const labels = new Set(guesses.map((guess) => guess.label));
  for (const row of rows) {
    if (!labels.has(row.label)) await ctx.db.delete(row._id);
  }
  let needsModel = false;
  for (const guess of guesses.slice(0, MAX_SPEAKERS_PER_TRANSCRIPT)) {
    const row = byLabel.get(guess.label);
    const counts = {
      turnCount: guess.turnCount,
      ...(guess.sampleTurnIndex !== undefined ? { sampleTurnIndex: guess.sampleTurnIndex } : {}),
    };
    if (row && row.roleSource !== "heuristic") {
      await ctx.db.patch(row._id, counts);
      continue;
    }
    if (needsModelRole(guess)) needsModel = true;
    const fields = {
      role: guess.role,
      roleSource: "heuristic" as const,
      confidence: guess.confidence,
      ...counts,
    };
    if (row) await ctx.db.patch(row._id, fields);
    else {
      await ctx.db.insert("transcriptSpeakers", {
        transcriptId: transcript._id,
        projectId: transcript.projectId,
        label: guess.label,
        ...fields,
      });
    }
  }
  return needsModel;
}

/** `confirmed` once a consultant set every label; otherwise `needs_check`. */
export async function speakerStatusOf(
  ctx: Ctx,
  transcriptId: Id<"transcripts">
): Promise<"unchecked" | "needs_check" | "confirmed"> {
  const rows = await listSpeakerRows(ctx, transcriptId);
  if (rows.length === 0) return "unchecked";
  return rows.every((row) => row.roleSource === "consultant") ? "confirmed" : "needs_check";
}

/** Role of every speaker label of a transcript, for render and verification. */
export async function speakerRoleMap(
  ctx: Ctx,
  transcriptId: Id<"transcripts">
): Promise<Map<string, Doc<"transcriptSpeakers">["role"]>> {
  const rows = await listSpeakerRows(ctx, transcriptId);
  return new Map(rows.map((row) => [row.label, row.role]));
}
