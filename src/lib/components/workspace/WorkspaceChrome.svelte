<script lang="ts">
  // Scrollable utility-page chrome for the flagged workspace experience.
  // Unlike the Projects board shell, this component gives the content pane a
  // normal vertical scroll owner. It reuses the branded fir rail/drawer and
  // never changes page business logic, authorization, or the current UI.
  import type { Snippet } from "svelte";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { resolve } from "$app/paths";
  import { useQuery } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { api } from "../../../../convex/_generated/api";
  import WorkspaceShell from "$lib/components/workspace/WorkspaceShell.svelte";
  import WorkspaceShellControls from "$lib/components/workspace/WorkspaceShellControls.svelte";
  import type { DashboardView } from "$lib/dashboard/viewMode";

  let {
    title,
    description = null,
    theme = "dark",
    currentExperienceHref = null,
    currentExperienceLabel = "Current dashboard",
    children,
    actions,
  }: {
    title: string;
    description?: string | null;
    theme?: "light" | "dark";
    currentExperienceHref?: string | null;
    currentExperienceLabel?: string;
    children: Snippet;
    actions?: Snippet;
  } = $props();

  const auth = useAuth();
  const configQ = useQuery(api.myWork.getViewConfig, () => (auth.isAuthenticated ? {} : "skip"));
  let navigationOpen = $state(false);
  // Desktop rail visibility — shared persisted preference (WorkspaceShell).
  let railHidden = $state(false);
  const myWorkAvailable = $derived(Boolean(configQ.data?.ready && !configQ.data?.killSwitch));

  function destinationHref(target: DashboardView) {
    const url = new URL(page.url);
    url.searchParams.delete("view");
    url.searchParams.delete("workspace");
    const pathname = target === "my_work" ? resolve("/my-work") : resolve("/projects");
    return `${pathname}${url.search}`;
  }

  const currentDashboardHref = $derived.by(() => {
    if (currentExperienceHref) return currentExperienceHref;
    const url = new URL(page.url);
    url.pathname = resolve("/dashboard");
    url.searchParams.set("workspace", "current");
    return `${url.pathname}${url.search}`;
  });

  function focusProjectSearch() {
    navigationOpen = false;
    // SPA navigation like the rest of the shell — the previous hard full-page
    // reload dropped all client state just to reach the Projects board.
    void goto(destinationHref("all_projects"));
  }

</script>

<WorkspaceShell
  kind="chrome"
  {theme}
  bind:navigationOpen
  bind:railHidden
  displayedView={null}
  {myWorkAvailable}
  myWorkHref={destinationHref("my_work")}
  projectsHref={destinationHref("all_projects")}
  {currentDashboardHref}
  {currentExperienceLabel}
  onFocusSearch={focusProjectSearch}
  drawerDescription="Navigate between work, projects, and account pages."
>
  <div class="flex min-h-0 min-w-0 flex-col overflow-hidden">
    <header class="flex min-h-14 shrink-0 items-center gap-3 border-b border-line-soft px-3 sm:px-5">
      <!-- Shared drawer hamburger + desktop rail toggle: one a11y contract,
           owned by WorkspaceShellControls (dedup with WorkspaceHeader). -->
      <WorkspaceShellControls
        tone={theme === "dark" ? "dark" : "light"}
        onOpenNavigation={() => (navigationOpen = true)}
        {railHidden}
        onToggleRail={() => (railHidden = !railHidden)}
      />
      <div class="min-w-0 flex-1">
        <h1 class="truncate text-base font-medium text-ink">{title}</h1>
        {#if description}<p class="truncate text-xs text-ink-muted">{description}</p>{/if}
      </div>
      {@render actions?.()}
    </header>

    <main class="min-h-0 min-w-0 flex-1 overflow-y-auto">
      {@render children()}
    </main>
  </div>
</WorkspaceShell>
