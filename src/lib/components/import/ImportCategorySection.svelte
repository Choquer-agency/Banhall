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
  import { Popover } from "bits-ui";
  import { untrack } from "svelte";
  import { useMutation, usePaginatedQuery } from "convex-svelte";
  import { TrashIcon } from "phosphor-svelte";
  import { api } from "../../../../convex/_generated/api";
  import { IconChevronDown, IconChevronDownSmall } from "$lib/components/icons";
  import Checkbox from "$lib/components/ui/Checkbox.svelte";
  import ImportFileRow from "./ImportFileRow.svelte";
  import { deleteGroupFiles } from "./importActions";
  import { DELETE_NOTE, deleteLine, rowAbilities, sectionSelectLabel } from "./importEdit";
  import {
    FILES_PAGE_MAX,
    firstPageSize,
    notSortedNote,
    plural,
    reloadSize,
    sectionNote,
    SHOW_MORE_STEP,
    showMoreText,
    showSectionText,
    yearSplitText,
    type SectionSummary,
    type SheetFileRow,
    type SheetTab,
  } from "./importFormat";
  import type { ImportSelection } from "./importSelection.svelte";
  import {
    AMBER,
    DANGER_CONFIRM_LINE,
    POPOVER_CARD,
    ROW_TOGGLE,
    SELECT_GUTTER,
    SHEET_SMALL,
    SHOW_MORE,
  } from "./sheetLayout";

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
  const remaining = $derived(Math.max(0, section.count - rows.length));
  const hasMore = $derived(remaining > 0 && (filesQ.status === "CanLoadMore" || filesQ.status === "LoadingMore"));
  $effect(() => {
    if (open && remaining === 0 && rows.length > 0 && filesQ.status === "CanLoadMore") {
      untrack(() => filesQ.loadMore(SHOW_MORE_STEP));
    }
  });

  // ─── Quick delete category section (To review) ──────────────────────────
  const removeGroupItems = useMutation(api.ingestion.removeGroupItems);
  const restoreItems = useMutation(api.ingestion.restoreItems);
  let deleteOpen = $state(false);
  let deleting = $state(false);
  const deletableCount = $derived(
    notSorted ? Math.max(0, section.counts.total - beingRead) : section.counts.total
  );
  const canDeleteSection = $derived(tab === "review" && deletableCount > 0);

  async function deleteSection() {
    if (deleting) return;
    deleting = true;
    deleteOpen = false;
    try {
      await deleteGroupFiles({ companyKey, category: section.category }, removeGroupItems, restoreItems, {
        onRemoved: (ids) => selection?.remove(ids),
      });
    } finally {
      deleting = false;
    }
  }

  // ─── Select ─────────────────────────────────────────────────────────────
  const category = untrack(() => section.category);
  const selecting = $derived(Boolean(selection?.on));
  /** The files listed here that can be selected on this tab. */
  const selectable = $derived(open ? rows.filter((row) => rowAbilities(row, tab).select) : []);
  /** The read has answered for its arguments (not reading its first page). */
  const answered = $derived(open && filesQ.status !== "LoadingFirstPage");
  $effect(() => {
    const target = selection;
    if (!target || !answered) return;
    const list = selectable;
    const read = onlyNew ? "new" : onlyToCheck ? "to-check" : "all";
    const name = company;
    untrack(() => target.list(companyKey, category, read, list, name));
  });
  $effect(() => {
    const target = selection;
    if (!target || !open) return;
    return () => untrack(() => target.unlist(companyKey, category));
  });
  const checkState = $derived(selection ? selection.stateOf(selection.listed(companyKey, category)) : "none");
  const selectLabel = $derived(sectionSelectLabel(section.label, company));

  function toggleSelect() {
    if (!selection) return;
    if (!selection.on) selection.setOn(true);
    if (selection.toggleRows(selection.listed(companyKey, category))) return;
    if (open && selection.isListed(companyKey, category)) return;
    selection.selectWhenListed(companyKey, category);
    if (!open) onToggle();
  }
</script>

