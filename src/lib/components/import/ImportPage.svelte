<!--
  The Import page (/admin/import, 2026-11-11 phase 3a, boards ao3 and ao5):
  one sheet for every company's imported files. The top bar reads "Import"
  with "N files from M companies"; then the tabs To review, Approved and
  Deleted with their counts (the company page's underlined tabs, as the
  boards draw them); then one toolbar row and the sheet, or the search
  results in its place. Admin only: sheetTotals is null for anyone else, and
  the page says so. The route keeps the sign-in check and mounts this.

  Phase 3b (boards ao4 to ao6): a file's cells change its labels, and
  "Select" picks files for the dark bar at the bottom. The selection lives
  here, above the sheet, so "To check" and opening and closing companies
  keep it. A tab change turns Select off and clears it; while a search
  shows, the bar hides and Select is off. Approved is read only.

  Adding files (2026-11-12, Paper Files 1 to 3): the top bar holds "Get the
  uploader" and "Add files"; files or a folder dropped anywhere on the page
  are added the same way (ImportDropZone). This tab sends them
  (importUploads); once the first is in, the page shows To review with the
  New filter on. "New N" sits beside "To check" while any file is New, and
  one plain line under the toolbar says what is arriving
  (ImportStatusLine). The History tab lists every batch. The sender warns
  before the tab is closed while it checks or sends, on any page.

  Approve on Import (2026-11-17): "Approve N ready" on a company and Approve
  in the selection bar put files on their company's page; the line under
  the toolbar (ImportApprovalLine) says how far an approval is and why any
  file was left. The Brain check tab, after Approved with its count, shows
  each approved final PD's scrubbed Brain copy for a person to add or keep
  out (ImportBrainCheck). A file's name, or Open in its menu, opens the file
  view (ImportFilePanel), held here for every row.

  Final PD progress (2026-11-17, a client meeting): above each tab's own
  content, "312 of 1,040 final PDs approved" with a thin bar and the note
  that the total is the final PDs added so far; it opens the breakdown by
  fiscal year and by writer (ImportProgressLine).
