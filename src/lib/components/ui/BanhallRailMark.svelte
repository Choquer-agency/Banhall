<script lang="ts">
  import LogoMark from "$lib/components/brand/LogoMark.svelte";
  import {
    BANHALL_LOGO_ARTWORK,
    BANHALL_LOGO_SIZE,
    BANHALL_LOGO_SOURCES,
  } from "./BanhallLogo.svelte";

  /**
   * The mark at the top of the round 2 rail. Expanded, it is the real logo,
   * replacing the boards' placeholder "B Banhall" tile: the rail is a light
   * surface, so always the dark wordmark, with the PNG's built-in padding
   * clipped away so the artwork's left edge lines up with the rail gutter and
   * its box is the artwork itself, 36px tall. Collapsed (the 56px icon-only
   * rail, A4, A5, H1, H3), the wordmark is unreadable at 40px wide, so it is
   * the 28px square `LogoMark` (decision 62) in place of the boards' "B" tile.
   */
  let {
    collapsed = false,
    class: className = "",
  }: {
    collapsed?: boolean;
    class?: string;
  } = $props();

  const scale = $derived(36 / BANHALL_LOGO_ARTWORK.height);
  const px = (value: number) => `${Math.round(value * scale * 100) / 100}px`;
</script>

{#if collapsed}
  <LogoMark size={28} data-banhall-rail-mark="collapsed" class={className} />
{:else}
  <span
    data-banhall-rail-mark="expanded"
    class={`relative block shrink-0 overflow-hidden ${className}`}
    style:width={px(BANHALL_LOGO_ARTWORK.width)}
    style:height={px(BANHALL_LOGO_ARTWORK.height)}
  >
    <img
      src={BANHALL_LOGO_SOURCES.dark}
      alt="Banhall"
      draggable="false"
      class="absolute max-w-none select-none"
      style:left={px(-BANHALL_LOGO_ARTWORK.x)}
      style:top={px(-BANHALL_LOGO_ARTWORK.y)}
      style:width={px(BANHALL_LOGO_SIZE.width)}
      style:height={px(BANHALL_LOGO_SIZE.height)}
    />
  </span>
{/if}
