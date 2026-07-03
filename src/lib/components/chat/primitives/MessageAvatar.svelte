<script lang="ts">
  import type { Snippet } from "svelte";
  import { cn } from "$lib/utils";

  /**
   * Small round avatar for a message row or chat header. Precedence:
   * `children` glyph (e.g. <ChatIcon />) > `src` image > `fallback` initials.
   */
  interface Props {
    src?: string;
    alt?: string;
    /** Short fallback (initials) when there is no image. */
    fallback?: string;
    class?: string;
    /** Custom glyph — rendered in the brand navy circle. */
    children?: Snippet;
  }

  let { src, alt = "", fallback = "", class: className, children }: Props = $props();
</script>

{#if children}
  <span
    class={cn(
      "flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-navy text-white",
      className
    )}
  >
    {@render children()}
  </span>
{:else if src}
  <img {src} {alt} class={cn("h-6 w-6 shrink-0 rounded-full object-cover", className)} />
{:else}
  <span
    class={cn(
      "flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-navy text-[10px] font-semibold text-white",
      className
    )}
  >
    {fallback}
  </span>
{/if}
