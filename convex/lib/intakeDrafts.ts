/**
 * Private New project intake drafts (2026-09-26, decision 65, stage 2; the
 * rules are the tenth amendment in docs/product-domain.md). The page saves
 * what it has read to a draft only its signed-in creator can see, so the
 * Brief can be prepared before the project exists, and confirming creates
 * the project from the saved text instead of uploading it again.
 *
 * Everything here mirrors the project path on purpose: the evidence a
 * draft preparation freezes, its placeholder map, its speaker roles and
 * its citation checks are computed the way the promoted project's run
 * computes them, so an unchanged intake gives the same preparation key.
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { domainError } from "./contracts";
import { getEffectiveCapabilityLevel } from "../../shared/capabilities";
import { briefPreparationEnabled, transcriptPlaceholdersEnabled } from "../appSettings";
import { getTeamRosterMemberOrNull, userDisplayLabel } from "./teamRoster";
import {
  FROZEN_DOCUMENT_CHARS,
  FROZEN_DOCUMENT_ROWS,
  type FrozenSourceFields,
} from "./briefEvidence";
import { sha256 } from "./contracts";
import {
  FROZEN_TRANSCRIPT_CHARS,
  MAX_TOTAL_TRANSCRIPT_CHARS,
  MAX_TRANSCRIPTS_PER_PROJECT,
} from "./transcripts";
import {
  frozenSlice,
  MAX_SPEAKERS_PER_TRANSCRIPT,
  speakerRoleContext,
  storedSpeakerNames,
  evidenceRole,
} from "./transcriptStructure";
import {
  isCueRender,
  parseTranscriptTurns,
  TRANSCRIPT_PARSER_VERSION,
  type TranscriptTurn,
} from "../../shared/transcriptParse";
import { inferSpeakerRoles, needsModelRole } from "./transcriptSpeakers";
import {
  placeholderMapFrom,
  storedNamesAreCurrent,
  transcriptNamesToHide,
  type PlaceholderIdentity,
} from "./transcriptPlaceholders";
import type { PlaceholderEntry } from "./deidentify";
import {
  MAX_SPAN_TURNS,
  citationSpeakerReader,
  spanVerdict,
  type CitationSpeaker,
  type MovedFrom,
  type SpeakerCheckSource,
} from "./citationSpeakers";
import type { TranscriptSpeakerRole } from "./transcriptValidators";
import { firmNames } from "./firmNames";

type Ctx = QueryCtx | MutationCtx;

/** A draft expires this long after its last edit. */
export const INTAKE_IDLE_MS = 24 * 60 * 60 * 1000;
/** And at the latest this long after it was made. */
export const INTAKE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
/** Quiet time after the last intake edit before its preparation starts. */
export const INTAKE_DEBOUNCE_MS = 2_000;
/** Supporting documents one draft may hold. */
export const MAX_INTAKE_DOCUMENTS = 100;
/** Source rows one draft read takes: every transcript and document. */
export const MAX_INTAKE_SOURCE_ROWS = MAX_TRANSCRIPTS_PER_PROJECT + MAX_INTAKE_DOCUMENTS;
/** Open drafts one person may hold at once (several tabs, say). */
export const MAX_OPEN_DRAFTS_PER_USER = 10;
/** Leave-out keys the start dialog may send. */
export const MAX_EXCLUDED_SOURCE_KEYS = 250;
/** Turns the one speaker-role model call samples from, as for a project. */
export const INTAKE_SPEAKER_SAMPLE_TURNS = 400;
/** Characters of a document a draft may hold, the frozen cut plus room. */
export const MAX_INTAKE_DOCUMENT_CHARS = 900_000;
/** Characters of supporting document text one draft may hold in all. */
export const MAX_INTAKE_DOCUMENT_TEXT_CHARS = 3_000_000;
/** Characters of text one stored chunk takes at most. */
export const TEXT_CHUNK_CHARS = 200_000;
/** UTF-8 bytes one stored chunk takes at most, well under the 1 MiB document limit. */
export const MAX_TEXT_CHUNK_BYTES = 900_000;
/**
 * How long the client name, interviewer and interviewees must stay
 * unchanged before a model sees text masked with them (review 2026-09-26,
 * Fable P2-1): a half-typed client name is never the map.
 */
