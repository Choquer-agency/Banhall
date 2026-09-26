<script lang="ts">
  // I2 "What they cover": one row per area the org leaves to the writer,
  // from the stored analysis. Locked-rule conflicts (not on the board) sit
  // in a quiet disclosure under the list.
  import { IconCheck } from "$lib/components/icons";
  import AuroraMark from "$lib/components/ui/AuroraMark.svelte";
  import Disclosure from "$lib/components/ui/Disclosure.svelte";
  import DisclosureChevron from "$lib/components/ui/DisclosureChevron.svelte";
  import { WRITING_AREAS } from "$lib/settings/writingAreas";
  import type { HouseRuleModes, StyleOverrideKey } from "../../../../../shared/styleOverrides";

  type Categories = Record<StyleOverrideKey, { addressed: boolean; evidence: string | null }>;

  let {
    categories,
    modes,
    conflicts = [],
    checking = false,
    canCheck,
    error = "",
    onCheck,
  }: {
    categories: Categories | null;
    modes: HouseRuleModes;
    conflicts?: Array<{ excerpt: string; rule: string }>;
    checking?: boolean;
    canCheck: boolean;
    error?: string;
    onCheck: () => void;
  } = $props();

  const rows = $derived(WRITING_AREAS.filter((area) => modes[area.key] === "writer_choice"));
  let conflictsOpen = $state(false);

  function short(text: string) {
    return text.length > 140 ? `${text.slice(0, 140).trimEnd()}...` : text;
  }
</script>

<section data-coverage-list class="flex flex-col gap-0.5 rounded-xl border border-line-soft bg-canvas p-4">
  <div class="flex items-center gap-2 pb-1">
    <AuroraMark size={16} />
    <h3 class="flex-1 text-sm leading-5 font-medium text-ink">What they cover</h3>
    <button
      type="button"
      data-check-again
      disabled={checking || !canCheck}
      onclick={onCheck}
      class="rounded text-xs leading-4 font-medium text-primary-selected hover:text-primary-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
    >{checking ? "Checking..." : "Check again"}</button>
  </div>
  {#each rows as area (area.key)}
    {@const category = categories?.[area.key]}
    <div data-coverage-row={area.key} data-covered={category?.addressed ? "true" : "false"} class="flex gap-2.5 border-b border-line-soft py-2.5">
      {#if category?.addressed}
        <span aria-hidden="true" data-covered-tick class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-settings-covered text-fir"><IconCheck size={11} strokeWidth={3.2} /></span>
        <div class="flex min-w-0 flex-col gap-px">
          <span class="text-[13px] leading-[18px] font-medium text-ink">{area.label}</span>
          {#if category.evidence}<span class="text-xs leading-4 text-ink-muted [overflow-wrap:anywhere]">"{short(category.evidence)}"</span>{/if}
        </div>
      {:else}
        <span aria-hidden="true" class="h-5 w-5 shrink-0 rounded-full border-[1.5px] border-dashed border-gray-300"></span>
        <div class="flex min-w-0 flex-col gap-px">
          <span class="text-[13px] leading-[18px] font-medium text-ink-muted">{area.label}</span>
          <span class="text-xs leading-4 text-ink-muted">Not in your instructions</span>
        </div>
      {/if}
    </div>
  {/each}
  {#if error}
    <p role="alert" class="pt-2 text-xs leading-4 text-danger-ink-muted">{error}</p>
  {/if}
  {#if conflicts.length}
    <div class="pt-2">
      <button
        type="button"
        data-conflicts-toggle
        aria-expanded={conflictsOpen}
        aria-controls="locked-conflicts"
        onclick={() => (conflictsOpen = !conflictsOpen)}
        class="flex w-full items-center justify-between gap-2 rounded text-left text-xs leading-4 font-medium text-ink-secondary hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        Some instructions can't be followed
        <DisclosureChevron open={conflictsOpen} />
      </button>
      <Disclosure id="locked-conflicts" open={conflictsOpen}>
        <ul class="flex flex-col gap-1 pt-2">
          {#each conflicts as conflict, index (index)}
            <li class="text-xs leading-4 text-ink-muted">"{short(conflict.excerpt)}" <span class="text-ink-faint">({conflict.rule})</span></li>
          {/each}
        </ul>
      </Disclosure>
    </div>
  {/if}
</section>
