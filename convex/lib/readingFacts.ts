/**
 * Round 2 (F2, decision 57): "Reading the interview". While the Step-by-step
 * Brief is written, each entry the model finishes is located on the frozen
 * transcript and written to `generationReadingFacts`, which only feeds the
 * pill and the fact list. Display only: never generation input.
 *
 * Chips map the Brief's existing groups (option A, no prompt change):
 * Storyline claims are "Storyline"; Confidence Map entries are "Fact"
 * (established), "Partly known" (partial) or "Uncertainty" (unresolved);
 * unreliable entries and Claim Exclusions are not shown; glossary terms are
 * "Product name" for a proper noun, else "Term".
 */
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { ActionCtx, MutationCtx, QueryCtx } from "../_generated/server";
import type { FunctionReference } from "convex/server";
import { PartialJsonItems, type PartialItem } from "./partialJsonItems";
import { locateCitations } from "./seedContract";
import { restorePlaceholders, type PlaceholderMap } from "./deidentify";
import type { Citation } from "./citations";
import { getInternalProjectAccessOrNull } from "./auth";
import { resolveGatedWorkflow } from "./gatedWorkflow";

export const READING_FACTS_FLUSH_MS = 750;
export const READING_QUOTE_CHARS = 300;
export const REUSED_BRIEF_FACTS = 30;
export const READING_FACTS_PER_WRITE = 50;
/** The pill's pace when no recent Brief says otherwise. */
export const DEFAULT_BRIEF_MS = 45_000;
const BRIEF_CALL_SITE = "generation:brief";

export const readingFactValidator = v.object({
  chip: v.string(),
  quote: v.string(),
  sourceLabel: v.string(),
  speaker: v.optional(v.string()),
  line: v.optional(v.number()),
});

export type ReadingFact = {
  chip: string;
  quote: string;
  sourceLabel: string;
  speaker?: string;
  line?: number;
};

type ConfidenceLevel = "established" | "partial" | "unresolved" | "unreliable";

export function confidenceChip(confidence: ConfidenceLevel | undefined): string | null {
  switch (confidence) {
    case "established":
      return "Fact";
    case "partial":
      return "Partly known";
    case "unresolved":
      return "Uncertainty";
    default:
      return null;
  }
}

/** A glossary term reads as a product name when any word starts upper case. */
export function glossaryChip(term: string): string {
  return /(^|\s)\p{Lu}/u.test(term.trim()) ? "Product name" : "Term";
}

/** The sentence around an excerpt, for a glossary term shown on its own. */
export function sentenceAround(content: string, start: number, end: number): string {
  const before = content.slice(Math.max(0, start - 240), start);
  const after = content.slice(end, end + 240);
  const open = Math.max(before.lastIndexOf(". "), before.lastIndexOf("\n"), before.lastIndexOf("? "), before.lastIndexOf("! "));
  const closeMatch = /[.?!](\s|$)|\n/.exec(after);
  const head = open >= 0 ? before.slice(open + 1) : before;
  const tail = closeMatch ? after.slice(0, closeMatch.index + 1) : after;
  return `${head}${content.slice(start, end)}${tail}`.replace(/\s+/g, " ").trim();
}

export function boundQuote(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= READING_QUOTE_CHARS ? clean : `${clean.slice(0, READING_QUOTE_CHARS - 3).trimEnd()}...`;
}

type SourceRow = Pick<Doc<"generationSources">, "_id" | "kind" | "label" | "content">;

/** "Priya, line 18"; "{transcript label}, line 18" with no speaker; a document's file name. */
export function placeOf(source: SourceRow, citation: Pick<Citation, "startOffset" | "endOffset">) {
  if (source.kind !== "transcript") {
    const colon = source.label.indexOf(":");
    return { sourceLabel: colon >= 0 ? source.label.slice(colon + 1) : source.label };
  }
  const [where] = locateCitations(source.content, [citation]);
  const speaker = where?.speaker?.trim();
  return {
    sourceLabel: speaker ? `${speaker}, line ${where.line}` : `${source.label}, line ${where?.line ?? 1}`,
    ...(speaker ? { speaker } : {}),
    ...(where ? { line: where.line } : {}),
  };
}

/** One streamed Brief entry as a candidate fact, before it is located. */
export function candidateOf(
  item: PartialItem,
  options: { writerStoryline: boolean; placeholders: PlaceholderMap }
): { chip: string; quote: string; glossary: boolean } | null {
  const value = (item.value ?? {}) as Record<string, unknown>;
  const text = (key: string) =>
    typeof value[key] === "string" ? restorePlaceholders(value[key] as string, options.placeholders) : "";
  if (item.array === "storylineClaims") {
    if (options.writerStoryline) return null;
    const quote = text("quote");
    return quote ? { chip: "Storyline", quote, glossary: false } : null;
  }
  if (item.array === "confidenceMap") {
    const chip = confidenceChip(value.confidence as ConfidenceLevel | undefined);
    const quote = text("quote");
    return chip && quote ? { chip, quote, glossary: false } : null;
  }
  const term = text("term");
  if (!term) return null;
  return { chip: glossaryChip(term), quote: text("quote") || term, glossary: true };
}

