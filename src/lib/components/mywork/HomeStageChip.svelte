<!--
  Compact stage chip for Home (ui-design-final.md section 9, boards 1.1 and
  1.2): 5px radius, 11px label, the canonical stage tone from
  stagePresentation so Home reads the same colours as the rest of the app.
-->
<script lang="ts">
  import type { WorkflowStage } from "../../../../shared/workflowStages";
  import { WORKFLOW_STAGE_LABELS } from "../../../../shared/workflowLabels";
  import { stageBadgeClasses } from "$lib/workflow/stagePresentation";

  let { stage }: { stage: WorkflowStage } = $props();
</script>

<span
  data-home-stage-chip={stage}
  class={`inline-flex max-w-full items-center truncate rounded-[5px] px-2 py-[3px] text-[11px] leading-4 ${stageBadgeClasses(stage).badge}`}
>
  {WORKFLOW_STAGE_LABELS[stage]}
</span>
