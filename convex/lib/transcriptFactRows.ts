/**
 * Reading and writing stored transcript facts (phase 3, the transcript
 * method). Facts are keyed by (transcript, text hash, FACTS_VERSION) and
 * read only once their run is `ready`.
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { sha256 } from "./contracts";
import {
  FACT_PACK_MAX_CHARS,
  FACTS_VERSION,
  isEvidenceRole,
  renderFactPack,
  type FactPackOptions,
  type FactTurn,
  type PackFact,
  type PackTurnInfo,
} from "./transcriptFacts";
import { speakerRoleMap } from "./transcriptStructure";
import { TRANSCRIPT_BUDGET_CHARS } from "./transcripts";
import { TRANSCRIPT_PARSER_VERSION } from "../../shared/transcriptParse";
import type { TranscriptSpeakerRole } from "./transcriptValidators";

type Ctx = QueryCtx | MutationCtx;

/** Turns one transcript's extraction reads (a 500 000-character text). */
export const MAX_FACT_TURNS = 8_000;
/** Facts one transcript may carry. */
export const MAX_FACTS_PER_TRANSCRIPT = 1_500;
/** A running extraction older than this may be claimed again. */
export const FACT_RUN_STALE_MS = 20 * 60_000;

export async function transcriptHash(transcript: Doc<"transcripts">): Promise<string> {
  return transcript.contentHash ?? (await sha256(transcript.content));
}

/**
 * Turns joined with the current speaker roles, in order, and the one parser
 * version they were all built with: null when there are none or when they
 * mix versions (a rebuild in progress), so nothing extracts from half a
 * structure (2026-09-25, parser version 2).
 */
export async function loadFactTurns(
  ctx: Ctx,
  transcriptId: Id<"transcripts">
): Promise<{ turns: FactTurn[]; parserVersion: string | null }> {
  const roles = await speakerRoleMap(ctx, transcriptId);
  const rows = await ctx.db
    .query("transcriptTurns")
    .withIndex("by_transcriptId_and_index", (q) => q.eq("transcriptId", transcriptId))
    .take(MAX_FACT_TURNS);
  const versions = new Set(rows.map((turn) => turn.parserVersion));
  const parserVersion = versions.size === 1 ? [...versions][0] : null;
  return { turns: rows.map((turn) => ({
    index: turn.index,
    ...(turn.speakerLabel !== undefined ? { speakerLabel: turn.speakerLabel } : {}),
    role: turn.speakerLabel ? (roles.get(turn.speakerLabel) ?? "unknown") : "unknown",
    ...(turn.startMs !== undefined ? { startMs: turn.startMs } : {}),
    charStart: turn.charStart,
    charEnd: turn.charEnd,
    cleanText: turn.cleanText,
  })), parserVersion };
}

export async function findFactRun(
  ctx: Ctx,
  transcriptId: Id<"transcripts">,
  sourceContentHash: string
): Promise<Doc<"transcriptFactRuns"> | null> {
  return await ctx.db
    .query("transcriptFactRuns")
    .withIndex("by_transcriptId_and_sourceContentHash_and_factsVersion", (q) =>
      q.eq("transcriptId", transcriptId).eq("sourceContentHash", sourceContentHash).eq("factsVersion", FACTS_VERSION)
    )
    .order("desc")
    .first();
}

/**
 * Whether a run's facts still hold under the transcript's current speaker
 * roles (review 2026-09-25): ready, and no speaker whose words were left
 * out as interviewer or other at extraction has since become a client (or
 * lost its role). Roles are baked in at extraction, so such a correction
 * can only bring its evidence back through a new extraction.
 */
export async function factRunIsCurrent(ctx: Ctx, run: Doc<"transcriptFactRuns">): Promise<boolean> {
  if (run.status !== "ready") return false;
  // Facts index turns: a run built on one parser version is stale once the
  // transcript's turns are rebuilt with another (2026-09-25).
  const transcript = await ctx.db.get(run.transcriptId);
  if (!transcript || transcript.parserVersion !== run.parserVersion) return false;
  // Facts drawn from turns an older parser built are stale too, even before
  // the row is rebuilt.
  if (run.parserVersion !== TRANSCRIPT_PARSER_VERSION) return false;
  if (!run.excludedLabels || run.excludedLabels.length === 0) return true;
  const roles = await speakerRoleMap(ctx, run.transcriptId);
  return run.excludedLabels.every((label) => !isEvidenceRole(roles.get(label) ?? "unknown"));
}

/** The labels whose words are not evidence under the given turns' roles. */
export function excludedSpeakerLabels(turns: readonly Pick<FactTurn, "speakerLabel" | "role">[]): string[] {
  const labels = new Set<string>();
  for (const turn of turns) {
    if (turn.speakerLabel && !isEvidenceRole(turn.role)) labels.add(turn.speakerLabel);
  }
  return [...labels].sort();
}

