/**
 * Reading and writing stored transcript facts (phase 3, the transcript
 * method). Facts are keyed by (transcript, text hash, FACTS_VERSION) and
 * read only once their run is `ready`.
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { sha256 } from "./contracts";
import {
  FACTS_VERSION,
  renderFactPack,
  type FactPackOptions,
  type FactTurn,
  type PackFact,
  type PackTurnInfo,
} from "./transcriptFacts";
import { speakerRoleMap } from "./transcriptStructure";

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

/** Turns joined with the current speaker roles, in order. */
export async function loadFactTurns(ctx: Ctx, transcriptId: Id<"transcripts">): Promise<FactTurn[]> {
  const roles = await speakerRoleMap(ctx, transcriptId);
  const turns = await ctx.db
    .query("transcriptTurns")
    .withIndex("by_transcriptId_and_index", (q) => q.eq("transcriptId", transcriptId))
    .take(MAX_FACT_TURNS);
  return turns.map((turn) => ({
    index: turn.index,
    ...(turn.speakerLabel !== undefined ? { speakerLabel: turn.speakerLabel } : {}),
    role: turn.speakerLabel ? (roles.get(turn.speakerLabel) ?? "unknown") : "unknown",
    ...(turn.startMs !== undefined ? { startMs: turn.startMs } : {}),
    charStart: turn.charStart,
    charEnd: turn.charEnd,
    cleanText: turn.cleanText,
  }));
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

/** The ready run for this exact text under the current FACTS_VERSION. */
export async function readyFactRun(
  ctx: Ctx,
  transcript: Doc<"transcripts">
): Promise<Doc<"transcriptFactRuns"> | null> {
  const run = await findFactRun(ctx, transcript._id, await transcriptHash(transcript));
  return run?.status === "ready" ? run : null;
}

export async function listFacts(ctx: Ctx, transcriptId: Id<"transcripts">): Promise<Doc<"transcriptFacts">[]> {
  return await ctx.db
    .query("transcriptFacts")
    .withIndex("by_transcriptId_and_factsVersion", (q) =>
      q.eq("transcriptId", transcriptId).eq("factsVersion", FACTS_VERSION)
    )
    .take(MAX_FACTS_PER_TRANSCRIPT);
}

/** Turn attribution for the turns the facts reference. */
export async function packTurnInfo(
  ctx: Ctx,
  transcriptId: Id<"transcripts">,
  facts: readonly Pick<Doc<"transcriptFacts">, "turnIndexes">[]
): Promise<Map<number, PackTurnInfo>> {
  const indexes = [...new Set(facts.flatMap((fact) => fact.turnIndexes))].sort((a, b) => a - b);
  const info = new Map<number, PackTurnInfo>();
  for (const index of indexes) {
    const turn = await ctx.db
      .query("transcriptTurns")
      .withIndex("by_transcriptId_and_index", (q) => q.eq("transcriptId", transcriptId).eq("index", index))
      .first();
    if (!turn) continue;
    info.set(index, {
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

/** One transcript's fact pack under the current roles, or null without ready facts. */
export async function renderTranscriptPack(
  ctx: Ctx,
  transcript: Doc<"transcripts">,
  header: { position: number; label: string },
  options: Pick<FactPackOptions, "maxChars"> = {}
): Promise<{ content: string; facts: Doc<"transcriptFacts">[] } | null> {
  if (!(await readyFactRun(ctx, transcript))) return null;
  const facts = await listFacts(ctx, transcript._id);
  const roles = await speakerRoleMap(ctx, transcript._id);
  const turnInfo = await packTurnInfo(ctx, transcript._id, facts);
  return {
    content: renderFactPack(header, toPackFacts(facts), { roles, turnInfo, ...options }),
    facts,
  };
}
