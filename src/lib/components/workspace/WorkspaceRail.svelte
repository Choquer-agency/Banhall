<script lang="ts">
  import { resolve } from "$app/paths";
  import { page } from "$app/state";
  import { useQuery } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import {
    BuildingsIcon,
    CaretDownIcon,
    FolderSimpleIcon,
    GearSixIcon,
    HouseIcon,
    LightbulbIcon,
    MagnifyingGlassIcon,
    MegaphoneIcon,
    ShieldIcon,
    UsersIcon,
    WarningIcon,
  } from "phosphor-svelte";
  import { api } from "../../../../convex/_generated/api";
  import { round2Api } from "../../../../convex/lib/round2Api";
  import AnimatedSidebarToggleIcon from "$lib/components/workspace/AnimatedSidebarToggleIcon.svelte";
  import { displayName } from "$lib/displayName";
  import Tooltip from "$lib/components/ui/Tooltip.svelte";
  import Avatar from "$lib/components/ui/Avatar.svelte";
  import RoleChip from "$lib/components/ui/RoleChip.svelte";
  import BanhallRailMark from "$lib/components/ui/BanhallRailMark.svelte";
  import IdentityMenu from "$lib/components/shell/IdentityMenu.svelte";
  import AdminFlyout from "$lib/components/shell/AdminFlyout.svelte";
  import { ADMIN_INGESTION_PATH, ADMIN_RAIL_ROUTES } from "$lib/dashboard/adminRoutes";
  import type { DashboardView } from "$lib/dashboard/viewMode";
  import { roleChipKind } from "$lib/roles/roleChip";
  import {
    badgeLabel,
    canSeeAdmin,
    canSeeAlerts,
    companiesHrefFrom,
    railGroups,
    selectedRailItem,
    type RailItem,
    type RailItemId,
  } from "$lib/shell/navigation";
  import { detectPlatform, shortcutHint } from "$lib/shell/shortcuts";
  import { VIEW_AS_LABELS, effectiveViewer } from "$lib/shell/viewAs.svelte";
  import { loadRailPreferences, persistRailPreferences } from "$lib/workspace/railPreferences";

  let {
    variant = "rail",
    collapsed: collapsedProp = false,
    displayedView,
    myWorkAvailable,
    myWorkHref,
    projectsHref,
    onFocusSearch,
    onNavigate,
    onToggleRail = null,
  }: {
    variant?: "rail" | "drawer";
    /** Desktop collapsed rail: icons only (the drawer always renders expanded). */
    collapsed?: boolean;
    displayedView: DashboardView | null;
    myWorkAvailable: boolean;
    myWorkHref: string;
    projectsHref: string;
    onFocusSearch: () => void;
    onNavigate?: () => void;
    /** Collapse (expanded) or expand (collapsed) the desktop rail; null hides the toggle. */
    onToggleRail?: (() => void) | null;
  } = $props();

  // Only the desktop rail collapses; the drawer always renders expanded.
  const collapsed = $derived(variant === "rail" && collapsedProp);
  const auth = useAuth();
  const userQ = useQuery(api.users.getCurrentUser, () => (auth.isAuthenticated ? {} : "skip"));
  const user = $derived(userQ.data);
  // Every rail decision reads the effective viewer (View as applied, D3).
  const viewer = $derived(effectiveViewer(user));
  const openAlertsQ = useQuery(api.errorReports.openCount, () =>
    auth.isAuthenticated && canSeeAlerts(viewer) ? {} : "skip"
  );
  const unseenChangelogQ = useQuery(api.changelog.unseenCount, () =>
    auth.isAuthenticated ? {} : "skip"
  );
  const attentionQ = useQuery(round2Api.adminAttention.getAttention, () =>
    auth.isAuthenticated && canSeeAdmin(viewer) ? {} : "skip"
  );
  const attention = $derived(attentionQ.data ?? { total: 0, ingestionFailed: 0 });
  const userName = $derived(displayName(user, "Account"));

  const selected = $derived.by((): RailItemId | null => {
    const url = page.url;
    if (displayedView === "my_work") return "home";
    if (displayedView === "all_projects") return "projects";
    return selectedRailItem(url);
  });

  const groups = $derived(
    railGroups(
      viewer,
      {
        myWorkHref,
        projectsHref,
        companiesHref: companiesHrefFrom(projectsHref),
        // WS2 lands the /team route; until then the path is not a typed route id.
        teamHref: `${resolve("/")}team`,
        adminHref: resolve("/admin/house-rules"),
        alertsHref: resolve("/alerts"),
        requestsHref: resolve("/requests"),
        changelogHref: resolve("/changelog"),
        settingsHref: resolve("/settings"),
      },
      {
        unseenChangelog: unseenChangelogQ.data ?? 0,
        openAlerts: openAlertsQ.data ?? 0,
        adminAttention: attention.total,
      }
    )
  );
  const topGroups = $derived(groups.filter((group) => group.id === "workspace" || group.id === "manage"));
  const bottomGroups = $derived(groups.filter((group) => group.id === "developer" || group.id === "other"));

  const platform = detectPlatform();
  const collapseHint = shortcutHint("collapseRail", platform);
  const searchHint = shortcutHint("search", platform);

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

  const identityChip = $derived(roleChipKind(viewer.viewing ? { role: viewer.role, isOwner: viewer.isOwner } : {
    role: user?.role ?? null,
    isOwner: user?.isOwner === true,
    isDeveloper: user?.isDeveloper === true,
  }));

  // Board A1: 32px rows on desktop, 44px minimum in the touch drawer.
  const rowHeight = $derived(variant === "rail" ? "h-8" : "min-h-11");
  const rowBase = $derived(
    `${rowHeight} workspace-rail-row flex w-full items-center gap-2 rounded-md px-2 [&>svg]:shrink-0 text-left text-[13px] font-normal leading-[19px] transition-colors duration-150 ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir motion-reduce:transition-none`
  );
  // A4: 36px icon tiles, radius 6, 17px icons, a tooltip each.
  const iconRow =
    "workspace-rail-row relative flex size-9 shrink-0 items-center justify-center rounded-md transition-colors duration-150 ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir motion-reduce:transition-none";
  const idleRow = "text-ink-secondary hover:bg-workspace-rail-hover hover:text-ink";
  const selectedRow = "bg-workspace-rail-selected text-fir";
  const iconSize = $derived(collapsed ? 17 : 15);

  function itemAttrs(item: RailItem) {
    return { "data-rail-item": item.id };
  }
