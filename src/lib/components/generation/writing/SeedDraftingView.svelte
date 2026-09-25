<!--
  Writing view for a signed-off Step-by-step plan (ui-design-final.md section 6,
  boards 4.1 grey skeleton, 4.2 Aurora skeleton, 4.3 corner ring).

  Presentational: the host feeds `getSeedDraftProgress` and wires Stop to the
  confirmation dialog (StopDraftingDialog). Key this component by generation
  id in the host so the forward-only percent starts fresh for a new run.
-->
<script lang="ts">
  import AuroraMark from "$lib/components/ui/AuroraMark.svelte";
  import {
    clampPercent,
    orderedSections,
    pillHeadline,
    progressText,
    revealDelayMs,
  } from "./draftProgress";
  import type { SeedDraftProgress, SkeletonStyle } from "./types";

  let {
    progress,
    reportTitle,
    skeletonStyle = "grey",
    onStop,
    stopDisabled = false,
    scrollContainer = null,
    collapseAfterPx = 24,
    ringClass = "fixed bottom-7 right-7",
    headingId = undefined,
  }: {
    progress: SeedDraftProgress;
    reportTitle: string;
    /** Grey is the default; "aurora" is the test flag (board 4.2). Never mixed. */
    skeletonStyle?: SkeletonStyle;
    /** Opens the Stop confirmation; the view never stops on its own. */
    onStop?: () => void;
    stopDisabled?: boolean;
    /** The element that scrolls the report. Falls back to the window. */
    scrollContainer?: HTMLElement | null;
    /** Scroll distance before a downward scroll collapses the pill. */
    collapseAfterPx?: number;
    /** Where the collapsed ring sits (28px from the report panel corner, board 4.3); the host may re-anchor it. */
    ringClass?: string;
    /** DOM id for the report title heading, the host's focus destination. */
    headingId?: string;
  } = $props();

  // Forward-only percent (acceptance: "a border fill that only moves forward").
  // A plain variable, not state: it is a memo of the highest value seen.
  let highestPercent = 0;
  const percent = $derived.by(() => {
    highestPercent = Math.max(highestPercent, clampPercent(progress.percent));
    return highestPercent;
  });

  const headline = $derived(pillHeadline(progress));
  const live = $derived(progress.phase === "drafting" || progress.phase === "stopping");
  const detail = $derived(progressText(percent, progress.estimatedRemainingMs));
  const sections = $derived(orderedSections(progress.sections));
  const aurora = $derived(skeletonStyle === "aurora");

  // Reading mode (4.3): a downward scroll past the threshold collapses the pill
  // into the corner ring; any upward scroll, or hovering the ring, reopens it.
  let collapsed = $state(false);
  let pillElement = $state<HTMLElement | null>(null);

  $effect(() => {
    if (!live) {
      collapsed = false;
      return;
    }
    const container = scrollContainer;
    const target: HTMLElement | Window | null =
      container ?? (typeof window === "undefined" ? null : window);
    if (!target) return;
    const read = () => (container ? container.scrollTop : window.scrollY);
    let last = read();
    const threshold = collapseAfterPx;
    const onScroll = () => {
      const top = read();
      if (top <= threshold) collapsed = false;
      else if (top > last) collapsed = true;
      else if (top < last) collapsed = false;
      last = top;
    };
    target.addEventListener("scroll", onScroll, { passive: true });
    return () => target.removeEventListener("scroll", onScroll);
  });

  function reopen(moveFocus = false) {
    collapsed = false;
    if (moveFocus) queueMicrotask(() => pillElement?.focus({ preventScroll: true }));
  }

  const TRACK = "var(--aurora-track)";
  const ringBackground = $derived(
    `conic-gradient(from 0deg, #2FD2C4 0%, #58BBF3 ${percent * 0.35}%, #8438FF ${percent * 0.72}%, #E879F9 ${percent}%, ${TRACK} ${percent}%, ${TRACK} 100%)`
  );

  // Skeleton widths follow the boards (760px column): 4 writing lines, 3 queued.
  const WRITING_LINES = ["100%", "96%", "98.5%", "71%"];
  const QUEUED_LINES = ["92%", "84%", "60%"];
  const writingLineBackground = $derived(
    aurora
      ? "linear-gradient(90deg, #2FD2C433 0%, #58BBF333 29%, #E879F933 61%, #8438FF2E 100%)"
      : "var(--skeleton-line)"
  );
  const writingBand = $derived(
    aurora
      ? "linear-gradient(90deg, transparent 29%, #8438FF6B 45%, transparent 61%)"
      : "linear-gradient(90deg, transparent 29%, rgba(255, 255, 255, 0.7) 45%, transparent 61%)"
  );
  const queuedLineBackground = $derived(
    aurora ? "linear-gradient(90deg, #2FD2C424, #8438FF24)" : "var(--color-line-soft)"
  );
</script>

<div
  class="relative flex w-full flex-col items-center gap-5"
  data-seed-drafting-view
  data-phase={progress.phase}
  data-skeleton-style={skeletonStyle}