-->
<script lang="ts">
  import { onMount, tick, untrack } from "svelte";
  import { useConvexClient, useMutation, useQuery } from "convex-svelte";
  import { toast } from "svelte-sonner";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { api } from "../../../../convex/_generated/api";
  import WorkspaceChrome from "$lib/components/workspace/WorkspaceChrome.svelte";
  import CompanyTabs from "$lib/components/companies/CompanyTabs.svelte";
  import WorkspacePanelSkeleton from "$lib/components/workspace/WorkspacePanelSkeleton.svelte";
  import { workPanelInline } from "$lib/components/shell/topBar";
  import ImportToolbar from "./ImportToolbar.svelte";
  import ImportSheet from "./ImportSheet.svelte";
  import ImportSearchResults from "./ImportSearchResults.svelte";
  import ImportSelectionBar from "./ImportSelectionBar.svelte";
  import ImportHeaderActions from "./ImportHeaderActions.svelte";
  import ImportDropZone from "./ImportDropZone.svelte";
  import ImportStatusLine from "./ImportStatusLine.svelte";
  import ImportHistory from "./ImportHistory.svelte";
  import ImportApprovalLine from "./ImportApprovalLine.svelte";
  import ImportBrainCheck from "./ImportBrainCheck.svelte";
  import ImportFilePanel from "./ImportFilePanel.svelte";
  import ImportProgressLine from "./ImportProgressLine.svelte";
  import { provideFileView } from "./importFileView";
  import { ImportSelection } from "./importSelection.svelte";
  import { canSelect } from "./importEdit";
  import { IMPORT_TOAST } from "./importActions";
  import { importUploads, type AddCallbacks } from "./importUploads.svelte";
  import type { IntakeFile } from "./importIntake";
  import { userErrorMessage } from "$lib/errors";
  import {
    filesFromCompaniesText,
    formatCount,
    searchText,
    SHEET_TABS,
    type SheetFileRow,
    type SheetSearchCompany,
    type SheetTab,
  } from "./importFormat";

  const auth = useAuth();

  /**
   * The sheet's tabs, Brain check after Approved (2026-11-17, its count the
   * final PDs waiting), then History (2026-11-12), which has no count and no sheet.
   */
  type PageTab = SheetTab | "brain" | "history";
  let tab = $state<PageTab>("review");
  let search = $state("");
  /** The search text once typing settles; null shows the sheet. */
  let settled = $state<string | null>(null);
  let onlyToCheck = $state(false);
  /** The New filter (2026-11-12); never on with "To check". */
  let onlyNew = $state(false);
  let jump = $state<{ key: string } | null>(null);
  const selection = new ImportSelection();

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
  // History has no sheet: the top bar keeps To review's count there; Brain check keeps Approved's.
  const current = $derived(totals[tab === "history" ? "review" : tab === "brain" ? "approved" : tab] ?? null);
  /** Not an admin: every sheet query answers null or nothing. */
  const denied = $derived(reviewQ.data === null);
  const loading = $derived(reviewQ.data === undefined && !reviewQ.error);
  const note = $derived(current ? filesFromCompaniesText(current) : null);
  // Only the review tab has files to check, or New files.
  const toCheck = $derived(tab === "review" && onlyToCheck);
  const newFiles = $derived(totals.review?.newFiles ?? 0);
  const onlyNewShown = $derived(tab === "review" && onlyNew);
  // The 24 hours of the last New file ran out: the filter goes with its chip.
  $effect(() => {
    if (onlyNew && totals.review && newFiles === 0 && !importUploads.busy) onlyNew = false;
  });

  const brainWaiting = $derived(totals.approved?.brainCheck ?? null);
  const tabs = $derived([
    ...SHEET_TABS.flatMap((entry) => {
      const count = totals[entry.id];
      const tabEntry = { id: entry.id as PageTab, label: entry.label, count: count ? formatCount(count.files) : null };
      return entry.id === "approved"
        ? [tabEntry, { id: "brain" as PageTab, label: "Brain check", count: brainWaiting === null ? null : formatCount(brainWaiting) }]
        : [tabEntry];
    }),
    { id: "history" as PageTab, label: "History", count: null },
  ]);

  /** Searching hides the sheet, so nobody acts on rows they cannot see. */
  const searching = $derived(settled !== null);
  /** The sheet's tab, or null on Brain check and History. */
  const sheetTab = $derived(tab === "history" || tab === "brain" ? null : tab);

  let pageRoot = $state<HTMLElement | null>(null);

  // ─── The file view (2026-11-17, Paper Files 7 & 8) ──────────────────────
  let openFile = $state<SheetFileRow["_id"] | null>(null);
  let panelFileIds = $state<SheetFileRow["_id"][]>([]);

  function readVisibleFileIds(): SheetFileRow["_id"][] {
    if (!pageRoot) return [];
    const scope = searching
      ? pageRoot.querySelector<HTMLElement>("[data-import-search-results]")
      : pageRoot.querySelector<HTMLElement>("[data-import-sheet-container]");
    if (!scope) return [];
    const ids = new Set<SheetFileRow["_id"]>();
    for (const element of scope.querySelectorAll<HTMLElement>("[data-import-file]")) {
      const value = element.dataset.importFile as SheetFileRow["_id"] | undefined;
      if (value) ids.add(value);
    }
    return [...ids];
  }

  function openFileView(id: SheetFileRow["_id"]) {
    const visible = readVisibleFileIds();
    panelFileIds = visible.includes(id) ? visible : [id];
    openFile = id;
  }

  function stepFileAfterRemoval(removedId: SheetFileRow["_id"]) {
    selection.remove([removedId]);
    const index = panelFileIds.indexOf(removedId);
    const remaining = panelFileIds.filter((entry) => entry !== removedId);
    panelFileIds = remaining;
    if (openFile !== removedId) return;
    if (remaining.length === 0) {
      openFile = null;
      return;
    }
    const nextIndex = index >= 0 && index < remaining.length ? index : remaining.length - 1;
    openFile = remaining[nextIndex];
  }

  provideFileView({ open: openFileView });
  /** Select applies to To review and Deleted. */
  const selectable = $derived(sheetTab !== null && canSelect(sheetTab));

  // ─── Adding files ───────────────────────────────────────────────────────
  const client = useConvexClient();
  const generateUploadUrl = useMutation(api.ingestion.generateUploadUrl);
  const startBatch = useMutation(api.ingestion.startImportBatch);
  const stage = useMutation(api.ingestion.stageImportFiles);
  const finish = useMutation(api.ingestion.finishImportBatch);
  const reopen = useMutation(api.ingestion.reopenImportBatch);
  onMount(() => {
    importUploads.connect({
      filesHere: (hashes) => client.query(api.ingestion.importFilesHere, { hashes }),
      startBatch: (args) => startBatch(args),
      generateUploadUrl: () => generateUploadUrl({}),
      stage: (args) => stage(args),
      finish: (args) => finish(args),
      reopen: (args) => reopen(args),
      // Looked up at each call, so a test can stand in for the network.
      fetch: (input, init) => globalThis.fetch(input, init),
    });
  });
  // The close-tab warning lives with the sender (importUploads), so it stays
  // while files are sent after this page unmounts.

  const uploadCallbacks: AddCallbacks = {
    onLeftOut: (text) => toast(text, IMPORT_TOAST),
    // The person's own files are in: show what just arrived.
    onFirstAdded: () => {
      onlyToCheck = false;
      onlyNew = true;
    },
    onError: (error) => toast.error(userErrorMessage(error, "The files could not be added."), IMPORT_TOAST),
  };

  /** Dropped or picked files: To review, the sheet in view, and this tab sends them. */
  function addFiles(files: IntakeFile[]) {
    if (tab !== "review") selectTab("review", false);
    search = "";
    settled = null;
    void importUploads.add(files, uploadCallbacks);
  }

  function selectTab(next: PageTab, focus: boolean) {
    if (next !== tab) selection.setOn(false);
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
    // The New filter may hide it too; show it among every company.
    if (onlyNewShown) onlyNew = false;
    search = "";
    settled = null;
    jump = { key: company.companyKey };
  }
