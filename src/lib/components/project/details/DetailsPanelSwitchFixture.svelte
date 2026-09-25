<script lang="ts">
  // Test fixture: a side slot that swaps the Details panel for another panel
  // in an {#if}, the way the project page switches Details, Assistant and QA.
  import DetailsPanel from "./DetailsPanel.svelte";
  import type { WorkflowStage } from "../../../../../shared/workflowStages";
  import type { DetailsPanelData } from "./types";

  let {
    data,
    onChangeStage,
  }: {
    data: DetailsPanelData;
    onChangeStage: (stage: WorkflowStage, note?: string) => Promise<void>;
  } = $props();

  let showDetails = $state(true);
</script>

<button type="button" data-fixture-switch onclick={() => (showDetails = !showDetails)}>Switch panel</button>
<div data-fixture-slot style="display:flex;flex-direction:column;height:600px;width:400px">
  {#if showDetails}
    <DetailsPanel {data} {onChangeStage} onHandOff={async () => {}} onClose={() => (showDetails = false)} />
  {:else}
    <div data-fixture-other-panel>Assistant</div>
  {/if}
</div>
