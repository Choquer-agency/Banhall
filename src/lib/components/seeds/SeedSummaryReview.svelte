<script lang="ts">
  import { onDestroy, onMount, tick, untrack } from "svelte";
  import { useConvexClient, useMutation, useQuery } from "convex-svelte";
  import { api } from "../../../../convex/_generated/api";
  import type { Id } from "../../../../convex/_generated/dataModel";
  import { isLongForSeed, MAX_EDITED_BULLET_CHARS } from "../../../../convex/lib/seedContract";
  import { PD_SUBSECTIONS, SEED_TAG_DISPLAY_LABELS } from "../../../../shared/pdSubsections";
  import { SINGLE_MODEL_ITEMS } from "../../../../shared/generationModels";
  import { userErrorCode, userErrorMessage } from "$lib/errors";
  import Button from "$lib/components/ui/Button.svelte";
  import Spinner from "$lib/components/ui/Spinner.svelte";
  import type { SeedSummaryItem, SeedSummaryPage } from "./types";
  import { seedsApi } from "./api";
  import { SEED_SUMMARY_HEADING_ID } from "./summaryFocus";

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

  let view = $state<LoadedSummary | null>(null);
  let loading = $state(false);
  let loadError = $state<string | null>(null);
  let actionError = $state<string | null>(null);
  let retryingLoad = $state(false);
  let retryingOutline = $state(false);
  let busy = $state(false);
  let savingSeedIds = $state<string[]>([]);
  let editingSeedId = $state<string | null>(null);
  // The stage version the open edit began against, mirrored from its draft.
  let editingBase = $state<number | null>(null);
  let bulletOne = $state("");
  let bulletTwo = $state("");
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

  function tagLabel(tag: string) {
    switch (tag) {
      case "conservative":
      case "aggressive":
      case "high_level":
      case "detailed":
      case "technical":
      case "alternative_angle":
        return SEED_TAG_DISPLAY_LABELS[tag];
      default:
        return tag;
    }
  }

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

  /** One item's stored draft, read on its own key. */
  function readStoredDraftItem(store: DraftStore, seedId: string): SummaryDraft | null {
    try {
      return parseStoredDraft(localStorage.getItem(draftItemKey(store, seedId)), store);
    } catch {
      persistence = "unavailable";
      return null;
    }
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
  function modelLabel(modelId: string | null) {
    return SINGLE_MODEL_ITEMS.find((item) => item.value === (modelId ?? ""))?.label ?? modelId ?? "";
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
    editingBase = draft.baseSeedStageVersion;
    editingSeedId = item.seedId;
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
        const stored = readStoredDraftItem(store, owner.seedId) ?? undefined;
        if (sameDraft(stored, submitted)) persistDraftItem(store, owner.seedId, null);
        return;
      }
      // Clear only this Seed's unchanged submitted wording; another Seed's
      // draft and text typed during the save stay in memory and storage.
      if (sameDraft(drafts[owner.seedId], submitted)) {
        delete drafts[owner.seedId];
        persistDraftItem(store, owner.seedId, null);
        closeEditor(owner.seedId);
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

  async function signOffSummary() {
    const reviewed = shownView;
    if (!mutationsAvailable || !reviewedCurrentVersion || !reviewed || busy) return;
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
        expectedSeedStageVersion: reviewed.seedStageVersion,
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

<section class="flex h-full min-h-0 flex-col bg-canvas" aria-labelledby={SEED_SUMMARY_HEADING_ID}>
  <header class="shrink-0 border-b border-line bg-surface px-5 py-4 sm:px-8">
    <div class="mx-auto flex max-w-[var(--container-shell)] flex-wrap items-center gap-3">
      <div class="min-w-0 flex-1">
        <p class="text-label text-ink-muted">{readOnly ? "Signed-off plan" : "Final review"}</p>
        <h1
          id={SEED_SUMMARY_HEADING_ID}
          bind:this={headingEl}
          tabindex="-1"
          class="rounded-md text-heading focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
        >Summary Review</h1>
      </div>
      {#if onClose}
        <Button variant="ghost" size="sm" onclick={onClose}>
          {readOnly ? "Back to report" : "Back to workspace"}
        </Button>
      {/if}
    </div>
  </header>

  <div class="min-h-0 flex-1 overflow-y-auto">
    <div class="mx-auto max-w-[var(--container-shell)] px-5 py-6 sm:px-8">

      <div class="min-w-0">
        {#if outlineError}
          <!-- Separate from the Summary-page and revision states below: the
               pages on screen stay complete; only live readiness and
               capability are unknown until this subscription is back. -->
          <div class="mb-4 rounded-lg border border-line bg-surface px-3 py-3" role="alert" data-summary-outline-error>
            <p class="text-body text-gap-text!">The live plan status could not be loaded. {userErrorMessage(outlineError, "The server could not return the current readiness.")}</p>
            <p class="mt-1 text-data text-ink-muted">Edits and sign-off stay unavailable until it reloads. Your unsaved wording is kept.</p>
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
            <p class="mt-1 text-data text-ink-muted">Sign-off stays unavailable until the complete Summary loads. {persistence === "ok" ? "Unsaved edits are kept on this device." : "Unsaved edits stay in this open review."}</p>
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
              <p class="mt-1 text-data text-ink-muted">Sign-off stays unavailable until the live Summary reloads. Your unsaved wording is kept.</p>
              <Button class="mt-2" variant="secondary" size="sm" onclick={retryLoad} disabled={retryingLoad || loading}>Reload complete Summary</Button>
            </div>
          {/if}
          {#each sections as section}
            <section id={`summary-${section}`} class="scroll-mt-4 pb-8" aria-labelledby={`summary-heading-${section}`}>
              <h2 id={`summary-heading-${section}`} class="sticky top-0 z-10 border-b border-line bg-canvas/95 py-3 text-title backdrop-blur">
                Section {section.slice(1)}
              </h2>
              {#each PD_SUBSECTIONS.filter((definition) => definition.section === section) as definition}
                {@const roleItems = shownView.items.filter((item) => item.roleId === definition.roleId)}
                {@const skipped = shownView.skippedRoleIds.includes(definition.roleId)}
                <article id={`summary-${definition.roleId}`} class="scroll-mt-16 border-b border-line-soft py-5">
                  <div class="flex flex-wrap items-center gap-2">
                    <h3 class="text-title">{definition.title}</h3>
                    {#if skipped}
                      <span class="rounded-full bg-gray-100 px-2 py-0.5 text-label text-gray-700!">Skipped</span>
                    {/if}
                  </div>
                  {#if roleItems.length === 0 && !skipped}
                    {#if shownView.complete}
                      <p class="mt-2 text-body text-ink-muted" data-summary-role-empty={definition.roleId}>No selected items.</p>
                    {:else}
                      <!-- A role absent from an incomplete aggregate is unknown,
                           not empty (A4): its items may be on unread pages. -->
                      <p class="mt-2 text-body text-gap-text!" data-summary-role-unknown={definition.roleId}>
                        Selected items may be on pages that did not load. Reload the complete Summary to review them.
                      </p>
                    {/if}
                  {/if}
                  <div class="mt-3 space-y-3">
                    {#each roleItems as item (item.seedId)}
                      <div class="rounded-xl border border-line bg-surface p-4">
                        {#if editingSeedId === item.seedId && canEdit}
                          <div class="space-y-2">
                            <textarea bind:value={bulletOne} oninput={(event) => { bulletOne = event.currentTarget.value; persistEditDraft(); }} rows="2" maxlength={MAX_EDITED_BULLET_CHARS} aria-label="Bullet 1" class="field-control min-h-11 w-full resize-y rounded-lg px-3 py-2 text-body"></textarea>
                            <textarea bind:value={bulletTwo} oninput={(event) => { bulletTwo = event.currentTarget.value; persistEditDraft(); }} rows="2" maxlength={MAX_EDITED_BULLET_CHARS} aria-label="Bullet 2, optional" class="field-control min-h-11 w-full resize-y rounded-lg px-3 py-2 text-body"></textarea>
                            {#if editingStale}
                              <div class="rounded-lg bg-gap-bg px-3 py-2 text-body text-gap-text!" role="status">
                                <p>This wording began against an older decision version. Review the current wording before saving it.</p>
                                {#if reviewedCurrentVersion}
                                  <p class="mt-1 text-data">Current wording: {item.bullets.join(" ")}</p>
                                {:else}
                                  <p class="mt-1 text-data">The current wording is still loading. Your draft stays as typed until it is displayed.</p>
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
                            <div class="flex gap-2">
                              <Button
                                size="sm"
                                onclick={() => saveEdit(item)}
                                disabled={savingSeedIds.includes(item.seedId) || !bulletOne.trim() || editingStale || !mutationsAvailable}
                              >{savingSeedIds.includes(item.seedId) ? "Saving…" : "Save wording"}</Button>
                              <Button size="sm" variant="ghost" onclick={() => discardEditDraft(item.seedId)}>Cancel</Button>
                              {#if editLong}
                                <p class="ml-auto self-center text-data text-gap-text!" aria-live="polite" data-seed-long-note>Long for a seed</p>
                              {/if}
                            </div>
                          </div>
                        {:else}
                          <ul class="space-y-1 pl-5 text-body">
                            {#each item.bullets as bullet}<li class="list-disc">{bullet}</li>{/each}
                          </ul>
                          <div class="mt-3 flex flex-wrap items-center gap-1.5">
                            <span class="rounded-full bg-chrome px-2 py-0.5 text-label text-ink-secondary!">
                              {item.support === "writer_asserted" ? "Writer asserted" : "Source supported"}
                            </span>
                            {#each item.tags as tag}
                              <span class="rounded-full bg-gray-100 px-2 py-0.5 text-data text-gray-700!">{tagLabel(tag)}</span>
                            {/each}
                            {#if canEdit}
                              <Button
                                class="ml-auto"
                                size="sm"
                                variant="ghost"
                                onclick={() => startEdit(item)}
                                disabled={!mutationsAvailable || !reviewedCurrentVersion}
                              >Edit</Button>
                            {/if}
                          </div>
                        {/if}
                      </div>
                    {/each}
                  </div>
                </article>
              {/each}
            </section>
          {/each}
        {/if}
      </div>
    </div>
  </div>

  <footer class="shrink-0 border-t border-line bg-surface px-5 py-3 sm:px-8">
    <div class="mx-auto flex max-w-[var(--container-shell)] flex-wrap items-center gap-3">
      <div class="min-w-0 flex-1 text-data text-ink-muted">
        <!-- Only the model, plus the Summary version once it has been
             regenerated (PRD FR-21). Length target and Writer Profile stay
             frozen and recorded at sign-off but are not shown here. -->
        <span data-summary-model>{settings ? modelLabel(settings.modelId) : "Loading model"}</span>
        {#if summaryVersion !== null && summaryVersion > 1}
          <span class="ml-2 rounded-full border border-line bg-gray-50 px-2 py-0.5 text-data text-ink-secondary!" data-summary-version>Version {summaryVersion}</span>
        {/if}
      </div>
      {#if actionError}<p role="alert" class="w-full text-body text-gap-text!">{actionError}</p>{/if}
      {#if recovery && canRecover}
        <Button onclick={retryDraft} disabled={busy || !versionId}>Retry from this Summary</Button>
      {:else if canEdit}
        <Button onclick={signOffSummary} disabled={busy || !mutationsAvailable || !reviewedCurrentVersion || !(readiness?.ready ?? false)}>
          Sign off and generate
        </Button>
      {/if}
      {#if !readOnly && readiness && !readiness.ready}
        {#if readinessIncomplete}
          <!-- The server could not read the complete decision set within its
               safe processing limit, so whether the plan is ready is unknown:
               an empty blocker list explains nothing. Sign-off stays off and
               the explicit recovery re-reads the plan status. -->
          <div class="w-full" role="status" data-summary-readiness="incomplete">
            <p class="text-body text-gap-text!">
              Readiness could not be fully computed within the server's safe processing limit, so it is not known whether every subsection is decided. Sign-off stays unavailable until the plan status is read completely.
            </p>
            {#each incompleteReadinessMessages as message}
              <p class="mt-1 text-data text-ink-muted">{message}</p>
            {/each}
            <Button class="mt-2 min-h-11" variant="secondary" size="sm" onclick={retryOutline} disabled={retryingOutline}>
              {retryingOutline ? "Reloading…" : "Reload plan status"}
            </Button>
          </div>
        {:else}
          <p class="w-full text-body text-gap-text!" data-summary-readiness="blocked">
            Blocked by: {readiness.blockingRoleIds.join(", ")}.
          </p>
        {/if}
      {/if}
    </div>
  </footer>
</section>
