import { resolve } from "$app/paths";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { loadPreviewProjectPage } from "$lib/components/project/projectPageModules";
import { prefetchQuery } from "$lib/convex/queryKeepAlive";

const HOVER_PREFETCH_DELAY_MS = 150;

/** The one entry point for project navigation prefetches. On link intent it
 * warms lightweight project metadata (not heavy report or generation bodies)
 * so the held results are ready when the page mounts. The idle pass only warms
 * the page code. */
export async function prefetchProject(projectId?: string): Promise<void> {
  if (projectId) {
    const args = { projectId: projectId as Id<"projects"> };
    prefetchQuery(api.projects.getProject, args);
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

  let hoverTimer: number | undefined;
  let hoveredAnchor: HTMLAnchorElement | null = null;
  const cancelHover = () => {
    if (hoverTimer !== undefined) {
      window.clearTimeout(hoverTimer);
      hoverTimer = undefined;
    }
    hoveredAnchor = null;
  };

  const onPointerOver = (event: Event) => {
    if (!(event.target instanceof Element)) return;
    const anchor = event.target.closest("a[href]");
    if (!(anchor instanceof HTMLAnchorElement)) return;
    const id = projectIdFromLink(anchor);
    if (!id) return;
    if (hoveredAnchor === anchor && hoverTimer !== undefined) return;
    cancelHover();
    hoveredAnchor = anchor;
    hoverTimer = window.setTimeout(() => {
      hoverTimer = undefined;
      hoveredAnchor = null;
      void prefetchProject(id).catch(() => undefined);
    }, HOVER_PREFETCH_DELAY_MS);
  };

  const onPointerOut = (event: Event) => {
    if (!hoveredAnchor || !(event.target instanceof Element)) return;
    const related = (event as PointerEvent).relatedTarget;
    if (related instanceof Node && hoveredAnchor.contains(related)) return;
    if (hoveredAnchor.contains(event.target)) cancelHover();
  };

  const onImmediateIntent = (event: Event) => {
    if (!(event.target instanceof Element)) return;
    const anchor = event.target.closest("a[href]");
    if (!(anchor instanceof HTMLAnchorElement)) return;
    const id = projectIdFromLink(anchor);
    if (!id) return;
    cancelHover();
    void prefetchProject(id).catch(() => undefined);
  };

  const immediateEvents = ["focusin", "touchstart"] as const;
  root.addEventListener("pointerover", onPointerOver, { capture: true, passive: true });
  root.addEventListener("pointerout", onPointerOut, { capture: true, passive: true });
  for (const event of immediateEvents) {
    root.addEventListener(event, onImmediateIntent, { capture: true, passive: true });
  }
  return () => {
    cancelIdle();
    cancelHover();
    root.removeEventListener("pointerover", onPointerOver, { capture: true });
    root.removeEventListener("pointerout", onPointerOut, { capture: true });
    for (const event of immediateEvents) {
      root.removeEventListener(event, onImmediateIntent, { capture: true });
    }
  };
}
