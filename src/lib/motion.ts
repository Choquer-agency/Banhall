import { quartOut } from "svelte/easing";
import { fade } from "svelte/transition";
import type { TransitionConfig } from "svelte/transition";

/**
 * Shared overlay motion. Every modal/dialog/popup animates through these so
 * the whole app opens and closes with one voice, and reduced-motion users get
 * instant transitions everywhere at once.
 */

export function reducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** Duration that collapses to 0 under prefers-reduced-motion. */
export function motionDuration(ms: number): number {
  return reducedMotion() ? 0 : ms;
}

/** Backdrop fade for modal overlays. */
export function overlayFade(
  node: Element,
  { duration = 150 }: { duration?: number } = {}
): TransitionConfig {
  return fade(node, { duration: motionDuration(duration) });
}

/** Dialog surface: rises and settles on the way in, sinks away on the way out. */
export function modalPop(
  node: Element,
  { duration = 220 }: { duration?: number } = {}
): TransitionConfig {
  return {
    duration: motionDuration(duration),
    easing: quartOut,
    css: (t, u) =>
      `opacity: ${t}; transform: scale(${0.96 + 0.04 * t}) translateY(${8 * u}px);`,
  };
}

/** Anchored popovers/dropdowns: quick scale from their origin. */
export function popoverPop(
  node: Element,
  { duration = 140 }: { duration?: number } = {}
): TransitionConfig {
  return {
    duration: motionDuration(duration),
    easing: quartOut,
    css: (t, u) =>
      `opacity: ${t}; transform: scale(${0.97 + 0.03 * t}) translateY(${-3 * u}px);`,
  };
}
