/**
 * Server-side turn and speaker structure of one transcript (phase 3, the
 * transcript method). Turns are always parsed here from the stored text,
 * never taken from the client, and written in bounded batches so a
 * 500 000-character transcript never approaches a transaction's write limit.
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  isCueRender,
  parseTranscriptTurns,
  rawLabelForms,
  TRANSCRIPT_PARSER_VERSION,
  transcriptSpeakerNames,
  type TranscriptTurn,
} from "../../shared/transcriptParse";
import { listTeamRoster, userDisplayLabel } from "./teamRoster";
import { FROZEN_TRANSCRIPT_CHARS, newStructureBuildId } from "./transcripts";
import {
  inferSpeakerRoles,
  MODEL_ROLE_THRESHOLD,
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
  const named = (name: string | undefined): name is string => !!name && name.trim().length >= 2;
  // The project record first; the roster only after it (transcriptSpeakers).
  const staffNames = [project.interviewer, project.writer].filter(named);
  const clientNames = (project.interviewees ?? []).filter(named);
  const rosterNames = roster.map((user) => userDisplayLabel(user)).filter(named);
  return { staffNames, clientNames, rosterNames };
}

export type StructureStep =
  | { kind: "missing" }
  | { kind: "current" }
  /** A newer chain took this transcript's build over; this chain stops. */
  | { kind: "superseded" }
  | { kind: "continue"; fromIndex: number; buildId: string }
  /** `modelRoles`: an upload asked for the model's look at speakers. */
  | { kind: "done"; needsModelRoles: boolean; modelRoles: boolean };

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
 *
 * An upload's request for the model's look at speakers (`modelRoles`) is
 * kept on the row (`structureModelRoles`), so the chain that finishes the
 * build asks whichever chain it is.
 */
