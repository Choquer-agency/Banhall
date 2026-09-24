/**
 * Details data adapter: the ONE place the report page reads and writes the
 * Details panel's workflow data. The panel components take the
 * `DetailsPanelData` shape and plain callbacks.
 *
 * - `data` is the `api.projects.getProjectDetailsPanel` subscription. The
 *   viewer's workflow authorities are not part of that read model, so while
 *   the Details side panel is open the adapter also reads
 *   `projectWorkflow.getProjectWorkflowHeader` and adds them as
 *   `viewerAuthorities`: the stage menu and the Hand off stage list then
 *   disable the edges this viewer cannot take instead of offering them and
 *   letting the server refuse. The popover and the top bar never need them,
 *   so the header is not subscribed while the panel is closed. The More
 *   disclosure reads the same header for owner transfer.
 * - `handOff` is one `api.workItems.handOff` call: the stage change, the
 *   replaced handoff and the new work item are written in one transaction.
 *
 * Stage changes, field saves and the team list use their own final APIs.
 */
import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
import { useAction, useMutation, useQuery } from "convex-svelte";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import type { WorkflowStage } from "../../../../../shared/workflowStages";
import { reviewDecisionForStage } from "../../../../../shared/workflowTransitions";
import { userErrorCode, userErrorMessage } from "$lib/errors";
import { createRequestId } from "$lib/requestId";
import type { DetailsPanelData, HandOffInput, TeamMember } from "./types";

/** Per-company project number rule the server enforces: "1".."20", "A".."Z", or "2A". */
const PROJECT_NUMBER_PATTERN = /^(?:[1-9][0-9]?[A-Z]?|[A-Z])$/;

export function validateProjectNumber(value: string): string {
  const next = value.trim().toUpperCase();
  const numericPart = next.match(/^[0-9]+/)?.[0];
  if (next && (!PROJECT_NUMBER_PATTERN.test(next) || (numericPart !== undefined && Number(numericPart) > 20))) {
    throw new Error("Use 1 to 20, a letter A to Z, or both, like 2A.");
  }
  return next;
}

const HAND_OFF_REASON = "Only the Owner, a Manager or an Admin can hand off this project.";

