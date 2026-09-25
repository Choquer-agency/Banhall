<script lang="ts">
  import { onDestroy, tick, untrack, type Snippet } from "svelte";
  import { useConvexClient, useMutation, useQuery } from "convex-svelte";
  import type { Id } from "../../../../convex/_generated/dataModel";
  import {
    PD_SUBSECTIONS,
    type PdSubsectionRoleId,
  } from "../../../../shared/pdSubsections";
  import { useStableQuery } from "$lib/stableQuery.svelte";
  import { userErrorMessage } from "$lib/errors";
    import Button from "$lib/components/ui/Button.svelte";
  import Spinner from "$lib/components/ui/Spinner.svelte";
  import * as Drawer from "$lib/components/ui/drawer/index.js";
  import BriefRailPanel from "$lib/components/brief/BriefRailPanel.svelte";
  import SeedOutline from "./SeedOutline.svelte";
  import SeedSubsectionPane from "./SeedSubsectionPane.svelte";
  import { seedSourceLabel, type SeedSourceAttribution } from "./attribution";
  import type { QuoteCitation } from "./citations";
  import { SEED_REVIEW_SUMMARY_TRIGGER_ID } from "./summaryFocus";
  import { approvalButtonClass } from "./approvalStyles";
  import type { SeedDraftUpdate, SeedLocalDraft } from "./types";
  import { seedsApi } from "./api";
  import { api } from "../../../../convex/_generated/api";
  import { draftingInputsFailureMessage } from "./draftingInputs";

  let {
    generationId,
    projectId,
    userId,
    onReviewSummary,
    onOpenSource = undefined,
    hostVisible = true,
    paneSwitchEnd = undefined,
  }: {
    generationId: Id<"generations">;
    projectId: Id<"projects">;
    userId: string;
    onReviewSummary: () => void;
    /** False while the host keeps this workspace mounted but hidden (another
     * tab, the side panel on a narrow screen), so drafts survive while no
     * Batch counts as viewed. */
    hostVisible?: boolean;
    /** Opens a quoted source in its transcript; without it the quote card
     * shows no "Open in transcript" action. */
    onOpenSource?: (citation: QuoteCitation) => void;
    /** Host controls at the end of the narrow Outline/Seeds switch row (board
     * 3.6 puts the page's Details toggle there). Shown only with the switch. */
    paneSwitchEnd?: Snippet;
  } = $props();

  // A failed read is retried by re-establishing the live subscriptions.
  let readsPaused = $state(false);
  let retryingReads = $state(false);
  let sourcesPaused = $state(false);
  const outlineQ = useQuery(seedsApi.getOutline, () =>
    readsPaused ? "skip" : { generationId }
  );
  const sourcesQ = useQuery(seedsApi.getSourceAttribution, () =>
    readsPaused || sourcesPaused ? "skip" : { generationId }
  );
  const convex = useConvexClient();
  const openSeeds = useMutation(seedsApi.open);
  const retryDraftingInputs = useMutation(api.generations.retryDraftingInputs);
  const markBatchViewed = useMutation(seedsApi.markBatchViewed);

  type DraftOwner = { userId: string; generationId: string };

  let activeRoleId = $state<PdSubsectionRoleId>(PD_SUBSECTIONS[0].roleId);
  let mobilePane = $state<"outline" | "work">("work");
  // At `lg` and above both panes are displayed; below it, only the selected one.
  let largeViewport = $state(false);
  // Below 1280px (tablet) the Outline defaults to 240px, otherwise 300px; a
  // width the writer chose (240 to 400px) wins on every viewport.
  let wideViewport = $state(true);
  let storedOutlineWidth = $state<number | null>(null);
  let dragging = $state(false);
  // The current step's approval actions, rendered by the Outline footer (or
  // the phone bottom bar) while the pane that owns their state is mounted.
  let approvalActions = $state.raw<Snippet<["outline" | "bar"]> | null>(null);
  let briefOpen = $state(false);
  // A refused open is published only for the request, owner, role and mount
  // that submitted it (R5-05): a late refusal for another role or an obsolete
  // owner never reaches the shared banner, and the writer retries explicitly
  // for the current role against the current capability and stage version.
  type OpenRefusal = { roleId: PdSubsectionRoleId; message: string };
  let openError = $state<OpenRefusal | null>(null);
  let openRequestToken = 0;
  let autoOpened = $state(false);
  // The authoritative unsaved box text of the hydrated owner (A2). Browser
  // storage mirrors it one Seed at a time, best effort, so navigation and
  // reloads can restore it when the device allows; editing never depends on
  // storage, and a device that cannot keep the text is announced as such.
  let drafts = $state<Record<string, SeedLocalDraft>>({});
  let persistence = $state<"ok" | "unavailable">("ok");
  // The owner (user + generation) whose local state is currently loaded.
  let hydratedOwner = $state<DraftOwner | null>(null);
  let workPane = $state<HTMLElement | null>(null);
  let outlinePane = $state<HTMLElement | null>(null);
  // Set once this workspace is destroyed: no pending operation may publish,
  // request, mutate or rewrite persistence from its obsolete state afterwards.
  let disposed = false;

  // Displayed Batches whose first view is recorded or being recorded, keyed by
  // generation, role and Batch. Bookkeeping only: the server deduplicates.
  const viewedBatches = new Set<string>();
  let viewedOwnerToken = 0;
  const VIEWED_RETRY_DELAYS_MS = [250, 1000, 3000];
  const pendingRetryTimers = new Set<ReturnType<typeof setTimeout>>();

  // Names recovered for sources a partial attribution read left out, scoped
  // to one generation. `attempted` bounds the recovery to one request per
  // source until the writer explicitly retries.
  type SourceRecovery = {
    generationId: string;
    labels: Record<string, string>;
    unrecoverable: string[];
    error: string | null;
  };
  const emptyRecovery = (owner: string): SourceRecovery => ({
    generationId: owner,
    labels: {},
    unrecoverable: [],
    error: null,
  });
  let recovery = $state<SourceRecovery>(emptyRecovery(""));
  const recoveryAttempted = new Set<string>();
  let recoveryToken = 0;
  const RECOVERY_CHUNK = 32;

  // Outline width (decision 19): 240 to 400px, keyboard and pointer, kept
  // per browser.
  const OUTLINE_WIDTH_KEY = "seeds.outlineWidth";
  const OUTLINE_MIN = 240;
  const OUTLINE_MAX = 400;
  const OUTLINE_STEP = 10;

  const READ_FAILURE_NOTICE =
    "Editing is paused until the live read of this subsection recovers.";
  const READ_PENDING_NOTICE =
    "Editing is paused until the live read of this subsection returns.";

  function isRoleId(value: string | null): value is PdSubsectionRoleId {
    return value !== null && PD_SUBSECTIONS.some((role) => role.roleId === value);
  }

  const openRoleKey = (owner: DraftOwner) =>
    `seeds.openRole:${owner.userId}:${owner.generationId}`;
  // One browser record per unsaved Seed (A2): every tab of the same owner
  // writes and removes its own item keys only, so no persist, save, discard or
  // recovery operation can read a shared collection and write it back over
  // another tab's independent item, however their storage operations overlap.
  const draftPrefix = (owner: DraftOwner) =>
    `seeds.draft:${owner.userId}:${owner.generationId}:`;
  const draftItemKey = (owner: DraftOwner, seedId: string) =>
    `${draftPrefix(owner)}${seedId}`;
  const ownerMatches = () =>
    hydratedOwner !== null &&
    hydratedOwner.userId === userId &&
    hydratedOwner.generationId === generationId;

  function textDraft(value: unknown, keys: readonly string[]) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    for (const key of keys) {
      if (key === "baseSeedStageVersion") {
        if (typeof record[key] !== "number" || !Number.isSafeInteger(record[key])) return null;
      } else if (typeof record[key] !== "string") return null;
    }
    return record;
  }

  /** Validates one stored draft item; an item of another owner is ignored. */
  function seedDraftItem(value: unknown, ownerGenerationId: string): SeedLocalDraft | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    if (record.ownerGenerationId !== ownerGenerationId || typeof record.ownerRoleId !== "string") return null;
    const edit = record.edit === null ? null : textDraft(record.edit, ["bulletOne", "bulletTwo", "baseSeedStageVersion"]);
    const feedback = record.feedback === null ? null : textDraft(record.feedback, ["instruction", "baseSeedStageVersion"]);
    if ((record.edit !== null && !edit) || (record.feedback !== null && !feedback) || (!edit && !feedback)) return null;
    return {
      ownerGenerationId,
      ownerRoleId: record.ownerRoleId,
      edit: edit
        ? {
            bulletOne: edit.bulletOne as string,
            bulletTwo: edit.bulletTwo as string,
            baseSeedStageVersion: edit.baseSeedStageVersion as number,
          }
        : null,
      feedback: feedback
        ? {
            instruction: feedback.instruction as string,
            baseSeedStageVersion: feedback.baseSeedStageVersion as number,
          }
        : null,
    };
  }

  function parseDraftItem(raw: string | null, ownerGenerationId: string): SeedLocalDraft | null {
    if (!raw) return null;
    try {
      return seedDraftItem(JSON.parse(raw), ownerGenerationId);
    } catch {
      return null;
    }
  }

  /** The owner's stored drafts, one record per Seed. A read the device refuses
   * marks navigation and reload retention unavailable; the in-memory
   * collection stays usable. */
  function readStoredDrafts(owner: DraftOwner): Record<string, SeedLocalDraft> {
    const prefix = draftPrefix(owner);
    const result: Record<string, SeedLocalDraft> = {};
    try {
      const keys: string[] = [];
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (key && key.startsWith(prefix) && key.length > prefix.length) keys.push(key);
      }
      for (const key of keys) {
        const draft = parseDraftItem(localStorage.getItem(key), owner.generationId);
        if (draft) result[key.slice(prefix.length)] = draft;
      }
    } catch {
      persistence = "unavailable";
      return {};
    }
    return result;
  }

  // Items whose mirror write the device refused, with their latest value
  // (null = removed). They are re-applied with the next write, so the device
  // is named as keeping the text only once every item is truly mirrored.
  const unmirrored = new Map<string, SeedLocalDraft | null>();

  /** Mirrors ONE Seed's draft into its own storage record (A2). Nothing is read
   * back and no other key is written, so another tab's independent items are
   * neither replaced nor deleted. Best effort: a failure is announced, never
   * allowed to block editing. */
  function persistDraftItem(owner: DraftOwner, seedId: string, value: SeedLocalDraft | null) {
    unmirrored.set(seedId, value);
    // Every pending item is attempted on its own record: one refused write
    // never holds back another item's write or removal.
    let refused = false;
    for (const [id, pending] of unmirrored) {
      try {
        if (pending) localStorage.setItem(draftItemKey(owner, id), JSON.stringify(pending));
        else localStorage.removeItem(draftItemKey(owner, id));
        unmirrored.delete(id);
      } catch {
        refused = true;
      }
    }
    persistence = refused ? "unavailable" : "ok";
  }

  // Reset every owner-scoped value before hydrating the destination owner, so
  // empty destination storage can never inherit the previous owner's state.
  $effect(() => {
    const owner: DraftOwner = { userId, generationId: String(generationId) };
    untrack(() => {
      if (
        hydratedOwner?.userId === owner.userId &&
        hydratedOwner.generationId === owner.generationId
      ) return;
      hydratedOwner = null;
      activeRoleId = PD_SUBSECTIONS[0].roleId;
      mobilePane = "work";
      drafts = {};
      unmirrored.clear();
      persistence = "ok";
      autoOpened = false;
      openError = null;
      openRequestToken += 1;
      briefOpen = false;
      viewedBatches.clear();
      viewedOwnerToken += 1;
      recoveryAttempted.clear();
      recoveryToken += 1;
      recovery = emptyRecovery(owner.generationId);
      try {
        const storedRole = localStorage.getItem(openRoleKey(owner));
        if (isRoleId(storedRole)) activeRoleId = storedRole;
      } catch {
        // The open role is navigation state only, so the first role stands;
        // but a device that refuses this read cannot restore any draft
        // either, so navigation and reload retention is announced as
        // unavailable from the start.
        persistence = "unavailable";
      }
      drafts = readStoredDrafts(owner);
      hydratedOwner = owner;
    });
  });

  $effect(() => {
    try {
      const raw = localStorage.getItem(OUTLINE_WIDTH_KEY);
      const stored = raw === null ? Number.NaN : Number(raw);
      if (Number.isFinite(stored) && stored >= OUTLINE_MIN && stored <= OUTLINE_MAX) {
        untrack(() => (storedOutlineWidth = Math.round(stored)));
      }
    } catch {
      // Resizing keeps its default when browser storage is unavailable.
    }
  });

  // The `lg` layout (Tailwind's 64rem breakpoint) displays the Work pane
  // beside the Outline; below it, the selected pane is the only one shown.
  $effect(() => {
    const media = window.matchMedia("(min-width: 64rem)");
    const wide = window.matchMedia("(min-width: 80rem)");
    const apply = () => {
      largeViewport = media.matches;
      wideViewport = wide.matches;
    };
    apply();
    media.addEventListener("change", apply);
    wide.addEventListener("change", apply);
    return () => {
      media.removeEventListener("change", apply);
      wide.removeEventListener("change", apply);
    };
  });
  // Whether the Work surface is displayed (A11): responsive changes and the
  // narrow pane switch both re-evaluate it.
  // The host's own visibility counts too: a hidden ancestor hides Work.
  const workVisible = $derived(hostVisible && (largeViewport || mobilePane === "work"));
  const workDisplayed = () =>
    !!workPane &&
    getComputedStyle(workPane).display !== "none" &&
    (typeof workPane.checkVisibility !== "function" || workPane.checkVisibility());

  onDestroy(() => {
    disposed = true;
    viewedOwnerToken += 1;
    recoveryToken += 1;
    openRequestToken += 1;
    // A destroyed workspace never flushes its obsolete unmirrored items.
    unmirrored.clear();
    for (const timer of pendingRetryTimers) clearTimeout(timer);
    pendingRetryTimers.clear();
    // A drag in progress releases its window listeners with the workspace.
    endDrag();
  });

  // Only a DTO for the requested generation (and role) may be shown or acted on.
  const outline = $derived(
    outlineQ.data && outlineQ.data.generationId === generationId ? outlineQ.data : null
  );
  const subsectionQ = useStableQuery(seedsApi.getSubsection, () =>
    !readsPaused && outline && ownerMatches() ? { generationId, roleId: activeRoleId } : "skip"
  );
  const subsection = $derived(
    subsectionQ.data &&
      subsectionQ.data.generationId === generationId &&
      subsectionQ.data.roleId === activeRoleId &&
      ownerMatches()
      ? subsectionQ.data
      : null
  );
  const outlineError = $derived(outline ? null : (outlineQ.error ?? null));
  // Owner decision 32: the transcript analysis runs in the background while
  // the writer works the Seeds. A failure shows here as soon as it happens,
  // not only on the Summary, with the same retry.
  const draftingInputsFailed = $derived(outline?.draftingInputs?.status === "failed");
  let retryingDraftingInputs = $state(false);
  let draftingInputsRetryError = $state<string | null>(null);
  $effect(() => {
    if (!draftingInputsFailed) draftingInputsRetryError = null;
  });
  async function retryDraftingContext() {
    if (!outline?.canEdit || retryingDraftingInputs) return;
    retryingDraftingInputs = true;
    draftingInputsRetryError = null;
    try {
      await retryDraftingInputs({ generationId });
    } catch (cause) {
      if (!disposed) {
        draftingInputsRetryError = userErrorMessage(cause, "The transcript analysis could not be restarted.");
      }
    } finally {
      if (!disposed) retryingDraftingInputs = false;
    }
  }
  // A current Subsection read failure is announced even while the stable
  // query wrapper still holds the prior successful DTO (A4): that DTO stays
  // readable, but no decision may be taken on it until a live read returns.
  const subsectionError = $derived(subsectionQ.error ?? null);
  // A current successful Subsection result: the live subscription itself
  // holds data now. Absence of an error is not enough while the stable
  // wrapper only supplies the retained DTO (loading, resubscribing, or
  // pending a replacement result), so decisions and bookkeeping wait for it.
  const subsectionCurrent = $derived(
    !subsectionQ.isLoading && !subsectionQ.isRefreshing && !subsectionQ.error
  );
  const subsectionCanEdit = $derived(!!outline?.canEdit && subsectionCurrent);
  // The Outline read completed within the server's safe processing limit
  // only when neither its rows nor its readiness inputs were cut short.
  const outlinePartial = $derived(
    !!outline && (outline.truncated || outline.readiness.complete === false)
  );
  const activeDefinition = $derived(
    PD_SUBSECTIONS.find((definition) => definition.roleId === activeRoleId) ?? PD_SUBSECTIONS[0]
  );
  const outlineWidth = $derived(storedOutlineWidth ?? (wideViewport ? 300 : OUTLINE_MIN));
  const activeRow = $derived(outline?.rows.find((row) => row.roleId === activeRoleId) ?? null);
  // A step approved before (outline `approvedAt`) and opened again is
  // reopened: it is confirmed in place instead of approved and continued.
  const reopened = $derived(
    !!activeRow && (activeRow.state === "approved" || typeof activeRow.approvedAt === "number")
  );
  const decidedCount = $derived(
    outline?.rows.filter((row) => row.state === "approved" || row.state === "skipped").length ?? 0
  );
  // "Review summary" sits under approval when the step is reopened, when the
  // server says every step is decided, or for a reader who cannot approve.
  const reviewSummaryShown = $derived(
    !!outline && (reopened || outline.readiness.ready || !outline.canEdit)
  );

  /** Lets the mounted pane hand over its approval actions; the returned
   * function removes them only while they are still the registered ones. */
  function registerApproval(actions: Snippet<["outline" | "bar"]>) {
    approvalActions = actions;
    return () => {
      if (approvalActions === actions) approvalActions = null;
    };
  }

  /** After "Approve and continue": the next step in order, or the first open
   * step before it once the last is done, or the Summary when none is left. */
  function continueAfterApproval(approvedRoleId: PdSubsectionRoleId) {
    if (disposed || !ownerMatches() || activeRoleId !== approvedRoleId) return;
    const order = PD_SUBSECTIONS.map((definition) => definition.roleId);
    const index = order.indexOf(approvedRoleId);
    const undecided = (roleId: PdSubsectionRoleId) => {
      const row = outline?.rows.find((candidate) => candidate.roleId === roleId);
      return !row || (row.state !== "approved" && row.state !== "skipped");
    };
    const next = order[index + 1] ?? order.slice(0, index).find(undecided);
    if (next) void openRoleFromOutline(next);
    else onReviewSummary();
  }

  function openBrief() {
    briefOpen = true;
  }
  // Readable names with the state of the read behind them (A8): a failed or
  // incomplete read is announced rather than showing missing names as attributed.
  const sourceAttribution = $derived.by((): SeedSourceAttribution => {
    const read = sourcesQ.data;
    const owned = read && read.generationId === generationId ? read : null;
    const labels = new Map<string, string>();
    if (owned) {
      for (const source of owned.sources) {
        labels.set(
          String(source.sourceId),
          seedSourceLabel({ label: source.label, kind: source.kind })
        );
      }
    }
    const ownRecovery = recovery.generationId === String(generationId) ? recovery : null;
    if (ownRecovery) {
      for (const [sourceId, label] of Object.entries(ownRecovery.labels)) labels.set(sourceId, label);
    }
    return {
      labels,
      status: sourcesQ.error
        ? "error"
        : owned
          ? owned.complete
            ? "complete"
            : "incomplete"
          : "loading",
      unrecoverableSourceIds: new Set(ownRecovery?.unrecoverable ?? []),
      recoveryError: ownRecovery?.error ?? null,
    };
  });
  const paneDrafts = $derived.by(() => {
    if (!subsection) return {};
    const result: Record<string, SeedLocalDraft> = {};
    for (const [seedId, draft] of Object.entries(drafts)) {
      if (draft.ownerGenerationId === generationId && draft.ownerRoleId === subsection.roleId) {
        result[seedId] = draft;
      }
    }
    return result;
  });

  $effect(() => {
    const current = outline;
    if (!current || autoOpened || !ownerMatches()) return;
    untrack(() => {
      autoOpened = true;
      const row = current.rows.find((candidate) => candidate.roleId === activeRoleId);
      if (row?.state === "untouched") void openRole(activeRoleId);
    });
  });

  // A Batch is viewed only once it is rendered on the displayed Work surface
  // (A11): one arriving while the narrow Outline is shown waits, and this
  // re-runs when Work becomes visible, including on responsive changes. It
  // also needs a current successful Subsection read: a retained DTO under a
  // failed or pending replacement read establishes nothing, and the eligible
  // view event is kept until that read recovers.
  $effect(() => {
    const current = subsection;
    const batchId = current?.shownBatchId;
    const visible = workVisible;
    const live = subsectionCurrent;
    if (!outline?.canEdit || !current || !batchId || !visible || !live) return;
    const key = `${current.generationId}:${current.roleId}:${batchId}`;
    if (viewedBatches.has(key)) return;
    viewedBatches.add(key);
    void recordBatchViewed(key, {
      generationId,
      roleId: current.roleId,
      batchId,
      expectedSeedStageVersion: current.seedStageVersion,
    });
  });

  /** A retry wait that destruction cancels: a cleared timer never resolves, so
   * the waiting retry can neither mutate nor query again. */
  function retryDelay(ms: number) {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        pendingRetryTimers.delete(timer);
        resolve();
      }, ms);
      pendingRetryTimers.add(timer);
    });
  }

  /** Records the first view of a displayed Batch. Eligibility is checked once
   * the Work surface has rendered and again before every retry: the CURRENT
   * owner, role, Batch, capability and stage version must still match, the
   * Subsection read must be a current success and Work must still be
   * displayed; otherwise the attempt stops and the Batch becomes eligible
   * again when it is next displayed under a current read. A refused attempt
   * is retried a bounded number of times; the server deduplicates per Batch
   * and user, so a retry never records a second view. */
  async function recordBatchViewed(
    key: string,
    first: {
      generationId: Id<"generations">;
      roleId: PdSubsectionRoleId;
      batchId: Id<"seedBatches">;
      expectedSeedStageVersion: number;
    }
  ) {
    const token = viewedOwnerToken;
    await tick();
    const eligible = () => {
      const current = subsection;
      return (
        token === viewedOwnerToken &&
        !!outline?.canEdit &&
        subsectionCurrent &&
        !!current &&
        String(current.generationId) === String(first.generationId) &&
        current.roleId === first.roleId &&
        current.shownBatchId === first.batchId &&
        workVisible &&
        workDisplayed()
      );
    };
    for (let attempt = 0; ; attempt += 1) {
      if (!eligible()) {
        if (token === viewedOwnerToken) viewedBatches.delete(key);
        return;
      }
      const args = { ...first, expectedSeedStageVersion: subsection?.seedStageVersion ?? first.expectedSeedStageVersion };
      try {
        await markBatchViewed(args);
        return;
      } catch {
        if (token !== viewedOwnerToken) return;
        if (attempt >= VIEWED_RETRY_DELAYS_MS.length) {
          viewedBatches.delete(key);
          return;
        }
        await retryDelay(VIEWED_RETRY_DELAYS_MS[attempt]);
        if (token !== viewedOwnerToken) return;
      }
    }
  }

  /** Bounded recovery of names an incomplete attribution read left out: each
   * source is requested once per owner, in capped batches, and a name the
   * server cannot return is recorded as not retrieved with an honest reason.
   * A destroyed workspace publishes nothing and requests no further chunk. */
  async function recoverSourceNames(sourceIds: string[]) {
    const owner = String(generationId);
    const pending = sourceIds.filter((sourceId) => !recoveryAttempted.has(sourceId));
    if (pending.length === 0) return;
    for (const sourceId of pending) recoveryAttempted.add(sourceId);
    const token = recoveryToken;
    if (recovery.generationId !== owner) recovery = emptyRecovery(owner);
    for (let start = 0; start < pending.length; start += RECOVERY_CHUNK) {
      const chunk = pending.slice(start, start + RECOVERY_CHUNK);
      try {
        const result = await convex.query(seedsApi.getSourceAttributionByIds, {
          generationId,
          sourceIds: chunk as Id<"generationSources">[],
        });
        if (token !== recoveryToken || String(generationId) !== owner) return;
        if (String(result.generationId) !== owner) return;
        const labels = { ...recovery.labels };
        const found = new Set<string>();
        for (const source of result.sources) {
          const sourceId = String(source.sourceId);
          labels[sourceId] = seedSourceLabel({ label: source.label, kind: source.kind });
          found.add(sourceId);
        }
        const unrecoverable = new Set(recovery.unrecoverable);
        for (const sourceId of chunk) if (!found.has(sourceId)) unrecoverable.add(sourceId);
        recovery = {
          generationId: owner,
          labels,
          unrecoverable: [...unrecoverable],
          error: result.complete
            ? recovery.error
            : "Some source names could not be retrieved within the server's safe processing limit.",
        };
      } catch (cause) {
        if (token !== recoveryToken || String(generationId) !== owner) return;
        const unrecoverable = new Set(recovery.unrecoverable);
        for (const sourceId of chunk) unrecoverable.add(sourceId);
        recovery = {
          ...recovery,
          generationId: owner,
          unrecoverable: [...unrecoverable],
          error: userErrorMessage(cause, "Source names could not be retrieved."),
        };
      }
    }
  }

  /** Explicit retry: re-establishes a failed attribution subscription and
   * releases every source held back by a failed recovery. */
  async function retrySources() {
    recoveryToken += 1;
    recoveryAttempted.clear();
    const owner = String(generationId);
    recovery = {
      generationId: owner,
      labels: recovery.generationId === owner ? recovery.labels : {},
      unrecoverable: [],
      error: null,
    };
    if (sourcesQ.error) {
      sourcesPaused = true;
      await tick();
      sourcesPaused = false;
      await tick();
    }
  }

  // When a narrow role switch moved focus onto the Work pane before its
  // Subsection arrived, hand focus to the Subsection heading once it renders.
  // The handoff belongs to this workspace, owner and role (A5/A7): after
  // rendering it is rechecked, and the heading is looked up inside this
  // workspace's own Work pane, so an obsolete callback never focuses a
  // replacement page.
  $effect(() => {
    const current = subsection;
    const pane = workPane;
    if (!current || !pane || document.activeElement !== pane) return;
    void tick().then(() => {
      if (
        disposed ||
        !ownerMatches() ||
        subsection?.roleId !== current.roleId ||
        document.activeElement !== pane
      ) return;
      pane.querySelector<HTMLElement>(`#seed-title-${current.roleId}`)?.focus();
    });
  });

  /** Applies a draft change for the hydrated owner. A change committed after
   * this workspace was destroyed (a save that resolved late) is scoped to its
   * own submitted snapshot: it may clear only that unchanged wording from
   * storage and never rewrites storage from the obsolete in-memory collection,
   * so newer wording and independent drafts of a recreated workspace stay. */
  function updateDraft(seedId: string, update: SeedDraftUpdate) {
    const owner = hydratedOwner;
    if (!owner || !ownerMatches()) return;
    if (disposed) {
      applyObsoleteUpdate(owner, seedId, update);
      return;
    }
    const next = update(drafts[seedId]);
    // Never persist text under another generation's key.
    if (next && next.ownerGenerationId !== owner.generationId) return;
    if (next) drafts[seedId] = next;
    else delete drafts[seedId];
    persistDraftItem(owner, seedId, next);
  }

  /** A late change from a destroyed workspace (A2, R6-14): the update is
   * applied to this one Seed's record as storage holds it now, and written
   * directly, never through the `unmirrored` queue. A refused write is
   * abandoned, so no later completion can replay it over wording written
   * since; a retry would re-read and compare again. */
  function applyObsoleteUpdate(owner: DraftOwner, seedId: string, update: SeedDraftUpdate) {
    try {
      const key = draftItemKey(owner, seedId);
      const stored = parseDraftItem(localStorage.getItem(key), owner.generationId) ?? undefined;
      const next = update(stored);
      if (next && next.ownerGenerationId !== owner.generationId) return;
      if (JSON.stringify(next ?? null) === JSON.stringify(stored ?? null)) return;
      if (next) localStorage.setItem(key, JSON.stringify(next));
      else localStorage.removeItem(key);
    } catch {
      // Abandoned: the device refused, and nothing is queued for a retry.
    }
  }

  async function openRole(roleId: PdSubsectionRoleId) {
    activeRoleId = roleId;
    mobilePane = "work";
    openError = null;
    const owner = hydratedOwner;
    if (owner) {
      try {
        localStorage.setItem(openRoleKey(owner), roleId);
      } catch {
        // The server decision state never depends on local navigation storage.
      }
    }
    const current = outline;
    const row = current?.rows.find((candidate) => candidate.roleId === roleId);
    if (!current?.canEdit || !row || row.state !== "untouched" || row.pendingBatchId) return;
    // The identity this request is submitted under: its refusal is published
    // only while this is still the current request of the same owner and role
    // in a live workspace; anything else is obsolete and stays unpublished.
    const request = ++openRequestToken;
    const submitted = { userId, generationId: String(generationId) };
    try {
      await openSeeds({
        generationId,
        roleId,
        expectedSeedStageVersion: current.seedStageVersion,
        commandId: `open:${crypto.randomUUID()}`,
      });
    } catch (cause) {
      if (
        disposed ||
        request !== openRequestToken ||
        submitted.userId !== userId ||
        submitted.generationId !== String(generationId) ||
        !ownerMatches() ||
        activeRoleId !== roleId
      ) return;
      openError = {
        roleId,
        message: userErrorMessage(cause, "Idea Seeds could not be initialized for this subsection."),
      };
    }
  }

  async function openRoleFromOutline(roleId: PdSubsectionRoleId) {
    const narrow = !!outlinePane && getComputedStyle(outlinePane).display !== "none" &&
      !!workPane && getComputedStyle(workPane).display === "none";
    const owner = { userId, generationId: String(generationId) };
    const opening = openRole(roleId);
    if (narrow) {
      // The selected Outline button is about to be hidden; keep focus visible
      // in the Work pane that replaces it. The move belongs to this workspace,
      // owner and chosen role, rechecked after rendering (A5/A7).
      await tick();
      const pane = workPane;
      if (
        !disposed &&
        pane &&
        owner.userId === userId &&
        owner.generationId === String(generationId) &&
        activeRoleId === roleId
      ) {
        const heading = pane.querySelector<HTMLElement>(`#seed-title-${roleId}`);
        if (heading && subsection?.roleId === roleId) heading.focus();
        else pane.focus();
      }
    }
    await opening;
  }

  async function retryReads() {
    retryingReads = true;
    readsPaused = true;
    await tick();
    readsPaused = false;
    await tick();
    retryingReads = false;
  }

  function setOutlineWidth(value: number) {
    const next = Math.round(Math.max(OUTLINE_MIN, Math.min(OUTLINE_MAX, value)));
    storedOutlineWidth = next;
    try {
      localStorage.setItem(OUTLINE_WIDTH_KEY, String(next));
    } catch {
      // Resizing remains available for this visit.
    }
  }

  // The active pointer drag, if any: one gesture at a time, released on
  // completion, pointer cancellation and destruction, so no listener outlives
  // the workspace and a cancelled gesture's later movement is inert.
  let releaseDrag: (() => void) | null = null;

  function endDrag() {
    const release = releaseDrag;
    releaseDrag = null;
    release?.();
  }

  function startDrag(event: PointerEvent) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const target = event.currentTarget;
    if (!(target instanceof HTMLElement)) return;
    const host = target.parentElement;
    if (!host) return;
    endDrag();
    const pointerId = event.pointerId;
    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      const rect = host.getBoundingClientRect();
      if (rect.width > 0) setOutlineWidth(moveEvent.clientX - rect.left);
    };
    const finish = (endEvent: PointerEvent) => {
      if (endEvent.pointerId === pointerId) endDrag();
    };
    releaseDrag = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      try {
        if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
      } catch {
        // The pointer is already released.
      }
      dragging = false;
    };
    dragging = true;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    try {
      target.setPointerCapture(pointerId);
    } catch {
      // Capture is an optimisation; the window listeners still track the gesture.
    }
    // The default stays: the control takes focus on pointer down as any button
    // does, so keyboard adjustment follows a click; `select-none` and
    // `touch-none` keep the gesture from selecting text or scrolling.
  }
