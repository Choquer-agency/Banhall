<script lang="ts">
  import { IconSidebar } from "$lib/components/icons";

  /**
   * The rail toggle glyph (boards A1 to A5): the board's sidebar icon, 16px
   * in the expanded rail header and 17px in the collapsed rail, stroke 1.5.
   * The boards draw no hover arrow, so the glyph stays put in both states.
   */
  let { direction, size = 16 }: { direction: "collapse" | "expand"; size?: number } = $props();
</script>

<IconSidebar {size} strokeWidth={1.5} data-rail-toggle-icon={direction} class="shrink-0" />
