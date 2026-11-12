<!--
  The Import sheet for one tab (boards ao3 and ao5): the column header, then
  one band per company from sheetCompanies, 25 at a time with "Show more
  companies". Companies start closed; opening one opens its Final PDs.
  "No company yet" comes first, where the server lists it, so its place
  never moves as more companies load. With "To check" on, only companies and
  files that need a person.

  When "To check" changes, the bands on screen stay until the new list comes
  (keepPreviousData), asking for as many companies as were listed, and until
  it has every open company that still matches, reading on a page at a time
  when one is further down. Open companies and sections stay open and keep
  their files. A page with no bands while more exist is read past on its
  own a few times, then "Show more companies" is offered: the sheet says
  nothing is waiting only once the list is done.

  `jump` (from a company found by the search) opens that company and brings
  it into view, reading further pages until it is loaded.

  `selection` (phase 3b, board ao4) is the page's: with Select on, every row
  starts with its checkbox column.
-->
<script lang="ts">
  import { tick, untrack } from "svelte";
  import { SvelteMap, SvelteSet } from "svelte/reactivity";
  import { usePaginatedQuery } from "convex-svelte";
  import { api } from "../../../../convex/_generated/api";
  import ImportSheetHeader from "./ImportSheetHeader.svelte";
  import ImportCompanyBand from "./ImportCompanyBand.svelte";
  import type { ImportSelection } from "./importSelection.svelte";
  import {
    COMPANIES_PAGE_MAX,
    EMPTY_TAB_TEXT,
    NOTHING_TO_CHECK_TEXT,
    reloadSize,
    type ImportCategory,
    type SheetBand,
    type SheetTab,
  } from "./importFormat";
  import { SHEET_MIN_WIDTH, SHOW_MORE } from "./sheetLayout";

  let {
    tab,
    onlyToCheck,
    jump = null,
    selection = null,
  }: {
    tab: SheetTab;
    onlyToCheck: boolean;
    /** A company to open and show; a new object asks again. */
    jump?: { key: string } | null;
    /** The page's selection (Select). */
    selection?: ImportSelection | null;
  } = $props();

  const COMPANY_PAGE = 25;
  /** Looking for a company not loaded yet reads a full page at a time. */
  const SEEK_PAGE = COMPANIES_PAGE_MAX;
  /** ...and gives up after this many pages (2,000 companies). */
  const SEEK_READS = 20;
  /** Pages with no bands read past on their own before "Show more companies" is offered. */
  const EMPTY_READS = 3;
  const TABLE_NAMES: Record<SheetTab, string> = {
    review: "Files to review",
    approved: "Approved files",
    deleted: "Deleted files",
  };

  // How many companies are listed, read (untracked) when the read changes.
  let listed = 0;
  const bandsQ = usePaginatedQuery(api.ingestion.sheetCompanies, () => ({ tab, onlyToCheck }), () => ({
    initialNumItems: reloadSize(listed, COMPANY_PAGE, COMPANIES_PAGE_MAX),
    keepPreviousData: true,
  }));
  const live = $derived(bandsQ.results as SheetBand[]);

  // Which companies and sections are open. Kept here, so they stay open
  // while "To check" reloads the bands.
  const openCompanies = new SvelteSet<string>();
  const openSections = new SvelteMap<string, SvelteSet<ImportCategory>>();
  const NONE_OPEN: ReadonlySet<ImportCategory> = new Set();

  function setCompanyOpen(key: string, value: boolean) {
    if (value) {
      openCompanies.add(key);
      openSections.set(key, new SvelteSet<ImportCategory>(["final_pd"]));
    } else {
      openCompanies.delete(key);
    }
  }

  function toggleSection(key: string, category: ImportCategory) {
    let sections = openSections.get(key);
    if (!sections) {
      sections = new SvelteSet<ImportCategory>();
      openSections.set(key, sections);
    }
    if (sections.has(category)) sections.delete(category);
    else sections.add(category);
  }

  /**
   * While "To check" reloads the list: the bands that were on screen, shown
   * until the new list has `wanted` (the open companies that still match).
   */
  let held = $state<{ bands: SheetBand[]; wanted: string[] } | null>(null);
  let pendingJump = $state<string | null>(null);
  let shownFilter = untrack(() => onlyToCheck);
  let seekReads = 0;
  let emptyReads = 0;

  // Before the list's own effect sees the new arguments, so what is on
  // screen is still the old list.
  $effect.pre(() => {
    const filter = onlyToCheck;
    untrack(() => {
      if (filter === shownFilter) return;
      shownFilter = filter;
      const bands = held?.bands ?? live;
      const wanted = bands
        .filter((band) => openCompanies.has(band.companyKey) && (!filter || band.needsCheck > 0))
        .map((band) => band.companyKey);
      held = bands.length > 0 ? { bands, wanted } : null;
      seekReads = 0;
      emptyReads = 0;
    });
  });
  $effect.pre(() => {
    listed = live.length;
  });

  $effect(() => {
    const target = jump;
    if (target)
      untrack(() => {
        pendingJump = target.key;
        seekReads = 0;
      });
  });

  const bands = $derived(held ? held.bands : live);
  // The list has answered for its arguments and is not reading a page.
  const answered = $derived(!bandsQ.isLoading && (bandsQ.status === "CanLoadMore" || bandsQ.status === "Exhausted"));

  let root: HTMLElement | null = $state(null);

  function reveal(key: string) {
    const band = root?.querySelector<HTMLElement>(`[data-import-band="${CSS.escape(key)}"]`);
    if (!band) return;
    band.scrollIntoView({ block: "start" });
    band.querySelector<HTMLElement>("[data-import-band-toggle]")?.focus({ preventScroll: true });
  }

  // Read on for companies the sheet must show, then let the new list show.
  $effect(() => {
    if (!answered) return;
    const keys = new Set(live.map((band) => band.companyKey));
    const wanted = [...(held?.wanted ?? []), ...(pendingJump === null ? [] : [pendingJump])];
    const missing = wanted.some((key) => !keys.has(key));
    const canLoadMore = bandsQ.status === "CanLoadMore";
    untrack(() => {
      if (missing && canLoadMore && seekReads < SEEK_READS) {
        seekReads += 1;
        bandsQ.loadMore(SEEK_PAGE);
        return;
      }
      held = null;
      const key = pendingJump;
      if (key !== null) {
        pendingJump = null;
        if (keys.has(key)) {
          if (!openCompanies.has(key)) setCompanyOpen(key, true);
          void tick().then(() => reveal(key));
        }
      }
      if (live.length > 0) emptyReads = 0;
      else if (canLoadMore && emptyReads < EMPTY_READS) {
        emptyReads += 1;
        bandsQ.loadMore(COMPANY_PAGE);
      }
    });
  });

  const reloading = $derived(held !== null);
  const hasMore = $derived(!reloading && (bandsQ.status === "CanLoadMore" || bandsQ.status === "LoadingMore"));
  const done = $derived(!reloading && answered && bandsQ.status === "Exhausted");
