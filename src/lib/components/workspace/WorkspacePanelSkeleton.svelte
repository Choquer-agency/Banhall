<script lang="ts" module>
  /** The page shapes a loading work panel can take. */
  export type PanelSkeletonLayout = "home" | "projects" | "form" | "page" | "project" | "companies" | "company";
  /** Content-only shapes for a page whose frame and heading are already drawn. */
  export type ContentSkeletonLayout = "fields" | "list" | "companies-table";
</script>

<script lang="ts">
  import { boardRem } from "$lib/rootScale";
  /**
   * A quiet skeleton of a round 2 work panel while a page loads: grey blocks
   * in the page's own layout (table rows for Home and Projects, label and
   * field rows for Settings, a heading and cards for other pages). No
   * spinner and no "Loading" text; screen readers get the label.
   */
  let {
    layout,
    label = "Loading workspace",
    class: className = "",
    ...rest
  }: {
    layout: PanelSkeletonLayout | ContentSkeletonLayout;
    label?: string;
    class?: string;
    [key: `data-${string}`]: string | undefined;
  } = $props();

  const bar = "block rounded bg-chrome";
</script>

<div
  {...rest}
  role="status"
  aria-label={label}
  data-panel-skeleton={layout}
  class={`flex min-h-0 flex-1 flex-col animate-pulse motion-reduce:animate-none ${className}`}
