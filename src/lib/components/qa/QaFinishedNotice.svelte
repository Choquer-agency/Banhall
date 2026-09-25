<!--
  "QA finished" notification (ui-design-final.md section 7, board 4.5): 340px,
  radius 14, no icon. Stays until the writer opens QA or dismisses it. The host
  places it (bottom right of the report panel) and records the seen state
  (src/lib/qa/qaSeen.ts).
-->
<script lang="ts">
  import { onDestroy } from "svelte";
  import Button from "$lib/components/ui/Button.svelte";
  import { qaBandColors } from "$lib/qa/qaBands";
  import { qaFinishedAgo, type QaSectionScoreRow } from "$lib/qa/qaSectionScores";

  let {
    overallScore,
    sections,
    completedAt = null,
    now,
    onOpen,
    onLater,
    onDismiss,
  }: {
    overallScore: number;
    /** From `qaSectionScores(agentOutputs)`. */
    sections: QaSectionScoreRow[];
    /** `postQaCompletedAt`; drives "Just now" / "5 minutes ago". */
    completedAt?: number | null;
    /** Fixed clock for tests; the notice ticks every 30s without it. */
    now?: number;
    onOpen: () => void;
    /** "Later": hides the notice, keeps the unseen dot. Falls back to onDismiss. */
    onLater?: () => void;
    /** Close (x). */
    onDismiss: () => void;
  } = $props();

  const uid = $props.id();
  const titleId = `qa-finished-title-${uid}`;

  let tick = $state(Date.now());
  const interval = setInterval(() => (tick = Date.now()), 30_000);
  onDestroy(() => clearInterval(interval));

  const overall = $derived(Math.round(overallScore));
  const overallColors = $derived(qaBandColors(overall));
  const ago = $derived(qaFinishedAgo(completedAt, now ?? tick));
</script>

<section
  aria-labelledby={titleId}
  aria-live="polite"
  data-qa-finished-notice
  class="flex w-[340px] max-w-full flex-col overflow-hidden rounded-[14px] border border-line bg-surface shadow-[0_16px_40px_#16211F1F]"
>
  <header class="flex items-center gap-2 border-b border-line-soft py-2.5 pl-5 pr-3">
    <div class="flex min-w-0 flex-1 flex-col gap-0.5">
      <h2 id={titleId} class="text-sm font-medium leading-[18px] text-ink">QA finished</h2>
      <p class="text-xs leading-[18px] text-ink-muted" data-qa-finished-time>{ago}</p>
    </div>
    <span
      data-qa-overall-chip
      aria-label={`Overall score ${overall}`}
      class="flex h-[22px] shrink-0 items-center justify-center rounded-full px-1.5 text-xs font-medium tabular-nums"
      style={`background:${overallColors.chipBg};color:${overallColors.chipText}`}
    >{overall}</span>
    <button
      type="button"
      aria-label="Dismiss QA result"
      data-qa-finished-close
      onclick={() => onDismiss()}
      class="flex size-7 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-primary-wash hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary motion-reduce:transition-none"
    >
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
        <path d="M18 6 6 18M6 6l12 12" />
      </svg>
    </button>
  </header>

  <div class="flex flex-col gap-4 px-5 pb-[18px] pt-4">
    {#if sections.length > 0}
      <ul class="flex flex-col gap-2.5" aria-label="Section scores">
        {#each sections as section (section.key)}
          {@const colors = qaBandColors(section.score)}
          <li class="flex items-center gap-2.5" data-qa-section-row={section.number}>
            <span class="w-6 shrink-0 font-mono text-[11px] leading-4 text-ink-muted">{section.number}</span>
            <span class="min-w-0 truncate text-[13px] leading-[18px] text-ink-secondary">{section.name}</span>
            <span class="flex-1"></span>
            <span class="flex h-[3px] w-16 shrink-0 overflow-hidden rounded-full bg-line-soft" aria-hidden="true">
              <span
                data-qa-section-bar
                class="h-[3px] rounded-full"
                style={`width:${Math.max(0, Math.min(100, section.score))}%;background:${colors.bar}`}
              ></span>
            </span>
            <span class="min-w-[18px] shrink-0 text-right text-[13px] font-medium leading-[18px] tabular-nums text-ink">{section.score}</span>
          </li>
        {/each}
      </ul>
    {/if}
    <div class="flex justify-end gap-2">
      <!-- Board 4.5: 32px buttons, 14px sides, 13px labels. -->
      <Button variant="secondary" size="xs" class="px-3.5!" onclick={() => (onLater ?? onDismiss)()} data-qa-later>
        Later
      </Button>
      <Button variant="primary" size="xs" class="px-3.5!" onclick={() => onOpen()} data-qa-open>
        Open QA
      </Button>
    </div>
  </div>
</section>
