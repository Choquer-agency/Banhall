<script lang="ts">
  /**
   * Where a round 2 dialog sits. The boards place dialogs at a fixed distance
   * from the window's top edge rather than centring them (C3 150px, C5 320px,
   * D2 170px, F1 and G1 to G3 140px). When the window is too short for that,
   * the two spacers shrink evenly and the dialog is centred instead. Below
   * 640px the dialog is a bottom sheet. Without `top` it is always centred.
   * The dialog itself must not shrink (`shrink-0`).
   */
  import type { Snippet } from "svelte";

  let {
    top = undefined,
    class: className = "",
    children,
  }: {
    /** The board's distance from the window's top edge to the dialog, in px. */
    top?: number;
    class?: string;
    children: Snippet;
  } = $props();

  const basis = $derived(top === undefined ? "0px" : `${top}px`);
</script>

<div
  data-board-dialog-layer
  class={`pointer-events-none fixed inset-0 flex flex-col items-center justify-end sm:justify-start sm:px-4 ${className}`}
>
  <div aria-hidden="true" data-dialog-spacer="top" class="hidden sm:block" style:flex={`${top === undefined ? 1 : 0} 1 ${basis}`}></div>
  {@render children()}
  <div aria-hidden="true" data-dialog-spacer="bottom" class="hidden sm:block" style:flex={`1 1 ${basis}`}></div>
</div>
