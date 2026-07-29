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
  import {
    WORKFLOW_STAGE_LABELS,
    workflowStageOptions,
    type WorkflowStageOption,
  } from "../../../../shared/workflowLabels";
  import { userErrorCode, userErrorMessage } from "$lib/errors";
  import WorkflowDetailsPanel from "./WorkflowDetailsPanel.svelte";
  import StageChangeDialog from "./StageChangeDialog.svelte";
  import OwnerTransferDialog from "./OwnerTransferDialog.svelte";

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

  let { projectId }: { projectId: Id<"projects"> } = $props();

  const auth = useAuth();
  let menuOpen = $state(false);
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
  const actionStale = $derived(
    forcedStale || Boolean(baseline && header && header.workflowVersion !== baseline.version)
  );
  const triggerAriaLabel = $derived(
    header?.ownerNeedsReview
      ? "Workflow details, ownership needs administrator review"
      : "Workflow details"
  );

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
      const result = await setWorkflowStage({
        projectId,
        toStage,
        note,
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
    class="flex h-11 min-h-11 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold text-navy transition-colors hover:text-primary-selected data-[state=open]:text-primary-selected motion-reduce:transition-none"
  >
    <span>Workflow</span>
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
      class="z-[100] max-h-[min(28rem,calc(100dvh-6rem))] w-[min(22rem,calc(100vw-1.5rem))] overflow-y-auto rounded-xl border border-line bg-white p-4 text-ink shadow-lg outline-none"
    >
      <WorkflowDetailsPanel
        state={panelState}
        stage={header?.workflowStage ?? null}
        stageIsFallback={header?.stageIsFallback ?? false}
        owner={header?.owner ?? null}
        ownerNeedsReview={header?.ownerNeedsReview ?? false}
        errorMessage={workflowError}
        {canChangeStage}
        {canTransferOwner}
        onRetry={retryHeader}
        onChangeStage={openStageDialog}
        onTransferOwner={openTransferDialog}
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
