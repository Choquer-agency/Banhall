<!--
  QA scorecard content (BNH-47) — rail-native, no chrome of its own: the
  hosting QARailPanel provides header/close. Score gauge → per-section
  breakdown → compliance → flags → gaps → improvements → writer review
  (BNH-29). Renders an empty-state note when no scorecard is available.
-->
<script module lang="ts">
  import { z } from "zod";
  import { qaScorecardSchema } from "../../../../shared/qaScorecard";
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
      /** Null/absent when the gap spans the section rather than one paragraph. */
      paragraph?: number | null;
      question: string;
    }>;
    suggested_improvements: string[];
  }

  type QAGroupItem =
    | { kind: "issue"; issue: QAIssue; originalIndex: number }
    | { kind: "strength"; text: string; originalIndex: number };

  interface QAGroup {
    key: "issues" | "warnings" | "correct";
    label: "Issues" | "Warnings" | "Strengths";
    items: QAGroupItem[];
  }

  // The scorecard contract lives in shared/ so this panel and the agent that
  // produces it validate against ONE definition. Three separate declarations
  // (TS interface, provider JSON Schema, this Zod schema) had already drifted
  // apart, which is what discarded a complete, valid scorecard.

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
  import SelectInput from "$lib/components/ui/SelectInput.svelte";
  import { adjustedQaScores, issueDeduction } from "$lib/qaScoring";
  import { qaBandColors } from "$lib/qa/qaBands";
  import { formatEdited } from "$lib/components/project/details/detailsFormat";
  import { canOverrideQaSeverity } from "../../../../shared/roles";
  import { api } from "../../../../convex/_generated/api";
  import type { Id } from "../../../../convex/_generated/dataModel";


  let {
    agentOutputs,
    reportContent,
    reportId,
    candidateId,
    rawQa = null,
    onLocateGap,
    onRunQa,
    postQaStatus = null,
    variant = "card",
    title = "QA score",
    onClose,
    lastRunAt = null,
  }: {
    agentOutputs?: string | null;
    reportContent?: string | null;
    reportId?: Id<"reports">;
    candidateId?: Id<"reportCandidates">;
    /** Pre-parsed QA object from candidate option generation. */
    rawQa?: unknown;
    /** Jump to + highlight a QA observation in the report or candidate preview. A null paragraph is section-wide. */
    onLocateGap?: (gap: { section: string; paragraph: number | null }) => void;
    /** Iterative reports: trigger the post-assembly QA pass on demand. */
    onRunQa?: () => Promise<void> | void;
    /** Server-side pass state — survives closing/reopening this panel. */
    postQaStatus?: "running" | "done" | "failed" | null;
    /**
     * "side" is the report page's QA panel (board 2.2): the panel draws its
     * own header ("QA score", Re-run, close) and bleeds its footer to 24px.
     * "card" keeps the host card's header and the Re-run in the score line.
     */
    variant?: "card" | "side";
    title?: string;
    onClose?: () => void;
    /** When the scorecard was last produced, for "last run 2 min ago". */
    lastRunAt?: number | null;
  } = $props();

  const side = $derived(variant === "side");

  // Refresh the "last run" phrase once a minute.
  let now = $state(Date.now());
  $effect(() => {
    if (!lastRunAt) return;
    const timer = setInterval(() => (now = Date.now()), 60_000);
    return () => clearInterval(timer);
  });
  const lastRunLabel = $derived.by(() => {
    if (!lastRunAt) return null;
    const when = formatEdited(lastRunAt, now);
    if (when === "Just now" || when === "Yesterday") return `last run ${when.toLowerCase()}`;
    if (/ago$/.test(when)) return `last run ${when}`;
    return `last run on ${when}`;
  });

  // Local flag only bridges the click → server-status round trip.
  let runningQaLocal = $state(false);
  const qaRunning = $derived(runningQaLocal || postQaStatus === "running");
  async function handleRunQa() {
    if (!onRunQa || qaRunning) return;
    runningQaLocal = true;
    try {
      await onRunQa();
    } catch (error) {
      // Swallowed deliberately: this runs from a click handler, where a
      // rejection would surface as an unhandled promise error.
      console.error("QA scorecard could not be started", error);
    } finally {
      // Always hand back to server state. Clearing only on error meant a
      // successful call that didn't flip postQaStatus (already done, or a
      // no-op because a pass was in flight) left the spinner up forever,
      // which is indistinguishable from a stalled run.
      runningQaLocal = false;
    }
  }

  /**
   * True when a scorecard was produced but could not be read.
   *
   * "Absent" and "unreadable" used to look identical — both showed "No QA
   * scorecard yet" with a Run button, so a complete, paid-for scorecard that
   * failed validation was indistinguishable from one that never ran, and every
   * retry burned another API call into the void. Telling them apart is what
   * turns that from a database investigation into a glance.
   */
  const scorecardState = $derived.by((): {
    scorecard: QAScorecard | null;
    unreadable: boolean;
  } => {
    let sawUnreadablePayload = false;

    const direct = parseScorecard(rawQa);
    if (direct) return { scorecard: direct, unreadable: false };
    if (rawQa != null) sawUnreadablePayload = true;

    if (agentOutputs) {
      try {
        const parsed: unknown = JSON.parse(agentOutputs);
        if (typeof parsed === "object" && parsed !== null && "qa" in parsed) {
          const fromAgent = parseScorecard(parsed.qa);
          if (fromAgent) return { scorecard: fromAgent, unreadable: false };
          if (parsed.qa != null) {
            sawUnreadablePayload = true;
            console.error(
              "QA scorecard failed validation — stored payload does not match the expected shape",
              qaScorecardSchema.safeParse(parsed.qa).error?.issues
            );
          }
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
          if (rawText) {
            const legacy = parseScorecard(JSON.parse(rawText));
            if (legacy) return { scorecard: legacy, unreadable: false };
            sawUnreadablePayload = true;
          }
        }
      } catch {
        // No scorecard in this legacy report.
      }
    }

    return { scorecard: null, unreadable: sawUnreadablePayload };
  });

  const scorecard = $derived(scorecardState.scorecard);
  const scorecardUnreadable = $derived(scorecardState.unreadable);

  // Managers/admins may reclassify QA severity; consultants only vote/comment.
  const currentUserQ = useQuery(api.users.getCurrentUser, () => ({}));
  const canOverride = $derived(canOverrideQaSeverity(currentUserQ.data?.role));

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
        label: "Strengths",
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
    // Only send overrideSeverity when this call is actually changing it AND
    // the user is allowed to (manager/admin). When the key is absent the
    // server preserves any stored override, so a consultant vote can never
    // erase a manager's reclassification.
    const { overrideSeverity, vote, ...rest } = args;
    feedbackSaving[args.itemKey] = true;
    try {
      await saveItemFeedback({
        target: feedbackTarget,
        ...rest,
        ...("overrideSeverity" in args && canOverride ? { overrideSeverity } : {}),
        vote: "vote" in args ? vote : (current?.vote ?? undefined),
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

  // Follow-ups in line order, paragraphs ascending within a line; a
  // section-wide follow-up sorts after the located ones.
  const followUps = $derived(
    [...(scorecard?.gaps_requiring_client_followup ?? [])].sort(
      (a, b) =>
        lineOrder(a.section) - lineOrder(b.section) ||
        a.section.localeCompare(b.section) ||
        (a.paragraph ?? Infinity) - (b.paragraph ?? Infinity)
    )
  );

  /** "244, P2" for a located follow-up; the line alone for a section-wide one. */
  function followUpTag(gap: { section: string; paragraph?: number | null }): string {
    return gap.paragraph != null ? `${gap.section}, P${gap.paragraph}` : gap.section;
  }

  const COMPLIANCE_LABELS: Record<string, string> = {
    verbiage_present: "Verbiage present",
    why_how_why_intact: "Why, how, why intact",
    uncertainties_distinguished: "Uncertainties distinguished",
  };

  /** Sentence case for the compliance keys ("why_how_why_intact" reads "Why, how, why intact"). */
  function complianceLabel(key: string): string {
    const known = COMPLIANCE_LABELS[key];
    if (known) return known;
    const words = key.replace(/_/g, " ").trim();
    return words.charAt(0).toUpperCase() + words.slice(1);
  }

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

{#snippet rerunButton(label: string)}
  <button
    type="button"
    onclick={handleRunQa}
    disabled={qaRunning}
    title="Re-run the QA scorecard"
    class="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs text-ink-secondary transition-colors hover:bg-primary-wash hover:text-ink disabled:opacity-60"
  >
    {#if qaRunning}
      <span class="h-3 w-3 animate-spin rounded-full border-2 border-primary/30 border-t-primary motion-reduce:animate-none" aria-hidden="true"></span>
      Running
    {:else}
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
        <path d="M3 3v5h5" />
      </svg>
      {label}
    {/if}
  </button>
{/snippet}

<div class={`flex flex-col ${side ? "gap-[22px]" : "gap-6"}`}>
  {#if side}
    <!-- Board 2.2 header: "QA score", Re-run and close; no icon. -->
    <div class="flex h-7 shrink-0 items-center gap-2" data-qa-panel-header>
      <h2 class="min-w-0 flex-1 text-sm leading-[18px] font-medium text-ink">{title}</h2>
      {#if onRunQa && scorecard}
        {@render rerunButton("Re-run")}
      {/if}
      {#if onClose}
        <button
          type="button"
          onclick={onClose}
          title={`Close ${title}`}
          aria-label={`Close ${title}`}
          class="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-primary-wash hover:text-ink"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      {/if}
    </div>
  {/if}

{#if scorecard}
    <!-- Score line (ui-design-final.md section 8, board 2.2): quiet "78/100"
         with a band bar; the band colour carries the judgement. -->
    <div class="flex items-start gap-3.5">
      <div class="flex min-w-0 flex-1 flex-col gap-2" data-qa-score-line>
        <p class="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
          <span class="text-sm leading-5 font-medium tabular-nums text-ink-secondary" data-qa-overall>{overall}/100</span>
          <span class="text-xs leading-4 text-ink-muted" data-qa-score-meta>AI QA score{lastRunLabel ? `, ${lastRunLabel}` : ""}</span>
          {#if myReview}
            <span class="ml-auto inline-flex items-center rounded-full bg-chrome px-2 py-0.5 text-[11px] text-ink-secondary">
              You: {myReview.score}
            </span>
          {/if}
        </p>
        <div class="h-1 w-full overflow-hidden rounded-full bg-line-soft" aria-hidden="true">
          <div
            data-qa-overall-bar
            class="h-full rounded-full transition-[width] duration-700 ease-out motion-reduce:transition-none"
            style={`width: ${overall}%; background: ${qaBandColors(overall).bar}`}
          ></div>
        </div>
        {#if postQaStatus === "failed"}
          <!-- A failed re-run keeps the earlier scorecard (review f2 #1). -->
          <p class="text-xs leading-4 text-red-700" data-qa-last-run-failed>
            The last run failed. This score is from an earlier run.
          </p>
        {/if}
      </div>
      {#if onRunQa && !side}
        <!-- Jul 17: re-run on demand, replacing the stored scorecard. -->
        {@render rerunButton("Re-run")}
      {/if}
    </div>

    <!-- Per-section breakdown -->
    <div class="flex flex-col gap-2">
      <p class="text-[11px] leading-4 font-medium text-ink-muted">Sections</p>
      {#each Object.entries(scorecard.section_scores) as [key, section] (key)}
        {@const sectionScore = adjustedScores.sections[key] ?? section.score}
        {@const noteCount = section.issues.length + section.strengths.length}
        {@const open = openSections[key] ?? false}
        {@const qaGroups = sectionQaGroups(key, section)}
        <div class={`overflow-hidden rounded-md border border-line-soft ${open ? "bg-canvas" : ""}`} data-qa-section={key}>
          <button
            type="button"
            onclick={() => (openSections[key] = !open)}
            disabled={noteCount === 0}
            aria-expanded={open}
            class="flex h-9 w-full items-center gap-2.5 px-2.5 text-left transition-colors hover:bg-gray-50 disabled:hover:bg-transparent"
          >
            <span class="w-[26px] flex-none text-xs leading-4 font-medium tabular-nums text-ink">{key}</span>
            <span class="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-line-soft" aria-hidden="true">
              <span data-qa-section-bar class="block h-full rounded-full transition-[width] duration-700 ease-out motion-reduce:transition-none" style={`width: ${sectionScore}%; background: ${qaBandColors(sectionScore).bar}`}></span>
            </span>
            <span class="w-[22px] flex-none text-right text-xs leading-4 font-medium tabular-nums text-ink">{sectionScore}</span>
            <span class="flex w-11 flex-none items-center gap-1.5">
              {#if section.issues.length > 0}
                <span class="flex items-center gap-[3px] text-[10px] leading-3 tabular-nums text-ink-muted" title={`${section.issues.length} issue${section.issues.length === 1 ? "" : "s"}`}>
                  <span class="h-[5px] w-[5px] rounded-full bg-red-500" aria-hidden="true"></span>{section.issues.length}
                </span>
              {/if}
              {#if section.strengths.length > 0}
                <span class="flex items-center gap-[3px] text-[10px] leading-3 tabular-nums text-ink-muted" title={`${section.strengths.length} strength${section.strengths.length === 1 ? "" : "s"}`}>
                  <span class="h-[5px] w-[5px] rounded-full bg-green-500" aria-hidden="true"></span>{section.strengths.length}
                </span>
              {/if}
            </span>
            <svg
              class={`h-3 w-3 flex-none text-ink-muted transition-transform duration-200 motion-reduce:transition-none ${open ? "rotate-180" : ""} ${noteCount === 0 ? "invisible" : ""}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
          {#if open && noteCount > 0}
            <ul class="flex flex-col gap-2 px-2.5 pt-0.5 pb-3">
              {#each qaGroups as group, groupIndex (group.key)}
                <li class={`flex items-center gap-1.5 ${groupIndex > 0 ? "pt-1" : ""}`}>
                  <span class={`text-[10px] leading-3 font-medium uppercase tracking-[0.06em] ${group.key === "issues" ? "text-red-700" : group.key === "warnings" ? "text-yellow-700" : "text-green-700"}`}>{group.label}</span>
                  <span class={`inline-flex h-4 min-w-4 flex-none items-center justify-center rounded-full px-1 text-[10px] leading-3 font-medium tabular-nums ${group.key === "issues" ? "bg-red-100 text-red-700" : group.key === "warnings" ? "bg-gap-bg text-yellow-700" : "bg-green-100 text-green-700"}`}>{group.items.length}</span>
                </li>
                {#each group.items as row (`${row.kind}-${row.originalIndex}`)}
                  {#if row.kind === "issue"}
                    {@const issue = row.issue}
                    {@const i = row.originalIndex}
                    {@const itemKey = qaItemKey("issue", key, i)}
                    {@const severity = effectiveSeverity(issue, itemKey)}
                    {@const warning = severity === "warning"}
                    {@const feedback = itemFeedback.get(itemKey)}
                  <li class={`group relative rounded border py-2 pr-9 pl-2.5 text-xs leading-4 transition-colors ${warning ? "border-amber-200 bg-amber-50" : "border-red-200 bg-red-50"}`}>
                    <Tooltip.Root>
                      <Tooltip.Trigger>
                        {#snippet child({ props })}
                          <button
                            {...props}
                            type="button"
                            onclick={() => locateItem(key, issueParagraph(issue))}
                            disabled={!onLocateGap}
                            class={`flex w-full items-start gap-2 text-left ${warning ? "text-amber-900" : "text-red-900"} disabled:cursor-default`}
                          >
                            <span class={`mt-[5.5px] h-[5px] w-[5px] flex-none rounded-full ${warning ? "bg-amber-500" : "bg-red-500"}`}></span>
                            <span class="min-w-0 flex-1">{displayIssueText(issue.text)}{!warning && issueDeduction(issue) > 0 ? ` (−${issueDeduction(issue)})` : ""}</span>
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
                              <SelectInput
                                id={`qa-category-${itemKey}`}
                                size="sm"
                                value={severity}
                                items={[
                                  { value: "deduction", label: "Deduction" },
                                  { value: "warning", label: "Warning" },
                                ]}
                                placeholder={`Category for ${issue.text}`}
                                disabled={feedbackSaving[itemKey] || issueDeduction(issue) === 0 || !canOverride}
                                class="mt-1 w-full"
                                onValueChange={(next) => {
                                  // Guard the deselect-to-empty case and no-op re-selects so
                                  // only a real reclassification hits the mutation.
                                  if (next !== "deduction" && next !== "warning") return;
                                  if (next === severity) return;
                                  const overrideSeverity = next as "deduction" | "warning";
                                  // Close first: the severity change moves the card to another
                                  // group, which would drag the open popover around with it.
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
                              />
                            </div>
                            {#if issueDeduction(issue) === 0}
                              <p class="mt-1.5 text-[10px] leading-relaxed text-gray-500">No deduction amount is available, so this item remains a warning.</p>
                            {:else if !canOverride}
                              <p class="mt-1.5 text-[10px] leading-relaxed text-gray-500">Only managers can reclassify severity.</p>
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
                  <li class="group relative rounded border border-line-soft bg-surface py-2 pr-9 pl-2.5 text-xs leading-4 text-ink-secondary transition-colors">
                    <div class="flex w-full items-start gap-2 text-left">
                      <span class="mt-[5.5px] h-[5px] w-[5px] flex-none rounded-full bg-green-500"></span>
                      <span class="min-w-0 flex-1">{str}</span>
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

    <!-- CRA compliance: green check or red cross chips. -->
    {#if Object.keys(scorecard.cra_compliance).length > 0}
      <div class="flex flex-col gap-2">
        <p class="text-[11px] leading-4 font-medium text-ink-muted">CRA compliance</p>
        <ul class="flex flex-wrap gap-1.5">
          {#each Object.entries(scorecard.cra_compliance) as [key, value] (key)}
            <li
              data-qa-compliance={value ? "pass" : "fail"}
              class={`inline-flex h-[22px] items-center gap-[5px] rounded-full px-2 text-[11px] leading-[14px] ${
                value ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
              }`}
            >
              {#if value}
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M5 12l5 5L20 7" />
                </svg>
              {:else}
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              {/if}
              <span class="sr-only">{value ? "Met:" : "Not met:"}</span>
              {complianceLabel(key)}
            </li>
          {/each}
        </ul>
      </div>
    {/if}

    <!-- Language flags: typed rows, not pills; flags are phrases and wrap badly in pills. -->
    {#if scorecard.ai_language_flags.length > 0 || scorecard.superlative_flags.length > 0}
      <div class="flex flex-col gap-2">
        <p class="text-[11px] leading-4 font-medium text-ink-muted">Language flags</p>
        <ul class="flex flex-col gap-2">
          {#each scorecard.ai_language_flags as flag, i (`ai-${i}`)}
            <li class="flex items-start gap-2">
              <span class="flex h-[18px] flex-none items-center rounded bg-gap-bg px-1.5 text-[10px] leading-3 font-medium text-gap-text">AI</span>
              <span class="min-w-0 text-xs leading-[18px] text-ink-secondary">{flag}</span>
            </li>
          {/each}
          {#each scorecard.superlative_flags as flag, i (`sup-${i}`)}
            <li class="flex items-start gap-2">
              <span class="flex h-[18px] flex-none items-center rounded bg-red-100 px-1.5 text-[10px] leading-3 font-medium text-red-700">Superlative</span>
              <span class="min-w-0 text-xs leading-[18px] text-ink-secondary">{flag}</span>
            </li>
          {/each}
        </ul>
      </div>
    {/if}

    <!-- Client follow-ups: one simple row each, tagged "244, P2". -->
    {#if followUps.length > 0}
      <div class="flex flex-col gap-2">
        <p class="text-[11px] leading-4 font-medium text-ink-muted">Client follow-ups</p>
        <ul class="flex flex-col gap-2">
          {#each followUps as gap, i (`${gap.section}-${gap.paragraph}-${i}`)}
            <li class="flex flex-col gap-2 rounded-md border border-line-soft px-3 py-2.5" data-qa-follow-up>
              <span class="flex h-[18px] w-max items-center rounded border border-line px-1.5 font-mono text-[10px] leading-3 text-ink-secondary">{followUpTag(gap)}</span>
              <span class="text-xs leading-[18px] text-ink">{gap.question}</span>
              {#if onLocateGap}
                {@const locate = onLocateGap}
                <button
                  type="button"
                  onclick={() => locate({ section: gap.section, paragraph: gap.paragraph ?? null })}
                  class="w-max text-xs leading-4 text-primary-selected transition-colors hover:text-primary-dark hover:underline"
                >{gap.paragraph != null ? "Jump to paragraph" : "Jump to section"}</button>
              {/if}
            </li>
          {/each}
        </ul>
      </div>
    {/if}

    <!-- Suggested improvements -->
    {#if scorecard.suggested_improvements.length > 0}
      <div class="flex flex-col gap-2">
        <p class="text-[11px] leading-4 font-medium text-ink-muted">Suggested improvements</p>
        <ul class="flex flex-col gap-1.5">
          {#each scorecard.suggested_improvements as imp, i (i)}
            <li class="flex items-start gap-2 text-xs leading-[18px] text-ink-secondary">
              <span class="mt-[7px] h-1 w-1 flex-none rounded-full bg-gray-400" aria-hidden="true"></span>
              {imp}
            </li>
          {/each}
        </ul>
      </div>
    {/if}

    <!-- BNH-29: writer's own review — after reading the AI's take. Full-bleed
       footer section (negative margins cancel the host's 20px, or 24px on the
       side panel),
       same faint primary surface as the option-comment footer. -->
    {#if reportId}
      <div class={`mt-1 border-t border-primary/15 bg-primary/5 py-4 ${side ? "-mx-6 -mb-6 px-6" : "-mx-5 -mb-5 px-5"}`}>
        <div class="flex items-center justify-between gap-2">
          <p class="text-xs font-medium text-navy">Your review</p>
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
            placeholder="0 to 100"
            aria-label="Your score out of 100"
            class="field-control w-20 rounded-lg px-2.5 py-1.5 text-sm font-medium text-navy placeholder:text-gray-400"
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
          class="field-control mt-1 w-full resize-none rounded-lg px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400"
        ></textarea>
        <button
          type="button"
          onclick={saveReview}
          disabled={saving || reviewScore === "" || reviewComment.trim() === "" || (hasReview && !dirty)}
          class="mt-2 inline-flex h-8 w-full items-center justify-center rounded-lg bg-primary-selected px-3.5 text-sm font-medium text-white transition-colors hover:bg-primary-dark disabled:opacity-50"
        >
          {saving ? "Saving…" : hasReview ? (dirty ? "Update review" : "Saved") : "Save review"}
        </button>
      </div>
    {/if}
{:else}
  <div class="flex flex-col items-center gap-2 py-10 text-center">
    <svg class="h-8 w-8 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
      <path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
    </svg>
    <p class="text-sm text-gray-500">
      {scorecardUnreadable
        ? "This report's QA scorecard couldn't be read."
        : "No QA scorecard for this report yet."}
    </p>
    {#if scorecardUnreadable}
      <p class="max-w-[280px] text-xs leading-relaxed text-ink-muted">
        The scoring finished, but the saved result didn't match the expected
        format, so there is nothing to show. Running it again may produce a
        readable one.
      </p>
    {/if}
    {#if onRunQa}
      {#if qaRunning}
        <p class="inline-flex items-center gap-2 text-xs text-ink-muted">
          <span class="h-3 w-3 animate-spin rounded-full border-2 border-primary/30 border-t-primary motion-reduce:animate-none" aria-hidden="true"></span>
          Scoring the report. It keeps running if you close this panel.
        </p>
      {:else}
        {#if !scorecardUnreadable}
          <p class="text-xs text-gray-400">
            {postQaStatus === "failed"
              ? "The last QA pass failed. You can run it again."
              : "Score the assembled report with the same QA agent other modes use."}
          </p>
        {/if}
        <button
          type="button"
          onclick={handleRunQa}
          class="mt-1 rounded-lg bg-primary-selected px-3.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-primary-dark"
        >
          {scorecardUnreadable ? "Run QA scorecard again" : "Run QA scorecard"}
        </button>
      {/if}
    {:else}
      <p class="text-xs text-gray-400">Scores appear after the next generation.</p>
    {/if}
  </div>
{/if}
</div>
