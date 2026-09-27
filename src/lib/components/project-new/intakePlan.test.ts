import { describe, expect, it } from "vitest";
import { plannedIntakeSources, noteSourceKey, DOCUMENT_POSITION_BASE } from "./intakePlan";
import type { SupportingDoc } from "./supportingDocs.svelte";

/**
 * Decision 65, stage 2: the intake draft holds exactly what a confirmed
 * project stores, in the order its preparation reads it.
 */
function doc(id: string, patch: Partial<SupportingDoc>): SupportingDoc {
  return {
    id,
    name: `${id}.txt`,
    file: new File(["x"], `${id}.txt`, { type: "text/plain" }),
    pastedText: null,
    category: "other",
    categoryTouched: true,
    year: 2025,
    status: "ready",
    progress: null,
    startedAt: 0,
    finishedAt: 1,
    parsed: { fileName: `${id}.txt`, fileType: "txt", content: `Text of ${id}.` },
    transcript: null,
    error: null,
    sections: [],
    words: 3,
    ...patch,
  } as SupportingDoc;
}

const keyFor = (id: string) => `key-${id}-000000`;

describe("plannedIntakeSources", () => {
  it("lists transcripts first, then documents in SR&ED weight order, skipping files still being read", () => {
    const sources = plannedIntakeSources({
      transcripts: [
        { id: "t-0", label: "Morning call", content: "Interviewer: Hi.", format: "txt" },
        { id: "t-1", label: "Pasted transcript 1", content: "Engineer: The seal." },
      ],
      docs: [
        doc("other", { category: "other" }),
        doc("scoping", { category: "scoping_notes" }),
        doc("reading", { category: "background", status: "reading", parsed: null }),
      ],
      yearNotes: new Map(),
      previousYears: [],
      keyFor,
    });
    expect(sources.map((source) => [source.kind, source.sourceKey, source.position])).toEqual([
      ["transcript", "key-t-0-000000", 0],
      ["transcript", "key-t-1-000000", 1],
      ["document", "key-scoping-000000", DOCUMENT_POSITION_BASE],
      ["document", "key-other-000000", DOCUMENT_POSITION_BASE + 1],
    ]);
    expect(sources[0]).toMatchObject({ label: "Morning call", content: "Interviewer: Hi.", sourceFormat: "txt" });
    expect(sources[2]).toMatchObject({ label: "scoping.txt", content: "Text of scoping.", intake: "file", extractionOutcome: "ok", fileType: "txt" });
  });

  it("files a previous-year report under its header and note; a note no report carried is its own file", () => {
    const notes = new Map([
      [2024, "Same rig as last year."],
      [2023, "Rig was retired."],
    ]);
    const sources = plannedIntakeSources({
      transcripts: [],
      docs: [
        doc("py", { category: "previous_pd", year: 2024 }),
        doc("empty", { category: "previous_pd", year: 2023, parsed: { fileName: "empty.pdf", fileType: "pdf", content: "  " } } as Partial<SupportingDoc>),
      ],
      yearNotes: notes,
      previousYears: [2024, 2023],
      keyFor,
    });
    expect(sources.map((source) => source.sourceKey)).toEqual([
      "key-py-000000",
      "key-empty-000000",
      noteSourceKey(2023),
    ]);
    expect(sources[0].content.startsWith("[Previous-year report")).toBe(true);
    expect(sources[0].content).toContain("Note: Same rig as last year.\n\nText of py.");
    // An empty file stays empty and carries no note.
    expect(sources[1].content).toBe("");
    expect(sources[2]).toMatchObject({
      label: "Previous-year note (FY 2023)",
      category: "previous_pd",
      intake: "pasted",
      content: "[Previous-year note \u2014 fiscal 2023]\n\nRig was retired.",
    });
  });

  it("keeps a failed read as a file with no text, so its receipt stays in view", () => {
    const [source] = plannedIntakeSources({
      transcripts: [],
      docs: [doc("broken", { status: "failed", parsed: null })],
      yearNotes: new Map(),
      previousYears: [],
      keyFor,
    });
    expect(source).toMatchObject({ content: "", extractionOutcome: "failed", intake: "file" });
  });
});