</script>

<div bind:this={root} class="overflow-x-auto" data-import-sheet={tab}>
  <div class={SHEET_MIN_WIDTH}>
    <div role="table" aria-label={TABLE_NAMES[tab]}>
      <ImportSheetHeader selecting={Boolean(selection?.on)} />
      {#each bands as band (band.companyKey)}
        <ImportCompanyBand
          {band}
          {tab}
          {onlyToCheck}
          {selection}
          open={openCompanies.has(band.companyKey)}
          openSections={openSections.get(band.companyKey) ?? NONE_OPEN}
          onToggle={() => setCompanyOpen(band.companyKey, !openCompanies.has(band.companyKey))}
          onToggleSection={(category) => toggleSection(band.companyKey, category)}
        />
      {/each}
    </div>

    {#if bandsQ.error && bands.length === 0}
      <p role="alert" data-import-sheet-error class="py-8 pl-6 text-[0.8125rem] leading-[calc(18/13)] text-ink-secondary">The files could not be loaded.</p>
    {:else if bands.length === 0 && done}
      <p data-import-sheet-empty class="py-8 pl-6 text-[0.8125rem] leading-[calc(18/13)] text-ink-secondary">
        {onlyToCheck ? NOTHING_TO_CHECK_TEXT : EMPTY_TAB_TEXT[tab]}
      </p>
    {:else if hasMore}
      <!-- The boards' "Show N more" row: 14px under the last company, between two strong lines. -->
      <div class="mt-3.5 flex h-[3.25rem] items-center border-y border-gray-300 pl-6">
        <button
          type="button"
          data-import-show-more-companies
          disabled={bandsQ.status === "LoadingMore"}
          onclick={() => bandsQ.loadMore(COMPANY_PAGE)}
          class={SHOW_MORE}
        >{bandsQ.status === "LoadingMore" ? "Loading..." : "Show more companies"}</button>
      </div>
    {:else if bands.length === 0}
      <div role="status" aria-label="Loading companies" data-import-sheet-loading>
        {#each [0, 1, 2, 3] as index (index)}
          <div class="flex h-[3.25rem] items-center gap-3 border-t border-gray-300 pl-6">
            <span class="h-3.5 w-40 animate-pulse rounded-sm bg-gray-50 motion-reduce:animate-none"></span>
            <span class="h-3 w-24 animate-pulse rounded-sm bg-gray-50 motion-reduce:animate-none"></span>
          </div>
        {/each}
      </div>
    {:else}
      <!-- The end of the list: the strong line closes the last company. -->
      <div data-import-sheet-end class="border-t border-gray-300" aria-hidden="true"></div>
    {/if}
  </div>
</div>
