import { WORKFLOW_STAGE_LABELS } from "../../../shared/workflowLabels";
import { WORKFLOW_STAGES, type WorkflowStage } from "../../../shared/workflowStages";

export const LEGACY_STAGE_FILTER = "legacy";

export type StageFilter = "all" | WorkflowStage | typeof LEGACY_STAGE_FILTER;

type StageProject = { workflowStage?: WorkflowStage };

export function stageFilterKey(project: StageProject) {
  return project.workflowStage ?? LEGACY_STAGE_FILTER;
}

export function matchesStageFilter(project: StageProject, filter: string) {
  return filter === "all" || stageFilterKey(project) === filter;
}

export function countProjectsByStage(projects: readonly StageProject[]) {
  return projects.reduce<Record<string, number>>((counts, project) => {
    const key = stageFilterKey(project);
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

export function stageFilterItemsFromCounts(
  counts: Record<string, number>,
  total: number,
  approximate = false
) {
  const suffix = approximate ? "+" : "";
  const items = [
    { value: "all", label: `All stages (${total}${suffix})` },
    ...WORKFLOW_STAGES.filter((stage) => (counts[stage] ?? 0) > 0).map((stage) => ({
      value: stage,
      label: `${WORKFLOW_STAGE_LABELS[stage]} (${counts[stage]}${suffix})`,
    })),
  ];
  if ((counts[LEGACY_STAGE_FILTER] ?? 0) > 0) {
    items.push({
      value: LEGACY_STAGE_FILTER,
      label: `Legacy status (${counts[LEGACY_STAGE_FILTER]}${suffix})`,
    });
  }
  return items;
}

export function stageFilterItems(projects: readonly StageProject[]) {
  return stageFilterItemsFromCounts(countProjectsByStage(projects), projects.length);
}

export function stageFilterLabel(filter: string) {
  if (filter === LEGACY_STAGE_FILTER) return "legacy-status";
  if (WORKFLOW_STAGES.includes(filter as WorkflowStage)) {
    return WORKFLOW_STAGE_LABELS[filter as WorkflowStage].toLowerCase();
  }
  return "matching";
}
