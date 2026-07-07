<!--
  BNH-39: structured AI feedback report on an externally written PD.
  Rendered as the main view of a review-mode project until a report exists.
  Strengths / Risks / Suggested strengthening / qualitative score, plus the
  timestamped activity log and the "Generate PD" CTA for a comparison draft.
-->
<script lang="ts">
  import { useMutation, useQuery } from "convex-svelte";
  import { api } from "../../../../convex/_generated/api";
  import type { Doc } from "../../../../convex/_generated/dataModel";
  import Spinner from "$lib/components/ui/Spinner.svelte";
  import Tooltip from "$lib/components/ui/Tooltip.svelte";

  let {
    review,
    hasTranscript,
    onGenerate,
  }: {
    review: Doc<"pdReviews">;
    /** Transcript text exists — required to generate a comparison draft. */
    hasTranscript: boolean;
    onGenerate: () => void;
  } = $props();

  const logEvent = useMutation(api.pdReviews.logPdReviewEvent);
  const eventsQ = useQuery(api.pdReviews.listPdReviewEvents, () => ({
    projectId: review.projectId,
  }));
  const events = $derived(eventsQ.data ?? []);

  interface PdReviewResult {
    summary: string;
    qualitative_score: number;
    score_rationale: string;
    strengths: string[];
    risks: string[];
    suggested_strengthening: string[];
  }

  const result = $derived.by((): PdReviewResult | null => {
    if (!review.result) return null;
    try {
      const raw = JSON.parse(review.result);
      return {
        summary: raw.summary ?? "",
        qualitative_score: raw.qualitative_score ?? 0,
        score_rationale: raw.score_rationale ?? "",
        strengths: raw.strengths ?? [],
        risks: raw.risks ?? [],
        suggested_strengthening: raw.suggested_strengthening ?? [],
      };
    } catch {
      return null;
    }
  });

  const score = $derived(result?.qualitative_score ?? 0);
  const band = $derived(
    score >= 80 ? "text-green-600" : score >= 60 ? "text-amber-600" : "text-red-600"
  );

  // Phase 5: log that the report was opened (once per review per mount).
  let loggedViewFor: string | null = null;
  $effect(() => {
    if (review.status === "completed" && loggedViewFor !== review._id) {
      loggedViewFor = review._id;
      logEvent({
        projectId: review.projectId,
        reviewId: review._id,
        action: "review_viewed",
      }).catch(() => {});
    }
  });

  const EVENT_LABELS: Record<string, string> = {
    review_started: "Review started",
    review_completed: "Review completed",
    review_failed: "Review failed",
    review_viewed: "Report opened",
    generate_from_review: "PD generation triggered from review",
  };

  function formatAt(at: number): string {
    return new Date(at).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }
</script>

{#snippet feedbackList(label: string, items: string[], dot: string, text: string)}
  {#if items.length > 0}
    <div>
      <p class="text-label mb-2.5">{label}</p>
      <ul class="space-y-1.5">
        {#each items as item, i (i)}
          <li class={`flex items-start gap-2 text-sm leading-relaxed ${text}`}>
            <span class={`mt-2 h-1.5 w-1.5 flex-none rounded-full ${dot}`}></span>
            {item}
          </li>
        {/each}
      </ul>
    </div>
  {/if}
{/snippet}

<div class="flex flex-col gap-6">
  <div class="flex items-start justify-between gap-4">
    <div>
      <p class="text-label">AI PD review</p>
      <p class="mt-1 text-sm text-gray-500">
        Feedback on <span class="font-medium text-gray-700">{review.sourceFileName}</span>
      </p>
    </div>
    {#if review.status === "completed"}
      {#if hasTranscript}
        <button
          type="button"
          onclick={onGenerate}
          class="inline-flex flex-none items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-dark"
        >
          <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          Generate PD for comparison
        </button>
      {:else}
        <Tooltip text="Add an interview transcript to generate a fresh draft" side="left" delayDuration={300}>
          {#snippet children({ props })}
            <span {...props}>
              <button
                type="button"
                disabled
                class="inline-flex flex-none items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white opacity-50"
              >
                Generate PD for comparison
              </button>
            </span>
          {/snippet}
        </Tooltip>
      {/if}
    {/if}
  </div>

  {#if review.status === "running"}
    <div class="flex flex-col items-center gap-3 rounded-xl border border-gray-200 bg-white py-14 text-center">
      <Spinner />
      <p class="text-sm font-medium text-gray-700">Reviewing the written PD…</p>
      <p class="text-xs text-gray-400">
        Checking CRA criteria — uncertainty, systematic investigation, advancement.
      </p>
    </div>
  {:else if review.status === "failed"}
    <div class="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
      <p class="text-sm font-medium text-red-700">The review failed.</p>
      {#if review.error}
        <p class="mt-1 text-xs text-red-600">{review.error}</p>
      {/if}
    </div>
  {:else if result}
    <!-- Score + summary -->
    <div class="card flex items-start gap-4 p-5">
      <div class="relative h-16 w-16 flex-none">
        <svg viewBox="0 0 36 36" class="h-16 w-16 -rotate-90">
          <circle cx="18" cy="18" r="16" fill="none" class="stroke-gray-100" stroke-width="2" />
          <circle
            cx="18" cy="18" r="16" fill="none"
            class={`${band} transition-[stroke-dashoffset] duration-700 ease-out`}
            stroke="currentColor" stroke-width="2" stroke-linecap="round"
            stroke-dasharray={2 * Math.PI * 16}
            stroke-dashoffset={2 * Math.PI * 16 * (1 - score / 100)}
          />
        </svg>
        <div class="absolute inset-0 flex items-center justify-center">
          <span class={`text-lg font-semibold tabular-nums ${band}`}>{score}</span>
        </div>
      </div>
      <div class="min-w-0">
        <p class="text-sm font-semibold text-gray-900">
          {score >= 80 ? "Strong PD" : score >= 60 ? "Needs attention" : "Significant issues"}
          <span class="font-normal text-gray-400"> · /100</span>
        </p>
        {#if result.summary}
          <p class="mt-1.5 text-sm leading-relaxed text-gray-600">{result.summary}</p>
        {/if}
        {#if result.score_rationale}
          <p class="mt-1.5 text-xs text-gray-400">{result.score_rationale}</p>
        {/if}
      </div>
    </div>

    <div class="card flex flex-col gap-6 p-5">
      {@render feedbackList("Strengths", result.strengths, "bg-green-500", "text-gray-700")}
      {@render feedbackList("Risks / areas to improve", result.risks, "bg-red-400", "text-gray-700")}
      {@render feedbackList("Suggested strengthening", result.suggested_strengthening, "bg-amber-400", "text-gray-700")}
    </div>
  {/if}

  <!-- Phase 5: timestamped activity trail -->
  {#if events.length > 0}
    <div>
      <p class="text-label mb-2.5">Activity</p>
      <ul class="space-y-1">
        {#each events as e (e._id)}
          <li class="flex items-baseline justify-between gap-3 text-xs">
            <span class="text-gray-600">
              {EVENT_LABELS[e.action] ?? e.action}
              {#if e.detail}
                <span class="text-gray-400"> — {e.detail}</span>
              {/if}
            </span>
            <span class="flex-none tabular-nums text-gray-400">{formatAt(e.at)}</span>
          </li>
        {/each}
      </ul>
    </div>
  {/if}
</div>
