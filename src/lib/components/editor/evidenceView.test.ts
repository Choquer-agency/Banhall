import { describe, expect, it } from "vitest";
import { getSchema } from "@tiptap/core";
import { Node as PMNode } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import { getEditorExtensions } from "../../tiptapConfig";
import { buildTiptapDocument } from "../../../../convex/lib/tiptapReport";
import {
  classifyParagraph,
  claimEvidence,
  evidenceAt,
  evidenceRanges,
  evidenceSummary,
  evidenceViewKey,
  evidenceViewPlugin,
  matchClaims,
  sentenceRanges,
  type EvidenceClaim,
} from "./evidenceView";

const extensions = getEditorExtensions();
const schema = getSchema(extensions);

function docOf(s242: string, s244: string, s246: string): PMNode {
  return PMNode.fromJSON(schema, buildTiptapDocument("Cold room readiness", s242, s244, s246));
}

function claim(partial: Partial<EvidenceClaim> & Pick<EvidenceClaim, "claimText">): EvidenceClaim {
  return { claimId: "242-1", section: "242", state: "needs_review", sources: [], ...partial };
}

const QUOTE = { exactExcerpt: "we never knew if the room had settled", speaker: "Client", timestampStart: "00:12:30" };

const sentences = (text: string) => sentenceRanges(text).map(({ start, end }) => text.slice(start, end));
const pieces = (text: string, spans: ReturnType<typeof classifyParagraph>) => spans.map(({ start, end }) => text.slice(start, end));

describe("sentenceRanges", () => {
  it("splits on full stops, question and exclamation marks, trimming the spaces", () => {
    expect(sentences("One. Two? Three!  Four")).toEqual(["One.", "Two?", "Three!", "Four"]);
  });

  it("keeps a marker with the sentence before it, and ends the sentence there", () => {
    const text = "Readings drifted. [INFERRED: the source says so. Twice.] Then the team held each sample.";
    expect(sentences(text)).toEqual([
      "Readings drifted. [INFERRED: the source says so. Twice.]",
      "Then the team held each sample.",
    ]);
  });

  it("keeps two markers in a row with their sentence", () => {
    const text = "The range was set. [GAP: confirm the range] [INFERRED: implied by the setpoints] Next.";
    expect(sentences(text)).toEqual([
      "The range was set. [GAP: confirm the range] [INFERRED: implied by the setpoints]",
      "Next.",
    ]);
  });

  it("does not split after e.g., approx. and the like, or inside quotes", () => {
    expect(sentences("Sensors, e.g. probes, drifted approx. 2 degrees. Done.")).toEqual([
      "Sensors, e.g. probes, drifted approx. 2 degrees.",
      "Done.",
    ]);
    expect(sentences('He said "it moved." Then it stopped.')).toEqual(['He said "it moved."', "Then it stopped."]);
  });

  it("returns nothing for blank text", () => {
    expect(sentenceRanges("   ")).toEqual([]);
  });
});

describe("claimEvidence", () => {
  it("leaves a paragraph with no claim, or a sourceless claim that needs review, plain", () => {
    expect(claimEvidence(null)).toBeNull();
    expect(claimEvidence(claim({ claimText: "x" }))).toBeNull();
    // Review round 1: green needs a linked quote, so an approval alone stays plain.
    expect(claimEvidence(claim({ claimText: "x", state: "approved" }))).toBeNull();
  });

  it("colours a linked claim green and says it is not checked yet, with the quote", () => {
    expect(claimEvidence(claim({ claimText: "x", sources: [QUOTE] }))).toEqual({
      kind: "supported",
      basis: "linked",
      reason: "Linked to a source quote, not checked yet: “we never knew if the room had settled” (Client, 00:12:30)",
    });
  });

  it("says a reviewer checked an approved claim's source", () => {
    const result = claimEvidence(claim({ claimText: "x", state: "approved", sources: [QUOTE, QUOTE] }));
    expect(result?.kind).toBe("supported");
    expect(result?.basis).toBe("checked");
    expect(result?.reason).toBe("Source checked by a reviewer: “we never knew if the room had settled” (Client, 00:12:30) and 1 more");
  });

  it("colours an unsupported claim red, saying whether a reviewer marked it", () => {
    expect(claimEvidence(claim({ claimText: "x", state: "unsupported" }))).toEqual({
      kind: "unsupported",
      basis: "unsupported",
      reason: "Not backed by a source: no source quote is linked to this paragraph.",
    });
    expect(claimEvidence(claim({ claimText: "x", state: "unsupported", sources: [QUOTE] }))?.reason).toBe(
      "Not backed by a source: a reviewer marked this paragraph unsupported."
    );
  });

  it("shortens a long quote", () => {
    const reason = claimEvidence(claim({ claimText: "x", sources: [{ exactExcerpt: "word ".repeat(80) }] }))!.reason;
    expect(reason.length).toBeLessThan(220);
    expect(reason).toContain("...”");
  });
});