export async function buildStructureStep(
  ctx: MutationCtx,
  transcriptId: Id<"transcripts">,
  fromIndex: number,
  buildId?: string,
  options: { modelRoles?: boolean } = {}
): Promise<StructureStep> {
  const transcript = await ctx.db.get(transcriptId);
  if (!transcript || transcript.content.trim() === "") return { kind: "missing" };
  if (transcript.parserVersion === TRANSCRIPT_PARSER_VERSION) return { kind: "current" };

  let chain = buildId;
  if (chain === undefined) {
    chain = newStructureBuildId();
    await ctx.db.patch(transcript._id, {
      structureBuildId: chain,
      ...(options.modelRoles ? { structureModelRoles: true } : {}),
    });
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

  const text = frozenSlice(transcript.content);
  const cues = isCueRender(transcript.sourceFormat, text);
  const turns = parseTranscriptTurns(text, { cues });
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
  const speakers = await upsertSpeakers(ctx, transcript, guesses, rawLabelsByLabel(turns));
  const needsModelRoles = speakers.needsModel;
  await ctx.db.patch(transcript._id, {
    parserVersion: TRANSCRIPT_PARSER_VERSION,
    structureBuildId: undefined,
    structureModelRoles: undefined,
    speakerNames: storedSpeakerNames(
      text,
      cues,
      guesses.slice(0, MAX_SPEAKERS_PER_TRANSCRIPT).map((guess) => guess.label)
    ),
    speakerStatus:
      guesses.length === 0
        ? "unchecked"
        : speakers.lostRole
          ? "needs_check"
          : await speakerStatusOf(ctx, transcript._id),
  });
  return {
    kind: "done",
    needsModelRoles,
    modelRoles: transcript.structureModelRoles === true || options.modelRoles === true,
  };
}

/** Names one row may keep (`transcripts.speakerNames`); more are parsed each time. */
export const MAX_STORED_SPEAKER_NAMES = 200;

/**
 * The names a build keeps on the row for placeholder maps: every name the
 * labels hold besides the labels the speaker rows keep (`rowLabels`). A
 * label past the row cap (MAX_SPEAKERS_PER_TRANSCRIPT) has no row, so it is
 * kept here with the other names (review 2026-09-25). Undefined when there
 * are too many, so a map parses the text instead.
 */
function storedSpeakerNames(
  text: string,
  cues: boolean,
  rowLabels: readonly string[]
): Doc<"transcripts">["speakerNames"] {
  const names = transcriptSpeakerNames(text, { cues });
  const withRow = new Set(rowLabels);
  const otherNames = [...new Set([...names.labels.filter((label) => !withRow.has(label)), ...names.otherNames])];
  if (otherNames.length + names.organizations.length > MAX_STORED_SPEAKER_NAMES) return undefined;
  return {
    parserVersion: TRANSCRIPT_PARSER_VERSION,
    otherNames,
    organizations: names.organizations,
  };
}

/**
 * The text turns are built from: the slice a generation freezes, so every
 * turn offset stays valid on the frozen row. Only rows written before the
 * 500 000-character cap are longer. Never ends inside a surrogate pair.
 */
export function frozenSlice(content: string): string {
  if (content.length <= FROZEN_TRANSCRIPT_CHARS) return content;
  const code = content.charCodeAt(FROZEN_TRANSCRIPT_CHARS - 1);
  const end = code >= 0xd800 && code <= 0xdbff ? FROZEN_TRANSCRIPT_CHARS - 1 : FROZEN_TRANSCRIPT_CHARS;
  return content.slice(0, end);
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

/** The labels each new label was written as, from the turns of one parse. */
export function rawLabelsByLabel(turns: readonly TranscriptTurn[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const turn of turns) {
    if (!turn.speakerLabel || !turn.rawLabel) continue;
    const raws = out.get(turn.speakerLabel) ?? [];
    if (!raws.includes(turn.rawLabel)) raws.push(turn.rawLabel);
    out.set(turn.speakerLabel, raws);
  }
  return out;
}

/**
 * Confidence of a role carried from one old label to several new ones:
 * below MODEL_ROLE_THRESHOLD, so the speaker is checked again and the role
 * never excludes words on its own (decision 25).
 */
export const SPLIT_ROLE_CONFIDENCE = 0.6;

type SpeakerRow = Doc<"transcriptSpeakers">;

export type CarriedRole = Pick<SpeakerRow, "role" | "roleSource" | "confidence" | "confirmedBy" | "confirmedAt">;

/**
 * Roles a consultant or the model set on labels a rebuild no longer finds,
 * carried to the new labels whose lines were written as them (review
 * 2026-09-25): the v3 label "Guest" of "Priya Shah (Guest)" goes to "Priya
 * Shah". An old label that became exactly one new label, with no other old
 * label becoming it, keeps its role and source as they were. One that
 * became several, or several that disagree, give each new label the role as
 * a rule's guess below the threshold, and only where the new rules could
 * not place it themselves. `lost` lists old labels no new label came from
 * (a heading word, a label buried in prose). Pure.
 */
export function carrySpeakerRoles(
  gone: readonly SpeakerRow[],
  guesses: readonly SpeakerRoleGuess[],
  rawLabels: ReadonlyMap<string, readonly string[]>
): { carried: Map<string, CarriedRole>; lost: string[] } {
  const formsOf = new Map(
    guesses.map((guess) => [
      guess.label,
      new Set((rawLabels.get(guess.label) ?? []).flatMap((raw) => rawLabelForms(raw))),
    ])
  );
  const sources = new Map<string, Array<{ row: SpeakerRow; split: boolean }>>();
  const lost: string[] = [];
  for (const row of gone) {
    if (row.roleSource === "heuristic") continue;
    const targets = guesses.filter((guess) => formsOf.get(guess.label)?.has(row.label));
    if (targets.length === 0) lost.push(row.label);
    for (const target of targets) {
      const list = sources.get(target.label) ?? [];
      list.push({ row, split: targets.length > 1 });
      sources.set(target.label, list);
    }
  }
  const carried = new Map<string, CarriedRole>();
  for (const guess of guesses) {
    const list = sources.get(guess.label);
    if (!list) continue;
    if (list.length === 1 && !list[0].split) {
      const { role, roleSource, confidence, confirmedBy, confirmedAt } = list[0].row;
      carried.set(guess.label, {
        role,
        roleSource,
        confidence,
        ...(confirmedBy !== undefined ? { confirmedBy } : {}),
        ...(confirmedAt !== undefined ? { confirmedAt } : {}),
      });
      continue;
    }
    const roles = new Set(list.map((source) => source.row.role));
    if (roles.size !== 1 || !needsModelRole(guess)) continue;
    const confidence = Math.min(SPLIT_ROLE_CONFIDENCE, ...list.map((source) => source.row.confidence));
    // A rule's own role at the same or a higher confidence stays (fix-b
    // review P3-3): the carried role only fills in what the rules could not.
    if (guess.role !== "unknown" && guess.confidence >= confidence) continue;
    carried.set(guess.label, { role: list[0].row.role, roleSource: "heuristic", confidence });
  }
  return { carried, lost };
}

/**
 * Writes the rule-based roles. A role a consultant set, or one the model
 * placed, survives a rebuild: on its label, or carried to the label the new
 * parse reads the same lines as (`carrySpeakerRoles`). Labels the new parse
 * no longer finds are removed. Returns whether any label still needs the
 * model's look, and whether a consultant's or the model's role had no label
 * left to go to (the transcript then needs a speaker check).
 */
export async function upsertSpeakers(
  ctx: MutationCtx,
  transcript: Doc<"transcripts">,
  guesses: readonly SpeakerRoleGuess[],
  rawLabels: ReadonlyMap<string, readonly string[]> = new Map()
): Promise<{ needsModel: boolean; lostRole: boolean }> {
  const rows = await listSpeakerRows(ctx, transcript._id);
  const byLabel = new Map(rows.map((row) => [row.label, row]));
  const kept = guesses.slice(0, MAX_SPEAKERS_PER_TRANSCRIPT);
  const labels = new Set(guesses.map((guess) => guess.label));
  const gone = rows.filter((row) => !labels.has(row.label));
  const { carried, lost } = carrySpeakerRoles(gone, kept, rawLabels);
  for (const row of gone) await ctx.db.delete(row._id);
  let needsModel = false;
  for (const guess of kept) {
    const row = byLabel.get(guess.label);
    const counts = {
      turnCount: guess.turnCount,
      ...(guess.sampleTurnIndex !== undefined ? { sampleTurnIndex: guess.sampleTurnIndex } : {}),
    };
    if (row && row.roleSource !== "heuristic") {
      await ctx.db.patch(row._id, counts);
      continue;
    }
    const fields = carried.get(guess.label) ?? {
      role: guess.role,
      roleSource: "heuristic" as const,
      confidence: guess.confidence,
    };
    if (fields.roleSource === "heuristic" && needsModelRole(fields)) needsModel = true;
    if (row) await ctx.db.patch(row._id, { ...fields, ...counts });
    else {
      await ctx.db.insert("transcriptSpeakers", {
        transcriptId: transcript._id,
        projectId: transcript.projectId,
        label: guess.label,
        ...fields,
        ...counts,
      });
    }
  }
  return { needsModel, lostRole: lost.length > 0 };
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

/**
 * The role a speaker row gives its words as evidence (decision 25): the
 * stored role when a consultant set it or its confidence is at least
 * MODEL_ROLE_THRESHOLD, otherwise `unknown`. A guess below the threshold
 * never keeps words out of the evidence; they stay citable and are marked
 * for a speaker check (decision 24: roles warn, never block; review
 * 2026-09-25).
 */
export function evidenceRole(
  row: Pick<Doc<"transcriptSpeakers">, "role" | "roleSource" | "confidence">
): Doc<"transcriptSpeakers">["role"] {
  return row.roleSource === "consultant" || row.confidence >= MODEL_ROLE_THRESHOLD ? row.role : "unknown";
}

/**
 * Evidence role of every speaker label of a transcript (`evidenceRole`),
 * for render and verification.
 */
export async function speakerRoleMap(
  ctx: Ctx,
  transcriptId: Id<"transcripts">
): Promise<Map<string, Doc<"transcriptSpeakers">["role"]>> {
  const rows = await listSpeakerRows(ctx, transcriptId);
  return new Map(rows.map((row) => [row.label, evidenceRole(row)]));
}
