<script lang="ts">
  import { resolve } from "$app/paths";
  import { page } from "$app/state";
  import { useQuery } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { IconChevronDown, IconLightbulb, IconShield, IconWarning } from "$lib/components/icons";
  import { api } from "../../../../convex/_generated/api";
  import { displayName } from "$lib/displayName";
  import { roleAvatarTone } from "$lib/components/ui/avatarTone";
  import IdentityMenu from "$lib/components/shell/IdentityMenu.svelte";
  import RailIcon, { type RailIconName } from "$lib/components/workspace/RailIcon.svelte";
  import { ADMIN_INGESTION_PATH, ADMIN_RAIL_ROUTES } from "$lib/dashboard/adminRoutes";
  import type { DashboardView } from "$lib/dashboard/viewMode";
  import { ROLE_CHIP_LABELS, roleChipKind } from "$lib/roles/roleChip";
  import {
    badgeLabel,
    canSeeAdmin,
    canSeeAlerts,
    railGroups,
    selectedRailItem,
    type RailItem,
    type RailItemId,
  } from "$lib/shell/navigation";
  import { detectPlatform } from "$lib/shell/shortcuts";
  import { VIEW_AS_LABELS, effectiveViewer } from "$lib/shell/viewAs.svelte";
  import { loadRailPreferences, persistRailPreferences } from "$lib/workspace/railPreferences";
  import { loadRecentCompanies, recentCompanyHref, type RecentCompany } from "$lib/workspace/recentCompanies";
  import { companiesPath } from "$lib/companies/companies";

  let {
    displayedView,
    myWorkAvailable,
    myWorkHref,
    projectsHref,
    onFocusSearch,
    onNavigate,
  }: {
    /**
     * Only the slide-out drawer below 1024px draws this rail now (the page
     * frame, owner 2026-10-28); the desktop shell has the fixed labelled
     * rail (`FrameRail`).
     */
    variant?: "drawer";
    displayedView: DashboardView | null;
    myWorkAvailable: boolean;
    myWorkHref: string;
    projectsHref: string;
    onFocusSearch: () => void;
    onNavigate?: () => void;
  } = $props();
  const auth = useAuth();
  const userQ = useQuery(api.users.getCurrentUser, () => (auth.isAuthenticated ? {} : "skip"));
  const user = $derived(userQ.data);
  // Every rail decision reads the effective viewer (View as applied, D3).
  const viewer = $derived(effectiveViewer(user));
  const internal = $derived(Boolean(user?.role) && user?.isAnonymous !== true);
  const openAlertsQ = useQuery(api.errorReports.openCount, () =>
    auth.isAuthenticated && canSeeAlerts(viewer) ? {} : "skip"
  );
  const attentionQ = useQuery(api.adminAttention.getAttention, () =>
    auth.isAuthenticated && canSeeAdmin(viewer) ? {} : "skip"
  );
  // Rail v3 counts beside Projects and Companies, only on the Projects page,
  // where the page already holds these two reads (Convex shares one
  // subscription). Elsewhere the rail adds no reads (Home's cost rule).
  const countsOn = $derived(auth.isAuthenticated && internal && displayedView === "all_projects");
  const facetsQ = useQuery(api.dashboard.getFacets, () => (countsOn ? {} : "skip"));
  const clientsQ = useQuery(api.clients.listClients, () => (countsOn ? {} : "skip"));
  const attention = $derived(attentionQ.data ?? { total: 0, ingestionFailed: 0 });
  const userName = $derived(displayName(user, "Account"));

  const counts = $derived.by((): Partial<Record<RailItemId, string>> => {
    const facets = facetsQ.data;
    const clients = clientsQ.data;
    return {
      ...(facets ? { projects: `${facets.total}${facets.truncated ? "+" : ""}` } : {}),
      ...(clients ? { companies: `${clients.clients.length}${clients.truncated ? "+" : ""}` } : {}),
    };
  });

  const selected = $derived.by((): RailItemId | null => {
    const url = page.url;
    if (displayedView === "my_work") return "home";
    if (displayedView === "all_projects") return "projects";
    // E1, F2, H1, H3: a project page (and New project) sits under Projects.
    const projectRoot = resolve("/project");
    if (url.pathname === projectRoot || url.pathname.startsWith(`${projectRoot}/`)) return "projects";
    return selectedRailItem(url);
  });

  const groups = $derived(
    railGroups(
      viewer,
      {
        myWorkHref,
        projectsHref,
        // The Companies section (2026-10-28): All companies.
        companiesHref: companiesPath(resolve("/")),
        // WS2 lands the /team route; until then the path is not a typed route id.
        teamHref: `${resolve("/")}team`,
        adminHref: resolve("/admin/house-rules"),
        alertsHref: resolve("/alerts"),
        requestsHref: resolve("/requests"),
        changelogHref: resolve("/changelog"),
        settingsHref: resolve("/settings"),
      },
      { unseenChangelog: 0, openAlerts: openAlertsQ.data ?? 0, adminAttention: attention.total }
    )
  );
  // Rail v3 draws no group labels: Home, Projects and Companies at the top,
  // the rest of the role's rows at the foot. What's new leaves the rail; the
  // top bar bell keeps it one click away on every screen.
  const topItems = $derived(groups.find((group) => group.id === "workspace")?.items ?? []);
  const bottomItems = $derived(
    groups
      .filter((group) => group.id !== "workspace")
      .flatMap((group) => group.items)
      .filter((item) => item.id !== "changelog")
  );

  // Recent companies: the companies this person last opened on the Projects
  // page (per user, refreshed against the company list there). Read again on
  // every navigation.
  let recent = $state<RecentCompany[]>([]);
  $effect(() => {
    void page.url.href;
    recent = internal ? loadRecentCompanies(user?._id) : [];
  });

  const platform = detectPlatform();

  // B1, B2: the Admin group opens by itself on any admin page; elsewhere it
  // keeps the last choice (persisted, closed by default).
  const onAdminPage = $derived(selected === "admin");
  let adminChoice = $state(loadRailPreferences().adminOpen);
  const adminOpen = $derived(onAdminPage || adminChoice);
  function toggleAdmin() {
    adminChoice = !adminOpen;
    persistRailPreferences({ adminOpen: adminChoice });
  }
  const pathname = $derived(page.url.pathname);

  // The account menu's avatar keeps the person's own role colour (D3).
  const avatarTone = $derived(roleAvatarTone(roleChipKind({
    role: user?.role ?? null,
    isOwner: user?.isOwner === true,
    isDeveloper: user?.isDeveloper === true,
  })));

  const roleLabel = $derived.by(() => {
    if (viewer.viewing) return `Viewing as ${VIEW_AS_LABELS[viewer.viewing]}`;
    const kind = roleChipKind({
      role: user?.role ?? null,
      isOwner: user?.isOwner === true,
      isDeveloper: user?.isDeveloper === true,
    });
    return kind ? ROLE_CHIP_LABELS[kind] : null;
  });

  // The touch drawer keeps 44px rows (36px with a fine pointer, below).
  const rowHeight = "min-h-11";
  const focusRing =
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir";
  const rowBase = `${rowHeight} workspace-rail-row flex w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[0.9375rem] leading-[calc(4/3)] transition-colors duration-150 ease-out ${focusRing} motion-reduce:transition-none`;
  const idleRow = "text-ink-secondary hover:bg-workspace-rail-hover hover:text-ink";
  const selectedRow = "bg-primary-wash text-primary-selected font-medium";

  const V3_ICONS: Partial<Record<RailItemId, RailIconName>> = {
    home: "home",
    projects: "projects",
    companies: "companies",
    team: "team",
    settings: "settings",
  };
  // No Rail v3 drawing for these; the round 2 icons at the v3 size and stroke.
  const OTHER_ICONS = { admin: IconShield, alerts: IconWarning, requests: IconLightbulb } as const;