</script>

<WorkspaceChrome title="Import" count={denied ? null : note} panel="flush" viewAsGate="admin">
  {#snippet actions()}
    {#if !denied && !loading}
      <ImportHeaderActions onFiles={addFiles} />
    {/if}
  {/snippet}
  {#if denied}
    <p data-import-denied class={`${workPanelInline} mt-8 text-sm leading-[calc(10/7)] text-ink-muted`}>Admin access only.</p>
  {:else if loading}
    <div class={`${workPanelInline} pt-6`}>
      <WorkspacePanelSkeleton layout="list" label="Loading the import sheet" />
    </div>
  {:else}
    <div bind:this={pageRoot} data-import-page class="flex flex-col">
      <div class={`flex shrink-0 border-b border-line-soft ${workPanelInline}`}>
        <CompanyTabs {tabs} active={tab} label="Import" idPrefix="import" onSelect={selectTab} />
      </div>
      <div
        role="tabpanel"
        id={`import-panel-${tab}`}
        aria-labelledby={`import-tab-${tab}`}
        class={`${workPanelInline} flex flex-col gap-3.5 pt-4 pb-12 lg:pt-5`}
      >
        <!-- Final PD progress (2026-11-17): the whole Import, so on every tab. -->
        <ImportProgressLine />
        {#if tab === "brain"}
          <ImportBrainCheck total={brainWaiting} />
        {:else if sheetTab === null}
          <ImportHistory />
        {:else}
          <ImportToolbar
            bind:search
            bind:onlyToCheck
            bind:onlyNew
            toCheckCount={totals.review ? totals.review.needsCheck : null}
            newCount={newFiles}
            showToCheck={tab === "review"}
            showSelect={selectable}
            selectOn={selection.on}
            selectDisabled={searching}
            onSelectChange={(on) => selection.setOn(on)}
          />
          {#if tab === "review"}
            <ImportStatusLine onRetry={() => void importUploads.retry(uploadCallbacks)} />
          {/if}
          {#if tab === "review" || tab === "approved"}
            <ImportApprovalLine />
          {/if}
          {#if settled !== null}
            <ImportSearchResults tab={sheetTab} text={settled} onJump={jumpTo} />
          {/if}
          <!-- Kept while searching, so open companies stay open. -->
          <div data-import-sheet-container hidden={searching}>
            {#key sheetTab}
              <ImportSheet
                tab={sheetTab}
                onlyToCheck={toCheck}
                onlyNew={onlyNewShown}
                companiesOnTab={current?.companies ?? null}
                {jump}
                selection={selectable ? selection : null}
              />
            {/key}
          </div>
        {/if}
      </div>
    </div>
    {#if selectable && sheetTab !== null && !searching && selection.on && selection.size > 0}
      <ImportSelectionBar {selection} tab={sheetTab} />
    {/if}
    <ImportDropZone anchor={pageRoot} onFiles={addFiles} />
    <ImportFilePanel
      id={openFile}
      fileIds={panelFileIds}
      onSelectFile={(nextId) => (openFile = nextId)}
      onRemoved={stepFileAfterRemoval}
      onClose={() => (openFile = null)}
    />
  {/if}
</WorkspaceChrome>
