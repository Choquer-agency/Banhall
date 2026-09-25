/**
 * The generation state machine, declared once (docs/product-domain.md,
 * amendment 2026-09-25 "Generation transition table").
 *
 * Three machines live on one `generations` row:
 *
 * 1. `status`, the technical lifecycle. Which moves are legal depends on the
 *    generation's flow: compare, single, section approval, or the two seed
 *    sub-states (the seed stage before Summary sign-off, and drafting after
 *    it). Every status write goes through `transitionGeneration`
 *    (convex/lib/generationTransitions.ts), which refuses any move this table
 *    does not list with `INVALID_TRANSITION`.
 * 2. `postQaStatus`, the background QA pass over a finished report.
 * 3. `redraft.status`, "Draft the rest" on a stopped Step-by-step draft.
 *
 * The table is data, not code paths: `sites` names every call site that makes
 * the move, so a new code path that needs a new move has to add it here (and
 * to the amendment) first.
 */

export const GENERATION_STATUSES = [
  "reserved",
  "running",
  "awaiting_selection",
  "awaiting_input",
  "completed",
  "failed",
  "superseded",
] as const;

export type GenerationStatus = (typeof GENERATION_STATUSES)[number];

/** Statuses that keep the project fenced on the generation. */
export const ACTIVE_GENERATION_STATUSES = [
  "reserved",
  "running",
  "awaiting_selection",
  "awaiting_input",
] as const satisfies readonly GenerationStatus[];

export type ActiveGenerationStatus = (typeof ACTIVE_GENERATION_STATUSES)[number];

/** Statuses nothing may leave. `superseded` (CAP-7) is terminal without a
 * report: a partial compare generation whose failed drafts were retried into
 * a linked recovery generation. */
export const TERMINAL_GENERATION_STATUSES = [
  "completed",
  "failed",
  "superseded",
] as const satisfies readonly GenerationStatus[];

export function isTerminalGenerationStatus(status: GenerationStatus): boolean {
  return (TERMINAL_GENERATION_STATUSES as readonly GenerationStatus[]).includes(status);
}

export function isActiveGenerationStatus(
  status: GenerationStatus
): status is ActiveGenerationStatus {
  return (ACTIVE_GENERATION_STATUSES as readonly GenerationStatus[]).includes(status);
}

/**
 * Which state machine a generation row follows.
 *
 * - `compare`: several candidate drafts, the writer picks one. Legacy rows
 *   without `candidateMode` are compare rows.
 * - `single`: one ungated draft that completes on its own.
 * - `sections`: the older gated flow (`candidateMode: iterative` without the
 *   seed workflow): section drafts oscillate `running` and `awaiting_input`
 *   until the writer approves the last one.
 * - `seed_stage`: a Step-by-step generation before Summary sign-off. It
 *   initializes in `running` and waits in `awaiting_input` while the writer
 *   works the Seeds; sign-off moves it back to `running`.
 * - `seed_drafting`: a signed-off Step-by-step generation (it carries a
 *   `summaryVersionId`, including a Summary recovery row). It drafts through
 *   the ordered chain and completes on its own.
 */
export const GENERATION_FLOWS = [
  "compare",
  "single",
  "sections",
  "seed_stage",
  "seed_drafting",
] as const;

export type GenerationFlow = (typeof GENERATION_FLOWS)[number];

/** The fields that decide a row's flow. Absent `gatedWorkflow` on an
 * iterative row means section approval (rows from before the seed workflow). */
export type GenerationFlowFields = {
  candidateMode?: "compare" | "single" | "iterative";
  gatedWorkflow?: "sections" | "seeds";
  summaryVersionId?: unknown;
};

export function generationFlowOf(generation: GenerationFlowFields): GenerationFlow {
  const mode = generation.candidateMode ?? "compare";
  if (mode === "compare") return "compare";
  if (mode === "single") return "single";
  const workflow = generation.gatedWorkflow ?? "sections";
  if (workflow === "sections") return "sections";
  return generation.summaryVersionId !== undefined ? "seed_drafting" : "seed_stage";
}

export type GenerationStatusTransition = {
  from: GenerationStatus;
  to: GenerationStatus;
  flows: readonly GenerationFlow[];
  /** The functions that make this move, as `module.function`. */
  sites: readonly string[];
  note: string;
};

