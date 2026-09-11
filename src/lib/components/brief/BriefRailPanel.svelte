<script lang="ts">
  import { useMutation, useQuery } from "convex-svelte";
  import { api } from "../../../../convex/_generated/api";
  import type { Id } from "../../../../convex/_generated/dataModel";
  import { userErrorCode, userErrorMessage } from "$lib/errors";
  import BriefRail from "./BriefRail.svelte";
  import type { BriefEntryLike } from "$lib/brief";

  /**
   * Story 4: the Brief container — the three reads, the one writer
   * (`briefs.saveEntryEdit`, always with the version fence), and the offer's
   * per-project dismissal. In `rail` mode it wears the QA rail's card chrome;
   * in `inline` mode it sits under the generation progress card. It renders
   * nothing until at least one of the three reads has something to show.
   */
  let {
    generationId,
    projectId,
    mode = "inline",
    open = true,
    hidden = false,
    onClose = undefined,
    onRegenerate = undefined,
  }: {
    generationId: Id<"generations">;
    projectId: Id<"projects">;
    /** `rail`: the right-rail card. `inline`: under the generation progress. */
    mode?: "rail" | "inline";
    open?: boolean;
    /** display:none while another panel owns the rail (instant swap). */
    hidden?: boolean;
    onClose?: (() => void) | undefined;
    onRegenerate?: (() => void) | undefined;
  } = $props();

  const STALE_MESSAGE = "The Brief changed while you were editing. Your edit was not saved.";

  const briefQ = useQuery(api.briefs.getBrief, () => ({ generationId }));
  const inclusionQ = useQuery(api.generations.getContextInclusion, () => ({ generationId }));
  const writerQ = useQuery(api.writerProfiles.getGenerationWriterSettings, () => ({ generationId }));
  const saveEntryEdit = useMutation(api.briefs.saveEntryEdit);

  let saveError = $state<string | null>(null);
  let offerDismissed = $state(false);
  // The Brief version an open edit is based on. `briefQ.data` is a live
  // subscription: without pinning, a concurrent edit landing while a field is
  // open would silently update `current` before this writer saves, so the
  // BRIEF_STALE fence would never see the version the writer actually edited
  // against. Pinned when a field opens (BriefRail's onBeginEdit); cleared
  // once that edit resolves.
  let pinnedBrief: NonNullable<typeof briefQ.data> | null = $state(null);
  function beginEdit() {
    pinnedBrief = briefQ.data ?? null;
  }

  const dismissKey = $derived(`banhall_brief_offer_dismissed:${projectId}`);
  $effect(() => {
    const key = dismissKey;
    try {
      offerDismissed = localStorage.getItem(key) === "1";
    } catch {
      offerDismissed = false;
    }
  });
  function dismissOffer() {
    offerDismissed = true;
    try {
      localStorage.setItem(dismissKey, "1");
    } catch {
      // A browser that refuses storage still hides the banner for this view.
    }
  }

  const brief = $derived(briefQ.data);
  const inclusion = $derived(inclusionQ.data);
  const writerSettings = $derived(writerQ.data);
  // A legacy generation recorded no budget outcome: the Brief is absent,
  // not empty. Rows synthesized for unfrozen documents never count.
  const available = $derived(!!brief || !!writerSettings || inclusion?.recorded === true);

  // A newer version replaces whatever a failed save was complaining about.
  let lastVersion: number | null = null;
  $effect(() => {
    const version = briefQ.data?.version ?? null;
    if (lastVersion !== null && version !== lastVersion) saveError = null;
    lastVersion = version;
  });

  type EditArgs = {
    entryId?: Id<"generationBriefEntries">;
    editedText?: string;
    editedStorylineText?: string;
    resolvedBy?: "use_evidence" | "keep_storyline";
  };

  async function save(args: EditArgs): Promise<boolean> {
    // The version pinned when this edit began, not whatever the live query
    // holds now — a concurrent edit landing mid-edit must still surface
    // BRIEF_STALE instead of silently saving against the newer version.
    const current = pinnedBrief ?? briefQ.data;
    if (!current) return false;
    try {
      await saveEntryEdit({
        projectId,
        briefId: current._id,
        expectedBriefVersion: current.version,
        ...args,
      });
      saveError = null;
      pinnedBrief = null;
      return true;
    } catch (error) {
      saveError =
        userErrorCode(error) === "BRIEF_STALE"
          ? STALE_MESSAGE
          : userErrorMessage(error, "Your edit was not saved.");
      return false;
    }
  }

  function saveEntry(entry: BriefEntryLike, text: string) {
    return save({ entryId: entry._id as Id<"generationBriefEntries">, editedText: text });
  }
  function saveStoryline(text: string) {
    return save({ editedStorylineText: text });
  }
  function resolveQuestion(entry: BriefEntryLike, resolvedBy: "use_evidence" | "keep_storyline") {
    void save({ entryId: entry._id as Id<"generationBriefEntries">, resolvedBy });
  }
</script>

{#snippet rail(showHeading: boolean)}
  <BriefRail
    {brief}
    {inclusion}
    {writerSettings}
    {generationId}
    canEdit={brief?.canEdit ?? false}
    {offerDismissed}
    onSaveEntry={saveEntry}
    onSaveStoryline={saveStoryline}
    onResolveQuestion={resolveQuestion}
    onDismissOffer={dismissOffer}
    onCancelEdit={() => (saveError = null)}
    onBeginEdit={beginEdit}
    {onRegenerate}
    {saveError}
    {showHeading}
  />
{/snippet}

{#if available}
  {#if mode === "rail"}
    <div
      class={`chat-rise relative flex h-full origin-bottom flex-col overflow-hidden rounded-2xl border border-chrome bg-white ${open ? "" : "is-closed"} ${hidden ? "hidden" : ""}`}
      inert={!open}
    >
      <div class="flex shrink-0 items-center gap-2 border-b border-chrome px-5 py-1.5">
        <h2 class="text-title">Brief</h2>
        {#if onClose}
          <button
            type="button"
            onclick={onClose}
            aria-label="Close Brief"
            class="ml-auto flex h-11 w-11 items-center justify-center rounded-md text-ink-faint transition-colors hover:text-navy focus-visible:outline focus-visible:outline-2 focus-visible:outline-navy motion-reduce:transition-none"
          >
            <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        {/if}
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto">
        {@render rail(false)}
      </div>
    </div>
  {:else}
    <div class="card overflow-hidden">
      {@render rail(true)}
    </div>
  {/if}
{/if}
