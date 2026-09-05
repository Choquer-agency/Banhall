<script lang="ts">
  import { PUBLIC_CONVEX_URL } from "$env/static/public";
  import { Popover } from "bits-ui";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { ConvexHttpClient } from "convex/browser";
  import { useMutation, useQuery } from "convex-svelte";
  import { toast } from "svelte-sonner";
  import { api } from "../../../../convex/_generated/api";
  import type { Id } from "../../../../convex/_generated/dataModel";
  import type { FunctionReturnType } from "convex/server";
  import type { WorkflowStage } from "../../../../shared/workflowStages";
  import { reviewDecisionForStage } from "../../../../shared/workflowTransitions";
  import StageBadge from "$lib/components/ui/StageBadge.svelte";
  import {
    WORKFLOW_STAGE_LABELS,
    workflowStageOptions,
    type WorkflowStageOption,
  } from "../../../../shared/workflowLabels";
  import { userErrorCode, userErrorMessage } from "$lib/errors";
  import WorkflowDetailsPanel from "./WorkflowDetailsPanel.svelte";
  import StageChangeDialog from "./StageChangeDialog.svelte";
  import OwnerTransferDialog from "./OwnerTransferDialog.svelte";
  import AssignmentComposerDialog, { type AssignmentValues, type BlockingConflict } from "./AssignmentComposerDialog.svelte";
  import ReassignWorkItemDialog from "./ReassignWorkItemDialog.svelte";
  import CancelWorkItemDialog from "./CancelWorkItemDialog.svelte";
  import type { WorkItemSummary } from "./WorkflowDetailsPanel.svelte";
  import { assignmentDefaults, firmDateInputToTimestamp } from "$lib/workflow/assignmentDefaults";
  import { WORK_ITEM_KIND_LABELS } from "../../../../shared/workItems";
  import { createRequestId as createRequestIdValue } from "$lib/requestId";

  type WorkflowHeader = Exclude<
    FunctionReturnType<typeof api.projectWorkflow.getProjectWorkflowHeader>,
    null
  >;
  type ActionBaseline = {
    version: number;
    stageLabel: string;
    ownerLabel: string | null;
    stageOptions: WorkflowStageOption[];
  };

  let {
    projectId,
    triggerVariant = "header",
  }: {
    projectId: Id<"projects">;
    triggerVariant?: "header" | "highlight";
  } = $props();

  const auth = useAuth();
  let menuOpen = $state(false);
  // Activity disclosure inside the Workflow popover. The read-only activity
  // query subscribes only while BOTH the popover and the section are open
  // (subscription budget); collapsing either releases it.
  let activityOpen = $state(false);
  $effect(() => {
    if (!menuOpen) activityOpen = false;
  });
  let stageOpen = $state(false);
  let transferOpen = $state(false);
  let stageBusy = $state(false);
  let transferBusy = $state(false);
  let stageError = $state<string | null>(null);
  let transferError = $state<string | null>(null);
  let retrying = $state(false);
  let retryError = $state<string | null>(null);
  let retryHeaderData = $state<WorkflowHeader | null>(null);
  let retrySourceError = $state<Error | null>(null);
  let forcedStale = $state(false);
  let composerOpen = $state(false);
  let composerVariant = $state<"full" | "review">("full");
  let composerBusy = $state(false);
  let composerError = $state<string | null>(null);
  let conflict = $state<BlockingConflict | null>(null);
  let reassignOpen = $state(false);
  let cancelOpen = $state(false);
  let selectedWorkItem = $state<WorkItemSummary | null>(null);
  let actionBusy = $state(false);
  let actionWorkError = $state<string | null>(null);
  let reassignPrefill = $state<Id<"users"> | null>(null);
  let createRequestId = $state(createRequestIdValue());
  let createRequestFingerprint = $state<string | null>(null);
  let composerDefaults = $state(assignmentDefaults("other"));
  let composerWorkflowVersion = $state(0);
  let baseline = $state<ActionBaseline | null>(null);

  const componentId = $props.id();
  const titleId = `${componentId}-workflow-title`;

  const headerQ = useQuery(api.projectWorkflow.getProjectWorkflowHeader, () =>
    auth.isAuthenticated ? { projectId } : "skip"
  );
  const candidatesQ = useQuery(api.projectWorkflow.listOwnerTransferCandidates, () =>
    auth.isAuthenticated && transferOpen ? { projectId } : "skip"
  );
  const setWorkflowStage = useMutation(api.projectWorkflow.setWorkflowStage);
  const transferOwnership = useMutation(api.projectWorkflow.transferOwnership);
  const createWork = useMutation(api.workItems.create);
  const reassignWork = useMutation(api.workItems.reassign);
  const cancelWork = useMutation(api.workItems.cancel);
  const workPanelQ = useQuery(api.workItems.getProjectWorkPanel, () =>
    auth.isAuthenticated && (menuOpen || composerOpen || reassignOpen || cancelOpen)
      ? { projectId }
      : "skip"
  );
  const assigneesQ = useQuery(api.workItems.listAssigneeCandidates, () =>
    auth.isAuthenticated && (composerOpen || reassignOpen)
      ? { projectId, ...(reassignOpen && selectedWorkItem ? { workItemId: selectedWorkItem.workItemId } : {}) }
      : "skip"
  );
  const activityQ = useQuery(api.projectActivity.listProjectActivity, () =>
    auth.isAuthenticated && menuOpen && activityOpen ? { projectId } : "skip"
  );
  const activityState = $derived<"loading" | "ready" | "error" | "denied">(
    activityQ.error
      ? "error"
      : activityQ.isLoading || activityQ.data === undefined
        ? "loading"
        : activityQ.data === null
          ? "denied"
          : "ready"
  );

  const useRetryFallback = $derived(
    Boolean(headerQ.error && headerQ.error === retrySourceError && retryHeaderData)
  );
  const header = $derived(useRetryFallback ? retryHeaderData : (headerQ.data ?? null));
  const panelState = $derived(
    retrying
      ? "loading"
      : retryError
        ? "error"
        : useRetryFallback
          ? "ready"
          : headerQ.error
            ? "error"
            : headerQ.isLoading
              ? "loading"
              : headerQ.data === null
                ? "denied"
                : "ready"
  );
  const workflowError = $derived(
    retryError ??
      (!useRetryFallback && headerQ.error
        ? userErrorMessage(headerQ.error, "Workflow details are temporarily unavailable.")
        : null)
  );
  const summaryStageLabel = $derived(
    header?.stageIsFallback
      ? "Legacy status only"
      : header
        ? WORKFLOW_STAGE_LABELS[header.workflowStage]
        : null
  );
  const liveStageOptions = $derived(
    header ? workflowStageOptions(header.workflowStage, header.viewerAuthorities) : []
  );
  const canChangeStage = $derived(liveStageOptions.length > 0);
  const canTransferOwner = $derived(
    Boolean(
      header?.viewerAuthorities.some(
        (authority) => authority === "owner" || authority === "manager" || authority === "admin"
      )
    )
  );
  const composerStale = $derived(
    composerOpen && Boolean(header && header.workflowVersion !== composerWorkflowVersion)
  );
  const actionStale = $derived(
    forcedStale || Boolean(baseline && header && header.workflowVersion !== baseline.version)
  );
  const triggerAriaLabel = $derived.by(() => {
    if (header?.ownerNeedsReview) {
      return "Workflow details, ownership needs administrator review";
    }
    if (triggerVariant === "highlight" && summaryStageLabel) {
      return `${canChangeStage ? "Change" : "View"} workflow stage, current stage ${summaryStageLabel}`;
    }
    return "Workflow details";
  });

  function snapshotBaseline() {
    if (!header || !summaryStageLabel) return null;
    return {
      version: header.workflowVersion,
      stageLabel: summaryStageLabel,
      ownerLabel: header.owner?.label ?? null,
      stageOptions: liveStageOptions,
    };
  }

  function openStageDialog() {
    const next = snapshotBaseline();
    if (!next) return;
    baseline = next;
    stageError = null;
    forcedStale = false;
    menuOpen = false;
    requestAnimationFrame(() => (stageOpen = true));
  }

  function openComposer(variant: "full" | "review") {
    composerVariant = variant;
    composerDefaults = assignmentDefaults(variant === "review" ? "internal_review" : "other");
    composerWorkflowVersion = header?.workflowVersion ?? 0;
    createRequestId = createRequestIdValue();
    createRequestFingerprint = null;
    composerError = null;
    conflict = null;
    menuOpen = false;
    requestAnimationFrame(() => (composerOpen = true));
  }

  function openReassign(item: WorkItemSummary, prefill?: Id<"users">) {
    selectedWorkItem = item;
    reassignPrefill = prefill ?? item.assignee.userId;
    actionWorkError = null;
    composerOpen = false;
    menuOpen = false;
    requestAnimationFrame(() => (reassignOpen = true));
  }

  function openCancel(item: WorkItemSummary) {
    selectedWorkItem = item;
    actionWorkError = null;
    menuOpen = false;
    requestAnimationFrame(() => (cancelOpen = true));
  }

  function openTransferDialog() {
    const next = snapshotBaseline();
    if (!next) return;
    baseline = next;
    transferError = null;
    forcedStale = false;
    menuOpen = false;
    requestAnimationFrame(() => (transferOpen = true));
  }

  function useLatestValues() {
    const next = snapshotBaseline();
    if (!next) return;
    baseline = next;
    stageError = null;
    transferError = null;
    forcedStale = false;
  }

  async function retryHeader() {
    retrying = true;
    retryError = null;
    retryHeaderData = null;
    retrySourceError = headerQ.error ?? null;
    try {
      const token = await auth.fetchAccessToken({ forceRefreshToken: true });
      if (!token) throw new Error("Authentication refresh failed");
      const retryClient = new ConvexHttpClient(PUBLIC_CONVEX_URL, { auth: token });
      const latest = await retryClient.query(api.projectWorkflow.getProjectWorkflowHeader, {
        projectId,
      });
      if (latest === null) {
        retryError = "Workflow details are not available for this project.";
      } else {
        retryHeaderData = latest;
      }
    } catch (error) {
      retryError = userErrorMessage(error, "Workflow details are temporarily unavailable.");
    } finally {
      retrying = false;
    }
  }

  function actionError(error: unknown, fallback: string) {
    if (userErrorCode(error) === "STALE_REVISION") {
      forcedStale = true;
      return "This project's workflow changed while this dialog was open. Review the latest values, then retry.";
    }
    return userErrorMessage(error, fallback);
  }

  async function submitStage(toStage: WorkflowStage, note?: string) {
    if (!baseline) return;
    stageBusy = true;
    stageError = null;
    try {
      // Leaving internal review records a reviewer decision in the same
      // mutation. The value is derived from the destination edge (the shared
      // matrix helper), so the dialog needs no extra control.
      const decision =
        header?.workflowStage === "internal_review"
          ? reviewDecisionForStage(toStage)
          : undefined;
      const result = await setWorkflowStage({
        projectId,
        toStage,
        note,
        ...(decision ? { reviewDecision: { decision } } : {}),
        expectedVersion: baseline.version,
      });
      if (result.status === "updated") {
        toast.success(`Stage changed to ${WORKFLOW_STAGE_LABELS[toStage]}.`);
      } else {
        toast.info("No stage change was needed.");
      }
      stageOpen = false;
    } catch (error) {
      stageError = actionError(error, "The workflow stage could not be changed.");
    } finally {
      stageBusy = false;
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
      workflowVersion: values.changeStage ? composerWorkflowVersion : null,
    });
    if (createRequestFingerprint && createRequestFingerprint !== fingerprint) {
      createRequestId = createRequestIdValue();
    }
    createRequestFingerprint = fingerprint;
    composerBusy = true;
    composerError = null;
    conflict = null;
    try {
      const result = await createWork({
        projectId,
        kind: values.kind,
        assigneeId: values.assigneeId,
        blocking: values.blocking,
        dueAt,
        instructions: values.instructions,
        createRequestId,
        ...(values.changeStage ? { confirmedStageChange: "internal_review" as const, expectedWorkflowVersion: composerWorkflowVersion } : {}),
      });
      toast.success(result.stageChanged ? "Internal review handoff created and Stage updated." : "Work assigned.");
      composerOpen = false;
    } catch (error) {
      if (userErrorCode(error) === "BLOCKING_EXISTS") {
        const current = workPanelQ.data?.openItems.find((item) => item.isCurrentHandoff);
        if (current) {
          conflict = {
            workItemId: current.workItemId,
            assigneeLabel: current.assignee.label,
            kindLabel: WORK_ITEM_KIND_LABELS[current.kind],
            canReassign: current.viewerCanManage,
          };
        } else {
          composerError = "This project already has a blocking handoff. Review the latest workflow details and retry.";
        }
      } else {
        composerError = userErrorMessage(error, "Work could not be assigned.");
      }
    } finally {
      composerBusy = false;
    }
  }

  async function submitReassign(toUserId: Id<"users">) {
    if (!selectedWorkItem) return;
    actionBusy = true;
    actionWorkError = null;
    try {
      const result = await reassignWork({ workItemId: selectedWorkItem.workItemId, toAssigneeId: toUserId, expectedVersion: selectedWorkItem.version });
      if (result.status === "updated") toast.success("Handoff reassigned. Project Stage unchanged.");
      else toast.info("That person already has this handoff.");
      reassignOpen = false;
    } catch (error) {
      actionWorkError = userErrorMessage(error, "The handoff could not be reassigned.");
    } finally { actionBusy = false; }
  }

  async function submitCancel(reason?: string) {
    if (!selectedWorkItem) return;
    actionBusy = true;
    actionWorkError = null;
    try {
      await cancelWork({ workItemId: selectedWorkItem.workItemId, expectedVersion: selectedWorkItem.version, reason });
      toast.success("Work item canceled.");
      cancelOpen = false;
    } catch (error) {
      actionWorkError = userErrorMessage(error, "The work item could not be canceled.");
    } finally { actionBusy = false; }
  }

  async function submitTransfer(toUserId: Id<"users">, note?: string) {
    if (!baseline) return;
    transferBusy = true;
    transferError = null;
    try {
      const result = await transferOwnership({
        projectId,
        toUserId,
        note,
        expectedVersion: baseline.version,
      });
      if (result.status === "updated") {
        toast.success("Project ownership transferred.");
      } else {
        toast.info("No ownership change was needed.");
      }
      transferOpen = false;
    } catch (error) {
      transferError = actionError(error, "Project ownership could not be transferred.");
    } finally {
      transferBusy = false;
    }
  }
