<!--
  The Projects section sidebar (the page frame, owner 2026-10-28; Paper S9),
  shared by Projects and Home. "Projects" with its collapse button, the New
  project button, Home, All projects (with the project count) and Starred
  (the person's starred projects, with their count on Projects; 2026-11-02),
  then the
  Companies group: a search button that opens "Find a company" (case and
  accents ignored) and every company with its project count. Rows are links
  (`?client=<key>`), so they open in a new tab; on Projects the host turns a
  plain click into a soft navigation. The selected row is the primary wash
  with a primary-selected 500 label and aria-current.

  Foot (Projects only): "New company" for roles that may create projects,
  "Merge companies" for Managers and Admins. Merge mode turns rows into
  checkboxes with "N companies ticked" and Merge (enabled at two or more).
-->
<script lang="ts">
  import { resolve } from "$app/paths";
  import type { ClientEntry } from "$lib/projects/clientList";
  import SectionSidebar from "$lib/components/workspace/SectionSidebar.svelte";
  import SectionSidebarLink from "$lib/components/workspace/SectionSidebarLink.svelte";
  import FrameIcon from "$lib/components/workspace/FrameIcon.svelte";
  import CompanyListGroup from "$lib/components/companies/CompanyListGroup.svelte";
  import CompanyListFoot from "$lib/components/companies/CompanyListFoot.svelte";

  let {
    clients,
    truncated = false,
    loading = false,
    failed = false,
    totalLabel = null,
    selectedKey,
    current = "projects",
    homeHref,
    homeAvailable = true,
    hrefFor,
    onSelect = undefined,
    phone = "hidden",
    canCreate = false,
    canMerge = false,
    onNewClient = undefined,
    mergeMode = false,
    mergeKeys = [],
    onStartMerge = undefined,
    onEndMerge = undefined,
    onToggleMerge = undefined,
    onMerge = undefined,
    onRetry,
    starredHref = null,
    starredActive = false,
    starredCount = null,
    onSelectStarred = undefined,
  }: {
    clients: ClientEntry[];
    truncated?: boolean;
    loading?: boolean;
    failed?: boolean;
    /** The All projects count ("128", or "1000+" when bounded). */
    totalLabel?: string | null;
    selectedKey: string | null;
    /** Which page holds the sidebar: Home marks Home, Projects marks All projects or the company. */
    current?: "home" | "projects";
    homeHref: string;
    /** Home is switched off (the rollout kill switch): shown, not followed. */
    homeAvailable?: boolean;
    hrefFor: (key: string | null) => string;
    /** A plain click on All projects or a company (Projects' soft navigation). */
    onSelect?: (key: string | null) => void;
    /** Below 768px: hidden, or filling the card (the Projects list on a phone). */
    phone?: "hidden" | "full";
    canCreate?: boolean;
    canMerge?: boolean;
    onNewClient?: () => void;
    mergeMode?: boolean;
    mergeKeys?: string[];
    onStartMerge?: () => void;
    onEndMerge?: () => void;
    onToggleMerge?: (key: string) => void;
    onMerge?: () => void;
    onRetry: () => void;
    /** The Starred row's link; null draws no row. */
    starredHref?: string | null;
    starredActive?: boolean;
    /** How many projects the person has starred, when known. */
    starredCount?: string | null;
    /** A plain click on Starred (Projects' soft navigation). */
    onSelectStarred?: () => void;
  } = $props();

  const showNewClient = $derived(canCreate && onNewClient !== undefined);
  const showMerge = $derived(canMerge && onStartMerge !== undefined);
  const select = (key: string | null) => (onSelect ? () => onSelect(key) : undefined);
</script>

<SectionSidebar
  section="projects"
  title="Projects"
  action={{ label: "New project", href: resolve("/project/new") }}
  {phone}
>
  <nav aria-label="Projects" data-client-list class="flex shrink-0 flex-col gap-0.5 pt-3">
    <SectionSidebarLink
      href={homeHref}
      label="Home"
      data-projects-sidebar-home
      active={current === "home"}
      disabled={!homeAvailable}
    >
      {#snippet icon()}<FrameIcon name="home" />{/snippet}
    </SectionSidebarLink>
    <SectionSidebarLink
      href={hrefFor(null)}
      label="All projects"
      data-client-row="all"
      active={current === "projects" && selectedKey === null && !starredActive}
      count={totalLabel}
      onnavigate={select(null)}
    >
      {#snippet icon()}<FrameIcon name="all-projects" />{/snippet}
    </SectionSidebarLink>
    {#if starredHref}
      <SectionSidebarLink
        href={starredHref}
        label="Starred"
        data-client-row="starred"
        active={current === "projects" && starredActive}
        count={starredCount}
        onnavigate={onSelectStarred}
      >
        {#snippet icon()}<FrameIcon name="star" />{/snippet}
      </SectionSidebarLink>
    {/if}
  </nav>

  <CompanyListGroup
    {clients}
    {truncated}
    {loading}
    {failed}
    selectedKey={current === "projects" ? selectedKey : null}
    hrefFor={(key) => hrefFor(key)}
    onSelect={onSelect ? (key) => onSelect(key) : undefined}
    {mergeMode}
    {mergeKeys}
    {onToggleMerge}
    {onRetry}
  />

  {#snippet footer()}
    <CompanyListFoot
      {showNewClient}
      {onNewClient}
      {showMerge}
      {mergeMode}
      {mergeKeys}
      {onStartMerge}
      {onEndMerge}
      {onMerge}
    />
  {/snippet}
</SectionSidebar>
