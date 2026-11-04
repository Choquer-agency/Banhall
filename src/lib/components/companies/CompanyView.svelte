<!--
  One company's page body (owner, 2026-10-28; Paper Z8a's content in the
  page frame). The page's top bar holds the name, the project count and New
  project. At the top of the panel: the note an old link to a merged
  company shows (Paper Z9g, once; closing it keeps it closed), the facts
  row (Fiscal year ends, Industry, Projects; "Not set" when missing) with
  Edit company on the right for Managers and Admins, and the tabs Projects
  and Files (Files for those who may read company files). Projects is the
  Projects page's company listing (ClientArea, embedded): the fiscal year
  sections of cards, selection and Show more. Files is the company's files
  (CompanyFiles), kept mounted so uploads finish while Projects shows.
-->
<script lang="ts">
  import { tick, untrack } from "svelte";
  import ClientArea from "$lib/components/projects/ClientArea.svelte";
  import CompanyFiles from "$lib/components/projects/CompanyFiles.svelte";
  import ProjectCardDialogs from "$lib/components/projects/ProjectCardDialogs.svelte";
  import type { ProjectsTableRow } from "$lib/components/workspace/ProjectsTable.svelte";
  import type { DashboardProjectionRow } from "$lib/workspace/projectRowMapping";
  import { topBarSecondary } from "$lib/components/shell/topBar";
  import { industryLabel } from "$lib/industries";
  import { mergedNoteText, yearEndLabel } from "$lib/companies/companies";
  import { companyWebsiteHost } from "../../../../shared/companyWebsite";
  import type { CapabilityRole } from "../../../../shared/capabilities";

  type Viewer = { _id: string; role?: CapabilityRole | null; isAnonymous?: boolean } | null;

  let {
    company,
    note = null,
    onCloseNote = undefined,
    viewer,
    canCreate = false,
    canSelect = false,
    canEdit = false,
    canReadFiles = false,
    canAddFiles = false,
    canManageFiles = false,
    canDelete,
    onEdit = undefined,
  }: {
    company: {
      key: string;
      name: string;
      projectCount: number;
      fiscalYearEndMonth?: number;
      fiscalYearEndDay?: number;
      industry?: string;
      /** The year end shown is the newest project's (none saved). */
      fiscalYearEndFromProjects?: boolean;
      /** The industry shown is the newest project's (none saved). */
      industryFromProjects?: boolean;
      /** The company's website (2026-10-29) and how its latest read went. */
      website?: string;
      websiteRead?: { status: "reading" | "read" | "failed"; reason?: string } | null;
    };
    /** The merged company's note (Paper Z9g), or null. */
    note?: { fromName: string; mergedAt: number; projectCount: number | null } | null;
    onCloseNote?: () => void;
    /** The signed-in user, for the card dialogs (as on Projects). */
    viewer: Viewer;
    canCreate?: boolean;
    canSelect?: boolean;
    /** Edit company: Managers and Admins. */
    canEdit?: boolean;
    canReadFiles?: boolean;
    canAddFiles?: boolean;
    canManageFiles?: boolean;
    canDelete: (row: ProjectsTableRow) => boolean;
    onEdit?: () => void;
  } = $props();

  const yearEnd = $derived(yearEndLabel(company.fiscalYearEndMonth, company.fiscalYearEndDay));
  // A value borrowed from the newest project (none saved) reads in muted ink.
  const facts = $derived([
    { id: "year-end", label: "Fiscal year ends", value: yearEnd, borrowed: company.fiscalYearEndFromProjects === true },
    {
      id: "industry",
      label: "Industry",
      value: company.industry ? industryLabel(company.industry) : null,
      borrowed: company.industryFromProjects === true,
    },
    { id: "projects", label: "Projects", value: String(company.projectCount), borrowed: false },
  ]);

  // ─── Tabs (Paper Z8a): Projects and Files ─────────────────────────────────
  let tab = $state<"projects" | "files">("projects");
  const onFiles = $derived(canReadFiles && tab === "files");
  // Another company starts on Projects.
  let shownKey = $state.raw(untrack(() => company.key));
  $effect(() => {
    if (company.key === shownKey) return;
    shownKey = company.key;
    tab = "projects";
  });

  let area: {
    selectedRows: () => DashboardProjectionRow[];
    endSelect: () => void;
  } | null = $state(null);
  let dialogs: ProjectCardDialogs | null = $state(null);
  let areaAttempt = $state(0);

  /** No title of its own in the listing: focus falls back to the active tab, else the page title. */
  function pageFocus(): HTMLElement | null {
    return (
      document.getElementById(`company-tab-${tab}`) ??
      document.querySelector<HTMLElement>("[data-page-title]")
    );
  }

  function selectTab(next: "projects" | "files", focus = false) {
    if (next === "files") area?.endSelect();
    tab = next;
    if (focus) void tick().then(() => document.getElementById(`company-tab-${next}`)?.focus());
  }
</script>