export type ReadingFactsCtx = Pick<ActionCtx, "runMutation">;

/**
 * Collects facts from the streamed tool input: `onToolInput` is the stream
 * handler (never throws), `finish` writes whatever is left. Writes are
 * batched at most every READING_FACTS_FLUSH_MS; located entries only, each
 * quote once.
 */
export function createReadingFactsCollector(options: {
  ctx: ReadingFactsCtx;
  generationId: Id<"generations">;
  append: FunctionReference<"mutation", "internal", { generationId: Id<"generations">; facts: ReadingFact[] }, null>;
  sources: readonly SourceRow[];
  writerStoryline: boolean;
  placeholders: PlaceholderMap;
  /** Where a quote sits, owner decision 25 applied; null when it does not locate. */
  locate: (quote: string, glossary: boolean) => Promise<Citation | null>;
  now?: () => number;
}) {
  const now = options.now ?? Date.now;
  const scanner = new PartialJsonItems();
  const byId = new Map(options.sources.map((source) => [source._id as string, source]));
  const seen = new Set<string>();
  let pending: ReadingFact[] = [];
  let lastFlush = 0;
  let queue: Promise<void> = Promise.resolve();

  const flush = async () => {
    while (pending.length) {
      const batch = pending.slice(0, READING_FACTS_PER_WRITE);
      pending = pending.slice(READING_FACTS_PER_WRITE);
      lastFlush = now();
      await options.ctx.runMutation(options.append, { generationId: options.generationId, facts: batch });
    }
  };

  const process = async (items: PartialItem[]) => {
    for (const item of items) {
      const candidate = candidateOf(item, options);
      if (!candidate) continue;
      const citation = await options.locate(candidate.quote, candidate.glossary);
      if (!citation) continue;
      const source = byId.get(citation.sourceId);
      if (!source) continue;
      const shown = candidate.glossary
        ? sentenceAround(source.content, citation.startOffset, citation.endOffset)
        : citation.exactExcerpt;
      const quote = boundQuote(shown);
      const key = `${candidate.chip}|${quote}`;
      if (!quote || seen.has(key)) continue;
      seen.add(key);
      pending.push({ chip: candidate.chip, quote, ...placeOf(source, citation) });
    }
    if (pending.length && now() - lastFlush >= READING_FACTS_FLUSH_MS) await flush();
  };

  return {
    onToolInput(snapshot: string) {
      try {
        const items = scanner.push(snapshot);
        if (!items.length) return;
        queue = queue.then(() => process(items)).catch((error: unknown) => {
          console.warn("Reading facts could not be written", error);
        });
      } catch (error) {
        console.warn("Reading facts could not be read", error);
      }
    },
    async finish() {
      try {
        await queue;
        await flush();
      } catch (error) {
        console.warn("Reading facts could not be written", error);
      }
    },
  };
}

/** Whether facts may still be written: the run is starting its seed stage. */
async function acceptsFacts(ctx: MutationCtx, generation: Doc<"generations"> | null) {
  if (!generation) return false;
  if (generation.status !== "reserved" && generation.status !== "running") return false;
  if (resolveGatedWorkflow(generation) !== "seeds" || generation.summaryVersionId) return false;
  const project = await ctx.db.get(generation.projectId);
  if (!project || project.deletionStartedAt !== undefined) return false;
  const seedRow = await ctx.db
    .query("seedSubsections")
    .withIndex("by_generationId", (q) => q.eq("generationId", generation._id))
    .first();
  return seedRow === null;
}

async function nextSeq(ctx: MutationCtx, generationId: Id<"generations">) {
  const last = await ctx.db
    .query("generationReadingFacts")
    .withIndex("by_generationId_and_seq", (q) => q.eq("generationId", generationId))
    .order("desc")
    .first();
  return (last?.seq ?? 0) + 1;
}

