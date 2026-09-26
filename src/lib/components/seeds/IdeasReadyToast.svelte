<script lang="ts">
  /**
   * Board F4: when the ideas of the step on screen are ready, an in-pane
   * toast at the bottom right: the AI mark, "{n} ideas are ready" and what
   * to do next. It leaves after 5 seconds (paused while hovered or
   * focused); under reduced motion it appears and leaves without animation.
   * The dark surface is fir until the shell's toast surface token lands.
   */
  import { onDestroy, untrack } from "svelte";
  import { fly } from "svelte/transition";
  import { XIcon } from "phosphor-svelte";
  import AuroraMark from "$lib/components/ui/AuroraMark.svelte";

  let {
    count,
    onClose,
    durationMs = 5_000,
  }: {
    count: number;
    onClose: () => void;
    durationMs?: number;
  } = $props();

  const reducedMotion =
    typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  // The toast's life is fixed when it appears.
  let remaining = untrack(() => durationMs);
  let startedAt = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  function start() {
    startedAt = Date.now();
    timer = setTimeout(onClose, remaining);
  }
  function pause() {
    if (!timer) return;
    clearTimeout(timer);
    timer = undefined;
    remaining = Math.max(0, remaining - (Date.now() - startedAt));
  }
  start();
  onDestroy(() => clearTimeout(timer));
</script>

<div
  role="status"
  data-ideas-ready-toast
  onmouseenter={pause}
  onmouseleave={start}
  onfocusin={pause}
  onfocusout={start}
  transition:fly={{ y: reducedMotion ? 0 : 8, duration: reducedMotion ? 0 : 200 }}
  class="flex w-[320px] max-w-[calc(100vw-2rem)] items-start gap-3 rounded-xl bg-fir py-3 pr-2 pl-3.5 shadow-popover"
>
  <AuroraMark size={20} />
  <div class="flex min-w-0 flex-1 flex-col gap-0.5">
    <p class="text-[13px] leading-[18px] font-medium text-white">{count} {count === 1 ? "idea is" : "ideas are"} ready</p>
    <p class="text-xs leading-4 text-white/75">Pick what fits, then approve to move on.</p>
  </div>
  <button
    type="button"
    aria-label="Dismiss"
    onclick={onClose}
    class="flex size-7 shrink-0 items-center justify-center rounded-md text-white/75 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-white pointer-coarse:size-11"
  >
    <XIcon size={14} aria-hidden="true" />
  </button>
</div>
