<script lang="ts">
  import { cn } from "$lib/utils";
  import type { ToolDetail, ToolRenderNode } from "$lib/chat/turnParts";
  import {
    Source,
    ChainOfThoughtContent,
    ChainOfThoughtItem,
    ChainOfThoughtStep,
    ChainOfThoughtTrigger,
  } from "./primitives";

  interface Props {
    node: ToolRenderNode;
    open?: boolean;
  }

  let { node, open = $bindable(false) }: Props = $props();

  const status = $derived(
    node.state === "output-available"
      ? ("complete" as const)
      : node.state === "output-error"
        ? ("failed" as const)
        : ("active" as const)
  );

  /** Red treatment belongs to the failed output only — the input stays readable. */
  const outputFailed = $derived(node.state === "output-error");

  // Most steps say everything in their label. Only offer a disclosure when
  // there is genuinely something more to read.
  const expandable = $derived(node.input !== undefined || node.output !== undefined);
</script>

{#snippet well(text: string, failed: boolean)}
  <div
    class={cn(
      // Capped low: a taller well becomes a third nested scroll context (rail
      // → transcript → well) that traps the trackpad mid-message.
      "max-h-32 overflow-auto rounded-lg border p-2.5",
      failed ? "border-red-200 bg-red-50" : "border-line-soft bg-chrome"
    )}
  >
    <p
      class={cn(
        "text-xs leading-relaxed whitespace-pre-wrap break-words",
        failed ? "text-red-600" : "text-ink-secondary"
      )}
    >
      {text}
    </p>
  </div>
{/snippet}

{#snippet detail(value: ToolDetail, failed: boolean)}
  {#if value.kind === "fields"}
    {#each value.fields as field (field.label)}
      <p class="text-label">{field.label}</p>
      {@render well(field.value, failed)}
    {/each}
  {:else}
    {@render well(value.text, failed)}
  {/if}
{/snippet}

<ChainOfThoughtStep bind:open {expandable}>
  <ChainOfThoughtTrigger {status} {expandable} statusLabel={node.accessibleStatus}>
    {node.label}
  </ChainOfThoughtTrigger>
  {#if expandable}
  <ChainOfThoughtContent>
    {#if node.input}
      <ChainOfThoughtItem class="space-y-1.5">
        {@render detail(node.input, false)}
      </ChainOfThoughtItem>
    {/if}
    {#if node.output}
      <ChainOfThoughtItem class="space-y-1.5">
        <div class="flex items-center gap-1.5">
          {#if outputFailed}
            <!-- Icon so the failure is not signalled by colour alone. -->
            <svg
              class="h-3.5 w-3.5 shrink-0 text-red-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="2"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="9" />
              <path stroke-linecap="round" d="M12 8v4m0 3.5v.5" />
            </svg>
            <span class="text-label text-red-600">What happened</span>
          {:else}
            <span class="text-label">What I found</span>
          {/if}
        </div>
        {@render detail(node.output, outputFailed)}
        {#if node.sources?.length}
          <div class="flex flex-wrap gap-1.5 pt-1" role="group" aria-label="Brain sources">
            {#each node.sources as source, index (index)}
              <Source>
                <span class="inline-flex max-w-full flex-wrap gap-x-1.5 rounded-lg bg-chrome px-2 py-1 text-xs font-normal text-ink-secondary [overflow-wrap:anywhere]">
                  {#if source.title}<span class="min-w-0 max-w-full">{source.title}</span>{/if}
                  {#if source.scienceCode}<span class="min-w-0 max-w-full text-ink-muted">{source.scienceCode}</span>{/if}
                </span>
              </Source>
            {/each}
          </div>
        {/if}
      </ChainOfThoughtItem>
    {/if}
  </ChainOfThoughtContent>
  {/if}
</ChainOfThoughtStep>
