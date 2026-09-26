<script lang="ts">
  /**
   * Board F4: when the ideas of the step on screen are ready, an in-pane
   * toast at the bottom right: the AI mark, "{n} ideas are ready" and what
   * to do next. It leaves after 5 seconds (paused while hovered or
   * focused); under reduced motion it appears and leaves without animation.
   * It uses the shell's one dark toast surface (`toast` tokens, D5). The
   * board has no close button; the dismiss stays so a keyboard user can
   * clear a timed toast.
   */
  import { onDestroy, untrack } from "svelte";
  import { fly } from "svelte/transition";
  import { IconClose } from "$lib/components/icons";
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
  class="flex w-[296px] max-w-[calc(100vw-2rem)] items-start gap-2.5 rounded-[10px] bg-toast py-2.5 pr-1.5 pl-3 shadow-toast-dark"
>
  <AuroraMark size={18} class="mt-px" />
  <div class="flex min-w-0 flex-1 flex-col gap-0.5">
    <p class="text-xs leading-[17px] font-medium text-toast-ink">{count} {count === 1 ? "idea is" : "ideas are"} ready</p>
    <p class="text-[11px] leading-[15px] text-toast-muted">Pick what fits, then approve to move on.</p>
  </div>
  <button
    type="button"
    aria-label="Dismiss"
    onclick={onClose}
    class="-my-1 flex size-6 shrink-0 items-center justify-center rounded-md text-toast-muted transition-colors hover:bg-white/10 hover:text-toast-ink focus-visible:outline-2 focus-visible:outline-white pointer-coarse:size-11"
  >
    <IconClose size={12} strokeWidth={1.8} />
  </button>
</div>
