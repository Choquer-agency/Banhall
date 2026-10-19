<script lang="ts">
  // I2 "Where your preferences win": one card per area with a switch bound
  // to the writer's waiver. Areas the org sets to enforced or off show a
  // lock instead; the writer's saved choice stays underneath, as before.
  // 2026-10-19 meeting: the switch does not turn the writer's instructions
  // on or off, it decides who wins in that area, so the legend says so, and
  // each area has an "i" with the longer explanation (AreaInfo).
  import { IconLock } from "$lib/components/icons";
  import Switch from "$lib/components/ui/Switch.svelte";
  import AreaInfo from "./AreaInfo.svelte";
  import { WRITING_AREAS } from "$lib/settings/writingAreas";
  import type { HouseRuleModes, StyleOverrides } from "../../../../../shared/styleOverrides";

  let { overrides = $bindable(), modes }: { overrides: StyleOverrides; modes: HouseRuleModes } = $props();
</script>

<section data-preference-wins class="flex flex-col gap-3">
  <div class="flex flex-col gap-1">
    <h2 class="text-base leading-[1.375rem] font-medium text-ink">Where your preferences win</h2>
    <p data-switch-meaning class="text-[0.8125rem] leading-[1.125rem] text-ink-secondary">On: your instructions win over the house rule. Off: the house rule wins.</p>
    <p class="text-[0.8125rem] leading-[1.125rem] text-ink-muted">Banhall uses your instructions either way. CRA line and word limits always apply.</p>
  </div>
  <div class="grid grid-cols-1 gap-3 min-[900px]:grid-cols-3">
    {#each WRITING_AREAS as area (area.key)}
      {@const locked = modes[area.key] !== "writer_choice"}
      <div data-win-card={area.key} class={`flex items-center gap-3 rounded-xl border border-line-soft bg-surface px-3.5 py-3 ${locked ? "opacity-75" : ""}`}>
        <div class="flex min-w-0 flex-1 flex-col gap-px">
          <span class="flex items-center gap-1.5">
            <span id={`win-${area.key}`} class="text-[0.8125rem] leading-[1.125rem] font-medium text-ink">{area.label}</span>
            <AreaInfo {area} mode={modes[area.key]} />
          </span>
          <span class="text-xs leading-4 text-ink-muted">{area.summary}</span>
        </div>
        {#if locked}
          <span data-locked class="flex shrink-0 items-center gap-[0.3125rem] text-xs leading-4 text-ink-muted">
            <IconLock size={11} strokeWidth={2.2} />Set by your organization
          </span>
        {:else}
          <Switch size="md" bind:checked={overrides[area.key]} label={area.label} />
        {/if}
      </div>
    {/each}
  </div>
</section>
