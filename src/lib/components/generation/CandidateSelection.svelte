<script module lang="ts">
  import type { Id } from "../../../../convex/_generated/dataModel";

  type SectionMeter = {
    lines: number;
    words: number;
    limit: number;
    wordCap: number;
    overLimit: boolean;
  };
  type CandidateMetrics = {
    s242: SectionMeter;
    s244: SectionMeter;
    s246: SectionMeter;
    lengthTarget?: string;
  } | null;

  type Candidate = {
    _id: Id<"reportCandidates">;
    model: string;
    label: string;
    content: string;
    qaScore: number | null;
    metrics?: CandidateMetrics;
  };

  /**
   * Deterministic shuffle seeded from the candidate ids — gives a stable order
   * across re-renders, but a different order for each generation (so the writer
   * can't learn "Option 1 is always Sonnet"). Keeps the test blind.
   */
  function blindOrder(candidates: Candidate[]): number[] {
    let seed = 0;
    for (const c of candidates) {
      for (let i = 0; i < c._id.length; i++) {
        seed = (seed * 31 + c._id.charCodeAt(i)) >>> 0;
      }
    }
    const rand = () => {
      seed = (seed + 0x6d2b79f5) >>> 0;
      let t = seed;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const order = candidates.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    return order;
  }
</script>

<script lang="ts">
  import { useQuery, useMutation } from "convex-svelte";
  import { api } from "../../../../convex/_generated/api";
  import ReadOnlyEditor from "$lib/components/review/ReadOnlyEditor.svelte";
  import Spinner from "$lib/components/ui/Spinner.svelte";

  /**
   * Blind A/B candidate picker (port of src/components/generation/CandidateSelection.tsx).
   * Shows the generated drafts in a blind, randomized (but deterministic) order as
   * "Option 1, 2, 3…" tabs with a read-only preview and a sticky "Use this draft" bar.
   *
   * Props:
   * - projectId: project whose candidates are listed (renders nothing when none)
   */
  let { projectId }: { projectId: Id<"projects"> } = $props();

  const candidatesQ = useQuery(api.generations.getCandidates, () => ({ projectId }));
  const candidates = $derived(candidatesQ.data as Candidate[] | undefined);
  const selectCandidate = useMutation(api.generations.selectReportCandidate);

  const order = $derived.by(() => (candidates ? blindOrder(candidates) : []));
  let activePos = $state(0);
  let choosing = $state(false);

  // Display candidates in blind, randomized order as "Option 1, 2, 3…".
  const displayed = $derived(candidates ? order.map((idx) => candidates[idx]) : []);
  const pos = $derived(activePos < displayed.length ? activePos : 0);
  const current = $derived(displayed[pos] as Candidate | undefined);

  async function choose() {
    if (!current) return;
    choosing = true;
    try {
      await selectCandidate({ candidateId: current._id });
      // Reactive queries flip the page to the report view on success.
    } catch (e) {
      console.error("selection failed", e);
      choosing = false;
    }
  }
</script>

{#if candidates && candidates.length > 0 && current}
  <div class="min-h-0 flex-1 overflow-y-auto">
    <div class="mx-auto max-w-report px-8 py-8">
      <div class="mb-1 flex items-center gap-2">
        <span class="flex h-6 w-6 items-center justify-center rounded-full bg-primary/15 text-primary-dark">
          <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
          </svg>
        </span>
        <h2 class="text-xl font-semibold text-gray-900">Choose your preferred draft</h2>
      </div>
      <p class="mb-5 text-sm text-gray-500">
        Each option is a full draft written from the same inputs by a different model — shown
        blind and in random order. Pick the one you&apos;d keep; your choice is logged to learn
        which model works best.
      </p>

      <!-- Anonymous option tabs -->
      <div class="flex flex-wrap gap-2">
        {#each displayed as c, i (c._id)}
          <button
            onclick={() => (activePos = i)}
            class={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
              i === pos
                ? "border-navy bg-navy text-white"
                : "border-gray-200 bg-white text-gray-700 hover:border-gray-300"
            }`}
          >
            Option {i + 1}
          </button>
        {/each}
      </div>

      <!-- BNH-45: CRA form-fit meters (78-char lines; breaks count) -->
      {#if current.metrics}
        {@const m = current.metrics}
        {@const sections = [
          { label: "242", sec: m.s242 },
          { label: "244", sec: m.s244 },
          { label: "246", sec: m.s246 },
        ]}
        <div class="mt-4 flex flex-wrap items-center gap-2">
          {#each sections as { label, sec } (label)}
            <span
              class={`text-data inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 ${
                sec.overLimit
                  ? "border-red-200 bg-red-50 text-red-700"
                  : "border-line-soft bg-white text-gray-600"
              }`}
              title={`Section ${label}: ${sec.lines} of ${sec.limit} form lines · ${sec.words} words (cap ${sec.wordCap})`}
            >
              <span class="font-semibold">{label}</span>
              {sec.lines}/{sec.limit} lines · {sec.words}w
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
        <ReadOnlyEditor content={current.content} />
      </div>
    </div>

    <!-- Sticky action bar -->
    <div class="sticky bottom-0 border-t border-gray-200 bg-white/90 px-8 py-3 backdrop-blur">
      <div class="mx-auto flex max-w-report items-center justify-between">
        <span class="text-sm text-gray-500">
          Viewing <span class="font-medium text-navy">Option {pos + 1}</span>
        </span>
        <button
          onclick={choose}
          disabled={choosing}
          class="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-dark disabled:opacity-50"
        >
          {#if choosing}
            <Spinner size="sm" class="h-3.5 w-3.5 border-white" />
            Saving…
          {:else}
            <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            Use this draft (Option {pos + 1})
          {/if}
        </button>
      </div>
    </div>
  </div>
{/if}
