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
 * - A transcript read through its `transcript_facts` row (transcript method,
 *   2026-09-24) takes the fact pack's outcome the same way; a pack with a
 *   recorded outcome wins over a digest of the same transcript, and one
 *   without (frozen by an extraction that stopped part way) is ignored.
 * - `writer_storyline`, `transcript_digest` and `transcript_facts` rows never
 *   get a row of their own.
 * - An unrecorded status is `null` (no status word), never `included`.
 * - Every attached document gets a row: one the reservation never froze is
 *   `not_included` with the reason it was skipped (CAP-17).
 * - Counts are Supporting Documents only: the cap (`maxDocuments`) applies to
 *   documents, so transcripts are excluded from both counts.
 * - Company files the draft used (Phase C, 2026-10-26) get rows of their own,
 *   after the documents (`kind: "company"`), counted with the documents;
 *   a viewer who may not read company files gets none of them.
 */

import { sourceInclusion, type SourceInclusion } from "../ai/trustedContext";
import { parseSourceLabel } from "./settingsDocument";

export type Inclusion = SourceInclusion;
export type InclusionReason = "archived" | "unreadable" | "not_captured";

export type InclusionSourceRow = {
  _id: string;
  kind:
    | "transcript"
    | "project_document"
    | "transcript_digest"
    | "writer_storyline"
    | "transcript_facts"
    | "company_file";
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

/** Phase D (step 2): one recorded use of a frozen row by a step run (`generationSourceUse`). */
export type SourceUseRow = {
  sourceId: string;
  step: SourceUseStep;
  run?: string;
  state: "whole" | "part" | "left_out";
};

export type SourceUseStep = "analyzer" | "brief" | "seeds" | "facts_check";

/** How one step read one row: its runs, how many read some of it, and whether every reading run read it whole. */
export type RowUse = { step: SourceUseStep; runs: number; read: number; whole: boolean };

export type ContextInclusionRow = {
  key: string;
  kind: "transcript" | "document" | "company";
  label: string;
  inclusion: Inclusion | null;
  reason?: InclusionReason;
  /** Phase D (step 2): each step that recorded a use of this row, in step order. */
  uses?: RowUse[];
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
  /**
   * DW-133 review: true when the frozen `generationSources` read itself hit
   * the transaction budget, so `rows` is a prefix of the frozen set. The
   * document walk is skipped in that case (an unread frozen row cannot be
   * told apart from an unfrozen document), so `documentsTruncated` is true too.
   */
  sourcesTruncated: boolean;
  /** Phase D (step 2): true when the recorded uses could not all be read. */
  usesTruncated?: boolean;
  rows: ContextInclusionRow[];
};

const USE_STEP_ORDER: readonly SourceUseStep[] = ["analyzer", "brief", "seeds", "facts_check"];

/**
 * Each row key's uses, by step: a transcript read through its digest or
 * fact pack takes those rows' uses, as it takes their outcome.
 */
function usesByKey(sources: InclusionSourceRow[], uses: readonly SourceUseRow[]): Map<string, RowUse[]> {
  const transcriptRowOf = new Map<string, string>();
  for (const row of sources) {
    if (row.kind === "transcript" && row.transcriptId && !transcriptRowOf.has(row.transcriptId)) transcriptRowOf.set(row.transcriptId, row._id);
  }
  const keyOf = new Map<string, string>();
  for (const row of sources) {
    if (row.kind === "transcript_digest" || row.kind === "transcript_facts") {
      const transcriptRow = row.transcriptId ? transcriptRowOf.get(row.transcriptId) : undefined;
      if (transcriptRow) keyOf.set(row._id, `source:${transcriptRow}`);
    } else if (row.kind !== "writer_storyline") {
      keyOf.set(row._id, `source:${row._id}`);
    }
  }
  const runs = new Map<string, Map<SourceUseStep, Map<string, "whole" | "part" | "left_out">>>();
  for (const use of uses) {
    const key = keyOf.get(use.sourceId);
    if (!key) continue;
    const bySteps = runs.get(key) ?? new Map<SourceUseStep, Map<string, "whole" | "part" | "left_out">>();
    runs.set(key, bySteps);
    const byRun = bySteps.get(use.step) ?? new Map<string, "whole" | "part" | "left_out">();
    bySteps.set(use.step, byRun);
    // A run that read the row twice (a transcript and its digest) counts its best read.
    const run = use.run ?? "";
    const rank = { left_out: 0, part: 1, whole: 2 } as const;
    const before = byRun.get(run);
    if (!before || rank[use.state] > rank[before]) byRun.set(run, use.state);
  }
  const result = new Map<string, RowUse[]>();
  for (const [key, bySteps] of runs) {
    result.set(
      key,
      USE_STEP_ORDER.flatMap((step) => {
        const byRun = bySteps.get(step);
        if (!byRun) return [];
        const states = [...byRun.values()];
        const read = states.filter((state) => state !== "left_out").length;
        return [{ step, runs: states.length, read, whole: read > 0 && states.every((state) => state !== "part") }];
      })
    );
  }
  return result;
}

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
  /** Whether the frozen-source read behind `sources` was cut short. */
  sourcesTruncated?: boolean;
  /** False for a viewer who may not read company files (companyFiles.read). */
  showCompanyFiles?: boolean;
  /** Phase D (step 2): the draft's recorded uses, and whether all were read. */
  uses?: readonly SourceUseRow[];
  usesTruncated?: boolean;
}): ContextInclusion {
  const rowUses = usesByKey(input.sources, input.uses ?? []);
  const withUses = (row: ContextInclusionRow): ContextInclusionRow => {
    const found = rowUses.get(row.key);
    return found && found.length > 0 ? { ...row, uses: found } : row;
  };
  const digestByTranscript = new Map<string, InclusionSourceRow>();
  for (const row of input.sources) {
    if (row.kind === "transcript_digest" && row.transcriptId && !digestByTranscript.has(row.transcriptId)) {
      digestByTranscript.set(row.transcriptId, row);
    }
  }
  // A fact pack replaces the digest as the transcript's reading, but only a
  // pack the analyzer actually read (one with a recorded outcome): a pack a
  // partial extraction froze is not how the generation read its transcript.
  for (const row of input.sources) {
    if (row.kind === "transcript_facts" && row.transcriptId && recordedInclusion(row) !== null) {
      digestByTranscript.set(row.transcriptId, row);
    }
  }

  const transcriptRows: ContextInclusionRow[] = [];
  const documentRows: ContextInclusionRow[] = [];
  const companyRows: ContextInclusionRow[] = [];
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
    } else if (row.kind === "company_file" && input.showCompanyFiles !== false) {
      companyRows.push({
        key: `source:${row._id}`,
        kind: "company",
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
    documentsInContext: [...documentRows, ...companyRows].filter(
      (row) => row.inclusion === "included" || row.inclusion === "condensed"
    ).length,
    documentsTotal: documentRows.length + companyRows.length,
    documentsTruncated: (input.documentsTruncated ?? false) || (input.sourcesTruncated ?? false),
    sourcesTruncated: input.sourcesTruncated ?? false,
    ...(input.usesTruncated ? { usesTruncated: true } : {}),
    rows: [...transcriptRows, ...documentRows, ...companyRows].map(withUses),
  };
}
