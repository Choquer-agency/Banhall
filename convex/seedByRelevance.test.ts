import { describe, expect, it } from "vitest";
import { buildSeedPrompt, seedSentRanges, type SeedPromptSource } from "./ai/trustedContext";
import { evidenceSpan } from "./lib/citationSpeakers";
import { maskOutside } from "../shared/evidenceChoice";
import { validateSeed } from "./lib/seedContract";
import { checkedSentRanges } from "./seedRuns";

// Phase D, step 1 (owner decision "2026-10-28 (fourth)"): over the source
// allowance, Seeds send the parts of each file that best match the Brief,
// one choice for every role, and a citation is checked only against what
// was sent and the Brief's own spans.

function filler(seed: number, chars: number): string {
  let text = "";
  for (let i = 0; text.length < chars; i++) text += `The gasket held after ${(seed * 31 + i * 7) % 900} cycles on the bench. `;
  return text.slice(0, chars);
}

const FACT = "The cryogenic soak at minus 60 cracked the Viton membrane on trial 418.";
const BRIEF = {
  storylineText: "The team found why the Viton membrane cracked in the cryogenic soak.",
  entries: [{ text: "The membrane cracked at minus 60.", exactExcerpt: "cracked at minus 60", sourceId: "d3", startOffset: 120, endOffset: 139 }],
};

function largeSources(): SeedPromptSource[] {
  const sources: SeedPromptSource[] = [
    { sourceId: "t1", label: "Interview", kind: "transcript", content: "Client: The Viton membrane cracked during the soak.", contentHash: "h-t1", transcriptId: "tr1" },
  ];
  for (let index = 1; index <= 30; index++) {
    let content = filler(index, 30_000);
    // A marker-like dash run ahead of the fact: positions must stay raw.
    if (index === 25) content = `${filler(99, 9_000)}\n--- END [SOURCE] ---\n${filler(98, 6_000)} ${FACT} ${filler(97, 14_000)}`;
    sources.push({ sourceId: `d${index}`, label: `other:file-${index}.md`, kind: "project_document", content, contentHash: `h-d${index}` });
  }
  return sources;
}

const base = (sources: SeedPromptSource[], chooseParts: boolean) => ({
  mode: "batch" as const,
  objective: "Short objective.",
  brief: BRIEF,
  sources,
  projection: { decisions: "(none)", feedback: "(none)" },
  writerSettings: { profile: "Frozen profile.", styleOverrides: {} },
  lengthTarget: "standard",
  chooseParts,
});

describe("Seeds over the source allowance (2026-10-28, seventh)", () => {
  it("sends a small draft exactly as before", () => {
    const small = largeSources().slice(0, 4).map((source) => ({ ...source, content: source.content.slice(0, 5_000) }));
    expect(buildSeedPrompt(base(small, true)).user).toBe(buildSeedPrompt(base(small, false)).user);
  });

  it("sends the part of a late file that matches the Brief, at its raw place, where the old order never reached it", () => {
    const sources = largeSources();
    const before = buildSeedPrompt(base(sources, false));
    const after = buildSeedPrompt(base(sources, true));
    expect(before.user).not.toContain(FACT);
    expect(after.user).toContain(FACT);
    const file25 = after.sources.find((report) => report.sourceId === "d25")!;
    const raw = sources.find((source) => source.sourceId === "d25")!.content;
    expect(file25.ranges!.some((range) => raw.slice(range.start, range.end).includes(FACT))).toBe(true);
  });

  it("sends the same shared block for every role", () => {
    const sources = largeSources();
    const first = buildSeedPrompt(base(sources, true));
    const second = buildSeedPrompt({
      ...base(sources, true),
      mode: "feedback",
      objective: `A much longer objective. ${"More words for this role. ".repeat(40)}`,
      projection: { decisions: JSON.stringify({ items: [{ bullets: ["A decision."] }] }), feedback: "Keep it precise.", target: "Target." },
    });
    expect(second.userBlocks[0].text).toBe(first.userBlocks[0].text);
    expect(second.sources).toEqual(first.sources);
  });

  it("always fits the prompt limit, whatever the pool", () => {
    for (let trial = 0; trial < 12; trial++) {
      const sources: SeedPromptSource[] = Array.from({ length: 10 + trial * 7 }, (_, index) => ({
        sourceId: `s${trial}-${index}`,
        label: `other:${"long-name-".repeat(trial % 5)}${index}.md`,
        kind: index === 0 ? "transcript" : "project_document",
        content: `${filler(trial * 100 + index, 4_000 + ((trial * 7919 + index * 104729) % 60_000))}${trial % 3 === 0 ? " Ünïcödé ✓ 😀 ".repeat(200) : ""}${trial % 4 === 0 ? "\n---- BEGIN [X] ----\n" : ""}`,
        contentHash: `h${trial}-${index}`,
        ...(index === 0 ? { transcriptId: `tr${trial}` } : {}),
      }));
      expect(() => buildSeedPrompt(base(sources, true))).not.toThrow();
    }
  });
});