describe("classifyParagraph", () => {
  const MARKED = "Readiness was first judged from single readings. [INFERRED: the source stresses stability] The team then held each sample for an hour.";

  it("marks the sentence before an [INFERRED] marker red, without the chip, even in a linked paragraph", () => {
    const spans = classifyParagraph(MARKED, claim({ claimText: MARKED, sources: [QUOTE] }));
    expect(pieces(MARKED, spans)).toEqual([
      "Readiness was first judged from single readings.",
      "The team then held each sample for an hour.",
    ]);
    expect(spans.map((span) => [span.kind, span.basis])).toEqual([
      ["unsupported", "marker"],
      ["supported", "linked"],
    ]);
    expect(spans[0].reason).toBe("Inferred: not stated in the sources. The AI's reason: the source stresses stability");
  });

  it("marks inferred sentences with no claim record, and leaves the rest plain", () => {
    const spans = classifyParagraph(MARKED, null);
    expect(pieces(MARKED, spans)).toEqual(["Readiness was first judged from single readings."]);
  });

  it("colours around a gap chip and never colours a sentence that is only a gap", () => {
    const text = "We tested [GAP: how many] samples. [GAP: what was tried first]";
    const spans = classifyParagraph(text, claim({ claimText: text, sources: [QUOTE] }));
    expect(pieces(text, spans)).toEqual(["We tested", "samples."]);
    expect(new Set(spans.map((span) => span.sentence)).size).toBe(1);
  });
});

describe("matchClaims", () => {
  it("matches by exact wording within the Line, spaces evened out, in order", () => {
    const first = claim({ claimId: "a", claimText: "Same words." });
    const second = claim({ claimId: "b", claimText: "Same  words.\n" });
    const other = claim({ claimId: "c", section: "244", claimText: "Other." });
    const matched = matchClaims(
      [
        { section: "242", text: "Same words." },
        { section: "242", text: "Same words." },
        { section: "242", text: "Same words." },
        { section: "242", text: "Other." },
        { section: "244", text: "Other." },
        { section: null, text: "Same words." },
      ],
      [first, second, other]
    );
    expect(matched.map((match) => match?.claimId ?? null)).toEqual(["a", "b", null, null, "c", null]);
  });

  it("never matches a changed paragraph to its old claim", () => {
    const matched = matchClaims([{ section: "242", text: "The room settled in 40 minutes." }], [claim({ claimText: "The room settled in 30 minutes." })]);
    expect(matched).toEqual([null]);
  });

  it("never matches a claim text the record cut short, so added text is not coloured as sourced (review round 1)", () => {
    const long = "a".repeat(4_100);
    const matched = matchClaims([{ section: "242", text: long }], [claim({ claimText: long.slice(0, 4_000) })]);
    expect(matched[0]).toBeNull();
  });
});

describe("evidenceRanges on a report document", () => {
  const S242 = "The team could not tell whether the room would settle. It was a new kind of load.";
  const S244 = "Readiness was first judged from single readings. [INFERRED: the source stresses stability] The team held each sample.";
  const S246 = "The work showed how load affects settling.";

  it("reads Lines from the Section headings and colours by claim and marker", () => {
    const doc = docOf(S242, S244, S246);
    const claims = [
      claim({ claimId: "242-1", section: "242", claimText: S242, sources: [QUOTE], state: "approved" }),
      claim({ claimId: "244-1", section: "244", claimText: S244, sources: [QUOTE] }),
      claim({ claimId: "246-1", section: "246", claimText: S246, state: "unsupported" }),
    ];
    const ranges = evidenceRanges(doc, claims);
    const text = ranges.map((range) => [doc.textBetween(range.from, range.to), range.kind, range.basis]);
    expect(text).toEqual([
      ["The team could not tell whether the room would settle.", "supported", "checked"],
      ["It was a new kind of load.", "supported", "checked"],
      ["Readiness was first judged from single readings.", "unsupported", "marker"],
      ["The team held each sample.", "supported", "linked"],
      ["The work showed how load affects settling.", "unsupported", "unsupported"],
    ]);
  });

  it("never matches a claim from another Line, and never colours the title or headings", () => {
    const doc = docOf(S242, S244, S246);
    const ranges = evidenceRanges(doc, [claim({ section: "244", claimText: S242, sources: [QUOTE] })]);
    expect(ranges.map((range) => doc.textBetween(range.from, range.to))).toEqual(["Readiness was first judged from single readings."]);
  });

  it("with no claim record, marks only the inferred sentences", () => {
    const doc = docOf(S242, S244, S246);
    expect(evidenceRanges(doc, null).map((range) => range.basis)).toEqual(["marker"]);
  });
});

