/**
 * Details data adapter: the ONE place the report page reads and writes the
 * Details panel's workflow data. The panel components take the
 * `DetailsPanelData` shape and plain callbacks, so only this module changes
 * when the backend grows `api.projects.getProjectDetailsPanel` and
 * `api.workItems.handOff`:
 *
 * - `data` is assembled here from existing queries (the project document,
 *   `projectWorkflow.getProjectWorkflowHeader`, `workItems.getProjectWorkPanel`
 *   and the page's edit access). Switch point one: replace `buildData` with
 *   the `getProjectDetailsPanel` subscription.
 * - `handOff` runs on existing mutations: `workItems.create` (with the
 *   confirmed Internal review stage change where that is the target),
 *   preceded by `projectWorkflow.setWorkflowStage` for any other stage change
 *   and by `workItems.cancel` for a handoff being replaced. Switch point two:
 *   replace the body of `handOff` with one `workItems.handOff` call, which
 *   does all of it in one transaction.
 *
 * Everything else (stage changes, field saves, the team list) already uses
 * the final APIs.
 */
import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
import { useAction, useMutation, useQuery } from "convex-svelte";
import { api } from "../../../../../convex/_generated/api";
import type { Doc, Id } from "../../../../../convex/_generated/dataModel";
import type { WorkflowStage } from "../../../../../shared/workflowStages";
import { reviewDecisionForStage } from "../../../../../shared/workflowTransitions";
import { workflowStageOptions } from "../../../../../shared/workflowLabels";
import { userErrorCode, userErrorMessage } from "$lib/errors";
import { createRequestId } from "$lib/requestId";
import { workItemKindForStage } from "./detailsFormat";
import { stageMove } from "./stageMenu";
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

type ProjectLike = Pick<
  Doc<"projects">,
  "createdAt" | "industry" | "fiscalYearEnd" | "scienceCode" | "projectNumber"
> & { updatedAt?: number; workflowUpdatedAt?: number };

const MANAGING = new Set(["owner", "manager", "admin"]);

