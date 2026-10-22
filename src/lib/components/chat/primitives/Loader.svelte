<script lang="ts">
  import { cn } from "$lib/utils";

  /**
   * The "awaiting reply" state before the reply's own status line exists.
   * Owner, 2026-10-21 (as Claude and ChatGPT do): the same quiet shimmering
   * line the turn shows next, so nothing jumps when the turn takes over.
   */
  interface Props {
    class?: string;
  }

  let { class: className }: Props = $props();
</script>

<div
  class={cn("flex min-h-8 items-center text-[0.8125rem] leading-[calc(20/13)]", className)}
  role="status"
  aria-label="Assistant is responding"
>
  <span class="text-shimmer" aria-hidden="true">Thinking…</span>
</div>
