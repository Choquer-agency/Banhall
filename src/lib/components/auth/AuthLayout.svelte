<script lang="ts">
  // Round 2 signed-out frame (J1-J9): full-page canvas, dark logo centred
  // above one column, footer 32px from the bottom. Phones get a full-width
  // column with 24px padding and only the invite line in the footer (J8).
  import type { Snippet } from "svelte";
  import BanhallLogo from "$lib/components/ui/BanhallLogo.svelte";

  let {
    width = 360,
    banner,
    children,
  }: { width?: number; banner?: Snippet; children: Snippet } = $props();
</script>

<div data-auth-layout class="flex min-h-screen flex-1 flex-col bg-canvas antialiased">
  {@render banner?.()}
  <main class="flex flex-1 flex-col items-center justify-center gap-7 px-6 py-12 sm:px-0">
    <BanhallLogo tone="dark" height={64} />
    <div data-auth-column class="flex w-full flex-col gap-5" style={`max-width:${width}px`}>
      {@render children()}
    </div>
  </main>
  <footer class="flex justify-center gap-6 px-6 pb-8 text-xs leading-4 text-ink-faint">
    <span class="hidden sm:inline">Banhall Consulting Ltd.</span>
    <span>Need access? Ask your team for an invite.</span>
  </footer>
</div>
