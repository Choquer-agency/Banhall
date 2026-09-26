<script lang="ts">
  import { onDestroy, onMount, tick, untrack } from "svelte";
  import { useConvexClient, useMutation, useQuery } from "convex-svelte";
  import { api } from "../../../../convex/_generated/api";
  import type { Id } from "../../../../convex/_generated/dataModel";
  import { isLongForSeed, MAX_EDITED_BULLET_CHARS } from "../../../../convex/lib/seedContract";
  import { DRAFTING_INPUTS_FAILED_STATUS, draftingInputsFailureMessage } from "./draftingInputs";
  import { PD_SUBSECTIONS } from "../../../../shared/pdSubsections";
  import { modelLabelFor } from "$lib/modelPicker";
  import { userErrorCode, userErrorMessage } from "$lib/errors";
  import { reducedMotion } from "$lib/motion";
  import Button from "$lib/components/ui/Button.svelte";
  import Spinner from "$lib/components/ui/Spinner.svelte";
  import Tooltip from "$lib/components/ui/Tooltip.svelte";
  import type { SeedSummaryItem, SeedSummaryPage } from "./types";
  import { seedsApi } from "./api";
  import { SEED_SUMMARY_HEADING_ID } from "./summaryFocus";
  import { findExactQuoteSpans, segmentBullet } from "./exactQuote";
  import { PD_SECTION_TITLES, pdSectionNumber } from "./sectionTitles";
  import { seedTagStyle } from "./seedTags";
  import { attributionFromRead } from "./attribution";
  import SeedQuote from "./SeedQuote.svelte";
  import SeedSignOffDialog from "./SeedSignOffDialog.svelte";

  let {
    generationId,
    userId,
    versionId = null,
    readOnly = false,
    recovery = false,
    canRecover = false,
    focusHeadingOnMount = false,
    onClose,
    onSignedOff,
    onOpenStep,
    onOpenSource,
  }: {
    generationId: Id<"generations">;
    userId: string;
    versionId?: Id<"summaryVersions"> | null;
    readOnly?: boolean;
    recovery?: boolean;
    /** Report-edit capability for Summary recovery; recovery never reopens Seeds. */
    canRecover?: boolean;
    /** Entering the review by a trigger or history moves focus to the heading. */
    focusHeadingOnMount?: boolean;
    onClose?: () => void;
    /** An accepted sign-off, named by its submitting owner so the host can
     * fence the completion to that generation and its own lifetime (A5/A7). */
    onSignedOff?: (submitted: { generationId: Id<"generations">; userId: string }) => void;
    /** Opens one planning step in the workspace. Without it, "n steps still
     * open" records the step as this user's open step for this generation
     * (the workspace's own `seeds.openRole` restore) and returns through
     * `onClose`. */
    onOpenStep?: (roleId: string) => void;
    /** Opens a cited source; the quote card shows "Open in transcript" only
     * when the host provides it. */
    onOpenSource?: (sourceId: string) => void;
  } = $props();

  type LoadedSummary = {
    ownerKey: string;
    pageKey: string;
    generationId: string;
    summaryVersionId: string | null;
    summaryVersion: number | null;
    seedStageVersion: number;
    items: SeedSummaryItem[];
    skippedRoleIds: string[];
    settings: SeedSummaryPage["settings"];
    complete: boolean;
  };

  type SummaryDraft = {
    ownerGenerationId: string;
    ownerSummaryVersionId: string;
    baseSeedStageVersion: number;
    bulletOne: string;
    bulletTwo: string;
  };

  const convex = useConvexClient();
  // Retrying a failed read re-establishes its live subscription.
  let summaryPaused = $state(false);
  let outlinePaused = $state(false);
  const outlineQ = useQuery(seedsApi.getOutline, () =>
    readOnly || outlinePaused ? "skip" : { generationId }
  );
  // Source names for the quote cards (decision 17), with the read's state.
  const sourcesQ = useQuery(seedsApi.getSourceAttribution, () =>
    summaryPaused ? "skip" : { generationId }
  );
  const sourceAttribution = $derived(
    attributionFromRead(sourcesQ.data, String(generationId), !!sourcesQ.error)
  );
  const summaryQ = useQuery(seedsApi.getSummary, () =>
    summaryPaused
      ? "skip"
      : {
          generationId,
          ...(versionId ? { versionId } : {}),
          cursor: null,
          numItems: 50,
        }
  );
  const editSeed = useMutation(seedsApi.edit);
  const signOff = useMutation(api.generations.signOffSeedStage);
  const retryFromSummary = useMutation(api.generations.retryFromSummary);
  const retryDraftingInputs = useMutation(api.generations.retryDraftingInputs);

  let view = $state<LoadedSummary | null>(null);
  let loading = $state(false);
  let loadError = $state<string | null>(null);
  let actionError = $state<string | null>(null);
  let retryingLoad = $state(false);
  let retryingOutline = $state(false);
  let busy = $state(false);
  let retryingDraftingInputs = $state(false);
  let savingSeedIds = $state<string[]>([]);
  let editingSeedId = $state<string | null>(null);
  // The stage version the open edit began against, mirrored from its draft.
  let editingBase = $state<number | null>(null);
  let bulletOne = $state("");
  let bulletTwo = $state("");
  // A one-bullet seed edits in one field until the writer asks for a second.
  let secondBulletShown = $state(false);
  // The authoritative unsaved wording of the hydrated owner (A2). Browser
  // storage only mirrors it, one item at a time and best-effort, so navigation
  // and reloads can restore it when the device allows; Save never depends on
  // storage.
  let drafts = $state<Record<string, SummaryDraft>>({});
  let persistence = $state<"ok" | "unavailable">("ok");
  // The capability last reported by a live Outline, kept while an Outline
  // read fails so an open editor's text stays visible with its actions off.
  let lastKnownCanEdit = $state(false);
  let headingEl = $state<HTMLHeadingElement | null>(null);
  let rootEl = $state<HTMLElement | null>(null);
  // The sign-off confirm and the exact Summary it was opened for (A1): the
  // confirm re-checks this fence at the moment the writer presses it.
  let signOffOpen = $state(false);
  // Mounted on first use and kept, so its close transition and focus return
  // can finish; a review that never opens it carries no dialog at all.
  let signOffDialogMounted = $state(false);
  let signOffFence = $state<{ ownerKey: string; pageKey: string; seedStageVersion: number } | null>(null);
  const signOffTrigger = () => rootEl?.querySelector<HTMLElement>("[data-summary-signoff]") ?? null;
  let activeLoadRequest = 0;
  let loadingPageKey = "";
  let componentOwnerKey = "";
  // Set once this review is destroyed: a save that resolves afterwards is
  // scoped to its own submitted snapshot and never rewrites persistence from
  // this obsolete collection.
  let disposed = false;
  const sections: Array<"s242" | "s244" | "s246"> = ["s242", "s244", "s246"];

  const ownerKeyOf = (generation: string, version: string | null) =>
    `${generation}:${version ?? "live"}`;
  const currentOwnerKey = () => ownerKeyOf(String(generationId), versionId ?? null);
  // One browser record per unsaved item (A2): tabs of the same owner write and
  // remove their own item keys only, so no persist, save, discard or recovery
  // operation can read a shared collection and write it back over another
  // tab's independent item, however their storage operations overlap.
  type DraftStore = { ownerKey: string; storagePrefix: string };
  // Captured before any await so a late result writes to its own owner's keys.
  const draftStore = (): DraftStore => {
    const ownerKey = currentOwnerKey();
    return { ownerKey, storagePrefix: `seeds.summaryDraft:${userId}:${ownerKey}:` };
  };
  const draftItemKey = (store: DraftStore, seedId: string) => `${store.storagePrefix}${seedId}`;
  const pageKeyOf = (first: SeedSummaryPage) =>
    `${first.generationId}:${first.summaryVersionId ?? "live"}:${first.seedStageVersion}`;

  onMount(() => {
    if (!focusHeadingOnMount) return;
    // Only this live review's own heading: a review destroyed before the
    // callback runs moves no focus (A5/A7).
    void tick().then(() => {
      if (!disposed) headingEl?.focus();
    });
  });

  // A destroyed review owns no pending walk: a page that resolves afterwards
  // is dropped before it can request another or publish anything.
  onDestroy(() => {
    disposed = true;
    activeLoadRequest += 1;
    // A destroyed review never flushes its obsolete unmirrored items.
    unmirrored.clear();
  });

  /** Loads every page of one first page's exact Summary identity. An obsolete
   * walk stops right after its awaited response, before any further request. */
  async function loadCompleteSummary(first: SeedSummaryPage) {
    const owner = {
      key: currentOwnerKey(),
      generationId,
      versionId,
    };
    if (String(first.generationId) !== String(owner.generationId)) return;
    const pageKey = pageKeyOf(first);
    const request = ++activeLoadRequest;
    const obsolete = () => request !== activeLoadRequest || owner.key !== currentOwnerKey();
    loadingPageKey = pageKey;
    loading = true;
    loadError = null;
    const items: SeedSummaryItem[] = [...first.page];
    let cursor = first.continueCursor;
    let done = first.isDone;
    const settle = (complete: boolean) => {
      view = {
        ownerKey: owner.key,
        pageKey,
        generationId: String(first.generationId),
        summaryVersionId: first.summaryVersionId ? String(first.summaryVersionId) : null,
        summaryVersion: first.summaryVersion ?? null,
        seedStageVersion: first.seedStageVersion,
        items: [...items],
        skippedRoleIds: [...first.skippedRoleIds],
        settings: first.settings,
        complete,
      };
    };
    try {
      while (!done) {
        const requestedCursor = cursor;
        const page = await convex.query(seedsApi.getSummary, {
          generationId: owner.generationId,
          ...(owner.versionId ? { versionId: owner.versionId } : {}),
          cursor: requestedCursor,
          numItems: 50,
        });
        if (obsolete()) return;
        if (
          String(page.generationId) !== String(first.generationId) ||
          page.seedStageVersion !== first.seedStageVersion ||
          page.summaryVersionId !== first.summaryVersionId
        ) {
          throw new Error("The Summary changed while it was loading. Reload the complete review.");
        }
        if (!page.isDone && page.continueCursor === requestedCursor) {
          throw new Error("The Summary pages stopped advancing. Reload the complete review.");
        }
        items.push(...page.page);
        cursor = page.continueCursor;
        done = page.isDone;
      }
      settle(true);
    } catch (cause) {
      if (obsolete()) return;
      settle(false);
      loadError =
        userErrorCode(cause) === "STALE_REVISION"
          ? "The Summary changed while it was loading. Reload the complete review."
          : userErrorMessage(cause, "The complete Summary could not be loaded.");
    } finally {
      if (request === activeLoadRequest) {
        loadingPageKey = "";
        loading = false;
      }
    }
  }

  /** Validates one stored item; an item of another owner is ignored. */
  function parseStoredDraft(raw: string | null, store: DraftStore): SummaryDraft | null {
    if (!raw) return null;
    try {
      const value: unknown = JSON.parse(raw);
      const [ownerGenerationId, ownerSummaryVersionId] = store.ownerKey.split(":");
      if (
        value && typeof value === "object" &&
        "ownerGenerationId" in value && value.ownerGenerationId === ownerGenerationId &&
        "ownerSummaryVersionId" in value && value.ownerSummaryVersionId === ownerSummaryVersionId &&
        "baseSeedStageVersion" in value && typeof value.baseSeedStageVersion === "number" &&
        "bulletOne" in value && typeof value.bulletOne === "string" &&
        "bulletTwo" in value && typeof value.bulletTwo === "string"
      ) {
        return {
          ownerGenerationId: value.ownerGenerationId,
          ownerSummaryVersionId: value.ownerSummaryVersionId,
          baseSeedStageVersion: value.baseSeedStageVersion,
          bulletOne: value.bulletOne,
          bulletTwo: value.bulletTwo,
        };
      }
      return null;
    } catch {
      return null;
    }
  }

  /** The owner's stored drafts, one record per item. A read the device refuses
   * marks navigation and reload retention unavailable; memory stays usable. */
  function readStoredDrafts(store: DraftStore): Record<string, SummaryDraft> {
    const result: Record<string, SummaryDraft> = {};
    try {
      const keys: string[] = [];
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (key && key.startsWith(store.storagePrefix) && key.length > store.storagePrefix.length) keys.push(key);
      }
      for (const key of keys) {
        const draft = parseStoredDraft(localStorage.getItem(key), store);
        if (draft) result[key.slice(store.storagePrefix.length)] = draft;
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
  const unmirrored = new Map<string, SummaryDraft | null>();

  /** Best-effort mirror of ONE item's in-memory draft into its own storage
   * record (A2). Nothing is read back and no other key is written, so another
   * tab's independent items are neither replaced nor deleted. A failure is
   * announced, never allowed to block editing or saving. */
  function persistDraftItem(store: DraftStore, seedId: string, value: SummaryDraft | null) {
    unmirrored.set(seedId, value);
    // Every pending item is attempted on its own record: one refused write
    // never holds back another item's write or removal.
    let refused = false;
    for (const [id, pending] of unmirrored) {
      try {
        if (pending) localStorage.setItem(draftItemKey(store, id), JSON.stringify(pending));
        else localStorage.removeItem(draftItemKey(store, id));
        unmirrored.delete(id);
      } catch {
        refused = true;
      }
    }
    persistence = refused ? "unavailable" : "ok";
  }

  /** Cleanup by a review that no longer owns a current collection (A2,
   * R6-14): it removes only its own submitted snapshot, re-read and compared
   * against storage at this moment, and never goes through the `unmirrored`
   * queue. A refused removal is abandoned, so no later completion can replay
   * it over wording written since. */
  function clearObsoleteSnapshot(store: DraftStore, seedId: string, submitted: SummaryDraft) {
    try {
      const key = draftItemKey(store, seedId);
      if (sameDraft(parseStoredDraft(localStorage.getItem(key), store) ?? undefined, submitted)) {
        localStorage.removeItem(key);
      }
    } catch {
      // Abandoned: the device refused, and nothing is queued for a retry.
    }
  }

  $effect(() => {
    const ownerKey = currentOwnerKey();
    const first = summaryQ.data;
    const queryError = summaryQ.error;
    untrack(() => {
      if (ownerKey !== componentOwnerKey) {
        // A different generation or Summary never inherits the prior owner's
        // pages, edit buffer, drafts or pending work.
        componentOwnerKey = ownerKey;
        activeLoadRequest += 1;
        loadingPageKey = "";
        view = null;
        loading = false;
        loadError = null;
        actionError = null;
        editingSeedId = null;
        editingBase = null;
        bulletOne = "";
        bulletTwo = "";
        savingSeedIds = [];
        lastKnownCanEdit = false;
        signOffOpen = false;
        signOffFence = null;
        unmirrored.clear();
        persistence = "ok";
        drafts = readStoredDrafts(draftStore());
      }
      if (queryError) {
        // A failed live subscription is announced whatever else is pending
        // (A4): an outstanding continuation is invalidated so its later result
        // can neither erase this failure nor continue obsolete work.
        activeLoadRequest += 1;
        loadingPageKey = "";
        loading = false;
        loadError = userErrorMessage(queryError, "The Summary could not be loaded.");
        return;
      }
      if (!first || String(first.generationId) !== String(generationId)) return;
      const pageKey = pageKeyOf(first);
      if (view?.ownerKey === ownerKey && view.pageKey === pageKey && view.complete) {
        // The subscription is back on the complete pages already on screen.
        if (!loading) loadError = null;
        return;
      }
      if (loadingPageKey === pageKey) return;
      void loadCompleteSummary(first);
    });
  });

  async function retryLoad() {
    actionError = null;
    const first = summaryQ.data;
    if (first && !summaryQ.error && String(first.generationId) === String(generationId)) {
      await loadCompleteSummary(first);
      return;
    }
    retryingLoad = true;
    loadError = null;
    summaryPaused = true;
    await tick();
    summaryPaused = false;
    await tick();
    retryingLoad = false;
  }

  /** Re-establishes the live Outline subscription after a failed read. */
  async function retryOutline() {
    retryingOutline = true;
    outlinePaused = true;
    await tick();
    outlinePaused = false;
    await tick();
    retryingOutline = false;
  }

  const outline = $derived(
    outlineQ.data && outlineQ.data.generationId === generationId ? outlineQ.data : null
  );
  // An Outline failure is announced on its own, apart from Summary pages.
  const outlineError = $derived(readOnly || outline ? null : (outlineQ.error ?? null));
  $effect(() => {
    if (outline) lastKnownCanEdit = outline.canEdit;
  });
  const canEdit = $derived(
    !readOnly &&
      (outline ? outline.canEdit : (!!outlineError || retryingOutline) && lastKnownCanEdit)
  );
  // Every mutation needs the current live capability and readiness; while the
  // Outline is unavailable the editor stays visible but its actions are off.
  const mutationsAvailable = $derived(canEdit && !!outline);
  const readiness = $derived(outline?.readiness);
  // Owner decision 32: the analysis and Brain search run in the background
  // while the writer works the Seeds; drafting needs them, so sign-off waits
  // for "ready". A missing value is an older server: nothing to wait for.
  const draftingInputs = $derived(outline?.draftingInputs?.status ?? "ready");
  const draftingInputsFailure = $derived(outline?.draftingInputs?.failureCode);
  const draftingInputsNotice = $derived(
    !readOnly && draftingInputs === "failed"
      ? draftingInputsFailureMessage(draftingInputsFailure, canEdit)
      : ""
  );
  // Incomplete server readiness is a bounded-processing limitation, not a
  // role decision blocker (A4): the server names it, this review never
  // derives it. The messages are the server's own, when it reports them.
  const readinessIncomplete = $derived(!!readiness && readiness.complete === false);
  const incompleteReadinessMessages = $derived(
    readiness?.blockers
      ?.filter((blocker) => blocker.code === "INCOMPLETE_INPUT")
      .map((blocker) => blocker.message) ?? []
  );
  const shownView = $derived(view?.ownerKey === currentOwnerKey() ? view : null);
  const settings = $derived(
    shownView?.settings ??
      (summaryQ.data && String(summaryQ.data.generationId) === String(generationId)
        ? summaryQ.data.settings
        : null)
  );
  // The Summary version is named only once it has been regenerated (PRD FR-21).
  const summaryVersion = $derived(
    shownView?.summaryVersion ??
      (summaryQ.data && String(summaryQ.data.generationId) === String(generationId)
        ? (summaryQ.data.summaryVersion ?? null)
        : null)
  );
  // Model catalog: the frozen model's label from the selectable set, seed
  // registry or id; "" never occurs (the generation always froze a model).
  const modelCapabilitiesQ = useQuery(api.providerReadiness.getCapabilities, () => ({}));
  function modelLabel(modelId: string | null) {
    return modelId ? modelLabelFor(modelId, modelCapabilitiesQ.data) : "";
  }
  // Soft note only: a writer's wording is never blocked by the AI Seed
  // contract (PRD FR-11).
  const editLong = $derived(isLongForSeed(bulletOne) || isLongForSeed(bulletTwo));
  const currentSeedStageVersion = $derived(outline?.seedStageVersion ?? shownView?.seedStageVersion ?? null);
  // Sign-off, a new edit and adopting the current decision version are offered
  // only for the exact, completely loaded live Summary on screen, and only
  // while it is still the server's current one: the wording under review must
  // belong to the revision being adopted.
  const reviewedCurrentVersion = $derived(
    !!outline &&
      !!shownView &&
      shownView.complete &&
      !loading &&
      !loadError &&
      !summaryQ.error &&
      shownView.summaryVersionId === null &&
      shownView.generationId === String(generationId) &&
      shownView.seedStageVersion === outline.seedStageVersion &&
      (!summaryQ.data || summaryQ.data.seedStageVersion === shownView.seedStageVersion)
  );
  const editingStale = $derived(
    editingBase !== null &&
      currentSeedStageVersion !== null &&
      editingBase !== currentSeedStageVersion
  );

  function sameDraft(left: SummaryDraft | undefined, right: SummaryDraft) {
    return (
      !!left &&
      left.baseSeedStageVersion === right.baseSeedStageVersion &&
      left.bulletOne === right.bulletOne &&
      left.bulletTwo === right.bulletTwo
    );
  }

  function updateDraft(seedId: string, patch: Partial<SummaryDraft>) {
    const existing = drafts[seedId];
    if (!existing) return;
    drafts[seedId] = { ...existing, ...patch };
    persistDraftItem(draftStore(), seedId, drafts[seedId]);
  }

  function startEdit(item: SeedSummaryItem) {
    const reviewed = shownView;
    if (!mutationsAvailable || !reviewedCurrentVersion || !reviewed) return;
    const store = draftStore();
    const [ownerGenerationId, ownerSummaryVersionId] = store.ownerKey.split(":");
    const draft = drafts[item.seedId] ?? {
      ownerGenerationId,
      ownerSummaryVersionId,
      // The displayed wording belongs to the displayed, current revision.
      baseSeedStageVersion: reviewed.seedStageVersion,
      bulletOne: item.bullets[0] ?? "",
      bulletTwo: item.bullets[1] ?? "",
    };
    drafts[item.seedId] = draft;
    persistDraftItem(store, item.seedId, draft);
    bulletOne = draft.bulletOne;
    bulletTwo = draft.bulletTwo;
    secondBulletShown = false;
    editingBase = draft.baseSeedStageVersion;
    editingSeedId = item.seedId;
    // The field takes focus, so the edit starts where the writer types.
    const seedId = item.seedId;
    void tick().then(() => {
      if (disposed || editingSeedId !== seedId) return;
      rootEl?.querySelector<HTMLTextAreaElement>(`[data-summary-item="${seedId}"] [data-summary-edit-first]`)?.focus();
    });
  }

  function revealSecondBullet(seedId: string) {
    if (editingSeedId !== seedId) return;
    secondBulletShown = true;
    void tick().then(() => {
      if (disposed || editingSeedId !== seedId) return;
      rootEl?.querySelector<HTMLTextAreaElement>(`[data-summary-item="${seedId}"] [data-summary-edit-second]`)?.focus();
    });
  }

  function persistEditDraft() {
    if (editingSeedId) updateDraft(editingSeedId, { bulletOne, bulletTwo });
  }

  function closeEditor(seedId: string) {
    if (editingSeedId !== seedId) return;
    editingSeedId = null;
    editingBase = null;
    bulletOne = "";
    bulletTwo = "";
    secondBulletShown = false;
  }

  function discardEditDraft(seedId: string) {
    delete drafts[seedId];
    persistDraftItem(draftStore(), seedId, null);
    closeEditor(seedId);
  }

  async function saveEdit(item: SeedSummaryItem) {
    if (!mutationsAvailable || editingSeedId !== item.seedId || editingStale) return;
    const store = draftStore();
    const current = drafts[item.seedId];
    if (!current) return;
    // The visible draft is what is submitted, whether or not storage works.
    const submitted = { ...current };
    const owner = { generationId, roleId: item.roleId, seedId: item.seedId };
    savingSeedIds = [...savingSeedIds, item.seedId];
    actionError = null;
    try {
      await editSeed({
        generationId: owner.generationId,
        roleId: owner.roleId,
        seedId: owner.seedId,
        bullets: [submitted.bulletOne.trim(), submitted.bulletTwo.trim()].filter(Boolean),
        expectedSeedStageVersion: submitted.baseSeedStageVersion,
      });
      if (disposed || store.ownerKey !== currentOwnerKey()) {
        // This review no longer owns a current collection (destroyed, or the
        // owner changed while saving): only the submitted snapshot, still
        // unchanged in its own storage record, is cleared; newer wording and
        // independent drafts written since stay untouched.
        clearObsoleteSnapshot(store, owner.seedId, submitted);
        return;
      }
      // Clear only this Seed's unchanged submitted wording; another Seed's
      // draft and text typed during the save stay in memory and storage.
      if (sameDraft(drafts[owner.seedId], submitted)) {
        delete drafts[owner.seedId];
        persistDraftItem(store, owner.seedId, null);
        if (editingSeedId === owner.seedId) {
          closeEditor(owner.seedId);
          refocusItem(owner.seedId);
        }
      }
    } catch (cause) {
      if (!disposed && store.ownerKey === currentOwnerKey()) {
        actionError = userErrorMessage(cause, "The Summary edit was not saved.");
      }
    } finally {
      savingSeedIds = savingSeedIds.filter((seedId) => seedId !== owner.seedId);
    }
  }

  function reviewDraftAgainstCurrent() {
    const seedId = editingSeedId;
    const reviewed = shownView;
    if (!seedId || !mutationsAvailable || !reviewedCurrentVersion || !reviewed) return;
    updateDraft(seedId, {
      baseSeedStageVersion: reviewed.seedStageVersion,
      bulletOne,
      bulletTwo,
    });
    editingBase = reviewed.seedStageVersion;
    actionError = null;
  }

  // Sign-off is offered only for the exact, completely loaded Summary that is
  // still the server's current, ready one (A1).
  const canSignOffNow = $derived(
    !busy &&
      mutationsAvailable &&
      reviewedCurrentVersion &&
      (readiness?.ready ?? false) &&
      draftingInputs === "ready"
  );
  // The confirm stays valid only while the Summary it was opened for is
  // still the one on screen and still current.
  const signOffFenceHolds = $derived(
    canSignOffNow &&
      !!signOffFence &&
      !!shownView &&
      signOffFence.ownerKey === currentOwnerKey() &&
      signOffFence.pageKey === shownView.pageKey &&
      signOffFence.seedStageVersion === shownView.seedStageVersion
  );

  /** Opens the confirm; nothing is submitted until its primary is pressed. */
  function openSignOff() {
    const reviewed = shownView;
    if (!canSignOffNow || !reviewed) return;
    actionError = null;
    signOffFence = {
      ownerKey: currentOwnerKey(),
      pageKey: reviewed.pageKey,
      seedStageVersion: reviewed.seedStageVersion,
    };
    signOffDialogMounted = true;
    signOffOpen = true;
  }

  /** The confirm's primary: re-checks the fence at the moment it is pressed. */
  function confirmSignOff(): boolean {
    const fence = signOffFence;
    if (!fence || !signOffFenceHolds) return false;
    signOffOpen = false;
    signOffFence = null;
    void signOffSummary(fence.seedStageVersion);
    // Focus rests on the bar's sign-off button while the command runs, as if
    // the writer had pressed it there. The host's own move afterwards (back
    // to the workspace, or on to the drafting progress) always wins.
    void tick().then(() => {
      if (disposed || fence.ownerKey !== currentOwnerKey()) return;
      const active = document.activeElement;
      if (!active || active === document.body || active.closest("[data-signoff-dialog]")) {
        signOffTrigger()?.focus();
      }
    });
    return true;
  }

  async function signOffSummary(expectedSeedStageVersion: number) {
    if (!mutationsAvailable || !reviewedCurrentVersion || busy) return;
    // The submitting owner, captured before the await: the completion is
    // reported under that identity so the host can fence it (A5/A7). This
    // review may legitimately be destroyed before the command resolves when
    // the same generation enters drafting first.
    const submitted = { generationId, userId, ownerKey: currentOwnerKey() };
    busy = true;
    actionError = null;
    try {
      await signOff({
        generationId: submitted.generationId,
        expectedSeedStageVersion,
      });
      if (!disposed && submitted.ownerKey !== currentOwnerKey()) return;
      onSignedOff?.({ generationId: submitted.generationId, userId: submitted.userId });
    } catch (cause) {
      // A refused command never invalidates the completely loaded review.
      if (!disposed && submitted.ownerKey === currentOwnerKey()) {
        actionError = userErrorMessage(cause, "The Summary could not be signed off.");
      }
    } finally {
      if (!disposed) busy = false;
    }
  }

  const canSaveEdit = (item: SeedSummaryItem) =>
    editingSeedId === item.seedId &&
    !savingSeedIds.includes(item.seedId) &&
    !!bulletOne.trim() &&
    !editingStale &&
    mutationsAvailable;

  /** Returns focus to an item's Edit control once its editor has closed. */
  function refocusItem(seedId: string) {
    void tick().then(() => {
      if (disposed) return;
      const active = document.activeElement;
      if (active && active !== document.body) return;
      rootEl?.querySelector<HTMLElement>(`[data-summary-edit="${seedId}"]`)?.focus();
    });
  }

  function cancelEdit(seedId: string) {
    discardEditDraft(seedId);
    refocusItem(seedId);
  }

  /** Enter saves, Shift+Enter starts a new line, Esc cancels the edit. */
  function editKeydown(event: KeyboardEvent, item: SeedSummaryItem) {
    if (event.isComposing) return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (canSaveEdit(item)) void saveEdit(item);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      cancelEdit(item.seedId);
    }
  }

  // Items in reading order: Section, then role, then the server's order.
  const orderedItems = $derived(
    shownView
      ? PD_SUBSECTIONS.flatMap((definition) =>
          shownView.items.filter((item) => item.roleId === definition.roleId)
        )
      : []
  );
  const editedItems = $derived(orderedItems.filter((item) => item.edited));

  /** The "n edited by hand" pill: brings the first hand edit into view. */
  function jumpToFirstEdit() {
    const first = editedItems[0];
    if (!first) return;
    const target = rootEl?.querySelector<HTMLElement>(`[data-summary-item="${first.seedId}"]`);
    if (!target) return;
    target.scrollIntoView({ block: "center", behavior: reducedMotion() ? "auto" : "smooth" });
    target.focus({ preventScroll: true });
  }

  // Decision blockers named by the server; never derived here (A4).
  const blockingRoleIds = $derived(
    !readOnly && readiness && !readiness.ready && !readinessIncomplete ? readiness.blockingRoleIds : []
  );
  const roleTitle = (roleId: string) =>
    PD_SUBSECTIONS.find((definition) => definition.roleId === roleId)?.title ?? roleId;
  const canOpenStep = $derived(!readOnly && (!!onOpenStep || !!onClose));

  /** Opens the first open step in the plan, for this user and generation only. */
  function openBlockingStep(roleId: string) {
    if (onOpenStep) {
      onOpenStep(roleId);
      return;
    }
    try {
      // The workspace restores its open step from this same record.
      localStorage.setItem(`seeds.openRole:${userId}:${generationId}`, roleId);
    } catch {
      // Navigation state only: the workspace then opens its default step.
    }
    onClose?.();
  }

  const modelName = $derived(settings ? modelLabel(settings.modelId) : "");

  /** Starts a new background attempt after the transcript analysis failed. */
  async function retryDraftingContext() {
    if (!mutationsAvailable || retryingDraftingInputs) return;
    retryingDraftingInputs = true;
    actionError = null;
    try {
      await retryDraftingInputs({ generationId });
    } catch (cause) {
      if (!disposed) {
        actionError = userErrorMessage(cause, "The transcript analysis could not be restarted.");
      }
    } finally {
      if (!disposed) retryingDraftingInputs = false;
    }
  }

  async function retryDraft() {
    if (!canRecover || busy) return;
    busy = true;
    actionError = null;
    try {
      await retryFromSummary({ failedGenerationId: generationId });
    } catch (cause) {
      actionError = userErrorMessage(cause, "The signed-off Summary could not be retried.");
    } finally {
      busy = false;
    }
  }
</script>


{#snippet bulletText(item: SeedSummaryItem, bullet: string)}
  <!-- Exact quotes only (decision 17); a hand-edited bullet is the writer's
       own wording and carries no quote underline. -->
  {@const citations = item.edited ? [] : item.provenance}
  {@const spans = citations.length > 0 ? findExactQuoteSpans(bullet, citations.map((citation) => citation.exactExcerpt)) : []}
  {#each segmentBullet(bullet, spans) as segment}
    {#if segment.citationIndex !== undefined}
      {@const citation = citations[segment.citationIndex]}
      <SeedQuote
        text={segment.text}
        {citation}
        {sourceAttribution}
        onOpenSource={onOpenSource ? (cited) => onOpenSource(String(cited.sourceId)) : undefined}
      />
    {:else}{segment.text}{/if}
  {/each}
{/snippet}

{#snippet editIcon()}
  <svg class="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
{/snippet}

{#snippet revertIcon(className: string)}
  <svg class={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></svg>
{/snippet}

<section
  bind:this={rootEl}
  class="flex h-full min-h-0 flex-col bg-canvas"
  aria-labelledby={SEED_SUMMARY_HEADING_ID}
  inert={signOffOpen}
>
  <!-- No page header (board 3.3): the shell's Summary tab names the view.
       The heading stays for assistive technology and entry focus (A7). -->
  <h1
    id={SEED_SUMMARY_HEADING_ID}
    bind:this={headingEl}
    tabindex="-1"
    class="sr-only"
  >Summary review</h1>

  <div class="relative min-h-0 flex-1 overflow-y-auto">
    <div class="mx-auto w-full max-w-[760px] px-4 pt-7 pb-14 sm:px-0">
      {#if outlineError}
        <!-- Separate from the Summary-page and revision states below: the
             pages on screen stay complete; only live readiness and
             capability are unknown until this subscription is back. -->
        <div class="mb-4 rounded-lg border border-line bg-surface px-3 py-3" role="alert" data-summary-outline-error>
          <p class="text-body text-gap-text!">The live plan status could not be loaded. {userErrorMessage(outlineError, "The server could not return the current readiness.")}</p>
          <p class="mt-1 text-[12px] text-ink-muted">Edits and sign-off stay unavailable until it reloads. Your unsaved wording is kept.</p>
          <Button class="mt-2" variant="secondary" size="sm" onclick={retryOutline} disabled={retryingOutline}>
            {retryingOutline ? "Reloading…" : "Reload plan status"}
          </Button>
        </div>
      {/if}
      {#if persistence === "unavailable" && !readOnly}
        <p role="status" data-summary-persistence="unavailable" class="mb-4 rounded-lg bg-gap-bg px-3 py-2 text-body text-gap-text!">
          Unsaved Summary edits stay in this open review only. This device cannot keep them across navigation or reload.
        </p>
      {/if}
      {#if !shownView && loadError}
        <div class="rounded-xl border border-line bg-surface p-6 text-center" role="alert">
          <p class="text-body text-gap-text!">{loadError}</p>
          <p class="mt-1 text-[12px] text-ink-muted">Sign-off stays unavailable until the complete Summary loads. {persistence === "ok" ? "Unsaved edits are kept on this device." : "Unsaved edits stay in this open review."}</p>
          <Button class="mt-3" variant="secondary" size="sm" onclick={retryLoad} disabled={retryingLoad || loading}>
            {retryingLoad || loading ? "Reloading…" : "Reload Summary"}
          </Button>
        </div>
      {:else if loading || !shownView}
        <div class="flex min-h-48 items-center justify-center gap-2 text-body text-ink-muted">
          <Spinner size="sm" /> Loading the complete Summary…
        </div>
      {:else}
        {#if !shownView.complete}
          <p class="mb-4 rounded-lg bg-gap-bg px-3 py-2 text-body text-gap-text!">
            Partial Summary. Sign-off stays unavailable until every page is loaded.
          </p>
        {:else if !readOnly && outline && !reviewedCurrentVersion && !loadError}
          <p class="mb-4 rounded-lg bg-gap-bg px-3 py-2 text-body text-gap-text!">
            The plan changed after this review loaded. Sign-off and new edits return once the current version is completely loaded.
          </p>
        {/if}
        {#if loadError}
          <div class="mb-4 rounded-lg border border-line bg-surface px-3 py-3" role="alert">
            <p class="text-body text-gap-text!">{loadError}</p>
            <p class="mt-1 text-[12px] text-ink-muted">Sign-off stays unavailable until the live Summary reloads. Your unsaved wording is kept.</p>
            <Button class="mt-2" variant="secondary" size="sm" onclick={retryLoad} disabled={retryingLoad || loading}>Reload complete Summary</Button>
          </div>
        {/if}
        <div class="flex flex-col gap-14">
          {#each sections as section}
            <section id={`summary-${section}`} class="flex flex-col gap-1" aria-labelledby={`summary-heading-${section}`}>
              <!-- Sticky Section heading (no jump list, owner amendment 2026-09-23). -->
              <div class="sticky top-0 z-10 flex flex-col gap-1.5 bg-canvas px-3 pt-2 pb-3.5">
                <p class="font-mono text-[11px] leading-[14px] text-ink-muted" aria-hidden="true">Section {pdSectionNumber(section)}</p>
                <h2 id={`summary-heading-${section}`} class="font-serif text-[24px] leading-[30px] font-normal text-ink">
                  <span class="sr-only">Section {pdSectionNumber(section)}, </span>{PD_SECTION_TITLES[section]}
                </h2>
              </div>
              {#each PD_SUBSECTIONS.filter((definition) => definition.section === section) as definition}
                {@const roleItems = shownView.items.filter((item) => item.roleId === definition.roleId)}
                {@const skipped = shownView.skippedRoleIds.includes(definition.roleId)}
                {@const roleTags = [...new Set(roleItems.flatMap((item) => item.tags))]}
                {@const writerAsserted = roleItems.some((item) => item.support === "writer_asserted")}
                <article
                  id={`summary-${definition.roleId}`}
                  data-summary-role={definition.roleId}
                  class={`flex scroll-mt-24 flex-col gap-2 rounded-[10px] px-3 py-3.5 transition-colors motion-reduce:transition-none sm:flex-row sm:gap-6 ${canEdit && roleItems.length > 0 ? "hover:bg-gray-50" : ""}`}
                >
                  <div class="flex shrink-0 flex-col gap-1.5 sm:w-[200px]">
                    <h3 class={`text-[14px] leading-5 font-medium ${skipped ? "text-ink-muted" : "text-ink"}`}>{definition.title}</h3>
                    {#if roleTags.length > 0}
                      <div class="flex flex-wrap gap-1.5">
                        {#each roleTags as tag}
                          {@const style = seedTagStyle(tag)}
                          <span class="rounded-full px-2 py-0.5 text-[11px] leading-4" style={`background:${style.background};color:${style.color}`}>{style.label}</span>
                        {/each}
                      </div>
                    {/if}
                    {#if writerAsserted}
                      <!-- FR-21 marker, kept small (decision 19). -->
                      <p class="text-[11px] leading-4 text-ink-muted" data-summary-marker="writer-asserted">Writer asserted</p>
                    {/if}
                  </div>
                  <div class="flex min-w-0 flex-1 flex-col gap-3">
                    {#if skipped}
                      <p class="text-body text-ink-faint!" data-summary-marker="skipped">Skipped</p>
                    {/if}
                    {#if roleItems.length === 0 && !skipped}
                      {#if shownView.complete}
                        <p class="text-body text-ink-muted" data-summary-role-empty={definition.roleId}>No selected items.</p>
                      {:else}
                        <!-- A role absent from an incomplete aggregate is unknown,
                             not empty (A4): its items may be on unread pages. -->
                        <p class="text-body text-gap-text!" data-summary-role-unknown={definition.roleId}>
                          Selected items may be on pages that did not load. Reload the complete Summary to review them.
                        </p>
                      {/if}
                    {/if}
                    {#each roleItems as item (item.seedId)}
                      {@const edited = item.edited}
                      <div
                        data-summary-item={item.seedId}
                        data-summary-edited={edited ? "true" : undefined}
                        tabindex="-1"
                        class="group/item flex scroll-mt-24 gap-3 rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
                      >
                        {#if editingSeedId === item.seedId && canEdit}
                          <div class="flex min-w-0 flex-1 flex-col gap-1.5">
                            <!-- The primary field with a wash ring (board 3.3). A second
                                 field shows when the seed has a second bullet, or on request. -->
                            <div class="rounded-lg transition-shadow focus-within:shadow-[0_0_0_3px_var(--color-primary-wash)] motion-reduce:transition-none">
                              <textarea
                                bind:value={bulletOne}
                                oninput={(event) => { bulletOne = event.currentTarget.value; persistEditDraft(); }}
                                onkeydown={(event) => editKeydown(event, item)}
                                rows="1"
                                maxlength={MAX_EDITED_BULLET_CHARS}
                                aria-label="Bullet 1"
                                aria-describedby={`summary-edit-hint-${item.seedId}`}
                                data-summary-edit-first
                                class="field-control block min-h-11 w-full resize-none rounded-lg px-2.5 py-2 text-[14px] leading-5 text-ink [field-sizing:content]"
                              ></textarea>
                            </div>
                            {#if secondBulletShown || item.bullets.length > 1 || bulletTwo.length > 0}
                              <div class="rounded-lg transition-shadow focus-within:shadow-[0_0_0_3px_var(--color-primary-wash)] motion-reduce:transition-none">
                                <textarea
                                  bind:value={bulletTwo}
                                  oninput={(event) => { bulletTwo = event.currentTarget.value; persistEditDraft(); }}
                                  onkeydown={(event) => editKeydown(event, item)}
                                  rows="1"
                                  maxlength={MAX_EDITED_BULLET_CHARS}
                                  aria-label="Bullet 2, optional"
                                  aria-describedby={`summary-edit-hint-${item.seedId}`}
                                  placeholder="Optional second bullet"
                                  data-summary-edit-second
                                  class="field-control block min-h-11 w-full resize-none rounded-lg px-2.5 py-2 text-[14px] leading-5 text-ink placeholder:text-ink-faint [field-sizing:content]"
                                ></textarea>
                              </div>
                            {/if}
                            {#if editingStale}
                              <div class="rounded-lg bg-gap-bg px-3 py-2 text-body text-gap-text!" role="status">
                                <p>This wording began against an older decision version. Review the current wording before saving it.</p>
                                {#if reviewedCurrentVersion}
                                  <p class="mt-1 text-[12px]">Current wording: {item.bullets.join(" ")}</p>
                                {:else}
                                  <p class="mt-1 text-[12px]">The current wording is still loading. Your draft stays as typed until it is displayed.</p>
                                {/if}
                                <Button
                                  class="mt-2"
                                  size="sm"
                                  variant="secondary"
                                  onclick={reviewDraftAgainstCurrent}
                                  disabled={!mutationsAvailable || !reviewedCurrentVersion}
                                >Use current decision version</Button>
                              </div>
                            {/if}
                            <div class="flex items-center gap-3">
                              <p id={`summary-edit-hint-${item.seedId}`} class="flex-1 text-[12px] leading-4 text-ink-muted">Enter to save, Esc to cancel</p>
                              {#if !(secondBulletShown || item.bullets.length > 1 || bulletTwo.length > 0)}
                                <button
                                  type="button"
                                  class="shrink-0 rounded text-[12px] leading-4 text-ink-muted transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary motion-reduce:transition-none"
                                  onclick={() => revealSecondBullet(item.seedId)}
                                >Add a second bullet</button>
                              {/if}
                              {#if editLong}
                                <p class="text-[12px] leading-4 text-gap-text" aria-live="polite" data-seed-long-note>Long for a seed</p>
                              {/if}
                            </div>
                          </div>
                          <div class="flex w-7 shrink-0 flex-col items-end gap-1 pt-1">
                            <button
                              type="button"
                              aria-label={savingSeedIds.includes(item.seedId) ? "Saving…" : "Save wording"}
                              onclick={() => saveEdit(item)}
                              disabled={!canSaveEdit(item)}
                              class="flex size-[22px] items-center justify-center rounded-[5px] bg-primary-selected text-white transition-opacity focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50 motion-reduce:transition-none [@media(pointer:coarse)]:size-11"
                            >
                              {#if savingSeedIds.includes(item.seedId)}
                                <Spinner size="sm" />
                              {:else}
                                <svg class="size-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
                              {/if}
                            </button>
                            <button
                              type="button"
                              aria-label="Cancel"
                              onclick={() => cancelEdit(item.seedId)}
                              class="flex size-[22px] items-center justify-center rounded-[5px] border border-line bg-surface text-ink-secondary hover:bg-primary-wash focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary [@media(pointer:coarse)]:size-11"
                            >
                              <svg class="size-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
                            </button>
                          </div>
                        {:else}
                          <ul class="flex min-w-0 flex-1 flex-col gap-1.5">
                            {#each item.bullets as bullet, bulletIndex}
                              <li class="flex gap-2 text-[14px] leading-5 text-ink">
                                <span class="mt-2 size-1 shrink-0 rounded-full bg-ink-faint" aria-hidden="true"></span>
                                <span class="min-w-0 flex-1">
                                  <span>{@render bulletText(item, bullet)}</span>
                                  {#if edited && bulletIndex === item.bullets.length - 1}
                                    <span class="ml-1 inline-flex translate-y-0.5 text-ink-muted" role="img" aria-label="Edited by hand" data-summary-edited-mark>
                                      {@render revertIcon("size-[13px]")}
                                    </span>
                                  {/if}
                                </span>
                              </li>
                            {/each}
                          </ul>
                          {#if canEdit}
                            <button
                              type="button"
                              aria-label="Edit"
                              data-summary-edit={item.seedId}
                              onclick={() => startEdit(item)}
                              disabled={!mutationsAvailable || !reviewedCurrentVersion}
                              class="flex size-7 shrink-0 items-center justify-center rounded-md border border-line bg-surface text-ink opacity-0 transition-opacity group-hover/item:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:pointer-events-none disabled:text-ink-faint motion-reduce:transition-none [@media(hover:none)]:opacity-100 [@media(pointer:coarse)]:size-11"
                            >
                              {@render editIcon()}
                            </button>
                          {/if}
                        {/if}
                      </div>
                    {/each}
                  </div>
                </article>
              {/each}
            </section>
          {/each}
        </div>
      {/if}
    </div>
  </div>

  <footer class="shrink-0 border-t border-line bg-surface">
    <!-- Always rendered, so a screen reader hears the failure when it
         arrives: a live region inserted already filled is often missed. -->
    <p class="sr-only" aria-live="polite" data-summary-drafting-inputs-announcement>{draftingInputsNotice}</p>
    {#if actionError || (!readOnly && readiness && !readiness.ready && readinessIncomplete) || (!readOnly && draftingInputs === "failed")}
      <div class="flex flex-col gap-2 border-b border-line-soft px-4 py-3 sm:px-6">
        {#if actionError}<p role="alert" class="text-body text-gap-text!">{actionError}</p>{/if}
        {#if !readOnly && draftingInputs === "failed"}
          <!-- The background analysis or Brain search failed. The plan is
               untouched; sign-off waits until a retry finishes. -->
          <div class="flex flex-wrap items-center gap-x-3 gap-y-2" data-summary-drafting-inputs="failed">
            <p class="text-body text-gap-text!">{draftingInputsNotice}</p>
            {#if canEdit}
              <Button
                variant="secondary"
                size="sm"
                class="min-h-9"
                data-summary-drafting-retry
                onclick={retryDraftingContext}
                disabled={retryingDraftingInputs || !mutationsAvailable}
              >{retryingDraftingInputs ? "Trying again…" : "Try again"}</Button>
            {/if}
          </div>
        {/if}
        {#if !readOnly && readiness && !readiness.ready && readinessIncomplete}
          <!-- The server could not read the complete decision set within its
               safe processing limit, so whether the plan is ready is unknown:
               an empty blocker list explains nothing. Sign-off stays off and
               the explicit recovery re-reads the plan status. -->
          <div role="status" data-summary-readiness="incomplete">
            <p class="text-body text-gap-text!">
              Readiness could not be fully computed within the server's safe processing limit, so it is not known whether every subsection is decided. Sign-off stays unavailable until the plan status is read completely.
            </p>
            {#each incompleteReadinessMessages as message}
              <p class="mt-1 text-[12px] text-ink-muted">{message}</p>
            {/each}
            <Button class="mt-2 min-h-11" variant="secondary" size="sm" onclick={retryOutline} disabled={retryingOutline}>
              {retryingOutline ? "Reloading…" : "Reload plan status"}
            </Button>
          </div>
        {/if}
      </div>
    {/if}
    <div class="flex min-h-[68px] flex-wrap items-center gap-x-3.5 gap-y-2 px-4 py-3 sm:px-6">
      {#if readOnly}
        <p class="text-[14px] leading-5 font-medium text-ink" data-summary-status="signed-off">Signed-off plan</p>
      {:else if readiness?.ready && draftingInputs === "preparing"}
        <!-- Every step is decided; the background analysis and Brain search
             (owner decision 32) are still finishing. Sign-off opens by
             itself when they are done. -->
        <div class="flex items-center gap-2.5" role="status" data-summary-status="preparing">
          <span
            class="size-4 shrink-0 animate-spin rounded-full border-2 border-primary/30 border-t-primary motion-reduce:animate-none"
            aria-hidden="true"
          ></span>
          <p class="text-[14px] leading-5 font-medium text-ink">Preparing the transcript analysis…</p>
        </div>
      {:else if readiness?.ready && draftingInputs === "failed"}
        <div class="flex items-center gap-2.5" data-summary-status="drafting-inputs-failed">
          <span class="size-2 shrink-0 rounded-full bg-stale-dot" aria-hidden="true"></span>
          <p class="text-[14px] leading-5 font-medium text-ink">{DRAFTING_INPUTS_FAILED_STATUS}</p>
        </div>
      {:else if readiness?.ready}
        <div class="flex items-center gap-2.5" data-summary-status="ready">
          <span class="flex size-5 shrink-0 items-center justify-center rounded-full" style="background:#DCFCE7" aria-hidden="true">
            <svg class="size-3" viewBox="0 0 24 24" fill="none" stroke="#15803D" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
          </span>
          <p class="text-[14px] leading-5 font-medium text-ink">Ready to sign off</p>
        </div>
      {:else if blockingRoleIds.length > 0}
        {@const count = blockingRoleIds.length}
        {@const stepLabel = `${count} ${count === 1 ? "step" : "steps"} still open`}
        <div class="flex items-center gap-2.5" data-summary-readiness="blocked">
          <span class="size-2 shrink-0 rounded-full bg-stale-dot" aria-hidden="true"></span>
          {#if canOpenStep}
            <button
              type="button"
              aria-label={`${stepLabel}: open ${roleTitle(blockingRoleIds[0])}`}
              class="rounded text-[14px] leading-5 font-medium text-ink underline decoration-line underline-offset-4 hover:decoration-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              onclick={() => openBlockingStep(blockingRoleIds[0])}
            >{stepLabel}</button>
          {:else}
            <p class="text-[14px] leading-5 font-medium text-ink" title={blockingRoleIds.map(roleTitle).join(", ")}>{stepLabel}</p>
          {/if}
        </div>
      {/if}
      {#if editedItems.length > 0}
        <button
          type="button"
          data-summary-edited-pill
          aria-label={`${editedItems.length} edited by hand, go to the first`}
          class="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full bg-gap-bg pr-2 pl-1.5 text-[12px] leading-4 text-gap-text transition-opacity hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary motion-reduce:transition-none"
          onclick={jumpToFirstEdit}
        >
          {@render revertIcon("size-3")}
          {editedItems.length} edited by hand
          <svg class="size-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
        </button>
      {/if}
      <div class="hidden flex-1 sm:block"></div>
      <div class="flex items-center gap-2 text-[12px] leading-4 text-ink-muted">
        <!-- Only the model, plus the Summary version once it has been
             regenerated (PRD FR-21). Length target and Writer Profile stay
             frozen and recorded at sign-off but are not shown here. -->
        <span data-summary-model>{settings ? modelName : "Loading model"}</span>
        {#if summaryVersion !== null && summaryVersion > 1}
          <Tooltip text={`This Summary was rebuilt after a regeneration, so this is version ${summaryVersion}.`} delayDuration={200}>
            {#snippet children({ props })}
              <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
              <span {...props} tabindex="0" class="rounded-full bg-gray-50 px-2 py-0.5 text-ink-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" data-summary-version>Version {summaryVersion}</span>
            {/snippet}
          </Tooltip>
        {/if}
      </div>
      {#if onClose}
        <Button variant="secondary" size="sm" class="min-h-9" onclick={onClose}>
          {readOnly ? "Back to report" : "Back to plan"}
        </Button>
      {/if}
      {#if recovery && canRecover}
        <Button size="sm" class="min-h-9" onclick={retryDraft} disabled={busy || !versionId}>Retry from this Summary</Button>
      {:else if canEdit}
        <Button
          data-summary-signoff
          size="sm"
          class="min-h-9"
          onclick={() => { if (!busy) openSignOff(); }}
          disabled={!busy && !canSignOffNow}
          aria-disabled={busy ? "true" : undefined}
          aria-busy={busy ? "true" : undefined}
        >Sign off and generate PD</Button>
      {/if}
    </div>
  </footer>
</section>

{#if signOffDialogMounted}
<SeedSignOffDialog
  bind:open={signOffOpen}
  stepCount={PD_SUBSECTIONS.length}
  editedCount={editedItems.length}
  modelLabel={modelName}
  canConfirm={signOffFenceHolds}
  changedNotice={signOffOpen && !signOffFenceHolds
    ? "The Summary changed while this was open. Keep reviewing to see the current version before you sign off."
    : null}
  onConfirm={confirmSignOff}
  returnFocus={signOffTrigger}
/>
{/if}