</script>

<!--
  The slide-out drawer below 1024px (Rail v3, Paper board Z11a, kept as it
  was by the owner's 2026-10-28 frame answer 6): the Banhall tile and name, a
  search field that opens the command palette, Home, Projects and Companies
  with their counts, Recent companies, then the role's other rows (Team,
  Admin, Alerts, Feature requests, Settings) above a hairline and the
  person's name and role, which open the account menu (D1). The desktop
  rail, its collapse and the Admin flyout are gone (the page frame).
-->
{#snippet itemIcon(id: RailItemId)}
  {@const v3 = V3_ICONS[id]}
  {#if v3}
    <RailIcon name={v3} />
  {:else}
    {@const Icon = OTHER_ICONS[id as keyof typeof OTHER_ICONS]}
    {#if Icon}<Icon size={16} strokeWidth={1.7} data-rail-icon={id} class="shrink-0" />{/if}
  {/if}
{/snippet}

{#snippet brandTile()}
  <span
    aria-hidden="true"
    data-rail-brand-tile
    class="flex size-[1.375rem] shrink-0 items-center justify-center rounded-md bg-fir text-[0.6875rem] font-medium leading-[calc(12/11)] text-white"
  >B</span>
{/snippet}

{#snippet expandedRow(item: RailItem)}
  {@const isSelected = selected === item.id}
  {@const disabled = item.id === "home" && !myWorkAvailable}
  {@const count = counts[item.id]}
  <a
    data-rail-item={item.id}
    href={item.href}
    aria-current={isSelected ? "page" : undefined}
    aria-disabled={disabled ? "true" : undefined}
    onclick={(event) => {
      if (disabled) {
        event.preventDefault();
        return;
      }
      onNavigate?.();
    }}
    class={`${rowBase} ${isSelected ? selectedRow : idleRow}`}
  >
    {@render itemIcon(item.id)}
    <span class="min-w-0 flex-1 truncate">{item.label}</span>
    {#if count}
      <span data-rail-count class="shrink-0 text-[0.8125rem] font-normal leading-[calc(16/13)] text-ink-muted">{count}</span>
    {/if}
    {#if item.badge}
      <span
        data-rail-badge={item.badge.tone}
        class={`flex h-[1.125rem] min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-[0.6875rem] font-medium leading-[calc(12/11)] text-white ${item.badge.tone === "danger" ? "bg-danger" : "bg-primary-selected"}`}
      >{badgeLabel(item.badge.count)}</span>
    {/if}
  </a>
{/snippet}

{#snippet adminGroup(item: RailItem)}
  <button
    type="button"
    data-rail-item="admin"
    data-admin-group-toggle
    aria-expanded={adminOpen}
    aria-controls="workspace-admin-links"
    onclick={toggleAdmin}
    class={`${rowBase} ${adminOpen ? "text-ink hover:bg-workspace-rail-hover" : idleRow}`}
  >
    <!-- B2, B3: open, the label turns ink and the attention dot moves down to
         its page's row. The chevron sits on the right edge. -->
    <span class={adminOpen ? "text-ink-secondary" : ""}>{@render itemIcon("admin")}</span>
    <span class="min-w-0 flex-1 truncate">{item.label}</span>
    {#if item.attention && !adminOpen}
      <span data-rail-attention aria-label="Needs a look" class="size-1.5 shrink-0 rounded-full bg-stale-dot"></span>
    {/if}
    <IconChevronDown
      size={14}
      strokeWidth={1.8}
      data-admin-chevron={adminOpen ? "up" : "down"}
      class={`shrink-0 text-ink-muted transition-transform duration-300 motion-reduce:transition-none ${adminOpen ? "rotate-180" : "rotate-0"}`}
    />
  </button>
  {#if adminOpen}
    <div id="workspace-admin-links" data-rail-admin-links class="relative flex flex-col gap-0.5">
      <span aria-hidden="true" class="absolute bottom-1 left-[1.125rem] top-1 w-px bg-line"></span>
      {#each ADMIN_RAIL_ROUTES as route (route.href)}
        {@const href = resolve(route.href as "/")}
        {@const current = pathname === href || pathname.startsWith(`${href}/`)}
        <a
          {href}
          data-admin-link={route.href}
          aria-current={current ? "page" : undefined}
          onclick={() => onNavigate?.()}
          class={`min-h-11 workspace-rail-row flex items-center gap-2 rounded-lg pl-9 pr-2.5 text-sm leading-[calc(9/7)] transition-colors duration-150 ease-out ${focusRing} motion-reduce:transition-none ${current ? selectedRow : idleRow}`}
        >
          <span class="min-w-0 flex-1 truncate">{route.label}</span>
          {#if route.href === ADMIN_INGESTION_PATH && attention.ingestionFailed > 0}
            <span data-rail-attention aria-label={`${attention.ingestionFailed} failed`} class="size-1.5 shrink-0 rounded-full bg-stale-dot"></span>
          {/if}
        </a>
      {/each}
    </div>
  {/if}
{/snippet}

{#snippet identity()}
  <IdentityMenu
    name={userName}
    email={user?.email ?? null}
    imageUrl={user?.imageUrl ?? null}
    seed={user?._id}
    tone={avatarTone}
    isDeveloper={user?.isDeveloper === true}
    placement="above"
    layer="drawer"
    {onNavigate}
  >
    {#snippet trigger({ props, open })}
      <button
        {...props}
        type="button"
        data-rail-identity
        aria-label={`${userName}, account menu`}
        class={`flex min-h-12 w-full flex-col justify-center gap-0.5 rounded-lg px-2.5 py-1.5 text-left transition-colors ${focusRing} motion-reduce:transition-none ${open ? "bg-workspace-rail-selected" : "hover:bg-workspace-rail-hover"}`}
      >
        <span data-rail-identity-name class="truncate text-sm font-medium leading-[calc(9/7)] text-ink">{userName}</span>
        {#if roleLabel}
          <span data-rail-identity-role class="truncate text-[0.8125rem] leading-[calc(16/13)] text-ink-muted">{roleLabel}</span>
        {/if}
      </button>
    {/snippet}
  </IdentityMenu>
{/snippet}

<nav
  aria-label="Workspace"
  class="flex h-full min-h-0 flex-col bg-workspace-shell px-2.5 pb-[max(0.375rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))] text-ink"
>
  <div data-rail-header class="flex h-[2.375rem] shrink-0 items-center gap-2 pl-1.5 pr-12">
    <a
      href={myWorkHref}
      aria-label="Banhall home"
      data-banhall-rail-mark="expanded"
      onclick={onNavigate}
      class={`flex min-w-0 items-center gap-2 rounded-md ${focusRing}`}
    >
      {@render brandTile()}
      <span aria-hidden="true" class="truncate text-base font-medium leading-[1.25] text-ink">Banhall</span>
    </a>
  </div>

  <button
    type="button"
    data-rail-search
    aria-keyshortcuts={platform === "mac" ? "Meta+K" : "Control+K"}
    onclick={onFocusSearch}
    class={`mt-1.5 flex h-9 w-full shrink-0 items-center gap-2 rounded-lg border border-line-soft bg-surface px-2.5 text-left text-sm leading-[calc(9/7)] text-ink-muted transition-colors hover:border-line hover:text-ink-secondary ${focusRing} motion-reduce:transition-none pointer-coarse:h-11`}
  >
    <RailIcon name="search" />
    <span class="min-w-0 flex-1 truncate">Search</span>
  </button>

  <div data-rail-scroll class="scrollbar-hidden flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
    <div data-rail-group="top" class="flex flex-col gap-0.5 pt-4">
      {#each topItems as item (item.id)}
        {@render expandedRow(item)}
      {/each}
    </div>

    {#if recent.length > 0}
      <div data-rail-recent class="flex flex-col gap-0.5 pt-5">
        <p data-rail-recent-label class="px-2.5 pb-1 text-[0.8125rem] leading-[calc(16/13)] text-ink-muted">Recent companies</p>
        {#each recent as company (company.key)}
          <a
            href={recentCompanyHref(projectsHref, company.key)}
            data-rail-recent-company={company.key}
            onclick={() => onNavigate?.()}
            class={`min-h-11 workspace-rail-row flex items-center rounded-lg px-2.5 text-sm leading-[calc(9/7)] transition-colors duration-150 ease-out ${focusRing} motion-reduce:transition-none ${idleRow}`}
          >
            <span class="min-w-0 flex-1 truncate">{company.name}</span>
          </a>
        {/each}
      </div>
    {/if}

    <div class="min-h-4 flex-1" aria-hidden="true"></div>

    <div data-rail-group="bottom" class="flex flex-col gap-0.5 border-b border-line-soft pb-2.5">
      {#each bottomItems as item (item.id)}
        {#if item.id === "admin"}
          {@render adminGroup(item)}
        {:else}
          {@render expandedRow(item)}
        {/if}
      {/each}
    </div>
  </div>

  <div class="shrink-0 pt-1">
    {@render identity()}
  </div>
</nav>

<style>
  /* Responsive drawers can also be opened from a narrow desktop window.
     Match the persistent rail's 36px rows there, while real touch devices
     keep the 44px targets supplied by the base drawer classes. */
  @media (pointer: fine) {
    :global([data-workspace-drawer] .workspace-rail-row) {
      height: 2.25rem;
      min-height: 2.25rem;
    }
  }
</style>
