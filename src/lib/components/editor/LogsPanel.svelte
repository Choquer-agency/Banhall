<!--
  Port of src/components/editor/LogsPanel.tsx.
  Quiet, text-only dropdown of the project's full chat log (every question +
  answer). Intentionally low-emphasis — no card/background — since it's for
  data review and the Brain, not a primary surface.
-->
<script module lang="ts">
  function truncate(s: string, n: number): string {
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
  }

  function formatTime(ts: number): string {
    return new Date(ts).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }
</script>

<script lang="ts">
  import { useQuery } from "convex-svelte";
  import { api } from "../../../../convex/_generated/api";
  import type { Id } from "../../../../convex/_generated/dataModel";

  let { projectId }: { projectId: Id<"projects"> } = $props();

  let isOpen = $state(false);

  const logQ = useQuery(api.chat.listProjectLog, () => ({ projectId }));
  const log = $derived(logQ.data);
  const count = $derived(log?.length ?? 0);
</script>

<div class="mt-6">
  <button
    type="button"
    onclick={() => (isOpen = !isOpen)}
    class="flex items-center gap-1.5 text-xs font-medium text-gray-400 transition-colors hover:text-gray-600"
  >
    <svg
      class={`h-3 w-3 transition-transform ${isOpen ? "rotate-90" : ""}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      stroke-width="2"
    >
      <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
    </svg>
    Logs
    <span class="text-gray-300">·</span>
    <span class="text-gray-300">{count} entr{count === 1 ? "y" : "ies"}</span>
  </button>

  {#if isOpen}
    <div class="mt-3 space-y-3 border-l border-gray-100 pl-4">
      {#if count === 0}
        <p class="text-xs text-gray-400">
          No chat activity yet. Every question and answer in the assistant is
          recorded here.
        </p>
      {:else}
        {#each log ?? [] as entry (entry._id)}
          <div class="text-xs leading-relaxed">
            <div class="mb-0.5 flex items-center gap-2">
              <span
                class={`font-semibold uppercase tracking-wide ${
                  entry.role === "writer" ? "text-gray-500" : "text-primary-dark"
                }`}
              >
                {entry.role === "writer" ? "Question" : "Answer"}
              </span>
              <span class="text-gray-300">{formatTime(entry.createdAt)}</span>
            </div>
            {#if entry.highlight}
              <p class="mb-0.5 italic text-gray-400">
                re: &ldquo;{truncate(entry.highlight, 120)}&rdquo;
              </p>
            {/if}
            <p class="whitespace-pre-wrap text-gray-600">{entry.content}</p>
            {#if entry.proposedEdit}
              <p class="mt-0.5 text-gray-400">
                → proposed edit
                <span
                  class={entry.proposedEdit.state === "applied"
                    ? "text-green-600"
                    : entry.proposedEdit.state === "rejected"
                      ? "text-red-500"
                      : "text-gray-400"}
                >
                  ({entry.proposedEdit.state})
                </span>
              </p>
            {/if}
          </div>
        {/each}
      {/if}
    </div>
  {/if}
</div>
