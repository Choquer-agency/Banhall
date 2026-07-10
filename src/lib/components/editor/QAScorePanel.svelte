<!--
  QA scorecard content (BNH-47) — rail-native, no chrome of its own: the
  hosting QARailPanel provides header/close. Score gauge → per-section
  breakdown → compliance → flags → gaps → improvements → writer review
  (BNH-29). Renders an empty-state note when no scorecard is available.
-->
<script module lang="ts">
  import { z } from "zod";
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

  const qaScorecardSchema = z.object({
    overall_score: z.number().finite(),
    section_scores: z.record(
      z.string(),
      z.object({
        score: z.number().finite().default(0),
        issues: z.array(z.string()).default([]),
        strengths: z.array(z.string()).default([]),
      })
    ).default({}),
    cra_compliance: z.record(z.string(), z.boolean()).default({}),
    hallucination_risks: z.array(z.string()).default([]),
    ai_language_flags: z.array(z.string()).default([]),
    superlative_flags: z.array(z.string()).default([]),
    gaps_requiring_client_followup: z.array(
      z.object({
        section: z.string(),
        paragraph: z.number().int().nonnegative(),
        question: z.string(),
      })
    ).default([]),
    suggested_improvements: z.array(z.string()).default([]),
  });

  const reportDocumentSchema = z.object({
    content: z.array(
      z.object({
        type: z.string(),
        attrs: z.object({ language: z.string().optional() }).optional(),
        content: z.array(z.object({ text: z.string().optional() })).optional(),
      })
    ).default([]),
  });

  function parseScorecard(raw: unknown): QAScorecard | null {
    const parsed = qaScorecardSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  }

</script>

