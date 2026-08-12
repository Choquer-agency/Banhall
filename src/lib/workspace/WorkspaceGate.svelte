<script lang="ts">
  // Shared workspace rollout gate — the ONE branch point for /dashboard,
  // /projects, and /my-work. Owns auth, the `workspaceRollout.getAccess`
  // subscription, and the pure experience resolution; routes only declare
  // what to render (snippets) or where to send the user (hrefs).
  //
  // Contract (fail-closed, product-domain 2026-08-06 amendment):
  // - `?workspace=current` always wins — the access query is never even
  //   subscribed (shouldQueryWorkspaceAccess), including mid-load and on
  //   query error, on every gated route.
  // - A route that passes a `current` snippet (the /dashboard compatibility
  //   entry) mounts it immediately while the decision is loading by default —
  //   the current dashboard is the rollback surface and must never flash away.
  //   Query-heavy two-subtree routes may set `currentWhileLoading={false}` to
  //   mount neither experience until the server decision settles.
  // - A route that instead passes `currentHref` (the canonical /projects and
  //   /my-work routes) renders a neutral loading state while the decision is
  //   pending and soft-redirects (replaceState) only once the decision is
  //   genuinely "current" — no 404, no preview flash, no redirect bounce.
  // - Symmetrically, `previewHref` lets /dashboard soft-navigate flagged
  //   users to their canonical URL while unflagged users' /dashboard stays
  //   byte-identical.
  // - Local development forces the preview so the flagged experience is
  //   reviewable without mutating rollout data; prod-like builds are the
  //   only place the gate is truly exercised.
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { page } from "$app/state";
  import { dev } from "$app/environment";
  import { useQuery } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import type { Snippet } from "svelte";
  import { api } from "../../../convex/_generated/api";
  import Button from "$lib/components/ui/Button.svelte";
  import Spinner from "$lib/components/ui/Spinner.svelte";
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
  }: {
    /** Rendered when the preview experience is resolved (omit to redirect via previewHref). */
    preview?: Snippet;
    /** Rendered when the current experience is resolved — and, by default, while the decision loads. */
    current?: Snippet;
    /** Soft-redirect target when preview resolves and no `preview` snippet exists. */
    previewHref?: string | null;
    /** Soft-redirect target when current resolves and no `current` snippet exists. */
    currentHref?: string | null;
    /** Keep true for rollback surfaces; utility pages set false to avoid a light→dark preview flash. */
    currentWhileLoading?: boolean;
  } = $props();

  const auth = useAuth();
  const workspaceParam = $derived(page.url.searchParams.get("workspace"));
  const accessQ = useQuery(api.workspaceRollout.getAccess, () =>
    auth.isAuthenticated && shouldQueryWorkspaceAccess(workspaceParam) ? {} : "skip"
  );

  $effect(() => {
    if (!auth.isLoading && !auth.isAuthenticated) goto(resolve("/login"), { replaceState: true });
  });

  const accessState = $derived.by<WorkspaceAccessState>(() => {
    if (accessQ.error) return { status: "error" };
    if (accessQ.data === undefined) return { status: "loading" };
    return { status: "ready", available: accessQ.data.available === true };
  });
  const routeState = $derived(
    // Dev no longer forces the preview (owner direction 2026-08-11): the
    // rollout allowlist + admin role govern in every environment.
    resolveWorkspaceRouteState({ workspaceParam, access: accessState, localDevelopment: false })
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

{#if auth.isLoading}
  <!-- data-workspace-gate-pending distinguishes the two visually identical
       spinner branches (auth vs. decision/redirect) so an authenticated
       visual smoke that stalls on a spinner can attribute the wait (live QA
       2026-08-07 rollback smoke diagnostics; no behavior change). -->
  <div class="flex flex-1 items-center justify-center bg-canvas" data-workspace-gate-pending="auth"><Spinner /></div>
{:else if !auth.isAuthenticated}
  <div class="flex flex-1 items-center justify-center bg-canvas px-6">
    <Button href={resolve("/login")} class="min-h-11">Sign in to continue</Button>
  </div>
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
       subtree — same loading treatment the dashboard route always used. -->
  <div
    class="flex flex-1 items-center justify-center bg-canvas"
    role="status"
    aria-label="Loading workspace"
    data-workspace-gate-pending="decision"
    data-workspace-gate-route-state={routeState}
  >
    <Spinner />
  </div>
{/if}
