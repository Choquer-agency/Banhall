<script lang="ts">
  import { onMount } from "svelte";
  import Spinner from "$lib/components/ui/Spinner.svelte";
  import { ActionButton } from "$lib/components/chat/primitives";
  import { DropdownMenu } from "bits-ui";
  import { diffWords, proposedTextChanges } from "$lib/diff";
  import { userErrorMessage } from "$lib/errors";

  interface Props {
    /** Report Section the edit targets ("242"), for "Suggested edit for 242". */
    section?: string | null;
    newText?: string;
    targetText?: string;
    replacements?: { find: string; replaceWith: string }[];
    state: "pending" | "applied" | "rejected" | "stale";
    onReplace: () => Promise<void> | void;
    onReject: () => Promise<void> | void;
    /** Save writer-authored wording while preserving canonical report targets. */
    onEditWording?: (wording: string[]) => Promise<void> | void;
    /** Continue discussing this suggestion in the shared composer. */
    onRefine?: () => Promise<void> | void;
    onShowInDoc?: () => void;
    onReviewOneByOne?: () => void;
    /** Live preview: called with `true` when "Show changes" toggles on so the
     * page can highlight the affected passages in the real editor, `false`
     * when toggled off (clear highlights). */
    onPreviewInDoc?: (on: boolean) => void;
    reviewing?: boolean;
  }

  // Alias the prop so it does not shadow the `$state` rune.
  let {
    section = null,
    newText,
    targetText,
    replacements,
    state: editState,
    onReplace,
    onReject,
    onEditWording,
    onRefine,
    onShowInDoc,
    onReviewOneByOne,
    onPreviewInDoc,
    reviewing,
  }: Props = $props();

  let busy = $state(false);
  let error = $state<string | null>(null);
  let editing = $state(false);
  let editedWording = $state<string[]>([]);

  // Session-local by design: remounting a proposal always returns to neutral.
  let showChanges = $state(false);

  // Preview is OPT-IN (Jul 20): the old auto-enable re-fired on every mount —
  // reopening the project re-lit the diff and scrolled the editor to the
  // section even after the writer toggled it off. Now only the toggle click
  // starts a preview; unmounting still clears any active one.
  onMount(() => {
    return () => {
      if (showChanges) onPreviewInDoc?.(false);
    };
  });
  // Applied/rejected → the diff no longer reflects the document; drop it.
  $effect(() => {
    if (editState !== "pending" && showChanges) {
      showChanges = false;
      onPreviewInDoc?.(false);
    }
  });
  const changes = $derived(
    proposedTextChanges(targetText, newText, replacements)
  );
  // When the preview renders in the real document (onPreviewInDoc), the card
  // never shows its own inline diff — the report is the diff view.
  const diffInCard = $derived(showChanges && !onPreviewInDoc);
  const diffGroups = $derived(
    diffInCard
      ? changes.map(({ before, after }) => diffWords(before, after))
      : []
  );

  async function handle(action: () => Promise<void> | void) {
    busy = true;
    error = null;
    try {
      await action();
    } catch (e) {
      error = userErrorMessage(e, "Something went wrong applying this edit.");
    } finally {
      busy = false;
    }
  }

  function startEditing() {
    editedWording = changes.map((change) => change.after);
    editing = true;
    error = null;
  }

  function cancelEditing() {
    editing = false;
    editedWording = [];
  }

  async function saveWording() {
    if (!onEditWording) return;
    await handle(async () => {
      await onEditWording(editedWording);
      editing = false;
      editedWording = [];
    });
  }
</script>

