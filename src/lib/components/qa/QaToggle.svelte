<!--
  QA toggle in the panel toolbar (ui-design-final.md sections 2 and 7; boards
  2.2, 4.4, 4.5). Shield plus state:
  - idle: shield only;
  - running: gray-50 fill and a small Aurora spinner, no tooltip or popover;
  - done: the band chip, always coloured, plus a pink dot until QA is opened.
  Active: 26px tile, #E9F1EF fill (workspace-rail-selected), fir icon.
-->
<script lang="ts">
  import AuroraMark from "$lib/components/ui/AuroraMark.svelte";
  import { qaBandColors } from "$lib/qa/qaBands";

  let {
    state = "idle",
    score = null,
    unseen = false,
    active = false,
    disabled = false,
    onToggle,
  }: {
    state?: "idle" | "running" | "done";
    score?: number | null;
    /** A finished result the writer has not opened yet. */
    unseen?: boolean;
    /** The QA panel is open. */
    active?: boolean;
    disabled?: boolean;
    onToggle: () => void;
  } = $props();

  const shownScore = $derived(
    state === "done" && typeof score === "number" && Number.isFinite(score) ? Math.round(score) : null
  );
  const colors = $derived(shownScore === null ? null : qaBandColors(shownScore));
  const showDot = $derived(state === "done" && unseen);

  const label = $derived.by(() => {
    if (state === "running") return "QA, checking the draft";
    if (shownScore !== null) return `QA score ${shownScore}${showDot ? ", new result" : ""}`;
    return "QA";
  });

  const fill = $derived(
    active ? "bg-workspace-rail-selected" : state === "running" ? "bg-gray-50" : "hover:bg-primary-wash"
  );
</script>

<button
  type="button"
  aria-label={label}
  aria-pressed={active}
  {disabled}
  data-qa-toggle
  data-qa-state={state}
  data-active={active ? "true" : "false"}
  onclick={() => onToggle()}
  class={`relative flex h-[26px] min-w-[26px] shrink-0 items-center justify-center gap-1 rounded-md px-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none ${fill}`}
>
  <svg
    viewBox="0 0 24 24"
    width="16"
    height="16"
    fill="none"
    stroke="currentColor"
    stroke-width="1.7"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    class={active ? "text-fir" : "text-ink-secondary"}
    data-qa-shield
  >
    <path
      d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
    />
  </svg>
  {#if state === "running"}
    <AuroraMark size={12} glyph="spinner" />
  {:else if shownScore !== null && colors}
    <span
      data-qa-chip
      class="flex h-[18px] min-w-5 items-center justify-center rounded-full px-[5px] text-[11px] font-medium leading-[14px] tabular-nums"
      style={`background:${colors.chipBg};color:${colors.chipText}`}
    >{shownScore}</span>
  {/if}
  {#if showDot}
    <span
      data-qa-unseen-dot
      aria-hidden="true"
      class="absolute -right-0.5 -top-0.5 size-2 rounded-full border-2 border-surface bg-[#E879F9]"
    ></span>
  {/if}
</button>