const ALL_FLOWS = GENERATION_FLOWS;
const SELECTION_FLOWS = ["compare", "single"] as const;

/**
 * Every legal `status` move. Anything else is refused. The first status of a
 * row is always `reserved` (reserveGeneration, retryFromSummary); rows are
 * inserted, not transitioned, into it.
 */
export const GENERATION_STATUS_TRANSITIONS: readonly GenerationStatusTransition[] = [
  {
    from: "reserved",
    to: "running",
    flows: ALL_FLOWS,
    sites: ["generations.beginGeneration", "generations.beginSummaryRecovery"],
    note: "The scheduled pipeline claims its reservation.",
  },
  {
    from: "reserved",
    to: "failed",
    flows: ALL_FLOWS,
    sites: [
      "generations.failGeneration",
      "generations.cancelIterativeGeneration",
      "generations.failStaleGenerations",
      "projects.deleteProject",
    ],
    note: "Startup failure, a writer cancel, the stale reaper or project deletion.",
  },
  {
    from: "running",
    to: "running",
    flows: ALL_FLOWS,
    sites: ["generations.updateGenerationStatus"],
    note: "A progress update that restates the running status.",
  },
  {
    from: "running",
    to: "awaiting_selection",
    flows: ["compare"],
    sites: ["generations.completeCandidateRun", "generations.failOrderedSectionRun"],
    note: "Every compare candidate settled and at least one succeeded.",
  },
  {
    from: "running",
    to: "awaiting_input",
    flows: ["sections", "seed_stage"],
    sites: [
      "generations.completeSectionRun",
      "generations.failSectionRun",
      "generations.failStaleGenerations",
      "generations.initializeSeedStage",
    ],
    note: "A section draft (or a failed or timed-out one) waits for the writer; or the seed stage opens.",
  },
  {
    from: "running",
    to: "completed",
    flows: ["single", "seed_drafting"],
    sites: ["generations.completeCandidateRun"],
    note: "The one ungated draft (single, or signed-off seed drafting) created its report.",
  },
  {
    from: "running",
    to: "failed",
    flows: ALL_FLOWS,
    sites: [
      "generations.completeCandidateRun",
      "generations.failOrderedSectionRun",
      "generations.failGeneration",
      "generations.cancelIterativeGeneration",
      "generations.failStaleGenerations",
      "projects.deleteProject",
    ],
    note: "Every candidate failed, the pipeline failed, a cancel, the reaper or project deletion.",
  },
  {
    from: "awaiting_selection",
    to: "completed",
    flows: SELECTION_FLOWS,
    sites: ["generations.selectReportCandidate"],
    note: "The writer picked a candidate. Single rows reach this only from before single mode completed on its own.",
  },
  {
    from: "awaiting_selection",
    to: "superseded",
    flows: ["compare"],
    sites: ["generations.retryFailedCandidates"],
    note: "Failed compare drafts were retried into a linked recovery generation (CAP-7).",
  },
  {
    from: "awaiting_selection",
    to: "failed",
    // Failure is legal from every active status in every flow, so project
    // deletion (which fails every live row) is never refused, even for a
    // legacy row whose status does not fit its flow.
    flows: ALL_FLOWS,
    sites: ["projects.deleteProject"],
    note: "Project deletion fails every live generation.",
  },
  {
    from: "awaiting_input",
    to: "awaiting_input",
    flows: ["seed_stage"],
    sites: ["generations.initializeSeedStage"],
    note: "Seed initialization restates the open seed stage.",
  },
  {
    from: "awaiting_input",
    to: "running",
    flows: ["sections", "seed_stage"],
    sites: [
      "generations.approveSectionDraft",
      "generations.regenerateSectionDraft",
      "generations.signOffSeedStage",
    ],
    note: "The next (or a redrafted) section starts, or the writer signs off the Summary.",
  },
  {
    from: "awaiting_input",
    to: "completed",
    flows: ["sections"],
    sites: ["generations.approveSectionDraft"],
    note: "The writer approved the last section and the report was assembled.",
  },
  {
    from: "awaiting_input",
    to: "failed",
    flows: ALL_FLOWS,
    sites: ["generations.cancelIterativeGeneration", "projects.deleteProject"],
    note: "A writer cancel or project deletion.",
  },
];

