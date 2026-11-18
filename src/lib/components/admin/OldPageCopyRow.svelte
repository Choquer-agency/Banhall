<script lang="ts">
  import { useMutation } from "convex-svelte";
  import { api } from "../../../../convex/_generated/api";
  import type { Id } from "../../../../convex/_generated/dataModel";

  /** Why the old-page send back left this copy in the Brain, in plain words. */
  const WHY: Record<string, string> = {
    no_approval_time: "Origin unknown: the file has no approval time",
    creator_or_time_differs: "Origin unknown: made by someone else or at another time",
    names_another_file: "Names another Import file as its own",
    not_an_import_copy: "Not a PD copy",
    made_before_this_approval: "Made before the file was approved",
    shared_with_import_file: "Shared with a file approved on Import",
  };

  type Copy = {
    _id: Id<"brainOldPageCopies">;
    sourceId: Id<"brainSources">;
    outcome: "unknown_origin" | "unlink_only";
    detail: string;
    title: string | null;
    docType: string | null;
    status: string | null;
    createdAt: number | null;
  };

  let { copy }: { copy: Copy } = $props();

  const keep = useMutation(api.brain.keepOldPageCopy);
  const revoke = useMutation(api.brain.revokeSource);

  let confirming = $state(false);
  let busy = $state(false);
  let error = $state<string | null>(null);

  async function act(fn: () => Promise<unknown>) {
    busy = true;
    error = null;
    try {
      await fn();
    } catch (err) {
      error = err instanceof Error ? err.message : "That did not work. Try again.";
    } finally {
      busy = false;
      confirming = false;
    }
  }
</script>

<div class="flex flex-wrap items-center gap-3 border-b border-gray-50 px-4 py-3 last:border-0" data-old-page-copy={copy.sourceId}>
  <div class="min-w-0 flex-1">
    <p class="truncate text-sm font-medium text-gray-800">{copy.title ?? "Copy not found"}</p>
    <p class="mt-0.5 text-xs text-gray-500">
      {WHY[copy.detail] ?? (copy.outcome === "unknown_origin" ? "Origin unknown" : "Left in the Brain")}{copy.createdAt
        ? ` · made ${new Date(copy.createdAt).toLocaleDateString()}`
        : ""}
    </p>
    {#if error}
      <p class="mt-1 text-xs text-red-600" role="alert">{error}</p>
    {/if}
  </div>
  {#if confirming}
    <span class="flex items-center gap-2">
      <span class="text-sm text-gray-600">Remove this copy? It is erased from search.</span>
      <button
        type="button"
        disabled={busy}
        onclick={() => act(() => revoke({ sourceId: copy.sourceId, reason: "Old page copy removed after review" }))}
        class="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
      >
        Yes, remove
      </button>
      <button type="button" onclick={() => (confirming = false)} class="text-sm text-gray-500 hover:text-gray-700">
        Cancel
      </button>
    </span>
  {:else}
    <button
      type="button"
      disabled={busy}
      onclick={() => act(() => keep({ sourceId: copy.sourceId }))}
      class="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-primary-wash disabled:opacity-50"
    >
      Keep
    </button>
    <button
      type="button"
      disabled={busy}
      onclick={() => (confirming = true)}
      class="rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50"
    >
      Remove from the Brain
    </button>
  {/if}
</div>