</script>

<Popover.Root bind:open={menuOpen}>
  <Popover.Trigger
    aria-label={triggerAriaLabel}
    class={triggerVariant === "highlight"
      ? "group -ml-1 flex min-h-7 max-w-full items-center gap-1 rounded-md px-1 py-0.5 text-xs font-medium text-ink-secondary transition-colors hover:bg-chrome/60 hover:text-ink data-[state=open]:bg-chrome/60 data-[state=open]:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir motion-reduce:transition-none pointer-coarse:min-h-11 pointer-coarse:px-2"
      : "group flex h-7 min-h-7 items-center gap-1 rounded-full py-0.5 pl-1 pr-1.5 text-xs font-medium text-ink-secondary transition-colors hover:bg-chrome/60 hover:text-ink data-[state=open]:bg-chrome/60 data-[state=open]:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir motion-reduce:transition-none pointer-coarse:min-h-11"}
  >
    <!-- The stage badge IS the workflow control (2026-08-10 owner feedback:
         a separate "Workflow" label pill was pointless next to the badge). -->
    {#if header && !header.stageIsFallback}
      <StageBadge
        stage={header.workflowStage}
        shape={triggerVariant === "highlight" ? "square" : "pill"}
      />
    {:else}
      <span class="px-1.5">Workflow</span>
    {/if}
    {#if header?.ownerNeedsReview}
      <span aria-hidden="true" class="size-1.5 rounded-full bg-amber-600"></span>
      <span class="sr-only">Ownership needs administrator review</span>
    {/if}
    <svg
      aria-hidden="true"
      class={`size-3.5 shrink-0 transition-transform motion-reduce:transition-none ${menuOpen ? "rotate-180 text-primary" : "text-ink-secondary"}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      stroke-width="2"
    >
      <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  </Popover.Trigger>
  <Popover.Portal>
    <Popover.Content
      side="bottom"
      align="start"
      sideOffset={8}
      collisionPadding={12}
      aria-labelledby={titleId}
      onEscapeKeydown={(event) => event.stopPropagation()}
      class="z-[100] max-h-[min(32rem,calc(100dvh-6rem))] w-[min(25rem,calc(100vw-1.5rem))] overflow-y-auto rounded-xl border border-line bg-white p-4 text-ink shadow-lg outline-none"
    >
      <WorkflowDetailsPanel
        state={panelState}
        stage={header?.workflowStage ?? null}
        stageIsFallback={header?.stageIsFallback ?? false}
        ownerNeedsReview={header?.ownerNeedsReview ?? false}
        errorMessage={workflowError}
        {canChangeStage}
        {canTransferOwner}
        onRetry={retryHeader}
        onChangeStage={openStageDialog}
        onTransferOwner={openTransferDialog}
        workItems={workPanelQ.data?.openItems ?? []}
        workTruncated={workPanelQ.data?.truncated ?? false}
        canCreateWork={workPanelQ.data?.viewer.canCreate ?? false}
        canSendForReview={Boolean(workPanelQ.data?.viewer.canCreate && header && header.workflowStage !== "internal_review" && header.workflowStage !== "delivered" && header.workflowStage !== "abandoned")}
        assignable={workPanelQ.data?.assignable ?? false}
        assignableReason={workPanelQ.data?.assignableReason ?? null}
        pointerHealthy={workPanelQ.data?.pointerHealthy ?? true}
        workLoading={workPanelQ.isLoading}
        workError={workPanelQ.error ? userErrorMessage(workPanelQ.error, "Work assignments are temporarily unavailable. Close and reopen Workflow to retry.") : null}
        onAssignWork={() => openComposer("full")}
        onSendForReview={() => openComposer("review")}
        onReassignWork={openReassign}
        onCancelWork={openCancel}
        {activityOpen}
        onToggleActivity={() => (activityOpen = !activityOpen)}
        {activityState}
        activityEntries={activityQ.data?.entries ?? []}
        activityTruncated={activityQ.data?.truncated ?? false}
        {titleId}
      />
    </Popover.Content>
  </Popover.Portal>
</Popover.Root>

{#if header && baseline}
  <StageChangeDialog
    bind:open={stageOpen}
    currentStageLabel={baseline.stageLabel}
    options={actionStale ? liveStageOptions : baseline.stageOptions}
    busy={stageBusy}
    errorMessage={stageError}
    stale={actionStale}
    latestStageLabel={summaryStageLabel}
    onUseLatest={useLatestValues}
    onSubmit={submitStage}
  />
  <OwnerTransferDialog
    bind:open={transferOpen}
    currentOwnerLabel={baseline.ownerLabel}
    latestOwnerLabel={header.owner?.label ?? null}
    stale={actionStale}
    onUseLatest={useLatestValues}
    candidates={candidatesQ.data?.candidates ?? []}
    loading={candidatesQ.isLoading}
    failed={Boolean(candidatesQ.error)}
    truncated={candidatesQ.data?.truncated ?? false}
    busy={transferBusy}
    errorMessage={transferError ?? (candidatesQ.error ? userErrorMessage(candidatesQ.error, "Eligible owners could not be loaded.") : null)}
    onSubmit={submitTransfer}
  />
{/if}

<AssignmentComposerDialog
  bind:open={composerOpen}
  variant={composerVariant}
  candidates={assigneesQ.data?.candidates ?? []}
  loading={assigneesQ.isLoading}
  failed={Boolean(assigneesQ.error)}
  truncated={assigneesQ.data?.truncated ?? false}
  canUseFinancialKind={workPanelQ.data?.viewer.canCreateFinancial ?? false}
  busy={composerBusy}
  errorMessage={composerError}
  {conflict}
  stale={composerStale}
  latestWorkflowVersion={header?.workflowVersion ?? null}
  onUseLatest={() => {
    if (header) { composerWorkflowVersion = header.workflowVersion; composerError = null; createRequestId = createRequestIdValue(); createRequestFingerprint = null; }
  }}
  initialKind={composerDefaults.kind}
  initialBlocking={composerDefaults.blocking}
  initialInstructions={composerDefaults.instructions}
  initialDueDate={composerDefaults.dueDate}
  onSubmit={submitAssignment}
  onReassignConflict={(workItemId, assigneeId) => {
    const item = workPanelQ.data?.openItems.find((candidate) => candidate.workItemId === workItemId);
    if (item) openReassign(item, assigneeId);
  }}
/>

<ReassignWorkItemDialog
  bind:open={reassignOpen}
  candidates={assigneesQ.data?.candidates ?? []}
  selectedId={reassignPrefill}
  loading={assigneesQ.isLoading}
  failed={Boolean(assigneesQ.error)}
  busy={actionBusy}
  errorMessage={actionWorkError}
  onUseLatest={() => {
    const latest = selectedWorkItem && workPanelQ.data?.openItems.find((item) => item.workItemId === selectedWorkItem?.workItemId);
    if (latest) { selectedWorkItem = latest; actionWorkError = null; }
  }}
  onSubmit={submitReassign}
/>

{#if selectedWorkItem}
  <CancelWorkItemDialog
    bind:open={cancelOpen}
    label={`${WORK_ITEM_KIND_LABELS[selectedWorkItem.kind]} assigned to ${selectedWorkItem.assignee.label}`}
    busy={actionBusy}
    errorMessage={actionWorkError}
    onSubmit={submitCancel}
  />
{/if}
