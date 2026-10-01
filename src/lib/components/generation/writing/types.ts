/**
 * Local mirror of `api.generations.getSeedDraftProgress` (build brief, fixed
 * API contract with be-generation). Kept structural so the writing view can be
 * rendered and tested without the Convex query.
 */
export type SeedDraftPhase = "drafting" | "stopping" | "completed" | "stopped" | "failed";

export type SeedDraftSectionStatus = "queued" | "writing" | "done" | "not_drafted";

export interface SeedDraftSection {
  /** e.g. "242" */
  key: string;
  /** "242" */
  number: string;
  /** "Technological uncertainty" */
  title: string;
  /** The serif question heading. */
  question: string;
  orderIndex: number;
  status: SeedDraftSectionStatus;
  /** Only for done (drafted AND checked) sections. */
  paragraphs: string[];
  startedAt: number | null;
  completedAt: number | null;
}

export interface SeedDraftProgress {
  phase: SeedDraftPhase;
  /** 0-100, never decreases. */
  percent: number;
  estimatedRemainingMs: number | null;
  /** Section being written. */
  currentSectionKey: string | null;
  stoppedAfterSectionKey: string | null;
  sections: SeedDraftSection[];
}

/** Grey is the shipped style; Aurora is kept behind a test flag (board 4.2). */
export type SkeletonStyle = "grey" | "aurora";
