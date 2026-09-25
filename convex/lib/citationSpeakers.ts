/**
 * Owner decision 25 outside facts mode (2026-09-25): only the client's words
 * back a claim. A citation whose span on a frozen transcript row falls wholly
 * inside interviewer turns, or turns of another speaker (role `other`: a
 * vendor, a note taker), is never evidence. A span that holds words of a
 * speaker with no role yet (`unknown`) stays citable and is marked for a
 * speaker check (decision 24: warn, never block).
 *
 * Roles come from the stored turns (`transcriptTurns`) and speaker rows
 * (`transcriptSpeakers`) of the transcript the frozen row was taken from.
 * When those are missing or cannot be trusted for the frozen text (older
 * transcripts whose turns were never built, a rebuild in progress, a row
 * whose text differs), the check says `unchecked` and callers keep today's
 * rule: the byte check alone.
 *
 * Facts mode already applies the rule through its verified fact spans
 * (convex/lib/seedFacts.ts); this is the same rule for every other path.
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { isEvidenceRole, needsSpeakerCheck } from "./transcriptFacts";
import { TRANSCRIPT_PARSER_VERSION } from "../../shared/transcriptParse";
import { speakerRoleMap } from "./transcriptStructure";
import type { TranscriptSpeakerRole } from "./transcriptValidators";
import {
  withCheckedSpeakers,
  type CheckedSeedCitation,
  type ValidatedSeedCandidate,
} from "./seedContract";

type Ctx = QueryCtx | MutationCtx;

/**
 * What a cited span may back:
 * - `client`: it holds client words (it may hold others' words too).
 * - `needs_check`: citable, but it holds words of a speaker with no role
 *   yet, or of no turn at all, so it is marked for a speaker check.
 * - `excluded`: every turn it touches is an interviewer's or another
 *   speaker's; never evidence.
 * - `unchecked`: no usable turns for this source; today's rule applies.
 */
export type CitationSpeaker = "client" | "needs_check" | "excluded" | "unchecked";

/** Turns one span may touch before the check gives up (`unchecked`). */
export const MAX_SPAN_TURNS = 50;
/** Other places of the same excerpt tried before a citation is dropped. */
export const MAX_RELOCATIONS = 8;
/**
 * The shortest quote that may move to another place of the same words
 * (review 2026-09-25, P2-3): shorter ones, such as "120C" or "the
 * adhesive", recur in unrelated turns, so they are dropped instead.
 */
export const MIN_RELOCATION_CHARS = 30;
export const MIN_RELOCATION_WORDS = 6;
/**
 * How many turns before or after the excluded place the new place may be:
 * the client's answer to the question, or the client's words the
 * interviewer repeated.
 */
export const RELOCATION_TURNS = 3;

/** Whether a quote is long enough to move to another place of the same words. Pure. */
export function mayMoveQuote(excerpt: string): boolean {
  const text = excerpt.trim();
  return text.length >= MIN_RELOCATION_CHARS && text.split(/\s+/).length >= MIN_RELOCATION_WORDS;
}

/** A place a quote moves from, to check the new place is near it. */
export type MovedFrom = { startOffset: number; endOffset: number };

/** The verdict for a span touching turns with these roles. Pure. */
export function speakerOfRoles(
  roles: readonly TranscriptSpeakerRole[]
): Exclude<CitationSpeaker, "unchecked"> {
  // Only label text or blank lines between turns: nobody's words, so there
  // is nothing to exclude, and nothing confirmed either.
  if (roles.length === 0) return "needs_check";
  const evidence = roles.filter((role) => isEvidenceRole(role));
  if (evidence.length === 0) return "excluded";
  return evidence.some((role) => needsSpeakerCheck(role)) ? "needs_check" : "client";
}

/** The frozen row fields the check reads. */
export type SpeakerCheckSource = Pick<
  Doc<"generationSources">,
  "kind" | "content" | "contentHash" | "transcriptId"
>;

type ReadyTranscript = {
  transcriptId: Id<"transcripts">;
  parserVersion: string;
  roles: Map<string, TranscriptSpeakerRole>;
};

