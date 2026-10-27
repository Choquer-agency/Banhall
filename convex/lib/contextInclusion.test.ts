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

  it("reads a transcript read through its fact pack as condensed, over its digest, and gives the pack no row", () => {
    const result = assembleContextInclusion({
      sources: [
        { _id: "t1", kind: "transcript", label: "A", transcriptId: "tr1" },
        { _id: "g1", kind: "transcript_digest", label: "A", transcriptId: "tr1", contextBudget: budget(false, 0) },
        { _id: "f1", kind: "transcript_facts", label: "A", transcriptId: "tr1", inclusion: "included" },
      ],
      unfrozenDocuments: [],
      fallbackCap: 12,
    });
    expect(result.rows.map((row) => [row.kind, row.label, row.inclusion])).toEqual([
      ["transcript", "A", "condensed"],
    ]);
  });

  it("ignores a fact pack the analyzer never read (an extraction that stopped part way)", () => {
    const result = assembleContextInclusion({
      sources: [
        { _id: "t1", kind: "transcript", label: "A", transcriptId: "tr1" },
        { _id: "g1", kind: "transcript_digest", label: "A", transcriptId: "tr1", contextBudget: budget(true, 900) },
        { _id: "f1", kind: "transcript_facts", label: "A", transcriptId: "tr1" },
      ],
      unfrozenDocuments: [],
      fallbackCap: 12,
    });
    expect(result.rows.map((row) => [row.label, row.inclusion])).toEqual([["A", "condensed"]]);
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

describe("what each step read (Phase D, step 2)", () => {
  const sources = [
    { _id: "t1", kind: "transcript" as const, label: "Kickoff", transcriptId: "tr1" },
    { _id: "d1", kind: "transcript_digest" as const, label: "Kickoff digest", transcriptId: "tr1" },
    { _id: "p1", kind: "project_document" as const, label: "other:report.pdf" },
    { _id: "p2", kind: "project_document" as const, label: "other:notes.txt" },
    { _id: "s1", kind: "writer_storyline" as const, label: "Storyline" },
  ];

  it("summarises each row's uses by step, a transcript taking its digest's", () => {
    const result = assembleContextInclusion({
      sources,
      unfrozenDocuments: [],
      fallbackCap: 12,
      uses: [
        { sourceId: "d1", step: "analyzer", state: "whole" },
        { sourceId: "p1", step: "analyzer", state: "part" },
        { sourceId: "p1", step: "brief", state: "whole" },
        { sourceId: "p1", step: "seeds", run: "b1", state: "whole" },
        { sourceId: "p1", step: "seeds", run: "b2", state: "part" },
        { sourceId: "p1", step: "seeds", run: "b3", state: "left_out" },
        { sourceId: "p2", step: "facts_check", run: "line:242", state: "left_out" },
        { sourceId: "s1", step: "brief", state: "whole" },
      ],
    });
    const uses = Object.fromEntries(result.rows.map((row) => [row.key, row.uses]));
    expect(uses["source:t1"]).toEqual([{ step: "analyzer", runs: 1, read: 1, whole: true, condensed: true }]);
    expect(uses["source:p1"]).toEqual([
      { step: "analyzer", runs: 1, read: 1, whole: false },
      { step: "brief", runs: 1, read: 1, whole: true },
      { step: "seeds", runs: 3, read: 2, whole: false },
    ]);
    expect(uses["source:p2"]).toEqual([{ step: "facts_check", runs: 1, read: 0, whole: false }]);
    expect(result.usesTruncated).toBeUndefined();
  });

  it("marks a step condensed only when every run that read the transcript read its digest or fact pack (review)", () => {
    const result = assembleContextInclusion({
      sources: [
        ...sources,
        { _id: "f1", kind: "transcript_facts" as const, label: "Kickoff facts", transcriptId: "tr1" },
      ],
      unfrozenDocuments: [],
      fallbackCap: 12,
      uses: [
        // The analyzer read the transcript itself and its digest: itself wins.
        { sourceId: "t1", step: "analyzer", state: "whole" },
        { sourceId: "d1", step: "analyzer", state: "whole" },
        // One Seed step read the fact pack, another the transcript in part.
        { sourceId: "f1", step: "seeds", run: "r1", state: "whole" },
        { sourceId: "t1", step: "seeds", run: "r2", state: "part" },
        // The Brief read only the digest.
        { sourceId: "d1", step: "brief", state: "whole" },
      ],
    });
    const uses = result.rows.find((row) => row.key === "source:t1")?.uses;
    expect(uses).toEqual([
      { step: "analyzer", runs: 1, read: 1, whole: true },
      { step: "brief", runs: 1, read: 1, whole: true, condensed: true },
      { step: "seeds", runs: 2, read: 2, whole: false },
    ]);
  });

  it("gives a row no uses when no step recorded one, and says when the uses were cut short", () => {
    const result = assembleContextInclusion({ sources, unfrozenDocuments: [], fallbackCap: 12, uses: [], usesTruncated: true });
    expect(result.rows.every((row) => row.uses === undefined)).toBe(true);
    expect(result.usesTruncated).toBe(true);
  });
});
