import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { sha256 } from "./contracts";

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
  };
}

/**
 * The one definition of "a project's transcripts": ordered by `position` then
 * `createdAt` then `_id`, with empty rows dropped (ingestion writes a
 * placeholder row with empty content) and at most
 * `MAX_TRANSCRIPTS_PER_PROJECT` returned. Full documents, because server-side
 * callers need the text; clients read metadata through `listTranscripts` and
 * one body at a time through `getTranscriptContent`.
 */
export async function listProjectTranscripts(
  ctx: Ctx,
  projectId: Id<"projects">
): Promise<Doc<"transcripts">[]> {
  const rows = await ctx.db
    .query("transcripts")
    .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
    .take(MAX_TRANSCRIPTS_PER_PROJECT + 1);

  return rows
    .filter((row) => row.content.trim() !== "")
    .sort(compareTranscripts)
    .slice(0, MAX_TRANSCRIPTS_PER_PROJECT);
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
 */
export async function insertTranscriptRow(
  ctx: MutationCtx,
  args: {
    projectId: Id<"projects">;
    content: string;
    label?: string;
    position: number;
  }
): Promise<Id<"transcripts"> | null> {
  if (args.content.trim() === "") return null;
  return await ctx.db.insert("transcripts", {
    projectId: args.projectId,
    content: args.content,
    label: args.label ?? DEFAULT_TRANSCRIPT_LABEL,
    position: args.position,
    contentHash: await sha256(args.content),
    createdAt: Date.now(),
  });
}

/**
 * Copies an existing transcript into another project by reference: the text
 * never leaves the backend, so the duplicate wizard does not download and
 * re-upload a megabyte of interview.
 */
export async function copyTranscriptRow(
  ctx: MutationCtx,
  source: Doc<"transcripts">,
  args: { projectId: Id<"projects">; position: number }
): Promise<Id<"transcripts">> {
  return await ctx.db.insert("transcripts", {
    projectId: args.projectId,
    content: source.content,
    label: transcriptLabel(source),
    position: args.position,
    contentHash: source.contentHash ?? (await sha256(source.content)),
    createdAt: Date.now(),
  });
}
