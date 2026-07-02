<script lang="ts">
  import { useMutation } from "convex-svelte";
  import { api } from "../../../../convex/_generated/api";
  import type { Id } from "../../../../convex/_generated/dataModel";

  type Feedback = {
    _id: Id<"brainFeedbackQueue">;
    fromName?: string;
    body: string;
    suggestedRule?: string;
    createdAt: number;
  };

  let { fb }: { fb: Feedback } = $props();

  const review = useMutation(api.brain.reviewFeedback);
  let note = $state("");
  let busy = $state(false);

  async function decide(decision: "approved" | "rejected") {
    busy = true;
    try {
      await review({
        feedbackId: fb._id,
        decision,
        ...(note.trim() ? { reviewNote: note.trim() } : {}),
      });
    } finally {
      busy = false;
    }
  }
</script>

<div class="border-b border-gray-50 px-4 py-4 last:border-0">
  <p class="text-sm text-gray-800">{fb.body}</p>
  {#if fb.suggestedRule}
    <p class="mt-1.5 rounded-lg bg-primary/5 px-3 py-2 text-sm text-gray-700">
      <span class="font-semibold text-primary-dark">Suggested rule: </span>{fb.suggestedRule}
    </p>
  {/if}
  <p class="mt-1.5 text-xs text-gray-400">
    {fb.fromName ?? "Unknown writer"} · {new Date(fb.createdAt).toLocaleDateString()}
  </p>
  <div class="mt-2.5 flex items-center gap-2">
    <input
      bind:value={note}
      placeholder="Review note (optional)"
      class="flex-1 rounded-lg border border-gray-200 px-3 py-1.5 text-sm"
    />
    <button
      disabled={busy}
      onclick={() => decide("approved")}
      class="rounded-lg bg-primary px-3.5 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
    >
      Approve
    </button>
    <button
      disabled={busy}
      onclick={() => decide("rejected")}
      class="rounded-lg border border-gray-200 px-3.5 py-1.5 text-sm font-medium text-gray-600 hover:bg-primary-wash disabled:opacity-50"
    >
      Reject
    </button>
  </div>
</div>
