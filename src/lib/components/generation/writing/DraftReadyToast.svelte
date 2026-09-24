<!--
  Draft ready (ui-design-final.md section 7, board 4.4): the writing pill
  becomes a toast with the full Aurora border. The border drains right to left
  over `durationMs`, pauses while hovered or focused, then the toast fades and
  calls `onClose`. Position-agnostic: the host places it.
-->
<script lang="ts">
  import { onDestroy } from "svelte";
  import AuroraMark from "$lib/components/ui/AuroraMark.svelte";
  import { motionDuration } from "$lib/motion";

  let {
    qaRunning = true,
    durationMs = 5000,
    onClose,
  }: {
    /** Shows "QA is checking it" with a small spinner while QA runs. */
    qaRunning?: boolean;
    durationMs?: number;
    onClose: () => void;
  } = $props();

  const FADE_MS = 300;

  let hovered = $state(false);
  let focused = $state(false);
  let fading = $state(false);
  let closed = false;
  let fadeTimer: ReturnType<typeof setTimeout> | undefined;
  // Time left on the drain; carried across pauses. Not state: bookkeeping only.
  // svelte-ignore state_referenced_locally
  let remaining = durationMs;

  const paused = $derived(hovered || focused);

  function close() {
    if (closed) return;
    closed = true;
    clearTimeout(fadeTimer);
    onClose();
  }

  function beginFade() {
    fading = true;
    fadeTimer = setTimeout(close, motionDuration(FADE_MS));
  }

  $effect(() => {
    if (fading || paused) return;
    const startedAt = Date.now();
    const timer = setTimeout(beginFade, Math.max(0, remaining));
    return () => {
      clearTimeout(timer);
      remaining = Math.max(0, remaining - (Date.now() - startedAt));
    };
  });

  onDestroy(() => clearTimeout(fadeTimer));

  function onFocusOut(event: FocusEvent) {
    const next = event.relatedTarget as Node | null;
    if (!next || !(event.currentTarget as HTMLElement).contains(next)) focused = false;
  }
</script>

<div
  role="status"
  aria-live="polite"
  data-draft-ready-toast
  data-paused={paused ? "true" : "false"}
  data-fading={fading ? "true" : "false"}
  onpointerenter={() => (hovered = true)}
  onpointerleave={() => (hovered = false)}
  onfocusin={() => (focused = true)}
  onfocusout={onFocusOut}
  class={`relative w-max max-w-full overflow-hidden rounded-full p-[2px] transition-opacity duration-300 ease-out motion-reduce:transition-none ${
    fading ? "opacity-0" : "opacity-100"
  }`}
  style="background:var(--aurora-track);box-shadow:0 8px 24px #16211F14, 0 0 14px #8438FF24"
>
  <span
    aria-hidden="true"
    data-toast-drain
    class={`toast-drain absolute inset-0 ${paused ? "is-paused" : ""}`}
    style={`background:var(--aurora-linear);animation-duration:${durationMs}ms`}
  ></span>
  <div class="relative flex h-10 items-center gap-2.5 rounded-full bg-surface pl-2.5 pr-1.5">
    <AuroraMark size={22} glyph="check" />
    <span class="text-sm font-medium leading-[18px] text-ink">Your draft is ready</span>
    {#if qaRunning}
      <span class="flex items-center gap-1.5" data-toast-qa-running>
        <AuroraMark size={12} glyph="spinner" />
        <span class="text-[13px] leading-[18px] text-ink-muted">QA is checking it</span>
      </span>
    {/if}
    <button
      type="button"
      aria-label="Close"
      data-toast-close
      onclick={close}
      class="flex size-7 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-primary-wash hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary motion-reduce:transition-none"
    >
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
        <path d="M18 6 6 18M6 6l12 12" />
      </svg>
    </button>
  </div>
</div>
