<!--
  The Details panel's quiet "More" disclosure (ui-design-final.md section 11,
  decision 19): the project facts and workflow tools the screens do not show,
  kept reachable. Internal title, client, SR&ED title, writer and interview
  names, project type, review source, tags and views; other open work items
  with reassign and cancel, Assign work, Transfer owner; and the activity log.
  Mounted only while More is open, so its queries subscribe only then.
-->
<script lang="ts">
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { useMutation, useQuery } from "convex-svelte";
  import { toast } from "svelte-sonner";
  import { api } from "../../../../../convex/_generated/api";
  import type { Doc, Id } from "../../../../../convex/_generated/dataModel";
  import { WORK_ITEM_KIND_LABELS } from "../../../../../shared/workItems";
  import { PROJECT_TYPE_LABELS, effectiveProjectType } from "../../../../../shared/projectTypes";
  import { userErrorCode, userErrorMessage } from "$lib/errors";
  import { createRequestId as createRequestIdValue } from "$lib/requestId";
  import { assignmentDefaults, firmDateInputToTimestamp } from "$lib/workflow/assignmentDefaults";
  import Button from "$lib/components/ui/Button.svelte";
  import DisclosureChevron from "$lib/components/ui/DisclosureChevron.svelte";
  import EditableText from "$lib/components/project/EditableText.svelte";
  import TagPicker from "$lib/components/project-new/TagPicker.svelte";
  import ProjectActivityList from "$lib/components/project/ProjectActivityList.svelte";
  import OwnerTransferDialog from "$lib/components/project/OwnerTransferDialog.svelte";
  import ReassignWorkItemDialog from "$lib/components/project/ReassignWorkItemDialog.svelte";
  import CancelWorkItemDialog from "$lib/components/project/CancelWorkItemDialog.svelte";
  import AssignmentComposerDialog, {
    type AssignmentValues,
    type BlockingConflict,
  } from "$lib/components/project/AssignmentComposerDialog.svelte";
  import type { WorkItemSummary } from "$lib/components/project/WorkflowDetailsPanel.svelte";
  import PersonAvatar from "./PersonAvatar.svelte";
  import type { DetailsDataController } from "./detailsData.svelte";

  let {
    projectId,
    project,
    canEditDetails,
    details,
  }: {
    projectId: Id<"projects">;
    project: Doc<"projects">;
    canEditDetails: boolean;
    details: DetailsDataController;
  } = $props();

  const auth = useAuth();
  const componentId = $props.id();

  const tagsQ = useQuery(api.tags.listTags, () => (auth.isAuthenticated ? {} : "skip"));
  const viewSummaryQ = useQuery(api.reportViews.getViewSummary, () =>
    auth.isAuthenticated ? { projectId } : "skip"
  );
  const sourceProjectQ = useQuery(api.projects.getProject, () =>
    auth.isAuthenticated && project.sourceProjectId ? { projectId: project.sourceProjectId } : "skip"
  );
  const updateTitles = useMutation(api.projects.updateProjectTitles);
  const updateClientName = useMutation(api.projects.updateProjectClientName);
  const updateProjectTags = useMutation(api.projects.updateProjectTags);

  // Tags: string[] so it can bind into the shared TagPicker.
  let selectedTagIds = $state<string[]>([]);
  let tagsSaving = $state(false);
  let tagError = $state("");
  $effect(() => {
    selectedTagIds = [...(project.tagIds ?? [])];
  });
  async function handleTagsChange(ids: string[]) {
    tagsSaving = true;
    tagError = "";
    try {
      await updateProjectTags({ projectId, tagIds: ids as Id<"tags">[] });
    } catch (error) {
      selectedTagIds = [...(project.tagIds ?? [])];
      tagError = userErrorMessage(error, "The project tags could not be updated.");
    } finally {
      tagsSaving = false;
    }
  }

  const header = $derived(details.header);
  const workPanel = $derived(details.workPanel);
  const otherWork = $derived((workPanel?.openItems ?? []).filter((item) => !item.isCurrentHandoff));
  const canManageOwner = $derived(
    Boolean(header?.viewerAuthorities.some((authority) => authority === "owner" || authority === "manager" || authority === "admin"))
  );
  const canAssign = $derived(Boolean(workPanel?.viewer.canCreate && workPanel.assignable && workPanel.pointerHealthy));

  // Activity: subscribes only while its disclosure is open.
  let activityOpen = $state(false);
  const activityQ = useQuery(api.projectActivity.listProjectActivity, () =>
    auth.isAuthenticated && activityOpen ? { projectId } : "skip"
  );
  const activityState = $derived<"loading" | "ready" | "error" | "denied">(
    activityQ.error ? "error" : activityQ.data === undefined ? "loading" : activityQ.data === null ? "denied" : "ready"
  );

  // Work item and owner dialogs (the tools the old Workflow popover carried).
  let reassignOpen = $state(false);
  let cancelOpen = $state(false);
  let transferOpen = $state(false);
  let composerOpen = $state(false);
  let selected = $state<WorkItemSummary | null>(null);
  let reassignPrefill = $state<Id<"users"> | null>(null);
  let actionBusy = $state(false);
  let actionError = $state<string | null>(null);
  let transferBusy = $state(false);
  let transferError = $state<string | null>(null);
  let transferBaseline = $state<{ version: number; ownerLabel: string | null } | null>(null);
  let composerBusy = $state(false);
  let composerError = $state<string | null>(null);
  let conflict = $state<BlockingConflict | null>(null);
  let createRequestId = $state(createRequestIdValue());
  let createRequestFingerprint = $state<string | null>(null);
  const composerDefaults = assignmentDefaults("other");

  const assigneesQ = useQuery(api.workItems.listAssigneeCandidates, () =>
    auth.isAuthenticated && (composerOpen || reassignOpen)
      ? { projectId, ...(reassignOpen && selected ? { workItemId: selected.workItemId } : {}) }
      : "skip"
  );
  const ownerCandidatesQ = useQuery(api.projectWorkflow.listOwnerTransferCandidates, () =>
    auth.isAuthenticated && transferOpen ? { projectId } : "skip"
  );
  const reassignWork = useMutation(api.workItems.reassign);
  const cancelWork = useMutation(api.workItems.cancel);
  const createWork = useMutation(api.workItems.create);
  const transferOwnership = useMutation(api.projectWorkflow.transferOwnership);

  function openReassign(item: WorkItemSummary, prefill?: Id<"users">) {
    selected = item;
    reassignPrefill = prefill ?? item.assignee.userId;
    actionError = null;
    composerOpen = false;
    reassignOpen = true;
  }
  function openCancel(item: WorkItemSummary) {
    selected = item;
    actionError = null;
    cancelOpen = true;
  }
  function openTransfer() {
    if (!header) return;
    transferBaseline = { version: header.workflowVersion, ownerLabel: header.owner?.label ?? null };
    transferError = null;
    transferOpen = true;
  }
  function openComposer() {
    createRequestId = createRequestIdValue();
    createRequestFingerprint = null;
    composerError = null;
    conflict = null;
    composerOpen = true;
  }

  async function submitReassign(toUserId: Id<"users">) {
    if (!selected) return;
    actionBusy = true;
    actionError = null;
    try {
      const result = await reassignWork({ workItemId: selected.workItemId, toAssigneeId: toUserId, expectedVersion: selected.version });
      if (result.status === "updated") toast.success("Work item reassigned. Stage unchanged.");
      else toast.info("That person already has this work item.");
      reassignOpen = false;
    } catch (error) {
      actionError = userErrorMessage(error, "The work item could not be reassigned.");
    } finally {
      actionBusy = false;
    }
  }

  async function submitCancel(reason?: string) {
    if (!selected) return;
    actionBusy = true;
    actionError = null;
    try {
      await cancelWork({ workItemId: selected.workItemId, expectedVersion: selected.version, reason });
      toast.success("Work item canceled.");
      cancelOpen = false;
    } catch (error) {
      actionError = userErrorMessage(error, "The work item could not be canceled.");
    } finally {
      actionBusy = false;
    }
  }

  async function submitTransfer(toUserId: Id<"users">, note?: string) {
    if (!transferBaseline) return;
    transferBusy = true;
    transferError = null;
    try {
      const result = await transferOwnership({ projectId, toUserId, note, expectedVersion: transferBaseline.version });
      if (result.status === "updated") toast.success("Project ownership transferred.");
      else toast.info("No ownership change was needed.");
      transferOpen = false;
    } catch (error) {
      transferError =
        userErrorCode(error) === "STALE_REVISION"
          ? "This project's workflow changed while this dialog was open. Review the latest values, then retry."
          : userErrorMessage(error, "Project ownership could not be transferred.");
    } finally {
      transferBusy = false;
    }
  }

  async function submitAssignment(values: AssignmentValues) {
    const dueAt = firmDateInputToTimestamp(values.dueDate);
    const fingerprint = JSON.stringify({
      kind: values.kind,
      assigneeId: values.assigneeId,
      blocking: values.blocking,
      dueAt: dueAt ?? null,
      instructions: values.instructions,
      changeStage: values.changeStage,
      workflowVersion: values.changeStage ? (header?.workflowVersion ?? null) : null,
    });
    if (createRequestFingerprint && createRequestFingerprint !== fingerprint) createRequestId = createRequestIdValue();
    createRequestFingerprint = fingerprint;
    composerBusy = true;
    composerError = null;
    conflict = null;
    try {
      await createWork({
        projectId,
        kind: values.kind,
        assigneeId: values.assigneeId,
        blocking: values.blocking,
        dueAt,
        instructions: values.instructions,
        createRequestId,
        ...(values.changeStage && header
          ? { confirmedStageChange: "internal_review" as const, expectedWorkflowVersion: header.workflowVersion }
          : {}),
      });
      toast.success(values.changeStage ? "Internal review handoff created and Stage updated." : "Work assigned.");
      composerOpen = false;
    } catch (error) {
      if (userErrorCode(error) === "BLOCKING_EXISTS") {
        const current = workPanel?.openItems.find((item) => item.isCurrentHandoff);
        if (current) {
          conflict = {
            workItemId: current.workItemId,
            assigneeLabel: current.assignee.label,
            kindLabel: WORK_ITEM_KIND_LABELS[current.kind],
            canReassign: current.viewerCanManage,
          };
        } else {
          composerError = "This project already has a blocking handoff. Review the latest details and retry.";
        }
      } else {
        composerError = userErrorMessage(error, "Work could not be assigned.");
      }
    } finally {
      composerBusy = false;
    }
  }

  const rowClass = "grid min-h-[34px] grid-cols-[104px_minmax(0,1fr)] items-center gap-x-0 text-[13px]";
  const quietButton =
    "rounded-md px-2 py-1 text-xs text-ink-secondary transition-colors hover:bg-gray-50 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir pointer-coarse:min-h-11";
