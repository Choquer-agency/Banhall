<script lang="ts">
  import type { Snippet } from "svelte";
  import { cn } from "$lib/utils";

  interface Props {
    status?: "complete" | "active" | "pending" | "failed";
    class?: string;
    children?: Snippet;
    leftIcon?: Snippet;
  }

  let {
    status = "complete",
    class: className,
    children,
    leftIcon,
  }: Props = $props();

  const dotClass = $derived(
    status === "failed"
      ? "bg-red-500"
      : status === "pending"
        ? "bg-gray-200"
        : "bg-primary"
  );
</script>

<summary
  class={cn(
    "group/trigger flex cursor-pointer list-none items-center justify-start gap-1 py-0.5 text-left text-xs font-medium leading-4 text-ink-muted transition-colors hover:text-navy focus-visible:outline-none [&::-webkit-details-marker]:hidden",
    className
  )}
>
  <span class="flex min-w-0 items-center gap-2">
    <span
      class={`relative inline-flex h-4 w-4 shrink-0 items-center justify-center [&_svg]:h-3.5 [&_svg]:w-3.5 ${
        status === "failed" ? "text-red-500" : status === "pending" ? "text-primary/30" : "text-primary"
      } ${status === "active" ? "animate-pulse motion-reduce:animate-none" : ""}`}
      aria-hidden="true"
    >
      {#if leftIcon}
        <span class="transition-opacity group-hover/trigger:opacity-0">{@render leftIcon()}</span>
        <svg
          class="absolute h-3.5 w-3.5 opacity-0 transition-[opacity,transform] group-hover/trigger:opacity-100 group-open/step:rotate-180 motion-reduce:transition-none"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          stroke-width="2"
        >
          <path stroke-linecap="round" stroke-linejoin="round" d="m6 9 6 6 6-6" />
        </svg>
      {:else}
        <span class={`h-2 w-2 rounded-full ${dotClass} ${status === "active" ? "animate-pulse motion-reduce:animate-none" : ""}`}></span>
      {/if}
    </span>
    <span class={`min-w-0 ${status === "pending" ? "text-ink-faint" : ""}`}>{@render children?.()}</span>
    <span class="sr-only">Status: {status}</span>
  </span>
  {#if !leftIcon}
    <svg
      class="h-3.5 w-3.5 shrink-0 transition-transform group-open/step:rotate-180 motion-reduce:transition-none"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      stroke-width="2"
      aria-hidden="true"
    >
      <path stroke-linecap="round" stroke-linejoin="round" d="m6 9 6 6 6-6" />
    </svg>
  {/if}
</summary>
