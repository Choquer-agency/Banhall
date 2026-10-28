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

/**
 * Attachment: `<div {@attach stickyActionBar}>`. A bar measures the space from
 * its top to the window's foot when it sits at the foot, so a bar inside the
 * page frame's white card is cleared too. It measures again when it or the
 * window resizes, and on any scroll (passive, once a frame), since a sticky
 * bar reaches the foot only once its pane is scrolled or filled.
 */
export function stickyActionBar(element: HTMLElement) {
  const measure = () => heights.set(element, stickyBarLift(element.getBoundingClientRect(), window.innerHeight));
  measure();
  let frame = 0;
  const onScroll = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      measure();
    });
  };
  const observer = new ResizeObserver(measure);
  observer.observe(element);
  window.addEventListener("resize", measure);
  document.addEventListener("scroll", onScroll, { capture: true, passive: true });
  return () => {
    observer.disconnect();
    window.removeEventListener("resize", measure);
    document.removeEventListener("scroll", onScroll, { capture: true });
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
