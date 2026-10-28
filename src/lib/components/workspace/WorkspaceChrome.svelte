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
  import FrameCard from "$lib/components/workspace/FrameCard.svelte";
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
    primaryActionInSidebar = false,
    sidebar = undefined,
  }: {
    title: string;
    /** Muted count after the title, as on Projects. */
    count?: string | number | null;
    /** The top bar's filled button. */
    primaryAction?: TopBarPrimaryAction | null;
    /** The section sidebar repeats `primaryAction` from 768px (Team's Invite people). */
    primaryActionInSidebar?: boolean;
    /**
     * The section's inner sidebar (`SectionSidebar`): Team, Admin and
     * Settings. Pages without one (What's new, Alerts, Feature requests, New
     * project) sit in the card alone (owner answer 5, 2026-10-28).
     */
    sidebar?: Snippet;
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
     * `inset`: the page frame's top bar inside the white card. `bleed` (H1,
     * tablet) and `phone` (H2): the plain bars with a soft line under them,
     * no bell; the phone bar leads with a back arrow when `onBack` is set.
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
  displayedView={null}
  {myWorkAvailable}
  myWorkHref={destinationHref("my_work")}
  projectsHref={destinationHref("all_projects")}
  {currentDashboardHref}
  {currentExperienceLabel}
  onFocusSearch={focusProjectSearch}
  drawerDescription="Navigate between work, projects, and account pages."
>
  <!-- The page frame (owner, 2026-10-28): one white card holding the
       section sidebar (when the page has one) and the page, its 64px top
       bar inside the card above the content. `main` owns the vertical
       scroll; the card carries `data-work-panel` for the View as frame. A
       page hidden in a View as role draws no sidebar. -->
  <FrameCard sidebar={hiddenInView ? undefined : sidebar} data-chrome-frame={frame}>
    <!-- D4: while the page is hidden in a View as role, the bar names the
         gated page on its own ("Admin") with its address as the muted line
         ("banhall.app/admin"), and no breadcrumb or actions. -->
    <PageTopBar
      title={hiddenInView && viewAsGate ? VIEW_AS_GATE_PAGE_NAMES[viewAsGate] : title}
      subtitle={hiddenInView ? `${page.url.host}${page.url.pathname}` : null}
      count={hiddenInView ? null : count}
      primaryAction={hiddenInView ? null : primaryAction}
      {primaryActionInSidebar}
      sidebarToggle={Boolean(sidebar) && !hiddenInView}
      tone={theme === "dark" ? "dark" : "light"}
      onOpenNavigation={() => (navigationOpen = true)}
      {status}
      actions={hiddenInView ? undefined : actions}
      variant={frame === "inset" ? "default" : frame}
      {onBack}
    />
    <div
      data-chrome-main
      data-work-panel-padding={panel === "padded" && !hiddenInView ? padding : "flush"}
      class={`min-h-0 min-w-0 flex-1 overflow-y-auto ${hiddenInView ? "flex flex-col" : ""} ${
        panel === "flush" || hiddenInView ? "" : workPanelPadding
      }`}
    >
      {#if hiddenInView && viewAsGate}
        <ViewAsHiddenPage pageName={VIEW_AS_GATE_PAGE_NAMES[viewAsGate]} />
      {:else}
        {@render children()}
      {/if}
    </div>
  </FrameCard>
</WorkspaceShell>