export function findGenerationStatusTransition(
  flow: GenerationFlow,
  from: GenerationStatus,
  to: GenerationStatus
): GenerationStatusTransition | undefined {
  return GENERATION_STATUS_TRANSITIONS.find(
    (edge) => edge.from === from && edge.to === to && edge.flows.includes(flow)
  );
}

export function isGenerationStatusTransitionAllowed(
  flow: GenerationFlow,
  from: GenerationStatus,
  to: GenerationStatus
): boolean {
  return findGenerationStatusTransition(flow, from, to) !== undefined;
}

// ─── Post-assembly QA (`postQaStatus`) ────────────────────────────────────────

/** `none` is an absent `postQaStatus`: no pass was ever requested. */
export const POST_QA_STATES = ["none", "running", "done", "failed"] as const;
export type PostQaState = (typeof POST_QA_STATES)[number];

export type PostQaTransition = {
  from: PostQaState;
  to: PostQaState;
  sites: readonly string[];
  note: string;
};

export const POST_QA_TRANSITIONS: readonly PostQaTransition[] = [
  ...(["none", "done", "failed"] as const).map((from) => ({
    from,
    to: "running" as const,
    sites: [
      "generations.completeCandidateRun",
      "generations.approveSectionDraft",
      "generations.requestReportQa",
      "generations.applySeedRedraft",
      "generations.failRedraftSection",
      "generations.expireStaleRedraft",
    ],
    note: "A pass starts on a completed report: at assembly, on request, or once a redraft attempt leaves no Section Not drafted.",
  })),
  {
    from: "running",
    to: "done",
    sites: ["generations.saveReportQa"],
    note: "The pass stored its scorecard.",
  },
  {
    from: "running",
    to: "failed",
    sites: [
      "generations.saveReportQa",
      "generations.failStalePostQa",
      "projects.deleteProject",
    ],
    note: "The pass failed, went stale, scored a report that changed, or the project is being deleted.",
  },
  // saveReportQa called without an attempt id (legacy callers and tests):
  // no attempt identifies the pass, so it settles whatever state it finds.
  ...(["none", "done", "failed"] as const).flatMap((from) =>
    (["done", "failed"] as const).map((to) => ({
      from,
      to,
      sites: ["generations.saveReportQa"],
      note: "Legacy settle without an attempt id.",
    }))
  ),
];

export function isPostQaTransitionAllowed(from: PostQaState, to: PostQaState): boolean {
  return POST_QA_TRANSITIONS.some((edge) => edge.from === from && edge.to === to);
}

/** A pass may only run over a completed generation's report. */
export const POST_QA_RUNNING_REQUIRES_STATUS: GenerationStatus = "completed";

// ─── "Draft the rest" (`redraft.status`) ─────────────────────────────────────

/** `none` is an absent `redraft`: no attempt was ever started. */
export const REDRAFT_STATES = ["none", "running", "completed", "failed"] as const;
export type RedraftState = (typeof REDRAFT_STATES)[number];

export type RedraftTransition = {
  from: RedraftState;
  to: RedraftState;
  sites: readonly string[];
  note: string;
};

export const REDRAFT_TRANSITIONS: readonly RedraftTransition[] = [
  ...(["none", "completed", "failed"] as const).map((from) => ({
    from,
    to: "running" as const,
    sites: ["generations.redraftMissingSections"],
    note: "The writer starts an attempt.",
  })),
  {
    from: "running",
    to: "running",
    sites: [
      "generations.redraftMissingSections",
      "generations.claimRedraftSection",
      "generations.completeRedraftSection",
      "generations.applySeedRedraft",
    ],
    note: "Progress on the live attempt, or a fresh attempt replacing a stale one.",
  },
  {
    from: "running",
    to: "completed",
    sites: ["generations.applySeedRedraft"],
    note: "The attempt wrote its Sections into the report.",
  },
  {
    from: "running",
    to: "failed",
    sites: ["generations.failRedraftSection", "generations.expireStaleRedraft"],
    note: "A Section failed or the attempt went quiet.",
  },
];

export function isRedraftTransitionAllowed(from: RedraftState, to: RedraftState): boolean {
  return REDRAFT_TRANSITIONS.some((edge) => edge.from === from && edge.to === to);
}

/** A redraft only ever runs on a completed, signed-off seed generation. */
export const REDRAFT_REQUIRES: { status: GenerationStatus; flow: GenerationFlow } = {
  status: "completed",
  flow: "seed_drafting",
};
