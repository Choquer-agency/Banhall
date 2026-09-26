<script lang="ts" module>
  export type BanhallLogoTone = "dark" | "white";

  /** static/ files: fir wordmark for light backgrounds, white for dark ones. */
  export const BANHALL_LOGO_SOURCES: Record<BanhallLogoTone, string> = {
    dark: "/banhall-logo-dark.png",
    white: "/banhall-logo-white.png",
  };

  /** Both PNGs are 308 x 138 with built-in padding around the artwork. */
  export const BANHALL_LOGO_SIZE = { width: 308, height: 138 } as const;

  /** Where the artwork sits inside the padding, in source pixels. */
  export const BANHALL_LOGO_ARTWORK = { x: 18, y: 15, width: 272, height: 103 } as const;
</script>

<script lang="ts">
  /**
   * The Banhall logo (round 2 HANDOFF). Dark on light backgrounds, white on
   * dark. `height` includes the built-in padding, so the handoff's "about 52
   * to 64px tall" maps straight onto it; the sign-in board uses 64.
   */
  let {
    tone = "dark",
    height = 56,
    alt = "Banhall",
    class: className = "",
  }: {
    tone?: BanhallLogoTone;
    height?: number;
    alt?: string;
    class?: string;
  } = $props();

  const width = $derived(Math.round((height * BANHALL_LOGO_SIZE.width) / BANHALL_LOGO_SIZE.height));
</script>

<img
  src={BANHALL_LOGO_SOURCES[tone]}
  {alt}
  {width}
  {height}
  draggable="false"
  data-banhall-logo={tone}
  class={`shrink-0 select-none ${className}`}
/>
