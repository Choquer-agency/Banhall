<script lang="ts">
  import {
    BANHALL_LOGO_ARTWORK,
    BANHALL_LOGO_SIZE,
    BANHALL_LOGO_SOURCES,
  } from "./BanhallLogo.svelte";

  /**
   * The mark at the top of the expanded round 2 rail: the real logo,
   * replacing the boards' placeholder "B Banhall" tile. The rail is a light
   * surface, so always the dark wordmark, with the PNG's built-in padding
   * clipped away so the artwork's left edge lines up with the rail gutter and
   * its box is the artwork itself, 36px tall. The collapsed rail shows no
   * logo at all (owner direction 2026-09-28, replacing decision 62's square
   * mark there; the favicon keeps `brand/LogoMark`).
   */
  let { class: className = "" }: { class?: string } = $props();

  const scale = $derived(36 / BANHALL_LOGO_ARTWORK.height);
  const px = (value: number) => `${Math.round(value * scale * 100) / 100}px`;
</script>

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
