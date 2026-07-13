<!--
  QA scorecard content (BNH-47) — rail-native, no chrome of its own: the
  hosting QARailPanel provides header/close. Score gauge → per-section
  breakdown → compliance → flags → gaps → improvements → writer review
  (BNH-29). Renders an empty-state note when no scorecard is available.
-->
<script module lang="ts">
  import { z } from "zod";
  interface QAIssue {
    text: string;
    severity: "deduction" | "warning";
    deduction?: number;
    paragraph?: number | null;
  }

  interface QAScorecard {
    overall_score: number;
    section_scores: Record<string, { score: number; issues: QAIssue[]; strengths: string[] }>;
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

  type QAGroupItem =
    | { kind: "issue"; issue: QAIssue; originalIndex: number }
    | { kind: "strength"; text: string; originalIndex: number };

  interface QAGroup {
    key: "issues" | "warnings" | "correct";
    label: "Issues" | "Warnings" | "Correct";
    items: QAGroupItem[];
  }

  const qaScorecardSchema = z.object({
    overall_score: z.number().finite(),
    section_scores: z.record(
      z.string(),
      z.object({
        score: z.number().finite().default(0),
        issues: z.array(z.union([
          z.string().transform((text): QAIssue => ({ text, severity: "deduction" })),
          z.object({
            text: z.string(),
            severity: z.enum(["deduction", "warning"]),
            deduction: z.number().positive().optional(),
            paragraph: z.number().int().positive().nullable().optional(),
          }),
        ])).default([]),
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
  import { Popover } from "bits-ui";
  import * as Tooltip from "$lib/components/ui/tooltip/index.js";
  import { adjustedQaScores, issueDeduction } from "$lib/qaScoring";
  import { api } from "../../../../convex/_generated/api";
  import type { Id } from "../../../../convex/_generated/dataModel";


  let {
    agentOutputs,
    reportContent,
    reportId,
    candidateId,
    rawQa = null,
    onLocateGap,
  }: {
    agentOutputs?: string | null;
    reportContent?: string | null;
    reportId?: Id<"reports">;
    candidateId?: Id<"reportCandidates">;
    /** Pre-parsed QA object from candidate option generation. */
    rawQa?: unknown;
    /** Jump to + highlight a QA observation in the report or candidate preview. A null paragraph is section-wide. */
    onLocateGap?: (gap: { section: string; paragraph: number | null }) => void;
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


  const feedbackTarget = $derived(
    candidateId ? ({ candidateId } as const) : reportId ? ({ reportId } as const) : null
  );
  const itemFeedbackQ = useQuery(api.reviews.getMyQaItemFeedback, () =>
    feedbackTarget ? { target: feedbackTarget } : "skip"
  );
  const saveItemFeedback = useMutation(api.reviews.saveQaItemFeedback);
  const itemFeedback = $derived.by(() =>
    new Map((itemFeedbackQ.data ?? []).map((row) => [row.itemKey, row]))
  );
  let feedbackSaving = $state<Record<string, boolean>>({});

  function qaItemKey(kind: "issue" | "strength", section: string, index: number): string {
    return `${kind}:${section}:${index}`;
  }

  function effectiveSeverity(issue: QAIssue, itemKey: string): "deduction" | "warning" {
    const severity = itemFeedback.get(itemKey)?.overrideSeverity ?? issue.severity;
    return severity === "deduction" && issueDeduction(issue) === 0 ? "warning" : severity;
  }

  function sectionQaGroups(
    sectionKey: string,
    section: QAScorecard["section_scores"][string]
  ): QAGroup[] {
    const issueRows = section.issues.map((issue, originalIndex) => ({ issue, originalIndex }));
    return [
      {
        key: "issues",
        label: "Issues",
        items: issueRows
          .filter(({ issue, originalIndex }) => effectiveSeverity(issue, qaItemKey("issue", sectionKey, originalIndex)) === "deduction")
          .map(({ issue, originalIndex }) => ({ kind: "issue" as const, issue, originalIndex })),
      },
      {
        key: "warnings",
        label: "Warnings",
        items: issueRows
          .filter(({ issue, originalIndex }) => effectiveSeverity(issue, qaItemKey("issue", sectionKey, originalIndex)) === "warning")
          .map(({ issue, originalIndex }) => ({ kind: "issue" as const, issue, originalIndex })),
      },
      {
        key: "correct",
        label: "Correct",
        items: section.strengths.map((text, originalIndex) => ({ kind: "strength" as const, text, originalIndex })),
      },
    ].filter((group) => group.items.length > 0) as QAGroup[];
  }

  const adjustedScores = $derived.by(() => {
    if (!scorecard) return { overall: 0, sections: {} as Record<string, number> };
    return adjustedQaScores(
      scorecard.overall_score,
      scorecard.section_scores,
      (sectionKey, index, issue) => effectiveSeverity(issue, qaItemKey("issue", sectionKey, index))
    );
  });

  async function updateItemFeedback(args: {
    itemKey: string;
    itemKind: "issue" | "strength";
    section: string;
    itemText: string;
    originalSeverity?: "deduction" | "warning";
    overrideSeverity?: "deduction" | "warning" | null;
    vote?: -1 | 1 | null;
  }) {
    if (!feedbackTarget) return;
    const current = itemFeedback.get(args.itemKey);
    feedbackSaving[args.itemKey] = true;
    try {
      await saveItemFeedback({
        target: feedbackTarget,
        ...args,
        overrideSeverity: "overrideSeverity" in args ? args.overrideSeverity : (current?.overrideSeverity ?? undefined),
        vote: "vote" in args ? args.vote : (current?.vote ?? undefined),
      });
    } finally {
      feedbackSaving[args.itemKey] = false;
    }
  }

  /** Some legacy deterministic deductions mention P# in their prose but stored
   * paragraph=null. Preserve explicit structured metadata, then recover only an
   * unambiguous P# reference from the issue text. */
  function issueParagraph(issue: QAIssue): number | null {
    if (issue.paragraph != null) return issue.paragraph;
    const match = issue.text.match(/\bP(\d+)\b/i);
    return match ? Number(match[1]) : null;
  }

  /** The deduction is rendered as a (−N) suffix, so the agent's "Deduct N
   * point(s)." sentence is redundant in the visible copy. */
  function displayIssueText(text: string): string {
    return text.replace(/\s*Deduct\s+\d+(?:\.\d+)?\s+points?\.?/gi, "").trim();
  }

  function locateItem(section: string, paragraph?: number | null) {
    onLocateGap?.({ section, paragraph: paragraph ?? null });
  }

  const overall = $derived(adjustedScores.overall);
  const band = $derived(
    overall >= 80 ? "text-green-600" : overall >= 60 ? "text-amber-600" : "text-red-600"
  );

  // Issues/strengths per section collapse by default so the rail stays scannable.
  let openSections = $state<Record<string, boolean>>({});
  let openFeedbackKey = $state<string | null>(null);

  function setFeedbackMenuOpen(itemKey: string, open: boolean) {
    if (open) openFeedbackKey = itemKey;
    else if (openFeedbackKey === itemKey) openFeedbackKey = null;
  }

  // bits-ui auto-focuses the first focusable control on open, which shows
  // the select's focus ring (issue cards) or a vote button's tooltip
  // (warning/correct cards). Focus the popover container instead; Tab
  // still reaches the controls from there.
  function focusFeedbackContainer(itemKey: string, event: Event) {
    event.preventDefault();
    requestAnimationFrame(() => {
      document.getElementById(`qa-feedback-${itemKey}`)?.focus({ preventScroll: true });
    });
  }

  function restoreFeedbackTrigger(itemKey: string, event: Event) {
    event.preventDefault();
    document.getElementById(`qa-feedback-trigger-${itemKey}`)?.focus({ preventScroll: true });
  }


  function voteButtonClass(choice: 1 | -1, selected: boolean): string {
    const base = "flex h-6 w-6 items-center justify-center rounded-md border transition-colors";
    if (choice === 1) {
      return `${base} ${selected
        ? "border-green-500 bg-green-50 text-green-700 hover:border-green-500 hover:bg-green-50 hover:text-green-700"
        : "border-line-soft bg-white text-gray-500 hover:border-green-500 hover:bg-green-50 hover:text-green-700"}`;
    }
    return `${base} ${selected
      ? "border-red-500 bg-red-50 text-red-700 hover:border-red-500 hover:bg-red-50 hover:text-red-700"
      : "border-line-soft bg-white text-gray-500 hover:border-red-500 hover:bg-red-50 hover:text-red-700"}`;
  }

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
          {@const sectionScore = adjustedScores.sections[key] ?? section.score}
          {@const c = sectionScore >= 80 ? "bg-green-500" : sectionScore >= 60 ? "bg-amber-500" : "bg-red-500"}
          {@const noteCount = section.issues.length + section.strengths.length}
          {@const open = openSections[key] ?? false}
          {@const qaGroups = sectionQaGroups(key, section)}
          <div class="overflow-hidden rounded-lg border border-line-soft bg-gray-50/35">
            <button
              type="button"
              onclick={() => (openSections[key] = !open)}
              disabled={noteCount === 0}
              aria-expanded={open}
              class="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-gray-50/80 disabled:hover:bg-transparent"
            >
              <span class="text-data w-8 flex-none font-semibold text-gray-700">{key}</span>
              <div class="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-gray-200">
                <div class={`h-full rounded-full ${c} transition-[width] duration-700 ease-out`} style={`width: ${sectionScore}%`}></div>
              </div>
              <span class="text-data w-7 flex-none text-right font-semibold text-gray-700">{sectionScore}</span>
              {#if noteCount > 0}
                <span class="flex flex-none items-center gap-2">
                  {#if section.issues.length > 0}
                    <span class="flex items-center gap-1 text-[10px] tabular-nums text-red-600">
                      <span class="h-1 w-1 rounded-full bg-red-400"></span>{section.issues.length}
                    </span>
                  {/if}
                  {#if section.strengths.length > 0}
                    <span class="flex items-center gap-1 text-[10px] tabular-nums text-green-700">
                      <span class="h-1 w-1 rounded-full bg-green-500"></span>{section.strengths.length}
                    </span>
                  {/if}
                  <svg
                    class={`ml-0.5 h-3.5 w-3.5 text-gray-400 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"
                  >
                    <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </span>
              {/if}
            </button>
            {#if open && noteCount > 0}
              <ul class="space-y-1 border-t border-line-soft bg-white/70 px-3 py-2.5">
                {#each qaGroups as group (group.key)}
                  <li class="flex items-center gap-2 px-0.5 pb-0.5 pt-1 first:pt-0">
                    <span class={`text-[10px] font-semibold uppercase tracking-[0.08em] ${group.key === "issues" ? "text-red-700" : group.key === "warnings" ? "text-amber-700" : "text-green-700"}`}>{group.label}</span>
                    <span class={`inline-flex h-4 min-w-4 flex-none items-center justify-center rounded-full px-1 text-[10px] font-semibold tabular-nums ${group.key === "issues" ? "bg-red-200/70 text-red-700" : group.key === "warnings" ? "bg-amber-200/70 text-amber-700" : "bg-green-200/70 text-green-700"}`}>{group.items.length}</span>
                  </li>
                  {#each group.items as row (`${row.kind}-${row.originalIndex}`)}
                    {#if row.kind === "issue"}
                      {@const issue = row.issue}
                      {@const i = row.originalIndex}
                      {@const itemKey = qaItemKey("issue", key, i)}
                      {@const severity = effectiveSeverity(issue, itemKey)}
                      {@const warning = severity === "warning"}
                      {@const feedback = itemFeedback.get(itemKey)}
                  <li class={`group relative rounded-md border px-2.5 py-2 pr-9 text-[12px] transition-colors ${warning ? "border-amber-200/80 bg-amber-50/35 hover:border-amber-300 hover:bg-amber-50/60" : "border-red-200/80 bg-red-50/35 hover:border-red-300 hover:bg-red-50/60"}`}>
                    <Tooltip.Root>
                      <Tooltip.Trigger>
                        {#snippet child({ props })}
                          <button
                            {...props}
                            type="button"
                            onclick={() => locateItem(key, issueParagraph(issue))}
                            disabled={!onLocateGap}
                            class={`flex w-full items-start gap-2 text-left ${warning ? "text-amber-800" : "text-red-700"} disabled:cursor-default`}
                          >
                            <span class={`mt-1.5 h-1.5 w-1.5 flex-none rounded-full ${warning ? "bg-amber-500" : "bg-red-500"}`}></span>
                            <span class="min-w-0 flex-1">
                              <span class="block leading-relaxed">{displayIssueText(issue.text)}{!warning && issueDeduction(issue) > 0 ? ` (−${issueDeduction(issue)})` : ""}</span>
                            </span>
                          </button>
                        {/snippet}
                      </Tooltip.Trigger>
                      {#if onLocateGap}
                        <Tooltip.Content side="top" sideOffset={6}>Go to mentioned paragraph</Tooltip.Content>
                      {/if}
                    </Tooltip.Root>
                    {#if feedbackTarget}
                      <Tooltip.Root>
                      <Popover.Root open={openFeedbackKey === itemKey} onOpenChange={(isOpen) => setFeedbackMenuOpen(itemKey, isOpen)}>
                        <Tooltip.Trigger>
                          {#snippet child({ props })}
                            <Popover.Trigger
                              {...props}
                              id={`qa-feedback-trigger-${itemKey}`}
                              aria-label={`Review options for ${issue.text}`}
                              class="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-md text-gray-500 opacity-70 transition-colors hover:bg-white/80 hover:text-navy focus:outline-none focus-visible:ring-2 focus-visible:ring-primary group-hover:opacity-100 data-[state=open]:opacity-100"
                            >
                              <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                <circle cx="5" cy="12" r="1.75" />
                                <circle cx="12" cy="12" r="1.75" />
                                <circle cx="19" cy="12" r="1.75" />
                              </svg>
                            </Popover.Trigger>
                          {/snippet}
                        </Tooltip.Trigger>
                        <Tooltip.Content side="top" sideOffset={6}>Review options</Tooltip.Content>
                        <Popover.Portal>
                          <Popover.Content id={`qa-feedback-${itemKey}`} tabindex={-1} onOpenAutoFocus={(event) => focusFeedbackContainer(itemKey, event)} onCloseAutoFocus={(event) => restoreFeedbackTrigger(itemKey, event)} side="bottom" align="end" sideOffset={6} class="z-50 w-64 rounded-lg border border-line-soft bg-white p-3 shadow-lg outline-none">
                            <div class="block text-[10px] font-medium text-gray-500">
                              <label for={`qa-category-${itemKey}`} class="block">Category</label>
                              <select
                                id={`qa-category-${itemKey}`}
                                aria-label={`Category for ${issue.text}`}
                                value={severity}
                                disabled={feedbackSaving[itemKey] || issueDeduction(issue) === 0}
                                class="mt-1 w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs font-normal text-gray-900 transition-colors hover:border-gray-300 focus:outline-none focus-visible:border-navy focus-visible:ring-1 focus-visible:ring-navy disabled:opacity-50"
                                onchange={(event) => {
                                  // Close first: the severity change moves the card to another
                                  // group, which would drag the open popover around with it.
                                  const overrideSeverity = event.currentTarget.value as "deduction" | "warning";
                                  setFeedbackMenuOpen(itemKey, false);
                                  updateItemFeedback({
                                    itemKey,
                                    itemKind: "issue",
                                    section: key,
                                    itemText: issue.text,
                                    originalSeverity: issue.severity,
                                    overrideSeverity,
                                  });
                                }}
                              >
                                <option value="deduction">Deduction</option>
                                <option value="warning">Warning</option>
                              </select>
                            </div>
                            {#if issueDeduction(issue) === 0}
                              <p class="mt-1.5 text-[10px] leading-relaxed text-gray-500">No deduction amount is available, so this item remains a warning.</p>
                            {/if}
                            <div class="mt-3 flex items-center gap-1.5 border-t border-line-soft pt-2.5" aria-label="Rate this QA item">
                              <span class="mr-auto text-[10px] font-medium text-gray-500">Was this useful?</span>
                              {#each [{ value: 1 as const, label: "Useful", path: "M7 10v10M7 10l4-7a2 2 0 013 2v3h4a2 2 0 012 2l-1 8a2 2 0 01-2 2H7M7 10H4v10h3" }, { value: -1 as const, label: "Not useful", path: "M17 14V4M17 14l-4 7a2 2 0 01-3-2v-3H6a2 2 0 01-2-2l1-8a2 2 0 012-2h10M17 14h3V4h-3" }] as choice (choice.value)}
                                <button
                                  type="button"
                                  aria-label={`${choice.label}: ${issue.text}`}
                                  aria-pressed={feedback?.vote === choice.value}
                                  disabled={feedbackSaving[itemKey]}
                                  onclick={() => updateItemFeedback({ itemKey, itemKind: "issue", section: key, itemText: issue.text, originalSeverity: issue.severity, vote: feedback?.vote === choice.value ? null : choice.value })}
                                  class={voteButtonClass(choice.value, feedback?.vote === choice.value)}
                                >
                                  <svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d={choice.path} /></svg>
                                </button>
                              {/each}
                            </div>
                          </Popover.Content>
                        </Popover.Portal>
                      </Popover.Root>
                      </Tooltip.Root>
                    {/if}
                  </li>
                    {:else}
                      {@const str = row.text}
                      {@const i = row.originalIndex}
                      {@const itemKey = qaItemKey("strength", key, i)}
                      {@const feedback = itemFeedback.get(itemKey)}
                  <li class="group relative rounded-md border border-line-soft bg-gray-50/35 px-2.5 py-2 pr-9 text-[12px] text-green-800 transition-colors hover:bg-gray-50/80">
                    <div class="flex w-full items-start gap-2 text-left">
                      <span class="mt-1.5 h-1.5 w-1.5 flex-none rounded-full bg-green-500"></span>
                      <span class="min-w-0 flex-1 leading-relaxed">{str}</span>
                    </div>
                    {#if feedbackTarget}
                      <Tooltip.Root>
                      <Popover.Root open={openFeedbackKey === itemKey} onOpenChange={(isOpen) => setFeedbackMenuOpen(itemKey, isOpen)}>
                        <Tooltip.Trigger>
                          {#snippet child({ props })}
                            <Popover.Trigger {...props} id={`qa-feedback-trigger-${itemKey}`} aria-label={`Review options for ${str}`} class="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-md text-gray-500 opacity-70 transition-colors hover:bg-white/80 hover:text-navy focus:outline-none focus-visible:ring-2 focus-visible:ring-primary group-hover:opacity-100 data-[state=open]:opacity-100">
                              <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.75" /><circle cx="12" cy="12" r="1.75" /><circle cx="19" cy="12" r="1.75" /></svg>
                            </Popover.Trigger>
                          {/snippet}
                        </Tooltip.Trigger>
                        <Tooltip.Content side="top" sideOffset={6}>Review options</Tooltip.Content>
                        <Popover.Portal>
                          <Popover.Content id={`qa-feedback-${itemKey}`} tabindex={-1} onOpenAutoFocus={(event) => focusFeedbackContainer(itemKey, event)} onCloseAutoFocus={(event) => restoreFeedbackTrigger(itemKey, event)} side="bottom" align="end" sideOffset={6} class="z-50 w-56 rounded-lg border border-line-soft bg-white p-3 shadow-lg outline-none">
                            <div class="flex items-center gap-1.5" aria-label="Rate this QA item">
                              <span class="mr-auto text-[10px] font-medium text-gray-500">Was this useful?</span>
                              {#each [{ value: 1 as const, label: "Useful", path: "M7 10v10M7 10l4-7a2 2 0 013 2v3h4a2 2 0 012 2l-1 8a2 2 0 01-2 2H7M7 10H4v10h3" }, { value: -1 as const, label: "Not useful", path: "M17 14V4M17 14l-4 7a2 2 0 01-3-2v-3H6a2 2 0 01-2-2l1-8a2 2 0 012-2h10M17 14h3V4h-3" }] as choice (choice.value)}
                                <button
                                  type="button"
                                  aria-label={`${choice.label}: ${str}`}
                                  aria-pressed={feedback?.vote === choice.value}
                                  disabled={feedbackSaving[itemKey]}
                                  onclick={() => updateItemFeedback({ itemKey, itemKind: "strength", section: key, itemText: str, vote: feedback?.vote === choice.value ? null : choice.value })}
                                  class={voteButtonClass(choice.value, feedback?.vote === choice.value)}
                                >
                                  <svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d={choice.path} /></svg>
                                </button>
                              {/each}
                            </div>
                          </Popover.Content>
                        </Popover.Portal>
                      </Popover.Root>
                      </Tooltip.Root>
                    {/if}
                  </li>
                    {/if}
                  {/each}
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
            <div class="overflow-hidden rounded-lg border border-amber-200/60">
              <button
                type="button"
                onclick={() => (openGapGroups[group.section] = !open)}
                aria-expanded={open}
                class="flex w-full items-center gap-2 bg-amber-50/55 px-2.5 py-2 text-left transition-colors hover:bg-amber-50/90"
              >
                <span class="text-data font-semibold text-gap-text">Line {group.section}</span>
                <span class="inline-flex h-4 min-w-4 flex-none items-center justify-center rounded-full bg-amber-200/70 px-1 text-[10px] font-semibold tabular-nums text-gap-text">
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
                <div class="divide-y divide-amber-200/35 border-t border-amber-200/40 bg-amber-50/30">
                  {#each group.items as gap, i (`${gap.paragraph}-${i}`)}
                    {#if onLocateGap}
                      {@const locate = onLocateGap}
                      <button
                        type="button"
                        onclick={() => locate({ section: gap.section, paragraph: gap.paragraph })}
                        class="group flex w-full items-start gap-2 px-2.5 py-2 text-left transition-colors hover:bg-amber-50/75"
                      >
                        <Tooltip.Root>
                          <Tooltip.Trigger>
                            {#snippet child({ props })}
                              <span {...props} class="mt-0.5 flex-none">
                                <svg class="h-3.5 w-3.5 text-gap-text/50 transition-colors group-hover:text-gap-text" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                                  <path stroke-linecap="round" stroke-linejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                                  <path stroke-linecap="round" stroke-linejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                                </svg>
                              </span>
                            {/snippet}
                          </Tooltip.Trigger>
                          <Tooltip.Content side="top" sideOffset={6}>Jump to this paragraph</Tooltip.Content>
                        </Tooltip.Root>
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

    <!-- BNH-29: writer's own review — after reading the AI's take. Full-bleed
       footer section (negative margins cancel the rail's px-5/py-5 padding),
       same faint primary surface as the option-comment footer. -->
    {#if reportId}
      <div class="-mx-5 -mb-5 mt-1 border-t border-primary/15 bg-primary/5 px-5 py-4">
        <div class="flex items-center justify-between gap-2">
          <p class="text-xs font-semibold text-navy">Your review</p>
          {#if hasReview && !dirty && !saving}
            <span class="inline-flex flex-none items-center gap-1 text-[10px] font-medium text-green-700">
              <svg class="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
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
            class="w-20 rounded-lg border border-primary/20 bg-white px-2.5 py-1.5 text-sm font-semibold text-navy outline-none transition-colors placeholder:text-gray-400 focus:border-primary"
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
          class="mt-1 w-full resize-none rounded-lg border border-primary/20 bg-white px-3 py-2 text-sm text-gray-800 outline-none transition-colors placeholder:text-gray-400 focus:border-primary"
        ></textarea>
        <button
          type="button"
          onclick={saveReview}
          disabled={saving || reviewScore === "" || reviewComment.trim() === "" || (hasReview && !dirty)}
          class="mt-2 inline-flex h-8 w-full items-center justify-center rounded-lg bg-primary px-3.5 text-sm font-semibold text-white transition-colors hover:bg-primary-dark disabled:opacity-50"
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
