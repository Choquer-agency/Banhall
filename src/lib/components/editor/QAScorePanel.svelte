<!--
  Port of src/components/editor/QAScorePanel.tsx.
  Collapsible QA scorecard panel: AI section scores, CRA compliance, language
  flags, client follow-up gaps, suggested improvements — plus the writer's own
  human QA review (BNH-29). Renders nothing when no scorecard is available.
-->
<script module lang="ts">
  interface QAScorecard {
    overall_score: number;
    section_scores: Record<string, { score: number; issues: string[]; strengths: string[] }>;
    cra_compliance: Record<string, boolean>;
    hallucination_risks: string[];
    ai_language_flags: string[];
    superlative_flags: string[];
    gaps_requiring_client_followup: Array<{
      section: string;
      paragraph: number;
      question: string;
    }>;
    suggested_improvements: string[];
  }

  /** Fill any missing fields with safe defaults so the panel never crashes on a
   *  partial scorecard (the model can omit optional arrays). */
  function normalize(raw: Partial<QAScorecard>): QAScorecard {
    const sections: QAScorecard["section_scores"] = {};
    for (const [k, v] of Object.entries(raw.section_scores ?? {})) {
      sections[k] = {
        score: v?.score ?? 0,
        issues: v?.issues ?? [],
        strengths: v?.strengths ?? [],
      };
    }
    return {
      overall_score: raw.overall_score ?? 0,
      section_scores: sections,
      cra_compliance: raw.cra_compliance ?? {},
      hallucination_risks: raw.hallucination_risks ?? [],
      ai_language_flags: raw.ai_language_flags ?? [],
      superlative_flags: raw.superlative_flags ?? [],
      gaps_requiring_client_followup: raw.gaps_requiring_client_followup ?? [],
      suggested_improvements: raw.suggested_improvements ?? [],
    };
  }
</script>

<script lang="ts">
  import { useQuery, useMutation } from "convex-svelte";
  import { api } from "../../../../convex/_generated/api";
  import type { Id } from "../../../../convex/_generated/dataModel";

  let {
    agentOutputs,
    reportContent,
    reportId,
    rawQa = null,
    defaultOpen = false,
  }: {
    agentOutputs?: string | null;
    reportContent?: string | null;
    reportId?: Id<"reports">;
    /** Pre-parsed qa object (candidate option view) — skips agentOutputs parsing. */
    rawQa?: unknown;
    /** Start expanded (rail/panel contexts). */
    defaultOpen?: boolean;
  } = $props();

  // svelte-ignore state_referenced_locally — initial-value capture is intended
  let isOpen = $state(defaultOpen);

  const scorecard = $derived.by((): QAScorecard | null => {
    if (rawQa && typeof rawQa === "object" && "overall_score" in (rawQa as object)) {
      return normalize(rawQa as never);
    }
    // Try agentOutputs first (new reports)
    if (agentOutputs) {
      try {
        const parsed = JSON.parse(agentOutputs);
        if (parsed.qa && "overall_score" in parsed.qa) return normalize(parsed.qa);
      } catch {
        /* fall through */
      }
    }
    // Fallback: extract from report content codeBlock (old reports)
    if (reportContent) {
      try {
        const doc = JSON.parse(reportContent);
        const codeBlock = doc.content?.find(
          (node: { type: string; attrs?: { language?: string } }) =>
            node.type === "codeBlock" && node.attrs?.language === "json"
        );
        if (codeBlock?.content?.[0]?.text) {
          const parsed = JSON.parse(codeBlock.content[0].text);
          if ("overall_score" in parsed) return normalize(parsed);
        }
      } catch {
        /* no scorecard */
      }
    }
    return null;
  });

  // BNH-29: the writer's own QA review for this report version.
  const myReviewQ = useQuery(api.reviews.getMyWriterReview, () =>
    reportId ? { reportId } : "skip"
  );
  const myReview = $derived(myReviewQ.data);
  const submitReview = useMutation(api.reviews.submitWriterReview);
  let draft = $state<{ score: string; comment: string } | null>(null);
  let saving = $state(false);

  const overall = $derived(scorecard?.overall_score ?? 0);

  // Show the saved review unless the writer is mid-edit (draft).
  const reviewScore = $derived(draft ? draft.score : myReview ? String(myReview.score) : "");
  const reviewComment = $derived(draft ? draft.comment : (myReview?.comment ?? ""));
  const hasReview = $derived(myReview != null);
  const dirty = $derived(
    draft != null &&
      (Number(draft.score) !== (myReview?.score ?? NaN) ||
        draft.comment !== (myReview?.comment ?? ""))
  );

  async function saveReview() {
    if (!reportId || reviewScore === "") return;
    saving = true;
    try {
      await submitReview({
        reportId,
        score: Number(reviewScore),
        comment: reviewComment,
        aiScore: overall,
      });
      draft = null; // reflect the saved server value
    } catch (e) {
      console.error("writer review save failed", e);
    } finally {
      saving = false;
    }
  }