export function useDetailsData(options: {
  projectId: () => Id<"projects">;
  currentUserId: () => Id<"users"> | undefined;
  /**
   * The page's metadata edit gate (`projects.getProjectEditAccess`: editable
   * while loading, read-only on error). The facts rows follow it together
   * with the panel's own permission, so they never disagree with the More
   * disclosure's rows.
   */
  canEditDetails: () => boolean;
  /** True while the Details side panel is open (the stage menu needs the viewer's authorities). */
  panelOpen: () => boolean;
  /** True while the team list is needed (the Hand off view is open). */
  teamNeeded: () => boolean;
}) {
  const auth = useAuth();
  const panelQ = useQuery(api.projects.getProjectDetailsPanel, () =>
    auth.isAuthenticated ? { projectId: options.projectId() } : "skip"
  );
  const headerQ = useQuery(api.projectWorkflow.getProjectWorkflowHeader, () =>
    auth.isAuthenticated && options.panelOpen() ? { projectId: options.projectId() } : "skip"
  );
  const teamQ = useQuery(api.workItems.listAssigneeCandidates, () =>
    auth.isAuthenticated && options.teamNeeded() ? { projectId: options.projectId() } : "skip"
  );

  const setWorkflowStage = useMutation(api.projectWorkflow.setWorkflowStage);
  const handOffMutation = useMutation(api.workItems.handOff);
  const updateIndustry = useMutation(api.projects.updateProjectIndustry);
  const updateFiscalYear = useMutation(api.projects.updateProjectFiscalYear);
  const updateScienceCode = useMutation(api.projects.updateProjectScienceCode);
  const setProjectNumber = useMutation(api.projects.setProjectNumber);
  const suggestScienceCode = useAction(api.scienceCodeSuggestions.suggest);

  const header = $derived(headerQ.data);

  const data = $derived.by((): DetailsPanelData | null | undefined => {
    const panel = panelQ.data;
    if (panel === undefined || panel === null) return panel;
    const permissions = {
      ...panel.permissions,
      canEditDetails: panel.permissions.canEditDetails && options.canEditDetails(),
    };
    return header
      ? { ...panel, permissions, viewerAuthorities: header.viewerAuthorities }
      : { ...panel, permissions };
  });

  const team = $derived<TeamMember[]>(
    (teamQ.data?.candidates ?? []).map((candidate) => ({
      userId: candidate.userId,
      label: candidate.label,
      initials: candidate.initials,
      isYou: candidate.userId === options.currentUserId(),
    }))
  );

  function fail(error: unknown, fallback: string): never {
    if (userErrorCode(error) === "STALE_REVISION") {
      throw new Error("The workflow changed while you were working. Check the latest stage and try again.");
    }
    throw new Error(userErrorMessage(error, fallback));
  }

  async function changeStage(stage: WorkflowStage, note?: string) {
    const snapshot = data;
    if (!snapshot) throw new Error("Details are still loading.");
    const decision =
      snapshot.stage === "internal_review" ? reviewDecisionForStage(stage) : undefined;
    try {
      await setWorkflowStage({
        projectId: options.projectId(),
        toStage: stage,
        ...(note ? { note } : {}),
        ...(decision ? { reviewDecision: { decision } } : {}),
        expectedVersion: snapshot.workflowVersion,
      });
    } catch (error) {
      fail(error, "The stage could not be changed.");
    }
  }

  /**
   * One Hand off attempt: a fresh request id, fenced on the workflow version
   * the panel showed. A refusal rejects with the reason in plain words.
   */
  async function handOff(input: HandOffInput) {
    const snapshot = data;
    if (!snapshot) throw new Error("Details are still loading.");
    try {
      await handOffMutation({
        projectId: options.projectId(),
        assigneeId: input.assigneeId,
        stage: input.stage,
        note: input.note,
        expectedWorkflowVersion: snapshot.workflowVersion,
        createRequestId: createRequestId(),
      });
    } catch (error) {
      if (userErrorCode(error) === "NOT_AUTHORIZED") throw new Error(HAND_OFF_REASON);
      fail(error, "The hand off could not be saved.");
    }
  }

  async function saveIndustry(industry: string | null) {
    try {
      await updateIndustry({ projectId: options.projectId(), industry: industry ?? undefined });
    } catch (error) {
      fail(error, "The industry could not be updated.");
    }
  }

  async function saveFiscalYear(fiscalYearEnd: number | null) {
    try {
      await updateFiscalYear({ projectId: options.projectId(), fiscalYearEnd: fiscalYearEnd ?? undefined });
    } catch (error) {
      fail(error, "The fiscal year could not be updated.");
    }
  }

  async function saveScienceCode(scienceCode: string | null) {
    try {
      await updateScienceCode({ projectId: options.projectId(), scienceCode: scienceCode ?? undefined });
    } catch (error) {
      fail(error, "The science code could not be updated.");
    }
  }

  async function saveProjectNumber(value: string) {
    const next = validateProjectNumber(value);
    try {
      await setProjectNumber({ projectId: options.projectId(), projectNumber: next || undefined });
    } catch (error) {
      fail(error, "The project number could not be updated.");
    }
  }

  async function suggestCode(): Promise<string | null> {
    try {
      const result = await suggestScienceCode({ projectId: options.projectId() });
      if (!result) return null;
      await updateScienceCode({ projectId: options.projectId(), scienceCode: result.code });
      return result.label;
    } catch (error) {
      fail(error, "Could not suggest a science code.");
    }
  }

  return {
    get data() {
      return data;
    },
    get error() {
      return panelQ.error ? userErrorMessage(panelQ.error, "Details are temporarily unavailable.") : null;
    },
    /** The workflow header, read only while the Details panel is open. */
    get header() {
      return header;
    },
    get team() {
      return team;
    },
    get teamLoading() {
      return teamQ.isLoading;
    },
    get teamError() {
      return teamQ.error ? userErrorMessage(teamQ.error, "The team could not be loaded.") : null;
    },
    get changeStageReason() {
      return "Only the Owner, a Manager or an Admin can change the stage.";
    },
    get handOffReason() {
      return HAND_OFF_REASON;
    },
    changeStage,
    handOff,
    saveIndustry,
    saveFiscalYear,
    saveScienceCode,
    saveProjectNumber,
    suggestScienceCode: suggestCode,
  };
}

export type DetailsDataController = ReturnType<typeof useDetailsData>;
