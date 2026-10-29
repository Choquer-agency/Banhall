<!--
  All companies (owner, 2026-10-28; no Paper board, kept plain and laid out
  as Team's tables, Paper S11): every company A to Z with its projects, its
  usual fiscal year end ("September 30", or "Not set") and its last update,
  filtered by the page's "Search companies" (case and accents ignored). A
  row opens the company page. The list is the company directory the
  sidebar already reads (index-backed, bounded); the table shows it 50 rows
  at a time with Show more. No company yet: Paper Z9c's empty state.
-->
<script module lang="ts">
  import type { ClientEntry } from "$lib/projects/clientList";

  export type CompanyRow = ClientEntry & {
    fiscalYearEndMonth?: number;
    fiscalYearEndDay?: number;
    updatedAt?: number;
  };

  /** Rows shown at first and added by each Show more. */
  export const COMPANY_TABLE_PAGE = 50;
</script>

<script lang="ts">
  import { filterClients } from "$lib/projects/clientList";
  import { companiesPath, yearEndLabel } from "$lib/companies/companies";
  import { longDate } from "$lib/projects/projectCard";
  import { topBarPrimary } from "$lib/components/shell/topBar";

  let {
    companies,
    truncated = false,
    query = "",
    root,
    onNewCompany = null,
  }: {
    companies: CompanyRow[];
    truncated?: boolean;
    query?: string;
    /** `resolve("/")`, for the company page links. */
    root: string;
    /** Null hides New company in the empty state. */
    onNewCompany?: (() => void) | null;
  } = $props();

  let shown = $state(COMPANY_TABLE_PAGE);
  const visible = $derived(filterClients(companies, query));
  // A new search starts from the first rows again.
  $effect(() => {
    void query;
    shown = COMPANY_TABLE_PAGE;
  });

  const quietButton =
    "flex h-[1.875rem] shrink-0 items-center rounded-[0.4375rem] border border-line px-2.5 text-[0.8125rem] leading-[calc(18/13)] text-ink-secondary transition-colors hover:bg-primary-wash hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy motion-reduce:transition-none pointer-coarse:h-11";
  const cell = "text-[0.8125rem] leading-[calc(19/13)]";
</script>

{#if companies.length === 0}
  <!-- Paper Z9c: no companies yet. -->
  <div class="flex flex-col items-center justify-center gap-2.5 rounded-xl border border-dashed border-line px-6 py-[4.5rem] text-center" data-companies-empty>
    <p class="text-base leading-[1.5] font-medium text-ink">Add your first company</p>
    <p class="max-w-[26.25rem] text-[0.9375rem] leading-[calc(22/15)] text-ink-secondary">Every project belongs to a company. Add one, then start its first project.</p>
    {#if onNewCompany}
      <button type="button" data-companies-empty-new onclick={onNewCompany} class={`${topBarPrimary} mt-1`}>New company</button>
    {/if}
  </div>
{:else}
  <div data-companies-table class="flex shrink-0 flex-col overflow-x-auto rounded-[0.625rem] border border-line-soft">
    <div class="min-w-[40rem]" role="table" aria-label="Companies">
      <div role="row" class="flex h-9 items-center gap-4 border-b border-line-soft bg-canvas px-4 text-xs leading-[calc(4/3)] text-ink-muted">
        <span role="columnheader" class="min-w-0 flex-1">Name</span>
        <span role="columnheader" class="w-20 shrink-0 text-right">Projects</span>
        <span role="columnheader" class="w-36 shrink-0">Fiscal year end</span>
        <span role="columnheader" class="w-40 shrink-0">Last update</span>
      </div>
      {#each visible.slice(0, shown) as company (company.key)}
        {@const yearEnd = yearEndLabel(company.fiscalYearEndMonth, company.fiscalYearEndDay)}
        <div role="row" data-company-row={company.key} class="relative flex h-12 items-center gap-4 border-b border-line-soft px-4 transition-colors last:border-b-0 hover:bg-primary-wash motion-reduce:transition-none">
          <span role="cell" class="flex min-w-0 flex-1 items-center">
            <!-- The name's link covers the row, so the whole row opens the page. -->
            <a
              href={companiesPath(root, company.key)}
              data-company-link={company.key}
              class={`${cell} truncate font-medium text-ink after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:rounded-[0.625rem] focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:outline-offset-[-2px] focus-visible:after:outline-fir`}
            >{company.name}</a>
          </span>
          <span role="cell" data-company-projects class={`${cell} w-20 shrink-0 text-right text-ink-secondary`}>{company.projectCount}</span>
          <span role="cell" data-company-year-end class={`${cell} w-36 shrink-0 truncate ${yearEnd ? "text-ink-secondary" : "text-ink-muted"}`}>{yearEnd ?? "Not set"}</span>
          <span role="cell" data-company-updated class={`${cell} w-40 shrink-0 truncate text-ink-muted`}>{company.updatedAt !== undefined ? longDate(company.updatedAt) : ""}</span>
        </div>
      {/each}
    </div>
    {#if visible.length === 0}
      <!-- Outside the table: a status line, not a row. -->
      <p role="status" class={`${cell} px-4 py-3.5 text-ink-muted`} data-companies-no-match>No company matches "{query.trim()}".</p>
    {/if}
  </div>
  {#if visible.length > shown}
    <div class="flex justify-center pt-4">
      <button type="button" data-companies-show-more onclick={() => (shown += COMPANY_TABLE_PAGE)} class={quietButton}>Show more</button>
    </div>
  {/if}
  {#if truncated}
    <p data-companies-truncated class="pt-3 text-[0.8125rem] leading-[calc(18/13)] text-ink-muted">Some companies are not shown. The list stops partway through the alphabet.</p>
  {/if}
{/if}
