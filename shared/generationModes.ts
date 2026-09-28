/**
 * The generation modes a writer picks from ("How should we write it?", round
 * 2 board E1): one list for every mode selector, so the labels, hints and
 * order cannot drift between New project and the project page (spine AD-41,
 * CAP-1, story 8). Array order is display order: Step by step first, with the
 * Recommended label.
 *
 * The ids are the stored `candidateMode` values; "iterative" is the existing
 * gated key and must not change. Copy only: picking a mode here starts
 * nothing and changes no mode behaviour.
 */
export const GENERATION_MODE_IDS = ["iterative", "single", "compare"] as const;

export type GenerationModeId = (typeof GENERATION_MODE_IDS)[number];

export type GenerationMode = {
  id: GenerationModeId;
  /** The mode's name on every selector. */
  label: string;
  /** One line under the label (board E1). */
  hint: string;
  /** The tablet strip's shorter line (board H1). */
  shortHint: string;
  /** The mode named in running text: "A Step by step run started 12 min ago." */
  runLabel: string;
  /** Shows the "Recommended" label. */
  recommended: boolean;
  /** What re-running does in this mode, in the re-run confirmation. */
  rerun: string;
};

export const GENERATION_MODES: ReadonlyArray<GenerationMode> = [
  {
    id: "iterative",
    label: "Step by step",
    hint: "Pick the ideas first. We write after.",
    shortHint: "Pick the ideas first. We write after.",
    runLabel: "Step by step run",
    recommended: true,
    rerun: "You pick and approve the ideas step by step, then Banhall writes a new version of the report from your plan.",
  },
  {
    id: "single",
    label: "Single draft",
    hint: "One full draft, straight to the editor.",
    shortHint: "One full draft",
    runLabel: "Single draft",
    recommended: false,
    rerun: "Banhall writes one new draft and adds it as a new version of the report.",
  },
  {
    id: "compare",
    label: "Compare two drafts",
    hint: "Two drafts. You keep the better one.",
    shortHint: "Two drafts, keep one",
    runLabel: "Compare run",
    recommended: false,
    rerun: "Banhall writes two new drafts and adds the one you keep as a new version of the report.",
  },
];

/**
 * The re-run confirmation around the mode's `rerun` line (project page, when
 * the project already has a report). A re-run never changes the current
 * report: each finished run adds a new report version, and the report page
 * shows the newest (reservation.ts, candidates.ts createGeneratedReportArtifacts).
 */
export const RERUN_CONFIRM = {
  title: "This project already has a report",
  keeps: "Your current report stays as it is until the new version is created, and earlier versions stay in version history.",
  confirm: "Re-run generation",
} as const;

export function isGenerationModeId(value: unknown): value is GenerationModeId {
  return typeof value === "string" && (GENERATION_MODE_IDS as readonly string[]).includes(value);
}

export function generationMode(id: GenerationModeId): GenerationMode {
  const mode = GENERATION_MODES.find((entry) => entry.id === id);
  if (!mode) throw new Error(`Unknown generation mode: ${id}`);
  return mode;
}