</script>

<!-- The retention promise is truthful (A2): the device is named only while
     storage is mirroring the unsaved text. -->
{#snippet retention()}
  {persistence === "ok"
    ? "Your unsaved text is kept on this device."
    : "Your unsaved text stays in this open workspace only."}
{/snippet}

{#snippet readFailure(message: string, cause: unknown)}
  <div class="mx-auto my-8 max-w-md rounded-xl border border-line bg-surface p-5 text-center" role="alert">
    <p class="text-title">{message}</p>
    <p class="mt-1 text-body text-ink-muted">
      {userErrorMessage(cause, "The server could not return the current Seed decisions.")}
      {@render retention()}
    </p>
    <Button class="mt-3 min-h-11" variant="secondary" size="sm" onclick={retryReads} disabled={retryingReads}>
      {retryingReads ? "Retrying…" : "Retry"}
    </Button>
  </div>
{/snippet}

<!-- A read failure announced above a retained Subsection: the prior DTO stays
     readable, its decision controls are off until a live read returns. -->
{#snippet readBanner(message: string, cause: unknown)}
  <div class="mx-4 mt-3 shrink-0 rounded-lg border border-line bg-surface px-3 py-3" role="alert" data-subsection-read-error>
    <p class="text-body text-gap-text!">
      {message} {userErrorMessage(cause, "The server could not return the current Seed decisions.")}
    </p>
    <p class="mt-1 text-xs text-ink-muted">
      Decisions stay unavailable until the live read recovers. {@render retention()}
    </p>
    <Button class="mt-2 min-h-11" variant="secondary" size="sm" onclick={retryReads} disabled={retryingReads}>
      {retryingReads ? "Retrying…" : "Retry"}
    </Button>
  </div>
{/snippet}

{#snippet approvalFooter(layout: "outline" | "bar")}
  <div class="flex flex-col gap-2" data-workspace-approval={layout}>
    {#if approvalActions && subsection}
      {@render approvalActions(layout)}
    {:else if outline?.canEdit}
      <!-- The step is still loading: its approval waits for a current read. -->
      <Button class={approvalButtonClass(layout)} disabled>
        {reopened ? "Confirm and approve" : "Approve and continue"}
      </Button>
    {/if}
    {#if reviewSummaryShown}
      <Button
        id={SEED_REVIEW_SUMMARY_TRIGGER_ID}
        variant="secondary"
        class={approvalButtonClass(layout)}
        onclick={onReviewSummary}
      >Review summary</Button>
    {/if}
  </div>
{/snippet}

{#snippet outlineFooter()}
  {@render approvalFooter("outline")}
{/snippet}

<section class="relative flex h-full min-h-0 flex-col overflow-hidden bg-surface" aria-label="Seed workspace">
  {#if !largeViewport && outline}
    <!-- Phone and narrow layouts show one pane at a time (3.6): a 40px
         gray-50 track with 34px segments, each inside a 44px hit target. -->
    <div class="flex h-[52px] shrink-0 items-center gap-2.5 border-b border-line-soft px-4" data-seed-pane-switch>
      <div class="relative grid min-w-0 flex-1 grid-cols-2 gap-[3px] px-[3px]" role="group" aria-label="Workspace pane">
        <span class="pointer-events-none absolute inset-x-0 top-1/2 h-10 -translate-y-1/2 rounded-[9px] bg-gray-50" aria-hidden="true"></span>
        {#each [{ pane: "outline" as const }, { pane: "work" as const }] as option (option.pane)}
          {@const pressed = mobilePane === option.pane}
          <button
            type="button"
            aria-pressed={pressed}
            onclick={() => (mobilePane = option.pane)}
            class="group relative flex h-11 min-w-0 items-center justify-center rounded-[7px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary"
          >
            <span
              class={`flex h-[34px] w-full items-center justify-center gap-1.5 rounded-[7px] border text-[13px] leading-[18px] transition-colors motion-reduce:transition-none ${
                pressed
                  ? "border-line bg-surface font-medium text-ink"
                  : "border-transparent text-ink-secondary group-hover:text-ink"
              }`}
            >
              {#if option.pane === "outline"}
                Outline <span class="text-[11px] leading-[14px] font-normal text-ink-faint">{decidedCount} / {outline.rows.length}</span>
              {:else}
                Seeds
              {/if}
            </span>
          </button>
        {/each}
      </div>
      {#if paneSwitchEnd}
        <div class="flex shrink-0 items-center" data-seed-pane-switch-end>{@render paneSwitchEnd()}</div>
      {/if}
    </div>
  {/if}

  {#if openError && openError.roleId === activeRoleId}
    <!-- The refusal belongs to the displayed role; Retry resubmits the open
         for that role against the current capability and stage version. -->
    <div role="alert" data-open-refusal={openError.roleId} class="flex shrink-0 flex-wrap items-center gap-2 bg-gap-bg px-4 py-2 text-body text-gap-text!">
      <p class="min-w-0 flex-1">{openError.message}</p>
      <Button class="min-h-11" variant="secondary" size="sm" onclick={() => openRole(activeRoleId)} disabled={!outline?.canEdit}>
        Retry
      </Button>
    </div>
  {/if}

  {#if persistence === "unavailable"}
    <p role="status" data-workspace-persistence="unavailable" class="shrink-0 border-b border-line bg-gap-bg px-4 py-2 text-body text-gap-text!">
      Unsaved Seed text stays in this open workspace only. This device cannot keep it across navigation or reload.
    </p>
  {/if}

  {#if draftingInputsFailed}
    <div role="status" data-workspace-drafting-inputs="failed" class="flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-gap-bg px-4 py-2 text-body text-gap-text!">
      <p class="min-w-0 flex-1">{draftingInputsFailureMessage(outline?.draftingInputs?.failureCode, !!outline?.canEdit)}</p>
      {#if outline?.canEdit}
        <Button
          class="min-h-11"
          variant="secondary"
          size="sm"
          data-workspace-drafting-retry
          onclick={retryDraftingContext}
          disabled={retryingDraftingInputs}
        >{retryingDraftingInputs ? "Trying again…" : "Try again"}</Button>
      {/if}
      {#if draftingInputsRetryError}
        <p role="alert" class="w-full">{draftingInputsRetryError}</p>
      {/if}
    </div>
  {/if}

  {#if outlinePartial}
    <!-- Partial counts are qualified, never definitive (A4): the server
         still decides readiness; a reload is the safe recovery, and a read
         that stays bounded remains an honest refusal. -->
    <div role="status" data-outline-partial class="flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-gap-bg px-4 py-2 text-body text-gap-text!">
      <p class="min-w-0 flex-1">
        The Outline was read within the server's safe processing limit, so counts and previews may be incomplete.
        {outline?.readiness.complete === false
          ? "Readiness could not be fully computed within the server's safe processing limit."
          : "Readiness is still decided by the server."}
      </p>
      <Button class="min-h-11" variant="secondary" size="sm" onclick={retryReads} disabled={retryingReads}>
        {retryingReads ? "Reloading…" : "Reload Outline"}
      </Button>
    </div>
  {/if}

  {#if !outline && outlineError}
    <div class="min-h-0 flex-1 overflow-y-auto px-4">
      {@render readFailure("The Seed workspace could not load.", outlineError)}
    </div>
  {:else if !outline}
    <div class="flex min-h-0 flex-1 items-center justify-center gap-2 text-body text-ink-muted">
      <Spinner size="sm" /> Loading Seed workspace…
    </div>
  {:else}
    <div class={`flex min-h-0 flex-1 ${dragging ? "select-none" : ""}`}>
      <div
        bind:this={outlinePane}
        class={`${mobilePane === "outline" ? "block" : "hidden"} min-h-0 w-full flex-none border-r border-line-soft lg:block lg:w-[var(--seed-outline-width)]`}
        style={`--seed-outline-width: ${outlineWidth}px`}
      >
        <SeedOutline
          rows={outline.rows}
          {activeRoleId}
          onOpen={openRoleFromOutline}
          usageNotice={outline.usage.notice ? `${outline.usage.requests} seed requests` : null}
          footer={largeViewport ? outlineFooter : undefined}
        />
      </div>
      <!-- The value is the Outline's width in pixels, adjusted with Left/Right,
           Home and End, so the slider is declared horizontal. -->
      <button
        type="button"
        role="slider"
        aria-label="Resize Seed outline"
        aria-orientation="horizontal"
        aria-valuemin={OUTLINE_MIN}
        aria-valuemax={OUTLINE_MAX}
        aria-valuenow={outlineWidth}
        aria-valuetext={`Outline ${outlineWidth} pixels wide`}
        onpointerdown={startDrag}
        onkeydown={(event) => {
          if (event.key === "ArrowLeft") setOutlineWidth(outlineWidth - OUTLINE_STEP);
          else if (event.key === "ArrowRight") setOutlineWidth(outlineWidth + OUTLINE_STEP);
          else if (event.key === "Home") setOutlineWidth(OUTLINE_MIN);
          else if (event.key === "End") setOutlineWidth(OUTLINE_MAX);
          else return;
          event.preventDefault();
        }}
        class="group relative -mx-1.5 hidden w-3 flex-none cursor-col-resize touch-none items-stretch justify-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary lg:flex"
      >
        <span class={`w-px transition-colors motion-reduce:transition-none ${dragging ? "bg-primary" : "bg-transparent group-hover:bg-primary group-focus-visible:bg-primary"}`}></span>
      </button>
      <div
        bind:this={workPane}
        tabindex="-1"
        aria-label="Seed work"
        class={`${mobilePane === "work" ? "flex" : "hidden"} min-h-0 min-w-0 flex-1 flex-col outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary lg:flex`}
      >
        {#if subsection}
          {#if subsectionError}
            {@render readBanner(`${activeDefinition.title} could not refresh.`, subsectionError)}
          {:else if !subsectionCurrent}
            <!-- The retained DTO stays readable while the live read is
                 re-established; decisions wait for its current result. -->
            <p role="status" data-subsection-read-pending class="mx-4 mt-3 shrink-0 rounded-lg bg-gap-bg px-3 py-2 text-body text-gap-text!">
              Waiting for the live read of {activeDefinition.title}. Decisions stay unavailable until it returns. {@render retention()}
            </p>
          {/if}
          <div class="flex min-h-0 flex-1 flex-col">
            {#key `${subsection.generationId}:${subsection.roleId}`}
              <SeedSubsectionPane
                {generationId}
                title={activeDefinition.title}
                objective={activeDefinition.objective}
                kind={activeDefinition.kind}
                data={subsection}
                canEdit={subsectionCanEdit}
                drafts={paneDrafts}
                {sourceAttribution}
                {persistence}
                {reopened}
                compact={!largeViewport}
                unavailableNotice={subsectionError
                  ? READ_FAILURE_NOTICE
                  : !subsectionCurrent
                    ? READ_PENDING_NOTICE
                    : undefined}
                onDraftChange={updateDraft}
                onRecoverSources={recoverSourceNames}
                onRetrySources={retrySources}
                onRegisterApproval={registerApproval}
                onApproved={continueAfterApproval}
                onOpenBrief={openBrief}
                {onOpenSource}
              />
            {/key}
          </div>
        {:else if subsectionError}
          <div class="min-h-0 flex-1 overflow-y-auto px-4">
            {@render readFailure(`${activeDefinition.title} could not load.`, subsectionError)}
          </div>
        {:else}
          <div class="flex flex-1 items-center justify-center gap-2 text-body text-ink-muted">
            <Spinner size="sm" /> Loading subsection…
          </div>
        {/if}
        {#if !largeViewport}
          <!-- Phone bottom bar (3.6): regenerate and approve, 44px targets. -->
          <div class="shrink-0 border-t border-line-soft bg-surface px-4 pt-2.5 pb-6" data-seed-bottom-bar>
            {@render approvalFooter("bar")}
          </div>
        {/if}
      </div>
    </div>
  {/if}

  <!-- autoFocus moves focus into the opened Brief; closing returns it to the trigger. -->
  <Drawer.Root bind:open={briefOpen} direction="right" shouldScaleBackground={false} autoFocus={true}>
    <Drawer.Content
      class="z-[110] border-line bg-canvas p-3 text-ink shadow-2xl data-[vaul-drawer-direction=right]:h-dvh data-[vaul-drawer-direction=right]:max-h-dvh data-[vaul-drawer-direction=right]:w-full data-[vaul-drawer-direction=right]:max-w-[30rem] data-[vaul-drawer-direction=right]:rounded-l-xl"
      onCloseAutoFocus={(event: Event) => {
        // Focus returns to the step header More menu that opened the Brief.
        event.preventDefault();
        workPane?.querySelector<HTMLElement>("[data-step-more-trigger]")?.focus();
      }}
    >
      <Drawer.Title class="sr-only">Brief</Drawer.Title>
      <Drawer.Description class="sr-only">
        The Brief this generation uses. Newer Brief edits apply to the next generation.
      </Drawer.Description>
      <div class="min-h-0 flex-1">
        <BriefRailPanel
          mode="rail"
          {generationId}
          {projectId}
          open={briefOpen}
          onClose={() => (briefOpen = false)}
        />
      </div>
    </Drawer.Content>
  </Drawer.Root>
</section>
