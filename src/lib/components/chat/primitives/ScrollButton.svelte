<script lang="ts">
  import { cn } from "$lib/utils";
  import { getChatContainerContext } from "./context";

  /**
   * Floating "jump to latest" button. Render anywhere inside a
   * <ChatContainer> — it reads the container's context and appears only when
   * the user has scrolled away from the bottom.
   */
  interface Props {
    class?: string;
    /** Scroll behavior when jumping back down. */
    behavior?: ScrollBehavior;
  }

  let { class: className, behavior = "smooth" }: Props = $props();

  const container = getChatContainerContext();
  const visible = $derived(container ? !container.isAtBottom : false);
  // Widen into a labeled pill when unseen content arrived below the fold.
  const showLabel = $derived(visible && !!container?.hasUnseen);
</script>

<button
  type="button"
  aria-label="Jump to latest message"
  tabindex={visible ? 0 : -1}
  onclick={() => container?.scrollToBottom(behavior)}
  class={cn(
    "absolute bottom-3 left-1/2 z-10 flex h-8 -translate-x-1/2 items-center justify-center gap-1.5 rounded-full border border-line bg-white text-navy shadow-md transition hover:bg-primary-wash motion-reduce:transition-none",
    showLabel ? "px-3" : "w-8",
    !visible && "pointer-events-none translate-y-2 opacity-0",
    className
  )}
>
  {#if showLabel}
    <span class="whitespace-nowrap text-xs font-medium">New messages</span>
  {/if}
  <svg class="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
    <path stroke-linecap="round" stroke-linejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
  </svg>
</button>