/** Appends facts, fenced by the run still starting its seed stage. */
export async function appendReadingFactsHandler(
  ctx: MutationCtx,
  args: { generationId: Id<"generations">; facts: ReadingFact[] }
): Promise<null> {
  const generation = await ctx.db.get(args.generationId);
  if (!(await acceptsFacts(ctx, generation)) || !generation) return null;
  let seq = await nextSeq(ctx, generation._id);
  const createdAt = Date.now();
  for (const fact of args.facts.slice(0, READING_FACTS_PER_WRITE)) {
    await ctx.db.insert("generationReadingFacts", {
      generationId: generation._id,
      projectId: generation.projectId,
      seq,
      chip: fact.chip.slice(0, 40),
      quote: boundQuote(fact.quote),
      sourceLabel: fact.sourceLabel.slice(0, 200),
      ...(fact.speaker ? { speaker: fact.speaker.slice(0, 120) } : {}),
      ...(fact.line !== undefined ? { line: fact.line } : {}),
      createdAt,
    });
    seq += 1;
  }
  return null;
}

/**
 * A reused Brief (same inputs, no model call): its located entries become
 * facts at once, up to REUSED_BRIEF_FACTS, so the screen fills straight away.
 */
export async function copyBriefToReadingFactsHandler(
  ctx: MutationCtx,
  args: { generationId: Id<"generations">; briefId: Id<"generationBriefs"> }
): Promise<null> {
  const generation = await ctx.db.get(args.generationId);
  if (!(await acceptsFacts(ctx, generation)) || !generation) return null;
  const brief = await ctx.db.get(args.briefId);
  if (!brief || brief.projectId !== generation.projectId) return null;
  const already = await ctx.db
    .query("generationReadingFacts")
    .withIndex("by_generationId_and_seq", (q) => q.eq("generationId", generation._id))
    .first();
  if (already) return null;
  const entries = await ctx.db
    .query("generationBriefEntries")
    .withIndex("by_briefId", (q) => q.eq("briefId", brief._id))
    .take(200);
  const sources = new Map<string, SourceRow | null>();
  const facts: ReadingFact[] = [];
  for (const entry of entries) {
    if (facts.length >= REUSED_BRIEF_FACTS) break;
    if (entry.change === "removed") continue;
    const chip =
      entry.group === "storyline"
        ? "Storyline"
        : entry.group === "confidenceMap"
          ? confidenceChip(entry.confidence)
          : entry.group === "glossaryTerm"
            ? glossaryChip(entry.text)
            : null;
    if (!chip) continue;
    // A reused Brief cites the frozen rows of the generation that derived
    // it, which hold the same text: the place is read from them.
    if (!sources.has(entry.sourceId)) sources.set(entry.sourceId, await ctx.db.get(entry.sourceId));
    const source = sources.get(entry.sourceId);
    if (!source) continue;
    const quote =
      entry.group === "glossaryTerm"
        ? sentenceAround(source.content, entry.startOffset, entry.endOffset)
        : entry.exactExcerpt;
    facts.push({ chip, quote: boundQuote(quote), ...placeOf(source, entry) });
  }
  return await appendReadingFactsHandler(ctx, { generationId: generation._id, facts });
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

/** The median time of the last 20 Briefs on this model, or DEFAULT_BRIEF_MS. */
export async function expectedBriefMs(ctx: QueryCtx, model: string | undefined): Promise<number> {
  if (!model) return DEFAULT_BRIEF_MS;
  const rows = await ctx.db
    .query("aiUsage")
    .withIndex("by_callSite_and_createdAt", (q) => q.eq("callSite", BRIEF_CALL_SITE))
    .order("desc")
    .take(100);
  const durations = rows
    .filter((row) => row.model === model && typeof row.durationMs === "number" && row.durationMs > 0)
    .slice(0, 20)
    .map((row) => row.durationMs as number);
  return durations.length ? median(durations) : DEFAULT_BRIEF_MS;
}

export type ReadingFactsView = {
  count: number;
  latest: Array<{ seq: number; chip: string; quote: string; sourceLabel: string }>;
  startedAt: number;
  expectedMs: number;
  done: boolean;
};

/** The pill and the three newest facts; null without internal project read access. */
export async function getReadingFactsHandler(
  ctx: QueryCtx,
  args: { generationId: Id<"generations"> }
): Promise<ReadingFactsView | null> {
  const generation = await ctx.db.get(args.generationId);
  if (!generation) return null;
  if (!(await getInternalProjectAccessOrNull(ctx, generation.projectId))) return null;
  const newest = await ctx.db
    .query("generationReadingFacts")
    .withIndex("by_generationId_and_seq", (q) => q.eq("generationId", generation._id))
    .order("desc")
    .take(3);
  return {
    count: newest[0]?.seq ?? 0,
    latest: newest.map((row) => ({ seq: row.seq, chip: row.chip, quote: row.quote, sourceLabel: row.sourceLabel })),
    startedAt: generation.startedAt,
    expectedMs: await expectedBriefMs(ctx, generation.modelFreeze?.roles?.planning),
    done: Boolean(generation.briefId),
  };
}
