<!--
  QA toggle for the panel toolbar (ui-design-final.md sections 2 and 7): the
  shield with the band-coloured score chip, a gray-50 fill and a small Aurora
  spinner while QA runs, and a pink dot until a finished result is opened.
  Same props as the shared `qa/QaToggle.svelte` so the host can swap it in.
-->
<script lang="ts">
  import { ShieldCheckIcon } from "phosphor-svelte";
  import AuroraMark from "$lib/components/ui/AuroraMark.svelte";
  import { qaBandColors } from "$lib/qa/qaBands";

  let {
    state: qaState = "idle",
    score = null,
    unseen = false,
    active = false,
    onToggle,
  }: {
    state?: "idle" | "running" | "done";
    score?: number | null;
    unseen?: boolean;
    active?: boolean;
    onToggle: () => void;
  } = $props();

  const colors = $derived(score === null ? null : qaBandColors(score));
  const label = $derived(
    qaState === "running"
      ? "QA review, checking the draft"
      : score !== null
        ? `QA review, score ${score}${unseen ? ", new result" : ""}`
        : "QA review"
  );
</script>

<button
  type="button"
  data-panel-toggle="qa"
  aria-pressed={active}
  aria-label={label}
  title="QA review"
  onclick={onToggle}
  class={`relative flex h-[26px] items-center gap-1.5 rounded-md px-1.5 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir pointer-coarse:h-11 ${active ? "bg-workspace-rail-selected text-fir" : qaState === "running" ? "bg-gray-50 text-ink-muted" : "text-ink-muted hover:bg-primary-wash hover:text-ink"}`}
>
  <ShieldCheckIcon size={16} aria-hidden="true" />
  {#if qaState === "running"}
    <AuroraMark size={12} glyph="spinner" />
  {:else if colors && score !== null}
    <span
      data-qa-score-chip
      class="rounded px-1 text-[11px] font-medium leading-4 tabular-nums"
      style={`background:${colors.chipBg};color:${colors.chipText}`}
    >{score}</span>
  {/if}
  {#if unseen && qaState === "done"}
    <span data-qa-unseen-dot aria-hidden="true" class="absolute -right-0.5 -top-0.5 size-1.5 rounded-full" style="background:#E879F9"></span>
  {/if}
</button>