</script>

{#if scorecard}
  <div class="card">
    <!-- Toggle bar -->
    <button
      type="button"
      onclick={() => (isOpen = !isOpen)}
      class="flex w-full items-center justify-between rounded-xl px-5 py-3 text-left transition-colors hover:bg-primary-wash"
    >
      <div class="flex items-center gap-3">
        <div
          class={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${
            overall >= 80
              ? "bg-green-50 text-green-700"
              : overall >= 60
                ? "bg-amber-50 text-amber-700"
                : "bg-red-50 text-red-700"
          }`}
        >
          {overall}
        </div>
        <span class="text-sm font-medium text-gray-900">QA Score</span>
        {#if myReview}
          <span class="rounded-full bg-navy/5 px-2 py-0.5 text-xs font-medium text-navy">
            You: {myReview.score}
          </span>
        {/if}
        {#if scorecard.gaps_requiring_client_followup.length > 0}
          <span class="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
            {scorecard.gaps_requiring_client_followup.length} gap{scorecard
              .gaps_requiring_client_followup.length !== 1
              ? "s"
              : ""}
          </span>
        {/if}
      </div>
      <svg
        class={`h-4 w-4 text-gray-400 transition-transform ${isOpen ? "rotate-180" : ""}`}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        stroke-width="2"
      >
        <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
      </svg>
    </button>

    <!-- Expanded panel -->
    {#if isOpen}
      <div class="border-t border-gray-100 px-5 py-4">
        <!-- BNH-29: writer's human QA review (independent of the AI score) -->
        {#if reportId}
          <div class="mb-5 rounded-lg border border-gray-200 bg-gray-50 p-3">
            <div class="flex items-center justify-between">
              <p class="text-label">
                Your review
              </p>
              <span class="text-[11px] text-gray-400">AI scored this {overall}/100</span>
            </div>
            <div class="mt-2 flex items-center gap-2">
              <label class="text-xs text-gray-600" for="writer-review-score">Your score</label>
              <input
                id="writer-review-score"
                type="number"
                min="0"
                max="100"
                value={reviewScore}
                oninput={(e) => (draft = { score: e.currentTarget.value, comment: reviewComment })}
                placeholder="0–100"
                class="w-20 rounded-md border border-gray-200 bg-white px-2 py-1 text-sm font-semibold text-navy focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
              />
              <span class="text-xs text-gray-400">/ 100</span>
            </div>
            <textarea
              value={reviewComment}
              oninput={(e) => (draft = { score: reviewScore, comment: e.currentTarget.value })}
              rows="2"
              placeholder="Comments on this report's quality (what worked, what to fix)…"
              aria-label="Review comment"
              class="mt-2 w-full resize-none rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
            ></textarea>
            <div class="mt-2 flex items-center gap-3">
              <button
                type="button"
                onclick={saveReview}
                disabled={saving || reviewScore === "" || (hasReview && !dirty)}
                class="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-primary-dark disabled:opacity-50"
              >
                {saving ? "Saving…" : hasReview ? (dirty ? "Update review" : "Saved") : "Save review"}
              </button>
              {#if hasReview && !dirty && !saving}
                <span class="inline-flex items-center gap-1 text-xs text-green-600">
                  <svg
                    class="h-3.5 w-3.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    stroke-width="2.5"
                  >
                    <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  Recorded
                </span>
              {/if}
            </div>
          </div>
        {/if}

        <!-- Section scores -->
        <div class="mb-5 grid grid-cols-3 gap-3">
          {#each Object.entries(scorecard.section_scores) as [key, section] (key)}
            <div class="rounded-lg border border-gray-100 bg-gray-50 p-3">
              <div class="flex items-center justify-between">
                <p class="text-xs font-medium text-gray-500">Section {key}</p>
                <span
                  class={`text-sm font-bold ${
                    section.score >= 80
                      ? "text-green-700"
                      : section.score >= 60
                        ? "text-amber-700"
                        : "text-red-700"
                  }`}
                >
                  {section.score}
                </span>
              </div>
              {#if section.issues.length > 0}
                <ul class="mt-2 space-y-1">
                  {#each section.issues as issue, i (i)}
                    <li class="flex items-start gap-1.5 text-xs text-red-600">
                      <span class="mt-1 h-1 w-1 flex-shrink-0 rounded-full bg-red-400"></span>
                      {issue}
                    </li>
                  {/each}
                </ul>
              {/if}
              {#if section.strengths.length > 0}
                <ul class="mt-2 space-y-1">
                  {#each section.strengths as str, i (i)}
                    <li class="flex items-start gap-1.5 text-xs text-green-600">
                      <span class="mt-1 h-1 w-1 flex-shrink-0 rounded-full bg-green-400"></span>
                      {str}
                    </li>
                  {/each}
                </ul>
              {/if}
            </div>
          {/each}
        </div>

        <!-- CRA Compliance -->
        <div class="mb-4">
          <p class="text-label mb-2">
            CRA Compliance
          </p>
          <div class="flex flex-wrap gap-2">
            {#each Object.entries(scorecard.cra_compliance) as [key, value] (key)}
              <span
                class={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  value ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
                }`}
              >
                {#if value}
                  <svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                {:else}
                  <svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                {/if}
                {key.replace(/_/g, " ")}
              </span>
            {/each}
          </div>
        </div>

        <!-- Flags -->
        {#if scorecard.ai_language_flags.length > 0 || scorecard.superlative_flags.length > 0}
          <div class="mb-4">
            <p class="text-label mb-2">
              Language Flags
            </p>
            <div class="flex flex-wrap gap-1.5">
              {#each scorecard.ai_language_flags as flag, i (`ai-${i}`)}
                <span class="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700">
                  {flag}
                </span>
              {/each}
              {#each scorecard.superlative_flags as flag, i (`sup-${i}`)}
                <span class="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700">
                  {flag}
                </span>
              {/each}
            </div>
          </div>
        {/if}

        <!-- Gaps -->
        {#if scorecard.gaps_requiring_client_followup.length > 0}
          <div class="mb-4">
            <p class="text-label mb-2">
              Follow-up Questions for Client
            </p>
            <div class="space-y-2">
              {#each scorecard.gaps_requiring_client_followup as gap, i (i)}
                <div class="rounded-lg border border-amber-200 bg-gap-bg px-3 py-2">
                  <p class="text-xs font-medium text-gap-text">
                    Section {gap.section}, Paragraph {gap.paragraph}
                  </p>
                  <p class="mt-0.5 text-sm text-gap-text">{gap.question}</p>
                </div>
              {/each}
            </div>
          </div>
        {/if}

        <!-- Improvements -->
        {#if scorecard.suggested_improvements.length > 0}
          <div>
            <p class="text-label mb-2">
              Suggested Improvements
            </p>
            <ul class="space-y-1">
              {#each scorecard.suggested_improvements as imp, i (i)}
                <li class="flex items-start gap-1.5 text-xs text-gray-600">
                  <span class="mt-1 h-1 w-1 flex-shrink-0 rounded-full bg-gray-400"></span>
                  {imp}
                </li>
              {/each}
            </ul>
          </div>
        {/if}
      </div>
    {/if}
  </div>
{/if}
