<!--
  QA scorecard content (BNH-47) — rail-native, no chrome of its own: the
  hosting QARailPanel provides header/close. Score gauge → per-section
  breakdown → compliance → flags → gaps → improvements → writer review
  (BNH-29). Renders an empty-state note when no scorecard is available.
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
    onLocateGap,
  }: {
    agentOutputs?: string | null;
    reportContent?: string | null;
    reportId?: Id<"reports">;
    /** Pre-parsed qa object (candidate option view) — skips agentOutputs parsing. */
    rawQa?: unknown;
    /** Jump to + highlight the gap's paragraph in the report (workspace only). */
    onLocateGap?: (gap: { section: string; paragraph: number }) => void;
  } = $props();

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
  const band = $derived(
    overall >= 80 ? "text-green-600" : overall >= 60 ? "text-amber-600" : "text-red-600"
  );

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
  <div class="flex flex-col gap-6">
    <!-- Score gauge -->
    <div class="flex items-center gap-3.5">
      <div class="relative h-14 w-14 flex-none">
        <svg viewBox="0 0 36 36" class="h-14 w-14 -rotate-90">
          <circle cx="18" cy="18" r="16" fill="none" class="stroke-gray-100" stroke-width="2" />
          <circle
            cx="18" cy="18" r="16" fill="none"
            class={`${band} transition-[stroke-dashoffset] duration-700 ease-out`}
            stroke="currentColor" stroke-width="2" stroke-linecap="round"
            stroke-dasharray={2 * Math.PI * 16}
            stroke-dashoffset={2 * Math.PI * 16 * (1 - overall / 100)}
          />
        </svg>
        <div class="absolute inset-0 flex items-center justify-center">
          <span class={`text-base font-semibold tabular-nums ${band}`}>{overall}</span>
        </div>
      </div>
      <div class="min-w-0">
        <p class="text-label">AI QA score</p>
        <p class="mt-0.5 text-sm text-gray-600">
          {overall >= 80 ? "Strong draft" : overall >= 60 ? "Needs attention" : "Significant issues"}
          <span class="text-gray-400"> · /100</span>
        </p>
        {#if myReview}
          <span class="mt-1 inline-flex items-center gap-1 rounded-full bg-navy/5 px-2 py-0.5 text-xs font-medium text-navy">
            You: {myReview.score}
          </span>
        {/if}
      </div>
    </div>

    <!-- Per-section breakdown -->
    <div>
      <p class="text-label mb-2.5">Sections</p>
      <div class="flex flex-col gap-3">
        {#each Object.entries(scorecard.section_scores) as [key, section] (key)}
          {@const c = section.score >= 80 ? "bg-green-500" : section.score >= 60 ? "bg-amber-500" : "bg-red-500"}
          <div class="rounded-lg border border-line-soft px-3 py-2.5">
            <div class="flex items-center gap-3">
              <span class="text-data w-8 flex-none font-semibold text-gray-700">{key}</span>
              <div class="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-gray-100">
                <div class={`h-full rounded-full ${c} transition-[width] duration-700 ease-out`} style={`width: ${section.score}%`}></div>
              </div>
              <span class="text-data w-7 flex-none text-right font-semibold text-gray-800">{section.score}</span>
            </div>
            {#if section.issues.length > 0 || section.strengths.length > 0}
              <ul class="mt-2 space-y-1">
                {#each section.issues as issue, i (`i-${i}`)}
                  <li class="flex items-start gap-1.5 text-xs leading-relaxed text-red-600">
                    <span class="mt-1.5 h-1 w-1 flex-none rounded-full bg-red-400"></span>
                    {issue}
                  </li>
                {/each}
                {#each section.strengths as str, i (`s-${i}`)}
                  <li class="flex items-start gap-1.5 text-xs leading-relaxed text-green-700">
                    <span class="mt-1.5 h-1 w-1 flex-none rounded-full bg-green-500"></span>
                    {str}
                  </li>
                {/each}
              </ul>
            {/if}
          </div>
        {/each}
      </div>
    </div>

    <!-- CRA compliance -->
    {#if Object.keys(scorecard.cra_compliance).length > 0}
      <div>
        <p class="text-label mb-2.5">CRA compliance</p>
        <div class="flex flex-wrap gap-1.5">
          {#each Object.entries(scorecard.cra_compliance) as [key, value] (key)}
            <span
              class={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${
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
    {/if}

    <!-- Language flags -->
    {#if scorecard.ai_language_flags.length > 0 || scorecard.superlative_flags.length > 0}
      <div>
        <p class="text-label mb-2.5">Language flags</p>
        <div class="flex flex-wrap gap-1.5">
          {#each scorecard.ai_language_flags as flag, i (`ai-${i}`)}
            <span class="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-700">{flag}</span>
          {/each}
          {#each scorecard.superlative_flags as flag, i (`sup-${i}`)}
            <span class="rounded-full bg-red-100 px-2.5 py-1 text-xs font-medium text-red-700">{flag}</span>
          {/each}
        </div>
      </div>
    {/if}

    <!-- Client follow-ups -->
    {#if scorecard.gaps_requiring_client_followup.length > 0}
      <div>
        <p class="text-label mb-2.5">Client follow-ups</p>
        <div class="space-y-1.5">
          {#each scorecard.gaps_requiring_client_followup as gap, i (i)}
            {#if onLocateGap}
              <button
                type="button"
                onclick={() => onLocateGap({ section: gap.section, paragraph: gap.paragraph })}
                title="Show this paragraph in the report"
                class="group flex w-full items-start gap-2 rounded-lg border border-amber-200/70 bg-gap-bg px-2.5 py-2 text-left transition-colors hover:border-amber-300"
              >
                <svg class="mt-0.5 h-3.5 w-3.5 flex-none text-gap-text/50 transition-colors group-hover:text-gap-text" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path stroke-linecap="round" stroke-linejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span class="min-w-0">
                  <span class="text-data block text-gap-text/70">{gap.section} · Paragraph {gap.paragraph}</span>
                  <span class="mt-0.5 block text-xs leading-relaxed text-gap-text">{gap.question}</span>
                </span>
              </button>
            {:else}
              <div class="rounded-lg border border-amber-200/70 bg-gap-bg px-2.5 py-2">
                <p class="text-data text-gap-text/70">{gap.section} · Paragraph {gap.paragraph}</p>
                <p class="mt-0.5 text-xs leading-relaxed text-gap-text">{gap.question}</p>
              </div>
            {/if}
          {/each}
        </div>
      </div>
    {/if}

    <!-- Suggested improvements -->
    {#if scorecard.suggested_improvements.length > 0}
      <div>
        <p class="text-label mb-2.5">Suggested improvements</p>
        <ul class="space-y-1.5">
          {#each scorecard.suggested_improvements as imp, i (i)}
            <li class="flex items-start gap-1.5 text-xs leading-relaxed text-gray-600">
              <span class="mt-1.5 h-1 w-1 flex-none rounded-full bg-gray-400"></span>
              {imp}
            </li>
          {/each}
        </ul>
      </div>
    {/if}

    <!-- BNH-29: writer's own review — after reading the AI's take -->
    {#if reportId}
      <div class="border-t border-line-soft pt-5">
        <div class="flex items-baseline justify-between">
          <p class="text-label">Your review</p>
          {#if hasReview && !dirty && !saving}
            <span class="inline-flex items-center gap-1 text-xs text-green-600">
              <svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              Recorded
            </span>
          {/if}
        </div>
        <div class="mt-2.5 flex items-center gap-2">
          <input
            id="writer-review-score"
            type="number"
            min="0"
            max="100"
            value={reviewScore}
            oninput={(e) => (draft = { score: e.currentTarget.value, comment: reviewComment })}
            placeholder="0–100"
            aria-label="Your score out of 100"
            class="w-20 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm font-semibold text-navy focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <span class="text-xs text-gray-400">/ 100</span>
        </div>
        <textarea
          value={reviewComment}
          oninput={(e) => (draft = { score: reviewScore, comment: e.currentTarget.value })}
          rows="3"
          placeholder="What worked, what to fix…"
          aria-label="Review comment"
          class="mt-2 w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        ></textarea>
        <button
          type="button"
          onclick={saveReview}
          disabled={saving || reviewScore === "" || (hasReview && !dirty)}
          class="mt-2.5 w-full rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-dark disabled:opacity-50"
        >
          {saving ? "Saving…" : hasReview ? (dirty ? "Update review" : "Saved") : "Save review"}
        </button>
      </div>
    {/if}
  </div>
{:else}
  <div class="flex flex-col items-center gap-2 py-10 text-center">
    <svg class="h-8 w-8 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
      <path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
    </svg>
    <p class="text-sm text-gray-500">No QA scorecard for this report yet.</p>
    <p class="text-xs text-gray-400">Scores appear after the next generation.</p>
  </div>
{/if}