/**
 * A reader that answers `CitationSpeaker` for spans of frozen rows. Each
 * transcript and its speaker rows are read once per reader; each span reads
 * only the turns it touches, through `by_transcriptId_and_charStart`.
 *
 * With `movedFrom`, the span is a new place for a quote whose place there
 * was excluded: it is evidence only within RELOCATION_TURNS turns of that
 * place, and `excluded` otherwise.
 */
export function citationSpeakerReader(ctx: Ctx) {
  const transcripts = new Map<string, Promise<ReadyTranscript | null>>();

  const ready = (source: SpeakerCheckSource): Promise<ReadyTranscript | null> => {
    if (source.kind !== "transcript" || !source.transcriptId) return Promise.resolve(null);
    const key = `${source.transcriptId}|${source.contentHash}`;
    let pending = transcripts.get(key);
    if (!pending) {
      pending = loadReady(ctx, source.transcriptId, source);
      transcripts.set(key, pending);
    }
    return pending;
  };

  /** Roles and turn indexes a span touches, or null when unchecked. */
  const touched = async (
    transcript: ReadyTranscript,
    startOffset: number,
    endOffset: number
  ): Promise<{ roles: TranscriptSpeakerRole[]; first?: number; last?: number } | null> => {
    const roles: TranscriptSpeakerRole[] = [];
    let first: number | undefined;
    let last: number | undefined;
    // Turns never overlap and are stored in text order, so walking back from
    // the last turn that starts before the span's end visits exactly the
    // turns it touches, then one that ends before it starts.
    const touching = ctx.db
      .query("transcriptTurns")
      .withIndex("by_transcriptId_and_charStart", (q) =>
        q.eq("transcriptId", transcript.transcriptId).lt("charStart", endOffset)
      )
      .order("desc");
    for await (const turn of touching) {
      if (turn.charEnd <= startOffset) break;
      // A turn of another build: the structure is changing under us.
      if (turn.parserVersion !== transcript.parserVersion) return null;
      if (roles.length >= MAX_SPAN_TURNS) return null;
      roles.push(
        turn.speakerLabel ? (transcript.roles.get(turn.speakerLabel) ?? "unknown") : "unknown"
      );
      first = Math.min(first ?? turn.index, turn.index);
      last = Math.max(last ?? turn.index, turn.index);
    }
    return { roles, first, last };
  };

  return async (
    source: SpeakerCheckSource,
    startOffset: number,
    endOffset: number,
    movedFrom?: MovedFrom
  ): Promise<CitationSpeaker> => {
    const transcript = await ready(source);
    if (!transcript) return "unchecked";
    const here = await touched(transcript, startOffset, endOffset);
    if (!here) return "unchecked";
    const verdict = speakerOfRoles(here.roles);
    if (!movedFrom || verdict === "excluded") return verdict;
    const there = await touched(transcript, movedFrom.startOffset, movedFrom.endOffset);
    if (!there || here.first === undefined || there.first === undefined) return "excluded";
    const near =
      here.first <= there.last! + RELOCATION_TURNS && here.last! >= there.first - RELOCATION_TURNS;
    return near ? verdict : "excluded";
  };
}

export type SpeakerReader = ReturnType<typeof citationSpeakerReader>;

/**
 * The transcript's stored structure, when it describes the frozen text: the
 * current parser version fully built its turns (no rebuild running) and the
 * frozen row is its text, or the start of it (rows longer than the freeze
 * cap). Otherwise null. Roles are evidence roles (`speakerRoleMap`): a guess
 * below the model threshold reads as `unknown`.
 */
async function loadReady(
  ctx: Ctx,
  transcriptId: Id<"transcripts">,
  source: SpeakerCheckSource
): Promise<ReadyTranscript | null> {
  const transcript = await ctx.db.get(transcriptId);
  // Only structure the current parser built: an older parser's labels can
  // merge a client with the interviewer ("he/him"), and its turns would
  // exclude the client's words (integration review 2026-09-25, I-1).
  if (transcript?.parserVersion !== TRANSCRIPT_PARSER_VERSION || transcript.structureBuildId !== undefined) {
    return null;
  }
  const sameText =
    (transcript.contentHash !== undefined && transcript.contentHash === source.contentHash) ||
    transcript.content.startsWith(source.content);
  if (!sameText) return null;
  return {
    transcriptId,
    parserVersion: transcript.parserVersion,
    roles: await speakerRoleMap(ctx, transcriptId),
  };
}

