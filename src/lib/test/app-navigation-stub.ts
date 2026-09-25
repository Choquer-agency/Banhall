/**
 * Component-test stub for `$app/navigation`, faithful to Kit's runtime
 * behavior where it matters for regressions:
 *
 * - `goto` updates the reactive `page.url` (asynchronously, like a real
 *   client-side navigation).
 * - `replaceState`/`pushState` (shallow routing) do NOT update `page.url` —
 *   Kit only touches `history` and `page.state` (client.js `clone_page()`),
 *   which is exactly the staleness that caused the 2026-08-06 Board/List
 *   toggle QA failure. Keeping the stub faithful means reintroducing a
 *   shallow-routing layout switch fails the component suite.
 */
import { onDestroy, untrack } from "svelte";
import { __setPageUrl, page } from "./app-state-stub.svelte";

export type NavigationCall = {
  kind: "goto" | "replaceState" | "pushState";
  url: string;
  /** A `beforeNavigate` callback cancelled it, so `page.url` stayed put. */
  cancelled?: boolean;
};

export const __navigationCalls: NavigationCall[] = [];

type BeforeNavigateCallback = (navigation: {
  from: { url: URL } | null;
  to: { url: URL } | null;
  type: "goto" | "leave";
  willUnload: boolean;
  cancel: () => void;
}) => void;

const beforeNavigateCallbacks = new Set<BeforeNavigateCallback>();

let gotoUpdatesPageUrl = true;

/** Worst-case harness switch: simulate `page.url` never catching up. */
export function __setGotoUpdatesPageUrl(value: boolean) {
  gotoUpdatesPageUrl = value;
}

export function __resetNavigation() {
  __navigationCalls.length = 0;
  gotoUpdatesPageUrl = true;
  beforeNavigateCallbacks.clear();
}

export async function goto(url: string | URL, _opts?: Record<string, unknown>) {
  // Like Kit, every mounted `beforeNavigate` callback may cancel it first.
  // Untracked: a caller's `$effect` often calls goto, and Kit never makes that
  // effect depend on `page.url` or on what the callbacks read. Tracking them
  // here re-ran the login page's redirect effect on every page.url update, an
  // endless loop that hung the browser suite.
  const cancelled = untrack(() => {
    let cancel = false;
    const navigation = {
      from: { url: page.url },
      to: { url: new URL(String(url), page.url) },
      type: "goto" as const,
      willUnload: false,
      cancel: () => {
        cancel = true;
      },
    };
    for (const callback of [...beforeNavigateCallbacks]) callback(navigation);
    return cancel;
  });
  __navigationCalls.push({ kind: "goto", url: String(url), ...(cancelled ? { cancelled } : {}) });
  if (cancelled) return;
  // Real goto resolves the navigation (and page.url) asynchronously.
  await Promise.resolve();
  if (gotoUpdatesPageUrl) __setPageUrl(String(url));
}

/**
 * Closing the tab, reloading or typing a URL: Kit runs every callback with
 * type "leave". A cancel there makes the browser ask the person to confirm.
 * Returns whether a callback cancelled.
 */
export function __simulateLeave(): boolean {
  return untrack(() => {
    let cancelled = false;
    const navigation = {
      from: { url: page.url },
      to: null,
      type: "leave" as const,
      willUnload: true,
      cancel: () => {
        cancelled = true;
      },
    };
    for (const callback of [...beforeNavigateCallbacks]) callback(navigation);
    return cancelled;
  });
}

export function replaceState(url: string | URL, _state?: unknown) {
  __navigationCalls.push({ kind: "replaceState", url: String(url) });
}

export function pushState(url: string | URL, _state?: unknown) {
  __navigationCalls.push({ kind: "pushState", url: String(url) });
}

/** Registered for the calling component's lifetime, as in Kit. */
export function beforeNavigate(callback: BeforeNavigateCallback) {
  beforeNavigateCallbacks.add(callback);
  try {
    onDestroy(() => beforeNavigateCallbacks.delete(callback));
  } catch {
    // Called outside component setup: kept until the next reset.
  }
}
export function afterNavigate(_callback: (navigation: unknown) => void) {}
export function onNavigate(_callback: (navigation: unknown) => void) {}
export async function invalidate(_resource: unknown) {}
export async function invalidateAll() {}
export async function preloadData(_href: string) {
  return { type: "loaded", status: 200, data: {} };
}
export async function preloadCode(_pathname: string) {}
export function disableScrollHandling() {}
