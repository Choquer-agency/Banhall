/**
 * Sticky action bars pinned to the bottom of the window (H1 and H2 start bar,
 * H4 Reading cancel bar, the compare bar). Floating cards that sit at the
 * bottom (NotificationToaster) read the tallest mounted bar and lift above it,
 * so a card never covers the page's primary action.
 */
import { SvelteMap } from "svelte/reactivity";

const heights = new SvelteMap<HTMLElement, number>();

/**
 * How close to the window's foot a bar must end to count as pinned there:
 * the page frame's 8px foot and the card's 1px border from 1024px (owner,
 * 2026-10-28), with room for rounding. A bar higher up (on short content,
 * mid-pane) lifts nothing.
 */
export const STICKY_FOOT_TOLERANCE_PX = 16;

/** The space a bar takes above the window's foot, or 0 when it is hidden or not at the foot. */
export function stickyBarLift(rect: { top: number; bottom: number; height: number }, windowHeight: number): number {
  if (rect.height === 0) return 0;
  if (Math.abs(windowHeight - rect.bottom) > STICKY_FOOT_TOLERANCE_PX) return 0;
  return Math.max(rect.height, windowHeight - rect.top);
}

/** The nearest ancestor that scrolls, where a sticky bar pins itself. */
function scrollParent(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll") return node;
  }
  return null;
}

/**
 * Attachment: `<div {@attach stickyActionBar}>`. A bar measures the space from
 * its top to the window's foot when it sits at the foot, so a bar inside the
 * page frame's white card is cleared too. It measures again whenever its
 * place can change: when it or the window resizes, on any scroll, and when
 * the content around it grows or shrinks (its parent, its scroll container
 * and that container's content), so a bar pushed to the foot by content
 * that arrives later is cleared without a scroll. Every path but its own
 * resize waits for the next frame and measures once.
 */
export function stickyActionBar(element: HTMLElement) {
  const measure = () => heights.set(element, stickyBarLift(element.getBoundingClientRect(), window.innerHeight));
  measure();
  let frame = 0;
  const soon = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      measure();
    });
  };
  const observer = new ResizeObserver(measure);
  observer.observe(element);
  const around = new ResizeObserver(soon);
  const container = scrollParent(element);
  for (const node of new Set([element.parentElement, container, container?.firstElementChild ?? null])) {
    if (node instanceof Element && node !== element) around.observe(node);
  }
  window.addEventListener("resize", measure);
  document.addEventListener("scroll", soon, { capture: true, passive: true });
  return () => {
    observer.disconnect();
    around.disconnect();
    window.removeEventListener("resize", measure);
    document.removeEventListener("scroll", soon, { capture: true });
    if (frame) cancelAnimationFrame(frame);
    heights.delete(element);
  };
}

/** Space in px the tallest sticky action bar takes above the window's foot, or 0. */
export function stickyActionBarHeight() {
  let tallest = 0;
  for (const height of heights.values()) tallest = Math.max(tallest, height);
  return tallest;
}
