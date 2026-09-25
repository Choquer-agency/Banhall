import { describe, expect, it } from "vitest";
import type { Id } from "../_generated/dataModel";
import {
  citeFactQuote,
  factModeCitations,
  factQuotePool,
  factStamp,
  locateVerbatim,
  readsFactPacks,
  resolveFactCitations,
  seedToolSchemaForFacts,
  type FactSource,
} from "./seedFacts";
import { seedToolSchema, validateBatch, type FrozenSeedSource } from "./seedContract";
import { validateCitation } from "./citations";
import { preferFactSources } from "../ai/trustedContext";

const TRANSCRIPT = [
  "Dana Whitfield [00:00:05]: What made the forecast hard?",
  "Priya Shah [00:00:09]: We couldn't forecast net load fast enough\nwhen cloud cover changed.",
  "Dana Whitfield [00:01:10]: So the model hit 71 percent accuracy on sunny days?",
  "Priya Shah [00:01:15]: The model hit 71 percent accuracy on sunny days and 38 percent on cloudy days.",
].join("\n\n");

const DOCUMENT = "Test plan: run the ramp forecaster against the 2025 feeder data.";

function span(needle: string, from = 0) {
  const charStart = TRANSCRIPT.indexOf(needle, from);
  if (charStart === -1) throw new Error(`fixture quote missing: ${needle}`);
  return { charStart, charEnd: charStart + needle.length };
}

const uncertaintyQuote = span("We couldn't forecast net load fast enough\nwhen cloud cover changed.");
const clientResult = span("The model hit 71 percent accuracy on sunny days and 38 percent on cloudy days.");
const interviewerEcho = span("the model hit 71 percent accuracy on sunny days?");

function sources(overrides: { pack?: boolean; spans?: FactSource["factSpans"] } = {}): FactSource[] {
  const rows: FactSource[] = [
    { sourceId: "src-transcript", kind: "transcript", transcriptId: "tr-1", content: TRANSCRIPT, contentHash: "hash-transcript" },
    { sourceId: "src-doc", kind: "project_document", content: DOCUMENT, contentHash: "hash-doc" },
  ];
  if (overrides.pack !== false) {
    rows.push({
      sourceId: "src-pack",
      kind: "transcript_facts",
      transcriptId: "tr-1",
      content: "Transcript 1: Call\n\n[F1-1] (uncertainty) ...",
      contentHash: "hash-pack",
      factSpans: overrides.spans ?? [
        {
          id: "F1-1",
          type: "uncertainty",
          quotes: [{ ...uncertaintyQuote, speakerLabel: "Priya Shah", role: "client", startMs: 9_000 }],
        },
        {
          id: "F1-2",
          type: "result",
          quotes: [
            { ...clientResult, speakerLabel: "Priya Shah", role: "client", startMs: 75_000 },
            // A span stored with an interviewer role never becomes evidence.
            { ...interviewerEcho, speakerLabel: "Dana Whitfield", role: "interviewer", startMs: 70_000 },
          ],
        },
      ],
    });
  }
  return rows;
}

function frozen(rows: readonly FactSource[]): FrozenSeedSource[] {
  return rows.map((row) => ({ sourceId: row.sourceId, content: row.content, contentHash: row.contentHash ?? "" }));
}

const bullet = (text: string) => ({ bullets: [text], tags: ["technical"] });

describe("fact mode is on only when every transcript has its pack", () => {
  it("reads packs with one per transcript, and falls back when any is missing", () => {
    expect(readsFactPacks(sources())).toBe(true);
    expect(readsFactPacks(sources({ pack: false }))).toBe(false);
    expect(
      readsFactPacks([
        ...sources(),
        { sourceId: "src-t2", kind: "transcript", transcriptId: "tr-2", content: "Second call." },
      ])
    ).toBe(false);
    const documentOnly: FactSource[] = [{ sourceId: "src-doc", kind: "project_document", content: DOCUMENT }];
    expect(readsFactPacks(documentOnly)).toBe(false);
  });

  it("puts each pack in its transcript's place and drops digests; a partial set keeps today's reading", () => {
    const withDigest: FactSource[] = [
      ...sources(),
      { sourceId: "src-digest", kind: "transcript_digest", transcriptId: "tr-1", content: "DIGEST" },
    ];
    expect(preferFactSources(withDigest).map((row) => row.sourceId)).toEqual(["src-pack", "src-doc"]);
    const partial: FactSource[] = [
      ...withDigest,
      { sourceId: "src-t2", kind: "transcript", transcriptId: "tr-2", content: "Second call." },
    ];
    // Today's path: the digest replaces its transcript, and the pack a
    // partial extraction froze is not read at all.
    expect(preferFactSources(partial).map((row) => row.sourceId)).toEqual(["src-digest", "src-doc", "src-t2"]);
  });
});

