<script lang="ts">
  import { scale } from "svelte/transition";

  /**
   * The QA launcher pill (BNH-47) — brand-primary shield, same breathe glow
   * as the assistant pill. `right` animates so the pill slides into the
   * corner slot when the assistant pill leaves it (chat open) and back out
   * when it returns.
   */
  let {
    onOpen,
    right = "1.5rem",
  }: {
    onOpen: () => void;
    /** CSS `right` offset — animated by the parent's layout state. */
    right?: string;
  } = $props();
</script>

<button
  in:scale={{ duration: 200, start: 0.6, delay: 240 }}
  out:scale={{ duration: 150, start: 0.6 }}
  onclick={onOpen}
  title="Open QA review"
  aria-label="Open QA review"
  style={`right: ${right}`}
  class="chat-pill-glow fixed bottom-6 z-[70] flex h-11 w-11 items-center justify-center rounded-full bg-primary text-white transition-[right,transform] duration-300 hover:scale-105"
>
  <svg class="h-4.5 w-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
    <path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
  </svg>
</button>