/**
 * Starts of `excerpt` in `content` other than `skip`, nearest `near` first
 * (the earlier one on a tie), at most `limit`. Pure.
 */
export function otherOccurrences(
  content: string,
  excerpt: string,
  near: number,
  skip: number,
  limit: number
): number[] {
  if (excerpt === "") return [];
  const found: number[] = [];
  for (let at = content.indexOf(excerpt); at !== -1; at = content.indexOf(excerpt, at + 1)) {
    if (at !== skip) found.push(at);
  }
  return found
    .sort((a, b) => Math.abs(a - near) - Math.abs(b - near) || a - b)
    .slice(0, limit);
}

/**
 * One citation under decision 25: kept where it is, moved to the nearest
 * other place in the same row where the same words are not the
 * interviewer's or another speaker's (the client may repeat a question's
 * words), or null to drop it. Only a quote of at least MIN_RELOCATION_WORDS
 * words and MIN_RELOCATION_CHARS characters moves, and only to a place
 * within RELOCATION_TURNS turns of the old one (review 2026-09-25, P2-3).
 * `speaker` is the verdict at the kept place.
 */
export async function evidenceSpan(
  speakerOf: SpeakerReader,
  source: SpeakerCheckSource,
  citation: { startOffset: number; endOffset: number; exactExcerpt: string }
): Promise<{
  startOffset: number;
  endOffset: number;
  speaker: Exclude<CitationSpeaker, "excluded">;
} | null> {
  const here = await speakerOf(source, citation.startOffset, citation.endOffset);
  if (here !== "excluded") {
    return { startOffset: citation.startOffset, endOffset: citation.endOffset, speaker: here };
  }
  if (!mayMoveQuote(citation.exactExcerpt)) return null;
  const length = citation.exactExcerpt.length;
  const movedFrom = { startOffset: citation.startOffset, endOffset: citation.endOffset };
  for (const at of otherOccurrences(
    source.content,
    citation.exactExcerpt,
    citation.startOffset,
    citation.startOffset,
    MAX_RELOCATIONS
  )) {
    const there = await speakerOf(source, at, at + length, movedFrom);
    if (there !== "excluded") return { startOffset: at, endOffset: at + length, speaker: there };
  }
  return null;
}

/**
 * Decision 25 for one validated Seed batch: each transcript citation is
 * kept, moved to a place where the same words are not only the
 * interviewer's, marked for a speaker check, or dropped. A Seed left with
 * no citation stays, writer-asserted. Documents and digests pass unchanged.
 */
export async function checkSeedSpeakers(
  speakerOf: SpeakerReader,
  seeds: readonly ValidatedSeedCandidate[],
  sources: ReadonlyMap<string, SpeakerCheckSource>
): Promise<{ seeds: ValidatedSeedCandidate[]; dropped: number }> {
  let dropped = 0;
  const checkedSeeds: ValidatedSeedCandidate[] = [];
  for (const seed of seeds) {
    const checked: CheckedSeedCitation[] = [];
    for (const citation of seed.provenance) {
      const source = sources.get(citation.sourceId);
      const kept = source ? await evidenceSpan(speakerOf, source, citation) : null;
      checked.push(
        kept
          ? {
              startOffset: kept.startOffset,
              endOffset: kept.endOffset,
              needsSpeakerCheck: kept.speaker === "needs_check",
            }
          : source
            ? null
            : { startOffset: citation.startOffset, endOffset: citation.endOffset, needsSpeakerCheck: false }
      );
    }
    const result = withCheckedSpeakers(seed, checked);
    dropped += result.dropped;
    checkedSeeds.push(result.seed);
  }
  return { seeds: checkedSeeds, dropped };
}