export const NAMES_SETTLE_MS = 5_000;
/** Drafts one person may start per firm day. */
export const MAX_DRAFTS_PER_DAY = 30;
/** Speaker model calls one person's drafts may make per firm day. */
export const MAX_SPEAKER_CALLS_PER_DAY = 60;
/**
 * UTF-8 bytes of text a saved source may hold: what fits the project row it
 * becomes (a transcript or a file, under the 1 MiB document limit) with room
 * for the row's other fields.
 */
export const MAX_SOURCE_TEXT_BYTES = 900_000;

/** How long a closed, content-free draft row is kept before it is deleted. */
export const CLOSED_DRAFT_KEEP_MS = 30 * 24 * 60 * 60 * 1000;

export { MAX_TOTAL_TRANSCRIPT_CHARS };

const SOURCE_KEY = /^[A-Za-z0-9_-]{8,64}$/;

/** Source keys are opaque ids the page makes; nothing else passes. */
export function requireSourceKey(key: string): string {
  if (!SOURCE_KEY.test(key)) domainError("INVALID_INPUT", "Invalid source key");
  return key;
}

/** When a draft edited at `editedAt` expires. */
export function draftExpiresAt(draft: Pick<Doc<"intakeDrafts">, "createdAt">, editedAt: number): number {
  return Math.min(editedAt + INTAKE_IDLE_MS, draft.createdAt + INTAKE_LIFETIME_MS);
}

/** Whether a user may make projects today: an active internal role with `project.create`. */
export function userMayCreateProject(user: Doc<"users"> | null): user is Doc<"users"> {
  return (
    user !== null &&
    user.isAnonymous !== true &&
    user.role !== undefined &&
    getEffectiveCapabilityLevel(user.role, "project.create") === "all"
  );
}

/**
 * The caller's own open draft. Anyone else, and a draft that is gone,
 * expired or ended, reads as not found: a private draft is never
 * confirmed to exist to someone who does not own it.
 */
export async function requireOwnDraft(
  ctx: Ctx,
  user: Doc<"users">,
  draftId: Id<"intakeDrafts">,
  statuses: ReadonlyArray<Doc<"intakeDrafts">["status"]> = ["open"]
): Promise<Doc<"intakeDrafts">> {
  const draft = await ctx.db.get(draftId);
  if (!draft || draft.ownerId !== user._id || !statuses.includes(draft.status)) {
    domainError("INTAKE_DRAFT_GONE", "This setup is no longer available");
  }
  if (draft.status === "open" && draft.expiresAt <= Date.now()) {
    domainError("INTAKE_DRAFT_GONE", "This setup is no longer available");
  }
  return draft;
}

/** Marks an actual edit: the idle expiry moves, the absolute one does not. */
export async function touchDraft(
  ctx: MutationCtx,
  draft: Doc<"intakeDrafts">,
  patch: Partial<Doc<"intakeDrafts">> = {}
): Promise<Doc<"intakeDrafts">> {
  const now = Date.now();
  await ctx.db.patch(draft._id, { ...patch, lastEditedAt: now, expiresAt: draftExpiresAt(draft, now) });
  return (await ctx.db.get(draft._id))!;
}

/**
 * The names the project will carry, from the draft: the client name, the
 * interviewer's and the writer's roster labels (as `createProject` stores
 * them) and the interviewees.
 */
