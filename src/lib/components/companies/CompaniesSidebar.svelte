<!--
  The Companies section sidebar (owner, 2026-10-28; laid out as Team's,
  Paper S11): "Companies" with its collapse button, New company for those
  who may create projects, "All companies" with the count, then the company
  list (the Projects sidebar's group: search, A to Z, counts) whose rows open
  company pages, and "Merge companies" at the foot for Managers and Admins,
  as on the Projects sidebar. It reads the company list itself (the page
  and the loading frame share the one subscription) and owns merge mode and
  the merge dialog; the host opens New company and goes to the kept company
  after a merge. Collapse, Mod \ and the phone are the shared sidebar's.
-->
<script lang="ts">
  import { tick } from "svelte";
  import { resolve } from "$app/paths";
  import { useQuery } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { api } from "../../../../convex/_generated/api";
  import type { ClientEntry } from "$lib/projects/clientList";
  import { companiesPath } from "$lib/companies/companies";
  import SectionSidebar from "$lib/components/workspace/SectionSidebar.svelte";
  import SectionSidebarLink from "$lib/components/workspace/SectionSidebarLink.svelte";
  import FrameIcon from "$lib/components/workspace/FrameIcon.svelte";
  import MergeClientsDialog, { type MergeResult } from "$lib/components/projects/MergeClientsDialog.svelte";
  import CompanyListGroup from "./CompanyListGroup.svelte";
  import CompanyListFoot from "./CompanyListFoot.svelte";

  let {
    selectedKey,
    onNewCompany = null,
    newCompanyDisabled = false,
    canMerge = false,
    onSelect = undefined,
    onMerged = undefined,
  }: {
    /** The company whose page is open, or null on All companies. */
    selectedKey: string | null;
    /** Null hides New company (no `project.create`). */
    onNewCompany?: (() => void) | null;
    /** The loading frame draws New company in its place before it can open. */
    newCompanyDisabled?: boolean;
    /** Managers and Admins merge companies. */
    canMerge?: boolean;
    /** A plain click on All companies (null) or a company (the host's soft navigation). */
    onSelect?: (key: string | null) => void;
    onMerged?: (result: MergeResult) => void;
  } = $props();

  const auth = useAuth();
  // Try again drops the failed subscription for a moment and subscribes afresh.
  let retrying = $state(false);
  const clientsQ = useQuery(api.clients.listClients, () => (auth.isAuthenticated && !retrying ? {} : "skip"));
  async function retry() {
    retrying = true;
    await tick();
    retrying = false;
  }
  const clients = $derived((clientsQ.data?.clients ?? []) as ClientEntry[]);
  const countLabel = $derived(
    clientsQ.data ? `${clientsQ.data.clients.length}${clientsQ.data.truncated ? "+" : ""}` : null
  );
  const root = resolve("/");

  // ─── Merge (as on the Projects sidebar) ───────────────────────────────────
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
</script>

<SectionSidebar
  section="companies"
  title="Companies"
  action={onNewCompany ? { label: "New company", onclick: onNewCompany, disabled: newCompanyDisabled } : null}
>
  <nav aria-label="Companies" data-companies-nav class="flex shrink-0 flex-col gap-0.5 pt-3">
    <SectionSidebarLink
      href={companiesPath(root)}
      label="All companies"
      data-companies-sidebar="all"
      active={selectedKey === null}
      count={countLabel}
      onnavigate={onSelect ? () => onSelect(null) : undefined}
    >
      {#snippet icon()}<FrameIcon name="all-companies" />{/snippet}
    </SectionSidebarLink>
  </nav>

  <CompanyListGroup
    {clients}
    truncated={clientsQ.data?.truncated ?? false}
    loading={clientsQ.data === undefined && !clientsQ.error}
    failed={Boolean(clientsQ.error)}
    {selectedKey}
    hrefFor={(key) => companiesPath(root, key)}
    onSelect={onSelect ? (key) => onSelect(key) : undefined}
    {mergeMode}
    {mergeKeys}
    onToggleMerge={toggleMerge}
    onRetry={() => void retry()}
  />

  {#snippet footer()}
    <CompanyListFoot
      showMerge={canMerge}
      {mergeMode}
      {mergeKeys}
      onStartMerge={() => (mergeMode = true)}
      onEndMerge={endMerge}
      onMerge={() => (mergeOpen = true)}
    />
  {/snippet}
</SectionSidebar>

{#if canMerge && mergeClients.length >= 2}
  <MergeClientsDialog
    bind:open={mergeOpen}
    clients={mergeClients}
    onMerged={(result) => {
      endMerge();
      onMerged?.(result);
    }}
  />
{/if}
