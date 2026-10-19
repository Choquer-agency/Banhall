<!--
  The Projects page body (2026-10-14 amendment, "Saved clients, client
  merge, and the Projects page redesign"; Paper W1, V1, V4, W5, W6). A
  client list on the left with its own scroll and the selected client on the
  right with its own scroll. `?client=<companyKey>` selects a client; no
  param shows All clients. Choosing a client is a soft navigation that adds a
  history entry, so back and forward move between clients.

  Below `md` the client list fills the width; choosing a client (or All
  clients) shows the client area with a back link.

  Edit details on a card opens ProjectEditPanel and Edit details in the
  selection bar opens BulkEditPanel, both centered dialogs (Paper Z7m to
  Z7p, 2026-10-19). A host may take either over with
  `onEditDetails(projectId)` or `onBulkEdit(rows)`.
-->
<script lang="ts">
  import { tick } from "svelte";
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { page } from "$app/state";
  import { SvelteMap } from "svelte/reactivity";
  import { useQuery } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { api } from "../../../../convex/_generated/api";
  import ClientList from "./ClientList.svelte";
  import ClientArea from "./ClientArea.svelte";
  import MergeClientsDialog, { type MergeResult } from "./MergeClientsDialog.svelte";
  import NewClientDialog, { type NewClientResult } from "$lib/components/clients/NewClientDialog.svelte";
  import DeleteProjectDialog from "$lib/components/workspace/DeleteProjectDialog.svelte";
  import ProjectEditPanel from "./ProjectEditPanel.svelte";
  import BulkEditPanel from "./BulkEditPanel.svelte";
  import type { ProjectsTableRow } from "$lib/components/workspace/ProjectsTable.svelte";
  import type { DashboardProjectionRow } from "$lib/workspace/projectRowMapping";
  import { canCreateProjects, duplicateProjectSearch } from "$lib/workspace/projectDuplicate";
  import { canDeleteProject } from "$lib/workspace/projectDelete";
  import { clientHref, clientKeyFromUrl, type ClientEntry } from "$lib/projects/clientList";

  let {
    initialSearch = "",
    totalLabel = null,
    onEditDetails = undefined,
    onBulkEdit = undefined,
  }: {
    /** A search handed over from Home; it seeds the first search field shown. */
    initialSearch?: string;
    /** All clients count, from the top bar ("128", "1000+"). */
    totalLabel?: string | null;
    /** Edit details on a card. Default: the Edit details dialog. */
    onEditDetails?: (projectId: string) => void;
    /** Edit details for a selection. Default: the bulk edit dialog. */
    onBulkEdit?: (rows: DashboardProjectionRow[]) => void;
  } = $props();

  const auth = useAuth();
  const userQ = useQuery(api.users.getCurrentUser, () => (auth.isAuthenticated ? {} : "skip"));
  // Try again drops the failed subscription for a moment and subscribes
  // afresh; remounting the list alone would keep the cached error.
  let retryingClients = $state(false);
  const clientsQ = useQuery(api.clients.listClients, () =>
    auth.isAuthenticated && !retryingClients ? {} : "skip"
  );
  async function retryClients() {
    retryingClients = true;
    await tick();
    retryingClients = false;
  }

  const viewer = $derived(userQ.data ?? null);
  const role = $derived(viewer && viewer.isAnonymous !== true ? (viewer.role ?? null) : null);
  const canCreate = $derived(canCreateProjects(viewer));
  const canMerge = $derived(role === "manager" || role === "admin");
  // Select and bulk edit: the roles bulkUpdateProjects accepts. Unknown (still
  // loading) reads as no.
  const canSelect = $derived(role === "writer" || role === "manager" || role === "admin");

  const clients = $derived((clientsQ.data?.clients ?? []) as ClientEntry[]);
  const selectedKey = $derived(clientKeyFromUrl(page.url));
  /** Names learned from New client and merges, until the list catches up. */
  const knownNames = new SvelteMap<string, string>();
  const selectedClient = $derived.by(() => {
    if (selectedKey === null) return null;
    const entry = clients.find((client) => client.key === selectedKey);
    const known = knownNames.get(selectedKey) ?? null;
    // Gone from a complete, loaded list (merged, or an old link).
    const missing =
      !entry && known === null && clientsQ.data !== undefined && !clientsQ.data.truncated;
    return { key: selectedKey, name: entry?.name ?? known, missing };
  });

  // Small screens: the area shows once a client, or All clients, is chosen.
  let mobileAll = $state(false);
  const areaOnMobile = $derived(selectedKey !== null || mobileAll);

  // Home's search handoff seeds only the first client area shown.
  let navigated = $state(false);
  const searchSeed = $derived(navigated ? "" : initialSearch);

  function selectClient(key: string | null) {
    navigated = true;
    mobileAll = key === null;
    void goto(clientHref(page.url, key), { keepFocus: true, noScroll: true });
  }

  function backToList() {
    mobileAll = false;
    if (selectedKey !== null) void goto(clientHref(page.url, null), { keepFocus: true, noScroll: true });
  }

  // Retry remounts the failed subscription. Changing client does not remount
  // the area; it resets its search and selection in place.
  let clientsAttempt = $state(0);
  let areaAttempt = $state(0);

  // ─── New client ───────────────────────────────────────────────────────────
  let newClientOpen = $state(false);
  function onClientCreated(created: NewClientResult) {
    knownNames.set(created.key, created.name);
    selectClient(created.key);
  }

  // ─── Merge ────────────────────────────────────────────────────────────────
  let mergeMode = $state(false);
  let mergeKeys = $state<string[]>([]);
  let mergeOpen = $state(false);
  const mergeClients = $derived(
    mergeKeys
      .map((key) => clients.find((client) => client.key === key))
      .filter((client): client is ClientEntry => client !== undefined)
  );

  function toggleMerge(key: string) {
    mergeKeys = mergeKeys.includes(key) ? mergeKeys.filter((k) => k !== key) : [...mergeKeys, key];
  }

  function endMerge() {
    mergeMode = false;
    mergeKeys = [];
  }

  function onMerged(result: MergeResult) {
    knownNames.set(result.keptKey, result.keptName);
    endMerge();
    navigated = true;
    mobileAll = false;
    // The dialog unmounts as the list updates, so focus would fall to the
    // page body: put it on the kept client's row, or on the client title.
    // On small screens the list is hidden, so only a visible target counts.
    void goto(clientHref(page.url, result.keptKey), { keepFocus: true, noScroll: true })
      .then(async () => {
        await tick();
        requestAnimationFrame(() => {
          const candidates = [
            document.querySelector<HTMLElement>(`[data-client-row="${CSS.escape(result.keptKey)}"]`),
            document.querySelector<HTMLElement>("[data-client-title]"),
          ];
          candidates.find((node) => node !== null && node.getClientRects().length > 0)?.focus();
        });
      })
      .catch(() => {
        // An aborted navigation leaves focus where it was.
      });
  }

  // ─── Card actions ─────────────────────────────────────────────────────────
  let area: {
    selectedRows: () => DashboardProjectionRow[];
    clearSelection: () => void;
    endSelect: () => void;
    focusSearch: (options?: { select?: boolean }) => void;
  } | null = $state(null);
  let deleteTarget = $state<{ id: string; title: string } | null>(null);
  let deleteOpen = $state(false);
  // The bulk dialog follows the live selection: it holds the projects picked
  // when it opened that are still selected, with their latest values. A
  // project that leaves the visible set drops out of the selection
  // (ClientArea) and so out of the dialog; it closes once none is left.
  let bulkIds = $state<ReadonlySet<string>>(new Set());
  let bulkOpen = $state(false);
  const bulkRows = $derived.by(() => {
    if (!area) return [];
    return area.selectedRows().filter((row) => bulkIds.has(row._id));
  });
  $effect(() => {
    if (bulkOpen && bulkRows.length === 0) bulkOpen = false;
  });
  let editProjectId = $state<string | null>(null);
  let editOpen = $state(false);

  /** The card's "..." trigger, where focus goes back after the dialog. */
  function cardMenuTrigger(projectId: string | null) {
    if (projectId === null) return null;
    return document.querySelector<HTMLElement>(`[data-card-menu="${CSS.escape(projectId)}"]`);
  }

  function editDetails(projectId: string) {
    if (onEditDetails) {
      onEditDetails(projectId);
      return;
    }
    editProjectId = projectId;
    editOpen = true;
  }

  function duplicate(projectId: string) {
    void goto(`${resolve("/project/new")}${duplicateProjectSearch(projectId)}`);
  }

  function requestDelete(project: { id: string; title: string }) {
    deleteTarget = project;
    deleteOpen = true;
  }

  function bulkEdit(rows: DashboardProjectionRow[]) {
    if (onBulkEdit) {
      onBulkEdit(rows);
      return;
    }
    bulkIds = new Set(rows.map((row) => row._id));
    bulkOpen = true;
  }

  /** Applied: clear the selection and keep the page where it is. */
  function onBulkApplied() {
    area?.endSelect();
  }

  function bulkReturnFocus() {
    return (
      document.querySelector<HTMLElement>("[data-selection-edit]") ??
      document.querySelector<HTMLElement>("[data-client-title]")
    );
  }

  const canDelete = (row: ProjectsTableRow) => canDeleteProject(viewer, row.createdBy, row.deleting);

  /** Focus the visible search field (rail search, Home's search handoff). */
  export function focusSearch(options: { select?: boolean } = {}) {
    area?.focusSearch(options);
  }
</script>

<!-- Paper Z3d: the white panel under the top bar, the company list on its left. -->
<div data-projects-page class="flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-xl border border-line bg-surface">
  <aside
    aria-label="Companies"
    class={`flex min-h-0 w-60 shrink-0 flex-col border-r border-line-soft max-md:w-full max-md:border-r-0 ${areaOnMobile ? "max-md:hidden" : ""}`}
  >
    {#key clientsAttempt}
      <ClientList
        {clients}
        truncated={clientsQ.data?.truncated ?? false}
        loading={clientsQ.data === undefined && !clientsQ.error}
        failed={Boolean(clientsQ.error)}
        {totalLabel}
        {selectedKey}
        hrefFor={(key) => clientHref(page.url, key)}
        onSelect={selectClient}
        {canCreate}
        {canMerge}
        onNewClient={() => (newClientOpen = true)}
        {mergeMode}
        {mergeKeys}
        onStartMerge={() => (mergeMode = true)}
        onEndMerge={endMerge}
        onToggleMerge={toggleMerge}
        onMerge={() => (mergeOpen = true)}
        onRetry={() => { clientsAttempt += 1; void retryClients(); }}
      />
    {/key}
  </aside>

  <div class={`flex min-h-0 min-w-0 flex-1 flex-col ${areaOnMobile ? "" : "max-md:hidden"}`}>
    {#key areaAttempt}
      <ClientArea
        bind:this={area}
        client={selectedClient}
        initialSearch={searchSeed}
        {canCreate}
        canDuplicate={canCreate}
        {canSelect}
        allClientsHref={clientHref(page.url, null)}
        onShowAll={() => selectClient(null)}
        {canDelete}
        onEditDetails={editDetails}
        onDuplicate={duplicate}
        onDelete={requestDelete}
        onBulkEdit={bulkEdit}
        onRetry={() => (areaAttempt += 1)}
        onBack={backToList}
        backLabel={selectedKey === null ? "Companies" : "All companies"}
        countLabel={selectedKey === null
          ? totalLabel
          : (() => {
              const count = clients.find((client) => client.key === selectedKey)?.projectCount;
              return count === undefined ? null : String(count);
            })()}
      />
    {/key}
  </div>
</div>

{#if canCreate}
  <NewClientDialog
    bind:open={newClientOpen}
    canAddIndustry={role === "admin"}
    onCreated={onClientCreated}
  />
{/if}

{#if canMerge && mergeClients.length >= 2}
  <MergeClientsDialog bind:open={mergeOpen} clients={mergeClients} {onMerged} />
{/if}

{#if deleteTarget}
  <DeleteProjectDialog bind:open={deleteOpen} projectId={deleteTarget.id} projectTitle={deleteTarget.title} />
{/if}

{#if !onEditDetails}
  <ProjectEditPanel
    bind:open={editOpen}
    projectId={editProjectId}
    {viewer}
    returnFocus={() => cardMenuTrigger(editProjectId)}
  />
{/if}

{#if !onBulkEdit}
  <BulkEditPanel
    bind:open={bulkOpen}
    rows={bulkRows}
    {viewer}
    returnFocus={bulkReturnFocus}
    onApplied={onBulkApplied}
  />
{/if}
