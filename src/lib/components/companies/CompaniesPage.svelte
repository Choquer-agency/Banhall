<!--
  The Companies section (owner, 2026-10-28): `/companies` (All companies)
  and `/companies/<key>` (one company's page), in the page frame with the
  Companies sidebar. The route only adds the sign-in redirect and the
  title; everything else is here so the component suite can mount it.

  All companies: the bar reads "Companies" with the count and "Search
  companies" on the right; the panel is the company table, with the
  Companies sidebar. A company (2026-11-04, the company profile): no
  sidebar; the bar reads "Companies / <company switcher>" with Edit company
  (Managers and Admins) and New project (this company filled in); the panel
  is CompanyView with its tabs, the address keeping the tab (`?tab=`). A
  key a merge took away opens the company it ended up in, with the merge
  note once; a key with no company says so, with a link to All companies.

  Section controls follow the effective viewer (View as): New company and
  New project for those who may create projects, Edit company, the summary's
  Edit, Read again and Merge companies for Managers and Admins, Files for
  those who may read company files, People for those who may read contacts.
-->
<script lang="ts">
  import { tick, untrack } from "svelte";
  import { goto, replaceState } from "$app/navigation";
  import { page } from "$app/state";
  import { resolve } from "$app/paths";
  import { useQuery } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { api } from "../../../../convex/_generated/api";
  import WorkspaceChrome from "$lib/components/workspace/WorkspaceChrome.svelte";
  import WorkspacePanelSkeleton from "$lib/components/workspace/WorkspacePanelSkeleton.svelte";
  import { IconSearch } from "$lib/components/icons";
  import NewClientDialog, { type NewClientResult } from "$lib/components/clients/NewClientDialog.svelte";
  import EditCompanyDialog from "$lib/components/clients/EditCompanyDialog.svelte";
  import type { MergeResult } from "$lib/components/projects/MergeClientsDialog.svelte";
  import { effectiveViewer } from "$lib/shell/viewAs.svelte";
  import { newProjectSearch } from "$lib/projects/clientList";
  import {
    closeMergedNote,
    companiesPath,
    companyCountLabel,
    companyKeyFromPath,
    companyTabFromParam,
    mergedNoteClosed,
    type CompanyTab,
  } from "$lib/companies/companies";
  import { hasCapability } from "../../../../shared/capabilities";
  import CompaniesSidebar from "./CompaniesSidebar.svelte";
  import AllCompaniesTable, { type CompanyRow } from "./AllCompaniesTable.svelte";
  import CompanyView from "./CompanyView.svelte";
  import CompanySwitcher from "./CompanySwitcher.svelte";

  /** The query parameter that carries the old key after a merged link (the note's source). */
  const MERGED_PARAM = "merged";
  /** The query parameter that keeps a company page's tab (2026-11-04). */
  const TAB_PARAM = "tab";

  let {
    companyKey,
    documentTitle = $bindable("Companies"),
  }: {
    /** The company key from the address, or null on All companies. */
    companyKey: string | null;
    /** The page's name for the browser tab (the route sets the title). */
    documentTitle?: string;
  } = $props();

  const auth = useAuth();
  const root = resolve("/");
  const userQ = useQuery(api.users.getCurrentUser, () => (auth.isAuthenticated ? {} : "skip"));
  const user = $derived(userQ.data ?? null);
  const signedIn = $derived(user !== null && user.isAnonymous !== true);
  const viewer = $derived(effectiveViewer(signedIn ? user : null));
  const role = $derived(viewer.role);
  const canCreate = $derived(signedIn && hasCapability(role, "project.create"));
  const canManage = $derived(signedIn && (role === "manager" || role === "admin"));
  const canReadFiles = $derived(signedIn && hasCapability(role, "companyFiles.read"));
  const canAddFiles = $derived(signedIn && hasCapability(role, "companyFiles.add"));
  const canManageFiles = $derived(signedIn && hasCapability(role, "companyFiles.manage"));
  const canReadContacts = $derived(signedIn && hasCapability(role, "companyContacts.read"));
  const canManageContacts = $derived(signedIn && hasCapability(role, "companyContacts.manage"));

  // ─── All companies ────────────────────────────────────────────────────────
  const clientsQ = useQuery(api.clients.listClients, () =>
    auth.isAuthenticated && companyKey === null ? {} : "skip"
  );
  const companies = $derived((clientsQ.data?.clients ?? []) as CompanyRow[]);
  let search = $state("");
  let searchEl: HTMLInputElement | null = $state(null);

  // ─── One company ──────────────────────────────────────────────────────────
  // The old key an old link came from is read once per company, so closing
  // its note (which drops it from the address) leaves the read as it is and
  // the page stays mounted: tab, scroll, selection, dialogs and uploads.
  const mergedFrom = $derived.by(() => {
    void companyKey;
    return untrack(() => page.url.searchParams.get(MERGED_PARAM) || null);
  });
  const companyQ = useQuery(api.clients.getCompanyPage, () =>
    auth.isAuthenticated && companyKey !== null
      ? { key: companyKey, ...(mergedFrom ? { mergedFrom } : {}) }
      : "skip"
  );
  const pageData = $derived(companyKey !== null ? companyQ.data : undefined);
  const company = $derived(pageData?.kind === "company" ? pageData : null);

  // A key a merge took away opens the company it ended up in; the old key
  // rides along so that page can say what happened, once.
  $effect(() => {
    const data = pageData;
    const from = companyKey;
    if (data?.kind !== "merged" || from === null) return;
    void goto(
      `${companiesPath(root, data.key)}?${new URLSearchParams({ [MERGED_PARAM]: from }).toString()}`,
      { replaceState: true, noScroll: true }
    );
  });

  let closedNotes = $state<string[]>([]);
  const note = $derived.by(() => {
    const merged = company?.mergedNote;
    if (!merged || closedNotes.includes(merged.noteId) || mergedNoteClosed(merged.noteId)) return null;
    return merged;
  });
  function closeNote() {
    if (!company?.mergedNote) return;
    const noteId = company.mergedNote.noteId;
    closeMergedNote(noteId);
    closedNotes = [...closedNotes, noteId];
    // A shallow change of the address only: no navigation, no new read.
    const url = new URL(page.url);
    url.searchParams.delete(MERGED_PARAM);
    replaceState(`${url.pathname}${url.search}${url.hash}`, page.state);
    // The note held focus on its close button, which is gone now.
    void tick().then(() =>
      (document.querySelector<HTMLElement>("[data-edit-company]") ?? document.querySelector<HTMLElement>("[data-page-title]"))?.focus()
    );
  }

  // ─── Tabs (2026-11-04): the address keeps the tab (`?tab=`) ───────────────
  const tabs = $derived<CompanyTab[]>([
    "overview",
    ...(canReadFiles ? (["files"] as const) : []),
    ...(canReadContacts ? (["people"] as const) : []),
    "activity",
    "details",
  ]);
  // Read from the address on arrival and on a real navigation (another
  // company, Back); a tab change only writes it (shallowly, so the page and
  // its uploads stay), so the tab chosen here wins until the address moves.
  let chosenTab = $state<{ url: string; tab: CompanyTab } | null>(null);
  const addressTab = $derived(companyTabFromParam(page.url.searchParams.get(TAB_PARAM), tabs));
  const tab = $derived(chosenTab && chosenTab.url === page.url.href && tabs.includes(chosenTab.tab) ? chosenTab.tab : addressTab);
  function selectTab(next: CompanyTab, focus = false) {
    chosenTab = { url: page.url.href, tab: next };
    const url = new URL(page.url);
    if (next === "overview") url.searchParams.delete(TAB_PARAM);
    else url.searchParams.set(TAB_PARAM, next);
    // The merge note's old key leaves the address once the note is closed.
    if (!note) url.searchParams.delete(MERGED_PARAM);
    replaceState(`${url.pathname}${url.search}${url.hash}`, page.state);
    if (focus) void tick().then(() => document.getElementById(`company-tab-${next}`)?.focus());
  }

  // ─── Navigation, New company, Edit company ────────────────────────────────
  function openCompany(key: string | null, options: { replace?: boolean } = {}) {
    void goto(companiesPath(root, key), { keepFocus: true, noScroll: true, replaceState: options.replace ?? false });
  }

  let newCompanyOpen = $state(false);
  function onCompanyCreated(created: NewClientResult) {
    openCompany(created.key);
  }

  let editOpen = $state(false);
  /**
   * A rename's new key while the page moves there: the old key stops being
   * a company at once, so the page holds its shape instead of saying the
   * company does not exist.
   */
  let movingTo = $state<string | null>(null);
  /** The key the rename started from: any other address ends the hold. */
  let movingFrom = $state<string | null>(null);
  /** After a rename, focus goes to the moved page's Edit company (or its title) once it is drawn. */
  let focusKey = $state<string | null>(null);
  function stopMoving() {
    movingTo = null;
    movingFrom = null;
    focusKey = null;
  }
  $effect(() => {
    if (movingTo === null) return;
    if (companyKey === movingTo) {
      // Arrived: the page draws the company; focus follows once it is there.
      movingTo = null;
      movingFrom = null;
    } else if (companyKey !== movingFrom) {
      // Somewhere else first (another company, All companies, Back).
      stopMoving();
    }
  });
  $effect(() => {
    if (focusKey === null || movingTo !== null) return;
    if (companyKey !== focusKey) {
      focusKey = null;
      return;
    }
    if (company?.key !== focusKey) return;
    focusKey = null;
    void tick().then(() =>
      (document.querySelector<HTMLElement>("[data-edit-company]") ?? document.querySelector<HTMLElement>("[data-page-title]"))?.focus()
    );
  });
  function onCompanySaved(result: { key: string }) {
    // A rename moves the company to its new key's address.
    if (result.key === companyKey) return;
    const to = result.key;
    movingTo = to;
    movingFrom = companyKey;
    focusKey = to;
    void goto(companiesPath(root, to), { keepFocus: true, noScroll: true, replaceState: true })
      .catch(() => {
        // An aborted navigation is handled below.
      })
      .finally(() => {
        // The navigation settled without reaching the new key (aborted, or
        // overtaken by another): stop holding the page.
        const reached = companyKeyFromPath(page.url.pathname.slice(root.length - 1));
        if (movingTo === to && reached !== to) stopMoving();
      });
  }

  function onMerged(result: MergeResult) {
    openCompany(result.keptKey);
  }

  // ─── The bar ──────────────────────────────────────────────────────────────
  const title = $derived.by(() => {
    if (companyKey === null) return "Companies";
    if (movingTo !== null) return "";
    if (company) return company.name;
    if (pageData?.kind === "missing") return "Companies";
    return "";
  });
  $effect(() => {
    documentTitle = title || "Companies";
  });
  const count = $derived.by(() => {
    if (companyKey === null) {
      return clientsQ.data ? companyCountLabel(clientsQ.data.clients.length, clientsQ.data.truncated) : null;
    }
    return null;
  });
  const primaryAction = $derived.by(() => {
    if (!canCreate) return null;
    if (companyKey === null) return { label: "New company", onclick: () => (newCompanyOpen = true) };
    if (!company) return null;
    return { label: "New project", href: `${resolve("/project/new")}${newProjectSearch(company.name)}` };
  });
</script>

{#snippet companyCrumbs()}
  <!-- 2026-11-04: "Companies / <switcher>"; the company's name is the header's h1. -->
  <nav aria-label="Breadcrumb" data-company-breadcrumb class="flex min-w-0 items-center gap-2.5 text-sm leading-[calc(9/7)]">
    <a
      href={companiesPath(root)}
      data-company-breadcrumb-all
      class="shrink-0 rounded-sm max-sm:hidden text-ink-muted transition-colors hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fir motion-reduce:transition-none"
    >Companies</a>
    <span aria-hidden="true" class="shrink-0 text-ink-faint max-sm:hidden">/</span>
    {#if company && movingTo === null}
      <CompanySwitcher
        companyKey={company.key}
        companyName={company.name}
        userId={user?._id ?? null}
        allCompaniesHref={companiesPath(root)}
        onSelect={(key) => openCompany(key)}
        onNewCompany={canCreate ? () => (newCompanyOpen = true) : null}
      />
    {:else if pageData?.kind !== "missing" && !companyQ.error}
      <span data-page-title-pending aria-hidden="true" class="h-9 w-44 max-w-[40%] shrink animate-pulse rounded-[0.625rem] bg-chrome motion-reduce:animate-none"></span>
    {/if}
  </nav>
{/snippet}

{#snippet companiesSidebar()}
  <CompaniesSidebar
    selectedKey={companyKey === null ? null : (company?.key ?? companyKey)}
    onNewCompany={canCreate ? () => (newCompanyOpen = true) : null}
    canMerge={canManage}
    onSelect={(key) => openCompany(key)}
    {onMerged}
  />
{/snippet}

{#snippet searchField()}
  {#if companyKey !== null && canManage && company && movingTo === null}
    <button
      type="button"
      data-edit-company
      onclick={() => (editOpen = true)}
      class="inline-flex h-[2.375rem] max-sm:hidden shrink-0 items-center rounded-[0.5625rem] px-3 text-sm leading-[calc(9/7)] text-ink-secondary transition-colors hover:bg-primary-wash hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fir motion-reduce:transition-none pointer-coarse:h-11"
    >Edit company</button>
  {/if}
  {#if companyKey === null}
    <div role="search" class="relative w-[18.75rem] min-w-0 max-w-[45vw]">
      <IconSearch size={14} strokeWidth={2} class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
      <input
        bind:this={searchEl}
        bind:value={search}
        type="search"
        data-companies-search
        aria-label="Search companies"
        placeholder="Search companies"
        autocomplete="off"
        onkeydown={(event) => {
          if (event.key !== "Escape") return;
          if (search) {
            event.stopPropagation();
            search = "";
          } else {
            event.currentTarget.blur();
          }
        }}
        class="field-control h-9 w-full rounded-lg pl-[2.125rem] pr-3 text-sm leading-[calc(9/7)] text-ink placeholder:text-ink-muted pointer-coarse:h-11"
      />
    </div>
  {/if}
{/snippet}

<WorkspaceChrome
  {title}
  titlePending={title === ""}
  {count}
  panel="flush"
  {primaryAction}
  primaryActionInSidebar={companyKey === null}
  sidebar={companyKey === null ? companiesSidebar : undefined}
  leading={companyKey === null ? undefined : companyCrumbs}
  barClass={companyKey === null ? "" : "border-b border-line-soft"}
  actions={searchField}
>
  {#if companyKey === null}
    <div data-companies-page class="flex flex-col px-4 pb-8 pt-1 sm:px-6 lg:px-8">
      {#if clientsQ.error}
        <div role="alert" class="flex flex-col items-start gap-2 py-10" data-companies-error>
          <p class="text-[0.8125rem] leading-[calc(18/13)] text-ink">Companies could not be loaded.</p>
          <p class="text-[0.8125rem] leading-[calc(18/13)] text-ink-muted">Refresh the page to try again.</p>
        </div>
      {:else if clientsQ.data === undefined}
        <WorkspacePanelSkeleton layout="companies-table" label="Loading companies" />
      {:else}
        <AllCompaniesTable
          {companies}
          truncated={clientsQ.data.truncated}
          query={search}
          {root}
          onNewCompany={canCreate ? () => (newCompanyOpen = true) : null}
        />
      {/if}
    </div>
  {:else if movingTo !== null}
    <WorkspacePanelSkeleton layout="company" label="Loading the company" />
  {:else if company}
    <CompanyView
      {company}
      {note}
      onCloseNote={closeNote}
      {tab}
      {tabs}
      onTabChange={selectTab}
      {canCreate}
      canEdit={canManage}
      {canAddFiles}
      canEditFiles={canAddFiles}
      {canManageFiles}
      {canManageContacts}
      onEdit={() => (editOpen = true)}
    />
  {:else if pageData?.kind === "missing"}
    <div data-company-missing class="flex flex-col items-start gap-3 px-4 py-10 sm:px-6 lg:px-8">
      <p class="text-base leading-[1.5] font-medium text-ink">This company doesn't exist</p>
      <p class="text-[0.8125rem] leading-[calc(18/13)] text-ink-secondary">It may have been renamed, or the link may be wrong.</p>
      <a
        href={companiesPath(root)}
        data-company-missing-back
        class="text-[0.8125rem] leading-[calc(18/13)] font-medium text-primary-selected hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy pointer-coarse:min-h-11"
      >Go to All companies</a>
    </div>
  {:else if companyQ.error}
    <div role="alert" data-company-error class="flex flex-col items-start gap-2 px-4 py-10 sm:px-6 lg:px-8">
      <p class="text-[0.8125rem] leading-[calc(18/13)] text-ink">This company could not be loaded.</p>
      <p class="text-[0.8125rem] leading-[calc(18/13)] text-ink-muted">Refresh the page to try again.</p>
    </div>
  {:else}
    <WorkspacePanelSkeleton layout="company" label="Loading the company" />
  {/if}
</WorkspaceChrome>

{#if canCreate}
  <NewClientDialog bind:open={newCompanyOpen} canAddIndustry={role === "admin"} onCreated={onCompanyCreated} />
{/if}

{#if canManage && company}
  <EditCompanyDialog
    bind:open={editOpen}
    company={company}
    canAddIndustry={role === "admin"}
    onSaved={onCompanySaved}
  />
{/if}
