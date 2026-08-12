<script lang="ts">
  // Frozen current-dashboard My Work projection. This is the rollback surface
  // for users outside the workspace-preview cohort: one active accountability
  // lane at a time, tabbed navigation, desktop table/mobile ledger, and only
  // the active lane's bounded subscriptions. Keep preview board/list work in
  // MyWorkView.svelte; do not merge the two presentation contracts.
  import { resolve } from "$app/paths";
  import { useMutation, usePaginatedQuery, useQuery } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import type { FunctionReturnType } from "convex/server";
  import { toast } from "svelte-sonner";
  import { api } from "../../../../convex/_generated/api";
  import type { Id } from "../../../../convex/_generated/dataModel";
  import { MY_WORK_PAGE_SIZE, WORK_ITEM_KIND_LABELS } from "../../../../shared/workItems";
  import { firmDateStartAfterDays } from "../../../../shared/firmTime";
  import { MY_WORK_DUE_SOON_DAYS } from "../../../../shared/workItems";
  import Button from "$lib/components/ui/Button.svelte";
  import StageBadge from "$lib/components/ui/StageBadge.svelte";
  import ReassignWorkItemDialog from "$lib/components/project/ReassignWorkItemDialog.svelte";
  import { formatDue } from "$lib/workflow/due";
  import { userErrorCode, userErrorMessage } from "$lib/errors";

  type Lane = "assigned" | "owned" | "reviews" | "due" | "waiting";
  type ItemRow = FunctionReturnType<typeof api.myWork.listAssignedToMe>["page"][number];
  type OwnedRow = FunctionReturnType<typeof api.myWork.listOwnedByMe>["page"][number];
  const lanes: { id: Lane; label: string }[] = [
    { id: "assigned", label: "Assigned to me" },
    { id: "owned", label: "Owned by me" },
    { id: "reviews", label: "Reviews" },
    { id: "due", label: "Due soon" },
    { id: "waiting", label: "Waiting on others" },
  ];

  const auth = useAuth();
  let lane = $state<Lane>("assigned");
  let now = $state(Date.now());
  const windowEndAt = $derived(firmDateStartAfterDays(now, MY_WORK_DUE_SOON_DAYS));
  const assignedQ = usePaginatedQuery(api.myWork.listAssignedToMe, () => auth.isAuthenticated && lane === "assigned" ? {} : "skip", { initialNumItems: MY_WORK_PAGE_SIZE });
  const ownedQ = usePaginatedQuery(api.myWork.listOwnedByMe, () => auth.isAuthenticated && lane === "owned" ? {} : "skip", { initialNumItems: MY_WORK_PAGE_SIZE });
  const reviewsQ = usePaginatedQuery(api.myWork.listReviews, () => auth.isAuthenticated && lane === "reviews" ? {} : "skip", { initialNumItems: MY_WORK_PAGE_SIZE });
  const dueQ = usePaginatedQuery(api.myWork.listDueSoon, () => auth.isAuthenticated && lane === "due" ? { windowEndAt } : "skip", { initialNumItems: MY_WORK_PAGE_SIZE });
  const waitingQ = usePaginatedQuery(api.myWork.listWaitingOnOthers, () => auth.isAuthenticated && lane === "waiting" ? {} : "skip", { initialNumItems: MY_WORK_PAGE_SIZE });
  let actionBusyId = $state<Id<"workItems"> | null>(null);
  let reassignItem = $state<ItemRow | null>(null);
  let reassignOpen = $state(false);
  let actionError = $state<string | null>(null);

  const completeWork = useMutation(api.workItems.complete);
  const reassignWork = useMutation(api.workItems.reassign);
  const selectedItemQ = useQuery(api.workItems.listAssigneeCandidates, () => reassignItem ? { projectId: reassignItem.projectId, workItemId: reassignItem.workItemId } : "skip");
  const waitingStateQ = useQuery(api.myWork.getWaitingLaneState, () => auth.isAuthenticated && lane === "waiting" ? {} : "skip");

  const activeQ = $derived(lane === "assigned" ? assignedQ : lane === "owned" ? ownedQ : lane === "reviews" ? reviewsQ : lane === "due" ? dueQ : waitingQ);
  const itemRows = $derived((lane === "assigned" ? assignedQ.results : lane === "reviews" ? reviewsQ.results : lane === "due" ? dueQ.results : lane === "waiting" ? waitingQ.results : []) as ItemRow[]);
  const ownedRows = $derived((lane === "owned" ? ownedQ.results : []) as OwnedRow[]);
  const waitingSyncing = $derived(Boolean(waitingStateQ.data?.syncing));

  async function complete(row: ItemRow) {
    actionBusyId = row.workItemId;
    try {
      await completeWork({ workItemId: row.workItemId, expectedVersion: row.version });
      toast.success("Work item completed");
    } catch (error) {
      actionError = userErrorMessage(error, "The work item could not be completed.");
      if (userErrorCode(error) === "STALE_REVISION") actionError = "This work item changed. Review the refreshed row, then confirm completion again.";
    } finally { actionBusyId = null; }
  }
  async function reassign(toAssigneeId: Id<"users">) {
    if (!reassignItem) return;
    actionBusyId = reassignItem.workItemId;
    try {
      await reassignWork({ workItemId: reassignItem.workItemId, toAssigneeId, expectedVersion: reassignItem.version });
      reassignOpen = false;
      toast.success("Work item reassigned");
    } catch (error) { actionError = userErrorMessage(error, "The work item could not be reassigned."); }
    finally { actionBusyId = null; }
  }
  function switchLane(next: Lane) { lane = next; actionError = null; now = Date.now(); }
  function refreshReassignItem() {
    if (!reassignItem) return;
    const latest = itemRows.find((row) => row.workItemId === reassignItem?.workItemId);
    if (latest) { reassignItem = latest; actionError = null; }
  }
  $effect(() => {
    const timer = window.setInterval(() => { now = Date.now(); }, 60_000);
    const onVisible = () => { if (!document.hidden) now = Date.now(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  });
  function laneKeydown(event: KeyboardEvent, index: number) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next = (index + (event.key === "ArrowRight" ? 1 : -1) + lanes.length) % lanes.length;
    switchLane(lanes[next].id);
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-work-lane="${lanes[next].id}"]`)?.focus());
  }
</script>

<section aria-labelledby="my-work-title">
  <div class="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between"><div><h1 id="my-work-title" class="text-display">My work</h1><p class="mt-1 text-sm text-ink-muted">Your next actions across every project.</p></div></div>
  <div class="mt-6 overflow-x-auto border-b border-line" role="tablist" aria-label="My work lanes">
    <div class="flex min-w-max gap-1">{#each lanes as item (item.id)}<button type="button" role="tab" id={`work-tab-${item.id}`} aria-controls="my-work-panel" aria-selected={lane === item.id} tabindex={lane === item.id ? 0 : -1} data-work-lane={item.id} onkeydown={(event) => laneKeydown(event, lanes.indexOf(item))} class={`min-h-11 rounded-t-lg px-4 text-sm font-semibold ${lane === item.id ? "bg-white text-navy shadow-[inset_0_-2px_0_var(--color-primary)]" : "text-ink-muted hover:bg-primary-wash hover:text-navy"}`} onclick={() => switchLane(item.id)}>{item.label}</button>{/each}</div>
  </div>

  <div id="my-work-panel" role="tabpanel" aria-labelledby={`work-tab-${lane}`}>
  {#if actionError}<p class="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">{actionError}</p>{/if}
  {#if activeQ.error}
    <div class="mt-6 rounded-xl border border-red-200 bg-white p-6" role="alert"><h2 class="text-title">This lane could not be loaded</h2><p class="mt-1 text-sm text-ink-muted">Refresh the page and try again.</p></div>
  {:else if activeQ.status === "LoadingFirstPage"}
    <div class="mt-6 space-y-2" aria-label="Loading work"><div class="h-16 animate-pulse rounded-xl bg-chrome motion-reduce:animate-none"></div><div class="h-16 animate-pulse rounded-xl bg-chrome motion-reduce:animate-none"></div><div class="h-16 animate-pulse rounded-xl bg-chrome motion-reduce:animate-none"></div></div>
  {:else if lane === "waiting" && waitingStateQ.data?.failed}
    <div class="mt-6 rounded-xl border border-red-200 bg-white p-8 text-center" role="alert"><h2 class="text-title">Assignment sync needs repair</h2><p class="mt-1 text-sm text-ink-muted">An administrator must retry the ownership reconciliation before Waiting on others is authoritative.</p></div>
  {:else if lane === "waiting" && waitingSyncing}
    <div class="mt-6 card p-8 text-center" role="status"><h2 class="text-title">Syncing assignments</h2><p class="mt-1 text-sm text-ink-muted">Ownership changed recently. Exact Waiting on others results will appear when reconciliation finishes.</p></div>
  {:else if lane === "owned"}
    {#if ownedRows.length === 0}<div class="mt-6 card p-8 text-center"><h2 class="text-title">No projects owned by you</h2><p class="mt-1 text-sm text-ink-muted">Check Assigned to me for temporary handoffs.</p></div>{:else}<div class="mt-6 overflow-hidden rounded-xl border border-line bg-white"><table class="hidden w-full border-collapse md:table"><caption class="sr-only">Projects owned by me in workflow order</caption><thead><tr class="border-b border-line bg-chrome/60 text-left text-label"><th scope="col" class="px-4 py-3">Project</th><th scope="col" class="px-4 py-3">Stage</th><th scope="col" class="px-4 py-3">Next action</th><th scope="col" class="px-4 py-3">Due</th><th scope="col" class="px-4 py-3">People</th></tr></thead><tbody class="divide-y divide-line-soft">{#each ownedRows as row (row.projectId)}{@const due = formatDue(row.currentHandoff?.dueAt ?? null, now)}<tr><td class="px-4 py-3"><a href={resolve("/project/[id]", { id: row.projectId })} class="inline-flex min-h-11 items-center font-semibold text-navy">{row.projectTitle}</a><p class="text-xs text-ink-muted">{row.clientName}</p></td><td class="px-4 py-3"><StageBadge stage={row.workflowStage} /></td><td class="px-4 py-3 text-sm">{row.currentHandoff ? WORK_ITEM_KIND_LABELS[row.currentHandoff.kind] : "No current handoff"}</td><td class="px-4 py-3 text-sm">{due ? `${due.absolute} · ${due.relative}` : "Not set"}</td><td class="px-4 py-3 text-xs text-ink-muted">{#if row.currentHandoff}<p>With {row.currentHandoff.assignee.label}</p><p>From {row.currentHandoff.assigner.label}</p>{:else}—{/if}</td></tr>{/each}</tbody></table><ul class="divide-y divide-line-soft md:hidden">{#each ownedRows as row (row.projectId)}{@const due = formatDue(row.currentHandoff?.dueAt ?? null, now)}<li class="p-4"><a href={resolve("/project/[id]", { id: row.projectId })} class="inline-flex min-h-11 items-center text-sm font-semibold text-navy">{row.projectTitle}</a><p class="text-xs text-ink-muted">{row.clientName}</p><div class="mt-3"><StageBadge stage={row.workflowStage} /></div><dl class="mt-3 grid grid-cols-[6rem_1fr] gap-2 text-sm"><dt class="text-label">Next action</dt><dd>{row.currentHandoff ? WORK_ITEM_KIND_LABELS[row.currentHandoff.kind] : "No current handoff"}</dd><dt class="text-label">Due</dt><dd>{due ? `${due.absolute} · ${due.relative}` : "Not set"}</dd><dt class="text-label">With</dt><dd>{row.currentHandoff?.assignee.label ?? "—"}</dd><dt class="text-label">From</dt><dd>{row.currentHandoff?.assigner.label ?? "—"}</dd></dl></li>{/each}</ul></div>{/if}
  {:else if itemRows.length === 0}
    <div class="mt-6 card p-8 text-center"><h2 class="text-title">Nothing here right now</h2><p class="mt-1 text-sm text-ink-muted">{lane === "assigned" ? "Check Owned by me for projects needing direction." : lane === "reviews" ? "No internal reviews are assigned to you — check Assigned to me." : lane === "due" ? "No work is due in this window — check Assigned to me." : "No open work is waiting on someone else — check Owned by me."}</p></div>
  {:else}
    <div class="mt-6 overflow-hidden rounded-xl border border-line bg-white">
      <div class="hidden overflow-x-auto md:block"><table class="w-full border-collapse"><caption class="sr-only">{lanes.find((item) => item.id === lane)?.label}</caption><thead><tr class="border-b border-line bg-chrome/60 text-left text-label"><th scope="col" class="px-4 py-3">Project</th><th scope="col" class="px-4 py-3">Stage</th><th scope="col" class="px-4 py-3">Work</th><th scope="col" class="px-4 py-3">Due</th><th scope="col" class="px-4 py-3">People</th><th scope="col" class="px-4 py-3 text-right">Actions</th></tr></thead><tbody class="divide-y divide-line-soft">{#each itemRows as row (row.workItemId)}{@const due = formatDue(row.dueAt, now)}<tr><td class="px-4 py-3"><a href={resolve("/project/[id]", { id: row.projectId })} class="inline-flex min-h-11 items-center font-semibold text-navy hover:text-primary-selected">{row.projectTitle}</a><p class="text-xs text-ink-muted">{row.clientName}</p></td><td class="px-4 py-3"><StageBadge stage={row.workflowStage} /></td><td class="px-4 py-3 text-sm">{WORK_ITEM_KIND_LABELS[row.kind]}</td><td class="px-4 py-3">{#if due}<span class="text-data">{due.absolute}</span><p class={`text-xs font-semibold ${due.overdue ? "text-red-700" : "text-ink-muted"}`}>{due.relative}</p>{:else}<span class="text-sm text-ink-muted">No due date</span>{/if}</td><td class="px-4 py-3 text-xs text-ink-muted"><p>With {row.assignee.label}</p><p>From {row.assigner.label}</p></td><td class="px-4 py-3"><div class="flex justify-end gap-1">{#if row.viewerCanComplete}<Button size="sm" class="min-h-11" disabled={actionBusyId === row.workItemId} onclick={() => complete(row)}>Complete</Button>{/if}{#if row.viewerCanManage}<Button size="sm" variant="secondary" class="min-h-11" onclick={() => { reassignItem = row; reassignOpen = true; }}>Reassign</Button>{/if}</div></td></tr>{/each}</tbody></table></div>
      <ul class="divide-y divide-line-soft md:hidden">{#each itemRows as row (row.workItemId)}{@const due = formatDue(row.dueAt, now)}<li class="p-4"><a href={resolve("/project/[id]", { id: row.projectId })} class="inline-flex min-h-11 items-center text-sm font-semibold text-navy">{row.projectTitle}</a><p class="mt-0.5 text-xs text-ink-muted">{row.clientName}</p><div class="mt-3"><StageBadge stage={row.workflowStage} /></div><dl class="mt-3 grid grid-cols-[6rem_1fr] gap-x-3 gap-y-2 text-sm"><dt class="text-label">Work</dt><dd>{WORK_ITEM_KIND_LABELS[row.kind]}</dd><dt class="text-label">Due</dt><dd>{due ? `${due.absolute} · ${due.relative}` : "No due date"}</dd><dt class="text-label">With</dt><dd>{row.assignee.label}</dd><dt class="text-label">From</dt><dd>{row.assigner.label}</dd></dl><div class="mt-3 flex gap-2">{#if row.viewerCanComplete}<Button size="sm" class="min-h-11" disabled={actionBusyId === row.workItemId} onclick={() => complete(row)}>Complete</Button>{/if}{#if row.viewerCanManage}<Button size="sm" variant="secondary" class="min-h-11" onclick={() => { reassignItem = row; reassignOpen = true; }}>Reassign</Button>{/if}</div></li>{/each}</ul>
    </div>
  {/if}
  {#if activeQ.status === "CanLoadMore" || activeQ.status === "LoadingMore"}<div class="mt-6 flex justify-center"><Button variant="secondary" disabled={activeQ.status === "LoadingMore"} onclick={() => activeQ.loadMore(MY_WORK_PAGE_SIZE)}>{activeQ.status === "LoadingMore" ? "Loading…" : "Load more"}</Button></div>{/if}
  </div>
</section>

<ReassignWorkItemDialog bind:open={reassignOpen} candidates={selectedItemQ.data?.candidates ?? []} selectedId={reassignItem?.assignee.userId ?? null} loading={selectedItemQ.isLoading} failed={Boolean(selectedItemQ.error)} busy={Boolean(actionBusyId)} errorMessage={actionError} onUseLatest={refreshReassignItem} onSubmit={reassign} />
