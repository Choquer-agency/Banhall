<script lang="ts">
  import type { Snippet } from "svelte";
  import { cn } from "$lib/utils";

  let {
    breadcrumb,
    actions,
    scrollContainer = null,
  }: {
    /** Content rendered on the left after the logo/dashboard link */
    breadcrumb?: Snippet;
    /** Content rendered on the right side */
    actions?: Snippet;
    /** Optional scroll container element — when provided, listens there instead of window */
    scrollContainer?: HTMLElement | null;
  } = $props();

  let scrolled = $state(false);

  $effect(() => {
    const el = scrollContainer;
    const onScroll = () =>
      (scrolled = (el ? el.scrollTop : window.scrollY) > 10);
    const target: HTMLElement | Window = el ?? window;
    target.addEventListener("scroll", onScroll);
    onScroll();
    return () => target.removeEventListener("scroll", onScroll);
  });
</script>

<header
  class={cn(
    "sticky top-0 z-50 w-full transition-all duration-300 ease-out",
    scrolled ? "bg-navy/95 shadow-lg shadow-navy/20 backdrop-blur-lg" : "bg-navy"
  )}
>
  <nav
    class={cn(
      "mx-auto flex h-14 w-full items-center justify-between px-6 transition-all duration-300 ease-out md:h-12",
      scrolled && "max-w-6xl px-4"
    )}
  >
    <div class="flex min-w-0 items-center gap-3">
      <a href="/dashboard" class="flex flex-shrink-0 items-center gap-2">
        <img
          src="/logo.png"
          alt="Banhall"
          width="77"
          height="77"
          class="-my-4 brightness-0 invert"
        />
        <span class="text-sm text-white/60 transition-colors hover:text-white/80">
          Dashboard
        </span>
      </a>
      {#if breadcrumb}
        <svg class="h-3 w-3 flex-shrink-0 text-white/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        {@render breadcrumb()}
      {/if}
    </div>

    {#if actions}
      <div class="flex flex-shrink-0 items-center gap-2">
        {@render actions()}
      </div>
    {/if}
  </nav>
</header>
