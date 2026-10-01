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

/** True for a same-origin link to a project page (not New project or the questionnaire). */
export function isProjectPageLink(anchor: HTMLAnchorElement, origin = window.location.origin): boolean {
  if (anchor.target && anchor.target !== "_self") return false;
  let url: URL;
  try {
    url = new URL(anchor.href, origin);
  } catch {
    return false;
  }
  return url.origin === origin && /^\/project\/(?!new\/?$|questionnaire\/?$)[^/]+\/?$/.test(url.pathname);
}

/**
 * Starts loading the project page as soon as a pointer rests on, a finger
 * touches, or the keyboard focuses a link to a project, so the click opens
 * a page whose code is already there. One listener on the root covers
 * every table row, card and recent link. Returns the removal.
 */
export function preloadOnProjectLinkIntent(
  root: Document | HTMLElement = document,
  load: () => Promise<unknown> = loadPreviewProjectPage
): () => void {
  let started = false;
  const onIntent = (event: Event) => {
    if (started || !(event.target instanceof Element)) return;
    const anchor = event.target.closest("a[href]");
    if (!(anchor instanceof HTMLAnchorElement) || !isProjectPageLink(anchor)) return;
    started = true;
    void load().catch(() => {
      started = false;
    });
  };
  const events = ["pointerover", "focusin", "touchstart"] as const;
  for (const type of events) root.addEventListener(type, onIntent, { capture: true, passive: true });
  return () => {
    for (const type of events) root.removeEventListener(type, onIntent, { capture: true });
  };
}
