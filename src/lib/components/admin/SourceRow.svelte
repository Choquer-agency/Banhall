<script lang="ts">
  import { slide } from "svelte/transition";
  import { useQuery, useMutation } from "convex-svelte";
  import { api } from "../../../../convex/_generated/api";
  import type { Id } from "../../../../convex/_generated/dataModel";
  import { scienceCodeLabel } from "../../../../shared/craScienceCodes";
  import Spinner from "$lib/components/ui/Spinner.svelte";

  const KIND_LABEL: Record<string, string> = {
    pd_pair: "PD pair",
    cra_letter: "CRA letter",
    writer_feedback: "Writer feedback",
  };

  function tierLabel(t: number) {
    if (t >= 0.9) return "gold";
    if (t >= 0.6) return "strong";
    return "standard";
  }

  type Row = {
    _id: Id<"brainSources">;
    title: string;
    status: string;
    kind: string;
    industry: string;
    writerName: string | null;
    writerTier: number;
    docType: string;
    craOutcome: string | null;
    scienceCode: string | null;
    hasEntry: boolean;
    createdAt: number;
  };

  /** Expandable review pane: full content + approve/revoke/reweight actions. */
  let { row, onChanged }: { row: Row; onChanged: () => void } = $props();

  let open = $state(false);
  let confirming = $state(false);
  // Initial value only, matching React's useState(String(row.writerTier)).
  // svelte-ignore state_referenced_locally
  let tierDraft = $state(String(row.writerTier));
  let busy = $state(false);

  const fullQ = useQuery(api.brain.getBrainSource, () =>
    open ? { sourceId: row._id } : "skip"
  );
  const approve = useMutation(api.brain.approveSource);
  const revoke = useMutation(api.brain.revokeSource);
  const reweight = useMutation(api.brain.reweightSource);

  const statusStyles = $derived(
    row.status === "approved"
      ? "bg-green-50 text-green-700 border-green-200"
      : row.status === "pending"
        ? "bg-amber-50 text-amber-700 border-amber-200"
        : "bg-gray-50 text-gray-500 border-gray-200"
  );

  async function act(fn: () => Promise<unknown>) {
    busy = true;
    try {
      await fn();
      onChanged();
    } finally {
      busy = false;
      confirming = false;
    }
  }
</script>

<div class="border-b border-gray-50 last:border-0">
  <button
    onclick={() => (open = !open)}
    class="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-primary-wash"
  >
    <div class="min-w-0 flex-1">
      <p class="truncate text-sm font-medium text-gray-800">{row.title}</p>
      <p class="text-xs text-gray-400">
        {KIND_LABEL[row.kind] ?? row.kind} · {row.industry}{row.scienceCode ? ` · ${scienceCodeLabel(row.scienceCode)}` : ""}{row.writerName ? ` · ${row.writerName}` : ""} · tier {row.writerTier} ({tierLabel(row.writerTier)}){row.craOutcome ? ` · CRA ${row.craOutcome}` : ""}
      </p>
    </div>
    {#if row.status === "approved"}
      <span
        class={`text-xs ${row.hasEntry ? "text-green-600" : "text-amber-500"}`}
        title={row.hasEntry ? "Embedded & retrievable" : "Embedding in background…"}
      >
        {row.hasEntry ? "● in brain" : "◌ embedding…"}
      </span>
    {/if}
    <span class={`rounded-full border px-2 py-0.5 text-xs font-medium ${statusStyles}`}>
      {row.status}
    </span>
    <svg
      class={`h-3.5 w-3.5 flex-shrink-0 transition-all duration-300 ${open ? "rotate-180 text-primary" : "text-gray-300"}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      stroke-width="2"
    >
      <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  </button>

  {#if open}
    <div class="border-t border-gray-100 bg-gray-50/60 px-4 py-4" transition:slide={{ duration: 300 }}>
      {#if fullQ.data === undefined}
        <div class="flex justify-center py-4">
          <Spinner class="h-5 w-5" />
        </div>
      {:else if fullQ.data === null}
        <p class="text-sm text-gray-400">Source not found.</p>
      {:else}
        <pre class="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-lg border border-gray-200 bg-white p-4 font-sans text-sm text-gray-700">{fullQ.data.content}</pre>

        <div class="mt-3 flex flex-wrap items-center gap-2">
          {#if row.status === "pending"}
            <button
              disabled={busy}
              onclick={() => act(() => approve({ sourceId: row._id }))}
              class="rounded-lg bg-primary px-4 py-1.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              Approve → ingest
            </button>
          {/if}

          {#if row.status !== "revoked"}
            {#if confirming}
              <span class="flex items-center gap-2">
                <span class="text-sm text-gray-600">
                  {row.status === "approved"
                    ? "Unlearn — deletes it from retrieval. Sure?"
                    : "Reject this source?"}
                </span>
                <button
                  disabled={busy}
                  onclick={() => act(() => revoke({ sourceId: row._id }))}
                  class="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                >
                  Yes, revoke
                </button>
                <button
                  onclick={() => (confirming = false)}
                  class="text-sm text-gray-500 hover:text-gray-700"
                >
                  Cancel
                </button>
              </span>
            {:else}
              <button
                onclick={() => (confirming = true)}
                class="rounded-lg border border-red-200 px-4 py-1.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-50"
              >
                {row.status === "approved" ? "Revoke (unlearn)" : "Reject"}
              </button>
            {/if}
          {/if}

          {#if row.status === "approved"}
            <span class="ml-auto flex items-center gap-1.5 text-sm text-gray-500">
              Weight
              <input
                bind:value={tierDraft}
                aria-label="Writer tier weight"
                class="w-16 rounded-lg border border-gray-200 px-2 py-1 text-center text-sm"
                inputmode="decimal"
              />
              {#if Number(tierDraft) !== row.writerTier && Number.isFinite(Number(tierDraft))}
                <button
                  disabled={busy}
                  onclick={() =>
                    act(() =>
                      reweight({ sourceId: row._id, writerTier: Number(tierDraft) })
                    )}
                  class="rounded-lg bg-navy px-3 py-1 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                >
                  Save
                </button>
              {/if}
            </span>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</div>
