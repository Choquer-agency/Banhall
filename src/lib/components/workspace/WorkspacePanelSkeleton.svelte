<script lang="ts" module>
  /** The page shapes a loading work panel can take. */
  export type PanelSkeletonLayout = "home" | "projects" | "form" | "page";
  /** Content-only shapes for a page whose frame and heading are already drawn. */
  export type ContentSkeletonLayout = "fields" | "list";
</script>

<script lang="ts">
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
    <div class="flex flex-1 flex-col gap-10 page-gutter pb-6 pt-5 xl:flex-row xl:gap-8">
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
    <div class="flex h-10 shrink-0 items-center gap-3 border-b border-workspace-rail-line px-4">
      <span class={`${bar} h-4 w-24`}></span>
      <span class="flex-1"></span>
      <span class={`${bar} h-4 w-16`}></span>
      <span class={`${bar} h-4 w-16`}></span>
      <span class={`${bar} h-4 w-16`}></span>
    </div>
    <div data-skeleton-table class="flex flex-col gap-2 px-3 py-3">
      {#each [0, 1, 2, 3, 4, 5, 6, 7] as row (row)}
        <div data-skeleton-row class="flex h-11 items-center rounded-xl border border-line bg-surface px-3">
          <span class={`${bar} h-3 w-44`}></span>
        </div>
      {/each}
    </div>
  {:else if layout === "form"}
    <div class="px-5 pb-12 pt-8 md:px-14">
      <span class={`${bar} h-8 w-40`}></span>
      <span class={`${bar} mt-5 h-8 w-80 max-w-full rounded-lg`}></span>
      <div class="mt-6 divide-y divide-line-soft">
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
    <div class="px-5 py-7 md:px-10">
      <span class={`${bar} h-8 w-48`}></span>
      <span class={`${bar} mt-3 h-3 w-96 max-w-full`}></span>
      <div class="mt-8 flex flex-col gap-4">
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
