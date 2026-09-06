import { WORKFLOW_STAGE_LABELS } from "../../../shared/workflowLabels";
import { WORKFLOW_STAGES, type WorkflowStage } from "../../../shared/workflowStages";

export const LEGACY_STAGE_FILTER = "legacy";

export type StageFilter = "all" | WorkflowStage | typeof LEGACY_STAGE_FILTER;

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

export function stageFilterLabel(filter: string) {
  if (filter === LEGACY_STAGE_FILTER) return "legacy-status";
  if (WORKFLOW_STAGES.includes(filter as WorkflowStage)) {
    return WORKFLOW_STAGE_LABELS[filter as WorkflowStage].toLowerCase();
  }
  return "matching";
}
