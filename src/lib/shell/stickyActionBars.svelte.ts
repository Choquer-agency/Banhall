/**
 * Sticky action bars pinned to the bottom of the window (H1 and H2 start bar,
 * H4 Reading cancel bar, the compare bar). Floating cards that sit at the
 * bottom (NotificationToaster) read the tallest mounted bar and lift above it,
 * so a card never covers the page's primary action.
 */
import { SvelteMap } from "svelte/reactivity";

const heights = new SvelteMap<HTMLElement, number>();

/** Attachment: `<div {@attach stickyActionBar}>`. A hidden bar measures 0. */
export function stickyActionBar(element: HTMLElement) {
  const measure = () => heights.set(element, element.getBoundingClientRect().height);
  measure();
  const observer = new ResizeObserver(measure);
  observer.observe(element);
  return () => {
    observer.disconnect();
    heights.delete(element);
  };
}

/** Height in px of the tallest sticky action bar on the page, or 0. */
export function stickyActionBarHeight() {
  let tallest = 0;
  for (const height of heights.values()) tallest = Math.max(tallest, height);
  return tallest;
}
