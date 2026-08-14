<script lang="ts">
  import {
    ArrowSquareLeftIcon,
    ArrowSquareRightIcon,
    SidebarIcon,
  } from "phosphor-svelte";

  let { direction }: { direction: "collapse" | "expand" } = $props();
</script>

<!--
  Attio-inspired icon choreography, built from the product's icon library:
  the familiar sidebar glyph stays legible at rest, then yields to a
  directional arrow on hover/focus. No custom SVG geometry is introduced.
-->
<span class="rail-toggle-icon relative block h-[18px] w-[18px]" aria-hidden="true">
  <SidebarIcon
    size={18}
    weight="regular"
    class="rail-toggle-icon__sidebar absolute inset-0"
  />
  {#if direction === "collapse"}
    <ArrowSquareLeftIcon
      size={18}
      weight="regular"
      class="rail-toggle-icon__arrow rail-toggle-icon__arrow--collapse absolute inset-0"
    />
  {:else}
    <ArrowSquareRightIcon
      size={18}
      weight="regular"
      class="rail-toggle-icon__arrow rail-toggle-icon__arrow--expand absolute inset-0"
    />
  {/if}
</span>

<style>
  :global(.rail-toggle-icon__sidebar) {
    opacity: 1;
    transform: translateX(0) scale(1);
    transition:
      transform 200ms ease,
      opacity 120ms ease;
  }

  :global(.rail-toggle-icon__arrow) {
    opacity: 0;
    transition:
      transform 200ms ease,
      opacity 120ms ease;
  }

  :global(.rail-toggle-icon__arrow--collapse) {
    transform: translateX(6px);
  }

  :global(.rail-toggle-icon__arrow--expand) {
    transform: translateX(-6px);
  }

  :global(.group:hover .rail-toggle-icon__sidebar),
  :global(.group:focus-visible .rail-toggle-icon__sidebar) {
    opacity: 0;
    transform: translateX(var(--rail-icon-exit, -4px)) scale(0.9);
  }

  :global(.group:hover .rail-toggle-icon__arrow),
  :global(.group:focus-visible .rail-toggle-icon__arrow) {
    opacity: 1;
    transform: translateX(0);
  }

  :global(.group[data-rail-direction="expand"] .rail-toggle-icon__sidebar) {
    --rail-icon-exit: 4px;
  }

  @media (prefers-reduced-motion: reduce) {
    :global(.rail-toggle-icon__sidebar),
    :global(.rail-toggle-icon__arrow) {
      transition: none;
    }
  }
</style>