describe("a Seed cites a fact by id and gets verbatim offsets", () => {
  it("resolves a fact id to its client span on the transcript row, which passes validateCitation", () => {
    const { seeds, unresolved } = resolveFactCitations(
      [{ ...bullet("Net load could not be forecast when cloud cover changed."), provenance: [{ factId: "F1-1" }] }],
      sources()
    );
    expect(unresolved).toBe(0);
    const provenance = (seeds[0] as { provenance: Array<Record<string, unknown>> }).provenance;
    expect(provenance).toEqual([
      {
        sourceId: "src-transcript",
        startOffset: uncertaintyQuote.charStart,
        endOffset: uncertaintyQuote.charEnd,
        exactExcerpt: TRANSCRIPT.slice(uncertaintyQuote.charStart, uncertaintyQuote.charEnd),
        factId: "F1-1",
      },
    ]);
    const citation = provenance[0] as { startOffset: number; endOffset: number; exactExcerpt: string };
    expect(
      validateCitation(
        { _id: "src-transcript" as Id<"generationSources">, content: TRANSCRIPT, contentHash: "hash-transcript" },
        { sourceContentHash: "hash-transcript", ...citation }
      )
    ).toBe(true);
  });

  it("never resolves an interviewer span, and the Seed contract makes the result source-supported", () => {
    const { seeds } = resolveFactCitations(
      [
        { ...bullet("Accuracy reached 71 percent on sunny days."), provenance: [{ factId: "F1-2" }] },
        { ...bullet("Cloudy days were much harder."), provenance: [{ factId: "F1-2" }] },
        { ...bullet("The team planned a feeder test."), provenance: [] },
      ],
      sources()
    );
    const cited = (seeds[0] as { provenance: Array<{ startOffset: number }> }).provenance;
    expect(cited.map((citation) => citation.startOffset)).toEqual([clientResult.charStart]);
    const result = validateBatch({ roleId: "active_uncertainties", mode: "batch", seeds, frozenSources: frozen(sources()) });
    expect(result.seeds.map((seed) => seed.support)).toEqual(["source_supported", "source_supported", "writer_asserted"]);
    expect(result.seeds[0].provenance[0]).toMatchObject({ factId: "F1-2", sourceContentHash: "hash-transcript" });
  });

  it("locates a document excerpt, and refuses a transcript excerpt, an unknown fact and a pack excerpt", () => {
    const { seeds, unresolved } = resolveFactCitations(
      [
        {
          ...bullet("A feeder test was planned."),
          provenance: [
            // Copied with its line break flattened: still the verbatim span.
            { sourceId: "src-doc", exactExcerpt: "run the ramp   forecaster" },
            { sourceId: "src-transcript", exactExcerpt: "What made the forecast hard?" },
            { sourceId: "src-pack", exactExcerpt: "Transcript 1: Call" },
            { factId: "F9-9" },
            "not a citation",
          ],
        },
      ],
      sources()
    );
    expect(unresolved).toBe(4);
    const provenance = (seeds[0] as { provenance: Array<Record<string, unknown>> }).provenance;
    expect(provenance).toEqual([
      { sourceId: "src-doc", startOffset: 11, endOffset: 34, exactExcerpt: "run the ramp forecaster" },
    ]);
  });

  it("the fact schema asks for fact ids or document excerpts, never offsets", () => {
    const schema = seedToolSchemaForFacts() as unknown as {
      properties: { seeds: { items: { properties: { provenance: { items: { properties: Record<string, unknown> } } } } } };
    };
    expect(Object.keys(schema.properties.seeds.items.properties.provenance.items.properties)).toEqual([
      "factId",
      "sourceId",
      "exactExcerpt",
    ]);
    // The offsets schema is untouched for every other generation.
    expect(JSON.stringify(seedToolSchema())).toContain("startOffset");
    expect(JSON.stringify(seedToolSchemaForFacts())).not.toContain("startOffset");
  });
});