</script>

<!--
  Round 2 rail (boards A1 to A5, B1, B2; decision 53): the Banhall mark,
  Workspace (Home, Projects, Companies), Manage (Team, Admin) for roles that
  have it, Developer (Alerts with ops.viewAlerts, Feature requests) for
  developers, Other (What's new, Settings) at the bottom, then the identity
  row that opens the account menu (D1). Search lives in the collapsed rail
  and the command palette (Cmd K); Flag an issue moved to the account menu.
-->
{#snippet itemIcon(id: RailItemId)}
  {#if id === "home"}<HouseIcon size={iconSize} aria-hidden="true" />
  {:else if id === "projects"}<FolderSimpleIcon size={iconSize} aria-hidden="true" />
  {:else if id === "companies"}<BuildingsIcon size={iconSize} aria-hidden="true" />
  {:else if id === "team"}<UsersIcon size={iconSize} aria-hidden="true" />
  {:else if id === "admin"}<ShieldIcon size={iconSize} aria-hidden="true" />
  {:else if id === "alerts"}<WarningIcon size={iconSize} aria-hidden="true" />
  {:else if id === "requests"}<LightbulbIcon size={iconSize} aria-hidden="true" />
  {:else if id === "changelog"}<MegaphoneIcon size={iconSize} aria-hidden="true" />
  {:else}<GearSixIcon size={iconSize} aria-hidden="true" />{/if}
{/snippet}

{#snippet expandedRow(item: RailItem)}
  {@const isSelected = selected === item.id}
  {@const disabled = item.id === "home" && !myWorkAvailable}
  <a
    {...itemAttrs(item)}
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
    <span class="min-w-0 flex-1 translate-y-[0.5px] truncate">{item.label}</span>
    {#if item.badge}
      <span
        data-rail-badge={item.badge.tone}
        class={`flex h-[18px] min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-[10px] font-medium leading-3 text-white ${item.badge.tone === "danger" ? "bg-danger" : "bg-primary-selected"}`}
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
    class={`${rowBase} ${onAdminPage ? "text-ink hover:bg-workspace-rail-hover" : idleRow}`}
  >
    {@render itemIcon("admin")}
    <span class="min-w-0 flex-1 translate-y-[0.5px] truncate">{item.label}</span>
    {#if item.attention}
      <span data-rail-attention aria-label="Needs a look" class="size-1.5 shrink-0 rounded-full bg-stale-dot"></span>
    {/if}
    <CaretDownIcon
      size={14}
      aria-hidden="true"
      data-admin-chevron={adminOpen ? "up" : "down"}
      class={`shrink-0 text-ink-muted transition-transform duration-300 motion-reduce:transition-none ${adminOpen ? "rotate-180" : "rotate-0"}`}
    />
  </button>
  {#if adminOpen}
    <div id="workspace-admin-links" data-rail-admin-links class="relative flex flex-col">
      <span aria-hidden="true" class="absolute bottom-1 left-[15px] top-1 w-px bg-line"></span>
      {#each ADMIN_RAIL_ROUTES as route (route.href)}
        {@const href = resolve(route.href as "/")}
        {@const current = pathname === href || pathname.startsWith(`${href}/`)}
        <a
          {href}
          data-admin-link={route.href}
          aria-current={current ? "page" : undefined}
          onclick={() => onNavigate?.()}
          class={`${variant === "rail" ? "h-7" : "min-h-11"} workspace-rail-row flex items-center gap-2 rounded-md pl-[31px] pr-2 text-[13px] leading-[19px] transition-colors duration-150 ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir motion-reduce:transition-none ${current ? selectedRow : idleRow}`}
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

{#snippet collapsedRow(item: RailItem)}
  {@const isSelected = selected === item.id}
  {@const disabled = item.id === "home" && !myWorkAvailable}
  <Tooltip text={item.label} side="right" delayDuration={300}>
    {#snippet children({ props })}
      <a
        {...props}
        {...itemAttrs(item)}
        href={item.href}
        aria-label={item.badge && item.id === "alerts" ? `${item.label}, ${item.badge.count} open` : item.label}
        aria-current={isSelected ? "page" : undefined}
        aria-disabled={disabled ? "true" : undefined}
        onclick={(event) => {
          if (disabled) {
            event.preventDefault();
            return;
          }
          onNavigate?.();
        }}
        class={`${iconRow} ${isSelected ? selectedRow : idleRow}`}
      >
        {@render itemIcon(item.id)}
        {#if item.id === "changelog" && item.badge}
          <!-- A4: What's new shows a 7px dot here, not a count. -->
          <span data-rail-dot aria-hidden="true" class="absolute right-1.5 top-1.5 size-[7px] rounded-full border-[1.5px] border-gray-50 bg-primary-selected"></span>
        {:else if item.badge}
          <span
            data-rail-badge={item.badge.tone}
            aria-hidden="true"
            class="absolute right-px top-px flex h-4 min-w-4 items-center justify-center rounded-full border-[1.5px] border-gray-50 bg-danger px-1 text-[9px] font-medium leading-none text-white"
          >{badgeLabel(item.badge.count)}</span>
        {/if}
      </a>
    {/snippet}
  </Tooltip>
{/snippet}

{#snippet collapsedAdmin(item: RailItem)}
  <AdminFlyout attentionTotal={attention.total} ingestionFailed={attention.ingestionFailed} {onNavigate}>
    {#snippet trigger({ props })}
      <button
        {...props}
        type="button"
        data-rail-item="admin"
        aria-label={item.attention ? "Admin, needs a look" : "Admin"}
        class={`${iconRow} ${onAdminPage ? selectedRow : idleRow}`}
      >
        {@render itemIcon("admin")}
        {#if item.attention}
          <span data-rail-attention aria-hidden="true" class="absolute right-1.5 top-1.5 size-[7px] rounded-full border-[1.5px] border-gray-50 bg-stale-dot"></span>
        {/if}
      </button>
    {/snippet}
  </AdminFlyout>
{/snippet}

{#snippet identity()}
  <IdentityMenu
    name={userName}
    email={user?.email ?? null}
    imageUrl={user?.imageUrl ?? null}
    seed={user?._id}
    isDeveloper={user?.isDeveloper === true}
    placement={collapsed ? "right" : "above"}
    layer={variant === "drawer" ? "drawer" : "app"}
    {onNavigate}
  >
    {#snippet trigger({ props, open })}
      {#if collapsed}
        <button
          {...props}
          type="button"
          data-rail-identity
          aria-label={`${userName}, account menu`}
          class="flex size-9 items-center justify-center rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir"
        >
          <Avatar name={userName} imageUrl={user?.imageUrl ?? null} seed={user?._id} size={30} />
        </button>
      {:else}
        <button
          {...props}
          type="button"
          data-rail-identity
          aria-label={`${userName}, account menu`}
          class={`flex w-full items-center gap-2 rounded-md px-1.5 text-left transition-colors hover:bg-workspace-rail-hover focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-fir motion-reduce:transition-none ${variant === "rail" ? "h-11" : "min-h-12"} ${open ? "bg-workspace-rail-hover" : ""}`}
        >
          <Avatar name={userName} imageUrl={user?.imageUrl ?? null} seed={user?._id} size={24} />
          <span class="flex min-w-0 flex-1 flex-col">
            <span class="truncate text-xs font-medium leading-4 text-ink">{userName}</span>
            {#if identityChip}
              <span class="flex pt-0.5">
                <RoleChip
                  kind={identityChip}
                  size="sm"
                  label={viewer.viewing ? `Viewing as ${VIEW_AS_LABELS[viewer.viewing]}` : undefined}
                />
              </span>
            {/if}
          </span>
        </button>
      {/if}
    {/snippet}
  </IdentityMenu>
{/snippet}

<nav
  aria-label="Workspace"
  data-rail-collapsed={collapsed ? "" : undefined}
  class={`flex h-full min-h-0 flex-col bg-workspace-shell text-ink ${variant === "drawer" ? "pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-[env(safe-area-inset-top)]" : "pb-2.5"}`}
>
  {#if collapsed}
    <div class="flex min-h-0 flex-1 flex-col items-center gap-0.5">
      <a
        href={myWorkHref}
        aria-label="Banhall home"
        onclick={onNavigate}
        class="mb-1.5 mt-3.5 flex h-7 items-center rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fir"
      >
        <BanhallRailMark collapsed />
      </a>
      {#if onToggleRail}
        <Tooltip text="Expand the rail" hint={collapseHint} side="right" delayDuration={300}>
          {#snippet children({ props })}
            <button
              {...props}
              type="button"
              data-rail-toggle
              data-rail-direction="expand"
              aria-controls="workspace-rail"
              aria-label="Expand navigation rail"
              aria-expanded="false"
              onclick={onToggleRail}
              class={`group ${iconRow} ${idleRow}`}
            >
              <AnimatedSidebarToggleIcon direction="expand" />
            </button>
          {/snippet}
        </Tooltip>
      {/if}
      <Tooltip text="Search" hint={searchHint} side="right" delayDuration={300}>
        {#snippet children({ props })}
          <button
            {...props}
            type="button"
            data-rail-search
            aria-label="Search projects"
            onclick={onFocusSearch}
            class={`${iconRow} ${idleRow}`}
          >
            <MagnifyingGlassIcon size={17} aria-hidden="true" />
          </button>
        {/snippet}
      </Tooltip>
      <div data-rail-scroll class="scrollbar-hidden flex min-h-0 w-full flex-1 flex-col items-center gap-0.5 overflow-y-auto overscroll-contain">
        {#each topGroups as group (group.id)}
          <span aria-hidden="true" class="my-1.5 h-px w-6 shrink-0 bg-line"></span>
          {#each group.items as item (item.id)}
            {#if item.id === "admin"}
              {@render collapsedAdmin(item)}
            {:else}
              {@render collapsedRow(item)}
            {/if}
          {/each}
        {/each}
        <div class="min-h-4 flex-1" aria-hidden="true"></div>
        {#each bottomGroups as group, index (group.id)}
          {#if index > 0}<span aria-hidden="true" class="my-1.5 h-px w-6 shrink-0 bg-line"></span>{/if}
          {#each group.items as item (item.id)}
            {@render collapsedRow(item)}
          {/each}
        {/each}
      </div>
      <span aria-hidden="true" class="mt-1.5 h-px w-10 shrink-0 bg-line-soft"></span>
      <div class="flex flex-col items-center pb-2 pt-2.5">
        {@render identity()}
      </div>
    </div>
  {:else}
    <div data-rail-drawer-header class="shrink-0 bg-workspace-shell">
      <div class={`flex h-14 items-center gap-2 pl-3 ${variant === "drawer" ? "pr-14" : "pr-3"}`}>
        <a
          href={myWorkHref}
          aria-label="Banhall home"
          onclick={onNavigate}
          class="flex min-w-0 items-center rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fir"
        >
          <BanhallRailMark />
        </a>
        <div class="flex-1"></div>
        {#if variant === "rail" && onToggleRail}
          <Tooltip text="Collapse the rail" hint={collapseHint} side="bottom" delayDuration={300}>
            {#snippet children({ props })}
              <button
                {...props}
                type="button"
                data-rail-toggle
                data-rail-direction="collapse"
                aria-controls="workspace-rail"
                aria-label="Collapse navigation rail"
                aria-expanded="true"
                onclick={onToggleRail}
                class="group flex size-6 shrink-0 items-center justify-center rounded-[5px] p-0 text-ink-muted transition-colors hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir"
              >
                <AnimatedSidebarToggleIcon direction="collapse" />
              </button>
            {/snippet}
          </Tooltip>
        {/if}
      </div>
    </div>

    <div data-rail-scroll class="scrollbar-hidden flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-2">
      {#snippet groupBlock(group: (typeof groups)[number], first: boolean)}
        <div data-rail-group={group.id} class="flex flex-col">
          <!-- Secondary ink: muted fails AA at 11px on the rail (review f2). -->
          <p class={`px-2 pb-1 text-[11px] leading-4 text-ink-secondary ${first ? "pt-1.5" : "pt-4"}`}>{group.label}</p>
          {#each group.items as item (item.id)}
            {#if item.id === "admin"}
              {@render adminGroup(item)}
            {:else}
              {@render expandedRow(item)}
            {/if}
          {/each}
        </div>
      {/snippet}
      {#each topGroups as group, index (group.id)}
        {@render groupBlock(group, index === 0)}
      {/each}
      <div class="min-h-4 flex-1" aria-hidden="true"></div>
      {#each bottomGroups as group (group.id)}
        {@render groupBlock(group, false)}
      {/each}
    </div>

    <div class="shrink-0 px-2">
      <div class="border-t border-line-soft">
        {@render identity()}
      </div>
    </div>
  {/if}
</nav>

<style>
  /* Responsive drawers can also be opened from a narrow desktop window.
     Match the persistent rail's compact cadence there, while real touch
     devices retain the 44px targets supplied by the base drawer classes. */
  @media (pointer: fine) {
    :global([data-workspace-drawer] .workspace-rail-row) {
      height: 2rem;
      min-height: 2rem;
    }
  }
</style>
