<script lang="ts">
  import { boardRem } from "$lib/rootScale";
  // Signed-out frame (owner, 2026-11-26): top-left dark logo (36px on
  // desktop, 32px on phones) in a calm 100% root scale so large monitors stay
  // proportional; the form column centres below it (with an optional full-width
  // invite banner above the header). No footer.
  import type { Snippet } from "svelte";
  import BanhallLogo from "$lib/components/ui/BanhallLogo.svelte";

  let {
    width = 340,
    banner,
    children,
  }: { width?: number; banner?: Snippet; children: Snippet } = $props();
</script>

<div data-auth-layout class="relative flex min-h-screen flex-1 flex-col bg-canvas antialiased">
  {@render banner?.()}
  <header data-auth-header class="flex shrink-0 items-center px-5 pt-5 sm:px-7 sm:pt-6">
    <BanhallLogo tone="dark" height={36} class="h-8 w-auto sm:h-9" />
  </header>
  <main
    class={`flex flex-1 flex-col items-center px-5 sm:justify-center sm:px-0 ${
      banner
        ? "pb-10 pt-8 sm:pb-16 sm:pt-0"
        : "pb-10 pt-14 sm:pb-16 sm:pt-0"
    }`}
  >
    <div data-auth-column class="flex w-full flex-col gap-4" style={`max-width:${boardRem(width)}`}>
      {@render children()}
    </div>
  </main>
</div>
