<script lang="ts">
  // Test fixture: mounts the Details data adapter for one project id, the way
  // the project page does, so a test can move the page to another project
  // while a science code suggestion is pending.
  import type { Id } from "../../../../../convex/_generated/dataModel";
  import { useDetailsData } from "./detailsData.svelte";
  import type { ScienceCodeSuggestion } from "./types";

  let { projectId }: { projectId: string } = $props();

  const details = useDetailsData({
    projectId: () => projectId as Id<"projects">,
    currentUserId: () => undefined,
    canEditDetails: () => true,
    panelOpen: () => false,
    teamNeeded: () => false,
  });

  let outcome = $state<ScienceCodeSuggestion | null>(null);

  async function suggest() {
    outcome = await details.suggestScienceCode();
  }
</script>

<button type="button" data-fixture-suggest onclick={() => void suggest()}>Suggest a code</button>
<output data-fixture-outcome>{outcome?.status ?? ""}</output>
