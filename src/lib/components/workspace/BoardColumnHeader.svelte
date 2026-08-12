<script lang="ts">
  import type { WorkflowStage } from "../../../../shared/workflowStages";
  import StageBadge from "$lib/components/ui/StageBadge.svelte";
  import LegacyStatusBadge from "$lib/components/ui/LegacyStatusBadge.svelte";

  let {
    id,
    label,
    stage = null,
    count,
    countSuffix = "",
    noneLoaded = false,
    unverified = false,
    headingLevel = 2,
  }: {
    id: string;
    label: string;
    stage?: WorkflowStage | null;
    count: number;
    countSuffix?: "" | "+";
    noneLoaded?: boolean;
    unverified?: boolean;
    headingLevel?: 2 | 3 | 4;
  } = $props();

  const qualifier = $derived(
    noneLoaded ? "none loaded yet" : unverified && count === 0 ? "not fully loaded" : null
  );
  const announcement = $derived(
    `${label}, ${count}${countSuffix} projects${qualifier ? ` — ${qualifier}` : ""}`
  );
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<header
  tabindex="0"
  aria-label={announcement}
  class="flex shrink-0 items-center gap-2 rounded-lg px-2 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-navy"
>
  {#if headingLevel === 2}
    <h2 id={id}>{#if stage}<StageBadge {stage} shape="square" />{:else}<LegacyStatusBadge {label} shape="square" />{/if}</h2>
  {:else if headingLevel === 3}
    <h3 id={id}>{#if stage}<StageBadge {stage} shape="square" />{:else}<LegacyStatusBadge {label} shape="square" />{/if}</h3>
  {:else}
    <h4 id={id}>{#if stage}<StageBadge {stage} shape="square" />{:else}<LegacyStatusBadge {label} shape="square" />{/if}</h4>
  {/if}
  <span class="text-data text-left text-ink-muted">
    {count}{countSuffix}
    {#if qualifier}
      <span
        data-none-loaded={noneLoaded ? "" : undefined}
        data-unverified-count={unverified && count === 0 ? "" : undefined}
        class="block text-[0.6875rem] font-normal text-ink-muted"
      >{qualifier}</span>
    {/if}
  </span>
</header>
