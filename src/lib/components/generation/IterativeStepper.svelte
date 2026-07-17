<script module lang="ts">
  export type IterativeSectionKey = "s242" | "s244" | "s246";

  export const SECTION_STEPS: Array<{
    key: IterativeSectionKey;
    title: string;
    short: string;
  }> = [
    { key: "s242", title: "Line 242 — Uncertainty", short: "242" },
    { key: "s244", title: "Line 244 — Work performed", short: "244" },
    { key: "s246", title: "Line 246 — Advancement", short: "246" },
  ];
</script>

<script lang="ts">
  import { useQuery, useMutation } from "convex-svelte";
  import { api } from "../../../../convex/_generated/api";
  import type { Id } from "../../../../convex/_generated/dataModel";
  import ReadOnlyEditor from "$lib/components/review/ReadOnlyEditor.svelte";
  import Button from "$lib/components/ui/Button.svelte";
  import Spinner from "$lib/components/ui/Spinner.svelte";
  import { userErrorMessage } from "$lib/errors";
  import { sectionMetrics } from "../../../../convex/lib/lineLimits";

  /**
   * Section-by-section drafting stepper. The writer reviews, edits, and
   * approves each drafted section before the next is generated with the
   * approved text as canonical context. A collapsed ghost card at the bottom
   * offers the background one-shot draft for comparison only.
   */
  let { generationId }: { generationId: Id<"generations"> } = $props();

  const stateQ = useQuery(api.generations.getIterativeState, () => ({ generationId }));
  const iterState = $derived(stateQ.data);

  const approveMut = useMutation(api.generations.approveSectionDraft);
  const regenerateMut = useMutation(api.generations.regenerateSectionDraft);

  let actionError = $state("");
  let approving = $state(false);
  let regenerating = $state(false);
  let showGuidance = $state(false);
  let guidanceDraft = $state("");
  let ghostOpen = $state(false);
  let expandedApproved = $state<Record<string, boolean>>({});

  // The writer edits the draft directly in a textarea. Re-initialize whenever
  // the server hands us a NEW draft (section change or regeneration), keyed by
  // section+attempt so an in-progress edit is never stomped by a re-render.
  let editDraft = $state("");
  let editKey = $state("");

  const runs = $derived(iterState?.sectionRuns ?? []);
  const activeRun = $derived(
    runs.find((r) => r.status === "awaiting_review" || r.status === "failed") ??
      runs.find((r) => r.status === "running" || r.status === "queued") ??
      null
  );

  $effect(() => {
    const run = activeRun;
    if (!run || run.status !== "awaiting_review") return;
    const key = `${run.section}:${run.attempt}`;
    if (editKey !== key) {
      editKey = key;
      editDraft = run.draftText ?? "";
      showGuidance = false;
      guidanceDraft = "";
    }
  });

  // Guidance is per-section steering: never let text typed for one section
  // leak into another's regenerate call (e.g. typed on s242, approved instead,
  // then s244 fails and the writer hits Regenerate).
  let guidanceSection = $state<IterativeSectionKey | "">("");
  $effect(() => {
    const section = activeRun?.section ?? "";
    if (guidanceSection !== section) {
      guidanceSection = section;
      showGuidance = false;
      guidanceDraft = "";
    }
  });

  // Live CRA meter on the writer's (possibly edited) text.
  const liveMetrics = $derived(
    activeRun?.status === "awaiting_review" && activeRun.section
      ? sectionMetrics(editDraft, activeRun.section)
      : null
  );

  const stepState = (section: IterativeSectionKey): "approved" | "review" | "running" | "failed" | "pending" => {
    const run = runs.find((r) => r.section === section);
    if (!run) return "pending";
    if (run.status === "approved") return "approved";
    if (run.status === "awaiting_review") return "review";
    if (run.status === "failed") return "failed";
    if (run.status === "running" || run.status === "queued") return "running";
    return "pending";
  };

  async function approve() {
    const run = activeRun;
    if (!run || run.status !== "awaiting_review" || approving) return;
    approving = true;
    actionError = "";
    try {
      await approveMut({
        generationId,
        section: run.section,
        text: editDraft,
        attempt: run.attempt,
      });
    } catch (e) {
      actionError = userErrorMessage(e, "The section could not be approved.");
    } finally {
      approving = false;
    }
  }

  async function regenerate() {
    const run = activeRun;
    if (!run || regenerating) return;
    regenerating = true;
    actionError = "";
    try {
      await regenerateMut({
        generationId,
        section: run.section,
        ...(guidanceDraft.trim() ? { guidance: guidanceDraft.trim() } : {}),
      });
      showGuidance = false;
      guidanceDraft = "";
    } catch (e) {
      actionError = userErrorMessage(e, "The section could not be regenerated.");
    } finally {
      regenerating = false;
    }
  }

  type QaFinding = { check: string; message: string };
  function qaFindings(qa: unknown): QaFinding[] {
    if (!Array.isArray(qa)) return [];
    return qa.filter(
      (f): f is QaFinding =>
        typeof f === "object" &&
        f !== null &&
        typeof (f as QaFinding).message === "string"
    );
  }

  const isLastStep = $derived(activeRun?.section === "s246");
