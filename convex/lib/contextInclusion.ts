/**
 * Story 4 (CAP-11, AD-30): the Brief's Inputs band, assembled from the frozen
 * `generationSources` rows of one generation plus the project documents the
 * reservation skipped. Pure — no DB access — so the one read
 * (`generations.getContextInclusion`) and its tests share one decision.
 *
 * - Transcript rows come first, in reservation order; document rows follow.
 * - A transcript read through its `transcript_digest` row takes the digest's
 *   outcome: an included digest reads `condensed`, an excluded one
 *   `not_included`.
 * - `writer_storyline` and `transcript_digest` rows never get a row of their
 *   own.
 * - An unrecorded status is `null` (no status word), never `included`.
 * - Every attached document gets a row: one the reservation never froze is
 *   `not_included` with the reason it was skipped (CAP-17).
 * - Counts are Supporting Documents only: the cap (`maxDocuments`) applies to
 *   documents, so transcripts are excluded from both counts.
 */

import { sourceInclusion, type SourceInclusion } from "../ai/trustedContext";
import { parseSourceLabel } from "./settingsDocument";

export type Inclusion = SourceInclusion;
export type InclusionReason = "archived" | "unreadable" | "not_captured";

export type InclusionSourceRow = {
  _id: string;
  kind: "transcript" | "project_document" | "transcript_digest" | "writer_storyline";
  label: string;
  transcriptId?: string;
  inclusion?: Inclusion;
  contextBudget?: {
    included: boolean;
    includedLength: number;
    truncated: boolean;
    maxDocuments?: number;
  };
};

export type UnfrozenDocument = {
  _id: string;
  fileName: string;
  reason: InclusionReason;
};

export type ContextInclusionRow = {
  key: string;
  kind: "transcript" | "document";
  label: string;
  inclusion: Inclusion | null;
  reason?: InclusionReason;
};

export type ContextInclusion = {
  /**
   * Whether THIS generation recorded a budget outcome on any frozen row. A
   * legacy (pre-feature) generation records none, so the Brief view and its
   * launcher are absent rather than empty — a synthesized row for an
   * unfrozen document never makes a Brief available on its own.
   */
  recorded: boolean;
  cap: number;
  documentsInContext: number;
  documentsTotal: number;
  /**
   * DW-133: true when the project-document read stopped at its row or byte
   * budget, so `documentsTotal` and the not-captured rows are a lower bound
   * rather than the whole attachment list. Never silently undercounts.
   */
  documentsTruncated: boolean;
  rows: ContextInclusionRow[];
};

/** The recorded status of one row; `null` when nothing was recorded. */
export function recordedInclusion(row: InclusionSourceRow): Inclusion | null {
  return row.inclusion ?? (row.contextBudget ? sourceInclusion(row.contextBudget) : null);
}

export function assembleContextInclusion(input: {
  sources: InclusionSourceRow[];
  unfrozenDocuments: UnfrozenDocument[];
  fallbackCap: number;
  /** Whether the project-document read behind `unfrozenDocuments` was cut short. */
  documentsTruncated?: boolean;
}): ContextInclusion {
  const digestByTranscript = new Map<string, InclusionSourceRow>();
  for (const row of input.sources) {
    if (row.kind === "transcript_digest" && row.transcriptId) {
      digestByTranscript.set(row.transcriptId, row);
    }
  }

  const transcriptRows: ContextInclusionRow[] = [];
  const documentRows: ContextInclusionRow[] = [];
  let recordedCap: number | null = null;

  for (const row of input.sources) {
    const cap = row.contextBudget?.maxDocuments;
    if (cap !== undefined && (recordedCap === null || cap > recordedCap)) {
      recordedCap = cap;
    }
    if (row.kind === "transcript") {
      const digest = row.transcriptId ? digestByTranscript.get(row.transcriptId) : undefined;
      let inclusion: Inclusion | null;
      if (digest) {
        const digestOutcome = recordedInclusion(digest);
        inclusion =
          digestOutcome === null
            ? null
            : digestOutcome === "not_included"
              ? "not_included"
              : "condensed";
      } else {
        inclusion = recordedInclusion(row);
      }
      transcriptRows.push({
        key: `source:${row._id}`,
        kind: "transcript",
        label: row.label,
        inclusion,
      });
    } else if (row.kind === "project_document") {
      documentRows.push({
        key: `source:${row._id}`,
        kind: "document",
        label: parseSourceLabel(row.label).fileName,
        inclusion: recordedInclusion(row),
      });
    }
  }

  for (const document of input.unfrozenDocuments) {
    documentRows.push({
      key: `document:${document._id}`,
      kind: "document",
      label: document.fileName,
      inclusion: "not_included",
      reason: document.reason,
    });
  }

  return {
    recorded: input.sources.some((row) => recordedInclusion(row) !== null),
    cap: recordedCap ?? input.fallbackCap,
    documentsInContext: documentRows.filter(
      (row) => row.inclusion === "included" || row.inclusion === "condensed"
    ).length,
    documentsTotal: documentRows.length,
    documentsTruncated: input.documentsTruncated ?? false,
    rows: [...transcriptRows, ...documentRows],
  };
}