describe("the evidence view plugin", () => {
  const S244 = "Readiness was first judged from single readings. [INFERRED: the source stresses stability] The team held each sample.";

  function stateOf() {
    return EditorState.create({ schema, doc: docOf("A fact.", S244, "B."), plugins: [evidenceViewPlugin()] });
  }

  function posOf(state: EditorState, text: string): number {
    let found = -1;
    state.doc.descendants((node, pos) => {
      if (found < 0 && node.isText && node.text?.includes(text)) found = pos + node.text.indexOf(text);
    });
    return found;
  }

  it("is off by default and draws nothing", () => {
    const state = stateOf();
    expect(evidenceSummary(state)).toEqual({ enabled: false, counts: { supported: 0, unsupported: 0 } });
    expect(evidenceViewKey.getState(state)?.decorations.find()).toEqual([]);
    expect(evidenceAt(state, posOf(state, "Readiness") + 2)).toBeNull();
  });

  it("turns on with a meta, counts sentences and answers at a position, without changing the document", () => {
    let state = stateOf();
    const before = state.doc;
    state = state.apply(state.tr.setMeta(evidenceViewKey, { enabled: true, claims: null }));
    expect(state.doc).toBe(before);
    expect(evidenceSummary(state)).toEqual({ enabled: true, counts: { supported: 0, unsupported: 1 } });
    const at = posOf(state, "Readiness") + 2;
    expect(evidenceAt(state, at)).toEqual({
      kind: "unsupported",
      reason: "Inferred: not stated in the sources. The AI's reason: the source stresses stability",
    });
    const [decoration] = evidenceViewKey.getState(state)!.decorations.find();
    expect((decoration as unknown as { type: { attrs: Record<string, string> } }).type.attrs).toMatchObject({
      class: "evidence-unsupported",
      "data-evidence": "unsupported",
      "data-evidence-basis": "marker",
    });
  });

  it("only maps what is drawn while typing, then a rebuild works the colours out again", () => {
    let state = stateOf();
    state = state.apply(state.tr.setMeta(evidenceViewKey, { enabled: true, claims: null }));
    const at = posOf(state, "Readiness") + 2;
    const drawn = evidenceViewKey.getState(state)!.decorations;
    state = state.apply(state.tr.insertText("x", at));
    expect(evidenceViewKey.getState(state)?.stale).toBe(true);
    // Mapped, not rebuilt: the same decorations moved through the change.
    expect(evidenceViewKey.getState(state)!.decorations.find().length).toBe(drawn.find().length);
    state = state.apply(state.tr.setMeta(evidenceViewKey, { rebuild: true }));
    expect(evidenceViewKey.getState(state)?.stale).toBe(false);
    expect(evidenceAt(state, at)?.kind).toBe("unsupported");
  });

  it("takes a claim record and turns off again", () => {
    let state = stateOf();
    const claims = [claim({ section: "242", claimText: "A fact.", sources: [QUOTE] })];
    state = state.apply(state.tr.setMeta(evidenceViewKey, { enabled: true, claims }));
    expect(evidenceSummary(state).counts).toEqual({ supported: 1, unsupported: 1 });
    expect(evidenceAt(state, posOf(state, "A fact.") + 1)?.reason).toContain("Linked to a source quote, not checked yet");
    state = state.apply(state.tr.setMeta(evidenceViewKey, { enabled: false, claims }));
    expect(evidenceSummary(state).enabled).toBe(false);
    expect(evidenceViewKey.getState(state)?.decorations.find()).toEqual([]);
  });
});
