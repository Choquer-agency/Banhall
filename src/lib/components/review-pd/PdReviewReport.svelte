<!--
  BNH-39: structured AI feedback report on an externally written PD.
  Rendered as the main view of a review-mode project until a report exists.
  Strengths / Risks / Suggested strengthening / qualitative score, plus the
  timestamped activity log and the "Generate PD" CTA for a comparison draft.

  Presentation (2026-08-13 redesign): one ledger artifact — score band on top,
  category sections as gray-50 band headers with hairline-ruled, mono
  line-numbered rows (the CRA-form grammar). New-UI type rules apply: max
  font-weight 500, ink/line tokens, primary-selected actions on white.
-->
<script lang="ts">
  import { useMutation, useQuery } from "convex-svelte";
  import { api } from "../../../../convex/_generated/api";
  import type { Id } from "../../../../convex/_generated/dataModel";
  import { pdReviewResultSchema } from "../../../../shared/pdReview";
  type PdReviewSummary = {
    _id: Id<"pdReviews">;
    projectId: Id<"projects">;
    documentId: Id<"projectDocuments">;
    sourceFileName: string;
    status: "running" | "completed" | "failed";
    result?: string;
    error?: string;
    createdAt: number;
    completedAt?: number;
  };
  import { toast } from "svelte-sonner";
  import Spinner from "$lib/components/ui/Spinner.svelte";
  import Tooltip from "$lib/components/ui/Tooltip.svelte";
  import { userErrorMessage } from "$lib/errors";

  let {
    review,
    hasTranscript,
    onGenerate,
  }: {
    review: PdReviewSummary;
    /** Transcript text exists — required to generate a comparison draft. */
    hasTranscript: boolean;
    onGenerate: () => void;
  } = $props();

  const logEvent = useMutation(api.pdReviews.logPdReviewEvent);
  const retryReview = useMutation(api.pdReviews.retryPdReview);
  let retrying = $state(false);

  async function retry() {
    if (retrying) return;
    retrying = true;
    try {
      await retryReview({ reviewId: review._id });
      toast.success("Review restarted.");
      // Reactive getLatestPdReview flips the page to the new running review.
    } catch (e) {
      toast.error(userErrorMessage(e, "Couldn't restart the review."));
    } finally {
      // Always release. Clearing only on error left the button disabled for
      // the life of the mount, so if the new run itself failed the writer had
      // no way to retry again without reloading.
      retrying = false;
    }
  }
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

  // One shared contract with the agent that produces this (shared/pdReview.ts)
  // so the two definitions cannot drift apart again.
  const resultState = $derived.by((): {
    result: PdReviewResult | null;
    unreadable: boolean;
  } => {
    if (!review.result) return { result: null, unreadable: false };
    try {
      const parsed = pdReviewResultSchema.safeParse(JSON.parse(review.result));
      if (parsed.success) return { result: parsed.data, unreadable: false };
      console.error(
        "PD review result failed validation — stored payload does not match the expected shape",
        parsed.error.issues
      );
    } catch (error) {
      console.error("PD review result is not valid JSON", error);
    }
    // Stored but unreadable: distinct from "no result yet", and the only
    // signal that a completed review has nothing to show.
    return { result: null, unreadable: true };
  });

  const result = $derived(resultState.result);
  const resultUnreadable = $derived(resultState.unreadable);

  const score = $derived(result?.qualitative_score ?? 0);
  // Ring keeps the mid tier; the number/verdict step up to the 700 tier so
  // the text stays AA on white.
  const bandStroke = $derived(
    score >= 80 ? "text-green-600" : score >= 60 ? "text-amber-600" : "text-red-600"
  );
  const bandText = $derived(
    score >= 80 ? "text-green-700" : score >= 60 ? "text-amber-700" : "text-red-700"
  );
  const verdict = $derived(
    score >= 80 ? "Strong PD" : score >= 60 ? "Needs attention" : "Significant issues"
  );

  const sections = $derived(
    result
      ? [
          {
            key: "strengths",
            label: "Strengths",
            dot: "bg-green-500",
            items: result.strengths,
          },
          {
            key: "risks",
            label: "Risks / areas to improve",
            dot: "bg-red-400",
            items: result.risks,
          },
          {
            key: "suggestions",
            label: "Suggested strengthening",
            dot: "bg-amber-400",
            items: result.suggested_strengthening,
          },
        ].filter((s) => s.items.length > 0)
      : []
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

<div class="flex flex-col gap-6">
  <div class="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
    <div class="min-w-0">
      <h2 class="text-label">AI PD review</h2>
      <p class="mt-1 text-sm text-ink-muted">
        Feedback on <span class="font-medium text-ink-secondary">{review.sourceFileName}</span
        >{#if review.status === "completed" && review.completedAt}
          <span class="text-ink-faint"> · reviewed {formatAt(review.completedAt)}</span>
        {/if}
      </p>
    </div>
    {#if review.status === "completed"}
      {#if hasTranscript}
        <button
          type="button"
          onclick={onGenerate}
          class="inline-flex h-9 flex-none cursor-pointer items-center gap-2 rounded-lg bg-primary-selected px-3.5 text-sm font-medium text-white transition-colors hover:bg-primary-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy motion-reduce:transition-none"
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
                class="inline-flex h-9 flex-none items-center gap-2 rounded-lg bg-primary-selected px-3.5 text-sm font-medium text-white opacity-60"
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
    <!-- Skeleton matches the finished report's shape: score band, section
         band, ruled rows. -->
    <div class="card overflow-hidden" role="status" aria-live="polite">
      <div class="flex items-center gap-5 p-5">
        <div class="grid h-16 w-16 flex-none place-items-center rounded-full border-2 border-gray-100">
          <Spinner size="sm" />
        </div>
        <div class="min-w-0">
          <p class="text-sm font-medium text-ink">Reviewing the written PD…</p>
          <p class="mt-1 text-xs text-ink-muted">
            Checking CRA criteria: uncertainty, systematic investigation, advancement.
          </p>
        </div>
      </div>
      <div class="border-t border-line-soft bg-gray-50 px-5 py-2.5">
        <div class="h-2.5 w-24 animate-pulse rounded bg-gray-200/80 motion-reduce:animate-none"></div>
      </div>
      <div class="space-y-3.5 px-5 py-4" aria-hidden="true">
        <div class="h-2.5 w-full animate-pulse rounded bg-gray-100 motion-reduce:animate-none"></div>
        <div class="h-2.5 w-5/6 animate-pulse rounded bg-gray-100 motion-reduce:animate-none"></div>
        <div class="h-2.5 w-2/3 animate-pulse rounded bg-gray-100 motion-reduce:animate-none"></div>
      </div>
    </div>
  {:else if review.status === "failed"}
    <div class="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
      <div class="min-w-0">
        <p class="text-sm font-medium text-red-700">The review failed.</p>
        {#if review.error}
          <p class="mt-1 text-xs text-red-600">{review.error}</p>
        {/if}
      </div>
      <button
        type="button"
        onclick={retry}
        disabled={retrying}
        class="inline-flex h-9 flex-none cursor-pointer items-center gap-2 rounded-lg bg-red-600 px-3.5 text-sm font-medium text-white transition-colors hover:bg-red-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none"
      >
        {#if retrying}
          <Spinner size="sm" class="h-3.5 w-3.5 border-white/40 border-t-white" />
          Restarting…
        {:else}
          <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Retry review
        {/if}
      </button>
    </div>
  {:else if resultUnreadable}
    <!-- Completed, but the stored result can't be read. Without this the panel
         rendered nothing at all, indistinguishable from "no review yet" — and
         retry was unreachable because it only accepts failed reviews. -->
    <div class="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
      <div class="min-w-0">
        <p class="text-sm font-medium text-amber-800">
          This review finished, but its result couldn’t be read.
        </p>
        <p class="mt-1 text-xs text-amber-700">
          The saved feedback didn’t match the expected format, so there’s
          nothing to show. Running the review again should fix it.
        </p>
      </div>
      <button
        type="button"
        onclick={retry}
        disabled={retrying}
        class="inline-flex h-9 flex-none cursor-pointer items-center gap-2 rounded-lg bg-amber-600 px-3.5 text-sm font-medium text-white transition-colors hover:bg-amber-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none"
      >
        {#if retrying}
          <Spinner size="sm" class="h-3.5 w-3.5 border-white/40 border-t-white" />
          Restarting…
        {:else}
          <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Run review again
        {/if}
      </button>
    </div>
  {:else if result}
    <!-- One artifact: score band on top, category sections beneath as band
         headers + hairline-ruled, line-numbered rows (CRA-form grammar). -->
    <div class="card overflow-hidden">
      <div class="flex items-start gap-5 p-5">
        <div class="relative h-16 w-16 flex-none" role="img" aria-label={`Qualitative score ${score} out of 100: ${verdict}`}>
          <svg viewBox="0 0 36 36" class="h-16 w-16 -rotate-90">
            <circle cx="18" cy="18" r="16" fill="none" class="stroke-gray-100" stroke-width="2.5" />
            <circle
              cx="18" cy="18" r="16" fill="none"
              class={`${bandStroke} transition-[stroke-dashoffset] duration-700 ease-out motion-reduce:transition-none`}
              stroke="currentColor" stroke-width="2.5" stroke-linecap="round"
              stroke-dasharray={2 * Math.PI * 16}
              stroke-dashoffset={2 * Math.PI * 16 * (1 - score / 100)}
            />
          </svg>
          <div class="absolute inset-0 flex items-center justify-center">
            <span class={`font-mono text-base font-medium tabular-nums ${bandText}`}>{score}</span>
          </div>
        </div>
        <div class="min-w-0">
          <p class="text-sm font-medium text-ink">
            {verdict}
            <span class="ml-1.5 font-mono text-xs font-normal tabular-nums text-ink-faint">{score}/100</span>
          </p>
          {#if result.summary}
            <p class="mt-1.5 text-sm leading-relaxed text-ink-secondary">{result.summary}</p>
          {/if}
          {#if result.score_rationale}
            <p class="mt-1.5 text-xs text-ink-muted">{result.score_rationale}</p>
          {/if}
        </div>
      </div>

      {#each sections as section (section.key)}
        <section aria-label={section.label}>
          <div class="flex items-center gap-2 border-t border-line-soft bg-gray-50 px-5 py-2.5">
            <span class={`h-1.5 w-1.5 flex-none rounded-full ${section.dot}`} aria-hidden="true"></span>
            <h3 class="text-label">{section.label}</h3>
            <span class="text-data text-ink-faint">{section.items.length}</span>
          </div>
          <ol class="divide-y divide-line-soft">
            {#each section.items as item, i (i)}
              <li class="flex items-baseline gap-3 px-5 py-3">
                <span class="text-data w-5 flex-none text-right text-ink-faint" aria-hidden="true">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <p class="text-sm leading-relaxed text-ink-secondary">{item}</p>
              </li>
            {/each}
          </ol>
        </section>
      {/each}
    </div>
  {/if}

  <!-- Phase 5: timestamped activity trail -->
  {#if events.length > 0}
    <div>
      <h3 class="text-label mb-2.5">Activity</h3>
      <ul class="space-y-1.5">
        {#each events as e (e._id)}
          <li class="flex items-baseline justify-between gap-3 text-xs">
            <span class="text-ink-secondary">
              {EVENT_LABELS[e.action] ?? e.action}
              {#if e.detail}
                <span class="text-ink-muted"> · {e.detail}</span>
              {/if}
            </span>
            <span class="text-data flex-none text-ink-faint">{formatAt(e.at)}</span>
          </li>
        {/each}
      </ul>
    </div>
  {/if}
</div>