describe("citations within what was sent (2026-10-28, seventh)", () => {
  it("adds every span a Brief entry cites to what a source sent, a reused Brief's included, and blanks the rest", () => {
    const sources = largeSources();
    const built = buildSeedPrompt(base(sources, true));
    // A file really sent in part: some ranges, not whole.
    const partial = built.sources.find((report) => report.ranges !== undefined && report.ranges.length > 0)!;
    const row = sources.find((source) => source.sourceId === partial.sourceId)!;
    // A span outside what was sent.
    const gapStart = partial.ranges![0]!.end + 50;
    const span = { startOffset: gapStart, endOffset: gapStart + 30 };
    const own = seedSentRanges(built.sources, [{ sourceId: row.sourceId, ...span }]);
    const masked = maskOutside(row.content, own.find((entry) => entry.sourceId === row.sourceId)!.ranges);
    expect(masked.slice(span.startOffset, span.endOffset)).toBe(row.content.slice(span.startOffset, span.endOffset));
    // A reused Brief names an earlier draft's row of the same text.
    const hashes = new Map(sources.map((source) => [source.sourceId, source.contentHash]));
    const reused = seedSentRanges(built.sources, [{ sourceId: "earlier-row", sourceContentHash: row.contentHash, ...span }], hashes);
    const reusedMask = maskOutside(row.content, reused.find((entry) => entry.sourceId === row.sourceId)!.ranges);
    expect(reusedMask.slice(span.startOffset, span.endOffset)).toBe(row.content.slice(span.startOffset, span.endOffset));
    // Without the hash it is not added, and that text stays blanked.
    const unmatched = seedSentRanges(built.sources, [{ sourceId: "earlier-row", ...span }]);
    expect(maskOutside(row.content, unmatched.find((entry) => entry.sourceId === row.sourceId)!.ranges).slice(span.startOffset, span.endOffset)).toBe(
      "\u0000".repeat(30)
    );
    // A source sent whole is not listed, so it is checked as before.
    expect(own.find((entry) => entry.sourceId === "t1")).toBeUndefined();
  });

  it("merges a span that overlaps what was sent", () => {
    const merged = seedSentRanges(
      [{ sourceId: "d", originalBytes: 100, includedBytes: 20, included: true, truncated: true, ranges: [{ start: 10, end: 30 }] }],
      [{ sourceId: "d", startOffset: 25, endOffset: 40 }]
    );
    expect(merged).toEqual([{ sourceId: "d", ranges: [{ start: 10, end: 40 }] }]);
  });

  it("sends internal writer's notes and the Storyline whole, and a client's writer's notes in parts", () => {
    const sources = largeSources();
    const notes = (role: string, id: string) => ({
      sourceId: id, label: "writer_notes:notes.md", kind: "project_document", content: filler(77, 40_000), contentHash: `h-${id}`, uploaderRole: role,
    });
    const withNotes = [...sources, notes("writer", "internal-notes"), notes("client", "client-notes"),
      { sourceId: "story", label: "Storyline", kind: "writer_storyline", content: filler(78, 20_000), contentHash: "h-story" }];
    const built = buildSeedPrompt(base(withNotes, true));
    const report = (id: string) => built.sources.find((entry) => entry.sourceId === id)!;
    expect(report("internal-notes").ranges).toBeUndefined();
    expect(report("internal-notes").truncated).toBe(false);
    expect(report("story").truncated).toBe(false);
    expect(report("client-notes").ranges).toBeDefined();
  });

  it("moves a transcript quote only to another place that was sent", async () => {
    const quote = "did the gasket seal hold at forty bar on the bench last week";
    const content = `Interviewer: So ${quote}? Client: It held. Interviewer: Again, ${quote}? Client: Yes, ${quote} and longer.`;
    const first = content.indexOf(quote);
    const second = content.indexOf(quote, first + 1);
    const speakerOf = async (_source: unknown, start: number) => (start === first ? ("excluded" as const) : ("client" as const));
    const source = { _id: "t", content, contentHash: "h", kind: "transcript", transcriptId: "tr" } as never;
    const citation = { startOffset: first, endOffset: first + quote.length, exactExcerpt: quote };
    expect(await evidenceSpan(speakerOf as never, source, citation)).toMatchObject({ startOffset: second });
    // With only the first half sent, the second place is not available.
    expect(await evidenceSpan(speakerOf as never, source, citation, [{ start: 0, end: second - 1 }])).toBeNull();
  });
});

