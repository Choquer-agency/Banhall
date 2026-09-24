<script lang="ts">
  import { onDestroy, untrack } from "svelte";
  import { useConvexClient, useMutation } from "convex-svelte";
  import type { Id } from "../../../../convex/_generated/dataModel";
  import { userErrorCode, userErrorMessage } from "$lib/errors";
  import Button from "$lib/components/ui/Button.svelte";
  import Checkbox from "$lib/components/ui/Checkbox.svelte";
  import Spinner from "$lib/components/ui/Spinner.svelte";
  import SeedCard from "./SeedCard.svelte";
  import { describeSource, EMPTY_SOURCE_ATTRIBUTION, missingSourceIds } from "./attribution";
  import type {
    SeedApprovalReviewData,
    SeedBatchHistoryPage,
    SeedBatchHistoryRow,
    SeedCardData,
    SeedDraftUpdate,
    SeedLocalDraft,
    SeedSourceAttribution,
    SeedSubsectionData,
  } from "./types";
  import { seedsApi } from "./api";

  let {
    generationId,
    title,
    objective,
    kind,
    data,
    canEdit,
    drafts,
    sourceAttribution = EMPTY_SOURCE_ATTRIBUTION,
    onDraftChange,
    onRecoverSources,
    onRetrySources,
    persistence = "ok",
    unavailableNotice = undefined,
  }: {
    generationId: Id<"generations">;
    title: string;
    objective: string;
    kind: "standard" | "optional" | "multiple";
    data: SeedSubsectionData;
    canEdit: boolean;
    drafts: Record<string, SeedLocalDraft>;
    sourceAttribution?: SeedSourceAttribution;
    onDraftChange: (seedId: string, update: SeedDraftUpdate) => void;
    /** Bounded retrieval of names an incomplete attribution read left out. */
    onRecoverSources?: (sourceIds: string[]) => void;
    /** Explicit retry after a failed or refused attribution read. */
    onRetrySources?: () => void;
    /** Whether browser storage is mirroring unsaved text (A2). */
    persistence?: "ok" | "unavailable";
    /** Why mutation controls are absent, when it is not the writer's access. */
    unavailableNotice?: string;
  } = $props();

  /** Guards a history walk against a server that cannot advance its cursor. */
  const MAX_HISTORY_PAGES = 200;
  const HISTORY_LIMIT_MESSAGE =
    "Batch history stopped because one Batch exceeds the safe server processing limit. The complete history cannot be shown, so approval stays unavailable while Seeds are omitted.";

  const convex = useConvexClient();
  const selectSeed = useMutation(seedsApi.select);
  const editSeed = useMutation(seedsApi.edit);
  const restoreWording = useMutation(seedsApi.restoreWording);
  const giveFeedback = useMutation(seedsApi.giveFeedback);
  const withdrawFeedback = useMutation(seedsApi.withdrawFeedback);
  const regenerate = useMutation(seedsApi.regenerate);
  const restoreBatch = useMutation(seedsApi.restoreBatch);
  const retry = useMutation(seedsApi.retry);
  const skip = useMutation(seedsApi.skip);
  const unskip = useMutation(seedsApi.unskip);
  const approve = useMutation(seedsApi.approve);

  let busy = $state(false);
  let error = $state<string | null>(null);
  let announcement = $state("");
  let confirmedChallengeKey = $state<string | null>(null);
  let historyOpen = $state(false);
  let historyLoading = $state(false);
  let historyRows = $state<SeedBatchHistoryRow[]>([]);
  let historyComplete = $state(false);
  let historyFailed = $state(false);
  let historyRefusal = $state<string | null>(null);
  let historyScope = $state("");
  let historyRequest = 0;
  let historyApprovalReview = $state<SeedApprovalReviewData | null>(null);
  let historyReviewRefused = $state(false);

  const common = () => ({
    generationId,
    roleId: data.roleId,
    expectedSeedStageVersion: data.seedStageVersion,
  });

  const currentScope = () => `${generationId}:${data.roleId}:${data.seedStageVersion}`;
  const approvalChallenge = $derived(data.approvalChallenge ?? historyApprovalReview?.approvalChallenge ?? null);
  const challengeKey = $derived(
    approvalChallenge
      ? `${generationId}:${data.roleId}:${approvalChallenge.approvalChallenge}`
      : null
  );

  $effect(() => {
    if (confirmedChallengeKey && confirmedChallengeKey !== challengeKey) {
      confirmedChallengeKey = null;
    }
  });

  $effect(() => {
    const scope = currentScope();
    if (scope === historyScope) return;
    historyScope = scope;
    historyRequest += 1;
    historyOpen = false;
    historyLoading = false;
    historyRows = [];
    historyComplete = false;
    historyFailed = false;
    historyRefusal = null;
    historyApprovalReview = null;
    historyReviewRefused = false;
  });

  // A destroyed pane owns no pending walk: a page or challenge that resolves
  // afterwards is dropped before it can query again or publish anything.
  onDestroy(() => {
    historyRequest += 1;
  });

  // Every cited source shown here must carry its recorded name or an honest
  // state; names an incomplete read left out are retrieved through the
  // bounded recovery path once, per source, until the owner retries.
  $effect(() => {
    const attribution = sourceAttribution;
    const cited = new Set<string>();
    for (const item of data.items) {
      for (const citation of item.provenance) cited.add(String(citation.sourceId));
    }
    for (const row of historyRows) {
      for (const historicalSeed of row.seeds) {
        for (const citation of historicalSeed.provenance ?? []) cited.add(String(citation.sourceId));
      }
    }
    const missing = missingSourceIds(attribution, cited);
    if (missing.length === 0 || !onRecoverSources) return;
    untrack(() => onRecoverSources(missing));
  });

  function commandId(kind: string) {
    return `${kind}:${crypto.randomUUID()}`;
  }

  function isSeedProcessingLimit(cause: unknown) {
    if (!cause || typeof cause !== "object" || !("data" in cause)) return false;
    const details = cause.data;
    return !!details && typeof details === "object" && "reason" in details && details.reason === "SEED_PROCESSING_LIMIT";
  }

  async function mutate(action: () => Promise<unknown>, success: string, exclusive = true): Promise<boolean> {
    if (exclusive) busy = true;
    error = null;
    try {
      await action();
      announcement = success;
      return true;
    } catch (cause) {
      error = userErrorMessage(cause, "The seed decision was not saved.");
      if (userErrorCode(cause) === "STALE_REVISION") {
        announcement = "Decisions changed in another session. Your unsaved text is still here.";
      }
      return false;
    } finally {
      if (exclusive) busy = false;
    }
  }

  async function approveCurrent() {
    const challenge = approvalChallenge;
    if (!canEdit || !challenge) return;
    await mutate(
      () =>
        approve({
          ...common(),
          approvalChallenge: challenge.approvalChallenge,
          acknowledgedCarriedSeedIds: challenge.carriedSeedIds,
          acknowledgedExclusionEntryIds: challenge.exclusionEntryIds,
        }),
      "Subsection approved."
    );
  }

  async function loadHistory() {
    const roleId = data.roleId;
    const expectedSeedStageVersion = data.seedStageVersion;
    const scope = currentScope();
    const request = ++historyRequest;
    const obsolete = () => request !== historyRequest || scope !== currentScope();
    historyOpen = true;
    historyLoading = true;
    historyFailed = false;
    historyRefusal = null;
    historyReviewRefused = false;
    historyComplete = false;
    // A replacement review starts from nothing: the previous history-derived
    // challenge and its completion label are valid only for the walk that
    // produced them, so approval waits for this walk and its own challenge.
    historyApprovalReview = null;
    error = null;
    const rows: SeedBatchHistoryRow[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | null = null;
    try {
      for (let pages = 0; ; pages += 1) {
        const requestedCursor: string | null = cursor;
        const page: SeedBatchHistoryPage = await convex.query(seedsApi.listBatches, {
          generationId,
          roleId,
          cursor: requestedCursor,
          numItems: 20,
        });
        // Stop an obsolete walk before it can issue another request.
        if (obsolete()) return;
        rows.push(...page.page);
        // A terminal page completes the walk at any count, the bound included.
        if (page.isDone) break;
        const nextCursor = page.continueCursor;
        const advanced = nextCursor !== requestedCursor && !seenCursors.has(nextCursor);
        // Refuse a nonadvancing cursor, or a nonterminal page at the bound,
        // before the next request is ever made.
        if (!advanced || pages + 1 >= MAX_HISTORY_PAGES) {
          historyRows = rows;
          historyRefusal = HISTORY_LIMIT_MESSAGE;
          return;
        }
        seenCursors.add(nextCursor);
        cursor = nextCursor;
      }
      historyRows = rows;
      historyComplete = true;
      if (data.truncated) {
        const review = await convex.query(seedsApi.getApprovalReview, {
          generationId,
          roleId,
          expectedSeedStageVersion,
        });
        if (obsolete()) return;
        historyApprovalReview = review;
      }
    } catch (cause) {
      if (obsolete()) return;
      historyRows = rows;
      if (isSeedProcessingLimit(cause)) {
        historyReviewRefused = true;
        error = "The complete decision exceeds the safe server processing limit. Approval remains unavailable.";
      } else {
        historyFailed = true;
        historyComplete = false;
        error = userErrorMessage(cause, "Batch history could not be loaded.");
      }
    } finally {
      if (request === historyRequest) historyLoading = false;
    }
  }

  const needsConfirmation = $derived(
    !!approvalChallenge &&
      (approvalChallenge.carriedSeedIds.length > 0 ||
        approvalChallenge.exclusionEntryIds.length > 0)
  );
  // The cards on screen are a projection. When the server cut that projection
  // short, their selected count is only a lower bound until the complete
  // server review of the current scope returns its own count (A4); that
  // review count is invalidated with its scope and with every replacement.
  const selectedCount = $derived(data.items.filter((item) => item.selected).length);
  const approvalSelectedCount = $derived(historyApprovalReview?.selectedCount ?? selectedCount);
  const selectedCountComplete = $derived(!data.truncated || historyApprovalReview !== null);

  function historyCard(seed: SeedBatchHistoryRow["seeds"][number]): SeedCardData {
    return {
      seedId: seed._id,
      batchId: seed.batchId,
      roleId: seed.roleId,
      bullets: seed.finalBullets,
      originalBullets: seed.bullets,
      tags: seed.tags,
      support: seed.selection?.editedBullets ? "writer_asserted" : seed.support,
      originalSupport: seed.originalSupport,
      selected: seed.selection?.selected ?? false,
      edited: seed.selection?.editedBullets !== undefined,
      revisionOfSeedId: seed.revisionOfSeedId ?? null,
      feedbackRequestId: seed.feedbackRequestId ?? null,
      uncertaintySeedId: seed.uncertaintySeedId ?? null,
      experimentSeedIds: seed.experimentSeedIds ?? [],
      provenance: seed.provenance,
      provenanceTruncated: false,
      outdated: null,
    };
  }

  function ownDraft(seedId: string) {
    const draft = drafts[seedId];
    return draft && draft.ownerGenerationId === generationId && draft.ownerRoleId === data.roleId
      ? draft
      : undefined;
  }
</script>

{#snippet card(item: SeedCardData)}
  <SeedCard
    generationId={String(generationId)}
    roleId={data.roleId}
    seedStageVersion={data.seedStageVersion}
    {item}
    {canEdit}
    {busy}
    {sourceAttribution}
    retained={persistence === "ok"}
    {unavailableNotice}
    draft={ownDraft(item.seedId)}
    onDraftChange={(update) => onDraftChange(item.seedId, update)}
    onSelect={(selected) =>
      mutate(
        () => selectSeed({ ...common(), seedId: item.seedId, selected }),
        selected ? "Seed selected." : "Seed deselected."
      )}
    onEdit={(bullets, expectedSeedStageVersion) =>
      mutate(
        () => editSeed({ ...common(), expectedSeedStageVersion, seedId: item.seedId, bullets }),
        "Seed wording saved.",
        false
      )}
    onRestore={() =>
      mutate(() => restoreWording({ ...common(), seedId: item.seedId }), "Original wording restored.")}
    onFeedback={(instruction, expectedSeedStageVersion) =>
      mutate(
        () => giveFeedback({
          ...common(),
          expectedSeedStageVersion,
          seedId: item.seedId,
          instruction,
          commandId: commandId("feedback"),
        }),
        "Revision requested.",
        false
      )}
  />
{/snippet}

<section class="flex h-full min-h-0 flex-col" aria-labelledby={`seed-title-${data.roleId}`}>
  <header class="shrink-0 border-b border-line-soft px-5 py-4 sm:px-7">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="min-w-0">
        <div class="flex flex-wrap items-center gap-2">
          <h2
            id={`seed-title-${data.roleId}`}
            tabindex="-1"
            class="rounded-md text-heading focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
          >{title}</h2>
          <span class="rounded-full bg-gray-100 px-2 py-0.5 text-label capitalize text-gray-700!">{kind}</span>
          {#if data.stale}<span class="rounded-full bg-gap-bg px-2 py-0.5 text-label text-gap-text!">Stale</span>{/if}
          {#if data.state === "failed"}<span class="rounded-full bg-gap-bg px-2 py-0.5 text-label text-gap-text!">Failed</span>{/if}
        </div>
        <p class="mt-1 max-w-3xl text-body text-ink-muted">{objective}</p>
      </div>
      {#if selectedCountComplete}
        <span class="text-data text-ink-muted" data-selected-count="complete">{approvalSelectedCount} selected</span>
      {:else}
        <span class="text-data text-gap-text!" data-selected-count="partial">{selectedCount}+ selected in the shown Seeds · complete count pending</span>
      {/if}
    </div>
    {#if data.staleReason?.changedRoleIds.length}
      <p class="mt-3 rounded-lg bg-gap-bg px-3 py-2 text-body text-gap-text!">
        Context changed in {data.staleReason.changedRoleIds.join(", ")}.
      </p>
    {/if}
  </header>

  <div class="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-7">
    {#if data.truncated && historyReviewRefused}
      <p class="mb-4 rounded-lg bg-gap-bg px-3 py-2 text-body text-gap-text!">
        The server could not form a complete approval decision within its safe processing limit. Approval remains unavailable.
      </p>
    {:else if data.truncated && !historyApprovalReview}
      <p class="mb-4 rounded-lg bg-gap-bg px-3 py-2 text-body text-gap-text!">
        This is a partial Shown Set. Load the complete Batch history to review omitted Seeds and request a server approval challenge.
      </p>
    {:else if data.truncated}
      <p class="mb-4 rounded-lg bg-primary-wash px-3 py-2 text-body text-primary-selected!">
        Full decision review loaded. Omitted Seeds remain editable below under Batch history.
      </p>
    {/if}
    {#if sourceAttribution.status === "error"}
      <div role="status" data-source-attribution="error" class="mb-4 rounded-lg bg-gap-bg px-3 py-2 text-body text-gap-text!">
        <p>Source names could not be loaded. Exact excerpts are still shown, without attribution.</p>
        {#if onRetrySources}
          <Button class="mt-2" size="sm" variant="secondary" onclick={onRetrySources}>Retry source names</Button>
        {/if}
      </div>
    {:else if sourceAttribution.status === "incomplete" && sourceAttribution.recoveryError}
      <div role="status" data-source-attribution="incomplete" class="mb-4 rounded-lg bg-gap-bg px-3 py-2 text-body text-gap-text!">
        <p>{sourceAttribution.recoveryError}</p>
        {#if onRetrySources}
          <Button class="mt-2" size="sm" variant="secondary" onclick={onRetrySources}>Retry source names</Button>
        {/if}
      </div>
    {/if}
    {#if data.pendingBatchId}
      <div class="mb-4 flex min-h-24 items-center justify-center gap-2 rounded-xl border border-line bg-surface text-body text-ink-muted">
        <Spinner size="sm" /> Generating Idea Seeds…
      </div>
    {/if}
    {#if data.items.length === 0 && !data.pendingBatchId}
      <div class="rounded-xl border border-dashed border-line p-6 text-center">
        <p class="text-body text-ink-muted">No Idea Seeds are available yet.</p>
      </div>
    {:else}
      <div class="space-y-3">
        {#each data.items as item (item.seedId)}
          {@render card(item)}
        {/each}
      </div>
    {/if}

    {#if data.feedbackGroups.some((group) => group.status !== "withdrawn")}
      <section aria-label="Active feedback" class="mt-5 rounded-xl border border-line bg-gray-50 p-4">
        <h3 class="text-title">Feedback instructions</h3>
        <div class="mt-2 flex flex-wrap gap-2">
          {#each data.feedbackGroups.filter((group) => group.status !== "withdrawn") as group (group.requestId)}
            <span class="inline-flex min-h-11 items-center gap-2 rounded-full bg-surface px-3 py-1 text-body">
              {group.instruction}
              {#if canEdit}
                <button
                  type="button"
                  class="rounded text-action-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                  disabled={busy}
                  onclick={() => void mutate(
                    () => withdrawFeedback({ ...common(), feedbackRequestId: group.requestId }),
                    "Feedback withdrawn."
                  )}
                >Withdraw</button>
              {/if}
            </span>
          {/each}
        </div>
      </section>
    {/if}

    <section aria-label="Batch history" class="mt-5 border-t border-line-soft pt-4">
      <Button variant="ghost" size="sm" onclick={loadHistory} disabled={historyLoading}>
        {historyLoading
          ? "Loading history…"
          : historyFailed || historyRefusal
            ? "Retry Batch history"
            : historyOpen
              ? "Refresh Batch history"
              : "Load Batch history"}
      </Button>
      {#if historyOpen}
        <div class="mt-3 space-y-2">
          {#if historyRefusal}
            <p role="alert" class="rounded-lg bg-gap-bg px-3 py-2 text-body text-gap-text!">{historyRefusal}</p>
          {/if}
          {#each historyRows as row (row.batch._id)}
            <div class="rounded-lg border border-line-soft bg-surface px-3 py-3">
              <div class="flex flex-wrap items-center gap-2">
                <span class="text-body capitalize">{row.batch.operation} Batch</span>
                <span class="text-data text-ink-muted">{row.batch.status} · {row.seeds.length} Seed(s)</span>
                {#if canEdit && row.batch._id !== data.shownBatchId && row.batch.status !== "failed"}
                  <Button
                    class="ml-auto"
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onclick={() => void mutate(
                      () => restoreBatch({ ...common(), batchId: row.batch._id }),
                      "Previous Batch restored."
                    )}
                  >Restore this Batch</Button>
                {/if}
              </div>
              <div class="mt-3 space-y-3">
                {#each row.seeds as historicalSeed (historicalSeed._id)}
                  {@const omitted = !data.items.some((item) => item.seedId === historicalSeed._id)}
                  {#if omitted}
                    <div class="rounded-lg border border-line bg-gray-50 p-2">
                      <p class="mb-2 text-label text-ink-muted">Available from full history</p>
                      {@render card(historyCard(historicalSeed))}
                    </div>
                  {:else}
                    <article class="rounded-lg bg-gray-50 p-3">
                      <p class="text-label">{historicalSeed.selection?.selected ? "Selected" : "Not selected"}</p>
                      <ul class="mt-1 space-y-1 pl-5 text-body">
                        {#each historicalSeed.finalBullets as bullet}<li class="list-disc">{bullet}</li>{/each}
                      </ul>
                      {#if historicalSeed.selection?.editedBullets}
                        <p class="mt-2 text-data text-ink-muted">Original wording: {historicalSeed.bullets.join(" ")}</p>
                      {/if}
                      {#if historicalSeed.provenance.length}
                        <div class="mt-2 space-y-2">
                          {#each historicalSeed.provenance as citation (citation._id)}
                            {@const source = describeSource(sourceAttribution, String(citation.sourceId))}
                            <figure>
                              <figcaption
                                class={source.attributed ? "text-label" : "text-label text-ink-muted! italic"}
                                data-attributed={source.attributed}
                              >{source.label}</figcaption>
                              <blockquote class="mt-1 border-l-2 border-line pl-3 text-data text-ink-muted">{citation.exactExcerpt}</blockquote>
                            </figure>
                          {/each}
                        </div>
                      {/if}
                    </article>
                  {/if}
                {/each}
              </div>
            </div>
          {/each}
          {#if historyOpen && !historyLoading && historyComplete && historyRows.length === 0}
            <p class="text-body text-ink-muted">No completed Batch history yet.</p>
          {/if}
          {#if !historyLoading && !historyComplete}
            <p class="text-data text-gap-text!">History is incomplete.</p>
          {/if}
        </div>
      {/if}
    </section>
  </div>

  <footer class="shrink-0 border-t border-line bg-surface px-5 py-3 sm:px-7">
    {#if error}<p role="alert" class="mb-2 text-body text-gap-text!">{error}</p>{/if}
    <p class="sr-only" aria-live="polite">{announcement}</p>
    {#if needsConfirmation && canEdit}
      <div class="mb-3 min-h-11 rounded-lg bg-gap-bg px-3 py-2 text-body text-gap-text!">
        <Checkbox
          checked={confirmedChallengeKey === challengeKey}
          onCheckedChange={(checked) => (confirmedChallengeKey = checked ? challengeKey : null)}
          labelText={`I acknowledge ${approvalChallenge?.carriedSeedIds.length ?? 0} carried selection(s) and ${approvalChallenge?.exclusionEntryIds.length ?? 0} Claim Exclusion match(es).`}
        />
        {#if approvalChallenge}
          <dl class="mt-2 space-y-1 pl-7 text-data">
            <div><dt class="inline">Carried Seed IDs: </dt><dd class="inline break-all">{approvalChallenge.carriedSeedIds.join(", ") || "none"}</dd></div>
            <div><dt class="inline">Changed roles: </dt><dd class="inline">{approvalChallenge.changedRoleIds.join(", ") || "none"}</dd></div>
            {#each approvalChallenge.exclusions as exclusion (exclusion.entryId)}
              <div><dt class="inline">Claim Exclusion {exclusion.entryId}: </dt><dd class="inline">{exclusion.text} (Seeds {exclusion.seedIds.join(", ")})</dd></div>
            {/each}
          </dl>
        {/if}
      </div>
    {/if}
    <div class="flex flex-wrap items-center gap-2">
      {#if canEdit}
        <Button
          variant="secondary"
          size="sm"
          disabled={busy || !!data.pendingBatchId}
          onclick={() => void mutate(
            () => (data.state === "failed" ? retry : regenerate)({
              ...common(),
              commandId: commandId(data.state === "failed" ? "retry" : "regenerate"),
            }),
            data.state === "failed" ? "Retry started." : "Fresh Batch requested."
          )}
        >{data.state === "failed" ? "Retry" : "Regenerate"}</Button>
        {#if kind === "optional"}
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onclick={() => void mutate(
              () => (data.state === "skipped" ? unskip : skip)(common()),
              data.state === "skipped" ? "Subsection restored." : "Subsection skipped."
            )}
          >{data.state === "skipped" ? "Restore subsection" : "Skip"}</Button>
        {/if}
        {#if data.state !== "skipped"}
          <Button
            class="ml-auto"
            size="sm"
            disabled={busy || !approvalChallenge || approvalSelectedCount === 0 || (needsConfirmation && confirmedChallengeKey !== challengeKey)}
            onclick={approveCurrent}
          >{needsConfirmation ? "Confirm and approve" : "Approve"}</Button>
        {/if}
      {/if}
    </div>
  </footer>
</section>
