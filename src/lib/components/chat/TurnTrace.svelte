<script lang="ts">
  import { untrack } from "svelte";
  import { SvelteMap } from "svelte/reactivity";
  import type { UIMessage } from "@convex-dev/agent";
  import { cn } from "$lib/utils";
  import {
    formatTurnSummary,
    type NormalizedTurn,
    type ProposalRenderNode,
    type ReasoningRenderNode,
    type ToolRenderNode,
    type TurnTiming,
  } from "$lib/chat/turnParts";
  import { ChainOfThought } from "./primitives";
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
  }

  let { nodes, proposalNodes = [], timing, messageStatus, now }: Props = $props();

  const live = $derived(
    timing?.status === "queued" ||
      timing?.status === "running" ||
      (timing === undefined && (messageStatus === "streaming" || messageStatus === "pending"))
  );

  let tick = $state(0);
  const clock = $derived(now ?? tick);

  $effect(() => {
    // Only a live turn needs a clock; a terminal summary is frozen, and an idle
    // interval per historical turn would leak across a long transcript.
    if (!live || now !== undefined) return;
    tick = Date.now();
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

  const summary = $derived(formatTurnSummary(turn, timing, messageStatus, clock));

  // The head is the state label ("Working…", "Worked for 12s"); the tail holds
  // the ticking timer and step count, which must not be announced every second.
  const head = $derived(summary?.split(" · ")[0] ?? "");
  const tail = $derived(summary?.split(" · ").slice(1).join(" · ") ?? "");

  // Initial liveness only: a live turn mounts open, a historical one collapsed.
  let open = $state(untrack(() => live));
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
  {#if live}
    <span
      class="h-1.5 w-1.5 shrink-0 rounded-full bg-primary animate-pulse motion-reduce:animate-none"
      aria-hidden="true"
    ></span>
  {/if}
  <span aria-live="polite">{head}</span>
  {#if tail}
    <span class="text-data text-ink-muted" aria-hidden="true">{tail}</span>
  {/if}
  {#if interactive}
    <svg
      class={cn(
        "ml-auto h-3.5 w-3.5 shrink-0 transition-transform motion-reduce:transition-none",
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
    "flex w-full list-none items-center gap-2 rounded-lg px-2 text-xs font-medium transition-colors [&::-webkit-details-marker]:hidden",
    // A live turn is a real target the writer reaches for; a finished one is a
    // quiet footnote they scroll past, so it shouldn't cost 44px in every past
    // turn of a long transcript.
    live ? "min-h-11" : "min-h-8",
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

      <div class="pt-1 pl-2">
        <ChainOfThought>
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
        </ChainOfThought>
      </div>
    </details>
  {:else}
    <!-- Nothing behind the summary (a queued turn, or a step count that
         outlived its parts across a reload). A disclosure here would be
         focusable and clickable but open onto nothing. -->
    <div class={rowClass}>{@render summaryRow(false)}</div>
  {/if}
{/if}
