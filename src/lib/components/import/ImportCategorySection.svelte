<!--
  One section of an open company on the Import sheet (board ao5, Paper
  Files 1): a 40px label row under a line, the chevron in a 16px slot so the
  label starts 24px in, on the same left edge as the files' names under it;
  the label in muted small capitals with its count in a teal pill, the
  per-year split in faint words 14px on, an amber note 18px on when files
  need a person ("9 need a writer, 4 need a science code", from the band's
  counts), and "Show N" at the right while closed. Open, it lists a few files (sheetFiles, five final PDs or three of
  anything else) and, while its count says more are left, a "Show N more"
  row that lists 25 more each time. Its
  files are read only while it is open. When "To check" changes what it
  reads, the files listed stay until the new ones come, and it asks for as
  many as it listed.

  With Select on (board ao4) its checkbox selects the files it lists (never
  the ones not loaded: the bar's count is the truth), shows a dash when only
  some are selected, and on a closed section opens it and selects its first
  files when they come. It tells the selection which files it lists once
  its read has answered, so a selected file that leaves it leaves the
  selection, and a "select when it opens" request is used up even when
  nothing here can be selected.

  New (2026-11-12, Paper Files 2): with New on it lists only its New files,
  its count and year split are the New ones', and the amber note (which
  counts every file to check) gives way. Not sorted yet ("unknown") holds
  the files still being read, whatever their kind, and those whose kind is
  still unknown after reading; in place of a year split it says which
  ("Each file moves to its category once Banhall has read it").
-->
<script lang="ts">
  import { untrack } from "svelte";
  import { usePaginatedQuery } from "convex-svelte";
  import { api } from "../../../../convex/_generated/api";
  import { IconChevronDownSmall, IconChevronRight } from "$lib/components/icons";
  import Checkbox from "$lib/components/ui/Checkbox.svelte";
  import ImportFileRow from "./ImportFileRow.svelte";
  import { rowAbilities, sectionSelectLabel } from "./importEdit";
  import {
    FILES_PAGE_MAX,
    firstPageSize,
    reloadSize,
    sectionNote,
    SHOW_MORE_STEP,
    showMoreText,
    showSectionText,
    notSortedNote,
    yearSplitText,
    type SectionSummary,
    type SheetFileRow,
    type SheetTab,
  } from "./importFormat";
  import type { ImportSelection } from "./importSelection.svelte";
  import { AMBER, ROW_TOGGLE, SELECT_CELL_NESTED, SHEET_SMALL, SHOW_MORE } from "./sheetLayout";

  let {
    tab,
    companyKey,
    company = null,
    section,
    onlyToCheck,
    onlyNew = false,
    beingRead = 0,
    open,
    onToggle,
    selection = null,
  }: {
    tab: SheetTab;
    companyKey: string;
    /** The company's name, for the company picker on its files. */
    company?: string | null;
    section: SectionSummary;
    onlyToCheck: boolean;
    /** The New filter (2026-11-12). */
    onlyNew?: boolean;
    /** The band's files still being read: all of them are in Not sorted yet. */
    beingRead?: number;
    open: boolean;
    onToggle: () => void;
    selection?: ImportSelection | null;
  } = $props();

  const uid = $props.id();
  const filesId = `${uid}-files`;

  // Fixed when the section mounts, so a count moving under it never restarts the read.
  const firstPage = untrack(() => firstPageSize(section.category, section.count));
  // How many files are listed, read (untracked) when the read changes.
  let listed = 0;
  const filesQ = usePaginatedQuery(
    api.ingestion.sheetFiles,
    // onlyNew only when on, so the read of every other view keeps its arguments.
    () => (open ? { tab, companyKey, category: section.category, onlyToCheck, ...(onlyNew ? { onlyNew: true } : {}) } : "skip"),
    () => ({ initialNumItems: reloadSize(listed, firstPage, FILES_PAGE_MAX), keepPreviousData: true })
  );

  const note = $derived(tab === "review" && !onlyNew ? sectionNote(section.counts) : null);
  const notSorted = $derived(section.category === "unknown");

  const rows = $derived(filesQ.results as SheetFileRow[]);
  $effect.pre(() => {
    listed = rows.length;
  });
  const loadingFirst = $derived(open && rows.length === 0 && filesQ.status === "LoadingFirstPage" && !filesQ.error);
  /**
   * How many of the files this read lists (all of them, or only those to
   * check: the band's count for the section) are not listed yet. A page that
   * holds exactly the rest still reads as "can load more" until an empty page
   * comes back, so the "Show N more" row goes by this count (live QA fixes):
   * none left, no row, and never a row with no number on it.
   */
  const remaining = $derived(Math.max(0, section.count - rows.length));
  const hasMore = $derived(remaining > 0 && (filesQ.status === "CanLoadMore" || filesQ.status === "LoadingMore"));
  // The count says none are left but the read has not reached its end: ask
  // once, quietly. Usually an empty page comes back; if the count was behind,
  // the files it missed are listed rather than left out of reach.
  $effect(() => {
    if (open && remaining === 0 && rows.length > 0 && filesQ.status === "CanLoadMore") {
      untrack(() => filesQ.loadMore(SHOW_MORE_STEP));
    }
  });

  // ─── Select ─────────────────────────────────────────────────────────────
  // The band lists its sections keyed by category and is keyed by company,
  // so both are fixed for this section.
  const category = untrack(() => section.category);
  const selecting = $derived(Boolean(selection?.on));
  /** The files listed here that can be selected on this tab. */
  const selectable = $derived(open ? rows.filter((row) => rowAbilities(row, tab).select) : []);
  /** The read has answered for its arguments (not reading its first page). */
  const answered = $derived(open && filesQ.status !== "LoadingFirstPage");
  // Tells the selection what this section lists, once its read has answered,
  // with the read it came from ("To check" or not).
  $effect(() => {
    const target = selection;
    if (!target || !answered) return;
    const list = selectable;
    const read = onlyNew ? "new" : onlyToCheck ? "to-check" : "all";
    const name = company;
    untrack(() => target.list(companyKey, category, read, list, name));
  });
  // Closing the section (or the section leaving the sheet) takes its listing away.
  $effect(() => {
    const target = selection;
    if (!target || !open) return;
    return () => untrack(() => target.unlist(companyKey, category));
  });
  const state = $derived(selection ? selection.stateOf(selection.listed(companyKey, category)) : "none");
  const selectLabel = $derived(sectionSelectLabel(section.label, company));

  function toggleSelect() {
    if (!selection) return;
    if (selection.toggleRows(selection.listed(companyKey, category))) return;
    // Open and listed with nothing to select: nothing to ask for.
    if (open && selection.isListed(companyKey, category)) return;
    // Not on screen yet: open it, and select its files the first time it lists.
    selection.selectWhenListed(companyKey, category);
    if (!open) onToggle();
  }
