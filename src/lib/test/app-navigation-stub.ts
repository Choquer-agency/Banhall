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
import { __setPageUrl } from "./app-state-stub.svelte";

export type NavigationCall = {
  kind: "goto" | "replaceState" | "pushState";
  url: string;
};

export const __navigationCalls: NavigationCall[] = [];

let gotoUpdatesPageUrl = true;

/** Worst-case harness switch: simulate `page.url` never catching up. */
export function __setGotoUpdatesPageUrl(value: boolean) {
  gotoUpdatesPageUrl = value;
}

export function __resetNavigation() {
  __navigationCalls.length = 0;
  gotoUpdatesPageUrl = true;
}

export async function goto(url: string | URL, _opts?: Record<string, unknown>) {
  __navigationCalls.push({ kind: "goto", url: String(url) });
  // Real goto resolves the navigation (and page.url) asynchronously.
  await Promise.resolve();
  if (gotoUpdatesPageUrl) __setPageUrl(String(url));
}

export function replaceState(url: string | URL, _state?: unknown) {
  __navigationCalls.push({ kind: "replaceState", url: String(url) });
}

export function pushState(url: string | URL, _state?: unknown) {
  __navigationCalls.push({ kind: "pushState", url: String(url) });
}

export function beforeNavigate(_callback: (navigation: unknown) => void) {}
export function afterNavigate(_callback: (navigation: unknown) => void) {}
export function onNavigate(_callback: (navigation: unknown) => void) {}
export async function invalidate(_resource: unknown) {}
export async function invalidateAll() {}
export async function preloadData(_href: string) {
  return { type: "loaded", status: 200, data: {} };
}
export async function preloadCode(_pathname: string) {}
export function disableScrollHandling() {}
