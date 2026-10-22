<script lang="ts">
  import { untrack } from "svelte";
  import { SvelteMap } from "svelte/reactivity";
  import type { UIMessage } from "@convex-dev/agent";
  import { cn } from "$lib/utils";
  import {
    formatTurnSummary,
    holdLabel,
    turnHeadline,
    thinkingHint,
    type HeldLabel,
    type NormalizedTurn,
    type ReasoningRenderNode,
    type ToolRenderNode,
    type TurnTiming,
  } from "$lib/chat/turnParts";
  import ReasoningTraceStep from "./ReasoningTraceStep.svelte";
  import { getChatContainerContext } from "./primitives/context";
  import ToolTraceStep from "./ToolTraceStep.svelte";

  interface Props {
    nodes: (ReasoningRenderNode | ToolRenderNode)[];
    timing?: TurnTiming;
    messageStatus?: UIMessage["status"];
    /** Test/story override for the component clock. */
    now?: number;
    /** Freeze the clock behind the thinking hint (the connection is down). */
    paused?: boolean;
  }

  let { nodes, timing, messageStatus, now, paused = false }: Props = $props();

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
   * `formatTurnSummary` reads the trace nodes and the timing, never the
   * answer text or the cards.
   */
  const turn = $derived<NormalizedTurn>({
    nodes,
    text: "",
    traceNodes: nodes,
    // The header carries no outcome since 2026-10-21; the cards follow it.
    proposalNodes: [],
    toolCount: new Set(
      nodes.filter((node) => node.kind === "tool").map((node) => node.toolCallId)
    ).size,
    hasReasoning: nodes.some((node) => node.kind === "reasoning"),
  });

  const summary = $derived(formatTurnSummary(turn, timing, messageStatus));
  // The second line, beside a clock: the newest reasoning heading or step.
  const headline = $derived(turnHeadline(nodes));
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

  // Owner, 2026-10-21 (as Claude shows its thought process): the block stays
  // folded, live or not. Its two lines are the progress signal; the writer
  // opens it to read the thought process.
  let open = $state(false);
  // Opening or closing must not move the bar under the pointer: the chat
  // holds it in place through the change (owner, 2026-10-21).
  const chat = getChatContainerContext();
  let summaryEl: HTMLElement | null = $state(null);
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

{#snippet clockIcon()}
  <svg class="mt-0.5 size-4 shrink-0 text-ink-faint" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M3.5 12a8.5 8.5 0 1 0 2.5-6" />
    <path d="M3.5 4.5V9H8" />
    <path d="M12 7.5V12l3 2" />
  </svg>
{/snippet}

{#snippet header(interactive: boolean)}
  <!-- Owner, 2026-10-21: hovering this row is a plain opacity change on the
       label and the chevron, no fill. Ink at 65% keeps the resting label
       above 4.5:1 on white. The chevron shows only on hover (and
       on keyboard focus, and always on touch, which has no hover). -->
  <span class="group/status flex w-full items-center gap-2">
    <!-- The live label shimmers instead of counting time; a finished one
         says how long it took (owner, 2026-10-21). -->
    <span
      aria-live="polite"
      data-turn-status
      class={cn(
        "min-w-0 text-[0.8125rem] leading-[calc(20/13)] text-ink",
        interactive
          ? "opacity-65 transition-opacity group-hover/status:opacity-100 group-focus-visible/summary:opacity-100 motion-reduce:transition-none"
          : "opacity-65",
        live && "text-shimmer"
      )}>{shownHead}</span>
    {#if interactive}
      <!-- Rule 7: the chevron at the row's right edge. -->
      <svg
        data-turn-chevron
        class={cn(
          "ml-auto size-3.5 shrink-0 text-ink-muted opacity-0 transition-[opacity,transform] group-hover/status:opacity-100 group-focus-visible/summary:opacity-100 pointer-coarse:opacity-100 motion-reduce:transition-none",
          open && "rotate-180"
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
  </span>
{/snippet}

{#snippet headlineRow()}
  {#if headline}
    <!-- Owner, 2026-10-21: the headline belongs to the open block; closed,
         only the first line shows. Not announced: it is the model's own
         summary and changes as it thinks. -->
    <p class="flex w-full items-start gap-2 pt-1 text-sm leading-[calc(10/7)] text-ink-secondary" data-turn-headline>
      {@render clockIcon()}
      <span class="min-w-0">{headline}</span>
    </p>
  {/if}
{/snippet}

{#if summary}
  {@const blockClass = "-mx-2 flex w-[calc(100%+1rem)] list-none flex-col gap-2 rounded-lg px-2 py-1.5 pointer-coarse:min-h-11 [&::-webkit-details-marker]:hidden"}
  {#if nodes.length}
    <!-- The whole block is one accordion, full width, as Claude shows its
         thought process (owner, 2026-10-21). -->
    <details bind:open class="disclosure-ease group/turn">
      <summary
        bind:this={summaryEl}
        onclick={() => summaryEl && chat?.keepInPlace(summaryEl)}
        class={cn(
          blockClass,
          "group/summary cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1"
        )}
      >
        {@render header(true)}
      </summary>

      {@render headlineRow()}

      <!-- The thought process in order: the reasoning as plain text, and each
           tool step as a row. Indented under the clock's text. -->
      <ol class="flex flex-col gap-2 pt-1 pb-2 pl-6" aria-label="Thought process">
        {#each nodes as node (node.key)}
          {#if node.kind === "reasoning"}
            <ReasoningTraceStep {node} />
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
    <!-- Nothing behind the header (a queued turn, or a step count that
         outlived its parts across a reload). A disclosure here would be
         focusable and clickable but open onto nothing. -->
    <div class={blockClass}>{@render header(false)}</div>
  {/if}
  {#if hint}
    <!-- Quiet, not announced: the live status line already says Thinking. -->
    <p class="px-2 pb-1 text-xs leading-relaxed text-ink-muted" data-thinking-hint>{hint}</p>
  {/if}
{/if}