describe("the write boundary keeps only fact spans", () => {
  it("drops a transcript citation without a matching fact span, and any pack or digest citation", () => {
    const rows = sources();
    const { kept, dropped } = factModeCitations(
      [
        { sourceId: "src-transcript", startOffset: clientResult.charStart, endOffset: clientResult.charEnd, factId: "F1-2" },
        { sourceId: "src-transcript", startOffset: interviewerEcho.charStart, endOffset: interviewerEcho.charEnd, factId: "F1-2" },
        { sourceId: "src-transcript", startOffset: 0, endOffset: 10 },
        { sourceId: "src-pack", startOffset: 0, endOffset: 10 },
        { sourceId: "src-doc", startOffset: 11, endOffset: 34, factId: "F1-1" },
      ],
      rows
    );
    expect(dropped).toBe(3);
    expect(kept).toEqual([
      { sourceId: "src-transcript", startOffset: clientResult.charStart, endOffset: clientResult.charEnd, factId: "F1-2" },
      { sourceId: "src-doc", startOffset: 11, endOffset: 34 },
    ]);
  });

  it("never resolves an `other` speaker's span, and flags a span whose speaker has no role (decisions 24, 25)", () => {
    const rows = sources({
      spans: [
        { id: "F1-1", type: "uncertainty", quotes: [{ ...uncertaintyQuote, speakerLabel: "Vendor Rep", role: "other" }] },
        { id: "F1-2", type: "result", quotes: [{ ...clientResult, role: "unknown", needsSpeakerCheck: true }] },
      ],
    });
    const { seeds, unresolved } = resolveFactCitations(
      [{ ...bullet("A."), provenance: [{ factId: "F1-1" }, { factId: "F1-2" }] }],
      rows
    );
    expect(unresolved).toBe(1);
    expect((seeds[0] as { provenance: Array<{ factId: string }> }).provenance.map((citation) => citation.factId)).toEqual(["F1-2"]);
    expect(
      factStamp(rows, { sourceId: "src-transcript", factId: "F1-2", startOffset: clientResult.charStart, endOffset: clientResult.charEnd })
    ).toEqual({ factKey: "F1-2", role: "unknown", needsSpeakerCheck: true });
  });

  it("stamps the fact id with the turn's speaker, role and time", () => {
    expect(
      factStamp(sources(), {
        sourceId: "src-transcript",
        factId: "F1-2",
        startOffset: clientResult.charStart,
        endOffset: clientResult.charEnd,
      })
    ).toEqual({ factKey: "F1-2", role: "client", startMs: 75_000, speaker: "Priya Shah" });
    expect(factStamp(sources(), { sourceId: "src-transcript", startOffset: 0, endOffset: 5 })).toBeNull();
  });
});

describe("quotes read from a pack cite the transcript row (Brief, sections)", () => {
  it("finds a quote inside a verified span even when the pack printed it on one line", () => {
    const cited = citeFactQuote(sources(), "“We couldn't forecast net load fast enough when cloud cover changed.”");
    expect(cited).toMatchObject({
      factId: "F1-1",
      sourceId: "src-transcript",
      startOffset: uncertaintyQuote.charStart,
      endOffset: uncertaintyQuote.charEnd,
    });
    expect(TRANSCRIPT.slice(cited!.startOffset, cited!.endOffset)).toBe(cited!.exactExcerpt);
  });

  it("never lands in an interviewer turn, and a claim that is not a quote cites nothing", () => {
    // The interviewer said these words first; the client span is cited.
    const cited = citeFactQuote(sources(), "hit 71 percent accuracy on sunny days");
    expect(cited!.startOffset).toBeGreaterThan(interviewerEcho.charEnd);
    expect(citeFactQuote(sources(), "Accuracy was poor on cloudy days")).toBeNull();
    expect(citeFactQuote(sources({ pack: false }), "We couldn't forecast net load")).toBeNull();
  });

  it("pools every verified quote in pack order", () => {
    expect(factQuotePool(sources()).map((entry) => [entry.factId, entry.type, entry.startOffset])).toEqual([
      ["F1-1", "uncertainty", uncertaintyQuote.charStart],
      ["F1-2", "result", clientResult.charStart],
    ]);
  });

  it("locateVerbatim prefers the exact text and otherwise lets whitespace runs match", () => {
    expect(locateVerbatim("a  b\nc", "a  b\nc")).toEqual({ start: 0, end: 6 });
    expect(locateVerbatim("x a  b\nc", "a b c")).toEqual({ start: 2, end: 8 });
    expect(locateVerbatim("abc", "zzz")).toBeNull();
    expect(locateVerbatim("abc", "   ")).toBeNull();
  });
});