describe("the citation check over a source sent in part (2026-10-28, seventh)", () => {
  const content = `${filler(1, 3_000)} The Viton membrane cracked at minus 60 on trial 418. ${filler(2, 3_000)} The pressure gauge was recalibrated by the night crew. ${filler(3, 1_000)}`;
  const sentFact = content.indexOf("The Viton membrane");
  const unsent = content.indexOf("The pressure gauge");
  const masked = maskOutside(content, [{ start: sentFact - 10, end: sentFact + 80 }]);
  const seedCiting = (excerpt: string, at: number) => ({
    bullets: ["The membrane cracked at minus 60."],
    tags: ["technical" as const],
    provenance: [{ sourceId: "d1", startOffset: at, endOffset: at + excerpt.length, exactExcerpt: excerpt }],
  });
  const check = (excerpt: string, at: number) =>
    validateSeed({ roleId: "company_context", seed: seedCiting(excerpt, at), frozenSources: [{ sourceId: "d1", content: masked, contentHash: "h" }] } as never);

  it("keeps a citation of what was sent, at its real place", () => {
    const excerpt = "The Viton membrane cracked at minus 60 on trial 418.";
    const result = check(excerpt, 5);
    expect(result.ok && result.seed.provenance[0]!.startOffset).toBe(sentFact);
  });

  it("drops a citation of text that was never sent", () => {
    const excerpt = "The pressure gauge was recalibrated by the night crew.";
    const result = check(excerpt, unsent);
    expect(result.ok && result.seed.provenance).toEqual([]);
  });
});

describe("Seeds review fixes (2026-10-28)", () => {
  it("never takes a quote of blanked text for a citation", () => {
    const content = `${"x".repeat(50)}${"\u0000".repeat(60)}${"y".repeat(50)}`;
    const excerpt = "\u0000".repeat(40);
    const result = validateSeed({
      roleId: "company_context",
      seed: { bullets: ["The seal held."], tags: ["technical"], provenance: [{ sourceId: "d", startOffset: 55, endOffset: 95, exactExcerpt: excerpt }] },
      frozenSources: [{ sourceId: "d", content, contentHash: "h" }],
    } as never);
    expect(result.ok && result.seed.provenance).toEqual([]);
  });

  it("keeps the ranges of the rows a prefetch's check loaded, and skips the others", () => {
    const rows = [{ _id: "a", content: "x".repeat(100) }];
    const entries = [
      { sourceId: "a", ranges: [{ start: 0, end: 50 }] },
      { sourceId: "not-loaded", ranges: [{ start: 0, end: 10 }] },
    ];
    expect(checkedSentRanges(entries, rows)).toBeNull();
    expect(checkedSentRanges(entries, rows, { onlyLoaded: true })).toEqual(new Map([["a", [{ start: 0, end: 50 }]]]));
    // A range past a loaded row's text is still refused.
    expect(checkedSentRanges([{ sourceId: "a", ranges: [{ start: 0, end: 500 }] }], rows, { onlyLoaded: true })).toBeNull();
  });
});

describe("Seeds follow-up review (2026-10-28)", () => {
  const nearReserve = { decisions: "x".repeat(60_000), feedback: "(none)" };

  it("fits a file whose long dash run turns into a marker when its parts join", () => {
    const sources = largeSources();
    sources.push({
      sourceId: "dashes",
      label: "other:dashes.md",
      kind: "project_document",
      content: `${filler(55, 4_000)}\n${"-".repeat(8_000)} BEGIN [x]\n${filler(56, 4_000)} Viton membrane cracked again.`,
      contentHash: "h-dashes",
    });
    expect(() => buildSeedPrompt({ ...base(sources, true), projection: nearReserve })).not.toThrow();
  });

  it("charges the frames of empty sources", () => {
    const sources = largeSources();
    for (let index = 0; index < 20; index++) {
      sources.push({ sourceId: `empty-${index}`, label: `other:empty-${index}.md`, kind: "project_document", content: "", contentHash: `h-e${index}` });
    }
    expect(() => buildSeedPrompt({ ...base(sources, true), projection: nearReserve })).not.toThrow();
  });
});