{#snippet changesToggle(label: string)}
  <button
    type="button"
    role="switch"
    aria-checked={showChanges}
    onclick={() => {
      showChanges = !showChanges;
      onPreviewInDoc?.(showChanges);
    }}
    class={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
      showChanges ? "bg-primary-wash text-navy" : "text-gray-400 hover:text-gray-600"
    }`}
  >
    <span
      class={`relative inline-flex h-3.5 w-6 flex-none items-center rounded-full transition-colors ${
        showChanges ? "bg-primary" : "bg-gray-300"
      }`}
    >
      <span
        class={`inline-block h-2.5 w-2.5 transform rounded-full bg-white transition-transform ${
          showChanges ? "translate-x-3" : "translate-x-0.5"
        }`}
      ></span>
    </span>
    {label}
  </button>
{/snippet}

{#if editState !== "pending"}
  <div class={`mt-2 flex items-center gap-1.5 py-1 text-xs ${editState === "stale" ? "text-amber-700" : editState === "applied" ? "text-green-600" : "text-ink-muted"}`}>
    {#if editState === "stale"}
      <svg class="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v4m0 4h.01M10.3 3.8 2.6 17.2A2 2 0 0 0 4.3 20h15.4a2 2 0 0 0 1.7-2.8L13.7 3.8a2 2 0 0 0-3.4 0Z" />
      </svg>
      <span>Suggestion no longer matches the report</span>
      {#if onRefine}
        <ActionButton
          variant="ghost"
          class="ml-1 min-h-7 px-2 py-0.5"
          onclick={() => handle(onRefine)}
          disabled={busy}
        >
          Refine
        </ActionButton>
      {/if}
    {:else if editState === "applied"}
      <svg class="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
      </svg>
      <span>Replaced in report</span>
    {:else}
      <svg class="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <path stroke-linecap="round" d="M6 18 18 6M6 6l12 12" />
      </svg>
      <span>Suggested edit rejected</span>
    {/if}
  </div>
{:else}
<!-- Board 2.1 suggested-edit card: a quiet label, the serif wording, then
     Apply (primary) and Dismiss (quiet). Edit wording and Refine live in the
     card's More menu. -->
<div class="mt-2 flex flex-col rounded-[10px] bg-gray-50 px-4 py-3.5" data-proposed-edit>
  <p class="text-[11px] leading-4 text-ink-muted" data-proposed-edit-label>
    {editing
      ? "Edit suggestion"
      : replacements && replacements.length > 0
        ? `${changes.length} suggested replacement${changes.length === 1 ? "" : "s"}${section ? ` in ${section}` : ""}`
        : section
          ? `Suggested edit for ${section}`
          : "Suggested edit"}
  </p>

  <div class="max-h-72 overflow-y-auto pt-1.5">
    {#if editing}
      <div class="flex flex-col gap-3">
        {#each editedWording as wording, index (index)}
          <label class="block">
            {#if editedWording.length > 1}
              <span class="text-label mb-1.5 block">Replacement {index + 1}</span>
            {/if}
            <textarea
              value={wording}
              oninput={(event) => {
                editedWording[index] = event.currentTarget.value;
              }}
              aria-label={`Edit replacement wording ${index + 1}`}
              rows={Math.min(7, Math.max(3, wording.split("\n").length + 1))}
              class="field-control w-full resize-y rounded-md px-2.5 py-2 font-serif text-sm leading-relaxed text-ink"
            ></textarea>
          </label>
        {/each}
      </div>
    {:else}
    <div>
    {#if replacements && replacements.length > 0}
      <div class="flex flex-col gap-2">
        <p class="text-[11px] leading-4 text-ink-muted">
          {changes.length} replacement{changes.length === 1 ? "" : "s"}, applied to every occurrence
        </p>
        {#each changes as change, changeIndex (changeIndex)}
          <div class="border-l-2 border-primary/20 pl-2.5">
            {#if diffInCard}
              <p
                aria-label={`Replacement ${changeIndex + 1} changes`}
                class="whitespace-pre-wrap font-serif text-sm leading-[22px] text-ink"
              >
                {#each diffGroups[changeIndex] ?? [] as part, partIndex (partIndex)}
                  {#if part.type === "removed"}
                    <span class="rounded-sm bg-red-50 text-red-700 line-through decoration-red-300">{part.text}</span>
                  {:else if part.type === "added"}
                    <span class="rounded-sm bg-green-50 text-green-700">{part.text}</span>
                  {:else}
                    {part.text}
                  {/if}
                {/each}
              </p>
            {:else if change.after}
              <p class="whitespace-pre-wrap font-serif text-sm leading-[22px] text-ink">
                {change.after}
              </p>
            {:else}
              <p class="text-sm text-gray-500">Delete the matched text</p>
            {/if}
          </div>
        {/each}
      </div>
    {:else if diffInCard && changes.length === 1}
      <p
        aria-label="Proposed changes"
        class="whitespace-pre-wrap font-serif text-sm leading-[22px] text-ink"
      >
        {#each diffGroups[0] ?? [] as part, i (i)}
          {#if part.type === "removed"}
            <span class="rounded-sm bg-red-50 text-red-700 line-through decoration-red-300">{part.text}</span>
          {:else if part.type === "added"}
            <span class="rounded-sm bg-green-50 text-green-700">{part.text}</span>
          {:else}
            {part.text}
          {/if}
        {/each}
      </p>
    {:else if newText}
      <p class="whitespace-pre-wrap font-serif text-sm leading-[22px] text-ink">
        {newText}
      </p>
    {:else}
      <p class="text-sm text-gray-500">Delete the selected passage</p>
    {/if}
    </div>
    {/if}
  </div>

  {#if editing}
    <div class="flex items-center gap-3.5 pt-3">
      <ActionButton
        variant="primary"
        class="min-h-0 rounded-md px-3 py-1.5 leading-[18px]"
        onclick={saveWording}
        disabled={busy}
        loading={busy}
        loadingLabel="Applying…"
      >
        Save & apply
      </ActionButton>
      <button type="button" class="text-xs leading-[18px] text-ink-secondary transition-colors hover:text-ink disabled:opacity-50" onclick={cancelEditing} disabled={busy}>Cancel</button>
    </div>
  {:else if changes.length > 0 && !onPreviewInDoc}
    <!-- Card-local diff toggle — only when there's no live report preview
         (e.g. share-link chat); with a preview the toggle lives in the
         actions row instead of "Show in document". -->
    <div class="flex items-center justify-end pt-2">
      {@render changesToggle("Show changes")}
    </div>
  {/if}

  <!-- Actions -->
  {#if !editing}
  <div class="flex flex-wrap items-center gap-x-3.5 gap-y-2 pt-3">
    {#if editState === "pending" && reviewing}
      <span class="inline-flex items-center gap-1.5 text-xs font-medium text-navy">
        <Spinner size="sm" class="h-3 w-3 border-navy/30 border-t-navy" />
        Stepping through in the document…
      </span>
    {:else if editState === "pending"}
      <ActionButton
        variant="primary"
        class="min-h-0 rounded-md px-3 py-1.5 leading-[18px]"
        onclick={() => handle(onReplace)}
        disabled={busy}
        loading={busy}
        loadingLabel="Applying…"
      >
        {onReviewOneByOne ? "Apply all" : "Apply"}
      </ActionButton>
      {#if onReviewOneByOne}
        <button type="button" class="text-xs leading-[18px] text-ink-secondary transition-colors hover:text-ink disabled:opacity-50" onclick={onReviewOneByOne} disabled={busy}>
          Review individually
        </button>
      {/if}
      <button type="button" class="text-xs leading-[18px] text-ink-secondary transition-colors hover:text-ink disabled:opacity-50" onclick={() => handle(onReject)} disabled={busy}>
        Dismiss
      </button>
    {/if}

    <span class="ml-auto flex items-center gap-1">
      {#if onPreviewInDoc && changes.length > 0}
        {@render changesToggle("Show changes")}
      {:else if onShowInDoc}
        <ActionButton variant="ghost" onclick={onShowInDoc} class="min-h-7 px-2">
          <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          Show in document
        </ActionButton>
      {/if}
      {#if editState === "pending" && !reviewing && (onEditWording || onRefine)}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger
            aria-label="More actions for this suggestion"
            title="More actions"
            disabled={busy}
            class="flex size-7 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-chrome/60 hover:text-ink data-[state=open]:bg-chrome/60 disabled:opacity-50 motion-reduce:transition-none"
          >
            <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <circle cx="5" cy="12" r="1.75" /><circle cx="12" cy="12" r="1.75" /><circle cx="19" cy="12" r="1.75" />
            </svg>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content side="bottom" align="end" sideOffset={6} class="z-[100] w-44 rounded-xl border border-line bg-white p-1 shadow-lg">
              {#if onEditWording}
                <DropdownMenu.Item onSelect={startEditing} class="flex min-h-8 w-full items-center rounded-md px-2 text-[13px] text-ink outline-none hover:bg-primary-wash focus:bg-primary-wash">
                  Edit wording
                </DropdownMenu.Item>
              {/if}
              {#if onRefine}
                {@const refine = onRefine}
                <DropdownMenu.Item onSelect={() => handle(refine)} class="flex min-h-8 w-full items-center rounded-md px-2 text-[13px] text-ink outline-none hover:bg-primary-wash focus:bg-primary-wash">
                  Refine with AI
                </DropdownMenu.Item>
              {/if}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      {/if}
    </span>
  </div>
  {/if}

  {#if error}
    <p class="mt-2.5 rounded-md bg-red-50 px-2.5 py-2 text-xs text-red-600" role="alert">
      {error}
    </p>
  {/if}
</div>
{/if}