/** The ready, current run for this exact text under the current FACTS_VERSION. */
export async function readyFactRun(
  ctx: Ctx,
  transcript: Doc<"transcripts">
): Promise<Doc<"transcriptFactRuns"> | null> {
  const run = await findFactRun(ctx, transcript._id, await transcriptHash(transcript));
  return run && (await factRunIsCurrent(ctx, run)) ? run : null;
}

export async function listFacts(ctx: Ctx, transcriptId: Id<"transcripts">): Promise<Doc<"transcriptFacts">[]> {
  return await ctx.db
    .query("transcriptFacts")
    .withIndex("by_transcriptId_and_factsVersion", (q) =>
      q.eq("transcriptId", transcriptId).eq("factsVersion", FACTS_VERSION)
    )
    .take(MAX_FACTS_PER_TRANSCRIPT);
}

/**
 * Turn attribution for the turns the facts reference. One index range from
 * the first to the last referenced turn, not one read per turn: a long
 * transcript's facts can name thousands of turns, past what one transaction
 * may read range by range.
 */
export async function packTurnInfo(
  ctx: Ctx,
  transcriptId: Id<"transcripts">,
  facts: readonly Pick<Doc<"transcriptFacts">, "turnIndexes">[],
  /** Only turns built with this parser version (the run's) are read. */
  parserVersion?: string
): Promise<Map<number, PackTurnInfo>> {
  const wanted = new Set(facts.flatMap((fact) => fact.turnIndexes));
  const info = new Map<number, PackTurnInfo>();
  if (wanted.size === 0) return info;
  const first = Math.min(...wanted);
  const last = Math.max(...wanted);
  const turns = await ctx.db
    .query("transcriptTurns")
    .withIndex("by_transcriptId_and_index", (q) =>
      q.eq("transcriptId", transcriptId).gte("index", first).lte("index", last)
    )
    .take(MAX_FACT_TURNS);
  for (const turn of turns) {
    if (!wanted.has(turn.index) || info.has(turn.index)) continue;
    if (parserVersion !== undefined && turn.parserVersion !== parserVersion) continue;
    info.set(turn.index, {
      ...(turn.speakerLabel !== undefined ? { speakerLabel: turn.speakerLabel } : {}),
      ...(turn.startMs !== undefined ? { startMs: turn.startMs } : {}),
      charStart: turn.charStart,
      charEnd: turn.charEnd,
    });
  }
  return info;
}

export function toPackFacts(rows: readonly Doc<"transcriptFacts">[]): PackFact[] {
  return rows.map((row) => ({
    key: row.key,
    type: row.type,
    claim: row.claim,
    turnIndexes: row.turnIndexes,
    quotes: row.quotes,
    ...(row.speakerLabel ? { speakerLabel: row.speakerLabel } : {}),
  }));
}

/**
 * One transcript's fact pack under the current roles, or null without
 * ready facts, with the rows, roles and turn attribution it was rendered
 * from so a caller freezing it reads nothing twice.
 */
export async function renderTranscriptPack(
  ctx: Ctx,
  transcript: Doc<"transcripts">,
  header: { position: number; label: string },
  options: Pick<FactPackOptions, "maxChars"> = {}
): Promise<{
  content: string;
  facts: Doc<"transcriptFacts">[];
  roles: Map<string, TranscriptSpeakerRole>;
  turnInfo: Map<number, PackTurnInfo>;
} | null> {
  const run = await readyFactRun(ctx, transcript);
  if (!run) return null;
  const facts = await listFacts(ctx, transcript._id);
  const roles = await speakerRoleMap(ctx, transcript._id);
  const turnInfo = await packTurnInfo(ctx, transcript._id, facts, run.parserVersion);
  // Never a pack that mixes the run's turns with another parser version's:
  // every turn a quoted fact stands on must be one the run was built with.
  if (facts.some((fact) => fact.quotes.length > 0 && fact.turnIndexes.some((index) => !turnInfo.has(index)))) {
    return null;
  }
  return {
    content: renderFactPack(header, toPackFacts(facts), { roles, turnInfo, ...options }),
    facts,
    roles,
    turnInfo,
  };
}

/**
 * Whether a reader outside a generation (the PD review; plan step 8) should
 * try fact packs for these transcripts: the transcripts.factsMode rule of a
 * generation applies, `all` always, `long` only over the transcript budget,
 * `off` never. Each pack is then rendered in its own query
 * (`transcriptDigests.renderLiveFactPack`), so one project's packs never
 * share a transaction's read limits (review 2026-09-25, P3-7).
 */
export function liveFactPacksApply(
  rows: readonly Pick<Doc<"transcripts">, "content">[],
  mode: "off" | "long" | "all"
): boolean {
  if (mode === "off" || rows.length === 0) return false;
  const chars = rows.reduce((total, row) => total + row.content.length, 0);
  return mode === "all" || chars > TRANSCRIPT_BUDGET_CHARS;
}
