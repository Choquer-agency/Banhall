<script module lang="ts">
  import type { Id } from "../../../../convex/_generated/dataModel";
  import { CANDIDATE_MODELS } from "../../../../shared/generationModels";

  type Candidate = {
    _id: Id<"reportCandidates">;
    content: string;
    qaScore: number | null;
    qa?: unknown;
    model: string | null;
    label: string | null;
  };

  /**
   * Stable display order: the model registry order (CANDIDATE_MODELS).
   * Candidates with an unknown or missing model sink to the end, keeping
   * their original relative order.
   */
  function registryOrder(candidates: Candidate[]): Candidate[] {
    const rank = (c: Candidate) => {
      const idx = CANDIDATE_MODELS.findIndex((m) => m.id === c.model);
      return idx === -1 ? CANDIDATE_MODELS.length : idx;
    };
    return candidates
      .map((c, i) => ({ c, i }))
      .sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i)
      .map(({ c }) => c);
  }
</script>

<script lang="ts">
  import QARailPanel from "$lib/components/qa/QARailPanel.svelte";
  import QALauncher from "$lib/components/qa/QALauncher.svelte";
  import SelectInput from "$lib/components/ui/SelectInput.svelte";
  import { useQuery, useMutation } from "convex-svelte";
  import { api } from "../../../../convex/_generated/api";
  import ReadOnlyEditor from "$lib/components/review/ReadOnlyEditor.svelte";
  import Spinner from "$lib/components/ui/Spinner.svelte";
  import { userErrorMessage } from "$lib/errors";
  import { reportSectionMetrics } from "$lib/reportSections";

  /**
   * Candidate picker (port of src/components/generation/CandidateSelection.tsx).
   * Shows the generated drafts as labelled model tabs (registry order) with a
   * read-only preview and a sticky "Use this draft" bar.
   *
   * - generationId: exact generation whose candidates are listed
   */
  let {
    generationId,
    maximized = $bindable(false),
  }: {
    generationId: Id<"generations">;
    maximized?: boolean;
  } = $props();

  const candidatesQ = useQuery(api.generations.getCandidates, () => ({ generationId }));
  const candidates = $derived(candidatesQ.data);
  const selectCandidate = useMutation(api.generations.selectReportCandidate);

  // BNH-48: optional 1–10 writer score per option, persisted immediately.
  const scoreCandidateMut = useMutation(api.generations.scoreCandidate);
  const myScoresQ = useQuery(api.generations.getMyCandidateScores, () => ({ generationId }));
  const myScores = $derived(
    new Map((myScoresQ.data ?? []).map((score) => [score.candidateId, score]))
  );
  let scoreSaving = $state(false);
  let actionError = $state("");
  let commentDrafts = $state<Record<string, string>>({});
  // "saved" flashes the checkmark; "blocked" explains why nothing saved.
  let commentStatus = $state<"idle" | "saved" | "blocked">("idle");

  $effect(() => {
    for (const score of myScoresQ.data ?? []) {
      if (commentDrafts[score.candidateId] === undefined) {
        commentDrafts[score.candidateId] = score.comment;
      }
    }
  });

  async function saveFeedback(score: number, comment: string) {
    if (!current || scoreSaving) return;
    scoreSaving = true;
    actionError = "";
    try {
      await scoreCandidateMut({
        candidateId: current._id,
        score,
        comment,
        optionPosition: pos + 1,
      });
    } catch (e) {
      actionError = userErrorMessage(e, "The option feedback could not be saved.");
    } finally {
      scoreSaving = false;
    }
  }

  function setScore(score: number) {
    if (!current) return;
    if (commentStatus === "blocked") commentStatus = "idle";
    void saveFeedback(score, commentDrafts[current._id] ?? "");
  }

  async function saveComment() {
    if (!current) return;
    const saved = myScores.get(current._id);
    const draft = commentDrafts[current._id] ?? "";
    if (draft.trim() === (saved?.comment.trim() ?? "")) return;
    if (saved == null) {
      if (draft.trim()) commentStatus = "blocked";
      return;
    }
    await saveFeedback(saved.score, draft);
    commentStatus = "saved";
  }

  function onCommentInput(candidateId: string, value: string) {
    commentDrafts[candidateId] = value;
    commentStatus = "idle";
  }

  // BNH-47: QA snapshot — minimised by default (draft-first, confirm-bias on demand).
  let qaOpen = $state(false);
  // Drag-resizable rail, workspace parity (persisted).
  const QA_MIN = 0.24;
  const QA_MAX = 0.55;
  let qaRatio = $state(0.34);
  let qaDragging = $state(false);
  let rootEl: HTMLDivElement | null = $state(null);
  let previewRef: ReadOnlyEditor | null = $state(null);

  /** Jump the preview to the QA issue's exact [P#] paragraph. A null target
   * is section-wide and lands on the section's first paragraph. */
  function locateGap(gap: { section: string; paragraph: number | null }) {
    previewRef?.locateSectionParagraph(gap.section, gap.paragraph);
  }

  $effect(() => {
    const r = localStorage.getItem("banhall_qa_ratio");
    if (r) qaRatio = Math.min(QA_MAX, Math.max(QA_MIN, parseFloat(r)));
  });
  $effect(() => {
    localStorage.setItem("banhall_qa_ratio", String(qaRatio));
  });
  $effect(() => {
    function onMove(e: MouseEvent) {
      if (!qaDragging || !rootEl) return;
      const rect = rootEl.getBoundingClientRect();
      qaRatio = Math.min(QA_MAX, Math.max(QA_MIN, (rect.right - e.clientX) / rect.width));
    }
    function onUp() {
      if (qaDragging) {
        qaDragging = false;
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
      }
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  });
  function startQaDrag(e: MouseEvent) {
    e.preventDefault();
    qaDragging = true;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
  }
  function adjustQa(delta: number) {
    qaRatio = Math.min(QA_MAX, Math.max(QA_MIN, qaRatio + delta));
  }
  let activePos = $state(0);
  let choosing = $state(false);

  // Display candidates in stable model-registry order, labelled by model.
  // Dedup by _id: a retry racing the subscription briefly delivered the same
  // candidate row twice, crashing the keyed {#each} (alerts, Jul 10).
  const displayed = $derived.by(() => {
    if (!candidates) return [];
    const seen = new Set<string>();
    return registryOrder(candidates).filter((c) => {
      if (seen.has(c._id)) return false;
      seen.add(c._id);
      return true;
    });
  });
  const pos = $derived(activePos < displayed.length ? activePos : 0);
  const current = $derived(displayed[pos] as Candidate | undefined);
  const currentMetrics = $derived(
    current ? reportSectionMetrics(current.content) : null
  );

  async function choose() {
    if (!current) return;
    choosing = true;
    actionError = "";
    try {
      await selectCandidate({ generationId, candidateId: current._id });
      // Reactive queries flip the page to the report view on success.
    } catch (e) {
      actionError = userErrorMessage(e, "The draft could not be selected.");
      choosing = false;
    }
  }
</script>

{#if candidates && candidates.length > 0 && current}
  <div bind:this={rootEl} class={`mx-auto flex min-h-0 w-full flex-1 overflow-hidden transition-[max-width] duration-[325ms] ease-out motion-reduce:transition-none ${maximized ? "max-w-full" : "max-w-[var(--container-shell)]"}`}>
  <div class="min-h-0 flex-1 overflow-y-auto">
    <div class={`mx-auto transition-[max-width,padding] duration-[325ms] ease-out motion-reduce:transition-none ${maximized ? "max-w-full px-7 py-6" : qaOpen ? "max-w-report px-8 py-8" : "max-w-[var(--container-shell)] px-8 py-8"}`}>
      <div class="mb-1 flex items-center gap-2">
        <span class="flex h-6 w-6 items-center justify-center rounded-full bg-primary/15 text-primary-dark">
          <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
          </svg>
        </span>
        <h2 class="text-xl font-semibold text-gray-900">Choose your preferred draft</h2>
      </div>
      <p class="mb-5 text-sm text-gray-500">
        Each option is a full draft written from the same inputs by a different model. Review
        and score each draft, then pick the one you&apos;d keep; your choice is logged to learn
        which model works best.
      </p>

      <!-- Model option tabs -->
      <div class="flex flex-wrap gap-2">
        {#each displayed as c, i (c._id)}
          {@const myScore = myScores.get(c._id)?.score}
          <button
            type="button"
            aria-pressed={i === pos}
            onclick={() => {
              activePos = i;
              commentStatus = "idle";
            }}
            class={`inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
              i === pos
                ? "border-primary-selected bg-primary-selected text-white"
                : "border-gray-200 bg-white text-gray-700 hover:border-gray-300"
            }`}
          >
            {c.label ?? `Option ${i + 1}`}
            {#if myScore != null}
              <span
                class={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${
                  i === pos ? "bg-white/20 text-white" : "bg-primary/10 text-primary-dark"
                }`}
                title={`Your score: ${myScore}/10`}
              >
                {myScore}
              </span>
            {/if}
          </button>
        {/each}
      </div>

      <!-- BNH-37: canonical CRA form-fit meters (78-char lines; every break counts) -->
      {#if currentMetrics}
        {@const sections = [
          { label: "242", sec: currentMetrics.s242 },
          { label: "244", sec: currentMetrics.s244 },
          { label: "246", sec: currentMetrics.s246 },
        ]}
        <div class="mt-4 flex flex-wrap items-center gap-2">
          {#each sections as { label, sec } (label)}
            <span
              class={`text-data inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 ${
                sec.overLimit
                  ? "border-red-200 bg-red-50 text-red-700"
                  : "border-line-soft bg-white text-gray-600"
              }`}
              title={`Section ${label}: ${sec.lines} of ${sec.limit} form lines, ${sec.words} words (cap ${sec.wordCap})`}
            >
              <span class={`font-semibold ${sec.overLimit ? "" : "text-primary"}`}>{label}</span>
              <span class="font-sans text-xs">{sec.lines}/{sec.limit} lines, {sec.words}/{sec.wordCap} words</span>
              {#if sec.overLimit}
                <svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01M5.07 19h13.86c1.54 0 2.5-1.67 1.73-3L13.73 4c-.77-1.33-2.69-1.33-3.46 0L3.34 16c-.77 1.33.19 3 1.73 3z" />
                </svg>
              {/if}
            </span>
          {/each}
        </div>
      {/if}

      <!-- Selected candidate preview -->
      <div class="mt-5 rounded-2xl border border-gray-200 bg-white p-6">
        <ReadOnlyEditor bind:this={previewRef} content={current.content} />
      </div>

      {#if !qaOpen}
        <!-- bottom offset clears the sticky action bar -->
        <QALauncher bottom="5.5rem" onOpen={() => (qaOpen = true)} />
      {/if}
    </div>

    <!-- Sticky action bar (@container so the score control adapts to the bar's
         actual width, which shrinks when the QA rail opens) -->
    <div class="@container sticky bottom-0 border-t border-gray-200 bg-white/90 px-8 py-3 backdrop-blur">
      {#if actionError}
        <p class="mx-auto mb-2 max-w-[var(--container-shell)] text-sm text-red-700" role="alert">
          {actionError}
        </p>
      {/if}
      <div class={`mx-auto grid grid-cols-[1fr_auto_1fr] items-center gap-4 transition-[max-width] duration-[325ms] ease-out motion-reduce:transition-none ${maximized ? "max-w-full" : qaOpen ? "max-w-report" : "max-w-[var(--container-shell)]"}`}>
        <span class="justify-self-start text-sm text-gray-500">
          Viewing <span class="font-medium text-navy">{current.label ?? `Option ${pos + 1}`}</span>
        </span>

        <!-- BNH-48: optional 1–10 score for the option being viewed. Button row
             when the bar has room; compact select when the QA rail or a small
             screen squeezes it (container query on the bar). -->
        <div class="flex min-w-0 items-center gap-2 justify-self-center">
          <span class="flex-none whitespace-nowrap text-xs text-gray-400">Your score</span>
          <div class="hidden items-center gap-0.5 @4xl:flex" role="radiogroup" aria-label={`Score ${current.label ?? `Option ${pos + 1}`} out of 10`}>
            {#each Array.from({ length: 10 }, (_, n) => n + 1) as n (n)}
              {@const active = current && myScores.get(current._id)?.score === n}
              <button
                type="button"
                role="radio"
                aria-checked={active}
                disabled={scoreSaving}
                onclick={() => setScore(n)}
                class={`h-6 w-6 rounded-md text-xs font-semibold tabular-nums transition-colors ${
                  active
                    ? "bg-primary text-white"
                    : "bg-gray-100 text-gray-500 hover:bg-primary/25 hover:text-primary-dark"
                }`}
              >
                {n}
              </button>
            {/each}
          </div>
          <SelectInput
            value={String(myScores.get(current._id)?.score ?? "")}
            items={Array.from({ length: 10 }, (_, n) => ({ value: String(n + 1), label: `${n + 1} / 10` }))}
            placeholder="–"
            size="sm"
            disabled={scoreSaving}
            openOnFocus={false}
            class="w-20 @4xl:hidden"
            onValueChange={(next) => {
              const n = Number(next);
              if (n >= 1) setScore(n);
            }}
          />
        </div>

        <button
          type="button"
          onclick={choose}
          disabled={choosing}
          class="inline-flex flex-none items-center gap-2 justify-self-end rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-dark disabled:opacity-50"
        >
          {#if choosing}
            <Spinner size="sm" class="h-3.5 w-3.5 border-white" />
            Saving…
          {:else}
            <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            Use this draft
          {/if}
        </button>
      </div>
    </div>
  </div>

  <!-- Draggable divider (workspace parity) -->
  {#if qaOpen}
    <button
      type="button"
      onmousedown={startQaDrag}
      role="slider"
      aria-label="Resize QA panel"
      aria-orientation="vertical"
      aria-valuemin={Math.round(QA_MIN * 100)}
      aria-valuemax={Math.round(QA_MAX * 100)}
      aria-valuenow={Math.round(qaRatio * 100)}
      onkeydown={(event) => {
        if (event.key === "ArrowLeft") adjustQa(0.02);
        else if (event.key === "ArrowRight") adjustQa(-0.02);
        else if (event.key === "Home") qaRatio = QA_MIN;
        else if (event.key === "End") qaRatio = QA_MAX;
        else return;
        event.preventDefault();
      }}
      title="Drag or use arrow keys to resize"
      class="group flex w-3 flex-none cursor-col-resize items-center justify-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-navy"
    >
      <div class="h-10 w-1 rounded-full bg-gray-300 transition-colors group-hover:bg-primary"></div>
    </button>
  {/if}

  <!-- QA rail — same motion + resize behaviour as the workspace assistant -->
  <aside
    class={`relative flex min-h-0 flex-none flex-col overflow-hidden bg-canvas py-6 ${qaOpen ? (maximized ? "pl-1 pr-7" : "pl-1 pr-6") : ""} ${qaDragging ? "" : "transition-all duration-[325ms] ease-out motion-reduce:transition-none"}`}
    style={`width: ${qaOpen ? `${qaRatio * 100}%` : "0%"}`}
  >
    <QARailPanel
      open={qaOpen}
      onClose={() => (qaOpen = false)}
      title={`QA for ${current.label ?? `Option ${pos + 1}`}`}
      rawQa={current.qa}
      candidateId={current._id}
      modelName={current.label}
      onLocateGap={locateGap}
    >
      {#snippet footer()}
        <div class="flex items-center justify-between gap-2">
          <label class="text-xs font-semibold text-navy" for="candidate-comment">
            Comment on {current.label ?? `Option ${pos + 1}`} <span class="font-normal text-gray-500">(optional)</span>
          </label>
          {#if commentStatus === "saved" && !scoreSaving}
            <span class="inline-flex flex-none items-center gap-1 text-[10px] font-medium text-green-700">
              <svg class="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              Saved
            </span>
          {/if}
        </div>
        <form
          class="mt-2"
          onsubmit={(event) => {
            event.preventDefault();
            void saveComment();
          }}
        >
          <textarea
            id="candidate-comment"
            value={commentDrafts[current._id] ?? ""}
            oninput={(event) => onCommentInput(current._id, event.currentTarget.value)}
            rows="3"
            placeholder="Why did you like or dislike this option?"
            class="w-full resize-none rounded-lg border border-primary/20 bg-white px-3 py-2 text-sm text-gray-800 outline-none transition-colors placeholder:text-gray-400 focus:border-primary"
          ></textarea>
          <button
            type="submit"
            disabled={scoreSaving}
            class="mt-1.5 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-semibold text-white transition-colors hover:bg-primary-dark disabled:opacity-50"
          >
            {#if scoreSaving}
              <Spinner size="sm" class="h-3 w-3 border-white" />
            {/if}
            Save
          </button>
        </form>
        {#if commentStatus === "blocked"}
          <p class="mt-1.5 text-[11px] text-amber-700">Pick a score in the bottom bar to save your comment.</p>
        {/if}
      {/snippet}
    </QARailPanel>
  </aside>
  </div>
{/if}
