<!--
  What "Find a file or company" found on this tab (sheetSearch), shown in
  place of the sheet: matching companies first as band-like rows that open
  that company in the sheet, then matching files as file rows naming their
  company. Clearing the search returns to the sheet.
-->
<script lang="ts">
  import { useQuery } from "convex-svelte";
  import { api } from "../../../../convex/_generated/api";
  import { IconChevronRight } from "$lib/components/icons";
  import ImportSheetHeader from "./ImportSheetHeader.svelte";
  import ImportFileRow from "./ImportFileRow.svelte";
  import {
    bandName,
    formatCount,
    NO_COMPANY_KEY,
    NO_COMPANY_NAME,
    plural,
    type SheetSearchCompany,
    type SheetSearchFile,
    type SheetTab,
  } from "./importFormat";
  import { AMBER, ROW_TOGGLE, SHEET_GRID, SHEET_MIN_WIDTH, SHEET_SMALL } from "./sheetLayout";

  let {
    tab,
    text,
    onJump,
  }: {
    tab: SheetTab;
    /** The settled search text (two characters or more). */
    text: string;
    onJump: (company: SheetSearchCompany) => void;
  } = $props();

  /** sheetSearch returns at most this many files. */
  const FILE_LIMIT = 50;

  const searchQ = useQuery(api.ingestion.sheetSearch, () => ({ tab, text }));
  const result = $derived(searchQ.data ?? null);
  const empty = $derived(result !== null && result.files.length === 0 && result.companies.length === 0);

  function companyOf(file: SheetSearchFile): string {
    if (file.companyKey === NO_COMPANY_KEY) return NO_COMPANY_NAME;
    return file.clientName?.trim() || file.companyKey;
  }
</script>

{#snippet groupLabel(label: string, count: number)}
  <div role="row" class="flex h-9 items-center border-t border-line pl-12">
    <div role="cell" aria-colspan={6} class="flex items-center gap-2">
      <span class={`${SHEET_SMALL} tracking-[0.04em] text-ink-muted uppercase`}>{label}</span>
      <span class="flex h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-full bg-import-count px-[0.3125rem] text-[0.625rem] leading-[1.2] text-primary-selected">{count}</span>
    </div>
  </div>
{/snippet}

<div class="overflow-x-auto" data-import-search-results>
  <div class={SHEET_MIN_WIDTH}>
    <div role="table" aria-label={`Found for "${text}"`}>
      <ImportSheetHeader />
      {#if result && result.companies.length > 0}
        <div role="rowgroup" data-import-found-companies>
          {@render groupLabel("Companies", result.companies.length)}
          {#each result.companies as company (company.companyKey)}
            <div role="row" data-import-found-company={company.companyKey} class={`relative ${SHEET_GRID} h-[2.75rem] items-center border-t border-gray-300 transition-colors duration-150 ease-out hover:bg-gray-50 motion-reduce:transition-none`}>
              <div role="cell" aria-colspan={5} class="col-span-5 flex min-w-0 items-center gap-2 pl-9">
                <button
                  type="button"
                  aria-label={`${bandName(company)}, show in the sheet`}
                  data-import-found-company-open
                  onclick={() => onJump(company)}
                  class={`${ROW_TOGGLE} min-w-0 shrink gap-2`}
                >
                  <span class="truncate text-sm leading-[calc(18/14)] font-medium text-ink">{bandName(company)}</span>
                </button>
                <span class="ml-auto shrink-0 pl-2 text-[0.8125rem] leading-[calc(18/13)] text-ink-muted">{plural(company.total, "file")}</span>
              </div>
              <div role="cell" class="flex min-w-0 items-center justify-end gap-2 pr-2.5 pl-2 text-[0.8125rem] leading-[calc(18/13)]">
                {#if tab === "review" && company.needsCheck > 0}
                  <span class={AMBER}>{formatCount(company.needsCheck)} to check</span>
                {/if}
                <span class="flex size-5 shrink-0 items-center justify-center text-ink-muted"><IconChevronRight size={14} strokeWidth={1.8} /></span>
              </div>
            </div>
          {/each}
        </div>
      {/if}
      {#if result && result.files.length > 0}
        <div role="rowgroup" data-import-found-files>
          {@render groupLabel("Files", result.files.length)}
          {#each result.files as file (file._id)}
            <ImportFileRow row={file} {tab} companyName={companyOf(file)} company={file.companyKey === NO_COMPANY_KEY ? null : companyOf(file)} inset="sheet" />
          {/each}
        </div>
      {/if}
    </div>

    {#if searchQ.error && !result}
      <p role="alert" class="py-8 pl-9 text-[0.8125rem] leading-[calc(18/13)] text-ink-secondary">The search did not work. Try again.</p>
    {:else if !result}
      <p role="status" data-import-searching class="py-8 pl-9 text-[0.8125rem] leading-[calc(18/13)] text-ink-muted">Searching...</p>
    {:else if empty}
      <p data-import-search-empty class="py-8 pl-9 text-[0.8125rem] leading-[calc(18/13)] text-ink-secondary">Nothing matches "{text}".</p>
    {:else}
      {#if result.files.length >= FILE_LIMIT}
        <p class={`border-t border-line-soft py-3 pl-9 ${SHEET_SMALL} text-ink-muted`}>Showing the first {FILE_LIMIT} files. Type more of the name to narrow it.</p>
      {/if}
      <div class="border-t border-gray-300" aria-hidden="true"></div>
    {/if}
  </div>
</div>
