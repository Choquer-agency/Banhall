/**
 * Recent projects for the dark workspace rail ("Recent" group).
 *
 * Frontend-only recency: the shell records project opens it can observe
 * (clicks on `/project/<id>` links inside the workspace) into localStorage.
 * This is deliberately best-effort — a server-side `viewed` recency query can
 * replace the storage source later without changing the rail contract.
 *
 * Stage, client, and opened-at are captured only when the clicked surface
 * already renders them (board cards, list rows expose `data-recent-*`
 * attributes) — real row data at click time, never invented or re-queried.
 * Entries recorded before those surfaces carried the attributes simply lack
 * the fields and render as title-only cards.
 */
import { WORKFLOW_STAGES, type WorkflowStage } from "../../../shared/workflowStages";

export type RecentProject = {
  id: string;
  title: string;
  stage?: WorkflowStage;
  client?: string;
  openedAt?: number;
};

export const RECENT_PROJECTS_KEY = "banhall.workspaceRecentProjects";
export const MAX_RECENT_PROJECTS = 5;
const MAX_TITLE_LENGTH = 120;
const MAX_CLIENT_LENGTH = 80;

function sanitizeStage(value: unknown): WorkflowStage | undefined {
  return typeof value === "string" && (WORKFLOW_STAGES as readonly string[]).includes(value)
    ? (value as WorkflowStage)
    : undefined;
}

function sanitizeClient(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const client = value.trim().slice(0, MAX_CLIENT_LENGTH);
  return client || undefined;
}

function sanitizeOpenedAt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

/** Optional fields join the entry only when valid — absent keys stay absent. */
function buildEntry(
  id: string,
  title: string,
  extras: { stage?: unknown; client?: unknown; openedAt?: unknown }
): RecentProject {
  const entry: RecentProject = { id, title };
  const stage = sanitizeStage(extras.stage);
  if (stage) entry.stage = stage;
  const client = sanitizeClient(extras.client);
  if (client) entry.client = client;
  const openedAt = sanitizeOpenedAt(extras.openedAt);
  if (openedAt) entry.openedAt = openedAt;
  return entry;
}

/** Parse a stored value defensively — bad JSON or shapes yield an empty list. */
export function parseRecentProjects(raw: string | null): RecentProject[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const list: RecentProject[] = [];
    for (const entry of parsed) {
      if (typeof entry !== "object" || entry === null) continue;
      const { id, title, stage, client, openedAt } = entry as {
        id?: unknown;
        title?: unknown;
        stage?: unknown;
        client?: unknown;
        openedAt?: unknown;
      };
      if (typeof id !== "string" || !id || typeof title !== "string" || !title) continue;
      if (seen.has(id)) continue;
      seen.add(id);
      list.push(buildEntry(id, title.slice(0, MAX_TITLE_LENGTH), { stage, client, openedAt }));
      if (list.length >= MAX_RECENT_PROJECTS) break;
    }
    return list;
  } catch {
    return [];
  }
}

/** Most-recent-first, deduplicated by id, capped at MAX_RECENT_PROJECTS. */
export function recordRecentProject(
  list: RecentProject[],
  entry: { id: string; title: string; stage?: string; client?: string; openedAt?: number }
): RecentProject[] {
  const title = entry.title.trim().slice(0, MAX_TITLE_LENGTH) || "Untitled project";
  return [
    buildEntry(entry.id, title, entry),
    ...list.filter((item) => item.id !== entry.id),
  ].slice(0, MAX_RECENT_PROJECTS);
}

export function loadRecentProjects(): RecentProject[] {
  try {
    return parseRecentProjects(localStorage.getItem(RECENT_PROJECTS_KEY));
  } catch {
    return [];
  }
}

export function persistRecentProjects(list: RecentProject[]): void {
  try {
    localStorage.setItem(RECENT_PROJECTS_KEY, JSON.stringify(list.slice(0, MAX_RECENT_PROJECTS)));
  } catch {
    // Recents stay usable in memory when browser storage is blocked.
  }
}
