import { describe, expect, it } from "vitest";
import {
  CONFIDENCE_WORDS,
  ELIGIBILITY_REASON_WORDS,
  INCLUSION_REASON_WORDS,
  INCLUSION_WORDS,
  changeSummary,
  entryOrigin,
  groupBrief,
  inclusionHeader,
  inclusionStatusText,
  liveCount,
  offerHref,
  offerSentence,
  sourceChipLabel,
  type BriefEntryLike,
} from "./brief";

const entry = (overrides: Partial<BriefEntryLike>): BriefEntryLike => ({
  _id: Math.random().toString(36),
  group: "storyline",
  text: "An entry",
  exactExcerpt: "excerpt",
  source: { label: "Interview transcript", kind: "transcript" },
  ...overrides,
});

describe("Brief rail helpers (story 4)", () => {
  it("label maps use the glossary words", () => {
    expect(INCLUSION_WORDS).toEqual({
      included: "included",
      condensed: "condensed",
      not_included: "not included",
    });
    expect(INCLUSION_REASON_WORDS).toEqual({
      archived: "archived",
      unreadable: "could not read",
      not_captured: "not captured",
    });
    expect(ELIGIBILITY_REASON_WORDS.outside_claim_period).toBe("outside the claim period");
    expect(ELIGIBILITY_REASON_WORDS.not_technological).toBe("not technological");
    expect(CONFIDENCE_WORDS.unresolved).toBe("unresolved");
  });

  it("inclusionHeader counts documents against the cap", () => {
    expect(inclusionHeader({ documentsInContext: 12, documentsTotal: 40, cap: 12 })).toBe(
      "12 of 40 documents in context · cap 12"
    );
  });

  it("inclusionHeader qualifies a truncated total with the bounded-count plus (DW-133)", () => {
    expect(
      inclusionHeader({ documentsInContext: 12, documentsTotal: 1000, cap: 12, documentsTruncated: true })
    ).toBe("12 of 1000+ documents in context · cap 12");
    expect(
      inclusionHeader({ documentsInContext: 12, documentsTotal: 40, cap: 12, documentsTruncated: false })
    ).toBe("12 of 40 documents in context · cap 12");
  });

  it("inclusionHeader qualifies both counts when the frozen sources were cut short (DW-133 review 2)", () => {
    // An unread frozen row may be an included document, so the numerator is
    // a lower bound too, not just the total.
    expect(
      inclusionHeader({
        documentsInContext: 12,
        documentsTotal: 40,
        cap: 12,
        documentsTruncated: true,
        sourcesTruncated: true,
      })
    ).toBe("12+ of 40+ documents in context · cap 12");
  });

  it("inclusionStatusText never words an unrecorded row and appends the reason", () => {
    expect(inclusionStatusText({ inclusion: null })).toBe("");
    expect(inclusionStatusText({ inclusion: "not_included", reason: "archived" })).toBe(
      "not included · archived"
    );
    expect(inclusionStatusText({ inclusion: "not_included", reason: "unreadable" })).toBe(
      "not included · could not read"
    );
    expect(inclusionStatusText({ inclusion: "not_included", reason: "not_captured" })).toBe(
      "not included · not captured"
    );
    expect(inclusionStatusText({ inclusion: "condensed" })).toBe("condensed");
  });

  it("groupBrief sorts entries into the rail groups and surfaces only open questions", () => {
    const open = entry({ group: "storylineQuestion", question: { questionText: "Q?" } });
    const resolved = entry({
      group: "storylineQuestion",
      question: { questionText: "Q?", resolvedBy: "keep_storyline" },
    });
    const grouped = groupBrief([
      entry({ group: "storyline" }),
      entry({ group: "claimExclusion", reason: "business_risk" }),
      entry({ group: "confidenceMap", confidence: "partial" }),
      entry({ group: "glossaryTerm" }),
      entry({ group: "glossaryTerm" }),
      open,
      resolved,
    ]);
    expect(grouped.storyline).toHaveLength(1);
    expect(grouped.claimExclusion).toHaveLength(1);
    expect(grouped.confidenceMap).toHaveLength(1);
    expect(grouped.glossaryTerm).toHaveLength(2);
    expect(grouped.openQuestions).toEqual([open]);
  });

  it("changeSummary reads 'N added · N removed' only when something changed", () => {
    expect(changeSummary([{ change: "unchanged" }, {}])).toBeNull();
    expect(
      changeSummary([{ change: "added" }, { change: "added" }, { change: "removed" }, { change: "unchanged" }])
    ).toBe("2 added · 1 removed");
    expect(changeSummary([{ change: "removed" }])).toBe("0 added · 1 removed");
    expect(liveCount([{ change: "added" }, { change: "removed" }, {}])).toBe(2);
  });

  it("entryOrigin is edited only for a writer-changed entry", () => {
    expect(entryOrigin({ edited: true })).toBe("edited");
    expect(entryOrigin({})).toBe("derived");
  });

  it("sourceChipLabel names the source and says digest for a condensed digest", () => {
    expect(sourceChipLabel(entry({}))).toBe("Interview transcript");
    expect(
      sourceChipLabel(entry({ source: { label: "Interview transcript", kind: "transcript_digest" } }))
    ).toBe("Interview transcript · digest");
    expect(
      sourceChipLabel(entry({ source: { label: "background:specs.pdf", kind: "project_document" } }))
    ).toBe("specs.pdf");
    expect(sourceChipLabel(entry({ source: null }))).toBe("source");
  });

  it("offerSentence and offerHref build the save-settings banner", () => {
    expect(offerSentence({ supplyPath: "writer_notes" })).toBe(
      "Your customized settings were found in Writer's Notes. Save to your Writer Profile?"
    );
    expect(offerSentence({ supplyPath: "attachment" })).toBe(
      "Your customized settings were found in an attachment. Save to your Writer Profile?"
    );
    expect(offerHref("/settings/writing", "gen123")).toBe("/settings/writing?fromGeneration=gen123");
  });
});
