/**
 * Fact citations (phase 3, the transcript method; plan steps 7 and 8). Pure:
 * no ctx, no network.
 *
 * When a generation froze a fact pack for every transcript, its readers see
 * the packs instead of the transcripts. A Seed then cites a transcript by
 * fact id (`{ factId: "F2-7" }`) or a document by an exact excerpt
 * (`{ sourceId, exactExcerpt }`), never by character offsets, and the Brief
 * and the report sections quote what the packs show. This module turns all
 * of that into offset citations on the frozen transcript row (never the
 * pack): a fact resolves to its verified span, and every result is still
 * byte-checked by the Seed contract or `validateCitation`.
 *
 * Owner decision 25: the spans behind a fact id are client turns only
 * (interviewer quotes are left out when the pack is frozen), and in fact
 * mode a transcript can never be cited by excerpt, so an interviewer's words
 * cannot become evidence.
 */
import type { SeedToolInputSchema } from "./seedContract";
import { seedToolSchema } from "./seedContract";
import type { TranscriptFactType, TranscriptSpeakerRole } from "./transcriptValidators";

export type FactSpanQuote = {
  charStart: number;
  charEnd: number;
  speakerLabel?: string;
  role?: TranscriptSpeakerRole;
  startMs?: number;
};

/** One fact id of a frozen pack and the verified spans behind it. */
export type FactSpan = {
  id: string;
  type: TranscriptFactType;
  quotes: readonly FactSpanQuote[];
};

/** The frozen `generationSources` fields fact citations read. */
export type FactSource = {
  sourceId: string;
  kind: string;
  content: string;
  contentHash?: string;
  transcriptId?: string | null;
  factSpans?: readonly FactSpan[] | null;
};

/** Transcript kinds a Seed may reach only through a fact id in fact mode. */
const TRANSCRIPT_KINDS = new Set(["transcript", "transcript_digest", "transcript_facts"]);

/** Quotes one fact citation contributes to a Seed. */
export const QUOTES_PER_FACT = 2;

export type ResolvedCitation = {
  sourceId: string;
  startOffset: number;
  endOffset: number;
  exactExcerpt: string;
  factId?: string;
};

/**
 * Whether frozen rows are read through fact packs: every frozen transcript
 * row has its `transcript_facts` row. A generation whose extraction stopped
 * part way is read today's way, and the packs it did freeze are ignored
 * (owner decision 27: facts missing or failed fall back).
 */
export function readsFactPacks(
  rows: readonly { kind: string; transcriptId?: string | null }[]
): boolean {
  const transcripts = rows.filter((row) => row.kind === "transcript");
  if (transcripts.length === 0) return false;
  const packed = new Set(
    rows
      .filter((row) => row.kind === "transcript_facts" && row.transcriptId)
      .map((row) => row.transcriptId as string)
  );
  return transcripts.every((row) => !!row.transcriptId && packed.has(row.transcriptId));
}

/**
 * The one Seed tool schema for a generation that reads fact packs. Same
 * shape as `seedToolSchema` except each provenance item names a fact or a
 * document excerpt; one schema for every role and mode keeps the cached
 * tools prefix shared within the generation.
 */
export function seedToolSchemaForFacts(): SeedToolInputSchema {
  const schema = structuredClone(seedToolSchema()) as {
    type: "object";
    properties: { seeds: { items: { properties: Record<string, unknown> } } };
  };
  schema.properties.seeds.items.properties.provenance = {
    type: "array",
    items: {
      type: "object",
      additionalProperties: false,
      properties: {
        factId: {
          type: "string",
          description: "Id of a verified transcript fact, for example F1-12.",
        },
        sourceId: {
          type: "string",
          description: "The sourceId of a frozen document, only with exactExcerpt.",
        },
        exactExcerpt: {
          type: "string",
          description: "Text copied exactly from that document.",
        },
      },
    },
  };
  return schema as unknown as SeedToolInputSchema;
}

