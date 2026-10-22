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
  import PageTopBar, { type TopBarPrimaryAction } from "$lib/components/shell/PageTopBar.svelte";
  import { workPanelPadding } from "$lib/components/shell/topBar";
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
    frame = "inset",
    onBack = null,
    children,
    actions,
    status,
    count = null,
    primaryAction = null,
  }: {
    title: string;
    /** Muted count after the title, as on Projects. */
    count?: string | number | null;
    /** The top bar's filled button. */
    primaryAction?: TopBarPrimaryAction | null;
    /**
     * @deprecated Every top bar is the title and its count (owner,
     * 2026-10-19); a page that needs a sentence of context puts it in its body.
     */
    description?: string | null;
    /** @deprecated See `description`. */
    subtitle?: string | null;
    /** @deprecated The standard bar draws no page tile. */
    icon?: PageIcon;
    iconSnippet?: Snippet;
    /** @deprecated The standard bar shows the page title only, no trail. */
    breadcrumb?: { label: string; href: string } | null;
    /**
     * `padded`: the panel pads its content with the one inset every screen
     * shares (24px sides, 20px top, as Projects; `padding` no longer changes
     * it). `flush`: the page pads itself, with `workPanelPadding`.
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
    /**
     * `inset`: the round 2 frame (top bar on the shell background, white
     * panel inset 12px). `bleed` (H1, tablet) and `phone` (H2): a full-bleed
     * white page under a plain top bar, with no inset panel, page tile or
     * bell; the phone bar leads with a back arrow when `onBack` is set.
     */
    frame?: "inset" | "bleed" | "phone";
    onBack?: (() => void) | null;
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
  <!-- Rail v3 frame (2026-10-19): the 64px standard top bar on the shell
       background, then the white work panel (radius 12, line border) with
       12px between it and the rail, the window's right edge and its foot.
       The panel owns the vertical scroll. `data-work-panel` is the shared
       hook for the View as frame. -->
  <div
    data-chrome-frame={frame}
    class={`flex min-h-0 min-w-0 flex-col overflow-hidden ${frame === "inset" ? "bg-workspace-shell px-3 pb-3" : "bg-surface"}`}
  >
    <!-- D4: while the page is hidden in a View as role, the bar names the
         gated page on its own ("Admin") with its address as the muted line
         ("banhall.app/admin"), and no breadcrumb or actions. -->
    <!-- Owner, 2026-10-19: every header is the Projects bar: the title, its
         count, the bell and one plain main button. No muted line, no trail. -->
    <PageTopBar
      title={hiddenInView && viewAsGate ? VIEW_AS_GATE_PAGE_NAMES[viewAsGate] : title}
      subtitle={hiddenInView ? `${page.url.host}${page.url.pathname}` : null}
      count={hiddenInView ? null : count}
      primaryAction={hiddenInView ? null : primaryAction}
      tone={theme === "dark" ? "dark" : "light"}
      onOpenNavigation={() => (navigationOpen = true)}
      {status}
      actions={hiddenInView ? undefined : actions}
      variant={frame === "inset" ? "default" : frame}
      {onBack}
    />
    <main
      data-work-panel
      data-work-panel-padding={panel === "padded" && !hiddenInView ? padding : "flush"}
      class={`min-h-0 min-w-0 flex-1 overflow-y-auto bg-surface ${frame === "inset" ? "rounded-xl border border-line" : ""} ${hiddenInView ? "flex flex-col" : ""} ${
        panel === "flush" || hiddenInView ? "" : workPanelPadding
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
