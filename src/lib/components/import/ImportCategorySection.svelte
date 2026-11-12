<!--
  One section of an open company on the Import sheet (board ao5): a 40px
  label row in small capitals with its count, the per-year split in faint
  words, an amber note when files need a person ("9 need a writer, 4 need a
  science code", from the band's counts), and "Show N" at the right while
  closed. Open, it lists a few files (sheetFiles, five final PDs or three of
  anything else) and a "Show more" row that lists 25 more each time. Its
  files are read only while it is open. When "To check" changes what it
  reads, the files listed stay until the new ones come, and it asks for as
  many as it listed.
-->
<script lang="ts">
  import { untrack } from "svelte";
  import { usePaginatedQuery } from "convex-svelte";
  import { api } from "../../../../convex/_generated/api";
  import { IconChevronDownSmall, IconChevronRight } from "$lib/components/icons";
  import ImportFileRow from "./ImportFileRow.svelte";
  import {
    FILES_PAGE_MAX,
    firstPageSize,
    reloadSize,
    sectionNote,
    SHOW_MORE_STEP,
    showMoreText,
    showSectionText,
    yearSplitText,
    type SectionSummary,
    type SheetTab,
  } from "./importFormat";
  import { AMBER, ROW_TOGGLE, SHEET_SMALL, SHOW_MORE } from "./sheetLayout";

  let {
    tab,
    companyKey,
    section,
    onlyToCheck,
    open,
    onToggle,
  }: {
    tab: SheetTab;
    companyKey: string;
    section: SectionSummary;
    onlyToCheck: boolean;
    open: boolean;
    onToggle: () => void;
  } = $props();

  const uid = $props.id();
  const filesId = `${uid}-files`;

  // Fixed when the section mounts, so a count moving under it never restarts the read.
  const firstPage = untrack(() => firstPageSize(section.category, section.count));
  // How many files are listed, read (untracked) when the read changes.
  let listed = 0;
  const filesQ = usePaginatedQuery(
    api.ingestion.sheetFiles,
    () => (open ? { tab, companyKey, category: section.category, onlyToCheck } : "skip"),
    () => ({ initialNumItems: reloadSize(listed, firstPage, FILES_PAGE_MAX), keepPreviousData: true })
  );

  const note = $derived(tab === "review" ? sectionNote(section.counts) : null);

  const rows = $derived(filesQ.results);
  $effect.pre(() => {
    listed = rows.length;
  });
  const loadingFirst = $derived(open && rows.length === 0 && filesQ.status === "LoadingFirstPage" && !filesQ.error);
  const hasMore = $derived(filesQ.status === "CanLoadMore" || filesQ.status === "LoadingMore");
  const remaining = $derived(Math.max(0, section.count - rows.length));
</script>

<div data-import-section={section.category} data-import-section-open={open ? "" : undefined}>
  <div role="row" class="relative flex h-10 items-center gap-3 border-t border-line-soft pr-2 hover:bg-gray-50">
    <div role="cell" aria-colspan={5} class="flex min-w-0 flex-1 items-center gap-3">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? filesId : undefined}
        data-import-section-toggle
        onclick={onToggle}
        class={`${ROW_TOGGLE} shrink-0 gap-2`}
      >
        <span class="flex w-6 shrink-0 justify-center text-ink-muted">
          <IconChevronRight size={12} strokeWidth={1.8} class={`transition-transform duration-150 motion-reduce:transition-none ${open ? "rotate-90" : ""}`} />
        </span>
        <span data-import-section-label class={`${SHEET_SMALL} tracking-[0.06em] text-ink-secondary uppercase`}>{section.label}</span>
        <span
          data-import-section-count
          class="flex h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-full bg-chrome px-1 text-[0.625rem] leading-[1.2] text-primary-selected"
        >{section.count}</span>
      </button>
      {#if !onlyToCheck}
        <span data-import-section-years class={`min-w-0 truncate ${SHEET_SMALL} text-ink-faint`}>{yearSplitText(section.counts.fiscalYears)}</span>
      {/if}
      {#if note}
        <span data-import-section-note class={`min-w-0 shrink-0 truncate ${SHEET_SMALL} ${AMBER}`}>{note}</span>
      {/if}
      {#if !open}
        <span aria-hidden="true" class="ml-auto shrink-0 text-[0.8125rem] leading-[calc(18/13)] text-primary-selected">{showSectionText(section.count)}</span>
      {/if}
    </div>
  </div>

  {#if open}
    <div id={filesId} data-import-section-files>
      {#if filesQ.error && rows.length === 0}
        <div role="row" class="flex h-11 items-center border-t border-line-soft pl-6">
          <div role="cell" aria-colspan={5} class="text-[0.8125rem] leading-[calc(18/13)] text-ink-secondary">These files could not be loaded.</div>
        </div>
      {:else if loadingFirst}
        {#each Array.from({ length: Math.min(firstPage, 3) }, (_, index) => index) as index (index)}
          <div role="row" aria-hidden="true" class="flex h-11 items-center border-t border-line-soft pl-6" data-import-file-skeleton>
            <span class="h-3 w-48 animate-pulse rounded-sm bg-gray-50 motion-reduce:animate-none"></span>
          </div>
        {/each}
      {:else}
        {#each rows as row (row._id)}
          <ImportFileRow {row} />
        {/each}
      {/if}
      {#if hasMore}
        <div role="row" class="flex h-10 items-center border-t border-line-soft pl-6">
          <div role="cell" aria-colspan={5}>
            <button
              type="button"
              data-import-show-more-files
              disabled={filesQ.status === "LoadingMore"}
              onclick={() => filesQ.loadMore(SHOW_MORE_STEP)}
              class={SHOW_MORE}
            >
              {filesQ.status === "LoadingMore" ? "Loading..." : showMoreText(section.category, remaining)}
              {#if filesQ.status !== "LoadingMore"}<IconChevronDownSmall size={12} strokeWidth={1.4} />{/if}
            </button>
          </div>
        </div>
      {/if}
    </div>
  {/if}
</div>
