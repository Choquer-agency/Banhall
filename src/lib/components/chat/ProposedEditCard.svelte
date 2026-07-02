<script lang="ts">
  import Spinner from "$lib/components/ui/Spinner.svelte";

  interface Props {
    newText?: string;
    replacements?: { find: string; replaceWith: string }[];
    state: "pending" | "applied" | "rejected";
    onReplace: () => Promise<void> | void;
    onReject: () => Promise<void> | void;
    onShowInDoc?: () => void;
    onReviewOneByOne?: () => void;
    reviewing?: boolean;
  }

  // NB: the prop is named `state` (exact React contract); alias it locally so
  // the identifier doesn't shadow the `$state` rune.
  let {
    newText,
    replacements,
    state: editState,
    onReplace,
    onReject,
    onShowInDoc,
    onReviewOneByOne,
    reviewing,
  }: Props = $props();

  let busy = $state(false);
  let error = $state<string | null>(null);

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

<div class="card mt-2 overflow-hidden shadow-sm">
  <!-- The proposed change: a multi-instance find/replace list, or the new text -->
  <div class="max-h-72 overflow-y-auto px-4 py-3.5">
    {#if replacements && replacements.length > 0}
      <div class="flex flex-col gap-2">
        <p class="text-label">
          {replacements.length} replacement{replacements.length === 1 ? "" : "s"} — applied to every occurrence
        </p>
        {#each replacements as r, i (i)}
          <div class="flex items-center gap-2 text-[14px]">
            <span class="rounded bg-red-50 px-1.5 py-0.5 font-serif text-red-700 line-through decoration-red-300">
              {r.find}
            </span>
            <svg class="h-3.5 w-3.5 flex-shrink-0 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
            </svg>
            <span class="rounded bg-green-50 px-1.5 py-0.5 font-serif text-green-700">
              {r.replaceWith}
            </span>
          </div>
        {/each}
      </div>
    {:else}
      <p class="whitespace-pre-wrap font-serif text-[15px] leading-relaxed text-gray-900">
        {newText}
      </p>
    {/if}
  </div>

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

    {#if onShowInDoc}
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