</script>

<div data-import-section={section.category} data-import-section-open={open ? "" : undefined}>
  <div role="row" class="relative flex h-10 items-center border-t border-line pr-2 hover:bg-gray-50">
    {#if selecting}
      <div role="cell" data-import-select-cell class={`${SELECT_CELL_NESTED} self-stretch`}>
        <!-- Function bindings: the box always shows the selection, even when a click only opens the section. -->
        <Checkbox
          bind:checked={() => state === "all", () => toggleSelect()}
          indeterminate={state === "some"}
          aria-label={selectLabel}
          data-import-section-select={section.category}
        />
      </div>
    {/if}
    <div role="cell" aria-colspan={6} class="flex min-w-0 flex-1 items-center gap-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? filesId : undefined}
        data-import-section-toggle
        onclick={onToggle}
        class={`${ROW_TOGGLE} shrink-0 gap-2`}
      >
        <span data-import-section-chevron class="flex w-4 shrink-0 items-center text-ink-muted">
          <span class={`flex size-3 items-center justify-center transition-transform duration-150 motion-reduce:transition-none ${open ? "rotate-90" : ""}`}>
            <IconChevronRight size={12} strokeWidth={1.8} class="shrink-0" />
          </span>
        </span>
        <span data-import-section-label class={`${SHEET_SMALL} tracking-[0.04em] text-ink-muted uppercase`}>{section.label}</span>
        <span
          data-import-section-count
          class="flex h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-full bg-import-count px-[0.3125rem] text-[0.625rem] leading-[1.2] text-primary-selected"
        >{section.count}</span>
      </button>
      <!-- On a narrow sheet the year split gives way first, then the note; "Show N" always shows. -->
      {#if notSorted}
        {@const words = notSortedNote(section.counts.total, beingRead)}
        <span data-import-section-not-sorted title={words} class={`ml-1.5 min-w-0 shrink-[100] truncate ${SHEET_SMALL} text-ink-faint`}>{words}</span>
      {:else if !onlyToCheck}
        {@const years = yearSplitText(onlyNew ? (section.counts.newFiscalYears ?? {}) : section.counts.fiscalYears)}
        <span data-import-section-years title={years} class={`ml-1.5 min-w-0 shrink-[100] truncate ${SHEET_SMALL} text-ink-faint`}>{years}</span>
      {/if}
      {#if note}
        <span data-import-section-note title={note} class={`ml-2.5 min-w-0 truncate ${SHEET_SMALL} ${AMBER}`}>{note}</span>
      {/if}
      {#if !open}
        <span aria-hidden="true" data-import-section-show class="ml-auto shrink-0 pl-2 text-[0.8125rem] leading-[calc(18/13)] font-medium text-primary-selected">{showSectionText(section.count)}</span>
      {/if}
    </div>
  </div>

  {#if open}
    <div id={filesId} data-import-section-files>
      {#if filesQ.error && rows.length === 0}
        <div role="row" class={`flex h-11 items-center border-t border-line-soft ${selecting ? "pl-[3.75rem]" : "pl-6"}`}>
          <div role="cell" aria-colspan={selecting ? 7 : 6} class="text-[0.8125rem] leading-[calc(18/13)] text-ink-secondary">These files could not be loaded.</div>
        </div>
      {:else if loadingFirst}
        {#each Array.from({ length: Math.min(firstPage, 3) }, (_, index) => index) as index (index)}
          <div role="row" aria-hidden="true" class={`flex h-11 items-center border-t border-line-soft ${selecting ? "pl-[3.75rem]" : "pl-6"}`} data-import-file-skeleton>
            <span class="h-3 w-48 animate-pulse rounded-sm bg-gray-50 motion-reduce:animate-none"></span>
          </div>
        {/each}
      {:else}
        {#each rows as row (row._id)}
          <ImportFileRow {row} {tab} {company} {selection} />
        {/each}
      {/if}
      {#if hasMore}
        <div role="row" class={`flex h-10 items-center border-t border-line-soft ${selecting ? "pl-[3.75rem]" : "pl-6"}`}>
          <div role="cell" aria-colspan={selecting ? 7 : 6}>
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
