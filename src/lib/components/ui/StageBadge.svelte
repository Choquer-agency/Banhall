<script lang="ts">
  import type { WorkflowStage } from "../../../../shared/workflowStages";
  import { WORKFLOW_STAGE_LABELS } from "../../../../shared/workflowLabels";
  import { stageBadgeClasses } from "$lib/workflow/stagePresentation";

  let {
    stage,
    dot = false,
    darkSurface = false,
    charcoal = false,
    shape = "pill",
  }: {
    stage: WorkflowStage;
    dot?: boolean;
    /** Opaque high-contrast treatment for the saturated fir app bar. */
    darkSurface?: boolean;
    /** Low-alpha tinted treatment for the Obvious-dark workspace shell. */
    charcoal?: boolean;
    /** Board headers use Obvious's compact rounded-square category label. */
    shape?: "pill" | "square";
  } = $props();
  const classes = $derived(stageBadgeClasses(stage));
  const badgeClass = $derived(
    charcoal ? classes.charcoalBadge : darkSurface ? classes.darkBadge : classes.badge
  );
  const dotClass = $derived(
    charcoal ? classes.charcoalDot : darkSurface ? classes.darkDot : classes.dot
  );
</script>

<span
  data-stage-badge={stage}
  class={`inline-flex items-center gap-1.5 px-2.5 py-0.5 text-xs font-medium ${shape === "square" ? "rounded-md" : "rounded-full"} ${badgeClass}`}
>
  {#if dot}
    <span aria-hidden="true" class={`h-1.5 w-1.5 rounded-full ${dotClass}`}></span>
  {/if}
  {WORKFLOW_STAGE_LABELS[stage]}
</span>
