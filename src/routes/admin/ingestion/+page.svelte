<script lang="ts">
  import AdminWorkspacePage from "$lib/components/admin/AdminWorkspacePage.svelte";
  import Button from "$lib/components/ui/Button.svelte";
  import Spinner from "$lib/components/ui/Spinner.svelte";
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { Dialog, DropdownMenu, Tabs } from "bits-ui";
  import { useConvexClient, useQuery } from "convex-svelte";
  import {
    ArrowCounterClockwiseIcon,
    ArrowRightIcon,
    CheckCircleIcon,
    CloudArrowDownIcon,
    DotsThreeIcon,
    FileTextIcon,
    TrashIcon,
    WarningCircleIcon,
    XIcon,
  } from "phosphor-svelte";
  import { api } from "../../../../convex/_generated/api";
  import type { Doc, Id } from "../../../../convex/_generated/dataModel";
  import { useStableQuery } from "$lib/stableQuery.svelte";

  type Tab = "review" | "gaps" | "approved" | "rejected" | "failed" | "deleted" | "sync";
  type Item = Doc<"ingestionItems">;

  const auth = useAuth();
  const client = useConvexClient();

  let tab = $state<Tab>("review");
  let busyId = $state<Id<"ingestionItems"> | null>(null);
  let syncBusy = $state(false);
  let errorMsg = $state<string | null>(null);
  let reviewDialogOpen = $state(false);
  let reviewTarget = $state<Item | null>(null);
  let selectedIds = $state<Id<"ingestionItems">[]>([]);
  let bulkAction = $state<"reject" | "delete" | null>(null);
  let bulkDialogOpen = $state(false);
  let bulkBusy = $state(false);
  let bulkError = $state<string | null>(null);
  let deleteDialogOpen = $state(false);
  let deleteTarget = $state<Item | null>(null);
  let deleteError = $state<string | null>(null);

  let industry = $state("");
  let writerName = $state("");
  let writerTier = $state("0.4");
  let scienceCode = $state("");
  let rejectNote = $state("");

  const statsQ = useQuery(api.ingestion.ingestionStats, () => auth.isAuthenticated ? {} : "skip");
  const itemsQ = useStableQuery(api.ingestion.listItems, () => {
    if (!auth.isAuthenticated) return "skip";
    if (tab === "review") return { status: "pending_review" as const };
    if (tab === "approved") return { status: "approved" as const };
    if (tab === "rejected") return { status: "rejected" as const };
    if (tab === "failed") return { status: "failed" as const };
    if (tab === "deleted") return { status: "deleted" as const };
    return "skip";
  });
  const gapsQ = useQuery(api.ingestion.listGaps, () => auth.isAuthenticated && tab === "gaps" ? {} : "skip");
  const runsQ = useQuery(api.ingestion.listSyncRuns, () => auth.isAuthenticated ? {} : "skip");

  $effect(() => {
    if (!auth.isLoading && !auth.isAuthenticated) goto(resolve("/login"), { replaceState: true });
  });

  const stats = $derived(statsQ.data);
  const items = $derived(itemsQ.data);
  const gaps = $derived(gapsQ.data);
  const runs = $derived(runsQ.data);
  const latestRun = $derived(runs?.[0]);
  const syncRunning = $derived(latestRun?.status === "running");
  const selectedItems = $derived((items ?? []).filter((item) => selectedIds.includes(item._id)));
  const allVisibleSelected = $derived(Boolean(items?.length) && items!.every((item) => selectedIds.includes(item._id)));

  const KIND_LABEL: Record<Item["docKind"], string> = {
    pd: "PD", transcript: "Transcript", supporting: "Supporting", unknown: "Unknown",
  };
  const KIND_TONE: Record<Item["docKind"], string> = {
    pd: "bg-navy text-white",
    transcript: "bg-blue-100 text-blue-800",
    supporting: "bg-gray-100 text-gray-700",
    unknown: "bg-amber-100 text-amber-800",
  };
  const PAIR_LABEL: Record<NonNullable<Item["pairStatus"]>, string> = {
    paired: "Paired",
    missing_transcript: "No transcript",
    missing_pd: "No PD",
    ambiguous_pd: "Multiple PDs",
  };

  const tabs: { key: Tab; label: string; count?: number }[] = $derived([
    { key: "review", label: "Review queue", count: stats?.pendingReview },
    { key: "gaps", label: "Gaps" },
    { key: "approved", label: "Approved", count: stats?.approved },
    { key: "rejected", label: "Rejected" },
    { key: "failed", label: "Failed", count: stats?.failed },
    { key: "deleted", label: "Deleted", count: stats?.deleted },
    { key: "sync", label: "Sync log" },
  ]);

  function cleanLabel(value?: string): string {
    return (value ?? "").replace(/\uFFFD[A-F0-9]+/gi, "").replace(/\uFFFD/g, "").replace(/\s+/g, " ").trim();
  }

  function resetReviewForm() {
    industry = "";
    writerName = "";
    writerTier = "0.4";
    scienceCode = "";
    rejectNote = "";
    errorMsg = null;
  }

  function openReview(item: Item) {
    reviewTarget = item;
    reviewDialogOpen = true;
    resetReviewForm();
  }

  function closeReview(force = false) {
    if (busyId !== null && !force) return;
    reviewDialogOpen = false;
    reviewTarget = null;
    errorMsg = null;
  }

  function toggleSelected(itemId: Id<"ingestionItems">) {
    selectedIds = selectedIds.includes(itemId)
      ? selectedIds.filter((id) => id !== itemId)
      : [...selectedIds, itemId];
  }

  function toggleAllVisible() {
    if (!items?.length) return;
    selectedIds = allVisibleSelected ? [] : items.map((item) => item._id);
  }

  function clearSelection() {
    selectedIds = [];
  }

  function requestBulkAction(action: "reject" | "delete") {
    bulkAction = action;
    bulkError = null;
    bulkDialogOpen = true;
  }

  function requestDelete(item: Item) {
    deleteTarget = item;
    deleteError = null;
    deleteDialogOpen = true;
  }

  async function approve(item: Item) {
    busyId = item._id;
    errorMsg = null;
    try {
      await client.action(api.ingestion.approveItem, {
        itemId: item._id,
        industry,
        writerName: writerName || undefined,
        writerTier: Number(writerTier),
        scienceCode: scienceCode || undefined,
      });
      selectedIds = selectedIds.filter((id) => id !== item._id);
      closeReview(true);
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : String(err);
    } finally {
      busyId = null;
    }
  }

  async function reject(item: Item) {
    busyId = item._id;
    errorMsg = null;
    try {
      await client.mutation(api.ingestion.rejectItem, { itemId: item._id, note: rejectNote || undefined });
      selectedIds = selectedIds.filter((id) => id !== item._id);
      closeReview(true);
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : String(err);
    } finally {
      busyId = null;
    }
  }

  function approveCurrentReview() {
    if (reviewTarget) void approve(reviewTarget);
  }

  function rejectCurrentReview() {
    if (reviewTarget) void reject(reviewTarget);
  }

  function restoreCurrentReview() {
    if (reviewTarget) void restoreItem(reviewTarget);
  }

  async function removeItem() {
    if (!deleteTarget) return;
    busyId = deleteTarget._id;
    deleteError = null;
    try {
      await client.mutation(api.ingestion.removeItem, { itemId: deleteTarget._id });
      selectedIds = selectedIds.filter((id) => id !== deleteTarget?._id);
      if (reviewTarget?._id === deleteTarget._id) closeReview(true);
      deleteDialogOpen = false;
      deleteTarget = null;
    } catch (err) {
      deleteError = err instanceof Error ? err.message : String(err);
    } finally {
      busyId = null;
    }
  }

  async function restoreItem(item: Item) {
    busyId = item._id;
    errorMsg = null;
    try {
      await client.mutation(api.ingestion.restoreItem, { itemId: item._id });
      selectedIds = selectedIds.filter((id) => id !== item._id);
      if (reviewTarget?._id === item._id) closeReview(true);
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : String(err);
    } finally {
      busyId = null;
    }
  }

  async function runSync() {
    syncBusy = true;
    errorMsg = null;
    try {
      await client.mutation(api.ingestion.startSync, {});
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : String(err);
    } finally {
      syncBusy = false;
    }
  }

  async function runBulkAction() {
    if (!bulkAction || selectedItems.length === 0) return;
    bulkBusy = true;
    bulkError = null;
    try {
      for (const item of selectedItems) {
        if (bulkAction === "reject") {
          await client.mutation(api.ingestion.rejectItem, {
            itemId: item._id,
            note: "Rejected from the ingestion review queue.",
          });
        } else {
          await client.mutation(api.ingestion.removeItem, { itemId: item._id });
        }
      }
      selectedIds = [];
      bulkDialogOpen = false;
      bulkAction = null;
    } catch (err) {
      bulkError = err instanceof Error ? err.message : String(err);
    } finally {
      bulkBusy = false;
    }
  }

  function clientLabel(item: Item): string {
    return item.clientName?.includes("\uFFFD")
      ? "Needs review"
      : cleanLabel(item.clientName) || "Unsorted";
  }

  function fmtSize(bytes: number): string {
    if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
</script>

{#snippet spinner()}
  <div class="flex min-h-[40vh] items-center justify-center"><Spinner /></div>
{/snippet}

{#snippet sheetRow(item: Item, selectable: boolean)}
  <div
    class="grid min-h-14 min-w-[66rem] grid-cols-[2.75rem_minmax(18rem,1.5fr)_minmax(10rem,0.8fr)_8rem_7rem_8rem_4rem_2.75rem] border-b border-line-soft bg-white transition-colors hover:bg-primary-wash/45 motion-reduce:transition-none"
    class:bg-primary-wash={selectedIds.includes(item._id)}
    role="row"
  >
    <label class="flex min-h-11 items-center justify-center border-r border-line-soft">
      {#if selectable}
        <input
          type="checkbox"
          class="size-4 accent-primary-selected"
          aria-label={`Select ${item.name}`}
          checked={selectedIds.includes(item._id)}
          onchange={() => toggleSelected(item._id)}
        />
      {/if}
    </label>
    <button
      type="button"
      class="col-span-6 grid min-w-0 grid-cols-subgrid text-left focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary-selected"
      aria-label={`Review ${item.name}`}
      onclick={() => openReview(item)}
    >
      <span class="flex min-w-0 items-center gap-3 border-r border-line-soft px-3 py-2">
        <span class="flex size-8 shrink-0 items-center justify-center rounded-md bg-chrome text-ink-muted">
          <FileTextIcon size={17} aria-hidden="true" />
        </span>
        <span class="min-w-0">
          <span class="block truncate text-sm font-medium text-ink">{item.name}</span>
          <span class="mt-0.5 block truncate text-xs text-ink-muted">
            {item.path.includes("\uFFFD") ? "Path contains unreadable characters" : item.path}
          </span>
        </span>
      </span>
      <span class="flex min-w-0 items-center gap-1.5 border-r border-line-soft px-3 text-sm text-ink-secondary">
        {#if item.clientName?.includes("\uFFFD")}
          <WarningCircleIcon size={15} class="shrink-0 text-amber-700" aria-hidden="true" />
        {/if}
        <span class="truncate">{clientLabel(item)}</span>
      </span>
      <span class="flex items-center border-r border-line-soft px-3 text-xs text-ink-muted">{cleanLabel(item.fiscalYearLabel) || "—"}</span>
      <span class="flex items-center border-r border-line-soft px-3">
        <span class={`rounded-md px-1.5 py-0.5 text-[0.6875rem] font-semibold ${KIND_TONE[item.docKind]}`}>{KIND_LABEL[item.docKind]}</span>
      </span>
      <span class="flex items-center border-r border-line-soft px-3">
        {#if item.pairStatus}
          <span class={`rounded-md px-1.5 py-0.5 text-[0.6875rem] font-medium ${item.pairStatus === "paired" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>{PAIR_LABEL[item.pairStatus]}</span>
        {:else if !item.text}
          <span class="rounded-md bg-gray-100 px-1.5 py-0.5 text-[0.6875rem] text-gray-600">No text</span>
        {:else}
          <span class="text-xs text-ink-faint">—</span>
        {/if}
      </span>
      <span class="text-data flex items-center px-3 text-ink-muted">{fmtSize(item.size)}</span>
    </button>

    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label={`Options for ${item.name}`}
        class="flex min-h-11 items-center justify-center border-l border-line-soft text-ink-muted transition-colors hover:bg-primary-wash hover:text-ink focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary-selected disabled:opacity-50 motion-reduce:transition-none"
        disabled={busyId === item._id}
      >
        <DotsThreeIcon size={20} weight="bold" aria-hidden="true" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content side="bottom" align="end" sideOffset={6} class="z-[100] w-52 overflow-hidden rounded-lg border border-line bg-white p-1 shadow-lg">
          <DropdownMenu.Item
            onSelect={() => openReview(item)}
            class="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-sm text-ink-secondary outline-none transition-colors data-highlighted:bg-primary-wash data-highlighted:text-ink motion-reduce:transition-none"
          >
            <ArrowRightIcon size={17} aria-hidden="true" class="shrink-0 text-ink-muted" />Review full file
          </DropdownMenu.Item>
          {#if item.status === "deleted"}
            <DropdownMenu.Item
              onSelect={() => restoreItem(item)}
              class="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-sm text-ink-secondary outline-none transition-colors data-highlighted:bg-primary-wash data-highlighted:text-primary-selected motion-reduce:transition-none"
            >
              <ArrowCounterClockwiseIcon size={17} aria-hidden="true" class="shrink-0" />Restore to queue
            </DropdownMenu.Item>
          {:else if item.status !== "approved" && item.status !== "discovered" && item.status !== "fetched"}
            <DropdownMenu.Separator class="mx-2 my-1 h-px bg-line-soft" />
            <DropdownMenu.Item
              onSelect={() => requestDelete(item)}
              class="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-sm text-red-700 outline-none transition-colors data-highlighted:bg-red-50 data-highlighted:text-red-700 motion-reduce:transition-none"
            >
              <TrashIcon size={17} aria-hidden="true" class="shrink-0" />Move to Deleted
            </DropdownMenu.Item>
          {/if}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  </div>
{/snippet}

{#snippet sheetList(rows: Item[], selectable = false)}
  <div class="overflow-x-auto border-t border-line bg-white" role="table" aria-label="OneDrive ingestion files">
    <div
      class="grid min-h-10 min-w-[66rem] grid-cols-[2.75rem_minmax(18rem,1.5fr)_minmax(10rem,0.8fr)_8rem_7rem_8rem_4rem_2.75rem] items-center border-b border-line-soft bg-gray-50 text-xs font-medium text-ink-muted"
      role="row"
    >
      <label class="flex h-full items-center justify-center border-r border-line-soft">
        {#if selectable}
          <input
            type="checkbox"
            class="size-4 accent-primary-selected"
            aria-label="Select all visible files"
            checked={allVisibleSelected}
            onchange={toggleAllVisible}
          />
        {/if}
      </label>
      <span class="border-r border-line-soft px-3" role="columnheader">File</span>
      <span class="border-r border-line-soft px-3" role="columnheader">Client</span>
      <span class="border-r border-line-soft px-3" role="columnheader">Fiscal year</span>
      <span class="border-r border-line-soft px-3" role="columnheader">Type</span>
      <span class="border-r border-line-soft px-3" role="columnheader">Pairing</span>
      <span class="px-3" role="columnheader">Size</span>
      <span aria-hidden="true"></span>
    </div>
    {#each rows as item (item._id)}
      {@render sheetRow(item, selectable)}
    {/each}
  </div>
{/snippet}
{#if auth.isLoading || !auth.isAuthenticated}
  <div class="flex flex-1 items-center justify-center bg-canvas"><Spinner /></div>
{:else}
  <AdminWorkspacePage title="OneDrive ingestion" description="Review historical PDs and transcripts before anything enters the Brain." flush>
    {#if stats === null}
      <p class="mt-8 text-sm text-ink-muted">Admin access only.</p>
    {:else}
      <div class="flex min-h-12 flex-col border-b border-line bg-white lg:flex-row lg:items-stretch">
        <Tabs.Root value={tab} onValueChange={(value) => { tab = value as Tab; selectedIds = []; reviewDialogOpen = false; reviewTarget = null; errorMsg = null; }} class="min-w-0 flex-1">
          <div class="h-full overflow-x-auto scrollbar-hidden">
            <Tabs.List class="flex h-full min-w-max items-stretch sm:min-w-0" aria-label="Ingestion views">
            {#each tabs as itemTab (itemTab.key)}
              <Tabs.Trigger
                value={itemTab.key}
                class={`relative min-h-12 flex-none whitespace-nowrap px-3 text-sm font-medium transition-colors after:absolute after:inset-x-3 after:bottom-[-1px] after:h-0.5 after:transition-colors motion-reduce:transition-none sm:px-4 ${tab === itemTab.key ? "text-navy after:bg-primary-selected" : "text-ink-muted after:bg-transparent hover:bg-primary-wash hover:text-ink"}`}
              >
                {itemTab.label}{itemTab.count != null && itemTab.count > 0 ? ` · ${itemTab.count}` : ""}
              </Tabs.Trigger>
            {/each}
            </Tabs.List>
          </div>
        </Tabs.Root>
        <div class="flex min-h-12 shrink-0 items-center justify-between gap-3 border-t border-line-soft px-3 lg:border-l lg:border-t-0">
          <p class="flex min-w-0 items-center gap-2 text-xs font-medium text-ink-secondary" title={stats?.graph.message}>
            {#if stats?.graph.state === "configured"}
              <CheckCircleIcon size={16} class="shrink-0 text-emerald-700" aria-hidden="true" /><span class="truncate">Graph connected</span>
            {:else}
              <WarningCircleIcon size={16} class="shrink-0 text-amber-700" aria-hidden="true" /><span class="truncate">Graph not configured</span>
            {/if}
          </p>
          <Button type="button" size="sm" class="min-h-9 shrink-0 gap-2" disabled={syncBusy || syncRunning || stats?.graph.state !== "configured"} onclick={runSync}>
            <CloudArrowDownIcon size={16} aria-hidden="true" />{syncRunning ? "Syncing…" : "Sync now"}
          </Button>
        </div>
      </div>

      {#if selectedIds.length > 0}
        <div class="flex min-h-12 flex-wrap items-center gap-2 border-b border-line-soft bg-primary-wash px-3 py-1.5">
          <p class="mr-auto text-sm font-semibold text-ink">{selectedIds.length} selected</p>
          <Button type="button" size="sm" variant="secondary" class="min-h-9" onclick={() => selectedItems[0] && openReview(selectedItems[0])}>Review selected</Button>
          <Button type="button" size="sm" variant="secondary" class="min-h-9" onclick={() => requestBulkAction("reject")}>Reject</Button>
          <button type="button" class="min-h-9 rounded-lg px-3 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600 motion-reduce:transition-none" onclick={() => requestBulkAction("delete")}>Move to Deleted</button>
          <button type="button" class="min-h-9 rounded-lg px-3 text-sm font-medium text-ink-muted transition-colors hover:bg-white hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy motion-reduce:transition-none" onclick={clearSelection}>Clear</button>
        </div>
      {:else}
        <div class="flex min-h-12 flex-wrap items-center gap-x-4 gap-y-1 border-b border-line-soft bg-white px-3 py-2">
          <p class="text-sm font-medium text-ink">
            {#if tab === "review"}{stats?.pendingReview ?? 0} files waiting for review
            {:else if tab === "approved"}{stats?.approved ?? 0} approved files
            {:else if tab === "failed"}{stats?.failed ?? 0} failed files
            {:else if tab === "deleted"}{stats?.deleted ?? 0} deleted files
            {:else}{tabs.find((itemTab) => itemTab.key === tab)?.label}{/if}
          </p>
          <span class="text-xs text-ink-muted">Select files for bulk actions.</span>
          {#if stats?.graph.state === "configured" && latestRun}
            <span class="ml-auto text-xs text-ink-muted">Last sync {new Date(latestRun.startedAt).toLocaleString("en-CA")}</span>
          {:else if stats?.graph.state !== "configured"}
            <span class="ml-auto hidden text-xs text-ink-muted md:inline">Sync is unavailable until Microsoft Graph is configured.</span>
          {/if}
        </div>
      {/if}

      <div>
        {#if tab === "review" || tab === "approved" || tab === "rejected" || tab === "failed" || tab === "deleted"}
          {#if items === undefined}
            {@render spinner()}
          {:else if !items || items.length === 0}
            <div class="border-y border-line-soft px-4 py-10 text-center">
              <p class="text-sm font-medium text-ink-secondary">{tab === "review" ? "Nothing is waiting for review." : tab === "deleted" ? "No staged items have been deleted." : "Nothing here yet."}</p>
              {#if tab === "review"}<p class="mt-1 text-xs text-ink-muted">Run a sync to discover new OneDrive files.</p>{/if}
            </div>
          {:else}
            {@render sheetList(items, tab === "review")}
          {/if}
        {:else if tab === "gaps"}
          {#if gaps === undefined || !gaps}
            {@render spinner()}
          {:else}
            <div class="bg-white">
              {#each [
                { label: "PDs missing a transcript", rows: gaps.missingTranscript },
                { label: "Transcripts missing a PD", rows: gaps.missingPd },
                { label: "Multiple PD candidates", rows: gaps.ambiguous },
              ] as section, index (section.label)}
                <section class:border-t={index > 0} class="border-line-soft" aria-labelledby={`gap-section-${index}`}>
                  <header class="flex min-h-10 items-center gap-3 border-b border-line-soft bg-gray-50 px-4 py-2">
                    <h2 id={`gap-section-${index}`} class="min-w-0 flex-1 text-sm font-semibold text-ink">{section.label}</h2><span class="text-data text-ink-muted">{section.rows.length}</span>
                  </header>
                  {#if section.rows.length === 0}
                    <p class="px-4 py-4 text-sm text-ink-muted">No gaps in this category.</p>
                  {:else}
                    {@render sheetList(section.rows, false)}
                  {/if}
                </section>
              {/each}
            </div>
          {/if}
        {:else if runs === undefined}
          {@render spinner()}
        {:else if !runs || runs.length === 0}
          <div class="border-y border-line-soft px-4 py-10 text-center"><p class="text-sm font-medium text-ink-secondary">No syncs have run yet.</p></div>
        {:else}
          <div class="overflow-x-auto rounded-lg border border-line bg-white">
            <table class="w-full min-w-[42rem] text-sm">
              <thead><tr class="border-b border-line-soft bg-gray-50 text-left text-xs text-ink-muted">
                <th class="px-4 py-2.5 font-medium">Started</th><th class="px-4 py-2.5 font-medium">Status</th><th class="px-4 py-2.5 font-medium">Discovered</th><th class="px-4 py-2.5 font-medium">Processed</th><th class="px-4 py-2.5 font-medium">Skipped</th><th class="px-4 py-2.5 font-medium">Error</th>
              </tr></thead>
              <tbody>
                {#each runs as run (run._id)}
                  <tr class="border-b border-line-soft last:border-b-0">
                    <td class="whitespace-nowrap px-4 py-3 text-ink-secondary">{new Date(run.startedAt).toLocaleString("en-CA")}</td>
                    <td class="px-4 py-3"><span class={`rounded-md px-1.5 py-0.5 text-xs font-semibold ${run.status === "completed" ? "bg-emerald-100 text-emerald-800" : run.status === "failed" ? "bg-red-100 text-red-700" : "bg-blue-100 text-blue-800"}`}>{run.status}</span></td>
                    <td class="text-data px-4 py-3 text-ink-secondary">{run.discovered}</td><td class="text-data px-4 py-3 text-ink-secondary">{run.processed}</td><td class="text-data px-4 py-3 text-ink-secondary">{run.skipped}</td><td class="px-4 py-3 text-xs text-red-700">{run.error ?? ""}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
        {#if errorMsg && tab !== "review"}<p class="mt-3 text-sm font-medium text-red-700" role="alert">{errorMsg}</p>{/if}
      </div>
    {/if}
  </AdminWorkspacePage>
{/if}

<Dialog.Root bind:open={reviewDialogOpen} onOpenChange={(open) => { if (!open && busyId === null) { reviewTarget = null; errorMsg = null; } }}>
  <Dialog.Portal>
    <Dialog.Overlay class="fixed inset-0 z-[130] bg-[#052A28]/80" />
    <div class="pointer-events-none fixed inset-0 z-[130] flex items-end sm:items-center sm:justify-center sm:p-4">
      <Dialog.Content
        onEscapeKeydown={(event) => { if (busyId !== null) event.preventDefault(); }}
        onInteractOutside={(event) => { if (busyId !== null) event.preventDefault(); }}
        class="pointer-events-auto flex h-[100dvh] w-full flex-col overflow-hidden bg-white shadow-xl sm:h-auto sm:max-h-[90vh] sm:max-w-6xl sm:rounded-xl"
      >
        {#if reviewTarget}
          <header class="flex min-h-14 shrink-0 items-center gap-3 border-b border-line px-4">
            <span class="flex size-8 shrink-0 items-center justify-center rounded-md bg-chrome text-ink-muted"><FileTextIcon size={17} aria-hidden="true" /></span>
            <div class="min-w-0 flex-1">
              <Dialog.Title class="truncate text-base font-semibold text-ink">{reviewTarget.name}</Dialog.Title>
              <Dialog.Description class="truncate text-xs text-ink-muted">{reviewTarget.path.includes("\uFFFD") ? "Path contains unreadable characters" : reviewTarget.path}</Dialog.Description>
            </div>
            <Dialog.Close
              aria-label="Close file review"
              disabled={busyId !== null}
              class="flex size-11 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-primary-wash hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:opacity-50 motion-reduce:transition-none"
            >
              <XIcon size={19} aria-hidden="true" />
            </Dialog.Close>
          </header>

          <div class="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_22rem]">
            <section class="min-h-0 overflow-y-auto border-b border-line bg-gray-50 lg:border-b-0 lg:border-r" aria-label="File preview">
              <div class="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-line-soft bg-white px-5 py-3 text-xs">
                <span><span class="text-ink-muted">Client</span> <span class="ml-1 font-medium text-ink">{clientLabel(reviewTarget)}</span></span>
                <span><span class="text-ink-muted">Fiscal year</span> <span class="ml-1 font-medium text-ink">{cleanLabel(reviewTarget.fiscalYearLabel) || "—"}</span></span>
                <span class={`rounded-md px-1.5 py-0.5 font-semibold ${KIND_TONE[reviewTarget.docKind]}`}>{KIND_LABEL[reviewTarget.docKind]}</span>
                {#if reviewTarget.pairStatus}
                  <span class={`rounded-md px-1.5 py-0.5 font-medium ${reviewTarget.pairStatus === "paired" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>{PAIR_LABEL[reviewTarget.pairStatus]}</span>
                {/if}
                <span class="text-data ml-auto text-ink-muted">{fmtSize(reviewTarget.size)}</span>
              </div>
              <div class="p-5">
                {#if reviewTarget.extractNote}
                  <p class="mb-3 flex items-start gap-2 text-xs font-medium text-amber-800">
                    <WarningCircleIcon class="mt-0.5 shrink-0" size={15} aria-hidden="true" />{reviewTarget.extractNote}
                  </p>
                {/if}
                {#if reviewTarget.error}
                  <p class="mb-3 flex items-start gap-2 text-xs font-medium text-red-700" role="alert">
                    <WarningCircleIcon class="mt-0.5 shrink-0" size={15} aria-hidden="true" />{reviewTarget.error}
                  </p>
                {/if}
                {#if reviewTarget.text}
                  <pre class="whitespace-pre-wrap font-sans text-sm leading-6 text-ink-secondary">{reviewTarget.text}</pre>
                {:else}
                  <div class="flex min-h-64 flex-col items-center justify-center text-center">
                    <WarningCircleIcon size={24} class="text-amber-700" aria-hidden="true" />
                    <p class="mt-3 text-sm font-medium text-ink">No extracted text is available.</p>
                    <p class="mt-1 max-w-sm text-xs text-ink-muted">Review the source file or resolve the extraction issue before approving it.</p>
                  </div>
                {/if}
              </div>
            </section>

            <aside class="min-h-0 overflow-y-auto bg-white p-5" aria-label="Review actions">
              <h2 class="text-title text-ink">Review file</h2>
              <p class="mt-1 text-sm leading-relaxed text-ink-muted">Confirm the metadata before adding this document to the Brain.</p>

              {#if reviewTarget.status === "pending_review"}
                <div class="mt-5 space-y-4">
                  <label class="block text-xs font-medium text-ink-secondary">
                    Industry <span class="text-red-600">*</span>
                    <input class="field-control mt-1.5 w-full rounded-lg px-3 py-2.5 text-sm text-ink" bind:value={industry} placeholder="Software / IT" />
                  </label>
                  <label class="block text-xs font-medium text-ink-secondary">
                    Writer
                    <input class="field-control mt-1.5 w-full rounded-lg px-3 py-2.5 text-sm text-ink" bind:value={writerName} placeholder="Optional" />
                  </label>
                  <div class="grid grid-cols-2 gap-3">
                    <label class="text-xs font-medium text-ink-secondary">
                      Writer tier
                      <select class="field-control mt-1.5 w-full rounded-lg px-3 py-2.5 text-sm text-ink" bind:value={writerTier}>
                        <option value="1">1.0</option><option value="0.7">0.7</option><option value="0.4">0.4</option><option value="0.2">0.2</option>
                      </select>
                    </label>
                    <label class="text-xs font-medium text-ink-secondary">
                      Science code
                      <input class="field-control mt-1.5 w-full rounded-lg px-3 py-2.5 text-sm text-ink" bind:value={scienceCode} placeholder="Optional" />
                    </label>
                  </div>
                  <label class="block text-xs font-medium text-ink-secondary">
                    Rejection note
                    <textarea class="field-control mt-1.5 min-h-20 w-full resize-y rounded-lg px-3 py-2.5 text-sm text-ink" bind:value={rejectNote} placeholder="Optional context for rejection"></textarea>
                  </label>
                </div>

                {#if errorMsg}<p class="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700" role="alert">{errorMsg}</p>{/if}

                <div class="mt-5 space-y-2 border-t border-line-soft pt-4">
                  <Button type="button" class="min-h-11 w-full justify-center" disabled={busyId === reviewTarget._id || !reviewTarget.text || !industry.trim()} onclick={approveCurrentReview}>
                    {busyId === reviewTarget._id ? "Working…" : "Approve into the Brain"}
                  </Button>
                  <Button type="button" variant="secondary" class="min-h-11 w-full justify-center" disabled={busyId === reviewTarget._id} onclick={rejectCurrentReview}>Reject file</Button>
                  <button
                    type="button"
                    class="min-h-11 w-full rounded-lg px-3 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600 motion-reduce:transition-none"
                    disabled={busyId === reviewTarget._id}
                    onclick={() => { const item = reviewTarget; closeReview(true); if (item) requestDelete(item); }}
                  >Move to Deleted</button>
                </div>
              {:else if reviewTarget.status === "deleted"}
                <Button type="button" class="mt-5 min-h-11 w-full justify-center gap-2" disabled={busyId === reviewTarget._id} onclick={restoreCurrentReview}>
                  <ArrowCounterClockwiseIcon size={17} aria-hidden="true" />Restore to review queue
                </Button>
              {:else}
                <div class="mt-5 border-y border-line-soft py-4">
                  <p class="text-sm font-medium capitalize text-ink">{reviewTarget.status.replaceAll("_", " ")}</p>
                  {#if reviewTarget.reviewNote}<p class="mt-1 text-xs leading-relaxed text-ink-muted">{reviewTarget.reviewNote}</p>{/if}
                </div>
              {/if}
            </aside>
          </div>
        {/if}
      </Dialog.Content>
    </div>
  </Dialog.Portal>
</Dialog.Root>

<Dialog.Root bind:open={bulkDialogOpen} onOpenChange={(open) => { if (!open && !bulkBusy) { bulkAction = null; bulkError = null; } }}>
  <Dialog.Portal>
    <Dialog.Overlay class="fixed inset-0 z-[140] bg-[#052A28]/80" />
    <div class="pointer-events-none fixed inset-0 z-[140] flex items-end sm:items-center sm:justify-center sm:p-4">
      <Dialog.Content
        onEscapeKeydown={(event) => { if (bulkBusy) event.preventDefault(); }}
        onInteractOutside={(event) => { if (bulkBusy) event.preventDefault(); }}
        class="pointer-events-auto w-full rounded-t-xl bg-white p-5 shadow-xl sm:max-w-md sm:rounded-xl"
      >
        <Dialog.Title class="text-title">{bulkAction === "delete" ? "Move selected files to Deleted?" : "Reject selected files?"}</Dialog.Title>
        <Dialog.Description class="mt-2 text-sm leading-relaxed text-ink-secondary">
          {#if bulkAction === "delete"}
            {selectedItems.length} selected files will move to Deleted and can be restored later. Their original OneDrive files are not changed.
          {:else}
            {selectedItems.length} selected files will leave the review queue with a rejection note.
          {/if}
        </Dialog.Description>
        {#if bulkError}<p class="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{bulkError}</p>{/if}
        <div class="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Dialog.Close disabled={bulkBusy} class="min-h-11 rounded-lg px-4 text-sm font-medium text-ink-secondary transition-colors hover:bg-primary-wash hover:text-ink disabled:opacity-50 motion-reduce:transition-none">Cancel</Dialog.Close>
          <button
            type="button"
            disabled={bulkBusy}
            class={`min-h-11 rounded-lg px-4 text-sm font-semibold text-white transition-colors disabled:opacity-50 motion-reduce:transition-none ${bulkAction === "delete" ? "bg-red-600 hover:bg-red-700" : "bg-navy hover:bg-fir"}`}
            onclick={runBulkAction}
          >{bulkBusy ? "Working…" : bulkAction === "delete" ? "Move to Deleted" : "Reject selected"}</button>
        </div>
      </Dialog.Content>
    </div>
  </Dialog.Portal>
</Dialog.Root>

<Dialog.Root bind:open={deleteDialogOpen} onOpenChange={(open) => { if (!open && busyId === null) { deleteTarget = null; deleteError = null; } }}>
  <Dialog.Portal>
    <Dialog.Overlay class="fixed inset-0 z-[130] bg-[#052A28]/80" />
    <div class="pointer-events-none fixed inset-0 z-[130] flex items-end sm:items-center sm:justify-center sm:p-4">
      <Dialog.Content
        onEscapeKeydown={(event) => { if (busyId !== null) event.preventDefault(); }}
        onInteractOutside={(event) => { if (busyId !== null) event.preventDefault(); }}
        class="pointer-events-auto w-full rounded-t-xl bg-white p-5 shadow-xl sm:max-w-md sm:rounded-xl"
      >
        <Dialog.Title class="text-title">Delete this staged item?</Dialog.Title>
        <Dialog.Description class="mt-2 text-sm leading-relaxed text-ink-secondary">
          {deleteTarget?.name ?? "This file"} will move to Deleted and can be restored later. The original OneDrive file and approved Brain content are not changed.
        </Dialog.Description>
        {#if deleteError}<p class="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 shadow-[inset_0_0_0_1px_var(--color-red-200)]" role="alert">{deleteError}</p>{/if}
        <div class="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Dialog.Close disabled={busyId !== null} class="min-h-11 rounded-lg px-4 text-sm font-medium text-ink-secondary transition-colors hover:bg-primary-wash hover:text-ink disabled:opacity-50 motion-reduce:transition-none">Keep item</Dialog.Close>
          <button type="button" disabled={busyId !== null} class="min-h-11 rounded-lg bg-red-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-50 motion-reduce:transition-none" onclick={removeItem}>
            {busyId !== null ? "Deleting…" : "Move to Deleted"}
          </button>
        </div>
      </Dialog.Content>
    </div>
  </Dialog.Portal>
</Dialog.Root>