/** Fact id to its frozen evidence and the transcript row it spans. */
export function factIndex(
  sources: readonly FactSource[]
): Map<string, { span: FactSpan; transcript: FactSource }> {
  const transcriptRows = new Map<string, FactSource>();
  for (const source of sources) {
    if (source.kind === "transcript" && source.transcriptId) {
      transcriptRows.set(source.transcriptId, source);
    }
  }
  const facts = new Map<string, { span: FactSpan; transcript: FactSource }>();
  for (const source of sources) {
    if (source.kind !== "transcript_facts" || !source.transcriptId || !source.factSpans) continue;
    const transcript = transcriptRows.get(source.transcriptId);
    if (!transcript) continue;
    for (const span of source.factSpans) {
      const quotes = span.quotes.filter(
        (quote) =>
          quote.role !== "interviewer" &&
          Number.isInteger(quote.charStart) &&
          Number.isInteger(quote.charEnd) &&
          quote.charStart >= 0 &&
          quote.charEnd > quote.charStart &&
          quote.charEnd <= transcript.content.length
      );
      facts.set(span.id, { span: { ...span, quotes }, transcript });
    }
  }
  return facts;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Where `excerpt` sits in `content`: the exact text first, then the same
 * words with any run of whitespace standing for any other (a model copies a
 * line break as a space). The returned span is always verbatim content.
 */
export function locateVerbatim(
  content: string,
  excerpt: string
): { start: number; end: number } | null {
  const trimmed = excerpt.trim();
  if (trimmed === "") return null;
  const exact = content.indexOf(trimmed);
  if (exact !== -1) return { start: exact, end: exact + trimmed.length };
  const words = trimmed.split(/\s+/u).map(escapeRegExp);
  if (words.length < 2) return null;
  const match = new RegExp(words.join("\\s+"), "u").exec(content);
  return match ? { start: match.index, end: match.index + match[0].length } : null;
}

/**
 * Rewrites every Seed's provenance from fact ids and document excerpts to
 * offset citations on frozen rows. Items that resolve to nothing are left
 * out and counted; the Seed contract counts them as malformed as before, and
 * the Seed stays, writer-asserted when nothing else supports it.
 */
export function resolveFactCitations(
  seeds: readonly unknown[],
  sources: readonly FactSource[]
): { seeds: unknown[]; unresolved: number } {
  const facts = factIndex(sources);
  const byId = new Map(sources.map((source) => [source.sourceId, source]));
  let unresolved = 0;
  const out = seeds.map((seed) => {
    if (!isRecord(seed) || !Array.isArray(seed.provenance)) return seed;
    const provenance: ResolvedCitation[] = [];
    const seen = new Set<string>();
    const push = (citation: ResolvedCitation) => {
      const key = `${citation.sourceId}:${citation.startOffset}:${citation.endOffset}`;
      if (seen.has(key)) return;
      seen.add(key);
      provenance.push(citation);
    };
    for (const item of seed.provenance) {
      if (!isRecord(item)) {
        unresolved += 1;
        continue;
      }
      if (typeof item.factId === "string") {
        const fact = facts.get(item.factId.trim());
        const quotes = fact?.span.quotes.slice(0, QUOTES_PER_FACT) ?? [];
        if (!fact || quotes.length === 0) {
          unresolved += 1;
          continue;
        }
        for (const quote of quotes) {
          push({
            sourceId: fact.transcript.sourceId,
            startOffset: quote.charStart,
            endOffset: quote.charEnd,
            exactExcerpt: fact.transcript.content.slice(quote.charStart, quote.charEnd),
            factId: fact.span.id,
          });
        }
        continue;
      }
      if (typeof item.sourceId === "string" && typeof item.exactExcerpt === "string") {
        const source = byId.get(item.sourceId);
        const at =
          source && !TRANSCRIPT_KINDS.has(source.kind)
            ? locateVerbatim(source.content, item.exactExcerpt)
            : null;
        if (!source || !at) {
          unresolved += 1;
          continue;
        }
        push({
          sourceId: source.sourceId,
          startOffset: at.start,
          endOffset: at.end,
          exactExcerpt: source.content.slice(at.start, at.end),
        });
        continue;
      }
      unresolved += 1;
    }
    return { ...seed, provenance };
  });
  return { seeds: out, unresolved };
}

/**
 * Keeps only the citations fact mode allows, for the write boundary: a
 * transcript row only at a span of the fact it names, and never a pack or a
 * digest row. Everything else is dropped and counted.
 */
export function factModeCitations<
  C extends { sourceId: string; startOffset: number; endOffset: number; factId?: string },
>(citations: readonly C[], sources: readonly FactSource[]): { kept: C[]; dropped: number } {
  const facts = factIndex(sources);
  const byId = new Map(sources.map((source) => [source.sourceId, source]));
  const kept: C[] = [];
  let dropped = 0;
  for (const citation of citations) {
    const source = byId.get(citation.sourceId);
    if (!source) {
      dropped += 1;
      continue;
    }
    if (!TRANSCRIPT_KINDS.has(source.kind)) {
      const { factId: _unused, ...rest } = citation;
      kept.push(rest as C);
      continue;
    }
    const fact = citation.factId ? facts.get(citation.factId) : undefined;
    const matches =
      source.kind === "transcript" &&
      fact?.transcript.sourceId === source.sourceId &&
      fact.span.quotes.some(
        (quote) => quote.charStart === citation.startOffset && quote.charEnd === citation.endOffset
      );
    if (matches) kept.push(citation);
    else dropped += 1;
  }
  return { kept, dropped };
}

/** Speaker, role and time of a stored citation that came from a fact. */
export function factStamp(
  sources: readonly FactSource[],
  citation: { sourceId: string; factId?: string; startOffset: number; endOffset: number }
): { factKey: string; role?: TranscriptSpeakerRole; startMs?: number; speaker?: string } | null {
  if (!citation.factId) return null;
  const fact = factIndex(sources).get(citation.factId);
  if (!fact || fact.transcript.sourceId !== citation.sourceId) return null;
  const quote = fact.span.quotes.find(
    (candidate) => candidate.charStart === citation.startOffset && candidate.charEnd === citation.endOffset
  );
  if (!quote) return null;
  return {
    factKey: fact.span.id,
    ...(quote.role ? { role: quote.role } : {}),
    ...(quote.startMs !== undefined ? { startMs: quote.startMs } : {}),
    ...(quote.speakerLabel ? { speaker: quote.speakerLabel } : {}),
  };
}

/** A verified quote of a fact pack, located on its frozen transcript row. */
export type FactQuoteCitation = {
  factId: string;
  type: TranscriptFactType;
  sourceId: string;
  sourceContentHash: string;
  startOffset: number;
  endOffset: number;
  exactExcerpt: string;
};

/**
 * Every verified quote behind the frozen packs, in pack order: the quote
 * pool report sections cite from (plan step 8). Client turns only.
 */
export function factQuotePool(sources: readonly FactSource[]): FactQuoteCitation[] {
  const pool: FactQuoteCitation[] = [];
  for (const [factId, { span, transcript }] of factIndex(sources)) {
    for (const quote of span.quotes) {
      pool.push({
        factId,
        type: span.type,
        sourceId: transcript.sourceId,
        sourceContentHash: transcript.contentHash ?? "",
        startOffset: quote.charStart,
        endOffset: quote.charEnd,
        exactExcerpt: transcript.content.slice(quote.charStart, quote.charEnd),
      });
    }
  }
  return pool;
}

/**
 * A quote a model copied from a fact pack, located inside a verified span
 * of the transcript row behind it (exact, or with whitespace runs matching
 * any whitespace, since the pack prints each quote on one line). Returns
 * the citation on the frozen transcript row, never the pack, or null.
 */
export function citeFactQuote(
  sources: readonly FactSource[],
  quote: string
): FactQuoteCitation | null {
  const wanted = quote.trim().replace(/^["“]+|["”]+$/g, "").trim();
  if (wanted === "") return null;
  for (const entry of factQuotePool(sources)) {
    const at = locateVerbatim(entry.exactExcerpt, wanted);
    if (!at) continue;
    return {
      ...entry,
      startOffset: entry.startOffset + at.start,
      endOffset: entry.startOffset + at.end,
      exactExcerpt: entry.exactExcerpt.slice(at.start, at.end),
    };
  }
  return null;
}
