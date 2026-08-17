<script lang="ts">
  // Design-system rule 7 chevron: right edge of the row, points DOWN closed
  // and UP open (rotate-180), turns primary-selected when open. Decorative —
  // the host trigger carries aria-expanded/aria-controls.
  let {
    open,
    tone = "primary",
    class: className = "",
  }: {
    open: boolean;
    /** Neutral is reserved for subordinate disclosures whose open state is
     * already carried by a contrasting surface fill. */
    tone?: "primary" | "neutral";
    class?: string;
  } = $props();
</script>

<svg
  data-disclosure-chevron
  class={`h-4 w-4 shrink-0 transition-transform duration-300 motion-reduce:transition-none ${open ? `rotate-180 ${tone === "neutral" ? "text-ink-secondary" : "text-primary-selected"}` : "text-ink-faint"} ${className}`}
  fill="none"
  viewBox="0 0 24 24"
  stroke="currentColor"
  stroke-width="2"
  aria-hidden="true"
>
  <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
</svg>
