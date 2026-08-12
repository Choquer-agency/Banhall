<!--
  Ghost chip single-select popover (2026-08-10, owner direction) — the
  reusable panel anatomy introduced by the board Filters popover, built on
  the bits-ui Popover primitive (primitive-first direction): a borderless
  Obvious-style chip trigger with a flip chevron, opening a compact panel —
  small faint heading, 13px rounded-md options, active option on the chrome
  wash. Used for the projects grouping control; reach for this for any
  chip-triggered single choice that should read like the Filters popover.

  Motion: shadcn-style pop via panelMotion.ts (fade + zoom from 95% + slight
  slide, box-shadow concurrent). Reduced motion falls back to a fade.
-->
<script lang="ts">
  import { Popover } from "bits-ui";
  import type { Snippet } from "svelte";
  import { popIn, popOut } from "$lib/motion/panelMotion";

  let {
    value = $bindable(""),
    items,
    ariaLabel,
    label,
    class: className = "",
    icon,
    chip,
    align = "start",
    onValueChange,
  }: {
    value?: string;
    items: readonly { value: string; label: string }[];
    /** Accessible name for the trigger button and the option list. */
    ariaLabel: string;
    /** Small faint heading inside the panel (e.g. "Group by"). */
    label?: string;
    class?: string;
    /** Optional leading glyph inside the chip (e.g. the filter-lines icon). */
    icon?: Snippet;
    /**
     * Optional chip content override so the trigger can read as a labeled
     * control ("Group · Client") instead of echoing the raw option label.
     * Falls back to the selected item's label.
     */
    chip?: Snippet;
    /** Panel alignment along the trigger edge — "end" opens leftward. */
    align?: "start" | "end";
    onValueChange?: (value: string) => void;
  } = $props();

  let open = $state(false);
  const selectedLabel = $derived(items.find((item) => item.value === value)?.label ?? "");

  function pick(next: string) {
    value = next;
    onValueChange?.(next);
    open = false;
  }
</script>

<Popover.Root bind:open>
  <Popover.Trigger
    data-ghost-select
    aria-label={ariaLabel}
    class={`group inline-flex h-11 min-w-0 cursor-pointer items-center gap-1.5 rounded-full bg-transparent px-3 text-xs font-medium text-ink-secondary transition-colors select-none hover:bg-chrome/70 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy motion-reduce:transition-none sm:h-7 ${className}`}
  >
    {#if icon}{@render icon()}{/if}
    {#if chip}{@render chip()}{:else}<span class="truncate">{selectedLabel}</span>{/if}
    <svg
      class="h-3.5 w-3.5 shrink-0 text-ink-faint transition-transform duration-300 [transition-timing-function:cubic-bezier(0.34,1.56,0.64,1)] group-data-[state=open]:rotate-180 motion-reduce:transition-none"
      fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true"
    ><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" /></svg>
  </Popover.Trigger>
  <Popover.Portal>
    <Popover.Content forceMount side="bottom" {align} sideOffset={6}>
      {#snippet child({ props, wrapperProps, open: contentOpen })}
        <div {...wrapperProps}>
          {#if contentOpen}
            <div
              {...props}
              in:popIn
              out:popOut
              class="z-[100] min-w-44 overflow-hidden rounded-xl border border-line bg-surface shadow-md outline-none"
            >
              {#if label}
                <p class="px-3 pb-0.5 pt-2 text-[11px] font-medium text-ink-faint">{label}</p>
              {/if}
              <div class={`max-h-72 overflow-y-auto px-1.5 pb-1.5 ${label ? "" : "pt-1.5"}`} role="listbox" aria-label={ariaLabel}>
                {#each items as item (item.value)}
                  {@const active = item.value === value}
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    class={`w-full cursor-pointer truncate rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors motion-reduce:transition-none pointer-coarse:min-h-11 ${active ? "bg-chrome text-ink" : "text-ink-secondary hover:bg-chrome/60 hover:text-ink"}`}
                    onclick={() => pick(item.value)}
                  >
                    {item.label}
                  </button>
                {/each}
              </div>
            </div>
          {/if}
        </div>
      {/snippet}
    </Popover.Content>
  </Popover.Portal>
</Popover.Root>
