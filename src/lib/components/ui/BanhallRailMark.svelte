<script lang="ts">
  import {
    BANHALL_LOGO_ARTWORK,
    BANHALL_LOGO_SIZE,
    BANHALL_LOGO_SOURCES,
  } from "./BanhallLogo.svelte";

  /**
   * The real logo at the top of the round 2 rail, replacing the boards'
   * placeholder "B Banhall" tile. The rail is a light surface, so it is
   * always the dark wordmark. The PNG's built-in padding is clipped away so
   * the artwork's left edge lines up with the rail gutter and its box is the
   * artwork itself: 36px tall when expanded, 40px wide when collapsed (the
   * 56px icon-only rail). There is no separate square mark in the assets, so
   * the collapsed rail shows the same wordmark, scaled down.
   */
  let {
    collapsed = false,
    class: className = "",
  }: {
    collapsed?: boolean;
    class?: string;
  } = $props();

  const scale = $derived(
    collapsed ? 40 / BANHALL_LOGO_ARTWORK.width : 36 / BANHALL_LOGO_ARTWORK.height
  );
  const px = (value: number) => `${Math.round(value * scale * 100) / 100}px`;
</script>

<span
  data-banhall-rail-mark={collapsed ? "collapsed" : "expanded"}
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
