export type WorkspaceExperience = "current" | "preview";

export type WorkspaceAccessState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; available: boolean };

/**
 * Canonical routes wait for access before redirecting. The current override
 * wins in every state; errors and defensive unavailable results select current.
 */
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
