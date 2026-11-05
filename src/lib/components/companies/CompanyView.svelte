<!--
  One company's page body (2026-11-04, the company profile; Paper "Profile /
  Overview"). The bar above it (CompaniesPage) holds "Companies /" with the
  company switcher, Edit company and New project. Here: the note an old link
  to a merged company shows (Paper Z9g, once), the header (CompanyHeader:
  name, website, industry, Client since, the people on the company), the
  underlined tabs Overview, Files (with its count), People (with its count),
  Activity and Details, then the active tab's panel. The address keeps the
  tab (`?tab=`, read and written by CompaniesPage).

  Each tab's panel stays mounted while hidden (Files keeps uploads going and
  says how they ended); each tab's own reads stop while it is hidden.
  Files is for those who may read company files, People for those who may
  read contacts.
-->
<script lang="ts">
  import CompanyFiles from "$lib/components/projects/CompanyFiles.svelte";
  import CompanyPeople from "./people/CompanyPeople.svelte";
  import CompanyActivity from "./activity/CompanyActivity.svelte";
  import CompanyHeader from "./CompanyHeader.svelte";
  import CompanyTabs from "./CompanyTabs.svelte";
  import CompanyOverview from "./overview/CompanyOverview.svelte";
  import CompanyDetails from "./details/CompanyDetails.svelte";
  import { mergedNoteText, type CompanyTab } from "$lib/companies/companies";
  import { workPanelInline } from "$lib/components/shell/topBar";

  type Company = {
    key: string;
    clientId: string | null;
    name: string;
    projectCount: number;
    fiscalYearEndMonth?: number;
    fiscalYearEndDay?: number;
    industry?: string;
    fiscalYearEndFromProjects?: boolean;
    industryFromProjects?: boolean;
    website?: string;
    websiteRead?: { status: "reading" | "read" | "failed"; reason?: string; finishedAt?: number } | null;
    clientSince?: number | null;
    team?: readonly { id: string; name: string; initials: string }[];
    summary?: {
      text: string;
      aiDraftedFrom?: string;
      aiDraftedAt?: number;
      editedByName?: string;
      editedAt?: number;
    } | null;
    createdByName?: string | null;
    updatedAt?: number | null;
    formerNames?: readonly { name: string; mergedAt?: number }[];
  };

  let {
    company,
    note = null,
    onCloseNote = undefined,
    tab,
    tabs,
    onTabChange,
    canCreate = false,
    canEdit = false,
    canAddFiles = false,
    canEditFiles = false,
    canManageFiles = false,
    canManageContacts = false,
    onEdit = undefined,
  }: {
    company: Company;
    /** The merged company's note (Paper Z9g), or null. */
    note?: { fromName: string; mergedAt: number; projectCount: number | null } | null;
    onCloseNote?: () => void;
    /** The tab shown (from the address). */
    tab: CompanyTab;
    /** The tabs this viewer has, in order. */
    tabs: readonly CompanyTab[];
    onTabChange: (tab: CompanyTab, focus: boolean) => void;
    canCreate?: boolean;
    /** Edit company and the summary's Edit: Managers and Admins. */
    canEdit?: boolean;
    canAddFiles?: boolean;
    canEditFiles?: boolean;
    canManageFiles?: boolean;
    canManageContacts?: boolean;
    onEdit?: () => void;
  } = $props();

  // The counts the Files and People tabs report (null: not known yet).
  let filesCount = $state<number | null>(null);
  let peopleCount = $state<number | null>(null);
  let countsKey = $state<string | null>(null);
  $effect(() => {
    if (company.key === countsKey) return;
    countsKey = company.key;
    filesCount = null;
    peopleCount = null;
  });

  const LABELS: Record<CompanyTab, string> = {
    overview: "Overview",
    files: "Files",
    people: "People",
    activity: "Activity",
    details: "Details",
  };
  const tabList = $derived(
    tabs.map((id) => ({
      id,
      label: LABELS[id],
      count: id === "files" ? filesCount : id === "people" ? peopleCount : undefined,
    }))
  );
  const has = (id: CompanyTab) => tabs.includes(id);
  const panelClass = `${workPanelInline} pt-6 pb-10 lg:pt-8 lg:pb-12`;
</script>

<div data-company-view={company.key} class="flex flex-col">
  <div data-company-header class={`flex shrink-0 flex-col gap-[1.125rem] border-b border-line-soft pt-6 lg:pt-8 ${workPanelInline}`}>
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
    <CompanyHeader
      name={company.name}
      website={company.website}
      industry={company.industry}
      industryFromProjects={company.industryFromProjects === true}
      clientSince={company.clientSince ?? null}
      team={company.team ?? []}
    />
    <CompanyTabs tabs={tabList} active={tab} label={company.name} onSelect={onTabChange} />
  </div>

  <div role="tabpanel" id="company-panel-overview" aria-labelledby="company-tab-overview" hidden={tab !== "overview"} data-company-panel="overview" class={panelClass}>
    <CompanyOverview
      companyKey={company.key}
      companyName={company.name}
      clientId={company.clientId}
      summary={company.summary ?? null}
      websiteReading={company.websiteRead?.status === "reading"}
      canEditSummary={canEdit}
      {canCreate}
    />
  </div>

  {#if has("files")}
    <!-- Mounted whenever the company has the tab, so files still being
         added finish (and say so) when someone looks at another tab. -->
    <div role="tabpanel" id="company-panel-files" aria-labelledby="company-tab-files" hidden={tab !== "files"} data-company-panel="files" data-company-files-panel class={panelClass}>
      <CompanyFiles
        companyKey={company.key}
        companyName={company.name}
        active={tab === "files"}
        canAdd={canAddFiles}
        canEdit={canEditFiles}
        canManage={canManageFiles}
        onCount={(count: number | null) => (filesCount = count)}
      />
    </div>
  {/if}

  {#if has("people")}
    <div role="tabpanel" id="company-panel-people" aria-labelledby="company-tab-people" hidden={tab !== "people"} data-company-panel="people" class={panelClass}>
      <CompanyPeople
        companyKey={company.key}
        companyName={company.name}
        active={tab === "people"}
        canManage={canManageContacts}
        onCount={(count: number | null) => (peopleCount = count)}
      />
    </div>
  {/if}

  <div role="tabpanel" id="company-panel-activity" aria-labelledby="company-tab-activity" hidden={tab !== "activity"} data-company-panel="activity" class={panelClass}>
    <CompanyActivity
      companyKey={company.key}
      companyName={company.name}
      active={tab === "activity"}
      onOpenFiles={has("files") ? () => onTabChange("files", false) : undefined}
    />
  </div>

  <div role="tabpanel" id="company-panel-details" aria-labelledby="company-tab-details" hidden={tab !== "details"} data-company-panel="details" class={panelClass}>
    <CompanyDetails {company} {canEdit} {onEdit} />
  </div>
</div>
