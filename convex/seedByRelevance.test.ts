import { describe, expect, it } from "vitest";
import { buildSeedPrompt, seedSentRanges, type SeedPromptSource } from "./ai/trustedContext";
import { evidenceSpan } from "./lib/citationSpeakers";
import { maskOutside } from "../shared/evidenceChoice";
import { validateSeed } from "./lib/seedContract";

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
  it("adds every span a Brief entry cites to what a source sent, and blanks the rest", () => {
    const sources = largeSources();
    const built = buildSeedPrompt(base(sources, true));
    const sent = seedSentRanges(built.sources, BRIEF.entries);
    const d3 = sources.find((source) => source.sourceId === "d3")!;
    const d3Sent = sent.find((entry) => entry.sourceId === "d3");
    if (d3Sent) {
      const masked = maskOutside(d3.content, d3Sent.ranges);
      // The Brief entry's own span stays citable.
      expect(masked.slice(120, 139)).toBe(d3.content.slice(120, 139));
    }
    // A source sent whole is not listed, so it is checked as before.
    expect(sent.find((entry) => entry.sourceId === "t1")).toBeUndefined();
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
