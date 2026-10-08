<script lang="ts">
  import AuroraMark from "$lib/components/ui/AuroraMark.svelte";

  /**
   * The Assistant while it loads (2026-10-06). One shape from the click until
   * the conversation is ready, drawn in the real panel's frame so nothing
   * moves when it resolves: the header with the Aurora mark and "Assistant",
   * quiet message bars, and the composer well pinned to the bottom. No
   * spinner and no visible "Loading" text (design system, round 2 loading
   * rule); screen readers get one status.
   *
   * "panel" is the whole frame, shown while the Assistant's code loads.
   * "body" is the message area alone, shown inside the loaded panel (whose
   * real header and composer are already there) until its first data lands.
   *
   * The bars wait 400ms before fading in, so a fast load swaps in the real
   * panel during the 350ms slide without a flash.
   */
  let {
    part = "panel",
    isFull = false,
  }: {
    part?: "panel" | "body";
    isFull?: boolean;
  } = $props();

  const bar = "block rounded bg-chrome";
</script>

{#snippet bars()}
  <div class="assistant-skeleton-bars flex min-h-0 flex-1 flex-col gap-3 py-4" data-assistant-skeleton-bars>
    <div class="flex animate-pulse flex-col gap-3 motion-reduce:animate-none">
      <span class={`${bar} ml-auto h-9 w-2/5 rounded-xl`}></span>
      <span class={`${bar} h-3 w-[92%]`}></span>
      <span class={`${bar} h-3 w-[76%]`}></span>
      <span class={`${bar} h-3 w-[60%]`}></span>
    </div>
  </div>
{/snippet}

{#if part === "body"}
  <div
    role="status"
    aria-label="Loading assistant"
    data-assistant-skeleton="body"
    class={`flex min-h-0 flex-1 flex-col ${isFull ? "px-6 lg:px-0" : "px-6"}`}
  >
    {@render bars()}
  </div>
{:else}
  <div
    role="status"
    aria-label="Loading assistant"
    data-assistant-skeleton="panel"
    class="flex h-full min-h-0 flex-1 flex-col bg-white"
  >
    <!-- The real header's box: Aurora mark, the word, and the expand slot. -->
    <div class={`box-content flex h-7 shrink-0 items-center gap-2.5 pt-5 pb-2 ${isFull ? "px-6 lg:px-0" : "pl-6 pr-6"}`} aria-hidden="true">
      <AuroraMark size={20} />
      <span class="-ml-1.5 px-1.5 text-[0.8125rem] leading-[1.125rem] font-medium text-ink">Assistant</span>
      <span class="ml-auto size-[1.625rem] shrink-0"></span>
    </div>
    <div class={`flex min-h-0 flex-1 flex-col ${isFull ? "px-6 lg:px-0" : "px-6"}`}>
      {@render bars()}
    </div>
    <!-- The composer well, inert: nobody types into a box that is not there. -->
    <div class={`shrink-0 pt-2 pb-6 ${isFull ? "px-6 lg:px-0" : "px-6"}`} aria-hidden="true">
      <div class="field-control-shell pointer-events-none h-[4.875rem] rounded-xl"></div>
    </div>
  </div>
{/if}

<style>
  .assistant-skeleton-bars {
    animation: assistant-skeleton-in var(--duration-layout) var(--ease-layout) 400ms both;
  }
  @keyframes assistant-skeleton-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  @media (prefers-reduced-motion: reduce) {
    .assistant-skeleton-bars {
      animation: none;
    }
  }
</style>
