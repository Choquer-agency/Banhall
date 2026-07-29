<script lang="ts">
  import type { WorkflowStage } from "../../../../shared/workflowStages";
  import Badge from "$lib/components/ui/Badge.svelte";
  import StageBadge from "$lib/components/ui/StageBadge.svelte";

  let {
    workflowStage,
    legacyStatus,
    darkSurface = false,
  }: {
    workflowStage?: WorkflowStage;
    legacyStatus: string;
    darkSurface?: boolean;
  } = $props();
</script>

{#if workflowStage}
  <StageBadge stage={workflowStage} dot {darkSurface} />
{:else}
  <span data-legacy-project-status class={`flex ${darkSurface ? "flex-row items-center" : "flex-col items-end"} gap-1.5`}>
    <Badge status={legacyStatus} dot {darkSurface} />
    <span
      data-legacy-status-qualifier
      class={`${darkSurface ? "text-white" : "text-ink-secondary"} text-xs font-semibold uppercase tracking-wide`}
    >
      Legacy status
    </span>
  </span>
{/if}