<div data-company-view={company.key} class="flex h-full min-h-0 flex-col">
  <div data-company-header class="flex shrink-0 flex-col gap-5 border-b border-line-soft px-4 pt-1 sm:px-6 lg:px-8">
    {#if note}
      <!-- Paper Z9g: shown once after an old link; closing keeps it closed. -->
      <div role="status" data-merged-note class="flex items-center gap-3 rounded-[0.625rem] border border-primary-line bg-primary-wash px-4 py-3">
        <svg class="size-[1.125rem] shrink-0 text-primary-selected" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 4v4a4 4 0 0 0 4 4h4a4 4 0 0 1 4 4v4M18 4v4a4 4 0 0 1-4 4" /></svg>
        <p class="min-w-0 flex-1 text-sm leading-[calc(10/7)] text-ink">{mergedNoteText({ ...note, intoName: company.name })}</p>
        <button
          type="button"
          data-merged-note-close
          aria-label="Close this note"
          onclick={() => onCloseNote?.()}
          class="flex size-7 shrink-0 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-white hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir motion-reduce:transition-none pointer-coarse:size-11"
        >
          <svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>
    {/if}

    <div class="flex flex-wrap items-start gap-x-10 gap-y-4">
      <dl data-company-facts class="flex min-w-0 flex-wrap gap-x-10 gap-y-3">
        {#each facts as fact (fact.id)}
          <div class="flex flex-col gap-1" data-company-fact={fact.id}>
            <dt class="text-[0.8125rem] leading-[calc(16/13)] text-ink-muted">{fact.label}</dt>
            <dd
              data-borrowed={fact.value && fact.borrowed ? "" : undefined}
              class={`text-[0.9375rem] leading-[calc(4/3)] ${fact.value && !fact.borrowed ? "text-ink" : "text-ink-muted"}`}
            >{fact.value ?? "Not set"}{#if fact.value && fact.borrowed}<span class="sr-only">{" from the newest project"}</span>{/if}</dd>
          </div>
        {/each}
        <!-- 2026-10-29: the website, its host as a link that opens a new tab,
             and how its read into the company's files went. -->
        <div class="flex min-w-0 max-w-[18rem] flex-col gap-1" data-company-fact="website">
          <dt class="text-[0.8125rem] leading-[calc(16/13)] text-ink-muted">Website</dt>
          <dd class="min-w-0 text-[0.9375rem] leading-[calc(4/3)]">
            {#if company.website}
              <a
                href={company.website}
                target="_blank"
                rel="noopener noreferrer"
                data-company-website
                class="block truncate rounded-sm text-primary-selected hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fir"
              >{companyWebsiteHost(company.website)}</a>
            {:else}
              <span class="text-ink-muted">Not set</span>
            {/if}
          </dd>
          {#if company.website && company.websiteRead?.status === "reading"}
            <dd role="status" class="text-[0.8125rem] leading-[calc(18/13)] text-ink-muted" data-company-website-status="reading">Reading the website...</dd>
          {:else if company.website && company.websiteRead?.status === "failed"}
            <dd role="status" class="text-[0.8125rem] leading-[calc(18/13)] text-ink-secondary" data-company-website-status="failed">
              The website could not be read: {company.websiteRead.reason ?? "it could not be reached."}
            </dd>
          {/if}
        </div>
      </dl>
      <div class="flex-1"></div>
      {#if canEdit && onEdit}
        <button type="button" data-edit-company onclick={onEdit} class={topBarSecondary}>Edit company</button>
      {/if}
    </div>

    {#if canReadFiles}
      <div role="tablist" aria-label={`${company.name} views`} class="flex gap-1.5 pb-3.5" data-company-tabs>
        {#each [["projects", "Projects"], ["files", "Files"]] as const as [id, label] (id)}
          {@const selected = tab === id}
          <button
            type="button"
            role="tab"
            id={`company-tab-${id}`}
            aria-selected={selected}
            aria-controls={`company-panel-${id}`}
            tabindex={selected ? 0 : -1}
            data-company-tab={id}
            onclick={() => selectTab(id)}
            onkeydown={(event) => {
              if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
              event.preventDefault();
              selectTab(tab === "projects" ? "files" : "projects", true);
            }}
            class={`flex h-[2.125rem] items-center rounded-md px-3.5 text-[0.9375rem] leading-[calc(4/3)] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy motion-reduce:transition-none pointer-coarse:h-11 ${
              selected ? "bg-primary-selected font-medium text-white" : "text-ink-secondary hover:bg-primary-wash hover:text-ink"
            }`}
          >{label}</button>
        {/each}
      </div>
    {:else}
      <div class="pb-1"></div>
    {/if}
  </div>

  <div
    role={canReadFiles ? "tabpanel" : undefined}
    id={canReadFiles ? "company-panel-projects" : undefined}
    aria-labelledby={canReadFiles ? "company-tab-projects" : undefined}
    hidden={onFiles}
    data-company-projects-panel
    class={`min-h-0 flex-1 flex-col ${onFiles ? "hidden" : "flex"}`}
  >
    {#key areaAttempt}
      <ClientArea
        bind:this={area}
        embedded
        client={{ key: company.key, name: company.name, missing: false }}
        {canCreate}
        canDuplicate={canCreate}
        {canSelect}
        {canDelete}
        onEditDetails={(projectId) => dialogs?.editDetails(projectId)}
        onDuplicate={(projectId) => dialogs?.duplicate(projectId)}
        onDelete={(project) => dialogs?.requestDelete(project)}
        onBulkEdit={(rows) => dialogs?.bulkEdit(rows)}
        onRetry={() => (areaAttempt += 1)}
        focusFallback={pageFocus}
      />
    {/key}
  </div>

  {#if canReadFiles}
    <!-- Mounted whenever the company has the tab, so files still being
         added finish (and say so) when someone looks at Projects meanwhile. -->
    <div
      role="tabpanel"
      id="company-panel-files"
      aria-labelledby="company-tab-files"
      hidden={!onFiles}
      data-company-files-panel
      class="min-h-0 flex-1 overflow-y-auto px-4 pb-8 pt-6 sm:px-6 lg:px-8"
    >
      <CompanyFiles
        companyKey={company.key}
        companyName={company.name}
        active={onFiles}
        canAdd={canAddFiles}
        canManage={canManageFiles}
      />
    </div>
  {/if}
</div>

<ProjectCardDialogs bind:this={dialogs} {viewer} {area} focusFallback={pageFocus} />
