<script lang="ts">
  import type { ReasoningRenderNode } from "$lib/chat/turnParts";
  import {
    ChainOfThoughtContent,
    ChainOfThoughtItem,
    ChainOfThoughtStep,
    ChainOfThoughtTrigger,
  } from "./primitives";

  interface Props {
    node: ReasoningRenderNode;
    open?: boolean;
  }

  let { node, open = $bindable(false) }: Props = $props();

  const streaming = $derived(node.state === "streaming");
  // Phase A: the text is Anthropic's summary of the model's thinking (the
  // server passes nothing else). Summaries mark their headings with **bold**;
  // the markers are dropped so the plain-text box does not show asterisks.
  const summary = $derived(node.text.replace(/\*\*([^*\n]+)\*\*/g, "$1"));
</script>

<ChainOfThoughtStep bind:open>
  <ChainOfThoughtTrigger
    status={streaming ? "active" : "complete"}
    statusLabel={streaming ? "Running" : "Done"}
  >
    <!-- "Reasoning", not "Thought": the summary above may already read
         "Thought for 5s", and a row repeating the word inside it reads oddly. -->
    {streaming ? "Thinking…" : "Reasoning"}
  </ChainOfThoughtTrigger>
  <ChainOfThoughtContent>
    <ChainOfThoughtItem>
      <!-- Reasoning is plain text, never markdown: model scratchpad output is
           not authored prose and stray syntax must not become formatting. -->
      <div class="max-h-32 overflow-auto rounded-lg border border-line-soft bg-chrome p-2.5" aria-busy={streaming} data-reasoning-summary>
        <p class="text-xs leading-relaxed whitespace-pre-wrap break-words text-ink-secondary">{summary}</p>
      </div>
    </ChainOfThoughtItem>
  </ChainOfThoughtContent>
</ChainOfThoughtStep>
