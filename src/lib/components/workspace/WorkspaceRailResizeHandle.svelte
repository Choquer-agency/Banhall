<script lang="ts">
  // Pointer + keyboard resize separator on the workspace rail's right edge
  // (2026-08-08 amendment — Obvious/Databricks rail ergonomics). 8px hit
  // target over a visible 1px edge; drag uses pointer capture and reports
  // live widths through `onResize` so the host can write the CSS custom
  // property directly (no Svelte re-render per pointermove); `onCommit`
  // fires once on release/keys for clamped persistence. Keyboard follows the
  // WAI-ARIA window-splitter pattern: arrows ±8 (Shift ±32), Home = min,
  // End = max, with truthful aria-value* on the separator role.
  import {
    RAIL_MAX_WIDTH,
    RAIL_MIN_WIDTH,
    clampRailWidth,
    railWidthForKey,
  } from "$lib/workspace/railPreferences";

  let {
    width,
    onResize,
    onCommit,
  }: {
    /** Current committed rail width (aria truth + keyboard base). */
    width: number;
    /** Live resize during drag — host applies it without state churn. */
    onResize: (width: number) => void;
    /** Final clamped width to persist (pointer release or keyboard step). */
    onCommit: (width: number) => void;
  } = $props();

  let dragging = $state(false);
  let startX = 0;
  let startWidth = 0;
  let liveWidth = 0;
  let activePointerId: number | null = null;

  function handlePointerDown(event: PointerEvent & { currentTarget: HTMLElement }) {
    if (dragging || (event.button !== 0 && event.pointerType === "mouse")) return;
    dragging = true;
    activePointerId = event.pointerId;
    startX = event.clientX;
    startWidth = width;
    liveWidth = width;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic/inactive pointers (tests) cannot be captured — move/up
      // still dispatch to the handle, so the drag works without capture.
    }
    event.preventDefault();
  }

  function handlePointerMove(event: PointerEvent) {
    if (!dragging || event.pointerId !== activePointerId) return;
    liveWidth = clampRailWidth(startWidth + (event.clientX - startX));
    onResize(liveWidth);
  }

  function endDrag(event: PointerEvent & { currentTarget: HTMLElement }) {
    if (!dragging || event.pointerId !== activePointerId) return;
    dragging = false;
    activePointerId = null;
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      // Capture was never established (see pointerdown) — nothing to release.
    }
    onCommit(liveWidth);
  }

  function handleKeydown(event: KeyboardEvent) {
    const next = railWidthForKey(event.key, width, event.shiftKey);
    if (next === null) return;
    event.preventDefault();
    onCommit(next);
  }
</script>

<!-- Obvious-style invisible 8px hit target straddling the rail edge. The
     aside's structural hairline remains visible; the drag line appears only
     on hover, focus, or active resize. -->
<!-- WAI-ARIA window-splitter: a FOCUSABLE `role="separator"` with
     aria-valuenow/min/max IS interactive per the APG (svelte's a11y lint
     doesn't model the focusable-separator variant). -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  role="separator"
  tabindex="0"
  aria-orientation="vertical"
  aria-label="Resize navigation rail"
  aria-valuemin={RAIL_MIN_WIDTH}
  aria-valuemax={RAIL_MAX_WIDTH}
  aria-valuenow={width}
  data-rail-resize-handle
  data-dragging={dragging ? "" : undefined}
  onpointerdown={handlePointerDown}
  onpointermove={handlePointerMove}
  onpointerup={endDrag}
  onpointercancel={endDrag}
  onkeydown={handleKeydown}
  class="group absolute inset-y-0 right-0 z-10 w-2 translate-x-1/2 cursor-col-resize touch-none select-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary-light"
>
  <span
    aria-hidden="true"
    class={`absolute inset-y-0 left-1/2 w-px -translate-x-1/2 transition-colors motion-reduce:transition-none ${dragging ? "bg-primary" : "bg-transparent group-hover:bg-primary/40 group-focus-visible:bg-primary"}`}
  ></span>
</div>
