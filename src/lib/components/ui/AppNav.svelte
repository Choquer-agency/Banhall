<script lang="ts">
  import type { Snippet } from "svelte";
  import BuildStamp from "$lib/components/BuildStamp.svelte";

  /**
   * The app bar (design system: docs/design-system.md). One nav for every
   * standard page — full-width fir bar, breadcrumb trail from the logo, and
   * the teal baseline rule as the single accent. Workspace pages (project
   * editor) keep their dense custom headers but share the same tokens.
   */
  let {
    breadcrumbs = [],
    actions,
  }: {
    /** Trail after the logo. Last item renders as the current page. */
    breadcrumbs?: { label: string; href?: string }[];
    /** Right side: page actions, user, sign out. */
    actions?: Snippet;
  } = $props();
</script>

<header class="sticky top-0 z-50 w-full">
  <nav class="flex h-12 w-full items-center gap-3 bg-navy pl-4 pr-5">
    <a href="/dashboard" class="flex flex-shrink-0 items-center gap-2" aria-label="Banhall dashboard">
      <img src="/logo.png" alt="" width="64" height="64" class="-my-3 brightness-0 invert" />
      <span class="text-sm text-white/60 transition-colors hover:text-white/90">Dashboard</span>
    </a>

    {#each breadcrumbs as crumb, i (i)}
      <svg class="h-3 w-3 flex-shrink-0 text-white/25" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
      </svg>
      {#if crumb.href && i < breadcrumbs.length - 1}
        <a href={crumb.href} class="min-w-0 truncate text-sm text-white/60 transition-colors hover:text-white/90">
          {crumb.label}
        </a>
      {:else}
        <span class="min-w-0 truncate text-sm font-medium text-white">{crumb.label}</span>
      {/if}
    {/each}

    <div class="ml-auto flex flex-shrink-0 items-center gap-4">
      <BuildStamp class="hidden text-white/40 xl:inline-flex" />
      {@render actions?.()}
    </div>
  </nav>
  <div class="nav-baseline h-0.5 w-full"></div>
</header>
