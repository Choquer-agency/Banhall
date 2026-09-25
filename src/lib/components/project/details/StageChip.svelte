<!--
  Stage chip for the Details surfaces (boards 5.1, 5.2, 5.1y): a rounded
  square with a dot, 24px tall on the status line ("md") and 20px in menus
  and fields ("sm"). Colours come from the shared stage palette.
-->
<script lang="ts">
  import { WORKFLOW_STAGE_LABELS } from "../../../../../shared/workflowLabels";
  import type { WorkflowStage } from "../../../../../shared/workflowStages";
  import { stageBadgeClasses } from "$lib/workflow/stagePresentation";

  let { stage, size = "md" }: { stage: WorkflowStage; size?: "md" | "sm" } = $props();

  const classes = $derived(stageBadgeClasses(stage));
</script>

<span
  data-stage-badge={stage}
  class={`inline-flex w-max shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2 text-xs font-medium leading-[18px] ${size === "md" ? "h-6" : "h-5"} ${classes.badge}`}
>
  <span aria-hidden="true" class={`size-1.5 shrink-0 rounded-full ${classes.dot}`}></span>
  {WORKFLOW_STAGE_LABELS[stage]}
</span>
