<script lang="ts">
  // Round 2 signed-out frame (J1-J9). Wide screens: canvas, dark logo (64px)
  // centred above one column with 28px between (J1-J4, J6). With the invite
  // banner (J5) the column centres in the space below it with 48px bottom
  // padding. Phones: the column starts 96px from the top with 20px sides and
  // a 56px logo (J8); under the banner it starts 40px down with a 52px logo
  // and 24px gaps (J9). No footer: the owner dropped it on 2026-09-28.
  import type { Snippet } from "svelte";
  import BanhallLogo from "$lib/components/ui/BanhallLogo.svelte";

  let {
    width = 360,
    banner,
    children,
  }: { width?: number; banner?: Snippet; children: Snippet } = $props();
</script>

<div data-auth-layout class="relative flex min-h-screen flex-1 flex-col bg-canvas antialiased">
  {@render banner?.()}
  <main
    class={`flex flex-1 flex-col items-center px-5 sm:justify-center sm:px-0 ${
      banner
        ? "gap-6 pb-8 pt-10 sm:gap-7 sm:pb-12 sm:pt-0"
        : "gap-7 pb-8 pt-24 sm:py-12"
    }`}
  >
    <BanhallLogo tone="dark" height={64} class={`w-auto sm:h-16 ${banner ? "h-[3.25rem]" : "h-14"}`} />
    <div data-auth-column class="flex w-full flex-col gap-5" style={`max-width:${width}px`}>
      {@render children()}
    </div>
  </main>
</div>
