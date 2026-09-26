<script lang="ts">
  import type { PageIcon } from "$lib/components/shell/pageIcon";
  // Scrollable utility-page chrome for the flagged workspace experience.
  // Unlike the Projects board shell, this component gives the content pane a
  // normal vertical scroll owner (the round 2 work panel). It never changes
  // page business logic, authorization, or the current UI.
  import type { Snippet } from "svelte";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { resolve } from "$app/paths";
  import { useQuery } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { api } from "../../../../convex/_generated/api";
  import WorkspaceShell from "$lib/components/workspace/WorkspaceShell.svelte";
  import PageTopBar from "$lib/components/shell/PageTopBar.svelte";
  import ViewAsHiddenPage from "$lib/components/shell/ViewAsHiddenPage.svelte";
  import { VIEW_AS_GATE_PAGE_NAMES, viewerCanOpen, type ViewAsGate } from "$lib/shell/navigation";
  import { effectiveViewer } from "$lib/shell/viewAs.svelte";
  import type { DashboardView } from "$lib/dashboard/viewMode";

  let {
    title,
    description = null,
    subtitle = null,
    icon = undefined,
    iconSnippet = undefined,
    breadcrumb = null,
    panel = "padded",
    padding = "wide",
    theme = "light",
    currentExperienceHref = null,
    currentExperienceLabel = "Current dashboard",
    viewAsGate = null,
    children,
    actions,
    status,
  }: {
    title: string;
    /** Legacy muted line beside the title; `subtitle` wins when both are set. */
    description?: string | null;
    /** Muted line beside the title (for example the Settings section name). */
    subtitle?: string | null;
    /** Page icon in the top bar tile (a board icon from `$lib/components/icons`). */
    icon?: PageIcon;
    iconSnippet?: Snippet;
    /** Parent page link ("Admin /") shown before the title. */
    breadcrumb?: { label: string; href: string } | null;
    /**
     * `padded`: the panel pads its content (`padding` picks 56px sides for
     * Settings and Team, 40px for admin pages). `flush`: the page pads itself.
     */
    panel?: "padded" | "flush";
    padding?: "wide" | "admin";
    theme?: "light" | "dark";
    currentExperienceHref?: string | null;
    currentExperienceLabel?: string;
    /**
     * Role-gated page: while a developer views Banhall as a role that cannot
     * open it, the panel shows the D4 hidden state instead of the page
     * (presentation only; the page's server checks are unchanged).
     */
    viewAsGate?: ViewAsGate | null;
    children: Snippet;
    actions?: Snippet;
    /** Right-side slot before the bell (for example a save state). */
    status?: Snippet;
  } = $props();

  const auth = useAuth();
  const configQ = useQuery(api.myWork.getViewConfig, () => (auth.isAuthenticated ? {} : "skip"));
  let navigationOpen = $state(false);
  // Desktop rail visibility — shared persisted preference (WorkspaceShell).
  let railHidden = $state(false);
  const myWorkAvailable = $derived(Boolean(configQ.data?.ready && !configQ.data?.killSwitch));
  const userQ = useQuery(api.users.getCurrentUser, () =>
    auth.isAuthenticated && viewAsGate ? {} : "skip"
  );
  const viewer = $derived(effectiveViewer(userQ.data));
  const hiddenInView = $derived(
    Boolean(viewAsGate) && viewer.viewing !== null && !viewerCanOpen(viewAsGate!, viewer)
  );

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
  <!-- Round 2 frame (decision 53): the 56px top bar on the shell background,
       then the white work panel inset 12px, which owns the vertical scroll.
       `data-work-panel` is the shared hook for the View as frame. -->
  <div class="flex min-h-0 min-w-0 flex-col overflow-hidden bg-workspace-shell px-3 pb-3">
    <!-- D4: while the page is hidden in a View as role, the bar names the
         gated page on its own ("Admin"), with no breadcrumb or actions. -->
    <PageTopBar
      title={hiddenInView && viewAsGate ? VIEW_AS_GATE_PAGE_NAMES[viewAsGate] : title}
      subtitle={hiddenInView ? null : (subtitle ?? description)}
      breadcrumb={hiddenInView ? null : breadcrumb}
      {icon}
      {iconSnippet}
      tone={theme === "dark" ? "dark" : "light"}
      {railHidden}
      onOpenNavigation={() => (navigationOpen = true)}
      onToggleRail={() => (railHidden = !railHidden)}
      {status}
      actions={hiddenInView ? undefined : actions}
    />
    <main
      data-work-panel
      data-work-panel-padding={panel === "padded" && !hiddenInView ? padding : "flush"}
      class={`min-h-0 min-w-0 flex-1 overflow-y-auto rounded-[10px] border border-line bg-surface ${hiddenInView ? "flex flex-col" : ""} ${
        panel === "flush" || hiddenInView ? "" : padding === "admin" ? "px-5 py-7 md:px-10" : "px-5 pb-12 pt-8 md:px-14"
      }`}
    >
      {#if hiddenInView && viewAsGate}
        <ViewAsHiddenPage pageName={VIEW_AS_GATE_PAGE_NAMES[viewAsGate]} />
      {:else}
        {@render children()}
      {/if}
    </main>
  </div>
</WorkspaceShell>