export async function draftIdentity(ctx: Ctx, draft: Doc<"intakeDrafts">): Promise<PlaceholderIdentity> {
  const owner = await ctx.db.get(draft.ownerId);
  const interviewer = draft.interviewerUserId
    ? await getTeamRosterMemberOrNull(ctx, draft.interviewerUserId)
    : null;
  return {
    clientName: draft.clientName ?? "",
    writer: owner ? userDisplayLabel(owner) : undefined,
    interviewer: interviewer ? userDisplayLabel(interviewer) : undefined,
    interviewees: draft.interviewees?.length ? draft.interviewees : undefined,
  };
}

/**
 * Stores a source's text in chunks of at most TEXT_CHUNK_CHARS characters
 * and MAX_TEXT_CHUNK_BYTES UTF-8 bytes, replacing what it held.
 */
export async function writeSourceText(
  ctx: MutationCtx,
  source: { _id: Id<"intakeSources">; draftId: Id<"intakeDrafts"> },
  text: string
): Promise<void> {
  await deleteSourceText(ctx, source._id);
  const encoder = new TextEncoder();
  let index = 0;
  let at = 0;
  while (at < text.length) {
    let end = Math.min(text.length, at + TEXT_CHUNK_CHARS);
    // Never split a surrogate pair, and shrink a chunk whose bytes run over.
    const cut = () => {
      const code = text.charCodeAt(end - 1);
      if (end < text.length && code >= 0xd800 && code <= 0xdbff) end -= 1;
    };
    cut();
    while (encoder.encode(text.slice(at, end)).length > MAX_TEXT_CHUNK_BYTES) {
      end = at + Math.floor((end - at) / 2);
      cut();
    }
    await ctx.db.insert("intakeSourceTexts", { sourceId: source._id, draftId: source.draftId, index, text: text.slice(at, end) });
    index += 1;
    at = end;
  }
}

/** A source's whole text. */
export async function readSourceText(ctx: Ctx, sourceId: Id<"intakeSources">): Promise<string> {
  const chunks = await ctx.db
    .query("intakeSourceTexts")
    .withIndex("by_sourceId_and_index", (q) => q.eq("sourceId", sourceId))
    .take(100);
  return chunks.map((chunk) => chunk.text).join("");
}

export async function deleteSourceText(ctx: MutationCtx, sourceId: Id<"intakeSources">): Promise<void> {
  const chunks = await ctx.db
    .query("intakeSourceTexts")
    .withIndex("by_sourceId_and_index", (q) => q.eq("sourceId", sourceId))
    .take(100);
  for (const chunk of chunks) await ctx.db.delete(chunk._id);
}

/** Every source of a draft, in position order: metadata only, never text. */
export async function listDraftSources(ctx: Ctx, draftId: Id<"intakeDrafts">): Promise<Doc<"intakeSources">[]> {
  return await ctx.db
    .query("intakeSources")
    .withIndex("by_draftId_and_position", (q) => q.eq("draftId", draftId))
    .take(MAX_INTAKE_SOURCE_ROWS + 1);
}

function compareSources(a: Doc<"intakeSources">, b: Doc<"intakeSources">): number {
  if (a.position !== b.position) return a.position - b.position;
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  return a._id < b._id ? -1 : a._id > b._id ? 1 : 0;
}

export type DraftEvidence = {
  /** Every readable transcript, left-out ones included (they feed the placeholder map). */
  transcripts: Doc<"intakeSources">[];
  /** The transcripts the preparation reads, after the leave-out list. */
  readTranscripts: Doc<"intakeSources">[];
  /** The frozen rows, transcripts first, in the order the Brief spends its budget. */
  fields: FrozenSourceFields[];
};

/**
 * The evidence a draft's preparation reads, exactly as `selectFrozenEvidence`
 * would read the promoted project: every readable transcript in list order
 * cut to FROZEN_TRANSCRIPT_CHARS, then the first FROZEN_DOCUMENT_ROWS
 * documents that are not empty and not left out, cut to
 * FROZEN_DOCUMENT_CHARS. Promotion installs the sources in this order.
 */
