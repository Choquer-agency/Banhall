/**
 * The project page's two experiences, each loaded once per page session.
 * New project starts loading the page it opens next while the writer fills
 * it in: in the 2026-09-26 live test a prepared start opened its project
 * with the seed stage already open, and the page showed only "Loading report
 * workspace..." for 10 s while its own code loaded. A load that fails is
 * forgotten, so the route asks again.
 */
type PageModule = { default: unknown };

/** One load shared by every caller; a failed one is forgotten. */
export function loadOnce<T extends PageModule>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null;
  return () => {
    pending ??= load().catch((error: unknown) => {
      pending = null;
      throw error;
    });
    return pending;
  };
}

export const loadPreviewProjectPage = loadOnce(() => import("./PreviewProjectPage.svelte"));
export const loadCurrentProjectPage = loadOnce(() => import("./CurrentProjectPage.svelte"));

/**
 * Loads the project page in the background once the browser is idle (within
 * two seconds), so opening a project after a start never waits on it.
 * Returns a cancel for a page that goes away first.
 */
export function preloadProjectPage(load: () => Promise<unknown> = loadPreviewProjectPage): () => void {
  if (typeof window === "undefined") return () => undefined;
  const run = () => void load().catch(() => undefined);
  if (typeof window.requestIdleCallback === "function") {
    const handle = window.requestIdleCallback(run, { timeout: 2000 });
    return () => window.cancelIdleCallback(handle);
  }
  const handle = window.setTimeout(run, 200);
  return () => window.clearTimeout(handle);
}
