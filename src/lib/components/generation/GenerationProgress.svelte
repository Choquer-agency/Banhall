<script lang="ts">
  import { useQuery, useMutation } from "convex-svelte";
  import { api } from "../../../../convex/_generated/api";
  import type { Id } from "../../../../convex/_generated/dataModel";
  import Button from "$lib/components/ui/Button.svelte";
  import { userErrorMessage } from "$lib/errors";

  /**
   * Live generation progress card (port of src/components/generation/GenerationProgress.tsx).
   * Subscribes to one generation and renders a time/milestone progress bar,
   * human "time remaining" copy, and a collapsible activity log.
   *
   * Props:
   * - generationId: exact generation to display
   */
  let { generationId }: { generationId: Id<"generations"> } = $props();

  const generationQ = useQuery(api.generations.getGeneration, () => ({ generationId }));
  const generation = $derived(generationQ.data);

  let scrollEl: HTMLDivElement | null = $state(null);
  let showLog = $state(false);
  let now = $state(0);
  const activityId = "generation-activity";

  const log = $derived(generation?.progressLog ?? []);

  function clamp(n: number, lo: number, hi: number) {
    return Math.max(lo, Math.min(hi, n));
  }

  /** Human-readable "time remaining" copy (BNH-21 acceptance criteria). */
  function remainingLabel(remainingMs: number, estimatedMs: number): string {
    if (estimatedMs <= 0) return "Estimating time…";
    if (remainingMs <= 15_000) return "Almost done…";
    if (remainingMs < 60_000) return "Less than a minute remaining";
    const mins = Math.round(remainingMs / 60_000);
    return `About ${mins} minute${mins === 1 ? "" : "s"} remaining`;
  }

  const isQueued = $derived(generation?.status === "reserved");
  const isRunning = $derived(generation?.status === "running");
  const isActive = $derived(isQueued || isRunning);
  const isFailed = $derived(generation?.status === "failed");
  const isComplete = $derived(generation?.status === "completed");

  // Tick once per second to animate the bar + countdown — but ONLY while the
  // run is live. A failed/completed run must freeze, not keep creeping.
  // setTimeout(…, 0) is async (not a synchronous state write in the effect
  // body) so it paints quickly.
  $effect(() => {
    if (!isActive) return;
    const tick = () => {
      now = Date.now();
    };
    const t0 = setTimeout(tick, 0);
    const id = setInterval(tick, 1000);
    return () => {
      clearTimeout(t0);
      clearInterval(id);
    };
  });

  // Retry re-schedules the pipeline with the same transcript.
  const retryGenerate = useMutation(api.generations.retryGeneration);
  let retrying = $state(false);
  let retryError = $state("");
  async function retry() {
    if (!generation || retrying) return;
    retrying = true;
    retryError = "";
    try {
      await retryGenerate({ generationId });
    } catch (e) {
      retryError = userErrorMessage(e, "The generation could not be restarted.");
    } finally {
      retrying = false;
    }
  }

  // Keep the (collapsed) terminal pinned to the newest line when open.
  $effect(() => {
    void log.length;
    if (showLog && scrollEl) {
      scrollEl.scrollTop = scrollEl.scrollHeight;
    }
  });

  const estimatedMs = $derived(generation?.estimatedMs ?? 0);
  const totalCandidates = $derived(generation?.totalCandidates ?? 0);
  const candidatesDone = $derived(generation?.candidatesDone ?? 0);
  // Elapsed freezes at completedAt once the run ends — a failed bar must not
  // keep growing as wall-clock time passes.
  const elapsed = $derived(
    generation
      ? Math.max(
          0,
          (isActive ? (now > 0 ? now : generation.startedAt) : (generation.completedAt ?? generation.startedAt)) -
            generation.startedAt
        )
      : 0
  );
  const remainingMs = $derived(Math.max(0, estimatedMs - elapsed));

  // Progress = the larger of elapsed-vs-estimate and completed-drafts, capped
  // below 100% until the run actually finishes so the bar never lies.
  const timeFraction = $derived(estimatedMs > 0 ? clamp(elapsed / estimatedMs, 0, 0.95) : 0);
  const milestoneFraction = $derived(totalCandidates > 0 ? candidatesDone / totalCandidates : 0);
  const progress = $derived(
    isActive
      ? clamp(Math.max(timeFraction, milestoneFraction * 0.95), 0.02, 0.97)
      : isFailed
        ? Math.max(timeFraction, milestoneFraction)
        : 1
  );

  const currentLine = $derived(
    log.length > 0 ? log[log.length - 1] : (generation?.currentStep ?? "Warming up…")
  );

  const totalMins = $derived(Math.round(estimatedMs / 60_000));
