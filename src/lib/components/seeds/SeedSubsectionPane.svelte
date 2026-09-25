<script lang="ts">
  import { onDestroy, untrack, type Snippet } from "svelte";
  import { useConvexClient, useMutation } from "convex-svelte";
  import { DropdownMenu } from "bits-ui";
  import { DotsThreeIcon } from "phosphor-svelte";
  import type { Id } from "../../../../convex/_generated/dataModel";
  import { PD_SUBSECTIONS, type PdSubsectionRoleId } from "../../../../shared/pdSubsections";
  import { userErrorCode, userErrorMessage } from "$lib/errors";
  import Button from "$lib/components/ui/Button.svelte";
  import Checkbox from "$lib/components/ui/Checkbox.svelte";
  import Spinner from "$lib/components/ui/Spinner.svelte";
  import Tooltip from "$lib/components/ui/Tooltip.svelte";
  import SeedCard from "./SeedCard.svelte";
  import { describeSource, EMPTY_SOURCE_ATTRIBUTION, missingSourceIds } from "./attribution";
  import type { QuoteCitation } from "./citations";
  import { APPROVED_CHIP } from "./seedTags";
  import { approvalButtonClass } from "./approvalStyles";
  import { stepHeadingTitle } from "./sectionTitles";
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
    reopened = undefined,
    compact = false,
    onApproved = undefined,
    onRegisterApproval = undefined,
    onOpenBrief = undefined,
    onOpenSource = undefined,
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
    /** An approved step opened again (outline row `approvedAt`); defaults to
     * the step's own approved state. */
    reopened?: boolean;
    /** Phone layout: approval sits in a bottom bar with a regenerate icon. */
    compact?: boolean;
    /** Called after "Approve and continue" succeeds, to move to the next step. */
    onApproved?: (approvedRoleId: PdSubsectionRoleId) => void;
    /** Hands the approval actions to a host that renders them elsewhere (the
     * Outline footer or the phone bottom bar). Returns an unregister function.
     * Without a host the pane renders them in its own footer. */
    onRegisterApproval?: (actions: Snippet<[ApprovalLayout]>) => () => void;
    /** Opens the Brief drawer from the step header More menu. */
    onOpenBrief?: () => void;
    /** Opens a quoted source in its transcript, where the host has a route. */
    onOpenSource?: (citation: QuoteCitation) => void;
  } = $props();

  type ApprovalLayout = "outline" | "bar";

  /** Bounds one history walk; a terminal page at the bound still completes. */
  const MAX_HISTORY_PAGES = 200;
  // Each stop condition names its own cause (R6-09): only a refusal the
  // server actually sent is attributed to its processing limit.
  const HISTORY_INCOMPLETE = "The complete history cannot be shown, so approval stays unavailable while Seeds are omitted.";
  const HISTORY_NONPROGRESS_MESSAGE = `Batch history stopped because the server kept returning the same page. ${HISTORY_INCOMPLETE}`;
  const HISTORY_PAGE_BOUND_MESSAGE = `Batch history stopped after ${MAX_HISTORY_PAGES} pages, the most this view loads. ${HISTORY_INCOMPLETE}`;
  const HISTORY_SERVER_LIMIT_MESSAGE = `Batch history stopped because the server could not read it within its safe processing limit. ${HISTORY_INCOMPLETE}`;

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
  let destroyed = false;
  onDestroy(() => {
    destroyed = true;
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
    // A3: capability is rechecked at dispatch, not only when the control was
    // rendered. A revocation that lands between an interaction and its
    // dispatch sends nothing; the caller keeps its local text.
    if (!canEdit) return false;
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
    // A reopened step is confirmed in place; a first approval moves on. The
    // approved step is captured now: if the writer opens another step before
    // this resolves, the continuation names the step that was approved.
    const continueAfter = !isReopened;
    const approvedRoleId = data.roleId;
    const approved = await mutate(
      () =>
        approve({
          ...common(),
          approvalChallenge: challenge.approvalChallenge,
          acknowledgedCarriedSeedIds: challenge.carriedSeedIds,
          acknowledgedExclusionEntryIds: challenge.exclusionEntryIds,
        }),
      "Step approved."
    );
    if (approved && continueAfter && !destroyed) onApproved?.(approvedRoleId);
  }

  function regenerateCurrent() {
    const failed = data.state === "failed";
    void mutate(
      () => (failed ? retry : regenerate)({
        ...common(),
        commandId: commandId(failed ? "retry" : "regenerate"),
      }),
      failed ? "Retry started." : "Fresh Batch requested."
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
    // Which read a refusal came from: a history page or the approval review.
    let reading: "history" | "review" = "history";
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
          historyRefusal = advanced ? HISTORY_PAGE_BOUND_MESSAGE : HISTORY_NONPROGRESS_MESSAGE;
          return;
        }
        seenCursors.add(nextCursor);
        cursor = nextCursor;
      }
      historyRows = rows;
      historyComplete = true;
      if (data.truncated) {
        reading = "review";
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
      if (isSeedProcessingLimit(cause) && reading === "history") {
        historyRefusal = HISTORY_SERVER_LIMIT_MESSAGE;
      } else if (isSeedProcessingLimit(cause)) {
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

  const isReopened = $derived(reopened ?? data.state === "approved");
  const sectionNumber = $derived(
    (PD_SUBSECTIONS.find((definition) => definition.roleId === data.roleId)?.section ?? "s242").slice(1)
  );
  const approvalDisabled = $derived(
    busy ||
      !approvalChallenge ||
      approvalSelectedCount === 0 ||
      data.state === "skipped" ||
      (needsConfirmation && confirmedChallengeKey !== challengeKey)
  );

  // "Previous batch" is offered only when an earlier Batch is known to
  // exist: a loaded history lists one, or a shown seed came from one.
  const hasPreviousBatch = $derived(
    historyRows.some((row) => row.batch._id !== data.shownBatchId && row.batch.status !== "failed") ||
      data.items.some((item) => !!data.shownBatchId && item.batchId !== data.shownBatchId && !item.feedbackRequestId)
  );

  // Revised seeds nest under the seed their feedback targeted. A group whose
  // target is not among the shown seeds is listed on its own after the grid.
  const shownIds = $derived(new Set(data.items.map((item) => String(item.seedId))));
  const groupsByTarget = $derived.by(() => {
    const map = new Map<string, SeedSubsectionData["feedbackGroups"]>();
    for (const group of data.feedbackGroups) {
      const key = String(group.targetSeedId);
      map.set(key, [...(map.get(key) ?? []), group]);
    }
    return map;
  });
  const nestedIds = $derived.by(() => {
    const ids = new Set<string>();
    for (const group of data.feedbackGroups) {
      if (!shownIds.has(String(group.targetSeedId))) continue;
      for (const item of data.items) {
        if (item.feedbackRequestId === group.requestId && item.seedId !== group.targetSeedId) ids.add(String(item.seedId));
      }
    }
    return ids;
  });
  const topLevelItems = $derived(data.items.filter((item) => !nestedIds.has(String(item.seedId))));
  const orphanGroups = $derived(
    data.feedbackGroups.filter((group) => !shownIds.has(String(group.targetSeedId)))
  );
  const revisionsOf = (group: SeedSubsectionData["feedbackGroups"][number]) =>
    data.items.filter((item) => item.feedbackRequestId === group.requestId && item.seedId !== group.targetSeedId);

  // Two 412px columns when the pane is wide enough, otherwise one (3.5, 3.6).
  // The width is read on the next frame, so a layout change it causes (a
  // scrollbar appearing) never feeds back into the same observation.
  let cardsWidth = $state(0);
  const twoColumns = $derived(cardsWidth >= 800);
  function observeWidth(element: HTMLElement) {
    let frame = 0;
    const observer = new ResizeObserver(([entry]) => {
      cancelAnimationFrame(frame);
      const width = entry.contentRect.width;
      frame = requestAnimationFrame(() => (cardsWidth = width));
    });
    cardsWidth = element.clientWidth;
    observer.observe(element);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }
  // Cards fill the two columns in reading order, each into the column that is
  // shorter so far, where a seed that already carries revised seeds counts
  // for more (board 3.2). The plan is made once per set of cards on screen
  // and then kept: feedback sent or revised seeds landing never move a card
  // to another column, so no card is rebuilt while the writer works in it.
  let columnPlan: { key: string; column: Map<string, number> } = { key: "", column: new Map() };
  const layout = $derived.by(() => {
    if (!twoColumns) return { columns: [topLevelItems] };
    const key = topLevelItems.map((item) => String(item.seedId)).join("|");
    if (columnPlan.key !== key) {
      const column = new Map<string, number>();
      const weight = [0, 0];
      for (const item of topLevelItems) {
        const target = weight[1] < weight[0] ? 1 : 0;
        column.set(String(item.seedId), target);
        weight[target] += groupsByTarget.has(String(item.seedId)) ? 2.5 : 1;
      }
      columnPlan = { key, column };
    }
    const plan = columnPlan.column;
    return {
      columns: [0, 1].map((index) => topLevelItems.filter((item) => (plan.get(String(item.seedId)) ?? 0) === index)),
    };
  });

  // Row-aligned pairs share one height (board 3.1): the n-th cards of the two
  // columns get the taller one's height, row by row, until a row holds a seed
  // with revised seeds under it; after that the columns run on their own.
  // Heights are read from each card's own body, so the pairing never feeds
  // back into what it measures.
  function equalizeRows(container: HTMLElement) {
    let frame = 0;
    const observed = new WeakSet<Element>();
    const resize = new ResizeObserver(() => schedule());
    const mutations = new MutationObserver(() => schedule());
    mutations.observe(container, { childList: true, subtree: true });
    function schedule() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(apply);
    }
    function cellsOf(column: Element) {
      return Array.from(column.children).map((cell) => ({
        body: cell.querySelector<HTMLElement>(":scope > article > [data-seed-body]"),
        revised: !!cell.querySelector(":scope > article > [data-seed-below]"),
      }));
    }
    function apply() {
      frame = 0;
      const columns = Array.from(container.querySelectorAll(":scope > [data-seed-column]")).map(cellsOf);
      for (const { body } of columns.flat()) {
        if (!body) continue;
        body.style.minHeight = "";
        if (!observed.has(body)) {
          observed.add(body);
          resize.observe(body);
        }
      }
      if (columns.length !== 2) return;
      const rows = Math.min(columns[0].length, columns[1].length);
      for (let row = 0; row < rows; row += 1) {
        const [left, right] = [columns[0][row], columns[1][row]];
        if (!left.body || !right.body) break;
        const height = Math.max(left.body.getBoundingClientRect().height, right.body.getBoundingClientRect().height);
        left.body.style.minHeight = `${height}px`;
        right.body.style.minHeight = `${height}px`;
        if (left.revised || right.revised) break;
      }
    }
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      mutations.disconnect();
    };
  }

  // Step header chips (boards 3.2, 3.7): 20px pills, 11px medium text.
  const chip = "inline-flex h-5 items-center rounded-full px-2 text-[11px] leading-[14px] font-medium";

  let moreOpen = $state(false);
  // "Brief" in the More menu: the drawer opens once the menu has closed (the
  // menu's close-focus callback does not fire on every close, so it cannot
  // be the trigger), and that close must not pull focus back to the menu
  // button over the drawer, which takes focus itself.
  let briefRequested = $state(false);
  let keepFocusOnClose = false;
  $effect(() => {
    // A fresh menu starts with the default focus return.
    if (moreOpen) keepFocusOnClose = false;
  });
  $effect(() => {
    if (moreOpen || !briefRequested) return;
    briefRequested = false;
    setTimeout(() => {
      if (!destroyed) onOpenBrief?.();
    }, 0);
  });

  // The approval actions render wherever the host puts them; the snippet
  // keeps reading this pane's own state, so every gate stays here.
  $effect(() => {
    if (!onRegisterApproval) return;
    return onRegisterApproval(approvalActions);
  });

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


{#snippet card(item: SeedCardData, nested: boolean = false, showOriginal: boolean = false, below: Snippet | undefined = undefined)}
  <SeedCard
    generationId={String(generationId)}
    roleId={data.roleId}
    seedStageVersion={data.seedStageVersion}
    {item}
    {canEdit}
    {busy}
    {nested}
    {showOriginal}
    {sourceAttribution}
    {onOpenSource}
    retained={persistence === "ok"}
    {unavailableNotice}
    draft={ownDraft(item.seedId)}
    {below}
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

{#snippet revisionGroup(group: SeedSubsectionData["feedbackGroups"][number], standalone: boolean)}
  {@const revisions = revisionsOf(group)}
  <!-- Revised seeds sit inside the seed they revise, on canvas (board 3.2). -->
  <section
    aria-label="Revised seeds"
    class="flex flex-col gap-2 rounded-lg border border-line-soft bg-canvas p-2.5"
    data-feedback-group={group.requestId}
    data-feedback-status={group.status}
  >
    <div class="flex flex-col gap-0.5 text-[11px] leading-[14px]">
      <div class="flex items-start gap-3">
        <p class="min-w-0 flex-1 font-medium text-ink-secondary">Revised seeds ({revisions.length})</p>
        {#if group.status === "active" && canEdit}
          <button
            type="button"
            class="shrink-0 rounded text-ink-muted transition-colors hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50 pointer-coarse:min-h-11"
            disabled={busy}
            onclick={() => void mutate(
              () => withdrawFeedback({ ...common(), feedbackRequestId: group.requestId }),
              "Feedback withdrawn."
            )}
          >Withdraw feedback</button>
        {:else if group.status === "withdrawn"}
          <span class="shrink-0 text-ink-faint">Feedback withdrawn</span>
        {:else if group.status === "suspendedBySkip"}
          <span class="shrink-0 text-ink-faint">Paused while the step is skipped</span>
        {/if}
      </div>
      <p class="text-ink-muted">from your feedback “{group.instruction}”</p>
      {#if standalone && group.targetWording.length}
        <p class="text-ink-muted">on “{group.targetWording.join(" ")}”</p>
      {/if}
    </div>
    {#if revisions.length === 0}
      <p class="flex items-center gap-2 text-[12px] leading-4 text-ink-muted">
        {#if group.status === "active" && data.pendingBatchId && (!group.batchId || group.batchId === data.pendingBatchId)}
          <Spinner size="sm" /> Writing revised seeds…
        {:else}
          No revised seeds yet.
        {/if}
      </p>
    {:else}
      <div class="flex flex-col gap-2">
        {#each revisions as revision (revision.seedId)}
          {@render seedWithRevisions(revision, true)}
        {/each}
      </div>
    {/if}
  </section>
{/snippet}

{#snippet seedWithRevisions(item: SeedCardData, nested: boolean)}
  {@const groups = groupsByTarget.get(String(item.seedId)) ?? []}
  <div class="flex flex-col" data-seed-cell={item.seedId}>
    {#if groups.length > 0}
      {#snippet revisionsBelow()}
        <div class="flex flex-col gap-2">
          {#each groups as group (group.requestId)}
            {@render revisionGroup(group, false)}
          {/each}
        </div>
      {/snippet}
      {@render card(item, nested, false, revisionsBelow)}
    {:else}
      {@render card(item, nested)}
    {/if}
  </div>
{/snippet}

{#snippet approvalActions(layout: ApprovalLayout)}
  <div data-approval-actions={layout}>
    {#if canEdit}
      <div class={`flex items-center ${layout === "bar" ? "gap-2.5" : "gap-2"}`}>
        {#if layout === "bar" && data.state !== "skipped"}
          <Tooltip text={data.state === "failed" ? "Retry" : "Regenerate"}>
            {#snippet children({ props })}
              <button
                {...props}
                type="button"
                aria-label={data.state === "failed" ? "Retry" : "Regenerate"}
                class="inline-flex size-11 shrink-0 items-center justify-center rounded-[10px] border border-line bg-chrome text-ink transition-colors hover:bg-primary-wash focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:pointer-events-none disabled:opacity-50"
                disabled={busy || !!data.pendingBatchId}
                onclick={regenerateCurrent}
              >{@render regenerateIcon()}</button>
            {/snippet}
          </Tooltip>
        {/if}
        <Button
          class={approvalButtonClass(layout)}
          disabled={approvalDisabled}
          onclick={approveCurrent}
        >{isReopened ? "Confirm and approve" : "Approve and continue"}</Button>
      </div>
    {/if}
  </div>
{/snippet}

{#snippet regenerateIcon()}
  <svg class="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></svg>
{/snippet}

<!-- The pane is its own size container: 16px gutters on a phone, 24px beside
     the tablet Outline, 40px on desktop (boards 3.1, 3.5, 3.6). -->
<section class="@container flex h-full min-h-0 flex-col" aria-labelledby={`seed-title-${data.roleId}`}>
  <div class="min-h-0 flex-1 overflow-y-auto px-4 pb-8 @min-[600px]:px-6 @min-[880px]:px-10">
    <header class={`flex flex-col ${compact ? "gap-2.5 pt-4" : "gap-3 pt-6"}`}>
      <div class={`flex items-center gap-2.5 ${compact ? "min-h-[14px]" : "min-h-9"}`}>
        <div class="flex min-w-0 flex-1 flex-wrap items-center gap-2.5">
          <span class="font-mono text-[11px] leading-[14px] text-ink-muted" data-section-eyebrow>Section {sectionNumber}</span>
          {#if kind === "multiple"}
            <span class={`${chip} gap-[5px] bg-primary-wash text-primary-selected!`} data-step-chip="multiple">
              <svg class="size-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12l4 4L20 6" /><path d="M4 18h6" /></svg>Select all that apply
            </span>
          {:else if kind === "optional"}
            <span class={`${chip} bg-chrome text-ink-secondary!`} data-step-chip="optional">Optional</span>
          {/if}
          {#if data.state === "approved"}
            <span
              class={chip}
              style={`background:${APPROVED_CHIP.background};color:${APPROVED_CHIP.color}`}
              data-step-chip="approved"
            >Approved</span>
          {:else if data.state === "skipped"}
            <span class={`${chip} bg-chrome text-ink-secondary!`} data-step-chip="skipped">Skipped</span>
          {/if}
          {#if data.stale}<span class={`${chip} bg-gap-bg text-gap-text!`} data-step-chip="stale">Stale</span>{/if}
          {#if data.state === "failed"}<span class={`${chip} bg-gap-bg text-gap-text!`} data-step-chip="failed">Failed</span>{/if}
        </div>
        <div class="flex shrink-0 items-center gap-2.5">
          {#if hasPreviousBatch}
            <button
              type="button"
              class="hidden rounded px-1 text-[12px] leading-4 text-ink-muted transition-colors hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:inline"
              onclick={loadHistory}
              disabled={historyLoading}
            >Previous batch</button>
          {/if}
          {#if canEdit && !compact && data.state !== "skipped"}
            <Button
              variant="secondary"
              size="sm"
              class="h-9 gap-2"
              disabled={busy || !!data.pendingBatchId}
              onclick={regenerateCurrent}
            >{@render regenerateIcon()}{data.state === "failed" ? "Retry" : "Regenerate"}</Button>
          {/if}
          <DropdownMenu.Root bind:open={moreOpen}>
            <Tooltip text="More">
              {#snippet children({ props: tipProps })}
                <DropdownMenu.Trigger
                  {...tipProps}
                  aria-label="More step actions"
                  data-step-more-trigger
                  class={`inline-flex size-9 items-center justify-center rounded-lg text-ink-secondary transition-colors hover:bg-chrome hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary pointer-coarse:size-11 ${compact ? "-my-3" : ""} ${moreOpen ? "bg-chrome text-ink" : ""}`}
                >
                  <DotsThreeIcon size={18} weight="bold" aria-hidden="true" />
                </DropdownMenu.Trigger>
              {/snippet}
            </Tooltip>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                side="bottom"
                align="end"
                sideOffset={6}
                preventScroll={false}
                class="z-[90] w-52 rounded-lg border border-line bg-surface p-1 shadow-lg"
                onCloseAutoFocus={(event) => {
                  // The Brief drawer takes focus itself; the menu must not
                  // pull it back to the trigger as it closes.
                  if (!keepFocusOnClose) return;
                  keepFocusOnClose = false;
                  event.preventDefault();
                }}
              >
                {#if canEdit && kind === "optional"}
                  <DropdownMenu.Item
                    class="flex h-9 w-full cursor-default items-center rounded-md px-2.5 text-sm text-ink outline-none data-[highlighted]:bg-gray-50 data-[disabled]:opacity-50 pointer-coarse:h-11"
                    disabled={busy}
                    onSelect={() => void mutate(
                      () => (data.state === "skipped" ? unskip : skip)(common()),
                      data.state === "skipped" ? "Step restored." : "Step skipped."
                    )}
                  >{data.state === "skipped" ? "Restore step" : "Skip step"}</DropdownMenu.Item>
                {/if}
                <DropdownMenu.Item
                  class="flex h-9 w-full cursor-default items-center rounded-md px-2.5 text-sm text-ink outline-none data-[highlighted]:bg-gray-50 data-[disabled]:opacity-50 pointer-coarse:h-11"
                  disabled={historyLoading}
                  onSelect={() => void loadHistory()}
                >Batch history</DropdownMenu.Item>
                {#if onOpenBrief}
                  <DropdownMenu.Item
                    class="flex h-9 w-full cursor-default items-center rounded-md px-2.5 text-sm text-ink outline-none data-[highlighted]:bg-gray-50 pointer-coarse:h-11"
                    onSelect={() => {
                      keepFocusOnClose = true;
                      briefRequested = true;
                    }}
                  >Brief</DropdownMenu.Item>
                {/if}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      </div>
      <div class="flex flex-col gap-1.5">
        <h2
          id={`seed-title-${data.roleId}`}
          tabindex="-1"
          class={`rounded-md font-serif font-normal text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
            compact ? "text-[20px] leading-[26px]" : "text-[24px] leading-[30px]"
          }`}
        >{stepHeadingTitle(title)}</h2>
        <p class={`max-w-3xl text-ink-muted ${compact ? "text-[12px] leading-[17px]" : "text-[13px] leading-[19px]"}`}>{objective}</p>
      </div>
      <p
        class={`flex gap-2 text-ink-secondary ${
          compact ? "items-start text-[13px] leading-[18px]" : "items-center border-b border-line-soft pb-3 text-[12px] leading-4"
        }`}
        data-step-helper
      >
        <svg class={`size-3.5 shrink-0 ${compact ? "mt-0.5 text-primary" : "text-primary-selected"}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 16v-4M12 8h.01" /></svg>
        <span class="min-w-0">
          {#if data.state === "skipped"}
            This step is skipped. Restore it from the More menu to pick seeds.
          {:else}
            {#if isReopened}
              Reopened from the summary. Changing a selection makes later steps stale until you confirm this one again.
            {/if}
            {#if !selectedCountComplete}
              <span data-selected-count="partial" class="text-gap-text!">{selectedCount}+ selected in the shown seeds, complete count pending</span>.
            {:else if approvalSelectedCount > 0 && !isReopened}
              <span data-selected-count="complete">{approvalSelectedCount} {approvalSelectedCount === 1 ? "seed" : "seeds"} selected</span>.
            {/if}
            {#if !isReopened}
              {#if approvalSelectedCount === 0 && selectedCountComplete}
                {kind === "multiple" ? "Tick every seed the PD should cover, then approve to move on." : "Tick at least one seed to approve this step."}
              {:else}
                {kind === "multiple" ? "Keep ticking every one the PD should cover, then approve to move on." : "Approve to move on, or change your pick."}
              {/if}
            {/if}
          {/if}
          <!-- The first look at a step also says how to read a quote (board 3.1). -->
          Underlined words are quoted from the sources{!compact && !isReopened && data.state !== "skipped" && approvalSelectedCount === 0 && selectedCountComplete ? "; hover one to see the line" : ""}.
        </span>
      </p>
      {#if data.staleReason?.changedRoleIds.length}
        <p class="rounded-lg bg-gap-bg px-3 py-2 text-body text-gap-text!">
          Context changed in {data.staleReason.changedRoleIds.join(", ")}.
        </p>
      {/if}
    </header>

    <div class="pt-4">
      {#if error}<p role="alert" class="mb-4 rounded-lg bg-gap-bg px-3 py-2 text-body text-gap-text!">{error}</p>{/if}
      <p class="sr-only" aria-live="polite">{announcement}</p>
      {#if data.truncated && historyReviewRefused}
        <p class="mb-4 rounded-lg bg-gap-bg px-3 py-2 text-body text-gap-text!">
          The server could not form a complete approval decision within its safe processing limit. Approval remains unavailable.
        </p>
      {:else if data.truncated && !historyApprovalReview}
        <div class="mb-4 rounded-lg bg-gap-bg px-3 py-2 text-body text-gap-text!">
          <p>This is a partial Shown Set. Load the complete Batch history to review omitted Seeds and request a server approval challenge.</p>
          {#if !historyOpen}
            <Button class="mt-2" size="sm" variant="secondary" onclick={loadHistory} disabled={historyLoading}>Load Batch history</Button>
          {/if}
        </div>
      {:else if data.truncated}
        <div class="mb-4 rounded-lg bg-primary-wash px-3 py-2 text-body text-primary-selected!">
          <p>Full decision review loaded. Omitted Seeds remain editable below under Batch history.</p>
          {#if !historyOpen}
            <Button class="mt-2" size="sm" variant="secondary" onclick={() => (historyOpen = true)}>Show Batch history</Button>
          {/if}
        </div>
      {/if}
      {#if needsConfirmation && canEdit}
        <div class="mb-4 rounded-lg bg-gap-bg px-3 py-2 text-body text-gap-text!" data-approval-acknowledgment>
          <Checkbox
            checked={confirmedChallengeKey === challengeKey}
            onCheckedChange={(checked) => (confirmedChallengeKey = checked ? challengeKey : null)}
            labelText={`I acknowledge ${approvalChallenge?.carriedSeedIds.length ?? 0} carried selection(s) and ${approvalChallenge?.exclusionEntryIds.length ?? 0} Claim Exclusion match(es).`}
          />
          {#if approvalChallenge}
            <dl class="mt-2 space-y-1 pl-7 text-xs">
              <div><dt class="inline">Carried Seed IDs: </dt><dd class="inline break-all">{approvalChallenge.carriedSeedIds.join(", ") || "none"}</dd></div>
              <div><dt class="inline">Changed roles: </dt><dd class="inline">{approvalChallenge.changedRoleIds.join(", ") || "none"}</dd></div>
              {#each approvalChallenge.exclusions as exclusion (exclusion.entryId)}
                <div><dt class="inline">Claim Exclusion {exclusion.entryId}: </dt><dd class="inline">{exclusion.text} (Seeds {exclusion.seedIds.join(", ")})</dd></div>
              {/each}
            </dl>
          {/if}
        </div>
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
        <div class="mb-2.5 flex min-h-24 items-center justify-center gap-2 rounded-[10px] border border-line bg-surface text-body text-ink-muted">
          <Spinner size="sm" /> Writing seeds…
        </div>
      {/if}

      <div {@attach observeWidth} data-seed-grid={twoColumns ? "two" : "one"}>
        {#if data.items.length === 0 && !data.pendingBatchId}
          <div class="rounded-[10px] border border-dashed border-line p-6 text-center">
            <p class="text-body text-ink-muted">No seeds are available yet.</p>
          </div>
        {:else}
          <!-- One container per column for the whole batch: a card keeps its
               parent, so its focus and local state survive new revisions. -->
          <div
            class={`${twoColumns ? "grid grid-cols-[repeat(2,minmax(0,412px))] items-start" : "grid grid-cols-1"} gap-2.5`}
            {@attach equalizeRows}
          >
            {#each layout.columns as column, columnIndex (columnIndex)}
              <div class="flex min-w-0 flex-col gap-2.5" data-seed-column={columnIndex}>
                {#each column as item (item.seedId)}
                  {@render seedWithRevisions(item, false)}
                {/each}
              </div>
            {/each}
          </div>
        {/if}
        {#if orphanGroups.length > 0}
          <div class="mt-2.5 space-y-2.5">
            {#each orphanGroups as group (group.requestId)}
              {@render revisionGroup(group, true)}
            {/each}
          </div>
        {/if}
      </div>

      {#if historyOpen}
        <section aria-label="Batch history" class="mt-8 border-t border-line-soft pt-5">
          <div class="flex flex-wrap items-center gap-2">
            <h3 class="text-sm font-medium text-ink">Batch history</h3>
            <Button class="ml-auto" variant="secondary" size="sm" onclick={loadHistory} disabled={historyLoading}>
              {historyLoading
                ? "Loading history…"
                : historyFailed || historyRefusal
                  ? "Retry Batch history"
                  : "Refresh Batch history"}
            </Button>
            <Button variant="ghost" size="sm" onclick={() => (historyOpen = false)} disabled={historyLoading}>Hide</Button>
          </div>
          <div class="mt-3 space-y-2">
            {#if historyRefusal}
              <p role="alert" class="rounded-lg bg-gap-bg px-3 py-2 text-body text-gap-text!">{historyRefusal}</p>
            {/if}
            {#each historyRows as row (row.batch._id)}
              <div class="rounded-lg border border-line-soft bg-surface px-3 py-3">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="text-body capitalize">{row.batch.operation} Batch</span>
                  <span class="text-xs text-ink-muted">{row.batch.status}, {row.seeds.length} {row.seeds.length === 1 ? "seed" : "seeds"}</span>
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
                        {@render card(historyCard(historicalSeed), false, true)}
                      </div>
                    {:else}
                      <article class="rounded-lg bg-gray-50 p-3">
                        <p class="text-label">{historicalSeed.selection?.selected ? "Selected" : "Not selected"}</p>
                        <ul class="mt-1 space-y-1 pl-5 text-body">
                          {#each historicalSeed.finalBullets as bullet, index (index)}<li class="list-disc">{bullet}</li>{/each}
                        </ul>
                        {#if historicalSeed.selection?.editedBullets}
                          <p class="mt-2 text-xs text-ink-muted">Original wording: {historicalSeed.bullets.join(" ")}</p>
                        {/if}
                        {#if historicalSeed.provenance.length}
                          <div class="mt-2 space-y-2">
                            {#each historicalSeed.provenance as citation (citation._id)}
                              {@const source = describeSource(sourceAttribution, String(citation.sourceId))}
                              <figure>
                                <figcaption
                                  class={source.attributed ? "text-xs text-ink-secondary" : "text-xs text-ink-muted! italic"}
                                  data-attributed={source.attributed}
                                >{source.label}</figcaption>
                                <blockquote class="mt-1 border-l-2 border-line pl-3 text-sm text-ink-muted">{citation.exactExcerpt}</blockquote>
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
            {#if !historyLoading && historyComplete && historyRows.length === 0}
              <p class="text-body text-ink-muted">No completed Batch history yet.</p>
            {/if}
            {#if !historyLoading && !historyComplete}
              <p class="text-xs text-gap-text!">History is incomplete.</p>
            {/if}
          </div>
        </section>
      {/if}
    </div>
  </div>

  {#if !onRegisterApproval}
    <footer class="shrink-0 border-t border-line bg-surface px-5 py-3 sm:px-10">
      {@render approvalActions(compact ? "bar" : "outline")}
    </footer>
  {/if}
</section>
