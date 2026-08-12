/**
 * Pure resolver for which dashboard experience mounts at /dashboard.
 *
 * Rules (fail-closed toward the current dashboard):
 * - `?workspace=current` always forces the current dashboard immediately,
 *   including while the rollout access query loads or errors.
 * - Local development shows the preview by default so the flagged experience
 *   can be reviewed without mutating deployment rollout data.
 * - Outside local development, `?workspace=preview` (or any other value) can
 *   never bypass the server decision: without a ready `available: true`, the
 *   answer is "current".
 * - When the server says available and no current override exists, the
 *   preview is the default.
 */
export type WorkspaceExperience = "current" | "preview";

export type WorkspaceAccessState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; available: boolean };

export function resolveWorkspaceExperience(args: {
  workspaceParam: string | null;
  access: WorkspaceAccessState;
  localDevelopment?: boolean;
}): WorkspaceExperience {
  if (args.workspaceParam === "current") return "current";
  if (args.localDevelopment) return "preview";
  if (args.access.status !== "ready" || !args.access.available) return "current";
  return "preview";
}

/**
 * Three-state variant for the canonical routes (/projects, /my-work), which
 * must distinguish "still deciding" from "decided current": redirecting a
 * flagged user to /dashboard mid-load would bounce them straight back once
 * the access query resolves. Rules:
 * - `?workspace=current` wins immediately, including mid-load and on error.
 * - Local development forces the preview (same as resolveWorkspaceExperience).
 * - While the access query loads, the state is `loading` — callers render a
 *   neutral loading surface, never a redirect and never a preview flash.
 * - Error or ready-unavailable resolve to `current` (fail-closed).
 */
export type WorkspaceRouteState = "loading" | WorkspaceExperience;

export function resolveWorkspaceRouteState(args: {
  workspaceParam: string | null;
  access: WorkspaceAccessState;
  localDevelopment?: boolean;
}): WorkspaceRouteState {
  if (args.workspaceParam === "current") return "current";
  if (args.localDevelopment) return "preview";
  if (args.access.status === "loading") return "loading";
  if (args.access.status !== "ready" || !args.access.available) return "current";
  return "preview";
}

/**
 * Whether the route should subscribe to the rollout access query at all.
 * `?workspace=current` is an explicit escape: the resolver ignores access
 * entirely there, so keeping the subscription open would be pure overhead.
 */
export function shouldQueryWorkspaceAccess(workspaceParam: string | null): boolean {
  return workspaceParam !== "current";
}
