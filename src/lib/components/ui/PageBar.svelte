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
    width = "max-w-7xl",
    actions,
  }: {
    backHref?: string;
    backLabel?: string;
    width?: string;
    actions?: Snippet;
  } = $props();

  // Transparent while at the top; solid white once the bar is "stuck".
  // Measured directly: the sentinel rests just under the 54px sticky nav and
  // moves up as soon as anything scrolls. Capture-phase listener sees scrolls
  // from the window AND any inner container (scroll doesn't bubble, but it
  // does capture through document).
  let scrolled = $state(false);
  let sentinel: HTMLElement | null = $state(null);
  $effect(() => {
    const el = sentinel;
    if (!el) return;
    const rest = el.getBoundingClientRect().top; // measured, not assumed
    // 28px of scroll before the surface turns solid (ScrollTrigger
    // `top+=28 top` feel), hysteresis-free since it's a hard threshold.
    const measure = () =>
      (scrolled = el.getBoundingClientRect().top < rest - 28);
    document.addEventListener("scroll", measure, { capture: true, passive: true });
    measure();
    return () =>
      document.removeEventListener("scroll", measure, { capture: true });
  });
</script>

<div bind:this={sentinel} aria-hidden="true" class="h-px w-full"></div>
<!-- top-[54px] = AppNav h-13 (52px) + 2px baseline rule; travels with the nav.
     The surface caps at the global rail width — canvas shows beyond it. -->
<div class="sticky top-[54px] z-40 -mt-px w-full">
  <div
    class={`mx-auto flex h-11 w-full items-center justify-between gap-3 rounded-b-xl border-x border-b px-6 transition-colors duration-300 ${
      scrolled ? "border-line-soft bg-white" : "border-transparent bg-transparent"
    } ${width}`}
  >
    <a
      href={backHref}
      class="-ml-3 flex h-9 items-center gap-1.5 px-3 text-xs font-medium text-navy transition-colors hover:text-primary"
    >
      <svg class="h-4 w-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
      </svg>
      <span class="whitespace-nowrap">{backLabel}</span>
    </a>

    {#if actions}
      <div class="-mr-3 flex flex-shrink-0 items-center gap-1">
        {@render actions()}
      </div>
    {/if}
  </div>
</div>