<div data-import-section={section.category} data-import-section-open={open ? "" : undefined}>
  <div
    role="row"
    class="group/section relative flex h-9 items-center border-t border-line pr-2.5 pl-12 transition-colors duration-150 ease-out hover:bg-gray-50 motion-reduce:transition-none"
  >
    {#if selection}
      <div
        data-import-select-cell
        class={`${SELECT_GUTTER} ${
          selecting || checkState !== "none"
            ? "opacity-100"
            : "opacity-0 pointer-fine:group-hover/section:opacity-100 pointer-fine:group-has-[:focus-visible]/section:opacity-100 focus-within:opacity-100"
        }`}
      >
        <Checkbox
          bind:checked={() => checkState === "all", () => toggleSelect()}
          indeterminate={checkState === "some"}
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
        <span data-import-section-label class={`${SHEET_SMALL} tracking-[0.04em] text-ink-muted uppercase`}>{section.label}</span>
        <span
          data-import-section-count
          class="flex h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-full bg-import-count px-[0.3125rem] text-[0.625rem] leading-[1.2] text-primary-selected"
        >{section.count}</span>
      </button>
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
      <span class="ml-auto flex shrink-0 items-center gap-2 pl-2">
        {#if !open}
          <span aria-hidden="true" data-import-section-show class="shrink-0 text-[0.8125rem] leading-[calc(18/13)] font-medium text-primary-selected">{showSectionText(section.count)}</span>
        {/if}
        {#if canDeleteSection}
          <Popover.Root bind:open={deleteOpen}>
            <Popover.Trigger
              type="button"
              disabled={deleting}
              aria-label="Delete section files"
              title={`Delete ${section.label.toLowerCase()} in ${company ?? "No company yet"}`}
              data-import-section-delete={section.category}
              class={`relative z-[1] flex size-7 shrink-0 items-center justify-center rounded-md text-ink-muted transition-[opacity,background-color,color] duration-150 ease-out hover:bg-danger-surface hover:text-danger-ink-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir data-[state=open]:bg-danger-surface data-[state=open]:text-danger-ink-muted motion-reduce:transition-none pointer-coarse:size-11 ${
                deleteOpen
                  ? "opacity-100"
                  : "opacity-0 group-hover/section:opacity-100 group-has-[:focus-visible]/section:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
              }`}
            >
              <TrashIcon size="0.875rem" aria-hidden="true" />
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                side="bottom"
                align="end"
                sideOffset={6}
                collisionPadding={12}
                aria-label={`Delete ${section.label}`}
                data-import-section-delete-confirm
                class={`${POPOVER_CARD} w-[18.5rem] max-w-[calc(100vw-1.5rem)] p-3`}
              >
                <p class="text-[0.8125rem] leading-[calc(18/13)] font-medium text-ink">
                  Delete {plural(deletableCount, "file")} in {section.label}?
                </p>
                <p class={`mt-1 ${SHEET_SMALL} text-ink-muted`}>{DELETE_NOTE}</p>
                {#if notSorted && beingRead > 0}
                  <p class={`mt-1 ${SHEET_SMALL} text-ink-muted`}>
                    {plural(beingRead, "file")} still being read will stay until finished.
                  </p>
                {/if}
                <button
                  type="button"
                  disabled={deleting}
                  data-import-section-delete-go
                  onclick={() => void deleteSection()}
                  class={`mt-2.5 ${DANGER_CONFIRM_LINE}`}
                >{deleting ? "Deleting..." : deleteLine(deletableCount)}</button>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        {/if}
        <span
          data-import-section-chevron
          data-chevron-state={open ? "up" : "down"}
          aria-hidden="true"
          class="flex size-5 shrink-0 items-center justify-center text-ink-muted"
        >
          <span
            class={`flex size-3 items-center justify-center transition-transform duration-200 ease-out motion-reduce:transition-none ${
              open ? "rotate-180" : "rotate-0"
            }`}
          >
            <IconChevronDown size={13} strokeWidth={1.8} class="shrink-0" />
          </span>
        </span>
      </span>
    </div>
  </div>

  {#if open}
    <div id={filesId} data-import-section-files>
      {#if filesQ.error && rows.length === 0}
        <div role="row" class="flex h-9 items-center border-t border-line-soft pl-12">
          <div role="cell" aria-colspan={6} class="text-[0.8125rem] leading-[calc(18/13)] text-ink-secondary">These files could not be loaded.</div>
        </div>
      {:else if loadingFirst}
        {#each Array.from({ length: Math.min(firstPage, 3) }, (_, index) => index) as index (index)}
          <div role="row" aria-hidden="true" class="flex h-9 items-center border-t border-line-soft pl-12" data-import-file-skeleton>
            <span class="h-3 w-48 animate-pulse rounded-sm bg-gray-50 motion-reduce:animate-none"></span>
          </div>
        {/each}
      {:else}
        {#each rows as row (row._id)}
          <ImportFileRow {row} {tab} {company} {selection} />
        {/each}
      {/if}
      {#if hasMore}
        <div role="row" class="flex h-9 items-center border-t border-line-soft pl-12">
          <div role="cell" aria-colspan={6}>
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
