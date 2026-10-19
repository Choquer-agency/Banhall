<script lang="ts">
  // I2 "What they cover": one row per area, from the stored analysis.
  // Locked-rule conflicts (not on the board) sit in a quiet disclosure under
  // the list. 2026-10-19 meeting fixes: all six areas are listed, so the
  // rows match "n of 6" above (an area the org enforces or turns off says
  // so); each has an "i" (AreaInfo); and saved instructions with no stored
  // check say "Not checked yet" instead of "Not in your instructions".
  import { IconCheck, IconLock } from "$lib/components/icons";
  import AuroraMark from "$lib/components/ui/AuroraMark.svelte";
  import Disclosure from "$lib/components/ui/Disclosure.svelte";
  import DisclosureChevron from "$lib/components/ui/DisclosureChevron.svelte";
  import AreaInfo from "./AreaInfo.svelte";
  import { WRITING_AREAS } from "$lib/settings/writingAreas";
  import type { HouseRuleMode, HouseRuleModes, StyleOverrideKey } from "../../../../../shared/styleOverrides";

  type Categories = Record<StyleOverrideKey, { addressed: boolean; evidence: string | null }>;

  let {
    categories,
    modes,
    conflicts = [],
    checking = false,
    canCheck,
    unchecked = false,
    error = "",
    onCheck,
  }: {
    categories: Categories | null;
    modes: HouseRuleModes;
    conflicts?: Array<{ excerpt: string; rule: string }>;
    checking?: boolean;
    canCheck: boolean;
    /** Saved instructions with no stored check (never run, or it failed). */
    unchecked?: boolean;
    error?: string;
    onCheck: () => void;
  } = $props();

  let conflictsOpen = $state(false);

  const LOCKED_NOTE: Record<Exclude<HouseRuleMode, "writer_choice">, string> = {
    enforced: "Set by your organization: the house rule always applies",
    off: "Set by your organization: the house rule is off",
  };

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
  {#each WRITING_AREAS as area (area.key)}
    {@const category = categories?.[area.key]}
    {@const mode = modes[area.key]}
    <div data-coverage-row={area.key} data-covered={category?.addressed ? "true" : "false"} data-mode={mode} class="flex gap-2.5 border-b border-line-soft py-2.5">
      {#if category?.addressed}
        <span aria-hidden="true" data-covered-tick class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-settings-covered text-fir"><IconCheck size={11} strokeWidth={3.2} /></span>
      {:else}
        <span aria-hidden="true" class="h-5 w-5 shrink-0 rounded-full border-[1.5px] border-dashed border-gray-300"></span>
      {/if}
      <div class="flex min-w-0 flex-col gap-px">
        <span class="flex items-center gap-1.5">
          <span class={`text-[0.8125rem] leading-[1.125rem] font-medium ${category?.addressed ? "text-ink" : "text-ink-muted"}`}>{area.label}</span>
          <AreaInfo {area} {mode} />
        </span>
        {#if category?.addressed}
          {#if category.evidence}<span class="text-xs leading-4 text-ink-muted [overflow-wrap:anywhere]">"{short(category.evidence)}"</span>{/if}
        {:else}
          <span data-coverage-status class="text-xs leading-4 text-ink-muted">{unchecked && !category ? "Not checked yet" : "Not in your instructions"}</span>
        {/if}
        {#if mode !== "writer_choice"}
          <span data-coverage-locked class="flex items-center gap-[0.3125rem] text-xs leading-4 text-ink-muted">
            <IconLock size={11} strokeWidth={2.2} />{LOCKED_NOTE[mode]}
          </span>
        {/if}
      </div>
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