</script>

{#snippet readonlyValue(value: string)}
  <p class="min-w-0 truncate text-ink">
    {#if value}{value}{:else}<span class="text-ink-faint">Not set</span>{/if}
  </p>
{/snippet}

<div class="flex flex-col">
  <div class={rowClass}>
    <span class="text-ink-muted">Internal title</span>
    <div class="min-w-0">
      {#if canEditDetails}
        <EditableText value={project.title} placeholder="Set internal title" label="internal project title" required onSave={async (value) => { await updateTitles({ projectId, title: value.trim() }); }} />
      {:else}
        {@render readonlyValue(project.title)}
      {/if}
    </div>
  </div>
  <div class={rowClass}>
    <span class="text-ink-muted">Client</span>
    <div class="min-w-0">
      {#if canEditDetails}
        <EditableText value={project.clientName} placeholder="Set client name" label="client name" required onSave={async (value) => { await updateClientName({ projectId, clientName: value.trim() }); }} />
      {:else}
        {@render readonlyValue(project.clientName)}
      {/if}
    </div>
  </div>
  <div class={rowClass}>
    <span class="text-ink-muted">SR&amp;ED title</span>
    <div class="min-w-0">
      {#if canEditDetails}
        <EditableText value={project.sredTitle ?? ""} placeholder="Add the formal SR&ED title" label="SR&ED title" onSave={async (value) => { await updateTitles({ projectId, sredTitle: value }); }} />
      {:else}
        {@render readonlyValue(project.sredTitle ?? "")}
      {/if}
    </div>
  </div>
  <div class={rowClass}>
    <span class="text-ink-muted">Writer</span>
    {@render readonlyValue(project.writer?.trim() || "Unknown writer")}
  </div>
  {#if project.interviewer?.trim()}
    <div class={rowClass}>
      <span class="text-ink-muted">Interviewer</span>
      {@render readonlyValue(project.interviewer.trim())}
    </div>
  {/if}
  {#if (project.interviewees ?? []).some((name) => name.trim())}
    <div class={rowClass}>
      <span class="text-ink-muted">Interviewees</span>
      <p class="min-w-0 text-ink">{(project.interviewees ?? []).map((name) => name.trim()).filter(Boolean).join(", ")}</p>
    </div>
  {/if}
  <div class={rowClass}>
    <span class="text-ink-muted">Project type</span>
    {@render readonlyValue(PROJECT_TYPE_LABELS[effectiveProjectType(project)])}
  </div>
  {#if project.sourceProjectId}
    <div class={rowClass}>
      <span class="text-ink-muted">Reviews</span>
      <a href={`/project/${project.sourceProjectId}`} class="min-w-0 truncate text-primary-selected hover:underline">
        {sourceProjectQ.data?.title ?? "Open source project"}
      </a>
    </div>
  {/if}
  <div class="grid grid-cols-[104px_minmax(0,1fr)] items-start py-1.5 text-[13px]">
    <span class="pt-1 text-ink-muted">Tags{#if tagsSaving}<span class="sr-only"> saving</span>{/if}</span>
    <div class="min-w-0">
      <TagPicker allTags={tagsQ.data ?? []} bind:selectedTagIds label={null} onChange={handleTagsChange} readonly={!canEditDetails} />
      {#if tagError}<p class="mt-1 text-xs text-red-700" role="alert">{tagError}</p>{/if}
    </div>
  </div>
  {#if viewSummaryQ.data && viewSummaryQ.data.totalViews > 0}
    <div class={rowClass}>
      <span class="text-ink-muted">Client views</span>
      <p class="min-w-0 truncate text-ink">
        {viewSummaryQ.data.totalViews} view{viewSummaryQ.data.totalViews === 1 ? "" : "s"}
        {#if viewSummaryQ.data.uniqueViewers.length > 0}
          <span class="text-ink-muted">({viewSummaryQ.data.uniqueViewers.map((viewer) => viewer.name).join(", ")})</span>
        {/if}
      </p>
    </div>
  {/if}

  <section class="mt-3 border-t border-line-soft pt-3" aria-labelledby={`${componentId}-work`}>
    <div class="flex items-center gap-2">
      <h3 id={`${componentId}-work`} class="text-[13px] text-ink-muted">Other work</h3>
      {#if canAssign}
        <button type="button" class={`ml-auto ${quietButton}`} onclick={openComposer}>Assign work</button>
      {/if}
    </div>
    {#if details.workPanelError}
      <p class="mt-2 text-xs text-red-700" role="alert">Open work is unavailable.</p>
    {:else if otherWork.length === 0}
      <p class="mt-1.5 text-[13px] text-ink-faint">No other open work.</p>
    {:else}
      <ul class="mt-1.5 flex flex-col divide-y divide-line-soft">
        {#each otherWork as item (item.workItemId)}
          <li class="flex items-start gap-2 py-2">
            <PersonAvatar initials={item.assignee.initials} seed={String(item.assignee.userId)} />
            <div class="min-w-0 flex-1">
              <p class="truncate text-[13px] text-ink">{item.assignee.label}</p>
              <p class="text-xs text-ink-muted">{WORK_ITEM_KIND_LABELS[item.kind]}</p>
              {#if item.instructionsPreview}
                <p class="mt-0.5 line-clamp-2 text-xs text-ink-secondary">{item.instructionsPreview}</p>
              {/if}
            </div>
            {#if item.viewerCanManage}
              <button type="button" class={quietButton} onclick={() => openReassign(item)}>Reassign</button>
              <button type="button" class={`${quietButton} hover:text-red-700`} onclick={() => openCancel(item)}>Cancel</button>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  {#if canManageOwner}
    <div class="mt-2">
      <Button variant="secondary" size="xs" class="h-9" onclick={openTransfer}>Transfer owner</Button>
    </div>
  {/if}
  {#if header?.ownerNeedsReview}
    <p class="mt-2 text-xs text-ink-secondary" role="status">Ownership was assigned by fallback during migration and still needs administrator review.</p>
  {/if}

  <section class="mt-3 border-t border-line-soft pt-1" aria-labelledby={`${componentId}-activity`}>
    <h3 id={`${componentId}-activity`} class="m-0">
      <button
        type="button"
        data-activity-disclosure
        aria-expanded={activityOpen}
        aria-controls={`${componentId}-activity-region`}
        onclick={() => (activityOpen = !activityOpen)}
        class="flex min-h-9 w-full items-center gap-2 rounded-md px-0 text-left text-[13px] text-ink-muted transition-colors hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-fir"
      >
        Activity
        <DisclosureChevron open={activityOpen} tone="neutral" class="ml-auto size-3.5" />
      </button>
    </h3>
    {#if activityOpen}
      <div id={`${componentId}-activity-region`}>
        <ProjectActivityList
          state={activityState}
          entries={activityQ.data?.entries ?? []}
          truncated={activityQ.data?.truncated ?? false}
          labelledBy={`${componentId}-activity`}
        />
      </div>
    {/if}
  </section>
</div>

<ReassignWorkItemDialog
  bind:open={reassignOpen}
  candidates={assigneesQ.data?.candidates ?? []}
  selectedId={reassignPrefill}
  loading={assigneesQ.isLoading}
  failed={Boolean(assigneesQ.error)}
  busy={actionBusy}
  errorMessage={actionError}
  onUseLatest={() => {
    const latest = selected && workPanel?.openItems.find((item) => item.workItemId === selected?.workItemId);
    if (latest) {
      selected = latest;
      actionError = null;
    }
  }}
  onSubmit={submitReassign}
/>

{#if selected}
  <CancelWorkItemDialog
    bind:open={cancelOpen}
    label={`${WORK_ITEM_KIND_LABELS[selected.kind]} assigned to ${selected.assignee.label}`}
    busy={actionBusy}
    errorMessage={actionError}
    onSubmit={submitCancel}
  />
{/if}

{#if header && transferBaseline}
  <OwnerTransferDialog
    bind:open={transferOpen}
    currentOwnerLabel={transferBaseline.ownerLabel}
    latestOwnerLabel={header.owner?.label ?? null}
    stale={header.workflowVersion !== transferBaseline.version}
    onUseLatest={() => {
      if (header) transferBaseline = { version: header.workflowVersion, ownerLabel: header.owner?.label ?? null };
      transferError = null;
    }}
    candidates={ownerCandidatesQ.data?.candidates ?? []}
    loading={ownerCandidatesQ.isLoading}
    failed={Boolean(ownerCandidatesQ.error)}
    truncated={ownerCandidatesQ.data?.truncated ?? false}
    busy={transferBusy}
    errorMessage={transferError ?? (ownerCandidatesQ.error ? userErrorMessage(ownerCandidatesQ.error, "Eligible owners could not be loaded.") : null)}
    onSubmit={submitTransfer}
  />
{/if}

<AssignmentComposerDialog
  bind:open={composerOpen}
  variant="full"
  candidates={assigneesQ.data?.candidates ?? []}
  loading={assigneesQ.isLoading}
  failed={Boolean(assigneesQ.error)}
  truncated={assigneesQ.data?.truncated ?? false}
  canUseFinancialKind={workPanel?.viewer.canCreateFinancial ?? false}
  busy={composerBusy}
  errorMessage={composerError}
  {conflict}
  initialKind={composerDefaults.kind}
  initialBlocking={composerDefaults.blocking}
  initialInstructions={composerDefaults.instructions}
  initialDueDate={composerDefaults.dueDate}
  onSubmit={submitAssignment}
  onReassignConflict={(workItemId, assigneeId) => {
    const item = workPanel?.openItems.find((candidate) => candidate.workItemId === workItemId);
    if (item) openReassign(item, assigneeId);
  }}
/>
