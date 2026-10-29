<!--
  The Companies section (owner, 2026-10-28): `/companies` (All companies)
  and `/companies/<key>` (one company's page), in the page frame with the
  Companies sidebar. The route only adds the sign-in redirect and the
  title; everything else is here so the component suite can mount it.

  All companies: the bar reads "Companies" with the count and "Search
  companies" on the right; the panel is the company table. A company: the
  bar is its name with its project count and New project (this company
  filled in); the panel is CompanyView. A key a merge took away opens the
  company it ended up in, with the merge note once; a key with no company
  says so, with a link to All companies.

  Section controls follow the effective viewer (View as): New company and
  New project for those who may create projects, Edit company and Merge
  companies for Managers and Admins, Files for those who may read company
  files. The cards' own dialogs read the signed-in user, as on Projects.
-->
<script lang="ts">
  import { goto } from "$app/navigation";
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
  import type { ProjectsTableRow } from "$lib/components/workspace/ProjectsTable.svelte";
  import { effectiveViewer } from "$lib/shell/viewAs.svelte";
  import { canDeleteProject } from "$lib/workspace/projectDelete";
  import { newProjectSearch } from "$lib/projects/clientList";
  import {
    closeMergedNote,
    companiesPath,
    companyCountLabel,
    mergedNoteClosed,
    projectCountText,
  } from "$lib/companies/companies";
  import { hasCapability } from "../../../../shared/capabilities";
  import CompaniesSidebar from "./CompaniesSidebar.svelte";
  import AllCompaniesTable, { type CompanyRow } from "./AllCompaniesTable.svelte";
  import CompanyView from "./CompanyView.svelte";

  /** The query parameter that carries the old key after a merged link (the note's source). */
  const MERGED_PARAM = "merged";

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
  const canSelect = $derived(role === "writer" || role === "manager" || role === "admin");
  const canReadFiles = $derived(signedIn && hasCapability(role, "companyFiles.read"));
  const canAddFiles = $derived(signedIn && hasCapability(role, "companyFiles.add"));
  const canManageFiles = $derived(signedIn && hasCapability(role, "companyFiles.manage"));
  const canDelete = (row: ProjectsTableRow) => canDeleteProject(user, row.createdBy, row.deleting);

  // ─── All companies ────────────────────────────────────────────────────────
  const clientsQ = useQuery(api.clients.listClients, () =>
    auth.isAuthenticated && companyKey === null ? {} : "skip"
  );
  const companies = $derived((clientsQ.data?.clients ?? []) as CompanyRow[]);
  let search = $state("");
  let searchEl: HTMLInputElement | null = $state(null);

  // ─── One company ──────────────────────────────────────────────────────────
  const mergedFrom = $derived(page.url.searchParams.get(MERGED_PARAM) || null);
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
    const url = new URL(page.url);
    url.searchParams.delete(MERGED_PARAM);
    void goto(`${url.pathname}${url.search}`, { replaceState: true, keepFocus: true, noScroll: true });
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
  $effect(() => {
    if (movingTo !== null && companyKey === movingTo) movingTo = null;
  });
  function onCompanySaved(result: { key: string }) {
    // A rename moves the company to its new key's address.
    if (result.key === companyKey) return;
    movingTo = result.key;
    openCompany(result.key, { replace: true });
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
    return company ? projectCountText(company.projectCount) : null;
  });
  const primaryAction = $derived.by(() => {
    if (!canCreate) return null;
    if (companyKey === null) return { label: "New company", onclick: () => (newCompanyOpen = true) };
    if (!company) return null;
    return { label: "New project", href: `${resolve("/project/new")}${newProjectSearch(company.name)}` };
  });
</script>

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
  sidebar={companiesSidebar}
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
      viewer={user}
      {canCreate}
      {canSelect}
      canEdit={canManage}
      {canReadFiles}
      {canAddFiles}
      {canManageFiles}
      {canDelete}
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
