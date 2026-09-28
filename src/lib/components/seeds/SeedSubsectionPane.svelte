<script lang="ts">
  import { onDestroy, untrack, type Snippet } from "svelte";
  import { boardRem } from "$lib/rootScale";
  import { useConvexClient, useMutation } from "convex-svelte";
  import { DropdownMenu } from "bits-ui";
  import { IconInfo, IconMore, IconRegenerate } from "$lib/components/icons";
  import type { Id } from "../../../../convex/_generated/dataModel";
  import { PD_SUBSECTIONS, pdSubsectionOutlineLabel, type PdSubsectionRoleId } from "../../../../shared/pdSubsections";
  import { userErrorCode, userErrorMessage } from "$lib/errors";
  import Button from "$lib/components/ui/Button.svelte";
  import Checkbox from "$lib/components/ui/Checkbox.svelte";
  import Spinner from "$lib/components/ui/Spinner.svelte";
  import Tooltip from "$lib/components/ui/Tooltip.svelte";
  import AuroraMark from "$lib/components/ui/AuroraMark.svelte";
  import { seedProgress, seedProgressLine } from "./seedProgress";
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
  import { detectPlatform, isModEnter, isTypingTarget, shortcutHint } from "$lib/shell/shortcuts";

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
    expectedMs = 20_000,
    afterPicks = false,
    laterReview = null,
    onReviewEach = undefined,
  }: {
    generationId: Id<"generations">;
    title: string;
    /** The line under the heading. Display only: the board's step subtitle
     * where it draws one (pdSubsectionStepSubtitle), else the objective. */
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
    /** Round 2 (F3, F5): how long this run's batches take (seeds.getOutline). */
    expectedMs?: number;
    /** A step after approved ones reads the writer's picks too (F5 copy). */
    afterPicks?: boolean;
    /** 2026-09-28 (seventh): on the step whose change marked later steps for
     * review, how many are marked and the first of them. */
    laterReview?: { count: number; firstRoleId: string } | null;
    /** Opens a step in the workspace ("Review each"). */
    onReviewEach?: (roleId: string) => void;
  } = $props();

  // Round 2 (F3, F5): the pending batch's time-based progress. An estimate:
  // a seed batch is one structured call with no progress signal.
  let progressNow = $state(Date.now());
  $effect(() => {
    if (!data.pendingBatchId) return;
    progressNow = Date.now();
    const timer = setInterval(() => (progressNow = Date.now()), 1_000);
    return () => clearInterval(timer);
  });
  const pendingProgress = $derived(
    data.pendingBatchId ? seedProgress(progressNow, data.pendingBatch ?? null, expectedMs) : null
  );

  // Mod Enter approves the step (I4), except while typing in a seed field
  // (where Enter already saves), the editor or a dialog.
  const platform = detectPlatform();
  const approveHint = shortcutHint("approveContinue", platform);
  $effect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !isModEnter(event)) return;
      if (isTypingTarget(event) || !canEdit || approvalDisabled) return;
      event.preventDefault();
      void approveCurrent();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

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
  const keepSteps = useMutation(seedsApi.keep);
  const editSeed = useMutation(seedsApi.edit);
  const restoreWording = useMutation(seedsApi.restoreWording);
  const useQuotesAnyway = useMutation(seedsApi.useQuotesAnyway);
  const giveFeedback = useMutation(seedsApi.giveFeedback);
  const withdrawFeedback = useMutation(seedsApi.withdrawFeedback);
  const regenerate = useMutation(seedsApi.regenerate);
  const restoreBatch = useMutation(seedsApi.restoreBatch);
  const retry = useMutation(seedsApi.retry);
  const skip = useMutation(seedsApi.skip);
  const unskip = useMutation(seedsApi.unskip);
  const approve = useMutation(seedsApi.approve);

  // 2026-09-28 (fourth): after two or more answers in a row broke the Seed
  // rules, say why instead of only "failed".
  const REPEATED_INVALID_OUTPUT = {
    advancement_links:
      "The AI kept linking advancements to work you did not select. Each advancement must come from an experiment you selected in Experimentation / Iterations. Try again, or select the experiments these advancements came from.",
    seed_rules: "The AI kept writing seeds that break the seed rules, so none could be shown. Try again.",
  } as const;
  const repeatedFailure = $derived(
    data.repeatedInvalidOutput ? REPEATED_INVALID_OUTPUT[data.repeatedInvalidOutput] : null
  );

  let busy = $state(false);
  let error = $state<string | null>(null);
  // Steps "Keep" left for the writer, named in plain words (2026-09-28 seventh).
  let keepAttention = $state<string | null>(null);
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

  // A tick shows at once (owner, 2026-09-28): the writer's pick is held here
  // until the server answers, then the live read takes over; a refusal rolls
  // it back and says why. Picks are sent one at a time, each against the
  // decision version the previous answer left, so the server fence is kept.
  type PendingPick = { selected: boolean; token: number };
  let pendingPicks = $state<Record<string, PendingPick>>({});
  let pickToken = 0;
  let pickQueue: Promise<unknown> = Promise.resolve();
  const picksPending = $derived(Object.keys(pendingPicks).length > 0);
  function withPick(item: SeedCardData): SeedCardData {
    const pick = pendingPicks[String(item.seedId)];
    return pick && pick.selected !== item.selected ? { ...item, selected: pick.selected } : item;
  }
  function pick(seedId: SeedCardData["seedId"], selected: boolean): Promise<boolean> {
    if (!canEdit) return Promise.resolve(false);
    const key = String(seedId);
    const token = ++pickToken;
    pendingPicks = { ...pendingPicks, [key]: { selected, token } };
    const settle = () => {
      if (pendingPicks[key]?.token !== token) return;
      const { [key]: _settled, ...rest } = pendingPicks;
      pendingPicks = rest;
    };
    const sent = pickQueue.then(async () => {
      if (destroyed) return false;
      const saved = await mutate(
        () => selectSeed({ ...common(), seedId, selected }),
        selected ? "Seed selected." : "Seed deselected.",
        false
      );
      if (!destroyed) settle();
      return saved;
    });
    pickQueue = sent;
    return sent;
  }

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
    keepAttention = null;
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

  // 2026-09-28 (seventh, owner): "Keep as is" approves this step, and "Keep
  // all" every later step an earlier change marked for review, with their
  // picks as they are. The server records the same approval as confirming
  // carried selections and names any step it had to leave.
  const KEEP_REFUSAL: Record<string, string> = {
    NO_SELECTION: "it has no picks",
    UNLINKED_ADVANCEMENT: "its advancements must come from uncertainties and experiments you picked",
    CLAIM_EXCLUSION: "a pick matches a claim exclusion in the Brief, so confirm it on that step",
  };
  async function keep(scope: "step" | "later") {
    keepAttention = null;
    let left: Array<{ roleId: string; reason: string }> = [];
    const kept = await mutate(
      async () => {
        left = (await keepSteps({ ...common(), scope })).needsAttention;
      },
      scope === "step" ? "Step kept as is." : "Later steps kept."
    );
    if (!kept || destroyed || left.length === 0) return;
    keepAttention = left
      .map(({ roleId, reason }) => `${pdSubsectionOutlineLabel(roleId as PdSubsectionRoleId)} needs your attention: ${KEEP_REFUSAL[reason] ?? "review it"}.`)
      .join(" ");
  }
  const reviewNotice = $derived.by(() => {
    const changed = (data.staleReason?.changedRoleIds ?? []).map((roleId) => pdSubsectionOutlineLabel(roleId));
    const where = changed.length ? `An earlier step changed (${changed.join(", ")})` : "An earlier step changed";
    return `${where} after these ideas were written. Check they still fit, then keep this step as it is, or regenerate and pick again.`;
  });

  // Boards F3 and F5: Regenerate keeps its full ink while ideas are being
  // written, but a Batch already on its way is not replaced: the control is
  // aria-disabled then and a click does nothing.
  const regenerateWaiting = $derived(!!data.pendingBatchId);
  function regenerateCurrent() {
    if (regenerateWaiting) return;
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
  const selectedCount = $derived(data.items.filter((item) => withPick(item).selected).length);
  const approvalSelectedCount = $derived(historyApprovalReview?.selectedCount ?? selectedCount);
  const selectedCountComplete = $derived(!data.truncated || historyApprovalReview !== null);

  const isReopened = $derived(reopened ?? data.state === "approved");
  const sectionNumber = $derived(
    (PD_SUBSECTIONS.find((definition) => definition.roleId === data.roleId)?.section ?? "s242").slice(1)
  );
  const approvalDisabled = $derived(
    busy ||
      // A pick the server has not answered yet changes the approval challenge.
      picksPending ||
      // Round 2 (F3): nothing to approve while the step's ideas are written.
      !!data.pendingBatchId ||
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

  // Card columns: one below 800px (3.5, 3.6), two 412px columns (board 3.1)
  // until a third fits, then as many columns of at least 400px as fit,
  // sharing the width, so a wide monitor gains columns instead of leaving
  // the right of the pane empty (2026-09-28 width pass).
  // The width is read on the next frame, so a layout change it causes (a
  // scrollbar appearing) never feeds back into the same observation.
  const CARD_MIN_WIDTH = 400;
  const CARD_GAP = 10;
  let cardsWidth = $state(0);
  const columns = $derived(
    cardsWidth >= 800 ? Math.max(2, Math.floor((cardsWidth + CARD_GAP) / (CARD_MIN_WIDTH + CARD_GAP))) : 1
  );
  const multiColumn = $derived(columns > 1);
  const gridColumns = $derived(
    columns === 1
      ? undefined
      : columns === 2
        ? `grid-template-columns:repeat(2,minmax(0,${boardRem(412)}))`
        : `grid-template-columns:repeat(${columns},minmax(0,1fr))`
  );
  const gridName = $derived(["one", "two", "three", "four", "five", "six"][columns - 1] ?? String(columns));
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
  // Cards keep their ranked reading order in the page (tab and screen-reader
  // order) and fill the grid a row at a time in that same order: with c
  // columns the n-th card goes to column n % c of row n / c. Visual order therefore always
  // equals page order, and no cell is left empty. A card's place depends only
  // on its rank, never on feedback or revised seeds, and every card comes
  // from one keyed list, so feedback sent or revised seeds landing never move
  // a card to another parent or rebuild it. A row's two cards share one height
  // (board 3.1); beside a seed with revised seeds, the other cards keep
  // their own height.
  const hasRevisions = (item: SeedCardData) => groupsByTarget.has(String(item.seedId));
  const rankOf = $derived(new Map(topLevelItems.map((item, index) => [String(item.seedId), index])));
  function spotOf(item: SeedCardData) {
    const rank = rankOf.get(String(item.seedId));
    return rank === undefined ? null : { column: rank % columns, row: Math.floor(rank / columns) };
  }
  function placementOf(item: SeedCardData) {
    if (!multiColumn) return undefined;
    const spot = spotOf(item);
    if (!spot) return undefined;
    const row = topLevelItems.slice(spot.row * columns, spot.row * columns + columns);
    const beside = row.some((other) => other.seedId !== item.seedId && hasRevisions(other));
    const align = !hasRevisions(item) && beside ? "align-self:start;" : "";
    return `grid-column:${spot.column + 1};grid-row:${spot.row + 1};${align}`;
  }

  // Step header chips (boards 3.2, 3.7): 20px pills, 11px medium text.
  const chip = "inline-flex h-5 items-center rounded-full px-2 text-[0.6875rem] leading-[0.875rem] font-medium";

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
    item={withPick(item)}
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
    onSelect={(selected) => pick(item.seedId, selected)}
    onEdit={(bullets, expectedSeedStageVersion) =>
      mutate(
        () => editSeed({ ...common(), expectedSeedStageVersion, seedId: item.seedId, bullets }),
        "Seed wording saved.",
        false
      )}
    onRestore={() =>
      mutate(() => restoreWording({ ...common(), seedId: item.seedId }), "Original wording restored.")}
    onUseQuotes={() =>
      mutate(() => useQuotesAnyway({ ...common(), seedId: item.seedId }), "The draft will use this seed's quotes as evidence.")}
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
    <div class="flex flex-col gap-0.5 text-[0.6875rem] leading-[0.875rem]">
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
      <p class="flex items-center gap-2 text-[0.75rem] leading-4 text-ink-muted">
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

{#snippet seedWithRevisions(item: SeedCardData, nested: boolean, placement: string | undefined = undefined, column: number | undefined = undefined)}
  {@const groups = groupsByTarget.get(String(item.seedId)) ?? []}
  <!-- One render whether or not revised seeds exist, so the card is never
       rebuilt when its first feedback group lands. -->
  {#snippet revisionsBelow()}
    <div class="flex flex-col gap-2">
      {#each groups as group (group.requestId)}
        {@render revisionGroup(group, false)}
      {/each}
    </div>
  {/snippet}
  <div class="flex flex-col" style={placement} data-seed-cell={item.seedId} data-seed-column={column}>
    {@render card(item, nested, false, groups.length > 0 ? revisionsBelow : undefined)}
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
                class="inline-flex size-11 shrink-0 items-center justify-center rounded-[0.625rem] border border-line bg-chrome text-ink transition-colors hover:bg-primary-wash focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:pointer-events-none disabled:opacity-50"
                disabled={busy}
                aria-disabled={regenerateWaiting || undefined}
                data-regenerate-waiting={regenerateWaiting || undefined}
                onclick={regenerateCurrent}
              >{@render regenerateIcon()}</button>
            {/snippet}
          </Tooltip>
        {/if}
        <Tooltip text={approveHint} delayDuration={500}>
          {#snippet children({ props })}
            <Button
              {...props}
              class={approvalButtonClass(layout)}
              disabled={approvalDisabled}
              onclick={approveCurrent}
              data-approve-step
              aria-keyshortcuts={platform === "mac" ? "Meta+Enter" : "Control+Enter"}
            >{isReopened ? "Confirm and approve" : "Approve and continue"}</Button>
          {/snippet}
        </Tooltip>
      </div>
    {/if}
  </div>
{/snippet}

{#snippet regenerateIcon()}
  <IconRegenerate size={14} strokeWidth={1.8} />
{/snippet}

<!-- The pane is its own size container: 16px gutters on a phone, 24px beside
     the tablet Outline, 40px on desktop (boards 3.1, 3.5, 3.6). -->
<section class="@container flex h-full min-h-0 flex-col" aria-labelledby={`seed-title-${data.roleId}`}>
  <div class="min-h-0 flex-1 overflow-y-auto px-4 pb-8 @min-[600px]:px-6 @min-[880px]:px-10">
    <header class={`flex flex-col ${compact ? "gap-2.5 pt-4" : "gap-3 pt-6"}`}>
      <div class={`group/stephead relative flex items-center gap-2.5 ${compact ? "min-h-[0.875rem]" : "min-h-9"}`}>
        <div class="flex min-w-0 flex-1 flex-wrap items-center gap-2.5">
          <span class="font-mono text-[0.6875rem] leading-[0.875rem] text-ink-muted" data-section-eyebrow>Section {sectionNumber}</span>
          {#if kind === "multiple"}
            <span class={`${chip} gap-[0.3125rem] bg-primary-wash text-primary-selected!`} data-step-chip="multiple">
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
          {#if data.state === "failed"}<span class={`${chip} bg-gap-bg text-gap-text!`} data-step-chip="failed">Failed</span>{/if}
        </div>
        <div class="flex shrink-0 items-center gap-2.5">
          {#if hasPreviousBatch}
            <button
              type="button"
              class="hidden rounded px-1 text-[0.75rem] leading-4 text-ink-muted transition-colors hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:inline"
              onclick={loadHistory}
              disabled={historyLoading}
            >Previous batch</button>
          {/if}
          {#if canEdit && !compact && data.state !== "skipped"}
            <Button
              variant="secondary"
              size="sm"
              class="h-9 gap-2"
              disabled={busy}
              aria-disabled={regenerateWaiting || undefined}
              data-regenerate-waiting={regenerateWaiting || undefined}
              onclick={regenerateCurrent}
            >{@render regenerateIcon()}{data.state === "failed" ? "Retry" : "Regenerate"}</Button>
          {/if}
          <DropdownMenu.Root bind:open={moreOpen}>
            <Tooltip text="More">
              {#snippet children({ props: tipProps })}
                <!-- Boards F3 to F5 draw Regenerate at the header's right edge
                     with nothing beside it. With a mouse on a wide pane the
                     More dots sit in the 40px gutter, out of the layout, and
                     show while the header is hovered, the dots have focus or
                     the menu is open; touch and narrower panes keep them in
                     line. -->
                <DropdownMenu.Trigger
                  {...tipProps}
                  aria-label="More step actions"
                  data-step-more-trigger
                  class={`inline-flex size-9 items-center justify-center rounded-lg text-ink-secondary transition-[color,background-color,opacity] hover:bg-chrome hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary motion-reduce:transition-none pointer-coarse:size-11 ${compact ? "-my-3" : "@min-[880px]:pointer-fine:absolute @min-[880px]:pointer-fine:top-0 @min-[880px]:pointer-fine:-right-[2.375rem] @min-[880px]:pointer-fine:opacity-0 @min-[880px]:pointer-fine:group-hover/stephead:opacity-100 @min-[880px]:pointer-fine:focus-visible:opacity-100 @min-[880px]:pointer-fine:data-[state=open]:opacity-100"} ${moreOpen ? "bg-chrome text-ink" : ""}`}
                >
                  <IconMore size={16} />
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
            compact ? "text-[1.25rem] leading-[1.625rem]" : "text-[1.5rem] leading-[1.875rem]"
          }`}
        >{stepHeadingTitle(title)}</h2>
        <p class={`text-ink-muted ${compact ? "text-[0.75rem] leading-[1.0625rem]" : "text-[0.8125rem] leading-[1.1875rem]"}`} data-step-objective>{objective}</p>
      </div>
      <p
        class={`flex gap-2 text-ink-secondary ${
          compact ? "items-start text-[0.8125rem] leading-[1.125rem]" : "items-center border-b border-line-soft pb-3 text-[0.75rem] leading-4"
        }`}
        data-step-helper
      >
        <IconInfo size={14} strokeWidth={1.8} class={`shrink-0 ${compact ? "mt-0.5 text-primary" : "text-primary-selected"}`} />
        <span class="min-w-0">
          {#if data.state === "skipped"}
            This step is skipped. Restore it from the More menu to pick seeds.
          {:else}
            {#if isReopened}
              You approved this step before. If you change a pick, later steps are marked for review. Confirming this step approves this step only.
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
      {#if data.stale}
        <!-- One notice for a step marked for review; its cards carry none. -->
        <div class="rounded-lg bg-gap-bg px-3 py-2 text-body text-gap-text!" role="status" data-step-review-notice>
          <p>{reviewNotice}</p>
          {#if canEdit}
            <Button class="mt-2" size="sm" variant="secondary" disabled={busy || picksPending} onclick={() => void keep("step")} data-keep-step>Keep as is</Button>
          {/if}
        </div>
      {/if}
      {#if laterReview}
        <div class="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-primary-wash px-3 py-2 text-body text-ink" data-later-review>
          <p class="min-w-0 flex-1">This may affect {laterReview.count} later {laterReview.count === 1 ? "step" : "steps"}.</p>
          <div class="flex shrink-0 gap-2">
            {#if canEdit}
              <Button size="sm" variant="secondary" disabled={busy || picksPending} onclick={() => void keep("later")} data-keep-all>Keep all</Button>
            {/if}
            {#if onReviewEach}
              <Button size="sm" variant="secondary" onclick={() => onReviewEach(laterReview.firstRoleId)} data-review-each>Review each</Button>
            {/if}
          </div>
        </div>
      {/if}
      {#if keepAttention}
        <p class="rounded-lg bg-gap-bg px-3 py-2 text-body text-gap-text!" role="status" data-keep-attention>{keepAttention}</p>
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
      {#if needsConfirmation && canEdit && !(data.state === "approved" && !data.stale)}
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
      {#if data.pendingBatchId && pendingProgress}
        <!-- Round 2 (F3, F5): the step's progress row, an estimate. -->
        <div class="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2" data-seed-progress>
          <div class="flex min-w-0 flex-1 items-center gap-2.5">
            <AuroraMark size={20} />
            <p class="min-w-0 text-[0.8125rem] leading-[1.125rem] text-ink-secondary" data-seed-progress-line aria-live="polite">
              {seedProgressLine(pendingProgress, afterPicks)}
            </p>
          </div>
          <div
            class="relative h-1 w-40 shrink-0 overflow-hidden rounded-full bg-[var(--aurora-track)]"
            role="progressbar"
            aria-label="Writing ideas"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pendingProgress.percent}
            data-seed-progress-bar
          >
            <div
              class="h-full rounded-full transition-[width] duration-700 ease-out motion-reduce:transition-none"
              style={`width:${pendingProgress.percent}%;background:var(--aurora-linear)`}
            ></div>
          </div>
        </div>
      {/if}

      <div {@attach observeWidth} data-seed-grid={gridName}>
        {#if data.items.length === 0 && !data.pendingBatchId && (data.lastAttemptFailed || data.state === "failed")}
          <div role="status" class="rounded-[0.625rem] border border-dashed border-line p-6 text-center" data-seed-empty="failed">
            <p class="text-body text-ink-secondary">Writing seeds for this step failed.</p>
            {#if repeatedFailure}<p class="mt-2 text-body text-ink-secondary" data-seed-repeated-failure>{repeatedFailure}</p>{/if}
            {#if canEdit && data.state !== "skipped"}
              <Button class="mt-3" size="sm" variant="secondary" disabled={busy} onclick={regenerateCurrent}>Try again</Button>
            {/if}
          </div>
        {:else if data.items.length === 0 && data.pendingBatchId}
          <!-- Four skeleton cards while the step's ideas are written (F3):
               two columns 16px apart, 84 and 64px chips, lines at 92, 76
               and 60%. -->
          <div class="grid grid-cols-1 gap-4" style={gridColumns} aria-hidden="true" data-seed-skeletons>
            {#each [0, 1, 2, 3] as index (index)}
              <div class="flex h-[10.625rem] flex-col gap-3 rounded-xl border border-line-soft bg-surface p-4" data-seed-skeleton>
                <div class="flex gap-1.5">
                  <span class="h-5 w-[5.25rem] rounded-[0.3125rem] bg-skeleton-chip" data-seed-skeleton-chip></span>
                  <span class="h-5 w-16 rounded-[0.3125rem] bg-skeleton-chip"></span>
                </div>
                {#each ["92%", "76%", "60%"] as width (width)}
                  <span class="h-2.5 rounded-[0.3125rem] bg-skeleton-line" style={`width:${width}`} data-seed-skeleton-line></span>
                {/each}
              </div>
            {/each}
          </div>
        {:else if data.items.length === 0 && !data.pendingBatchId}
          <div class="rounded-[0.625rem] border border-dashed border-line p-6 text-center">
            <p class="text-body text-ink-muted">No seeds are available yet.</p>
          </div>
        {:else}
          {#if data.lastAttemptFailed && !data.pendingBatchId}
            <!-- A failed regenerate or feedback revision restores the seeds
                 shown before, so say that it failed (review s1 P3-5). -->
            <p role="status" class="mb-2.5 text-body text-ink-secondary" data-seed-last-attempt="failed">
              The last attempt failed. Showing the previous seeds.
            </p>
            {#if repeatedFailure}<p class="mb-2.5 text-body text-ink-secondary" data-seed-repeated-failure>{repeatedFailure}</p>{/if}
          {/if}
          <!-- One keyed list in ranked order; each card is placed on the grid,
               so a card keeps its parent, focus and local state. -->
          <div class="grid grid-cols-1 gap-2.5" style={gridColumns}>
            {#each topLevelItems as item (item.seedId)}
              {@render seedWithRevisions(item, false, placementOf(item), multiColumn ? (spotOf(item)?.column ?? 0) : 0)}
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
