<script lang="ts">
  import { humanizeItemIds, type ReasoningRenderNode } from "$lib/chat/turnParts";

  interface Props {
    node: ReasoningRenderNode;
  }

  let { node }: Props = $props();

  const streaming = $derived(node.state === "streaming");

  /**
   * Phase A: the text is Anthropic's summary of the model's thinking (the
   * server passes nothing else). Owner, 2026-10-21: it reads as Claude shows
   * its thought process, as plain text in the open thought block. A line the
   * summary marks as a **heading** reads a shade stronger; other markers are
   * dropped so no asterisks show.
   */
  const lines = $derived(
    humanizeItemIds(node.text)
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        // A heading may still be streaming in, with no closing marker yet.
        const heading = /^\*\*([^*]+?)(\*\*)?$/.exec(line);
        return heading
          ? { heading: true, text: heading[1].trim() }
          : { heading: false, text: line.replace(/\*\*([^*\n]+)\*\*/g, "$1").replace(/\*\*/g, "") };
      })
  );
</script>

<!-- Reasoning is plain text, never markdown: model scratchpad output is not
     authored prose and stray syntax must not become formatting. -->
<li class="list-none" data-reasoning-summary aria-busy={streaming}>
  <div class="flex flex-col gap-1 text-[0.8125rem] leading-relaxed break-words text-ink-muted">
    {#each lines as line, index (index)}
      <p class={line.heading ? "font-medium text-ink-secondary" : undefined}>{line.text}</p>
    {/each}
  </div>
</li>
