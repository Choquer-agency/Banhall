<script lang="ts">
  import type { Snippet } from "svelte";
  import { cn } from "$lib/utils";
  import { setChatContainerContext } from "./context";

  /**
   * Scrollable message viewport with stick-to-bottom behavior (prompt-kit
   * ChatContainer shape): auto-follows new content while the user is at the
   * bottom; scrolling up stops following; returning to the bottom (or
   * ScrollButton) resumes it.
   *
   * Size the ROOT via `class` (e.g. `min-h-0 flex-1`); padding goes on
   * `viewportClass`, message spacing on `contentClass`. A `<ScrollButton />`
   * rendered anywhere inside floats against the root.
   */
  interface Props {
    /** Classes for the non-scrolling positioning root — size it here. */
    class?: string;
    /** Classes for the scrollable viewport (padding lives here). */
    viewportClass?: string;
    /** Classes for the inner content column (message spacing lives here). */
    contentClass?: string;
    /** Distance (px) from the bottom still counted as "at bottom". */
    threshold?: number;
    /** bind: to observe whether the viewport is following the latest message. */
    isAtBottom?: boolean;
    children?: Snippet;
  }

  let {
    class: className,
    viewportClass,
    contentClass,
    threshold = 40,
    isAtBottom = $bindable(true),
    children,
  }: Props = $props();

  let viewportEl: HTMLDivElement | null = $state(null);
  let contentEl: HTMLDivElement | null = $state(null);

  /** Content grew while scrolled up — powers ScrollButton's "New messages"
   * pill. Cleared the moment the viewport is back at the bottom. */
  let hasUnseen = $state(false);

  /** True while a smooth programmatic scroll is in flight, so its
   * intermediate scroll events don't read as the user scrolling away. */
  let animating = false;

  function distanceFromBottom(el: HTMLElement): number {
    return el.scrollHeight - el.scrollTop - el.clientHeight;
  }

  function handleScroll() {
    if (!viewportEl) return;
    const dist = distanceFromBottom(viewportEl);
    if (animating) {
      if (dist <= 1) animating = false;
      return; // stay pinned while the programmatic scroll lands
    }
    isAtBottom = dist <= threshold;
    if (isAtBottom) hasUnseen = false;
  }

  export function scrollToBottom(behavior: ScrollBehavior = "smooth"): void {
    if (!viewportEl) return;
    isAtBottom = true;
    hasUnseen = false;
    animating = behavior === "smooth";
    viewportEl.scrollTo({ top: viewportEl.scrollHeight, behavior });
  }

  setChatContainerContext({
    get isAtBottom() {
      return isAtBottom;
    },
    get hasUnseen() {
      return hasUnseen;
    },
    scrollToBottom,
  });

  // Stick-to-bottom: pin on mount, then follow content growth (streaming
  // tokens, proposal cards, viewport resizes) only while still at the bottom.
  // Wheel/touch listeners (added imperatively — they're follow-behavior, not
  // an interaction affordance) let a real user gesture cancel an in-flight
  // programmatic smooth scroll.
  $effect(() => {
    const vp = viewportEl;
    const ct = contentEl;
    if (!vp || !ct) return;
    vp.scrollTop = vp.scrollHeight;
    let lastContentHeight = ct.scrollHeight;
    const ro = new ResizeObserver(() => {
      const grown = ct.scrollHeight > lastContentHeight + 1;
      lastContentHeight = ct.scrollHeight;
      if (isAtBottom) {
        vp.scrollTop = vp.scrollHeight;
      } else if (grown) {
        hasUnseen = true; // new content arrived below the fold
      }
    });
    ro.observe(ct);
    ro.observe(vp);
    const cancelAnimating = () => {
      animating = false;
    };
    vp.addEventListener("wheel", cancelAnimating, { passive: true });
    vp.addEventListener("touchstart", cancelAnimating, { passive: true });
    return () => {
      ro.disconnect();
      vp.removeEventListener("wheel", cancelAnimating);
      vp.removeEventListener("touchstart", cancelAnimating);
    };
  });
</script>

<div class={cn("relative", className)}>
  <div
    bind:this={viewportEl}
    onscroll={handleScroll}
    class={cn(
      "h-full w-full overflow-y-auto overscroll-y-contain [overflow-anchor:none]",
      viewportClass
    )}
  >
    <div bind:this={contentEl} class={contentClass}>
      {@render children?.()}
    </div>
  </div>
</div>