<script lang="ts">
  import { useQuery, useMutation } from "convex-svelte";
  import Tooltip from "$lib/components/ui/Tooltip.svelte";
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
    const direct = parseScorecard(rawQa);
    if (direct) return direct;
    if (agentOutputs) {
      try {
        const parsed: unknown = JSON.parse(agentOutputs);
        if (typeof parsed === "object" && parsed !== null && "qa" in parsed) {
          const fromAgent = parseScorecard(parsed.qa);
          if (fromAgent) return fromAgent;
        }
      } catch {
        // Fall through to the legacy report payload.
      }
    }
    if (reportContent) {
      try {
        const parsedDocument = reportDocumentSchema.safeParse(JSON.parse(reportContent));
        if (parsedDocument.success) {
          const codeBlock = parsedDocument.data.content.find(
            (node) => node.type === "codeBlock" && node.attrs?.language === "json"
          );
          const rawText = codeBlock?.content?.[0]?.text;
          if (rawText) return parseScorecard(JSON.parse(rawText));
        }
      } catch {
        // No scorecard in this legacy report.
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

  // Issues/strengths per section collapse by default so the rail stays scannable.
  let openSections = $state<Record<string, boolean>>({});

  // T661 line numbers ("242") sort numerically; anything unexpected sinks to the end.
  function lineOrder(s: string): number {
    const n = parseInt(s, 10);
    return Number.isNaN(n) ? Number.MAX_SAFE_INTEGER : n;
  }

  // Follow-ups grouped per line, lines ascending, paragraphs ascending within.
  const gapGroups = $derived.by(() => {
    const bySection = new Map<string, QAScorecard["gaps_requiring_client_followup"]>();
    for (const gap of scorecard?.gaps_requiring_client_followup ?? []) {
      const arr = bySection.get(gap.section) ?? [];
      arr.push(gap);
      bySection.set(gap.section, arr);
    }
    return [...bySection.entries()]
      .sort((a, b) => lineOrder(a[0]) - lineOrder(b[0]) || a[0].localeCompare(b[0]))
      .map(([section, items]) => ({
        section,
        items: [...items].sort((a, b) => a.paragraph - b.paragraph),
      }));
  });
  let openGapGroups = $state<Record<string, boolean>>({});

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
          {@const noteCount = section.issues.length + section.strengths.length}
          {@const open = openSections[key] ?? false}
          <div class="rounded-lg border border-line-soft">
            <button
              type="button"
              onclick={() => (openSections[key] = !open)}
              disabled={noteCount === 0}
              aria-expanded={open}
              class="flex w-full items-center gap-3 px-3 py-2.5 text-left"
            >
              <span class="text-data w-8 flex-none font-semibold text-gray-700">{key}</span>
              <div class="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-gray-100">
                <div class={`h-full rounded-full ${c} transition-[width] duration-700 ease-out`} style={`width: ${section.score}%`}></div>
              </div>
              <span class="text-data w-7 flex-none text-right font-semibold text-gray-800">{section.score}</span>
              {#if noteCount > 0}
                <span class="flex flex-none items-center gap-1.5">
                  {#if section.issues.length > 0}
                    <span class="flex items-center gap-0.5 text-xs tabular-nums text-red-600">
                      <span class="h-1.5 w-1.5 rounded-full bg-red-400"></span>{section.issues.length}
                    </span>
                  {/if}
                  {#if section.strengths.length > 0}
                    <span class="flex items-center gap-0.5 text-xs tabular-nums text-green-700">
                      <span class="h-1.5 w-1.5 rounded-full bg-green-500"></span>{section.strengths.length}
                    </span>
                  {/if}
                  <svg
                    class={`h-3.5 w-3.5 text-gray-400 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"
                  >
                    <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </span>
              {/if}
            </button>
            {#if open && noteCount > 0}
              <ul class="space-y-1 px-3 pb-2.5">
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

    <!-- Language flags: typed rows, not pills — flags are phrases and wrap badly in pills -->
    {#if scorecard.ai_language_flags.length > 0 || scorecard.superlative_flags.length > 0}
      <div>
        <p class="text-label mb-2.5">Language flags</p>
        <ul class="space-y-1.5">
          {#each scorecard.ai_language_flags as flag, i (`ai-${i}`)}
            <li class="flex items-start gap-2">
              <span class="mt-0.5 flex-none rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">AI</span>
              <span class="min-w-0 text-xs leading-relaxed text-gray-700">{flag}</span>
            </li>
          {/each}
          {#each scorecard.superlative_flags as flag, i (`sup-${i}`)}
            <li class="flex items-start gap-2">
              <span class="mt-0.5 flex-none rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-700">Superlative</span>
              <span class="min-w-0 text-xs leading-relaxed text-gray-700">{flag}</span>
            </li>
          {/each}
        </ul>
      </div>
    {/if}

    <!-- Client follow-ups: one collapsible group per T661 line, paragraphs ascending -->
    {#if gapGroups.length > 0}
      <div>
        <p class="text-label mb-2.5">Client follow-ups</p>
        <div class="space-y-1.5">
          {#each gapGroups as group (group.section)}
            {@const open = openGapGroups[group.section] ?? gapGroups.length === 1}
            <div class="overflow-hidden rounded-lg border border-amber-200/70">
              <button
                type="button"
                onclick={() => (openGapGroups[group.section] = !open)}
                aria-expanded={open}
                class="flex w-full items-center gap-2 bg-gap-bg px-2.5 py-2 text-left transition-colors hover:bg-amber-100/50"
              >
                <span class="text-data font-semibold text-gap-text">Line {group.section}</span>
                <span class="rounded-full bg-amber-200/70 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-gap-text">
                  {group.items.length}
                </span>
                <svg
                  class={`ml-auto h-3.5 w-3.5 flex-none text-gap-text/50 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"
                >
                  <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {#if open}
                <div class="divide-y divide-amber-200/40 border-t border-amber-200/50 bg-gap-bg/60">
                  {#each group.items as gap, i (`${gap.paragraph}-${i}`)}
                    {#if onLocateGap}
                      {@const locate = onLocateGap}
                      <button
                        type="button"
                        onclick={() => locate({ section: gap.section, paragraph: gap.paragraph })}
                        class="group flex w-full items-start gap-2 px-2.5 py-2 text-left transition-colors hover:bg-amber-100/40"
                      >
                        <Tooltip text="Jump to this paragraph" side="top" delayDuration={300}>
                          {#snippet children({ props })}
                            <span {...props} class="mt-0.5 flex-none">
                              <svg class="h-3.5 w-3.5 text-gap-text/50 transition-colors group-hover:text-gap-text" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                                <path stroke-linecap="round" stroke-linejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                              </svg>
                            </span>
                          {/snippet}
                        </Tooltip>
                        <span class="min-w-0">
                          <span class="text-data block text-gap-text/70">Paragraph {gap.paragraph}</span>
                          <span class="mt-0.5 block text-xs leading-relaxed text-gap-text">{gap.question}</span>
                        </span>
                      </button>
                    {:else}
                      <div class="px-2.5 py-2">
                        <p class="text-data text-gap-text/70">Paragraph {gap.paragraph}</p>
                        <p class="mt-0.5 text-xs leading-relaxed text-gap-text">{gap.question}</p>
                      </div>
                    {/if}
                  {/each}
                </div>
              {/if}
            </div>
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
        <label class="mt-2.5 block text-xs font-medium text-gray-600" for="writer-review-score">
          Your score<span class="ml-0.5 text-red-500" aria-hidden="true">*</span>
        </label>
        <div class="mt-1 flex items-center gap-2">
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
        <label class="mt-3 block text-xs font-medium text-gray-600" for="writer-review-comment">
          Feedback<span class="ml-0.5 text-red-500" aria-hidden="true">*</span>
        </label>
        <textarea
          id="writer-review-comment"
          value={reviewComment}
          oninput={(e) => (draft = { score: reviewScore, comment: e.currentTarget.value })}
          rows="3"
          required
          placeholder="What worked, what to fix…"
          class="mt-1 w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400"
        ></textarea>
        <button
          type="button"
          onclick={saveReview}
          disabled={saving || reviewScore === "" || reviewComment.trim() === "" || (hasReview && !dirty)}
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
