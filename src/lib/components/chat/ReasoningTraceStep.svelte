<script lang="ts">
  import type { ReasoningRenderNode } from "$lib/chat/turnParts";
  import TraceStepRow from "./TraceStepRow.svelte";

  interface Props {
    node: ReasoningRenderNode;
    open?: boolean;
  }

  let { node, open = $bindable(false) }: Props = $props();

  const streaming = $derived(node.state === "streaming");
  // Phase A: the text is Anthropic's summary of the model's thinking (the
  // server passes nothing else). Summaries mark their headings with **bold**;
  // the markers are dropped so the plain text does not show asterisks.
  const summary = $derived(node.text.replace(/\*\*([^*\n]+)\*\*/g, "$1"));
</script>

<!-- "Reasoning", not "Thought": a finished trace may already read "Thought". -->
<TraceStepRow bind:open status={streaming ? "active" : "complete"} statusLabel={streaming ? "Running" : "Done"} label={streaming ? "Thinking…" : "Reasoning"}>
  <!-- Reasoning is plain text, never markdown: model scratchpad output is
       not authored prose and stray syntax must not become formatting. -->
  <div class="max-h-48 overflow-auto border-l border-line pl-3" aria-busy={streaming} data-reasoning-summary>
    <p class="text-xs leading-relaxed whitespace-pre-wrap break-words text-ink-secondary">{summary}</p>
  </div>
</TraceStepRow>
