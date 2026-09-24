<script lang="ts">
  import { untrack } from "svelte";
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { page } from "$app/state";
  import { useQuery } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import {
    ArrowSquareOutIcon,
    BellIcon,
    BrainIcon,
    CaretDownIcon,
    ChartBarIcon,
    ClipboardTextIcon,
    CloudArrowDownIcon,
    FlagIcon,
    FolderSimpleIcon,
    GearSixIcon,
    HouseIcon,
    LightbulbIcon,
    MagnifyingGlassIcon,
    MegaphoneIcon,
    SlidersHorizontalIcon,
    TagIcon,
    UserGearIcon,
  } from "phosphor-svelte";
  import { api } from "../../../../convex/_generated/api";
  import { ROLE_LABELS } from "../../../../shared/roles";
  import AnimatedSidebarToggleIcon from "$lib/components/workspace/AnimatedSidebarToggleIcon.svelte";
  import { displayName } from "$lib/displayName";
  import Tooltip from "$lib/components/ui/Tooltip.svelte";
  import UserMenu from "$lib/components/ui/UserMenu.svelte";
  import type { DashboardView } from "$lib/dashboard/viewMode";

  let {
    variant = "rail",
    collapsed: collapsedProp = false,
    displayedView,
    myWorkAvailable,
    myWorkHref,
    projectsHref,
    currentDashboardHref,
    currentExperienceLabel = "Current dashboard",
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
    currentDashboardHref: string;
    currentExperienceLabel?: string;
    onFocusSearch: () => void;
    onNavigate?: () => void;
    onToggleRail?: (() => void) | null;
  } = $props();

  // Only the desktop rail collapses; the drawer always renders expanded.
  const collapsed = $derived(variant === "rail" && collapsedProp);
  const auth = useAuth();
  const userQ = useQuery(api.users.getCurrentUser, () => (auth.isAuthenticated ? {} : "skip"));
  const isDeveloper = $derived(userQ.data?.isDeveloper === true);
  // Workspace Owner exposure (2026-08-19): reveals admin navigation like
  // isDeveloper does. Distinct from a project's Owner.
  const isOwner = $derived(userQ.data?.isOwner === true);
  const openAlertsQ = useQuery(api.errorReports.openCount, () =>
    auth.isAuthenticated && isDeveloper ? {} : "skip"
  );
  const unseenChangelogQ = useQuery(api.changelog.unseenCount, () =>
    auth.isAuthenticated ? {} : "skip"
  );
  const openAlerts = $derived(openAlertsQ.data ?? 0);
  const unseenChangelog = $derived(unseenChangelogQ.data ?? 0);
  const user = $derived(userQ.data);
  const userName = $derived(displayName(user, "Account"));
  const userRole = $derived(
    user?.isDeveloper
      ? "Developer"
      : user?.isOwner
        ? "Owner"
        : user?.role
          ? ROLE_LABELS[user.role]
          : "Workspace member"
  );
  const userInitials = $derived.by(() => {
    if (user?.firstName || user?.lastName) {
      return (((user.firstName?.[0] ?? "") + (user.lastName?.[0] ?? "")).toUpperCase() || "?");
    }
    const name = user?.name?.trim();
    if (name) {
      const parts = name.split(/\s+/);
      return (((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?");
    }
    return user?.email?.[0]?.toUpperCase() ?? "?";
  });
  const pathname = $derived(page.url.pathname);
  // The desktop rail keeps the records visible as part of the information
  // architecture. The touch drawer starts compact so short viewports reach
  // primary and utility navigation without opening into an overfull column.
  let adminOpen = $state(untrack(() => variant === "rail"));

  // Attio-density: 28px rows on desktop, 44px minimum in the touch drawer.
  // A drawer opened in a narrow desktop window returns to the compact rail
  // rhythm through the fine-pointer media rule below.
  // Labels carry translate-y-[0.5px]: Geist caps sit ~0.5px above the
  // 16px Phosphor glyphs when both are flex-centred, which reads as text
  // floating high. Measured at 1x and 2x DPR (2026-08-22).
  const rowHeight = $derived(variant === "rail" ? "h-7" : "min-h-11");
  const rowBase = $derived(
    `${rowHeight} workspace-rail-row flex w-full items-center gap-2 rounded-md pl-2 pr-1 [&>svg]:shrink-0 text-left text-sm font-normal leading-5 tracking-[-0.01em] transition-colors duration-150 ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir motion-reduce:transition-none`
  );
  // Collapsed rail (board 1.2): 32px icon tiles with a tooltip each.
  const iconRow =
    "workspace-rail-row relative flex h-8 w-8 items-center justify-center rounded-md transition-colors duration-150 ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir motion-reduce:transition-none";
  const idleRow = "text-ink hover:bg-workspace-rail-hover";
  const selectedRow = "bg-workspace-rail-selected font-medium text-ink";

  const ADMIN_LINKS = [
    { href: "/admin/brain", label: "The Brain", icon: "brain", tone: "bg-blue-500" },
    { href: "/admin/ingestion", label: "OneDrive ingestion", icon: "ingestion", tone: "bg-cyan-500" },
    { href: "/admin/tags", label: "Project tags", icon: "tag", tone: "bg-orange-500" },
    { href: "/admin/learning", label: "Learning health", icon: "usage", tone: "bg-primary-dark" },
    { href: "/admin/reviews", label: "QA reviews", icon: "reviews", tone: "bg-teal-500" },
    { href: "/admin/users", label: "Users & roles", icon: "users", tone: "bg-sky-500" },
    { href: "/admin/house-rules", label: "House rules", icon: "reviews", tone: "bg-rose-500" },
    { href: "/admin/models", label: "Model preferences", icon: "models", tone: "bg-violet-500" },
    { href: "/admin/usage", label: "AI usage & cost", icon: "usage", tone: "bg-emerald-500" },
  ] as const;
</script>

<!--
  Workspace rail (ui-design-final.md section 2): the Banhall workspace header,
  Home and Projects, the Admin records group for workspace admins, an
  "Other" group (What's new with its counter, Settings, Flag issue, and the
  developer utilities for flagged accounts), and the signed-in identity at
  the bottom with sign-out beside it. Collapsed, the desktop rail keeps only
  the icons (board 1.2). Search opens the shell command palette (also on
  Cmd K); New project lives on Home, the Projects header and the palette.
-->
{#snippet row(opts: { href?: string; label: string; selected?: boolean; onclick?: (event: MouseEvent) => void; disabled?: boolean; attrs?: Record<string, unknown>; badge?: string | null; badgeTone?: string }, icon: import("svelte").Snippet)}
  {#if collapsed}
    <Tooltip text={opts.label} side="right" delayDuration={300}>
      {#snippet children({ props })}
        {#if opts.href}
          <a
            {...props}
            {...opts.attrs}
            href={opts.href}
            aria-label={opts.label}
            aria-current={opts.selected ? "page" : undefined}
            aria-disabled={opts.disabled ? "true" : undefined}
            onclick={opts.onclick}
            class={`${iconRow} ${opts.selected ? selectedRow : idleRow}`}
          >
            {@render icon()}
            {#if opts.badge}
              <span class={`absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full px-0.5 text-[0.5625rem] font-medium leading-none text-white ${opts.badgeTone ?? "bg-primary"}`}>{opts.badge}</span>
            {/if}
          </a>
        {:else}
          <button
            {...props}
            {...opts.attrs}
            type="button"
            aria-label={opts.label}
            onclick={opts.onclick}
            class={`${iconRow} ${idleRow}`}
          >
            {@render icon()}
          </button>
        {/if}
      {/snippet}
    </Tooltip>
  {:else if opts.href}
    <a
      {...opts.attrs}
      href={opts.href}
      aria-current={opts.selected ? "page" : undefined}
      aria-disabled={opts.disabled ? "true" : undefined}
      onclick={opts.onclick}
      class={`${rowBase} ${opts.selected ? selectedRow : idleRow}`}
    >
      {@render icon()}
      <span class="min-w-0 translate-y-[0.5px] truncate">{opts.label}</span>
      {#if opts.badge}
        <span class={`ml-auto flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full px-1 text-[0.625rem] font-medium leading-none text-white ${opts.badgeTone ?? "bg-primary"}`}>{opts.badge}</span>
      {/if}
    </a>
  {:else}
    <button {...opts.attrs} type="button" onclick={opts.onclick} class={`${rowBase} ${idleRow}`}>
      {@render icon()}
      <span class="min-w-0 translate-y-[0.5px] truncate">{opts.label}</span>
    </button>
  {/if}
{/snippet}

{#snippet houseIcon()}<HouseIcon size={16} weight="regular" aria-hidden="true" />{/snippet}
{#snippet folderIcon()}<FolderSimpleIcon size={16} weight="regular" aria-hidden="true" />{/snippet}
{#snippet megaphoneIcon()}<MegaphoneIcon size={16} weight="regular" aria-hidden="true" />{/snippet}
{#snippet gearIcon()}<GearSixIcon size={16} weight="regular" aria-hidden="true" />{/snippet}
{#snippet flagIcon()}<FlagIcon size={16} weight="regular" aria-hidden="true" />{/snippet}
{#snippet bellIcon()}<BellIcon size={16} weight="regular" aria-hidden="true" />{/snippet}
{#snippet bulbIcon()}<LightbulbIcon size={16} weight="regular" aria-hidden="true" />{/snippet}
{#snippet escapeIcon()}<ArrowSquareOutIcon size={16} weight="regular" aria-hidden="true" />{/snippet}

<nav
  aria-label="Workspace"
  data-collapsed-compat={collapsed ? "" : undefined}
  data-rail-collapsed={collapsed ? "" : undefined}
  class={`flex h-full min-h-0 flex-col bg-workspace-rail text-ink ${variant === "drawer" ? "pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-[env(safe-area-inset-top)]" : "pb-2"}`}
>
  <div class="flex min-h-0 flex-1 flex-col">
    <div data-rail-drawer-header class="shrink-0 bg-workspace-rail">
      <div class={`flex h-14 items-center ${collapsed ? "justify-center px-0" : `gap-1 pl-3 ${variant === "drawer" ? "pr-14" : "pr-[13px]"}`}`}>
        <a
          href={resolve("/dashboard")}
          aria-label="Banhall dashboard"
          onclick={onNavigate}
          class="flex min-w-0 flex-1 items-center gap-2 rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fir"
          class:flex-none={collapsed}
        >
          <span data-rail-workspace-mark class="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] bg-fir text-[0.75rem] font-medium text-white" aria-hidden="true">B</span>
          {#if !collapsed}
            <span class="min-w-0 flex-1 truncate text-sm font-medium text-ink">Banhall</span>
          {/if}
        </a>
        {#if !collapsed}
          <Tooltip text="Search" side="bottom" delayDuration={300}>
            {#snippet children({ props })}
              <button
                {...props}
                type="button"
                aria-label="Search projects"
                onclick={onFocusSearch}
                class="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-muted transition-colors hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir"
              >
                <MagnifyingGlassIcon size={15} weight="regular" aria-hidden="true" />
              </button>
            {/snippet}
          </Tooltip>
        {/if}
        {#if variant === "rail" && onToggleRail && !collapsed}
          <Tooltip text="Collapse sidebar" side="bottom" delayDuration={300}>
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
                class="group flex h-6 w-6 shrink-0 items-center justify-center p-0 text-ink-muted transition-colors hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir"
              >
                <AnimatedSidebarToggleIcon direction="collapse" />
              </button>
            {/snippet}
          </Tooltip>
        {/if}
      </div>
    </div>

    <div data-rail-scroll class="scrollbar-hidden flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
      {#if !collapsed}
        <p class="px-4 pb-1 pt-1 text-xs text-ink-muted">Workspace</p>
      {/if}
      <div class={`flex flex-col gap-1 ${collapsed ? "items-center px-0" : "px-2"}`}>
        {@render row({
          href: myWorkHref,
          label: "Home",
          selected: displayedView === "my_work",
          disabled: !myWorkAvailable,
          onclick: (event) => {
            if (!myWorkAvailable) {
              event.preventDefault();
              return;
            }
            onNavigate?.();
          },
        }, houseIcon)}
        {@render row({ href: projectsHref, label: "Projects", selected: displayedView === "all_projects", onclick: () => onNavigate?.() }, folderIcon)}
      </div>

      {#if userQ.data?.role === "admin" && (isDeveloper || isOwner) && !collapsed}
        <div data-rail-admin class="mt-5 flex flex-col gap-[3px] px-2">
          <button
            type="button"
            data-admin-group-toggle
            aria-expanded={adminOpen}
            aria-controls="workspace-admin-links"
            onclick={() => (adminOpen = !adminOpen)}
            class={`${rowBase} ${pathname.startsWith(resolve("/admin")) ? "text-ink" : idleRow}`}
          >
            <CaretDownIcon
              size={12}
              weight="bold"
              aria-hidden="true"
              class={`ml-0.5 shrink-0 text-ink-muted transition-transform duration-300 ${adminOpen ? "rotate-0" : "-rotate-90"}`}
            />
            <span class="text-xs font-medium leading-4 text-ink-muted">Admin</span>
          </button>
          {#if adminOpen}
            <div id="workspace-admin-links" class="flex flex-col gap-1">
              {#each ADMIN_LINKS as link (link.href)}
                <a
                  href={resolve(link.href)}
                  onclick={onNavigate}
                  class={`${rowBase} ${pathname.startsWith(resolve(link.href)) ? selectedRow : idleRow}`}
                  aria-current={pathname.startsWith(resolve(link.href)) ? "page" : undefined}
                >
                  <span
                    data-admin-icon-tone={link.icon}
                    class={`flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] text-white ${link.tone}`}
                  >
                    {#if link.icon === "brain"}<BrainIcon size={12} weight="bold" aria-hidden="true" />
                    {:else if link.icon === "ingestion"}<CloudArrowDownIcon size={12} weight="bold" aria-hidden="true" />
                    {:else if link.icon === "tag"}<TagIcon size={12} weight="bold" aria-hidden="true" />
                    {:else if link.icon === "reviews"}<ClipboardTextIcon size={12} weight="bold" aria-hidden="true" />
                    {:else if link.icon === "users"}<UserGearIcon size={12} weight="bold" aria-hidden="true" />
                    {:else if link.icon === "models"}<SlidersHorizontalIcon size={12} weight="bold" aria-hidden="true" />
                    {:else}<ChartBarIcon size={12} weight="bold" aria-hidden="true" />{/if}
                  </span>
                  <span class="min-w-0 translate-y-[0.5px] truncate">{link.label}</span>
                </a>
              {/each}
            </div>
          {/if}
        </div>
      {/if}

      {#if collapsed}
        <div class="min-h-4 flex-1" aria-hidden="true"></div>
      {/if}

      <div data-rail-utilities class={collapsed ? "mb-1 flex flex-col items-center gap-1" : "mt-5 px-2"}>
        {#if !collapsed}
          <p class="px-2 pb-1 text-xs text-ink-muted">Other</p>
        {/if}
        <div class={`flex flex-col gap-1 ${collapsed ? "items-center" : ""}`}>
          {@render row({
            href: resolve("/changelog"),
            label: "What's new",
            selected: pathname.startsWith(resolve("/changelog")),
            onclick: () => onNavigate?.(),
            badge: unseenChangelog > 0 ? (unseenChangelog > 99 ? "99+" : String(unseenChangelog)) : null,
          }, megaphoneIcon)}
          {@render row({
            href: resolve("/settings"),
            label: "Settings",
            selected: pathname.startsWith(resolve("/settings")),
            onclick: () => onNavigate?.(),
          }, gearIcon)}
          <!-- Flag issue is for every user (2026-08-19): bug reports and
               feature requests come from the whole team, not just devs. -->
          {@render row({
            label: "Flag issue",
            attrs: { "data-rail-flag-issue": "" },
            onclick: () => {
              onNavigate?.();
              window.dispatchEvent(new CustomEvent("banhall:flag-issue"));
            },
          }, flagIcon)}
          {#if isDeveloper}
            {@render row({
              href: resolve("/alerts"),
              label: "Alerts",
              selected: pathname.startsWith(resolve("/alerts")),
              onclick: () => onNavigate?.(),
              badge: openAlerts > 0 ? (openAlerts > 99 ? "99+" : String(openAlerts)) : null,
              badgeTone: "bg-red-500",
            }, bellIcon)}
            {@render row({
              href: resolve("/requests"),
              label: "Feature requests",
              selected: pathname.startsWith(resolve("/requests")),
              onclick: () => onNavigate?.(),
            }, bulbIcon)}
            {@render row({
              label: currentExperienceLabel,
              attrs: { "data-workspace-escape": "" },
              onclick: () => {
                onNavigate?.();
                goto(currentDashboardHref);
              },
            }, escapeIcon)}
          {/if}
        </div>
      </div>

      {#if !collapsed}
        <div class="min-h-4 flex-1" aria-hidden="true"></div>
      {/if}
    </div>
  </div>

  <div class={`border-t border-workspace-rail-line pt-2 ${collapsed ? "px-0" : "px-2"}`}>
    <!-- Identity at the bottom: who is signed in, with sign-out beside it. -->
    <div
      data-rail-account-actions
      data-rail-identity
      class={`flex items-center rounded-md ${collapsed ? "flex-col gap-1" : "gap-2 pl-1.5"}`}
    >
      <span
        aria-hidden={collapsed ? undefined : "true"}
        title={collapsed ? `${userName}, ${userRole}` : undefined}
        class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-fir text-[0.6875rem] font-medium text-white"
      >{userInitials}</span>
      {#if !collapsed}
        <span class="min-w-0 flex-1">
          <span class="block truncate text-sm font-medium leading-4 text-ink">{userName}</span>
          <span class="block truncate text-[0.6875rem] leading-4 text-ink-muted">{userRole}, Banhall</span>
        </span>
      {/if}
      <UserMenu
        tone="light"
        menuTheme="light"
        menuLayer={variant === "drawer" ? "drawer" : "app"}
        triggerVariant="rail"
      />
    </div>
  </div>
</nav>

<style>
  /* Responsive drawers can also be opened from a narrow desktop window.
     Match the persistent rail's compact cadence there, while real touch
     devices retain the 44px targets supplied by the base drawer classes. */
  @media (pointer: fine) {
    :global([data-workspace-drawer] .workspace-rail-row) {
      height: 1.75rem;
      min-height: 1.75rem;
    }
  }
</style>