>
  {#if layout === "home"}
    <div class="flex flex-1 flex-col gap-10 px-4 pb-6 pt-1 sm:px-6 lg:px-8 xl:flex-row xl:gap-8">
      <div data-skeleton-table class="min-w-0 flex-1">
        <span class={`${bar} h-7 w-28 rounded-md`}></span>
        <div class="mt-4 border-t border-line">
          {#each [0.42, 0.36, 0.48, 0.3, 0.4] as width, index (index)}
            <div data-skeleton-row class="flex h-11 items-center gap-4 border-b border-line-soft px-2">
              <span class={`${bar} h-3`} style:width={`${width * 100}%`}></span>
              <span class="flex-1"></span>
              <span class={`${bar} h-5 w-28 max-sm:hidden`}></span>
              <span class={`${bar} h-5 w-20`}></span>
              <span class={`${bar} h-3 w-16 max-sm:hidden`}></span>
            </div>
          {/each}
        </div>
      </div>
      <div class="min-w-0 xl:w-[24rem] xl:shrink-0 xl:border-l xl:border-line-soft xl:pl-8">
        <span class={`${bar} h-5 w-36`}></span>
        <div class="mt-5 flex flex-col gap-2.5 rounded-[0.5625rem] border border-line p-5">
          <span class={`${bar} h-3 w-28`}></span>
          <span class={`${bar} h-4 w-52 max-w-full`}></span>
          <span class={`${bar} h-3 w-40`}></span>
        </div>
      </div>
    </div>
  {:else if layout === "projects"}
    <!-- The Projects page in the frame (Paper S9): a year heading over a
         row of cards, 32px in from the sidebar. -->
    <div data-skeleton-table class="flex flex-col gap-3.5 px-4 pt-3 sm:px-6 lg:px-8">
      <span class={`${bar} h-4 w-40`}></span>
      <div class="grid grid-cols-[repeat(auto-fill,minmax(min(100%,18rem),1fr))] gap-3">
        {#each [0, 1, 2, 3, 4, 5] as row (row)}
          <div data-skeleton-row class="flex h-40 flex-col gap-3 rounded-[0.625rem] border border-line bg-surface p-3.5">
            <span class={`${bar} h-3 w-24`}></span>
            <span class={`${bar} h-4 w-44 max-w-full`}></span>
          </div>
        {/each}
      </div>
    </div>
  {:else if layout === "companies" || layout === "companies-table"}
    <!-- All companies (2026-10-28): the table's header and rows, as Team's. -->
    <div class={layout === "companies" ? "px-4 pb-8 pt-1 sm:px-6 lg:px-8" : ""}>
      <div data-skeleton-table class="overflow-hidden rounded-[0.625rem] border border-line-soft">
        <div class="flex h-9 items-center gap-4 border-b border-line-soft bg-canvas px-4">
          <span class={`${bar} h-2.5 w-12`}></span>
        </div>
        {#each [0.36, 0.28, 0.42, 0.3, 0.38, 0.26] as width, index (index)}
          <div data-skeleton-row class="flex h-12 items-center gap-4 border-b border-line-soft px-4 last:border-b-0">
            <span class={`${bar} h-3`} style:width={`${width * 100}%`}></span>
            <span class="flex-1"></span>
            <span class={`${bar} h-3 w-8`}></span>
            <span class={`${bar} h-3 w-24 max-sm:hidden`}></span>
            <span class={`${bar} h-3 w-28 max-sm:hidden`}></span>
          </div>
        {/each}
      </div>
    </div>
  {:else if layout === "company"}
    <!-- A company's page (2026-11-04, the company profile): the header (name,
         facts, people) and the tabs over a soft line, then the summary card
         and the projects table. -->
    <div class="flex shrink-0 flex-col gap-[1.125rem] border-b border-line-soft px-4 pt-6 sm:px-6 lg:px-8 lg:pt-8">
      <div class="flex flex-col gap-2.5">
        <span class={`${bar} h-8 w-72 max-w-full`}></span>
        <div class="flex gap-[1.125rem]">
          {#each [24, 28, 40] as width, index (index)}
            <span class={`${bar} h-3.5`} style:width={`${width / 4}rem`}></span>
          {/each}
        </div>
      </div>
      <div class="flex h-10 items-center gap-5">
        {#each [14, 10, 12, 12, 11] as width, index (index)}
          <span class={`${bar} h-3`} style:width={`${width / 4}rem`}></span>
        {/each}
      </div>
    </div>
    <div data-skeleton-table class="flex flex-col gap-7 px-4 pt-6 sm:px-6 lg:px-8 lg:pt-8">
      <div class="flex h-36 flex-col gap-3 rounded-[0.875rem] border border-line p-5">
        <span class={`${bar} h-4 w-40`}></span>
        <span class={`${bar} h-3.5 w-full`}></span>
        <span class={`${bar} h-3.5 w-2/3`}></span>
      </div>
      <div class="flex flex-col overflow-hidden rounded-xl border border-line">
        {#each [0, 1, 2, 3, 4] as row (row)}
          <div data-skeleton-row class="flex h-[2.875rem] items-center gap-4 border-b border-line-soft px-4 last:border-b-0">
            <span class={`${bar} h-3.5 w-56 max-w-[50%]`}></span>
            <span class={`${bar} ml-auto h-3 w-16`}></span>
          </div>
        {/each}
      </div>
    </div>
  {:else if layout === "project"}
    <!-- The project workspace (2026-09-28 load pass): the panel toolbar's
         tabs, the 300px Outline column and the step's seed cards in the
         plan's columns (two 412px, then as many 400px as fit). -->
    <div class="flex h-10 shrink-0 items-center gap-5 border-b border-line-soft px-5">
      {#each [28, 52, 44, 50] as width (width)}
        <span class={`${bar} h-3`} style:width={boardRem(width)}></span>
      {/each}
    </div>
    <div class="flex min-h-0 flex-1">
      <div data-skeleton-outline class="hidden w-[18.75rem] flex-none flex-col gap-4 border-r border-line-soft px-5 pt-5 lg:flex">
        <div class="flex items-center justify-between">
          <span class={`${bar} h-4 w-16`}></span>
          <span class={`${bar} h-3 w-12`}></span>
        </div>
        {#each [0.7, 0.58, 0.76, 0.64, 0.54, 0.72, 0.6, 0.68, 0.5, 0.74] as width, index (index)}
          <div data-skeleton-row class="flex items-center gap-2.5">
            <span class="size-4 shrink-0 rounded-full border border-line"></span>
            <span class={`${bar} h-3`} style:width={`${width * 100}%`}></span>
          </div>
        {/each}
      </div>
      <div class="@container flex min-w-0 flex-1 flex-col gap-3 px-4 pt-6 sm:px-6 lg:px-10">
        <span class={`${bar} h-3 w-24`}></span>
        <span class={`${bar} h-6 w-72 max-w-full`}></span>
        <span class={`${bar} h-3 w-[28rem] max-w-full`}></span>
        <div data-skeleton-cards class="mt-5 grid grid-cols-1 gap-2.5 @min-[800px]:grid-cols-[repeat(2,minmax(0,25.75rem))] @min-[1220px]:grid-cols-3 @min-[1630px]:grid-cols-4">
          {#each [0, 1, 2, 3] as card (card)}
            <div class="flex h-[10.625rem] flex-col gap-3 rounded-xl border border-line-soft p-4">
              <div class="flex gap-1.5">
                <span class={`${bar} h-5 w-[5.25rem]`}></span>
                <span class={`${bar} h-5 w-16`}></span>
              </div>
              {#each [0.92, 0.76, 0.6] as width (width)}
                <span class={`${bar} h-3`} style:width={`${width * 100}%`}></span>
              {/each}
            </div>
          {/each}
        </div>
      </div>
    </div>
  {:else if layout === "form"}
    <div class="px-4 pb-12 pt-1 sm:px-6 lg:px-8">
      <div class="divide-y divide-line-soft">
        {#each [0, 1, 2, 3] as row (row)}
          <div data-skeleton-row class="flex flex-col gap-5 py-8 first:pt-0 md:grid md:grid-cols-[17.5rem_minmax(0,40rem)]">
            <div class="flex flex-col gap-2">
              <span class={`${bar} h-4 w-24`}></span>
              <span class={`${bar} h-3 w-40`}></span>
            </div>
            <span data-skeleton-field class={`${bar} h-9 w-full rounded-lg`}></span>
          </div>
        {/each}
      </div>
    </div>
  {:else if layout === "fields"}
    <div class="divide-y divide-line-soft">
      {#each [0, 1, 2, 3] as row (row)}
        <div data-skeleton-row class="flex flex-col gap-5 py-8 first:pt-0 md:grid md:grid-cols-[17.5rem_minmax(0,40rem)]">
          <div class="flex flex-col gap-2">
            <span class={`${bar} h-4 w-24`}></span>
            <span class={`${bar} h-3 w-40`}></span>
          </div>
          <span data-skeleton-field class={`${bar} h-9 w-full rounded-lg`}></span>
        </div>
      {/each}
    </div>
  {:else if layout === "list"}
    <div class="flex flex-col gap-3 pt-2">
      {#each [0, 1, 2, 3] as card (card)}
        <div data-skeleton-row class="flex flex-col gap-2.5 rounded-xl border border-line p-5">
          <span class={`${bar} h-4 w-56 max-w-full`}></span>
          <span class={`${bar} h-3 w-full max-w-[40rem]`}></span>
          <span class={`${bar} h-3 w-2/3 max-w-[30rem]`}></span>
        </div>
      {/each}
    </div>
  {:else}
    <div class="px-4 pb-7 pt-1 sm:px-6 lg:px-8">
      <span class={`${bar} h-3 w-96 max-w-full`}></span>
      <div class="mt-6 flex flex-col gap-4">
        {#each [0, 1, 2] as card (card)}
          <div data-skeleton-row class="flex flex-col gap-2.5 rounded-xl border border-line p-5">
            <span class={`${bar} h-4 w-56 max-w-full`}></span>
            <span class={`${bar} h-3 w-full max-w-[40rem]`}></span>
            <span class={`${bar} h-3 w-2/3 max-w-[30rem]`}></span>
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>
