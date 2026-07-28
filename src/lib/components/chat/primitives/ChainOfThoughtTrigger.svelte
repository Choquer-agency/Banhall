<script lang="ts">
  import type { Snippet } from "svelte";
  import { cn } from "$lib/utils";

  interface Props {
    status?: "complete" | "active" | "pending" | "failed";
    /** Human-readable status for screen readers; falls back to `status`. */
    statusLabel?: string;
    /** False hides the chevron for a step with nothing to disclose. */
    expandable?: boolean;
    class?: string;
    children?: Snippet;
    leftIcon?: Snippet;
  }

  let {
    status = "complete",
    statusLabel,
    expandable = true,
    class: className,
    children,
    leftIcon,
  }: Props = $props();

  // Only a running step earns the accent (design-system rule 1: one accent per
  // view, and it belongs to the proposal card's Apply button, not to a row of
  // completed process dots). ResearchFeed's stage icons keep `primary` via the
  // leftIcon path below — that surface's established look is documented.
  const dotClass = $derived(
    status === "failed"
      ? "bg-red-500"
      : status === "active"
        ? "bg-primary"
        : status === "pending"
          ? "bg-gray-200"
          : "bg-ink-faint"
  );
</script>

<svelte:element
  this={expandable ? "summary" : "div"}
  class={cn(
    // -mx-2 keeps the label optically aligned with the connector while the
    // padding gives the hover fill a shape and a comfortable pointer target.
    "group/trigger -mx-2 flex list-none items-center justify-between gap-1 rounded-lg px-2 py-1.5 text-left text-xs font-medium leading-4 text-ink-muted transition-colors [&::-webkit-details-marker]:hidden",
    expandable
      ? "cursor-pointer hover:bg-primary-wash hover:text-navy focus-visible:bg-primary-wash focus-visible:text-navy focus-visible:outline-none"
      : "",
    className
  )}
>
  <span class="flex min-w-0 flex-1 items-center gap-2">
    <span
      class={`inline-flex h-4 w-4 shrink-0 items-center justify-center [&_svg]:h-3.5 [&_svg]:w-3.5 ${
        status === "failed" ? "text-red-500" : status === "pending" ? "text-primary/30" : "text-primary"
      } ${status === "active" ? "animate-pulse motion-reduce:animate-none" : ""}`}
      aria-hidden="true"
    >
      {#if leftIcon}
        {@render leftIcon()}
      {:else}
        <span class={`h-2 w-2 rounded-full ${dotClass} ${status === "active" ? "animate-pulse motion-reduce:animate-none" : ""}`}></span>
      {/if}
    </span>
    <span class={`min-w-0 ${status === "pending" ? "text-ink-faint" : ""}`}>{@render children?.()}</span>
    <span class="sr-only">— {statusLabel ?? status}</span>
  </span>
  <!-- Disclosure chevron stays at the right edge, down closed → up open
       (design-system rule 7); the left slot keeps the step's status icon. -->
  {#if expandable}
  <svg
    class="h-3.5 w-3.5 shrink-0 transition-transform group-open/step:rotate-180 group-open/step:text-primary motion-reduce:transition-none"
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    stroke-width="2"
    aria-hidden="true"
  >
    <path stroke-linecap="round" stroke-linejoin="round" d="m6 9 6 6 6-6" />
  </svg>
  {/if}
</svelte:element>
