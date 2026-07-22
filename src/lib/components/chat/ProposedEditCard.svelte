<script lang="ts">
  import { onMount } from "svelte";
  import Spinner from "$lib/components/ui/Spinner.svelte";
  import { diffWords, proposedTextChanges } from "$lib/diff";

  interface Props {
    newText?: string;
    targetText?: string;
    replacements?: { find: string; replaceWith: string }[];
    state: "pending" | "applied" | "rejected";
    onReplace: () => Promise<void> | void;
    onReject: () => Promise<void> | void;
    /** Put the suggestion in the shared composer for refinement instead of applying it. */
    onCopyToComposer?: () => Promise<void> | void;
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
    newText,
    targetText,
    replacements,
    state: editState,
    onReplace,
    onReject,
    onCopyToComposer,
    onShowInDoc,
    onReviewOneByOne,
    onPreviewInDoc,
    reviewing,
  }: Props = $props();

  let busy = $state(false);
  let error = $state<string | null>(null);

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
      error =
        e instanceof Error ? e.message : "Something went wrong applying this edit.";
    } finally {
      busy = false;
    }
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

{#if editState === "rejected"}
  <div class="mt-2 flex items-center gap-1.5 py-1 text-xs text-ink-muted">
    <svg class="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
      <path stroke-linecap="round" d="M6 18 18 6M6 6l12 12" />
    </svg>
    <span>Suggested edit rejected</span>
  </div>
{:else}
<div class="card mt-2 overflow-hidden shadow-sm">
  <div class="max-h-72 overflow-y-auto px-4 py-3.5">
    {#if replacements && replacements.length > 0}
      <div class="flex flex-col gap-2">
        <p class="text-label">
          {changes.length} replacement{changes.length === 1 ? "" : "s"} — applied to every occurrence
        </p>
        {#each changes as change, changeIndex (changeIndex)}
          <div class="rounded-lg bg-gray-50 px-3 py-2">
            {#if diffInCard}
              <p
                aria-label={`Replacement ${changeIndex + 1} changes`}
                class="whitespace-pre-wrap font-serif text-sm leading-relaxed text-gray-900"
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
              <p class="whitespace-pre-wrap font-serif text-sm leading-relaxed text-gray-900">
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
        class="whitespace-pre-wrap font-serif text-sm leading-relaxed text-gray-900"
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
      <p class="whitespace-pre-wrap font-serif text-sm leading-relaxed text-gray-900">
        {newText}
      </p>
    {:else}
      <p class="text-sm text-gray-500">Delete the selected passage</p>
    {/if}
  </div>

  {#if changes.length > 0 && !onPreviewInDoc}
    <!-- Card-local diff toggle — only when there's no live report preview
         (e.g. share-link chat); with a preview the toggle lives in the
         actions row instead of "Show in document". -->
    <div class="flex items-center justify-end border-t border-gray-100 px-3 py-1.5">
      {@render changesToggle("Show changes")}
    </div>
  {/if}

  <!-- Actions -->
  <div class="flex items-center gap-2 border-t border-gray-100 bg-gray-50 px-3 py-2.5">
    {#if editState === "pending" && reviewing}
      <span class="inline-flex items-center gap-1.5 text-xs font-medium text-navy">
        <Spinner size="sm" class="h-3 w-3 border-navy/30 border-t-navy" />
        Stepping through in the document…
      </span>
    {:else if editState === "pending"}
      <!-- BNH-30: multi-instance edits — step through (green), bulk (orange),
           or reject (red). -->
      {#if onReviewOneByOne}
        <button
          onclick={onReviewOneByOne}
          disabled={busy}
          class="inline-flex items-center gap-1 rounded-lg bg-green-500 px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-green-600 disabled:opacity-50"
        >
          Replace One By One
        </button>
        <button
          onclick={() => handle(onReplace)}
          disabled={busy}
          class="rounded-lg bg-orange-500 px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-orange-600 disabled:opacity-50"
        >
          {busy ? "Replacing…" : "Replace All"}
        </button>
        <button
          onclick={() => handle(onReject)}
          disabled={busy}
          class="rounded-lg bg-red-500 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-red-600 disabled:opacity-50"
        >
          Reject
        </button>
      {:else}
        <button
          onclick={() => handle(onReplace)}
          disabled={busy}
          class="rounded-lg bg-primary px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-primary-dark disabled:opacity-50"
        >
          {busy ? "Replacing…" : "Replace"}
        </button>
        {#if onCopyToComposer}
          <button
            onclick={() => handle(onCopyToComposer)}
            disabled={busy}
            class="rounded-lg px-3 py-1.5 text-xs font-medium text-navy transition-colors hover:bg-primary-wash disabled:opacity-50"
          >
            Add to chat
          </button>
        {/if}
        <button
          onclick={() => handle(onReject)}
          disabled={busy}
          class="rounded-lg px-3 py-1.5 text-xs font-medium text-gray-500 transition-colors hover:bg-primary-wash hover:text-gray-700 disabled:opacity-50"
        >
          Reject
        </button>
      {/if}
    {:else if editState === "applied"}
      <span class="inline-flex items-center gap-1 text-xs font-medium text-green-600">
        <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
        </svg>
        Replaced in report
      </span>
    {:else}
      <span class="text-xs text-gray-400">Rejected</span>
    {/if}

    {#if onPreviewInDoc && changes.length > 0}
      <span class="ml-auto">
        {@render changesToggle("Show changes")}
      </span>
    {:else if onShowInDoc}
      <button
        onclick={onShowInDoc}
        title="Scroll to and highlight this in the document"
        class="ml-auto inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-gray-400 transition-colors hover:bg-primary-wash hover:text-navy"
      >
        <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
        Show in document
      </button>
    {/if}
  </div>

  {#if error}
    <p class="border-t border-red-100 bg-red-50 px-3 py-2 text-xs text-red-600">
      {error}
    </p>
  {/if}
</div>
{/if}
