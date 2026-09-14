import { describe, expect, it } from "vitest";
import {
  assembleContextInclusion,
  type InclusionSourceRow,
} from "./contextInclusion";

const budget = (included: boolean, includedLength: number, truncated = false, maxDocuments?: number) => ({
  included,
  includedLength,
  truncated,
  ...(maxDocuments !== undefined ? { maxDocuments } : {}),
});

describe("assembleContextInclusion (story 4, CAP-11)", () => {
  it("lists transcripts first, reads a digest-read transcript as condensed and skips digest/storyline rows", () => {
    const sources: InclusionSourceRow[] = [
      { _id: "d1", kind: "project_document", label: "other:first.pdf", inclusion: "included" },
      { _id: "t1", kind: "transcript", label: "Interview 1", transcriptId: "tr1" },
      { _id: "t2", kind: "transcript", label: "Interview 2", transcriptId: "tr2", inclusion: "included" },
      { _id: "g1", kind: "transcript_digest", label: "Interview 1", transcriptId: "tr1", inclusion: "included" },
      { _id: "s1", kind: "writer_storyline", label: "Writer-supplied Storyline" },
    ];
    const result = assembleContextInclusion({ sources, unfrozenDocuments: [], fallbackCap: 12 });
    expect(result.rows.map((row) => [row.kind, row.label, row.inclusion])).toEqual([
      ["transcript", "Interview 1", "condensed"],
      ["transcript", "Interview 2", "included"],
      ["document", "first.pdf", "included"],
    ]);
  });

  it("reads an excluded digest as not included and an unrecorded digest as no status", () => {
    const result = assembleContextInclusion({
      sources: [
        { _id: "t1", kind: "transcript", label: "A", transcriptId: "tr1" },
        { _id: "g1", kind: "transcript_digest", label: "A", transcriptId: "tr1", contextBudget: budget(false, 0) },
        { _id: "t2", kind: "transcript", label: "B", transcriptId: "tr2" },
        { _id: "g2", kind: "transcript_digest", label: "B", transcriptId: "tr2" },
      ],
      unfrozenDocuments: [],
      fallbackCap: 12,
    });
    expect(result.rows.map((row) => row.inclusion)).toEqual(["not_included", null]);
  });

  it("lists archived and unreadable documents as not included with their reason", () => {
    const result = assembleContextInclusion({
      sources: [{ _id: "d1", kind: "project_document", label: "background:kept.docx", inclusion: "included" }],
      unfrozenDocuments: [
        { _id: "p1", fileName: "old.pdf", reason: "archived" },
        { _id: "p2", fileName: "scan.pdf", reason: "unreadable" },
      ],
      fallbackCap: 12,
    });
    expect(result.rows).toEqual([
      { key: "source:d1", kind: "document", label: "kept.docx", inclusion: "included" },
      { key: "document:p1", kind: "document", label: "old.pdf", inclusion: "not_included", reason: "archived" },
      { key: "document:p2", kind: "document", label: "scan.pdf", inclusion: "not_included", reason: "unreadable" },
    ]);
    expect(result.documentsInContext).toBe(1);
    expect(result.documentsTotal).toBe(3);
  });

  it("reports recorded only when a frozen row carries a budget outcome", () => {
    const legacy = assembleContextInclusion({
      sources: [{ _id: "d1", kind: "project_document", label: "other:legacy.txt" }],
      // A synthesized row for an unfrozen document never makes a Brief
      // available on its own: this generation still recorded nothing.
      unfrozenDocuments: [{ _id: "p1", fileName: "old.pdf", reason: "archived" }],
      fallbackCap: 12,
    });
    expect(legacy.recorded).toBe(false);
    expect(legacy.rows.some((row) => row.inclusion !== null)).toBe(true);

    expect(
      assembleContextInclusion({
        sources: [{ _id: "d1", kind: "project_document", label: "other:a.txt", inclusion: "not_included" }],
        unfrozenDocuments: [],
        fallbackCap: 12,
      }).recorded
    ).toBe(true);
    expect(
      assembleContextInclusion({
        sources: [{ _id: "t1", kind: "transcript", label: "T", contextBudget: budget(true, 5) }],
        unfrozenDocuments: [],
        fallbackCap: 12,
      }).recorded
    ).toBe(true);
  });

  it("lists a readable document the reservation never captured", () => {
    const result = assembleContextInclusion({
      sources: [{ _id: "d1", kind: "project_document", label: "other:frozen.txt", inclusion: "included" }],
      unfrozenDocuments: [{ _id: "p51", fileName: "fifty-first.txt", reason: "not_captured" }],
      fallbackCap: 12,
    });
    expect(result.rows[1]).toEqual({
      key: "document:p51",
      kind: "document",
      label: "fifty-first.txt",
      inclusion: "not_included",
      reason: "not_captured",
    });
    expect(result.documentsTotal).toBe(2);
    expect(result.documentsInContext).toBe(1);
  });

  it("gives a legacy row (no inclusion, no budget) a null status, never included", () => {
    const result = assembleContextInclusion({
      sources: [
        { _id: "t1", kind: "transcript", label: "Interview" },
        { _id: "d1", kind: "project_document", label: "other:legacy.txt" },
      ],
      unfrozenDocuments: [],
      fallbackCap: 12,
    });
    expect(result.rows.map((row) => row.inclusion)).toEqual([null, null]);
    expect(result.documentsInContext).toBe(0);
    expect(result.documentsTotal).toBe(1);
  });

  it("derives a status from a recorded budget when the inclusion field is absent", () => {
    const result = assembleContextInclusion({
      sources: [
        { _id: "d1", kind: "project_document", label: "other:a.txt", contextBudget: budget(true, 10) },
        { _id: "d2", kind: "project_document", label: "other:b.txt", contextBudget: budget(true, 5, true) },
        { _id: "d3", kind: "project_document", label: "other:c.txt", contextBudget: budget(true, 0) },
      ],
      unfrozenDocuments: [],
      fallbackCap: 12,
    });
    expect(result.rows.map((row) => row.inclusion)).toEqual(["included", "condensed", "not_included"]);
    expect(result.documentsInContext).toBe(2);
  });

  it("takes the largest recorded cap, or the fallback when none is recorded", () => {
    const recorded = assembleContextInclusion({
      sources: [
        { _id: "d1", kind: "project_document", label: "other:a", contextBudget: budget(true, 1, false, 8) },
        { _id: "d2", kind: "project_document", label: "other:b", contextBudget: budget(false, 0, false, 10) },
      ],
      unfrozenDocuments: [],
      fallbackCap: 12,
    });
    expect(recorded.cap).toBe(10);
    const fallback = assembleContextInclusion({
      sources: [{ _id: "d1", kind: "project_document", label: "other:a", contextBudget: budget(true, 1) }],
      unfrozenDocuments: [],
      fallbackCap: 7,
    });
    expect(fallback.cap).toBe(7);
  });

  it("excludes transcripts from both counts", () => {
    const result = assembleContextInclusion({
      sources: [
        { _id: "t1", kind: "transcript", label: "T1", inclusion: "included" },
        { _id: "t2", kind: "transcript", label: "T2", inclusion: "condensed" },
        { _id: "d1", kind: "project_document", label: "other:a", inclusion: "included" },
        { _id: "d2", kind: "project_document", label: "other:b", inclusion: "not_included" },
      ],
      unfrozenDocuments: [],
      fallbackCap: 12,
    });
    expect(result.documentsInContext).toBe(1);
    expect(result.documentsTotal).toBe(2);
    expect(result.rows).toHaveLength(4);
  });

  it("carries the truncation flags through, defaulting to a complete listing (DW-133)", () => {
    const sources = [{ _id: "d1", kind: "project_document" as const, label: "other:a", inclusion: "included" as const }];
    expect(assembleContextInclusion({ sources, unfrozenDocuments: [], fallbackCap: 12 })).toMatchObject({
      documentsTruncated: false,
      sourcesTruncated: false,
    });
    expect(
      assembleContextInclusion({ sources, unfrozenDocuments: [], fallbackCap: 12, documentsTruncated: true })
    ).toMatchObject({ documentsTruncated: true, sourcesTruncated: false });
    // A cut-short source read implies a cut-short document listing.
    expect(
      assembleContextInclusion({ sources, unfrozenDocuments: [], fallbackCap: 12, sourcesTruncated: true })
    ).toMatchObject({ documentsTruncated: true, sourcesTruncated: true });
  });
});
