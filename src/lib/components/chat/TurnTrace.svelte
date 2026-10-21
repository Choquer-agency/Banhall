<script lang="ts">
  import { untrack } from "svelte";
  import { SvelteMap } from "svelte/reactivity";
  import type { UIMessage } from "@convex-dev/agent";
  import { cn } from "$lib/utils";
  import {
    formatTurnSummary,
    holdLabel,
    thinkingHint,
    type HeldLabel,
    type NormalizedTurn,
    type ProposalRenderNode,
    type ReasoningRenderNode,
    type ToolRenderNode,
    type TurnTiming,
  } from "$lib/chat/turnParts";
  import ReasoningTraceStep from "./ReasoningTraceStep.svelte";
  import ToolTraceStep from "./ToolTraceStep.svelte";

  interface Props {
    nodes: (ReasoningRenderNode | ToolRenderNode)[];
    /** Feeds the summary's outcome ("· 2 suggestions"); not rendered here. */
    proposalNodes?: ProposalRenderNode[];
    timing?: TurnTiming;
    messageStatus?: UIMessage["status"];
    /** Test/story override for the component clock. */
    now?: number;
    /** Freeze the clock behind the thinking hint (the connection is down). */
    paused?: boolean;
  }

  let { nodes, proposalNodes = [], timing, messageStatus, now, paused = false }: Props = $props();

  const live = $derived(
    timing?.status === "queued" ||
      timing?.status === "running" ||
      (timing === undefined && (messageStatus === "streaming" || messageStatus === "pending"))
  );

  let tick = $state(0);
  const clock = $derived(now ?? tick);

  $effect(() => {
    // Owner, 2026-10-21: no timer is shown. The clock only times the quiet
    // hint under a long thinking phase. Only a live turn needs it; an idle
    // interval per historical turn would leak across a long transcript.
    // Offline, the turn's real state is unknown, so the clock stops.
    if (!live || now !== undefined) return;
    tick = Date.now();
    if (paused) return;
    const id = setInterval(() => {
      tick = Date.now();
    }, 1000);
    return () => clearInterval(id);
  });

  /**
   * `formatTurnSummary` reads the trace nodes plus the turn's proposals (it
   * summarizes what the turn produced), but never its answer text.
   */
  const turn = $derived<NormalizedTurn>({
    nodes,
    text: "",
    traceNodes: nodes,
    proposalNodes,
    toolCount: new Set(
      nodes.filter((node) => node.kind === "tool").map((node) => node.toolCallId)
    ).size,
    hasReasoning: nodes.some((node) => node.kind === "reasoning"),
  });

  const summary = $derived(formatTurnSummary(turn, timing, messageStatus));
  const head = $derived(summary ?? "");

  // Phase A: each live label stays up for at least LABEL_HOLD_MS, so a fast
  // phase change neither flickers nor floods the live region below. A
  // terminal summary ("Worked for 12s") shows at once.
  let held = $state<HeldLabel | null>(null);
  $effect(() => {
    const next = head;
    if (!live) {
      held = null;
      return;
    }
    const result = holdLabel(untrack(() => held), next, Date.now());
    held = result.held;
    if (result.waitMs <= 0) return;
    const id = setTimeout(() => {
      held = { shown: next, shownAt: Date.now() };
    }, result.waitMs);
    return () => clearTimeout(id);
  });
  const shownHead = $derived(live && held ? held.shown : head);
  // The hint's minute is counted on the browser clock from when this
  // thinking phase was first seen, never against the server's `since`.
  let thinkingSeen = $state<{ since: number; at: number } | null>(null);
  $effect(() => {
    const progress = timing?.progress;
    const since = live && progress?.phase === "thinking" ? progress.since : null;
    if (since === null) {
      thinkingSeen = null;
      return;
    }
    if (untrack(() => thinkingSeen?.since) !== since) {
      thinkingSeen = { since, at: untrack(() => now) ?? Date.now() };
    }
  });
  const hint = $derived(live ? thinkingHint(timing, clock, thinkingSeen?.at) : null);

  // Owner, 2026-10-21 (as Claude and ChatGPT do): the steps stay folded, live
  // or not. The one status line is the progress signal; the writer opens the
  // steps when they want them.
  let open = $state(false);
  let wasLive = $state(untrack(() => live));

  $effect(() => {
    const isLive = live;
    // Collapse once, on the live→terminal transition only. Re-asserting a
    // closed state on every run would fight a user expanding a past trace.
    if (!isLive && untrack(() => wasLive)) open = false;
    wasLive = isLive;
  });

  /**
   * Steps stay closed unless the writer opens them. Auto-opening the newest
   * step made the rail jump on every tool call — each one collapsing the last
   * and expanding a fresh body under a stick-to-bottom scroller. The label
   * alone is the progress signal.
   */
  const toggled = new SvelteMap<string, boolean>();
  const stepOpen = (key: string) => toggled.get(key) ?? false;
</script>

{#snippet summaryRow(interactive: boolean)}
  <!-- The live label shimmers instead of counting time (owner, 2026-10-21). -->
  <span aria-live="polite" data-turn-status class={live ? "text-shimmer" : undefined}>{shownHead}</span>
  {#if interactive}
    <!-- Rule 7: the chevron ends the row, which is only as wide as its label. -->
    <svg
      class={cn(
        "h-3 w-3 shrink-0 transition-transform motion-reduce:transition-none",
        open ? "rotate-180 text-primary" : "text-ink-faint"
      )}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      stroke-width="2"
      aria-hidden="true"
    >
      <path stroke-linecap="round" stroke-linejoin="round" d="m6 9 6 6 6-6" />
    </svg>
  {/if}
{/snippet}

{#if summary}
  {@const rowClass = cn(
    // As wide as its label, like Claude's and ChatGPT's status line: a quiet
    // line of text, not a full-width bar.
    "-ml-2 flex w-fit max-w-full list-none items-center gap-1.5 rounded-lg px-2 text-[0.8125rem] leading-5 transition-colors [&::-webkit-details-marker]:hidden",
    "min-h-8 pointer-coarse:min-h-11",
    open ? "text-ink-secondary" : "text-ink-muted"
  )}
  {#if nodes.length}
    <details bind:open class="group/turn">
      <summary
        class={cn(
          rowClass,
          "cursor-pointer hover:bg-primary-wash focus-visible:bg-primary-wash focus-visible:text-navy focus-visible:outline-none"
        )}
      >
        {@render summaryRow(true)}
      </summary>

      <ol class="pt-0.5 pb-1" aria-label="Steps">
        {#each nodes as node (node.key)}
          {#if node.kind === "reasoning"}
            <ReasoningTraceStep
              {node}
              bind:open={
                () => stepOpen(node.key),
                (value) => toggled.set(node.key, value)
              }
            />
          {:else}
            <ToolTraceStep
              {node}
              bind:open={
                () => stepOpen(node.key),
                (value) => toggled.set(node.key, value)
              }
            />
          {/if}
        {/each}
      </ol>
    </details>
  {:else}
    <!-- Nothing behind the summary (a queued turn, or a step count that
         outlived its parts across a reload). A disclosure here would be
         focusable and clickable but open onto nothing. -->
    <div class={rowClass}>{@render summaryRow(false)}</div>
  {/if}
  {#if hint}
    <!-- Quiet, not announced: the live status line already says Thinking. -->
    <p class="px-2 pb-1 text-xs leading-relaxed text-ink-muted" data-thinking-hint>{hint}</p>
  {/if}
{/if}