export async function selectDraftEvidence(ctx: Ctx, draft: Doc<"intakeDrafts">): Promise<DraftEvidence> {
  const excluded = new Set(draft.excludedSourceKeys ?? []);
  const sources = await listDraftSources(ctx, draft._id);
  const transcripts = sources
    .filter((row) => row.kind === "transcript" && row.hasText)
    .sort(compareSources)
    .slice(0, MAX_TRANSCRIPTS_PER_PROJECT);
  const readTranscripts = transcripts.filter((row) => !excluded.has(row.sourceKey));
  const documents = mergedDocuments(sources)
    .slice(0, FROZEN_DOCUMENT_ROWS)
    .filter((row) => row.hasText && !excluded.has(row.sourceKey));
  const fields: FrozenSourceFields[] = [];
  // Only the rows the Brief reads are loaded.
  for (const row of readTranscripts) {
    const text = await readSourceText(ctx, row._id);
    const content = text.slice(0, FROZEN_TRANSCRIPT_CHARS);
    fields.push({
      kind: "transcript",
      intakeSourceId: row._id,
      sourceKey: row.sourceKey,
      label: row.label,
      content,
      contentHash: await sha256(content),
      truncated: content.length !== text.length,
      originalLength: text.length,
    });
  }
  for (const row of documents) {
    const text = await readSourceText(ctx, row._id);
    const content = text.slice(0, FROZEN_DOCUMENT_CHARS);
    fields.push({
      kind: "project_document",
      intakeSourceId: row._id,
      sourceKey: row.sourceKey,
      label: `${row.category ?? "other"}:${row.label}`,
      content,
      contentHash: await sha256(content),
      truncated: content.length !== text.length,
      originalLength: text.length,
      ...(row.uploaderRole ? { uploaderRole: row.uploaderRole } : {}),
    });
  }
  return { transcripts, readTranscripts, fields };
}

/**
 * A draft's documents in the order promotion installs them, with a second
 * file of the same name and the same text left out: promotion links it to
 * the first file's row, as `documents.uploadDocument` merges such a file
 * (a file with no text is never merged).
 */
export function mergedDocuments(sources: readonly Doc<"intakeSources">[]): Doc<"intakeSources">[] {
  const seen = new Set<string>();
  const out: Doc<"intakeSources">[] = [];
  for (const row of sources.filter((source) => source.kind === "document").sort(compareSources)) {
    const key = `${row.label}\u0000${row.contentHash}`;
    if (row.hasText && seen.has(key)) continue;
    if (row.hasText) seen.add(key);
    out.push(row);
  }
  return out;
}

/** Documents promotion links to an earlier file's row instead of installing, by source id. */
export function mergedAway(sources: readonly Doc<"intakeSources">[]): Map<Id<"intakeSources">, Doc<"intakeSources">> {
  const first = new Map<string, Doc<"intakeSources">>();
  const out = new Map<Id<"intakeSources">, Doc<"intakeSources">>();
  for (const row of sources.filter((source) => source.kind === "document").sort(compareSources)) {
    if (!row.hasText) continue;
    const key = `${row.label}\u0000${row.contentHash}`;
    const earlier = first.get(key);
    if (earlier) out.set(row._id, earlier);
    else first.set(key, row);
  }
  return out;
}

/**
 * What the speaker model look is keyed to: the names that mask its call
 * (the draft's and the firm's) and the text's hash. A change of either
 * asks again (review 2026-09-26, Fable P2-1).
 */
export async function speakerModelKey(
  ctx: Ctx,
  draft: Doc<"intakeDrafts">,
  source: Pick<Doc<"intakeSources">, "contentHash">
): Promise<string> {
  return await sha256(
    JSON.stringify({ names: await draftIdentity(ctx, draft), firms: await firmNames(ctx), text: source.contentHash })
  );
}

/** Whether the draft's names have stayed unchanged for NAMES_SETTLE_MS; else when they will have. */
export function namesSettleAt(draft: Pick<Doc<"intakeDrafts">, "contextChangedAt">): number {
  return (draft.contextChangedAt ?? 0) + NAMES_SETTLE_MS;
}

