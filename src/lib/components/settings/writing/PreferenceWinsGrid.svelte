<script lang="ts">
  // I2 "Where your preferences win": one card per area with a switch bound
  // to the writer's waiver. Areas the org sets to enforced or off show a
  // lock instead; the writer's saved choice stays underneath, as before.
  import { LockSimpleIcon } from "phosphor-svelte";
  import Switch from "$lib/components/ui/Switch.svelte";
  import { WRITING_AREAS } from "$lib/settings/writingAreas";
  import type { HouseRuleModes, StyleOverrides } from "../../../../../shared/styleOverrides";

  let { overrides = $bindable(), modes }: { overrides: StyleOverrides; modes: HouseRuleModes } = $props();
</script>

<section data-preference-wins class="flex flex-col gap-3">
  <h2 class="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
    <span class="text-base leading-[22px] font-medium text-ink">Where your preferences win</span>
    <span class="text-[13px] leading-[18px] text-ink-muted">Turn one on to follow your instructions there instead of the house rule. CRA line and word limits always apply.</span>
  </h2>
  <div class="grid grid-cols-1 gap-3 min-[900px]:grid-cols-3">
    {#each WRITING_AREAS as area (area.key)}
      {@const locked = modes[area.key] !== "writer_choice"}
      <div data-win-card={area.key} class={`flex items-center gap-3 rounded-[10px] border border-line-soft bg-surface px-3.5 py-3 ${locked ? "opacity-75" : ""}`}>
        <div class="flex min-w-0 flex-1 flex-col gap-px">
          <span id={`win-${area.key}`} class="text-[13px] leading-[18px] font-medium text-ink">{area.label}</span>
          <span class="text-xs leading-4 text-ink-muted">{area.description}</span>
        </div>
        {#if locked}
          <span data-locked class="flex shrink-0 items-center gap-[5px] text-xs leading-4 text-ink-muted">
            <LockSimpleIcon size={12} aria-hidden="true" />Set by your organization
          </span>
        {:else}
          <Switch bind:checked={overrides[area.key]} label={area.label} />
        {/if}
      </div>
    {/each}
  </div>
</section>