>
  {#if live}
    <div class="sticky top-6 z-10 flex justify-center">
      <div
        bind:this={pillElement}
        tabindex="-1"
        data-writing-pill
        data-collapsed={collapsed ? "true" : "false"}
        inert={collapsed}
        aria-hidden={collapsed ? "true" : undefined}
        class={`relative overflow-hidden rounded-full p-[2px] outline-none transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none ${
          collapsed ? "pointer-events-none -translate-y-2 opacity-0" : "translate-y-0 opacity-100"
        }`}
        style={`background:${TRACK};box-shadow:0 8px 24px #16211F14, 0 0 14px #8438FF29`}
      >
        <!-- Border progress: the Aurora fill scales from the left edge. -->
        <span
          data-pill-progress
          role="progressbar"
          aria-label="Draft progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-valuetext={detail}
          class="absolute inset-0 origin-left transition-transform duration-500 ease-out motion-reduce:transition-none"
          style={`background:var(--aurora-linear);transform:scaleX(${percent / 100})`}
        ></span>
        <!-- Glint travelling to the leading edge. -->
        <span
          aria-hidden="true"
          class="absolute inset-0 transition-transform duration-500 ease-out motion-reduce:transition-none"
          style={`transform:translateX(${percent - 100}%)`}
        >
          <span class="absolute inset-y-0 right-0 w-12 overflow-hidden">
            <span
              data-pill-glint
              class="aurora-glint block h-full w-full"
              style="background:linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.95))"
            ></span>
          </span>
        </span>
        <div class="relative flex h-[42px] items-center gap-3 rounded-full bg-surface pl-3 pr-[5px]">
          <AuroraMark size={22} />
          <span class="text-sm font-medium leading-[18px] text-ink" aria-live="polite" data-pill-headline>{headline}</span>
          <span class="text-[13px] leading-[18px] text-ink-muted" data-pill-detail>{detail}</span>
          {#if progress.phase === "drafting" && onStop}
            <button
              type="button"
              data-pill-stop
              disabled={stopDisabled}
              onclick={() => onStop?.()}
              class="h-[30px] rounded-full bg-chrome px-3 text-xs font-medium text-ink transition-colors hover:bg-primary-wash focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none"
            >
              Stop
            </button>
          {:else}
            <span class="w-[7px]" aria-hidden="true"></span>
          {/if}
        </div>
      </div>
    </div>

    <!-- Corner ring (4.3): white inside, Aurora mark, conic progress border. -->
    <button
      type="button"
      data-writing-ring
      data-open={collapsed ? "true" : "false"}
      inert={!collapsed}
      aria-hidden={collapsed ? undefined : "true"}
      aria-label={`${headline ?? "Writing"}, ${detail}. Show progress`}
      onpointerenter={() => reopen()}
      onclick={() => reopen(true)}
      class={`${ringClass} z-20 rounded-full p-[3px] transition-[opacity,transform] duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary motion-reduce:transition-none ${
        collapsed ? "scale-100 opacity-100" : "pointer-events-none scale-90 opacity-0"
      }`}
      style={`background:${ringBackground};box-shadow:0 6px 18px #16211F1F`}
    >
      <span class="flex h-[42px] w-[42px] items-center justify-center rounded-full bg-surface">
        <AuroraMark size={24} />
      </span>
    </button>
  {/if}

  <article class="flex w-full max-w-[760px] flex-col gap-[22px] pt-2" data-drafting-report>
    <!-- The page's single h1 is the top bar title; the draft's title is h2. -->
    <h2 id={headingId} tabindex="-1" class="font-serif text-[30px] font-normal leading-[36px] text-ink outline-none">{reportTitle}</h2>

    {#each sections as section (section.key)}
      {@const queued = section.status === "queued"}
      <section
        class={`flex flex-col gap-2.5 ${queued ? "opacity-45" : ""}`}
        data-section-key={section.key}
        data-section-status={section.status}
        aria-busy={section.status === "writing" || queued ? "true" : undefined}
      >
        <header class="flex flex-col gap-1">
          <p class="flex items-center gap-2 text-xs leading-4 text-ink-muted">
            <span>{section.number} {section.title}</span>
            {#if section.status === "not_drafted"}
              <span
                data-not-drafted-marker
                class="rounded-full border border-dashed border-line px-2 py-px text-[11px] leading-4 text-ink-muted"
              >Not drafted</span>
            {/if}
          </p>
          <h3 class="font-serif text-xl font-normal leading-[26px] text-ink">{section.question}</h3>
        </header>

        {#if section.status === "done"}
          <div class="flex flex-col gap-3">
            {#each section.paragraphs as paragraph, index (index)}
              <p
                class="fade-rise font-serif text-base leading-[26px] text-ink"
                style={`animation-delay:${revealDelayMs(index)}ms`}
                data-revealed-paragraph
              >
                {paragraph}
              </p>
            {/each}
          </div>
        {:else if section.status === "writing"}
          <div class="flex flex-col gap-3 pb-1 pt-2" aria-hidden="true">
            {#each WRITING_LINES as width, index (index)}
              <span
                data-skeleton-line="writing"
                class="relative block h-2.5 overflow-hidden rounded-full"
                style={`width:${width};background:${writingLineBackground}`}
              >
                <span class="skeleton-shimmer absolute inset-0" style={`background:${writingBand}`}></span>
              </span>
            {/each}
          </div>
          <span class="sr-only">Writing this section</span>
        {:else if queued}
          <div class="flex flex-col gap-2.5 pt-1.5" aria-hidden="true">
            {#each QUEUED_LINES as width, index (index)}
              <span
                data-skeleton-line="queued"
                class="block h-2 rounded-full"
                style={`width:${width};background:${queuedLineBackground}`}
              ></span>
            {/each}
          </div>
          <span class="sr-only">Waiting to be written</span>
        {/if}
      </section>
    {/each}
  </article>
</div>