/** A draft transcript's speaker rows. */
export async function listIntakeSpeakers(ctx: Ctx, sourceId: Id<"intakeSources">) {
  return await ctx.db
    .query("intakeSourceSpeakers")
    .withIndex("by_sourceId_and_label", (q) => q.eq("sourceId", sourceId))
    .take(MAX_SPEAKERS_PER_TRANSCRIPT);
}

/**
 * Owner decision 26 for a draft: the same map `frozenPlaceholders` builds
 * for the promoted project (every transcript's names, left-out ones
 * included, then the texts the calls send), or none when an admin switched
 * placeholders off.
 */
export async function draftPlaceholderMap(
  ctx: Ctx,
  draft: Doc<"intakeDrafts">,
  transcripts: readonly Doc<"intakeSources">[],
  texts: readonly string[]
): Promise<PlaceholderEntry[]> {
  if (!(await transcriptPlaceholdersEnabled(ctx))) return [];
  const names: Array<{ people: string[]; organizations: string[]; phrases: string[] }> = [];
  for (const source of transcripts) {
    const rows = await listIntakeSpeakers(ctx, source._id);
    const stored = { ...source, structureBuildId: undefined };
    // The text is read only when the build's kept names cannot be used.
    const content = storedNamesAreCurrent(stored) ? "" : await readSourceText(ctx, source._id);
    names.push(
      transcriptNamesToHide(
        { ...stored, content },
        rows.map((row) => row.label)
      )
    );
  }
  return [...(await placeholderMapFrom(ctx, await draftIdentity(ctx, draft), names, texts))];
}

/**
 * The speaker evidence a draft transcript row is checked against, the same
 * shape `speakerEvidenceView` gives a project transcript.
 */
export async function intakeSpeakerView(
  ctx: Ctx,
  source: { intakeSourceId: Id<"intakeSources">; contentHash: string }
): Promise<{ ready: boolean; parserVersion: string | null; roles: Array<[string, string]> }> {
  const row = await ctx.db.get(source.intakeSourceId);
  // A draft transcript is never cut (it is within the frozen cap), so its
  // frozen row is its whole text: the hashes are equal.
  const ready =
    row !== null && row.parserVersion === TRANSCRIPT_PARSER_VERSION && row.contentHash === source.contentHash;
  const roles: Array<[string, string]> = ready
    ? (await listIntakeSpeakers(ctx, source.intakeSourceId)).map((speaker) => [speaker.label, evidenceRole(speaker)])
    : [];
  roles.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return { ready, parserVersion: row?.parserVersion ?? null, roles };
}

/** The turns the draft text parses into, as the project's build would store them. */
export function parseIntakeTurns(
  content: string,
  source: Pick<Doc<"intakeSources">, "sourceFormat">
): {
  text: string;
  cues: boolean;
  turns: TranscriptTurn[];
} {
  const text = frozenSlice(content);
  const cues = isCueRender(source.sourceFormat, text);
  return { text, cues, turns: parseTranscriptTurns(text, { cues }) };
}

/**
 * Owner decision 25 for a draft's frozen rows: the rule the project's
 * stored turns apply (`citationSpeakerReader`), over the turns parsed from
 * the draft's text and its speaker rows. Unchecked when the row's structure
 * is not built by the current parser or its text differs.
 */