export function useDetailsData(options: {
  projectId: () => Id<"projects">;
  project: () => ProjectLike | null | undefined;
  currentUserId: () => Id<"users"> | undefined;
  canEditDetails: () => boolean;
  /** True while the team list is needed (the Hand off view is open). */
  teamNeeded: () => boolean;
}) {
  const auth = useAuth();
  const headerQ = useQuery(api.projectWorkflow.getProjectWorkflowHeader, () =>
    auth.isAuthenticated ? { projectId: options.projectId() } : "skip"
  );
  const workPanelQ = useQuery(api.workItems.getProjectWorkPanel, () =>
    auth.isAuthenticated ? { projectId: options.projectId() } : "skip"
  );
  const teamQ = useQuery(api.workItems.listAssigneeCandidates, () =>
    auth.isAuthenticated && options.teamNeeded() ? { projectId: options.projectId() } : "skip"
  );

  const setWorkflowStage = useMutation(api.projectWorkflow.setWorkflowStage);
  const createWork = useMutation(api.workItems.create);
  const cancelWork = useMutation(api.workItems.cancel);
  const updateIndustry = useMutation(api.projects.updateProjectIndustry);
  const updateFiscalYear = useMutation(api.projects.updateProjectFiscalYear);
  const updateScienceCode = useMutation(api.projects.updateProjectScienceCode);
  const setProjectNumber = useMutation(api.projects.setProjectNumber);
  const suggestScienceCode = useAction(api.scienceCodeSuggestions.suggest);

  const header = $derived(headerQ.data);
  const workPanel = $derived(workPanelQ.data);

  function buildData(): DetailsPanelData | null | undefined {
    const project = options.project();
    if (project === null || header === null) return null;
    if (project === undefined || header === undefined) return undefined;
    const userId = options.currentUserId();
    const current = workPanel?.currentHandoffId
      ? (workPanel.openItems.find((item) => item.workItemId === workPanel.currentHandoffId) ?? null)
      : null;
    const authorities = header.viewerAuthorities;
    const manages = authorities.some((authority) => MANAGING.has(authority));
    return {
      stage: header.workflowStage,
      workflowVersion: header.workflowVersion,
      industry: project.industry ?? null,
      fiscalYearEnd: project.fiscalYearEnd ?? null,
      scienceCode: project.scienceCode ?? null,
      projectNumber: project.projectNumber ?? null,
      owner: header.owner
        ? { ...header.owner, isYou: header.owner.userId === userId }
        : null,
      createdAt: project.createdAt,
      editedAt: Math.max(project.updatedAt ?? 0, header.workflowUpdatedAt ?? 0, project.createdAt),
      currentHandoff: current
        ? {
            workItemId: current.workItemId,
            assigneeId: current.assignee.userId,
            assigneeLabel: current.assignee.label,
            initials: current.assignee.initials,
            isYou: current.assignee.userId === userId,
            note: current.instructionsPreview,
          }
        : null,
      permissions: {
        canEditDetails: options.canEditDetails(),
        canChangeStage: workflowStageOptions(header.workflowStage, authorities).length > 0,
        canHandOff: Boolean(
          manages && workPanel?.viewer.canCreate && workPanel.assignable && workPanel.pointerHealthy
        ),
      },
      viewerAuthorities: authorities,
    };
  }

  const data = $derived(buildData());

  const team = $derived<TeamMember[]>(
    (teamQ.data?.candidates ?? []).map((candidate) => ({
      userId: candidate.userId,
      label: candidate.label,
      initials: candidate.initials,
      isYou: candidate.userId === options.currentUserId(),
    }))
  );

  const handOffReason = $derived.by(() => {
    if (!workPanel) return null;
    if (!workPanel.assignable) return workPanel.assignableReason ?? "This project cannot take new handoffs.";
    if (!workPanel.pointerHealthy) return "This project's handoff records disagree. Ask an administrator to repair them.";
    return "Only the Owner, a Manager or an Admin can hand off this project.";
  });

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

  async function handOff(input: HandOffInput) {
    const snapshot = data;
    if (!snapshot) throw new Error("Details are still loading.");
    const projectId = options.projectId();
    const kind = workItemKindForStage(input.stage);
    const confirmReview = input.stage === "internal_review" && snapshot.stage !== "internal_review";
    try {
      // A replaced handoff is canceled first (the handOff mutation does this atomically).
      const current = workPanel?.openItems.find((item) => item.isCurrentHandoff);
      if (current) {
        await cancelWork({
          workItemId: current.workItemId,
          expectedVersion: current.version,
          reason: `Handed off to ${input.assigneeLabel}`,
        });
      }
      let workflowVersion = snapshot.workflowVersion;
      if (input.stage !== snapshot.stage && !confirmReview) {
        const moved = await setWorkflowStage({
          projectId,
          toStage: input.stage,
          ...(stageMove(snapshot.stage, input.stage) === "reason" || input.note ? { note: input.note } : {}),
          expectedVersion: workflowVersion,
        });
        workflowVersion = moved.version;
      }
      await createWork({
        projectId,
        kind,
        assigneeId: input.assigneeId,
        blocking: true,
        instructions: input.note,
        createRequestId: createRequestId(),
        ...(confirmReview
          ? { confirmedStageChange: "internal_review" as const, expectedWorkflowVersion: workflowVersion }
          : {}),
      });
    } catch (error) {
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
      return headerQ.error ? userErrorMessage(headerQ.error, "Details are temporarily unavailable.") : null;
    },
    get header() {
      return header;
    },
    get workPanel() {
      return workPanel;
    },
    get workPanelError() {
      return workPanelQ.error ?? null;
    },
    get workPanelLoading() {
      return workPanelQ.isLoading;
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
      return handOffReason;
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
