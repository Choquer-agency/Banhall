<!--
  The Projects page body (2026-10-14 amendment, "Saved clients, client
  merge, and the Projects page redesign"; Paper W1, V1, V4, W5, W6; the page
  frame of 2026-10-28, Paper S9). The white card holds the Projects section
  sidebar (Home, All projects and every company, `ClientList`) and the
  selected company on the right, each with its own scroll. `?client=<companyKey>` selects a client,
  `?scope=all` shows All projects and `?scope=starred` the person's starred
  projects. A bare `/projects` (2026-11-02, client request) opens the
  company this person viewed last, remembered in this browser per person,
  and falls back to All projects when there is none or it is gone or merged
  away; the address then names the company (a replace, not a new history
  entry). Choosing a client is a soft navigation that adds a history entry,
  so back and forward move between clients.

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
  import FrameCard from "$lib/components/workspace/FrameCard.svelte";
  import PageTopBar from "$lib/components/shell/PageTopBar.svelte";
  import ProjectCardDialogs from "./ProjectCardDialogs.svelte";
  import type { ProjectsTableRow } from "$lib/components/workspace/ProjectsTable.svelte";
  import type { DashboardProjectionRow } from "$lib/workspace/projectRowMapping";
  import { canCreateProjects } from "$lib/workspace/projectDuplicate";
  import { canDeleteProject } from "$lib/workspace/projectDelete";
  import { clientHref, projectsViewFromUrl, starredHref, type ClientEntry } from "$lib/projects/clientList";
  import {
    companyLanding,
    lastViewedCompany,
    pruneRecentCompanies,
    rememberRecentCompany,
  } from "$lib/workspace/recentCompanies";

  let {
    initialSearch = "",
    totalLabel = null,
    homeHref = "/my-work",
    homeAvailable = true,
    onOpenNavigation = undefined,
    onEditDetails = undefined,
    onBulkEdit = undefined,
  }: {
    /** The sidebar's Home row. */
    homeHref?: string;
    /** Home is switched off (the rollout kill switch): shown, not followed. */
    homeAvailable?: boolean;
    /** The hamburger in the company header between 768 and 1024px. */
    onOpenNavigation?: () => void;
    /** A search handed over from Home; it seeds the first search field shown. */
    initialSearch?: string;
    /** All projects count ("128", "1000+"). */
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
  const view = $derived(projectsViewFromUrl(page.url));

  // The landing (2026-11-02): a bare /projects opens the company viewed
  // last. Read again on every navigation, since viewing a company changes it.
  const remembered = $derived.by(() => {
    void page.url.href;
    return viewer?._id ? lastViewedCompany(viewer._id) : null;
  });
  const landing = $derived(
    view.kind === "all" && !view.explicit
      ? companyLanding(remembered, {
          data: clientsQ.data?.clients,
          failed: Boolean(clientsQ.error),
          truncated: clientsQ.data?.truncated ?? false,
        })
      : null
  );
  $effect(() => {
    if (landing?.kind !== "company") return;
    // The address names the company, in place of the bare landing.
    void goto(clientHref(page.url, landing.key), { replaceState: true, keepFocus: true, noScroll: true });
  });

  const starred = $derived(view.kind === "starred");
  const selectedKey = $derived(
    view.kind === "client" ? view.key : landing && landing.kind !== "all" ? landing.key : null
  );
  /** Names learned from New client and merges, until the list catches up. */
  const knownNames = new SvelteMap<string, string>();
  const selectedClient = $derived.by(() => {
    if (selectedKey === null) return null;
    const entry = clients.find((client) => client.key === selectedKey);
    const known = knownNames.get(selectedKey) ?? (landing && landing.kind !== "all" ? landing.name : null);
    // Gone from a complete, loaded list (merged, or an old link).
    const missing =
      !entry && known === null && clientsQ.data !== undefined && !clientsQ.data.truncated;
    return { key: selectedKey, name: entry?.name ?? known, missing };
  });

  // Rail v3 "Recent companies": the company opened here goes first, and the
  // complete company list refreshes names and drops merged companies.
  $effect(() => {
    const userId = viewer?._id;
    const opened = selectedClient;
    if (!userId || !opened?.name || opened.missing) return;
    rememberRecentCompany(userId, { key: opened.key, name: opened.name });
  });
  $effect(() => {
    const userId = viewer?._id;
    const data = clientsQ.data;
    if (!userId || !data || data.truncated) return;
    pruneRecentCompanies(userId, new Map(data.clients.map((client) => [client.key, client.name])));
  });

  // Starred: the person's starred projects (one bounded read, shared with
  // the cards' stars), and their count beside the sidebar row.
  const starsQ = useQuery(api.dashboard.listStarredProjects, () => (auth.isAuthenticated ? {} : "skip"));
  const starredCount = $derived(starsQ.data ? String(starsQ.data.length) : null);

  // Small screens: the area shows once a client, All clients or Starred is chosen.
  let mobileAll = $state(false);
  const areaOnMobile = $derived(selectedKey !== null || starred || mobileAll);

  // Home's search handoff seeds only the first client area shown.
  let navigated = $state(false);
  const searchSeed = $derived(navigated ? "" : initialSearch);

  function selectClient(key: string | null) {
    navigated = true;
    mobileAll = key === null;
    void goto(clientHref(page.url, key), { keepFocus: true, noScroll: true });
  }

  function selectStarred() {
    navigated = true;
    mobileAll = false;
    void goto(starredHref(page.url), { keepFocus: true, noScroll: true });
  }

  function backToList() {
    mobileAll = false;
    if (selectedKey !== null || starred) void goto(clientHref(page.url, null), { keepFocus: true, noScroll: true });
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
  // Edit details, bulk edit and delete (shared with the company page).
  let dialogs: ProjectCardDialogs | null = $state(null);

  const canDelete = (row: ProjectsTableRow) => canDeleteProject(viewer, row.createdBy, row.deleting);

  /** Focus the visible search field (rail search, Home's search handoff). */
  export function focusSearch(options: { select?: boolean } = {}) {
    area?.focusSearch(options);
  }
</script>

<!-- Paper S9: the one white card, the Projects sidebar on its left. Below
     768px the sidebar fills the card until a company (or All projects) is
     chosen. -->
<!-- Below 768px, where the Projects sidebar is the page itself, the phone
     keeps the standard bar: the hamburger, "Projects" with the count, the
     bell and New project. From 768px the sidebar holds the title and New
     project, and the company header is the bar with the page's h1. -->
{#if onOpenNavigation}
  <PageTopBar
    class="md:hidden"
    title="Projects"
    titleTag={areaOnMobile ? "p" : "h1"}
    count={totalLabel}
    primaryAction={{ label: "New project", href: resolve("/project/new") }}
    {onOpenNavigation}
  />
{/if}

<FrameCard data-projects-page class="flex-1" mainClass={areaOnMobile ? "" : "max-md:hidden"}>
  {#snippet sidebar()}
    {#key clientsAttempt}
      <ClientList
        {clients}
        truncated={clientsQ.data?.truncated ?? false}
        loading={clientsQ.data === undefined && !clientsQ.error}
        failed={Boolean(clientsQ.error)}
        {totalLabel}
        {selectedKey}
        current="projects"
        {homeHref}
        {homeAvailable}
        phone={areaOnMobile ? "hidden" : "full"}
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
        starredHref={starredHref(page.url)}
        starredActive={starred}
        {starredCount}
        onSelectStarred={selectStarred}
      />
    {/key}
  {/snippet}

  <div class="flex min-h-0 min-w-0 flex-1 flex-col">
    {#key areaAttempt}
      <ClientArea
        bind:this={area}
        client={selectedClient}
        starredView={starred}
        initialSearch={searchSeed}
        {canCreate}
        canDuplicate={canCreate}
        {canSelect}
        allClientsHref={clientHref(page.url, null)}
        onShowAll={() => selectClient(null)}
        {canDelete}
        onEditDetails={(projectId) => dialogs?.editDetails(projectId)}
        onDuplicate={(projectId) => dialogs?.duplicate(projectId)}
        onDelete={(project) => dialogs?.requestDelete(project)}
        onBulkEdit={(rows) => dialogs?.bulkEdit(rows)}
        onRetry={() => (areaAttempt += 1)}
        onBack={backToList}
        {onOpenNavigation}
        backLabel="Projects"
        countLabel={starred
          ? starredCount
          : selectedKey === null
          ? totalLabel
          : (() => {
              const count = clients.find((client) => client.key === selectedKey)?.projectCount;
              return count === undefined ? null : String(count);
            })()}
      />
    {/key}
  </div>
</FrameCard>

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

<ProjectCardDialogs bind:this={dialogs} {viewer} {area} {onEditDetails} {onBulkEdit} />