</script>

{#if generation}
  <div class="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
    <!-- Heading -->
    <div class="flex items-baseline justify-between gap-3">
      <h3 class="text-sm font-semibold text-gray-900">
        {isQueued ? "Preparing report generation" : isRunning ? "Generating your report" : isComplete ? "Report generated" : "Generation failed"}
      </h3>
      {#if isActive}
        <span class="text-xs font-medium text-gray-400">
          {isQueued ? "Queued…" : now > 0 ? remainingLabel(remainingMs, estimatedMs) : "Estimating time…"}
        </span>
      {/if}
    </div>

    <!-- Progress bar -->
    <div
      class="mt-3 h-2 w-full overflow-hidden rounded-full bg-chrome"
      role="progressbar"
      aria-label="Report generation progress"
      aria-valuemin="0"
      aria-valuemax="100"
      aria-valuenow={Math.round(progress * 100)}
    >
      <div
        class={`h-full rounded-full transition-[width] duration-700 ease-out ${
          isFailed ? "bg-red-400" : isComplete ? "bg-green-500" : "bg-primary"
        }`}
        style={`width: ${Math.round(progress * 100)}%`}
      ></div>
    </div>

    <!-- Subtle status line under the bar -->
    <div class="mt-2 flex items-center justify-between gap-3">
      <p class="min-w-0 flex-1 truncate text-xs text-gray-500">
        {isActive ? currentLine : isComplete ? "Done." : generation.error}
      </p>
      <div class="flex flex-shrink-0 items-center gap-2 text-xs text-gray-400">
        {#if isRunning && totalCandidates > 0}
          <span>Draft {Math.min(candidatesDone + 1, totalCandidates)} of {totalCandidates}</span>
        {/if}
      </div>
    </div>

    <!-- Friendly up-front estimate (set the expectation, per the transcript) -->
    {#if isRunning && estimatedMs > 0}
      <p class="mt-2 text-xs text-gray-400">
        Estimated ~{totalMins < 1 ? "1" : totalMins} minute{totalMins === 1 ? "" : "s"} total. You can keep working here while it runs.
      </p>
    {/if}

    <!-- Low-emphasis activity log (kept, but no longer the focal point) -->
    {#if isActive || isComplete || isFailed}
      <button
        type="button"
        aria-expanded={showLog}
        aria-controls={activityId}
        onclick={() => (showLog = !showLog)}
        class="mt-3 inline-flex items-center gap-1 text-xs text-gray-400 transition-colors hover:text-gray-600"
      >
        <svg
          class={`h-3 w-3 transition-transform ${showLog ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          stroke-width="2"
        >
          <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
        {showLog ? "Hide activity" : "Show activity"}
      </button>
    {/if}

    {#if showLog}
      <div
        id={activityId}
        bind:this={scrollEl}
        class="mt-2 h-[180px] overflow-y-auto rounded-xl bg-navy px-4 py-3 font-mono text-[12px] leading-[1.7] text-white/85"
      >
        {#if log.length === 0 && isActive}
          <div class="text-white/50">› warming up…</div>
        {/if}
        {#each log as line, i}
          <div class="flex gap-2">
            <span class="select-none text-primary-light">›</span>
            <span class="flex-1">{line}{#if i === log.length - 1 && isActive}<span class="ml-0.5 inline-block animate-pulse">▍</span>{/if}</span>
          </div>
        {/each}
        {#if isComplete}
          <div class="flex gap-2 text-green-400">
            <span class="select-none">✓</span>
            <span>Done.</span>
          </div>
        {/if}
      </div>
    {/if}

    {#if isFailed}
      <div class="mt-3 rounded-lg bg-red-50 px-3 py-2.5">
        <p class="text-sm text-red-700">
          {generation.error ?? "The run stopped before any draft finished."}
        </p>
      </div>
      <div class="mt-3 flex items-center gap-3">
        <Button onclick={retry} disabled={retrying}>
          {retrying ? "Restarting…" : "Try again"}
        </Button>
        <span class="text-xs text-gray-400">
          Reruns all drafts from the same transcript.
        </span>
      </div>
      {#if retryError}
        <p class="mt-2 text-sm text-red-700" role="alert">{retryError}</p>
      {/if}
    {/if}
  </div>
{/if}
