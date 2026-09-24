import type { Id } from "../../../../../convex/_generated/dataModel";
import type { WorkflowStage } from "../../../../../shared/workflowStages";
import type { TransitionAuthority } from "../../../../../shared/workflowTransitions";

/**
 * The Details panel read model (ui-design-final.md section 8): the
 * `api.projects.getProjectDetailsPanel` return shape, plus the viewer's
 * workflow authorities that the adapter in `detailsData.svelte.ts` adds while
 * the panel is open.
 */
export type DetailsPanelData = {
  stage: WorkflowStage;
  workflowVersion: number;
  industry: string | null;
  fiscalYearEnd: number | null;
  scienceCode: string | null;
  projectNumber: string | null;
  owner: { userId: Id<"users">; label: string; initials: string; isYou: boolean } | null;
  createdAt: number;
  /** Latest of the project's updatedAt and its workflow updates. */
  editedAt: number;
  currentHandoff: null | {
    workItemId: Id<"workItems">;
    assigneeId: Id<"users">;
    assigneeLabel: string;
    initials: string;
    isYou: boolean;
    note: string;
  };
  permissions: { canEditDetails: boolean; canChangeStage: boolean; canHandOff: boolean };
  /**
   * Optional: the viewer's workflow authorities, when the adapter has read
   * them. With them the stage menu disables the edges this viewer cannot
   * take; without them every edge is offered and the server decides.
   */
  viewerAuthorities?: readonly TransitionAuthority[];
};

/** One person the project can be handed to. */
export type TeamMember = {
  userId: Id<"users">;
  label: string;
  initials: string;
  isYou: boolean;
};

/** What the Hand off view submits. `note` may be empty; `stage` may equal the current stage. */
export type HandOffInput = {
  assigneeId: Id<"users">;
  assigneeLabel: string;
  stage: WorkflowStage;
  note: string;
};

/** Field saves from the facts rows. Each rejects with a user-facing Error on failure. */
export type DetailsFieldSavers = {
  onSaveIndustry?: (industry: string | null) => Promise<void>;
  onSaveFiscalYear?: (fiscalYearEnd: number | null) => Promise<void>;
  onSaveScienceCode?: (scienceCode: string | null) => Promise<void>;
  onSaveProjectNumber?: (projectNumber: string) => Promise<void>;
  /** Asks the AI for a science code and saves it; resolves to the chosen label or null. */
  onSuggestScienceCode?: () => Promise<string | null>;
};
