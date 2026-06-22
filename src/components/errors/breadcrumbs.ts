// A tiny in-memory ring buffer of the last things the user did, captured app-wide
// so an error report (auto or manual) can include "what happened just before".
// Module-level singleton: imported anywhere, shared across the whole client.

export type BreadcrumbType = "nav" | "click" | "console" | "network" | "error";

export type Breadcrumb = {
  type: BreadcrumbType;
  label: string;
  detail?: string;
  at: number;
};

const MAX = 20;
let buffer: Breadcrumb[] = [];

export function pushBreadcrumb(
  b: { type: BreadcrumbType; label: string; detail?: string }
): void {
  const entry: Breadcrumb = {
    type: b.type,
    label: b.label.slice(0, 200),
    detail: b.detail ? b.detail.slice(0, 500) : undefined,
    at: Date.now(),
  };
  // Skip exact-duplicate consecutive crumbs (e.g. repeated console noise).
  const last = buffer[buffer.length - 1];
  if (last && last.type === entry.type && last.label === entry.label) return;
  buffer.push(entry);
  if (buffer.length > MAX) buffer = buffer.slice(-MAX);
}

/** Return a copy of the breadcrumbs (optionally just the last `n`). */
export function getBreadcrumbs(n?: number): Breadcrumb[] {
  return n ? buffer.slice(-n) : [...buffer];
}
