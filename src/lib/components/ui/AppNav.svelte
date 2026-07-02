<script lang="ts">
  import type { Snippet } from "svelte";
  import BuildStamp from "$lib/components/BuildStamp.svelte";

  /**
   * The app bar (design system: docs/design-system.md). One nav for every
   * standard page — full-width fir bar whose inner container shares the
   * page's content width, a pill-marked breadcrumb trail from the logo, and
   * the teal baseline rule as the single accent. Workspace pages (project
   * editor) keep their dense custom headers but share the same tokens.
   */
  let {
    breadcrumbs = [],
    actions,
    width = "max-w-7xl",
    home = "label",
  }: {
    /** Trail after the logo. Last item renders as the current-page pill. */
    breadcrumbs?: { label: string; href?: string }[];
    /** Right side: page actions, user, sign out. */
    actions?: Snippet;
    /** Tailwind max-width class — pass the SAME one the page's <main> uses. */
    width?: string;
    /** "label" = logo + Dashboard text · "icon" = logo + home glyph (workspaces). */
    home?: "label" | "icon";
  } = $props();
</script>

<header class="sticky top-0 z-50 w-full">
  <nav class="w-full bg-navy">
    <div class={`mx-auto flex h-13 w-full items-center gap-2.5 px-6 ${width}`}>
      <a href="/dashboard" class="group flex flex-shrink-0 items-center gap-2.5" aria-label="Banhall dashboard">
        <img src="/logo.png" alt="" width="84" height="84" class="-my-5 brightness-0 invert" />
        {#if home === "icon"}
          <svg class="h-4 w-4 text-white/55 transition-colors group-hover:text-white/90" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M3 12l9-9 9 9M5 10v10a1 1 0 001 1h3a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1h3a1 1 0 001-1V10" />
          </svg>
        {:else}
          <span class={`text-sm transition-colors ${breadcrumbs.length ? "text-white/55 group-hover:text-white/90" : "font-medium text-white"}`}>
            Dashboard
          </span>
        {/if}
      </a>

      {#each breadcrumbs as crumb, i (i)}
        <svg class="h-3.5 w-3.5 flex-shrink-0 text-white/35" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        {#if i < breadcrumbs.length - 1}
          <a href={crumb.href ?? "#"} class="min-w-0 truncate text-sm text-white/55 transition-colors hover:text-white/90">
            {crumb.label}
          </a>
        {:else}
          <span class="min-w-0 truncate rounded-md bg-white/12 px-2.5 py-1 text-sm font-medium text-white">
            {crumb.label}
          </span>
        {/if}
      {/each}

      <div class="ml-auto flex flex-shrink-0 items-center gap-4">
        <BuildStamp class="hidden text-white/40 xl:inline-flex" />
        {@render actions?.()}
      </div>
    </div>
  </nav>
  <div class="nav-baseline h-0.5 w-full"></div>
</header>