export function intakeSpeakerReader(ctx: Ctx) {
  const loaded = new Map<string, Promise<{ turns: TranscriptTurn[]; roles: Map<string, TranscriptSpeakerRole> } | null>>();
  const load = (sourceId: Id<"intakeSources">, contentHash: string) => {
    const key = `${sourceId}|${contentHash}`;
    let pending = loaded.get(key);
    if (!pending) {
      pending = (async () => {
        const row = await ctx.db.get(sourceId);
        if (!row || row.parserVersion !== TRANSCRIPT_PARSER_VERSION) return null;
        if (row.contentHash !== contentHash) return null;
        const rows = await listIntakeSpeakers(ctx, sourceId);
        return {
          turns: parseIntakeTurns(await readSourceText(ctx, sourceId), row).turns,
          roles: new Map(rows.map((speaker) => [speaker.label, evidenceRole(speaker)])),
        };
      })();
      loaded.set(key, pending);
    }
    return pending;
  };
  return async (
    source: { intakeSourceId: Id<"intakeSources">; content: string; contentHash: string },
    startOffset: number,
    endOffset: number,
    movedFrom?: MovedFrom
  ): Promise<CitationSpeaker> => {
    const structure = await load(source.intakeSourceId, source.contentHash);
    if (!structure) return "unchecked";
    return await spanVerdict(
      async (start, end) => {
        const touching = structure.turns.filter((turn) => turn.charStart < end && turn.charEnd > start);
        if (touching.length > MAX_SPAN_TURNS) return null;
        return {
          roles: touching.map((turn) =>
            turn.speakerLabel ? (structure.roles.get(turn.speakerLabel) ?? "unknown") : "unknown"
          ),
          first: touching.length ? Math.min(...touching.map((turn) => turn.index)) : undefined,
          last: touching.length ? Math.max(...touching.map((turn) => turn.index)) : undefined,
        };
      },
      startOffset,
      endOffset,
      movedFrom
    );
  };
}

/** A preparation's frozen row, from a project or a draft. */
export type PreparationCheckSource = SpeakerCheckSource & { intakeSourceId?: Id<"intakeSources"> };

/**
 * The decision 25 check for a preparation's frozen rows: a row that names a
 * project transcript reads the project's stored turns; a draft row reads
 * the draft's.
 */
export function preparationSpeakerReader(ctx: Ctx) {
  const project = citationSpeakerReader(ctx);
  const draft = intakeSpeakerReader(ctx);
  return async (
    source: PreparationCheckSource,
    startOffset: number,
    endOffset: number,
    movedFrom?: MovedFrom
  ): Promise<CitationSpeaker> => {
    if (source.kind === "transcript" && !source.transcriptId && source.intakeSourceId) {
      return await draft(
        { intakeSourceId: source.intakeSourceId, content: source.content, contentHash: source.contentHash },
        startOffset,
        endOffset,
        movedFrom
      );
    }
    return await project(source, startOffset, endOffset, movedFrom);
  };
}

/**
 * Builds a draft transcript's speaker rows from its text, the way the
 * project's turn build does (`buildStructureStep`): rule-based roles from
 * the parse and the names the project will carry; a role the model placed
 * stays. Returns whether a label still needs the model's look.
 */
export async function buildIntakeStructure(
  ctx: MutationCtx,
  draft: Doc<"intakeDrafts">,
  source: Doc<"intakeSources">,
  options: { resetModelRoles?: boolean } = {}
): Promise<{ needsModel: boolean }> {
  const { text, cues, turns } = parseIntakeTurns(await readSourceText(ctx, source._id), source);
  const guesses = inferSpeakerRoles(turns, await speakerRoleContext(ctx, await draftIdentity(ctx, draft)));
  const kept = guesses.slice(0, MAX_SPEAKERS_PER_TRANSCRIPT);
  const labels = new Set(guesses.map((guess) => guess.label));
  const rows = await listIntakeSpeakers(ctx, source._id);
  const byLabel = new Map(rows.map((row) => [row.label, row]));
  for (const row of rows) if (!labels.has(row.label)) await ctx.db.delete(row._id);
  let needsModel = false;
  for (const guess of kept) {
    const row = byLabel.get(guess.label);
    const counts = {
      turnCount: guess.turnCount,
      ...(guess.sampleTurnIndex !== undefined ? { sampleTurnIndex: guess.sampleTurnIndex } : {}),
    };
    // The names changed: the model's roles were asked for other names and
    // are asked again (review 2026-09-26, Fable P2-1).
    const keep = row && (row.roleSource === "consultant" || (row.roleSource === "model" && !options.resetModelRoles));
    if (row && keep) {
      await ctx.db.patch(row._id, counts);
      continue;
    }
    const fields = { role: guess.role, roleSource: "heuristic" as const, confidence: guess.confidence };
    if (needsModelRole(fields)) needsModel = true;
    if (row) await ctx.db.patch(row._id, { ...fields, ...counts });
    else {
      await ctx.db.insert("intakeSourceSpeakers", {
        sourceId: source._id,
        draftId: draft._id,
        label: guess.label,
        ...fields,
        ...counts,
      });
    }
  }
  await ctx.db.patch(source._id, {
    parserVersion: TRANSCRIPT_PARSER_VERSION,
    speakerNames: storedSpeakerNames(text, cues, kept.map((guess) => guess.label)),
  });
  return { needsModel };
}

