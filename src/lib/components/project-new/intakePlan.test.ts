import { describe, expect, it } from "vitest";
import {
  plannedIntakeSources,
  noteSourceKey,
  DOCUMENT_POSITION_BASE,
  previousYearPrefix,
  restoredIntake,
  splitPreviousYearText,
} from "./intakePlan";
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

describe("restoredIntake (2026-09-27, fourth: a reload brings the draft back)", () => {
  it("round trips: the page's plan of what came back is exactly what the draft holds, so nothing is saved again", () => {
    const notes = new Map([[2024, "Claim was cut by 20%"]]);
    const original = plannedIntakeSources({
      transcripts: [
        { id: "t-0", label: "Morning call", content: "Interviewer: Hi.\nEngineer: The seal.", format: "txt" },
        { id: "t-1", label: "Pasted transcript 1", content: "Engineer: The rig." },
      ],
      docs: [
        doc("report", { category: "previous_pd", year: 2024, parsed: { fileName: "report.pdf", fileType: "pdf", content: "Last year's 242." } }),
        doc("notes", { category: "writer_notes", file: null, pastedText: "Ignore the budget talk.", name: "Writer's notes (pasted)", parsed: null }),
        doc("failed", { category: "background", status: "failed", parsed: null }),
      ],
      yearNotes: notes,
      previousYears: [2024],
      keyFor,
    });
    const texts = new Map(original.map((source) => [source.sourceKey, source.content]));
    const back = restoredIntake(
      original.map((source) => ({
        sourceKey: source.sourceKey,
        kind: source.kind,
        position: source.position,
        label: source.label,
        ...(source.sourceFormat ? { sourceFormat: source.sourceFormat } : {}),
        ...(source.fileType ? { fileType: source.fileType } : {}),
        ...(source.category ? { category: source.category } : {}),
        ...(source.intake ? { intake: source.intake } : {}),
        ...(source.extractionOutcome ? { extractionOutcome: source.extractionOutcome } : {}),
        hasOriginal: true,
      })),
      texts
    );
    expect(back.transcripts.map((item) => [item.label, item.pasted])).toEqual([
      ["Morning call", false],
      ["Pasted transcript 1", true],
    ]);
    expect(back.yearNotes).toEqual(new Map([[2024, "Claim was cut by 20%"]]));
    const report = back.documents.find((item) => item.category === "previous_pd")!;
    expect(report).toMatchObject({ year: 2024, body: "Last year's 242.", pastedText: null, fileType: "pdf" });
    expect(back.documents.find((item) => item.category === "writer_notes")).toMatchObject({ pastedText: "Ignore the budget talk." });
    expect(back.documents.find((item) => item.category === "background")).toMatchObject({ failed: true, body: "" });

    // The page rebuilds its plan from what came back: identical to the draft's.
    const keys = new Map<string, string>();
    const replanned = plannedIntakeSources({
      transcripts: back.transcripts.map((item, index) => {
        keys.set(`rt-${index}`, item.sourceKey);
        return { id: `rt-${index}`, label: item.label, content: item.content, format: item.format };
      }),
      docs: back.documents.map((item, index) => {
        keys.set(`rd-${index}`, item.sourceKey);
        return doc(`rd-${index}`, {
          name: item.name,
          file: null,
          pastedText: item.pastedText,
          category: item.category,
          year: item.year ?? 2025,
          status: item.failed ? "failed" : "ready",
          parsed: item.pastedText === null && !item.failed ? { fileName: item.name, fileType: "pdf", content: item.body } : null,
          restored: item.pastedText === null ? { fileType: item.fileType } : null,
        });
      }),
      yearNotes: back.yearNotes,
      previousYears: [2024],
      keyFor: (id) => keys.get(id)!,
    });
    // Equal as the sync compares them (no File either way).
    const bare = (list: typeof replanned) => list.map(({ file, ...rest }) => ({ ...rest, file: file ?? null }));
    expect(bare(replanned)).toEqual(bare(back.saved));
    expect(back.saved.map(({ file, ...rest }) => rest)).toEqual(original.map(({ file, ...rest }) => rest));
  });

  it("a note no report carried comes back as that year's note; a source whose text could not be read is left out", () => {
    const back = restoredIntake(
      [
        { sourceKey: noteSourceKey(2023), kind: "document", position: 1000, label: "Previous-year note (FY 2023)", category: "previous_pd", fileType: "txt", intake: "pasted", hasOriginal: false },
        { sourceKey: "key-missing-000000", kind: "transcript", position: 0, label: "Gone", hasOriginal: false },
      ],
      new Map([[noteSourceKey(2023), "[Previous-year note \u2014 fiscal 2023]\n\nThe rig moved."]])
    );
    expect(back.yearNotes).toEqual(new Map([[2023, "The rig moved."]]));
    expect(back.documents).toEqual([]);
    expect(back.transcripts).toEqual([]);
    expect(back.saved.map((source) => source.sourceKey)).toEqual([noteSourceKey(2023)]);
  });

  it("splits a previous-year header back into its year and note", () => {
    expect(splitPreviousYearText(`${previousYearPrefix(2022, "Cut by half")}Body text.`)).toEqual({
      year: 2022, note: "Cut by half", body: "Body text.",
    });
    expect(splitPreviousYearText(`${previousYearPrefix(2022, "")}Body text.`)).toEqual({ year: 2022, note: "", body: "Body text." });
    expect(splitPreviousYearText("No header here.")).toBeNull();
  });
});
