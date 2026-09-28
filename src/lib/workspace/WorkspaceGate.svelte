<script lang="ts">
  // Shared workspace rollout gate — the ONE branch point for /dashboard,
  // /projects, and /my-work. Owns auth, the `workspaceRollout.getAccess`
  // subscription, and the pure experience resolution; routes only declare
  // what to render (snippets) or where to send the user (hrefs).
  //
  // Contract (product-domain 2026-09-03 second exposure amendment):
  // - `?workspace=current` always wins — the access query is never even
  //   subscribed (shouldQueryWorkspaceAccess), including mid-load and on
  //   query error, on every gated route.
  // - A route that passes a `current` snippet mounts it immediately while the
  //   decision is loading by default. Every route that passes one sets
  //   `currentWhileLoading={false}` and mounts neither experience until the
  //   server decision settles; /dashboard does too since 2026-09-28, so a
  //   preview user never sees the current dashboard flash before Home.
  // - A route that instead passes `currentHref` (the canonical /projects and
  //   /my-work routes) renders a neutral loading state while the decision is
  //   pending and soft-redirects (replaceState) only once the decision is
  //   genuinely "current" — no 404, no preview flash, no redirect bounce.
  // - `previewHref` lets /dashboard soft-navigate authorized users to
  //   their canonical URL. Current overrides and errors retain compatibility.
  // - Access exposes preview to project.readInternal callers in every
  //   environment; operations inside retain their own capability checks.
  import { goto } from "$app/navigation";
  import { goToLogin } from "$lib/auth/goToLogin";
  import { page } from "$app/state";
  import { useQuery } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import type { Snippet } from "svelte";
  import { api } from "../../../convex/_generated/api";
  import type { PageIcon } from "$lib/components/shell/pageIcon";
  import WorkspaceLoadingShell from "$lib/components/workspace/WorkspaceLoadingShell.svelte";
  import type { PanelSkeletonLayout } from "$lib/components/workspace/WorkspacePanelSkeleton.svelte";
  import {
    resolveWorkspaceRouteState,
    shouldQueryWorkspaceAccess,
    type WorkspaceAccessState,
  } from "$lib/dashboard/workspaceExperience";

  let {
    preview,
    current,
    previewHref = null,
    currentHref = null,
    currentWhileLoading = true,
    pendingLayout = "page",
    pendingTitle = "",
    pendingIcon = undefined,
  }: {
    /** Rendered when the preview experience is resolved (omit to redirect via previewHref). */
    preview?: Snippet;
    /** Rendered when the current experience is resolved — and, by default, while the decision loads. */
    current?: Snippet;
    /** Soft-redirect target when preview resolves and no `preview` snippet exists. */
    previewHref?: string | null;
    /** Soft-redirect target when current resolves and no `current` snippet exists. */
    currentHref?: string | null;
    /** False mounts neither subtree until the decision settles (every app route; no current-to-preview flash). */
    currentWhileLoading?: boolean;
    /** While pending, the round 2 shell shows a skeleton of this page shape... */
    pendingLayout?: PanelSkeletonLayout;
    /** ...under a top bar with this title and page icon. */
    pendingTitle?: string;
    pendingIcon?: PageIcon;
  } = $props();

  const auth = useAuth();
  const workspaceParam = $derived(page.url.searchParams.get("workspace"));
  const accessQ = useQuery(api.workspaceRollout.getAccess, () =>
    auth.isAuthenticated && shouldQueryWorkspaceAccess(workspaceParam) ? {} : "skip"
  );

  $effect(() => {
    if (!auth.isLoading && !auth.isAuthenticated) {
      void goToLogin();
    }
  });

  const accessState = $derived.by<WorkspaceAccessState>(() => {
    if (accessQ.error) return { status: "error" };
    if (accessQ.data === undefined) return { status: "loading" };
    return { status: "ready", available: accessQ.data.available === true };
  });
  const routeState = $derived(
    resolveWorkspaceRouteState({ workspaceParam, access: accessState })
  );

  // Soft-redirects preserve every query param the caller kept in the href.
  $effect(() => {
    if (auth.isLoading || !auth.isAuthenticated) return;
    if (routeState === "current" && !current && currentHref) {
      goto(currentHref, { replaceState: true });
    } else if (routeState === "preview" && !preview && previewHref) {
      goto(previewHref, { replaceState: true });
    }
  });
</script>

{#if auth.isLoading || !auth.isAuthenticated}
  <!-- data-workspace-gate-pending distinguishes the auth and redirect states.
       Checking the session draws the round 2 shell with a skeleton panel;
       a signed-out visitor on the way to /login gets the plain canvas. -->
  <WorkspaceLoadingShell
    layout={pendingLayout}
    title={pendingTitle}
    icon={pendingIcon}
    label={auth.isLoading ? "Checking your session" : "Opening sign in"}
    data-workspace-gate-pending={auth.isLoading ? "auth" : "redirect"}
  />
{:else if routeState === "preview" && preview}
  <div class="contents" data-dashboard-experience="preview">
    {@render preview()}
  </div>
{:else if current && (routeState === "current" || (routeState === "loading" && currentWhileLoading))}
  <!-- Rollback surfaces may mount current immediately while loading. Utility
       pages opt into a neutral loading state to avoid flashing light chrome
       before a preview decision arrives. -->
  <div class="contents" data-dashboard-experience="current">
    {@render current()}
  </div>
{:else}
  <!-- Neutral decision/redirect surface for routes without a matching
       subtree: the round 2 shell with a skeleton of the page (2026-09-28),
       never a lone spinner. -->
  <WorkspaceLoadingShell
    layout={pendingLayout}
    title={pendingTitle}
    icon={pendingIcon}
    data-workspace-gate-pending="decision"
    data-workspace-gate-route-state={routeState}
  />
{/if}
