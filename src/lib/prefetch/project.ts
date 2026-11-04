import { resolve } from "$app/paths";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { loadPreviewProjectPage } from "$lib/components/project/projectPageModules";
import { prefetchQuery } from "$lib/convex/queryKeepAlive";

/** The one entry point for project navigation prefetches. On link intent it
 * also subscribes the project page's first queries, with the same arguments
 * the page uses, so the held results are ready when the page mounts. The idle
 * pass only warms the page code. */
export async function prefetchProject(projectId?: string): Promise<void> {
  if (projectId) {
    const args = { projectId: projectId as Id<"projects"> };
    prefetchQuery(api.projects.getProject, args);
    prefetchQuery(api.reports.getLatestReport, args);
    prefetchQuery(api.generations.getLatestGeneration, args);
    prefetchQuery(api.projects.getProjectEditAccess, args);
  }
  await loadPreviewProjectPage();
}

function projectIdFromLink(anchor: HTMLAnchorElement): string | null {
  if (anchor.target && anchor.target !== "_self") return null;
  const url = new URL(anchor.href, window.location.href);
  if (url.origin !== window.location.origin) return null;
  const projectRoot = resolve("/project");
  if (!url.pathname.startsWith(`${projectRoot}/`)) return null;
  const rest = url.pathname.slice(projectRoot.length + 1).replace(/\/$/, "");
  if (!rest || rest.includes("/") || rest === "new" || rest === "questionnaire") return null;
  try {
    return decodeURIComponent(rest);
  } catch {
    return null;
  }
}

/** Installed once by the signed-in layout. One listener covers project links
 * in cards, company lists and any rail that renders them. */
export function startProjectPrefetch(root: Document | HTMLElement = document): () => void {
  const warm = () => void prefetchProject().catch(() => undefined);
  let cancelIdle: () => void;
  if (typeof window.requestIdleCallback === "function") {
    const handle = window.requestIdleCallback(warm, { timeout: 2000 });
    cancelIdle = () => window.cancelIdleCallback(handle);
  } else {
    const handle = window.setTimeout(warm, 200);
    cancelIdle = () => window.clearTimeout(handle);
  }

  const onIntent = (event: Event) => {
    if (!(event.target instanceof Element)) return;
    const anchor = event.target.closest("a[href]");
    if (!(anchor instanceof HTMLAnchorElement)) return;
    const id = projectIdFromLink(anchor);
    if (id) void prefetchProject(id).catch(() => undefined);
  };
  const events = ["pointerover", "focusin", "touchstart"] as const;
  for (const event of events) root.addEventListener(event, onIntent, { capture: true, passive: true });
  return () => {
    cancelIdle();
    for (const event of events) root.removeEventListener(event, onIntent, { capture: true });
  };
}
