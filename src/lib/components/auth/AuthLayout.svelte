<script lang="ts">
  // Round 2 signed-out frame (J1-J9). Wide screens: canvas, dark logo (64px)
  // centred above one column with 28px between, and the footer pinned 32px
  // from the bottom (J1-J4). With the invite banner (J5) the column centres
  // in the space below it with 48px bottom padding and there is no footer;
  // J6 has no footer either. Phones: the column starts 96px from the top
  // with 20px sides, a 56px logo and only the invite line in the footer
  // (J8); under the banner it starts 40px down with a 52px logo and 24px
  // gaps (J9).
  import type { Snippet } from "svelte";
  import BanhallLogo from "$lib/components/ui/BanhallLogo.svelte";

  let {
    width = 360,
    footer = true,
    banner,
    children,
  }: { width?: number; footer?: boolean; banner?: Snippet; children: Snippet } = $props();
</script>

<div data-auth-layout class="relative flex min-h-screen flex-1 flex-col bg-canvas antialiased">
  {@render banner?.()}
  <main
    class={`flex flex-1 flex-col items-center px-5 sm:justify-center sm:px-0 ${
      banner
        ? "gap-6 pb-8 pt-10 sm:gap-7 sm:pb-12 sm:pt-0"
        : `gap-7 pt-24 sm:py-12 ${footer ? "pb-7" : "pb-8"}`
    }`}
  >
    <BanhallLogo tone="dark" height={64} class={`w-auto sm:h-16 ${banner ? "h-[52px]" : "h-14"}`} />
    <div data-auth-column class="flex w-full flex-col gap-5" style={`max-width:${width}px`}>
      {@render children()}
    </div>
  </main>
  {#if footer && !banner}
    <footer
      data-auth-footer
      class="flex justify-center gap-6 pb-8 text-xs leading-4 text-ink-faint sm:absolute sm:inset-x-0 sm:bottom-8 sm:pb-0"
    >
      <span class="hidden sm:inline">Banhall Consulting Ltd.</span>
      <span>Need access? Ask your team for an invite.</span>
    </footer>
  {/if}
</div>