</script>

{#if iterState}
  <!-- Plain heading + full-width section cards (no outer card wrapper) -->
  <div>
    <!-- Header -->
    <div class="flex items-start justify-between gap-3">
      <div>
        <div class="flex items-center gap-2">
          <span class="flex h-6 w-6 items-center justify-center rounded-full bg-primary/15 text-primary-dark">
            <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
          </span>
          <h2 class="text-xl font-semibold text-gray-900">Section-by-section draft</h2>
        </div>
        <p class="mt-1 text-sm text-gray-500">
          Review and approve each section before the next is drafted — approved text becomes
          canonical context for what follows.
        </p>
      </div>
    </div>

    {#if actionError}
      <p class="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
        {actionError}
      </p>
    {/if}

    <!-- Pre-fan-out: analyzer + Brain retrieval run once before section rows
         exist. Narrated from the generation's progress log so the wait reads
         as stages, not one opaque spinner. -->
    {#if runs.length === 0}
      <div class="mt-5 rounded-xl border border-gray-200 bg-canvas px-4 py-3">
        <p class="flex items-center gap-2 text-sm text-gray-600">
          <Spinner size="sm" class="h-3.5 w-3.5 border-primary/30 border-t-primary" />
          {iterState.currentStep ?? "Preparing sections…"}
          <span class="text-gray-400">(runs once, shared by every section)</span>
        </p>
        {#if iterState.progressLog.length}
          <ol class="mt-2.5 flex flex-col gap-1 border-t border-gray-100 pt-2.5">
            {#each iterState.progressLog.slice(-6) as line, i (i)}
              <li class="flex items-start gap-2 text-xs text-gray-500">
                <svg class="mt-0.5 h-3 w-3 flex-none text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                {line}
              </li>
            {/each}
          </ol>
        {/if}
      </div>
    {/if}

    <!-- Stepper -->
    <ol class="mt-5 flex flex-col gap-3">
      {#each SECTION_STEPS as step (step.key)}
        {@const run = runs.find((r) => r.section === step.key)}
        {@const s = stepState(step.key)}
        <li
          class={`overflow-hidden rounded-xl border transition-colors ${
            s === "review" || s === "failed"
              ? "border-primary/40 bg-white"
              : s === "approved"
                ? "border-navy bg-navy"
                : "border-gray-200 bg-canvas"
          }`}
        >
          {#if s === "approved" && run}
            <!-- Approved: whole header is the accordion trigger (navy fill,
                 white text; chevron at the right edge, down → up). -->
            <button
              type="button"
              onclick={() => (expandedApproved = { ...expandedApproved, [step.key]: !expandedApproved[step.key] })}
              aria-expanded={Boolean(expandedApproved[step.key])}
              class="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-navy-light"
            >
              <span class="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-primary">
                <svg class="h-3.5 w-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </span>
              <span class="flex-1 text-sm font-medium text-white">{step.title}</span>
              <span class="rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                Approved
              </span>
              <svg
                class={`h-3.5 w-3.5 flex-none text-white/70 transition-transform ${expandedApproved[step.key] ? "rotate-180" : ""}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"
              >
                <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {#if expandedApproved[step.key]}
              <!-- Open body: white surface, regular ink -->
              <div class="border-t border-navy bg-white px-4 py-3">
                <p class="whitespace-pre-wrap font-serif text-sm leading-relaxed text-gray-700">
                  {run.approvedText}
                </p>
              </div>
            {/if}
          {:else}
          <!-- Step header row -->
          <div class="flex items-center gap-3 px-4 py-3">
            {#if s === "running"}
              <span class="flex h-6 w-6 flex-none items-center justify-center">
                <Spinner size="sm" class="h-4 w-4 border-primary/30 border-t-primary" />
              </span>
            {:else if s === "review"}
              <span class="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-primary-selected text-xs font-semibold text-white">
                {step.short.slice(0, 1)}
              </span>
            {:else if s === "failed"}
              <span class="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-red-100 text-red-600">
                <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </span>
            {:else}
              <span class="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-chrome text-xs font-medium text-gray-400">
                {SECTION_STEPS.findIndex((x) => x.key === step.key) + 1}
              </span>
            {/if}
            <span class={`flex-1 text-sm font-medium ${s === "pending" ? "text-gray-400" : "text-gray-900"}`}>
              {step.title}
            </span>
            {#if s === "review"}
              <span class="rounded-full bg-primary-wash px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary-dark">
                Your review
              </span>
            {:else if s === "running"}
              <span class="rounded-full bg-primary-wash px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary-dark">
                Drafting…
              </span>
            {:else if run?.attempt && run.attempt > 1 && s !== "pending"}
              <span class="text-[10px] text-gray-400">attempt {run.attempt}</span>
            {/if}
          </div>

          <!-- Active step body -->
          {#if s === "failed" && run}
            <div class="border-t border-gray-100 px-4 py-4">
              <p class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                {run.error ?? "The section draft failed."}
              </p>
              <div class="mt-3 flex items-center gap-2">
                <Button
                  variant="primary-outline"
                  size="sm"
                  onclick={regenerate}
                  disabled={regenerating}
                  class="gap-2"
                >
                  {#if regenerating}
                    <Spinner size="sm" class="h-3.5 w-3.5 border-current" />
                  {/if}
                  Regenerate
                </Button>
              </div>
            </div>
          {:else if s === "review" && run}
            <div class="border-t border-gray-100 px-4 py-4">
              <label for={`draft-${step.key}`} class="text-xs font-medium uppercase tracking-wide text-gray-400">
                Draft — edit directly, then approve
              </label>
              <textarea
                id={`draft-${step.key}`}
                bind:value={editDraft}
                rows={Math.min(24, Math.max(10, editDraft.split("\n").length + 2))}
                class="mt-1.5 w-full resize-y rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 font-serif text-sm leading-relaxed text-gray-900 focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
              ></textarea>

              <!-- CRA form-fit meter (live on the edited text) -->
              {#if liveMetrics}
                <div class="mt-2 flex flex-wrap items-center gap-2">
                  <span
                    class={`text-data inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 ${
                      liveMetrics.overLimit
                        ? "border-red-200 bg-red-50 text-red-700"
                        : "border-line-soft bg-white text-gray-600"
                    }`}
                    title={`Section ${step.short}: ${liveMetrics.lines} of ${liveMetrics.limit} form lines, ${liveMetrics.words} words (cap ${liveMetrics.wordCap})`}
                  >
                    <span class={`font-semibold ${liveMetrics.overLimit ? "" : "text-primary"}`}>{step.short}</span>
                    <span class="font-sans text-xs">
                      {liveMetrics.lines}/{liveMetrics.limit} lines, {liveMetrics.words}/{liveMetrics.wordCap} words
                      {#if liveMetrics.rawLines !== liveMetrics.lines || liveMetrics.rawWords !== liveMetrics.words}
                        <span class="text-gray-400">
                          (+{liveMetrics.rawLines - liveMetrics.lines} lines with gaps)
                        </span>
                      {/if}
                    </span>
                    {#if liveMetrics.overLimit}
                      <svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01M5.07 19h13.86c1.54 0 2.5-1.67 1.73-3L13.73 4c-.77-1.33-2.69-1.33-3.46 0L3.34 16c-.77 1.33.19 3 1.73 3z" />
                      </svg>
                    {/if}
                  </span>
                  {#if liveMetrics.overLimit}
                    <span class="text-xs text-amber-700">
                      Over the CRA form limit — you can still approve and trim later.
                    </span>
                  {/if}
                </div>
              {/if}

              <!-- Deterministic QA flags -->
              {#if qaFindings(run.qa).length > 0}
                <div class="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
                  <p class="text-xs font-semibold text-amber-800">Automated checks flagged:</p>
                  <ul class="mt-1 flex flex-col gap-0.5">
                    {#each qaFindings(run.qa) as finding, i (i)}
                      <li class="text-xs leading-relaxed text-amber-700">• {finding.message}</li>
                    {/each}
                  </ul>
                </div>
              {/if}

              <!-- Actions -->
              <div class="mt-4 flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  onclick={approve}
                  disabled={approving || regenerating || !editDraft.trim()}
                  class="gap-2 font-semibold"
                >
                  {#if approving}
                    <Spinner size="sm" class="h-3.5 w-3.5 border-white" />
                    Saving…
                  {:else}
                    <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    {isLastStep ? "Approve & assemble report" : "Approve & continue"}
                  {/if}
                </Button>
                <Button
                  variant="primary-outline"
                  size="sm"
                  onclick={() => (showGuidance = !showGuidance)}
                  disabled={approving || regenerating}
                  aria-expanded={showGuidance}
                >
                  Regenerate
                </Button>
              </div>

              {#if showGuidance}
                <div class="mt-3 rounded-lg border border-gray-200 bg-canvas px-3 py-3">
                  <label for={`guidance-${step.key}`} class="text-xs font-medium text-gray-600">
                    Guidance for the redraft (optional)
                  </label>
                  <textarea
                    id={`guidance-${step.key}`}
                    bind:value={guidanceDraft}
                    rows="3"
                    placeholder="e.g. Lead with the load-balancing uncertainty; drop the staffing detail."
                    class="mt-1.5 w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
                  ></textarea>
                  <div class="mt-2 flex items-center gap-2">
                    <button
                      type="button"
                      onclick={regenerate}
                      disabled={regenerating}
                      class="inline-flex items-center gap-2 rounded-lg bg-navy px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-navy-light disabled:opacity-50"
                    >
                      {#if regenerating}
                        <Spinner size="sm" class="h-3 w-3 border-white" />
                        Redrafting…
                      {:else}
                        Redraft this section
                      {/if}
                    </button>
                    <span class="text-xs text-gray-400">Your current edits will be replaced.</span>
                  </div>
                </div>
              {/if}
            </div>
          {/if}
          {/if}
        </li>
      {/each}
    </ol>

    <!-- Ghost: background one-shot draft, comparison only -->
    {#if iterState.ghost}
      <div class="mt-5 rounded-xl border border-dashed border-gray-300 bg-canvas">
        <button
          type="button"
          onclick={() => (ghostOpen = !ghostOpen)}
          aria-expanded={ghostOpen}
          class="flex w-full items-center gap-2 px-4 py-3 text-left"
        >
          <span class="flex-1 text-sm font-medium text-gray-600">
            One-shot full draft
            <span class="font-normal text-gray-400">
              (background comparison — not used as drafting context)
            </span>
          </span>
          {#if iterState.ghost.status === "queued" || iterState.ghost.status === "running"}
            <span class="inline-flex items-center gap-1.5 text-xs text-gray-400">
              <Spinner size="sm" class="h-3 w-3 border-gray-300 border-t-gray-500" />
              generating…
            </span>
          {:else if iterState.ghost.status === "failed"}
            <span class="text-xs text-gray-400">unavailable</span>
          {/if}
          <!-- Disclosure chevron per design system: right edge, down → up. -->
          <svg
            class={`h-3.5 w-3.5 flex-none transition-transform ${ghostOpen ? "rotate-180 text-primary" : "text-gray-400"}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"
          >
            <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {#if ghostOpen}
          <div class="border-t border-dashed border-gray-300 px-4 py-4">
            {#if iterState.ghost.status === "succeeded" && iterState.ghost.content}
              <div class="rounded-xl border border-gray-200 bg-white p-5">
                <ReadOnlyEditor content={iterState.ghost.content} />
              </div>
            {:else if iterState.ghost.status === "failed"}
              <p class="text-sm text-gray-400">
                The one-shot comparison draft failed to generate. Your section-by-section
                draft is unaffected.
              </p>
            {:else}
              <p class="flex items-center gap-2 text-sm text-gray-400">
                <Spinner size="sm" class="h-3.5 w-3.5 border-gray-300 border-t-gray-500" />
                Still generating in the background — check back shortly.
              </p>
            {/if}
          </div>
        {/if}
      </div>
    {/if}
  </div>

{:else if stateQ.isLoading}
  <div class="flex items-center justify-center p-10">
    <Spinner />
  </div>
{/if}
