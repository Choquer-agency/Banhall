<script lang="ts">
  // Horizontal Projects module for Home. Recent cards remain sourced ONLY
  // from browser-local `recentProjects` (no query, pins, or invented
  // metadata). The always-present first card is a plain navigation link to
  // the real repository, so an empty local history still leaves Home with a
  // useful continuation rather than a blank lower canvas.
  import { resolve } from "$app/paths";
  import { ArrowRightIcon, FolderSimpleIcon } from "phosphor-svelte";
  import StageBadge from "$lib/components/ui/StageBadge.svelte";
  import { formatOpenedRelative } from "$lib/mywork/relativeTime";
  import type { RecentProject } from "$lib/workspace/recentProjects";

  let {
    recents = [],
  }: {
    recents?: RecentProject[];
  } = $props();

  // Coarse phrasing — capturing "now" once per mount is precise enough.
  const now = Date.now();
</script>

<!-- Gutters match the hero section (16/24px); the inter-band break is kept
     laptop-friendly so the project continuation remains above the fold. -->
<section data-home-recents aria-label="Projects and recently opened projects" class="mt-8 px-4 pb-10 sm:mt-10 sm:px-6">
    <div class="flex flex-wrap items-baseline justify-between gap-2 border-b border-line pb-2.5">
      <div class="flex items-baseline gap-2">
        <!-- Home weight discipline (2026-08-10): max font-medium. -->
        <h2 class="text-base font-medium text-ink">Projects</h2>
        {#if recents.length > 0}
          <!-- Honest provenance: browser-local recency, not server truth. -->
          <span class="text-xs text-ink-muted">recently opened on this device</span>
        {/if}
      </div>
      <a href={resolve("/projects")} class="inline-flex min-h-8 items-center text-xs font-medium text-ink-muted hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy pointer-coarse:min-h-11">View all projects</a>
    </div>
    <div class="relative mt-3">
      <ul class="scrollbar-hidden flex snap-x gap-3 overflow-x-auto pb-1 pr-8" role="list" aria-label="Recently opened projects, horizontal list">
        <li class="w-64 shrink-0 snap-start sm:w-72">
          <a
            href={resolve("/projects")}
            class="group flex min-h-36 flex-col justify-between gap-3 rounded-xl border border-line bg-surface p-4 transition-[border-color,box-shadow] hover:border-gray-300 hover:shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy motion-reduce:transition-none"
          >
            <span class="flex items-center justify-between gap-3 text-xs text-ink-muted">
              <span class="flex items-center gap-1.5">
                <FolderSimpleIcon size={16} weight="regular" aria-hidden="true" />
                Repository
              </span>
              <ArrowRightIcon size={16} weight="regular" aria-hidden="true" class="transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" />
            </span>
            <span class="flex min-w-0 flex-col gap-1">
              <span class="text-base font-medium leading-snug text-ink">All projects</span>
              <span class="text-xs text-ink-muted">Browse by client, stage, owner, or saved view.</span>
            </span>
          </a>
        </li>
        {#each recents as recent (recent.id)}
          <li class="w-64 shrink-0 snap-start sm:w-72">
            <a
              href={resolve("/project/[id]", { id: recent.id })}
              data-recent-title={recent.title}
              data-recent-stage={recent.stage}
              data-recent-client={recent.client}
              class="group flex min-h-36 flex-col justify-between gap-3 rounded-xl border border-line bg-surface p-4 transition-[border-color,box-shadow] hover:border-gray-300 hover:shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy motion-reduce:transition-none"
            >
              <span class="flex items-center justify-between gap-3 text-xs text-ink-muted">
                {#if recent.stage}
                  <!-- Same compact rounded-square stage label the project
                       board's column headers use (2026-08-10). -->
                  <StageBadge stage={recent.stage} shape="square" />
                {:else}
                  <span class="flex items-center gap-1.5">
                    <svg class="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" /></svg>
                    Project
                  </span>
                {/if}
                <ArrowRightIcon size={16} weight="regular" aria-hidden="true" class="shrink-0 text-ink-faint transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" />
              </span>
              <span class="flex min-w-0 flex-col gap-1">
                <!-- Reserve two title lines so 1-line and 2-line cards match. -->
                <span class="line-clamp-2 min-h-[2.75em] text-base font-medium leading-snug text-ink">{recent.title}</span>
                {#if recent.client || recent.openedAt}
                  <span class="flex items-baseline justify-between gap-2 text-xs text-ink-muted">
                    <span class="min-w-0 truncate">{recent.client ?? ""}</span>
                    {#if recent.openedAt}
                      <span data-recent-opened class="shrink-0">{formatOpenedRelative(recent.openedAt, now)}</span>
                    {/if}
                  </span>
                {/if}
              </span>
            </a>
          </li>
        {/each}
      </ul>
    </div>
</section>
