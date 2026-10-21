<script lang="ts">
  import type { Snippet } from "svelte";
  import { cn } from "$lib/utils";

  /**
   * One step of an Assistant turn's trace (owner, 2026-10-21, after Claude's
   * and ChatGPT's step lists): a quiet line with a small status icon, the
   * label, and a chevron when there is more to read. No timeline dots or
   * connector lines. The research feed keeps its own ChainOfThought steps.
   */
  interface Props {
    label: string;
    status: "complete" | "active" | "failed";
    /** Human-readable status for screen readers. */
    statusLabel: string;
    open?: boolean;
    /** False renders a static row: nothing to disclose, so nothing to click. */
    expandable?: boolean;
    children?: Snippet;
  }

  let { label, status, statusLabel, open = $bindable(false), expandable = true, children }: Props = $props();

  const rowClass =
    "-ml-2 flex w-fit max-w-full list-none items-center gap-2 rounded-lg px-2 py-1 text-xs leading-4 text-ink-muted transition-colors pointer-coarse:min-h-11 [&::-webkit-details-marker]:hidden";
</script>

{#snippet row()}
  <span class="flex size-3.5 shrink-0 items-center justify-center" aria-hidden="true">
    {#if status === "complete"}
      <svg class="size-3.5 text-ink-faint" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round" d="M5 12.5l4.5 4.5L19 7.5" />
      </svg>
    {:else if status === "failed"}
      <!-- An icon, so the failure is not signalled by colour alone. -->
      <svg class="size-3.5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path stroke-linecap="round" d="M12 8v4m0 3.5v.5" />
      </svg>
    {:else}
      <span class="size-1.5 rounded-full bg-ink-faint"></span>
    {/if}
  </span>
  <span class={cn("min-w-0", status === "active" && "text-shimmer", status === "failed" && "text-red-600")}>{label}</span>
  <span class="sr-only">, {statusLabel}</span>
  {#if expandable}
    <svg
      class="size-3 shrink-0 text-ink-faint transition-transform group-open/step:rotate-180 group-open/step:text-primary motion-reduce:transition-none"
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

<li class="list-none" data-trace-step={status}>
  {#if expandable}
    <details bind:open class="group/step">
      <summary
        class={cn(
          rowClass,
          "cursor-pointer hover:bg-primary-wash hover:text-navy focus-visible:bg-primary-wash focus-visible:text-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1"
        )}
      >
        {@render row()}
      </summary>
      <div class="ml-[1.375rem] space-y-1.5 pt-0.5 pb-2">
        {@render children?.()}
      </div>
    </details>
  {:else}
    <div class={rowClass}>{@render row()}</div>
  {/if}
</li>
