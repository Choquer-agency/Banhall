<!--
  The Import page (/admin/import, 2026-11-11 phase 3a, boards ao3 and ao5):
  one sheet for every company's imported files. The top bar reads "Import"
  with "N files from M companies"; then the tabs To review, Approved and
  Deleted with their counts (the company page's underlined tabs, as the
  boards draw them); then one toolbar row and the sheet, or the search
  results in its place. Read only in this phase. Admin only: sheetTotals is
  null for anyone else, and the page says so. The route keeps the sign-in
  check and mounts this.
-->
<script lang="ts">
  import { tick, untrack } from "svelte";
  import { useQuery } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { api } from "../../../../convex/_generated/api";
  import AdminWorkspacePage from "$lib/components/admin/AdminWorkspacePage.svelte";
  import CompanyTabs from "$lib/components/companies/CompanyTabs.svelte";
  import WorkspacePanelSkeleton from "$lib/components/workspace/WorkspacePanelSkeleton.svelte";
  import { workPanelInline } from "$lib/components/shell/topBar";
  import ImportToolbar from "./ImportToolbar.svelte";
  import ImportSheet from "./ImportSheet.svelte";
  import ImportSearchResults from "./ImportSearchResults.svelte";
  import {
    filesFromCompaniesText,
    formatCount,
    searchText,
    SHEET_TABS,
    type SheetSearchCompany,
    type SheetTab,
  } from "./importFormat";

  const auth = useAuth();

  let tab = $state<SheetTab>("review");
  let search = $state("");
  /** The search text once typing settles; null shows the sheet. */
  let settled = $state<string | null>(null);
  let onlyToCheck = $state(false);
  let jump = $state<{ key: string } | null>(null);

  $effect(() => {
    const next = searchText(search);
    if (next === null) {
      // Clearing (or too short) returns to the sheet at once.
      settled = null;
      return;
    }
    if (next === untrack(() => settled)) return;
    const timer = setTimeout(() => (settled = next), 250);
    return () => clearTimeout(timer);
  });

  const reviewQ = useQuery(api.ingestion.sheetTotals, () => (auth.isAuthenticated ? { tab: "review" as const } : "skip"));
  const approvedQ = useQuery(api.ingestion.sheetTotals, () => (auth.isAuthenticated ? { tab: "approved" as const } : "skip"));
  const deletedQ = useQuery(api.ingestion.sheetTotals, () => (auth.isAuthenticated ? { tab: "deleted" as const } : "skip"));

  const totals = $derived({ review: reviewQ.data, approved: approvedQ.data, deleted: deletedQ.data });
  const current = $derived(totals[tab] ?? null);
  /** Not an admin: every sheet query answers null or nothing. */
  const denied = $derived(reviewQ.data === null);
  const loading = $derived(reviewQ.data === undefined && !reviewQ.error);
  const note = $derived(current ? filesFromCompaniesText(current) : null);
  // Only the review tab has files to check.
  const toCheck = $derived(tab === "review" && onlyToCheck);

  const tabs = $derived(
    SHEET_TABS.map((entry) => {
      const count = totals[entry.id];
      return { id: entry.id, label: entry.label, count: count ? formatCount(count.files) : null };
    })
  );

  function selectTab(next: SheetTab, focus: boolean) {
    tab = next;
    jump = null;
    if (focus) void tick().then(() => document.getElementById(`import-tab-${next}`)?.focus());
  }

  /**
   * A company found by the search: back to the sheet with it open. Only on
   * To review, where "To check" applies, is it turned off for a company that
   * it would hide; another tab leaves it as it is for when To review comes back.
   */
  function jumpTo(company: SheetSearchCompany) {
    if (toCheck && company.needsCheck === 0) onlyToCheck = false;
    search = "";
    settled = null;
    jump = { key: company.companyKey };
  }
</script>

<AdminWorkspacePage title="Import" count={denied ? null : note} flush>
  {#if denied}
    <p data-import-denied class={`${workPanelInline} mt-8 text-sm leading-[calc(10/7)] text-ink-muted`}>Admin access only.</p>
  {:else if loading}
    <div class={`${workPanelInline} pt-6`}>
      <WorkspacePanelSkeleton layout="list" label="Loading the import sheet" />
    </div>
  {:else}
    <div data-import-page class="flex flex-col">
      <div class={`flex shrink-0 border-b border-line-soft ${workPanelInline}`}>
        <CompanyTabs {tabs} active={tab} label="Import" idPrefix="import" onSelect={selectTab} />
      </div>
      <div
        role="tabpanel"
        id={`import-panel-${tab}`}
        aria-labelledby={`import-tab-${tab}`}
        class={`${workPanelInline} flex flex-col gap-4 pt-6 pb-10 lg:pt-8`}
      >
        <ImportToolbar
          bind:search
          bind:onlyToCheck
          toCheckCount={totals.review ? totals.review.needsCheck : null}
          showToCheck={tab === "review"}
        />
        {#if settled !== null}
          <ImportSearchResults {tab} text={settled} onJump={jumpTo} />
        {/if}
        <!-- Kept while searching, so open companies stay open. -->
        <div hidden={settled !== null}>
          {#key tab}
            <ImportSheet {tab} onlyToCheck={toCheck} {jump} />
          {/key}
        </div>
      </div>
    </div>
  {/if}
</AdminWorkspacePage>
