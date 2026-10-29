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
 * - Company files the draft could read but that did not fit in the frozen
 *   total (2026-10-28, third) follow them as `not_included`, not captured.
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
  /** How much was sent of how much (step 1), and how many parts, when recorded. */
  sent?: number;
  total?: number;
  parts?: number;
};

export type SourceUseStep = "analyzer" | "brief" | "seeds" | "facts_check";

/**
 * How one step read one row: its runs, how many read some of it, whether
 * every reading run read it whole, and whether every reading run read a
 * transcript only through its digest or fact pack (review). Phase D, step 1:
 * when every reading run read the row itself in part, the largest share of
 * it one run read (0 to 1), and that run's parts when they were recorded.
 */
export type RowUse = {
  step: SourceUseStep;
  runs: number;
  read: number;
  whole: boolean;
  condensed?: true;
  share?: number;
  parts?: number;
};

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
  const keyOf = new Map<string, { key: string; condensed: boolean }>();
  for (const row of sources) {
    if (row.kind === "transcript_digest" || row.kind === "transcript_facts") {
      const transcriptRow = row.transcriptId ? transcriptRowOf.get(row.transcriptId) : undefined;
      if (transcriptRow) keyOf.set(row._id, { key: `source:${transcriptRow}`, condensed: true });
    } else if (row.kind !== "writer_storyline") {
      keyOf.set(row._id, { key: `source:${row._id}`, condensed: false });
    }
  }
  type RunRead = { state: "whole" | "part" | "left_out"; condensed: boolean; share?: number; parts?: number };
  const rank = { left_out: 0, part: 1, whole: 2 } as const;
  const runs = new Map<string, Map<SourceUseStep, Map<string, RunRead>>>();
  for (const use of uses) {
    const target = keyOf.get(use.sourceId);
    if (!target) continue;
    const bySteps = runs.get(target.key) ?? new Map<SourceUseStep, Map<string, RunRead>>();
    runs.set(target.key, bySteps);
    const byRun = bySteps.get(use.step) ?? new Map<string, RunRead>();
    bySteps.set(use.step, byRun);
    // A run that read the row twice (a transcript and its digest) counts its
    // best read; at the same depth, reading the transcript itself wins.
    const run = use.run ?? "";
    const before = byRun.get(run);
    const share = use.state === "part" && use.sent !== undefined && use.total ? use.sent / use.total : undefined;
    const better =
      !before ||
      rank[use.state] > rank[before.state] ||
      (rank[use.state] === rank[before.state] && before.condensed && !target.condensed) ||
      // A run that read the row in part more than once (Phase D, step 1)
      // counts its widest read.
      (rank[use.state] === rank[before.state] && before.condensed === target.condensed && (share ?? 0) > (before.share ?? 0));
    if (better) {
      byRun.set(run, {
        state: use.state,
        condensed: target.condensed,
        ...(share !== undefined ? { share } : {}),
        ...(share !== undefined && use.parts ? { parts: use.parts } : {}),
      });
    }
  }
  const result = new Map<string, RowUse[]>();
  for (const [key, bySteps] of runs) {
    result.set(
      key,
      USE_STEP_ORDER.flatMap((step) => {
        const byRun = bySteps.get(step);
        if (!byRun) return [];
        const reads = [...byRun.values()];
        const reading = reads.filter((entry) => entry.state !== "left_out");
        const read = reading.length;
        const condensed = read > 0 && reading.every((entry) => entry.condensed);
        // How much: only when every reading run read the row itself in part
        // and said how much, from the widest one.
        const measured = reading.every((entry) => entry.state === "part" && !entry.condensed && entry.share !== undefined);
        const widest = read > 0 && measured
          ? reading.reduce((best, entry) => (entry.share! > best.share! ? entry : best))
          : undefined;
        return [
          {
            step,
            runs: reads.length,
            read,
            whole: read > 0 && reading.every((entry) => entry.state === "whole"),
            ...(condensed ? { condensed: true as const } : {}),
            ...(widest ? { share: widest.share! } : {}),
            ...(widest?.parts ? { parts: widest.parts } : {}),
          },
        ];
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
  /** 2026-10-28 (third): company files the draft could read but did not fit. */
  unfrozenCompanyFiles?: UnfrozenDocument[];
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
  if (input.showCompanyFiles !== false) {
    for (const file of input.unfrozenCompanyFiles ?? []) {
      companyRows.push({
        key: `company:${file._id}`,
        kind: "company",
        label: file.fileName,
        inclusion: "not_included",
        reason: file.reason,
      });
    }
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