/**
 * Queue (or push back) a draft's preparation after an intake edit: the
 * start runs INTAKE_DEBOUNCE_MS after the last one. Nothing is queued
 * before the client name the placeholder map needs exists, or without a
 * readable transcript, or with preparation switched off. Whether it is
 * worth a paid call is decided when it starts (convex/briefPreparations.ts).
 */
export async function requestIntakePreparation(
  ctx: MutationCtx,
  draft: Doc<"intakeDrafts">,
  reason: string
): Promise<void> {
  if (!(await briefPreparationEnabled(ctx))) return;
  if (draft.status !== "open" || draft.expiresAt <= Date.now()) return;
  if (!draft.clientName?.trim() || (draft.transcriptCount ?? 0) === 0) return;
  const now = Date.now();
  const queued = await ctx.db
    .query("briefPreparations")
    .withIndex("by_intakeDraftId_and_status", (q) => q.eq("intakeDraftId", draft._id).eq("status", "queued"))
    .first();
  if (queued) {
    if (queued.scheduledJobId && queued.runAt > now) await ctx.scheduler.cancel(queued.scheduledJobId);
    const revision = queued.revision + 1;
    const scheduledJobId = await ctx.scheduler.runAfter(INTAKE_DEBOUNCE_MS, internal.briefPreparations.startBriefPreparation, {
      preparationId: queued._id,
      revision,
    });
    await ctx.db.patch(queued._id, {
      revision,
      runAt: now + INTAKE_DEBOUNCE_MS,
      scheduledJobId,
      triggerReason: reason,
      waitingFor: undefined,
      updatedAt: now,
    });
    return;
  }
  const preparationId = await ctx.db.insert("briefPreparations", {
    intakeDraftId: draft._id,
    status: "queued",
    revision: 1,
    runAt: now + INTAKE_DEBOUNCE_MS,
    triggeredBy: draft.ownerId,
    triggerReason: reason,
    createdAt: now,
    updatedAt: now,
  });
  const scheduledJobId = await ctx.scheduler.runAfter(INTAKE_DEBOUNCE_MS, internal.briefPreparations.startBriefPreparation, {
    preparationId,
    revision: 1,
  });
  await ctx.db.patch(preparationId, { scheduledJobId });
}

/**
 * Whether a private intake draft is still becoming this project (its
 * promotion has not completed): a run or a PD review waits for it
 * (`PROJECT_SETTING_UP`), so it reads every source and the speaker
 * evidence the draft's preparation read.
 */
export async function projectIsSettingUp(ctx: Ctx, projectId: Id<"projects">): Promise<boolean> {
  const draft = await ctx.db
    .query("intakeDrafts")
    .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
    .first();
  return draft?.status === "promoting";
}

/** The refusal a run or review asked for while the project is still being set up. */
export async function requireProjectSetUp(ctx: Ctx, projectId: Id<"projects">): Promise<void> {
  if (await projectIsSettingUp(ctx, projectId)) {
    domainError("PROJECT_SETTING_UP", "This project is still being set up. Try again in a moment.");
  }
}
