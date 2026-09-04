/**
 * Pure resolver for which experience mounts on a gated route (/dashboard,
 * /projects, /my-work, /project/[id]).
 *
 * Rules (fail-closed toward the current dashboard):
 * - `?workspace=current` always forces the current experience immediately,
 *   including while the access query loads or errors.
 * - While the access query loads, the state is `loading` — callers render a
 *   neutral loading surface, never a redirect and never a preview flash.
 * - Error or ready-unavailable resolve to `current`: no param can bypass the
 *   server decision.
 * - When the server says available and no current override exists, the
 *   preview is the default.
 */
export type WorkspaceExperience = "current" | "preview";

export type WorkspaceAccessState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; available: boolean };

export type WorkspaceRouteState = "loading" | WorkspaceExperience;

export function resolveWorkspaceRouteState(args: {
  workspaceParam: string | null;
  access: WorkspaceAccessState;
}): WorkspaceRouteState {
  if (args.workspaceParam === "current") return "current";
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
