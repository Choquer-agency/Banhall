<script lang="ts">
  /**
   * A labelled group in a section sidebar (Paper S9, Companies): 20px above
   * it, a 28px header with the label at 13/16 in muted ink and an optional
   * 14px search button on the right, then 30px rows 2px apart
   * (`SectionSidebarLink kind="group"`).
   */
  import type { Snippet } from "svelte";
  import FrameIcon from "./FrameIcon.svelte";

  let {
    id,
    label,
    searchLabel = null,
    searchOpen = false,
    onSearch = undefined,
    children,
  }: {
    /** Test and aria hook. */
    id: string;
    label: string;
    /** The search button's name ("Find a company"); null draws none. */
    searchLabel?: string | null;
    searchOpen?: boolean;
    onSearch?: () => void;
    children: Snippet;
  } = $props();
</script>

<section data-section-sidebar-group={id} aria-labelledby={`section-sidebar-group-${id}`} class="flex flex-col gap-0.5 pt-5">
  <div class="flex h-7 shrink-0 items-center gap-2 pl-2.5 pr-1.5">
    <h3 id={`section-sidebar-group-${id}`} class="min-w-0 flex-1 truncate text-[0.8125rem] font-normal leading-[calc(16/13)] text-ink-muted">{label}</h3>
    {#if searchLabel && onSearch}
      <button
        type="button"
        data-section-sidebar-search={id}
        aria-label={searchLabel}
        aria-expanded={searchOpen}
        onclick={onSearch}
        class={`flex size-6 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-primary-wash hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir motion-reduce:transition-none pointer-coarse:size-11 ${searchOpen ? "text-ink" : "text-ink-muted"}`}
      >
        <FrameIcon name="search" />
      </button>
    {/if}
  </div>
  {@render children()}
</section>
