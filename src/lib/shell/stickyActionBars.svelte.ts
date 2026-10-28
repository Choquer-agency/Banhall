/**
 * Sticky action bars pinned to the bottom of the window (H1 and H2 start bar,
 * H4 Reading cancel bar, the compare bar). Floating cards that sit at the
 * bottom (NotificationToaster) read the tallest mounted bar and lift above it,
 * so a card never covers the page's primary action.
 */
import { SvelteMap } from "svelte/reactivity";

const heights = new SvelteMap<HTMLElement, number>();

/**
 * Attachment: `<div {@attach stickyActionBar}>`. A bar measures the space from
 * its top to the window's foot, so a bar inside the page frame's white card
 * (8px above the foot from 1024px, owner 2026-10-28) is cleared too. A hidden
 * bar measures 0.
 */
export function stickyActionBar(element: HTMLElement) {
  const measure = () => {
    const rect = element.getBoundingClientRect();
    heights.set(element, rect.height === 0 ? 0 : Math.max(rect.height, window.innerHeight - rect.top));
  };
  measure();
  const observer = new ResizeObserver(measure);
  observer.observe(element);
  window.addEventListener("resize", measure);
  return () => {
    observer.disconnect();
    window.removeEventListener("resize", measure);
    heights.delete(element);
  };
}

/** Space in px the tallest sticky action bar takes above the window's foot, or 0. */
export function stickyActionBarHeight() {
  let tallest = 0;
  for (const height of heights.values()) tallest = Math.max(tallest, height);
  return tallest;
}
