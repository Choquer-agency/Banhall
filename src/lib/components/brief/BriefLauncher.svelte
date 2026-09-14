<script lang="ts">
  import { scale } from "svelte/transition";
  import Tooltip from "$lib/components/ui/Tooltip.svelte";

  /**
   * Story 4: the Brief launcher pill, cloned from qa/QALauncher. `right`
   * animates so the pill steps into the slot a closed panel's pill leaves.
   */
  let {
    onOpen,
    right = "1.5rem",
    bottom = "1.5rem",
  }: {
    onOpen: () => void;
    /** CSS `right` offset — animated by the parent's layout state. */
    right?: string;
    /** CSS `bottom` offset. */
    bottom?: string;
  } = $props();
</script>

<Tooltip text="Open Brief" side="left" delayDuration={300}>
  {#snippet children({ props })}
    <button
      {...props}
      in:scale={{ duration: 200, start: 0.6, delay: 240 }}
      out:scale={{ duration: 150, start: 0.6 }}
      onclick={onOpen}
      aria-label="Open Brief"
      style={`right: ${right}; bottom: ${bottom}`}
      class="chat-pill-glow fixed z-[70] flex h-11 w-11 items-center justify-center rounded-full bg-primary-selected text-white transition-[right,transform] duration-300 hover:scale-105"
    >
      <svg class="h-4.5 w-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    </button>
  {/snippet}
</Tooltip>
