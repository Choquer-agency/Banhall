<script lang="ts">
  import type { WorkflowStage } from "../../../../shared/workflowStages";
  import { WORKFLOW_STAGE_LABELS } from "../../../../shared/workflowLabels";
  import { stageBadgeClasses } from "$lib/workflow/stagePresentation";

  let {
    stage,
    dot = false,
    darkSurface = false,
  }: { stage: WorkflowStage; dot?: boolean; darkSurface?: boolean } = $props();
  const classes = $derived(stageBadgeClasses(stage));
</script>

<span
  data-stage-badge={stage}
  class={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${darkSurface ? classes.darkBadge : classes.badge}`}
>
  {#if dot}
    <span aria-hidden="true" class={`h-1.5 w-1.5 rounded-full ${darkSurface ? classes.darkDot : classes.dot}`}></span>
  {/if}
  {WORKFLOW_STAGE_LABELS[stage]}
</span>
