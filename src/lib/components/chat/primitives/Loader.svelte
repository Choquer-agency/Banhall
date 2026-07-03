<script lang="ts">
  import { cn } from "$lib/utils";

  /**
   * Chat typing indicator — three bouncing dots (the "awaiting reply" state).
   * `md` is the chat default; `sm` for compact/inline placements.
   */
  interface Props {
    variant?: "dots";
    size?: "sm" | "md";
    class?: string;
  }

  let { variant = "dots", size = "md", class: className }: Props = $props();

  const dot = $derived(size === "sm" ? "h-1 w-1" : "h-1.5 w-1.5");
</script>

{#if variant === "dots"}
  <div
    class={cn("flex items-center gap-1", className)}
    role="status"
    aria-label="Assistant is responding"
  >
    <span class={cn(dot, "animate-bounce rounded-full bg-gray-400 [animation-delay:-0.3s]")}></span>
    <span class={cn(dot, "animate-bounce rounded-full bg-gray-400 [animation-delay:-0.15s]")}></span>
    <span class={cn(dot, "animate-bounce rounded-full bg-gray-400")}></span>
  </div>
{/if}
