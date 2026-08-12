<script lang="ts">
  import type { Snippet } from "svelte";

  /**
   * The light half of the app bar — fused directly below AppNav (no gap),
   * sticking with it. Left: back button. Right: optional page actions
   * (e.g. the report workspace's Share / History / Export / Financial).
   * `width` must match the page's <main> / AppNav width.
   */
  let {
    backHref = "/dashboard",
    backLabel = "Back",
    width = "max-w-[var(--container-shell)]",
    leading,
    center,
    actions,
  }: {
    backHref?: string;
    backLabel?: string;
    width?: string;
    /** Optional stable page control rendered beside Back. */
    leading?: Snippet;
    /** Optional content centered in the bar (absolute, doesn't shift sides). */
    center?: Snippet;
    actions?: Snippet;
  } = $props();

  // Transparent at the top; solid white once the bar is "stuck". Stuckness is
  // measured live: the sentinel sits in normal flow where the bar would be —
  // once the bar pins under the nav, the gap between them equals the scrolled
  // distance. No mount-time baseline (HMR/remount/scroll-restore safe), and
  // the capture-phase listener sees window AND inner-container scrolls.
  let scrolled = $state(false);
  let sentinel: HTMLElement | null = $state(null);
  let barEl: HTMLElement | null = $state(null);
  $effect(() => {
    const s = sentinel;
    const b = barEl;
    if (!s || !b) return;
    // Two ways a page scrolls under the bar:
    //  1. normal pages — the document scrolls, the sticky bar separates from
    //     its in-flow sentinel (gap = scrolled distance);
    //  2. workspace pages (h-screen) — an inner pane scrolls while the bar
    //     stays put, so we read the scrolling element itself (capture-phase
    //     listener hands it to us as e.target).
    let paneTop = 0;
    const measure = (e?: Event) => {
      const t = e?.target;
      if (t instanceof Element && t !== document.documentElement) {
        paneTop = t.scrollTop;
      }
      const gap =
        b.getBoundingClientRect().top - s.getBoundingClientRect().top;
      // 28px before the surface turns solid (ScrollTrigger `top+=28` feel).
      scrolled = gap > 28 || paneTop > 28;
    };
    document.addEventListener("scroll", measure, { capture: true, passive: true });
    window.addEventListener("resize", measure, { passive: true });
    measure();
    return () => {
      document.removeEventListener("scroll", measure, { capture: true });
      window.removeEventListener("resize", measure);
    };
  });
</script>

<div bind:this={sentinel} aria-hidden="true" class="h-px w-full"></div>
<!-- top-[54px] = AppNav h-13 (52px) + 2px baseline rule; travels with the nav.
     The surface caps at the global rail width — canvas shows beyond it. -->
<div bind:this={barEl} class="sticky top-[54px] z-40 -mt-px w-full">
  <div
    class={`relative mx-auto flex h-11 w-full items-center justify-between gap-2 rounded-b-xl border-x border-b px-3 transition-colors duration-300 sm:gap-3 sm:px-6 ${
      scrolled ? "border-line-soft bg-white" : "border-transparent bg-transparent"
    } ${width}`}
  >
    {#if center}
      <div class="pointer-events-none absolute inset-x-0 top-1/2 hidden -translate-y-1/2 justify-center sm:flex">
        <div class="pointer-events-auto">
          {@render center()}
        </div>
      </div>
    {/if}
    <div class="flex min-w-0 shrink items-center">
      <a
        href={backHref}
        class="flex h-11 min-h-11 shrink-0 items-center gap-1.5 px-2 text-xs font-medium text-navy transition-colors hover:text-primary-selected sm:-ml-3 sm:px-3"
      >
        <svg aria-hidden="true" class="h-4 w-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
        </svg>
        <span class="whitespace-nowrap">{backLabel}</span>
      </a>
      {#if leading}
        <span aria-hidden="true" class="mx-1 h-5 w-px flex-none bg-line-soft"></span>
        <div class="min-w-0 max-w-[8.5rem] overflow-hidden sm:max-w-none">
          {@render leading()}
        </div>
      {/if}
    </div>

    {#if actions}
      <div class="flex min-w-0 flex-1 items-center justify-end gap-0 overflow-x-auto sm:-mr-3 sm:flex-initial sm:flex-shrink-0 sm:gap-1 sm:overflow-visible">
        {@render actions()}
      </div>
    {/if}
  </div>
</div>
