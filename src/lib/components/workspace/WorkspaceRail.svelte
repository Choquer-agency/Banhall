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
    PlusIcon,
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
    collapsed = false,
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
    /** Kept for shell API compatibility; desktop collapse removes the rail. */
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
    `${rowHeight} workspace-rail-row flex w-full items-center gap-2 rounded-md pl-2 pr-1 [&>svg]:shrink-0 text-left text-sm font-medium leading-5 tracking-[-0.01em] transition-colors duration-150 ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir motion-reduce:transition-none`
  );
  const idleRow = "text-ink hover:bg-workspace-rail-hover";
  const selectedRow = "bg-workspace-rail-selected font-semibold text-ink";

  const ADMIN_LINKS = [
    { href: "/admin/brain", label: "The Brain", icon: "brain", tone: "bg-blue-500" },
    { href: "/admin/ingestion", label: "OneDrive ingestion", icon: "ingestion", tone: "bg-cyan-500" },
    { href: "/admin/tags", label: "Project tags", icon: "tag", tone: "bg-orange-500" },
    { href: "/admin/reviews", label: "QA reviews", icon: "reviews", tone: "bg-teal-500" },
    { href: "/admin/users", label: "Users & roles", icon: "users", tone: "bg-sky-500" },
    { href: "/admin/house-rules", label: "House rules", icon: "reviews", tone: "bg-rose-500" },
    { href: "/admin/models", label: "Model preferences", icon: "models", tone: "bg-violet-500" },
    { href: "/admin/usage", label: "AI usage & cost", icon: "usage", tone: "bg-emerald-500" },
  ] as const;
</script>

<nav
  aria-label="Workspace"
  data-collapsed-compat={collapsed ? "" : undefined}
  class={`flex h-full min-h-0 flex-col bg-workspace-rail text-ink ${variant === "drawer" ? "pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-[env(safe-area-inset-top)]" : "pb-2"}`}
>
  <div class="flex min-h-0 flex-1 flex-col">
    <div data-rail-drawer-header class="shrink-0 bg-workspace-rail">
      <div class={`flex h-12 items-center pl-3 ${variant === "drawer" ? "pr-14" : "pr-[13px]"}`}>
        <a
          href={resolve("/dashboard")}
          aria-label={`${userName} dashboard`}
          onclick={onNavigate}
          class="flex min-w-0 flex-1 items-center gap-2 rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fir"
        >
          <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-[5px] bg-fir text-[0.6875rem] font-semibold text-white" aria-hidden="true">{userInitials}</span>
          <span class="min-w-0 flex-1">
            <span class="block truncate text-sm font-medium leading-4 text-ink">{userName}</span>
            <span class="block truncate text-[0.6875rem] leading-4 text-ink-muted">{userRole}</span>
          </span>
        </a>
        {#if variant === "rail" && onToggleRail}
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

      <div class={`flex items-center gap-2 pb-0 pl-3 pr-[13px] ${variant === "drawer" ? "mb-2 pt-1.5" : "mb-3 pt-2.5"}`}>
        <button
          type="button"
          aria-label="Search projects"
          onclick={onFocusSearch}
          class={`${variant === "rail" ? "h-7" : "min-h-11"} workspace-rail-control flex min-w-0 flex-1 items-center gap-1.5 rounded-md bg-workspace-control pl-1.5 pr-1 text-sm font-medium text-ink transition-colors hover:bg-workspace-rail-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir motion-reduce:transition-none`}
        >
          <MagnifyingGlassIcon size={16} weight="regular" aria-hidden="true" />
          <span>Search</span>
          <kbd class="ml-auto rounded-sm px-1.5 text-xs font-medium text-ink-faint">⌘K</kbd>
        </button>
        <Tooltip text="New project" side="bottom" delayDuration={300}>
          {#snippet children({ props })}
            <a
              {...props}
              href={resolve("/project/new")}
              aria-label="New project"
              onclick={onNavigate}
              class={`${variant === "rail" ? "h-7 w-7" : "h-11 w-11"} flex shrink-0 items-center justify-center rounded-md bg-action-primary text-action-primary-foreground transition-colors hover:bg-action-primary-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir motion-reduce:transition-none`}
            >
              <PlusIcon size={16} weight="regular" aria-hidden="true" />
            </a>
          {/snippet}
        </Tooltip>
      </div>
    </div>

    <div data-rail-scroll class="scrollbar-hidden flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
      <div class="flex flex-col gap-px px-2">
        <a
          href={myWorkHref}
          class={`${rowBase} ${displayedView === "my_work" ? selectedRow : idleRow}`}
          aria-current={displayedView === "my_work" ? "page" : undefined}
          aria-disabled={!myWorkAvailable}
          onclick={(event) => {
            if (!myWorkAvailable) {
              event.preventDefault();
              return;
            }
            onNavigate?.();
          }}
        >
          <HouseIcon size={16} weight="regular" aria-hidden="true" />
          <span class="min-w-0 translate-y-[0.5px] truncate">Home</span>
        </a>

        <a
          href={projectsHref}
          class={`${rowBase} ${displayedView === "all_projects" ? selectedRow : idleRow}`}
          aria-current={displayedView === "all_projects" ? "page" : undefined}
          onclick={onNavigate}
        >
          <FolderSimpleIcon size={16} weight="regular" aria-hidden="true" />
          <span class="min-w-0 translate-y-[0.5px] truncate">Projects</span>
        </a>
      </div>

      {#if userQ.data?.role === "admin" && (isDeveloper || isOwner)}
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

      <div class="min-h-4 flex-1" aria-hidden="true"></div>

      <div data-rail-utilities class="mb-1 border-t border-workspace-rail-line px-2 pt-2">
        <div class="flex flex-col gap-px">
          {#if isDeveloper}
            <a
              href={resolve("/alerts")}
              onclick={onNavigate}
              class={`${rowBase} ${pathname.startsWith(resolve("/alerts")) ? selectedRow : idleRow}`}
              aria-current={pathname.startsWith(resolve("/alerts")) ? "page" : undefined}
            >
              <BellIcon size={16} weight="regular" aria-hidden="true" />
              <span class="min-w-0 translate-y-[0.5px] truncate">Alerts</span>
              {#if openAlerts > 0}
                <span class="ml-auto flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-red-500 px-1 text-[0.625rem] font-semibold leading-none text-white">{openAlerts > 99 ? "99+" : openAlerts}</span>
              {/if}
            </a>
            <a
              href={resolve("/requests")}
              onclick={onNavigate}
              class={`${rowBase} ${pathname.startsWith(resolve("/requests")) ? selectedRow : idleRow}`}
              aria-current={pathname.startsWith(resolve("/requests")) ? "page" : undefined}
            >
              <LightbulbIcon size={16} weight="regular" aria-hidden="true" />
              <span class="min-w-0 translate-y-[0.5px] truncate">Feature requests</span>
            </a>
          {/if}
          <a
            href={resolve("/changelog")}
            onclick={onNavigate}
            class={`${rowBase} ${pathname.startsWith(resolve("/changelog")) ? selectedRow : idleRow}`}
            aria-current={pathname.startsWith(resolve("/changelog")) ? "page" : undefined}
          >
            <MegaphoneIcon size={16} weight="regular" aria-hidden="true" />
            <span class="min-w-0 translate-y-[0.5px] truncate">What's new</span>
            {#if unseenChangelog > 0}
              <span class="ml-auto flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-primary px-1 text-[0.625rem] font-semibold leading-none text-white">{unseenChangelog > 99 ? "99+" : unseenChangelog}</span>
            {/if}
          </a>
          <!-- Flag issue is for every user (2026-08-19): bug reports and
               feature requests come from the whole team, not just devs. -->
          <button
            type="button"
            data-rail-flag-issue
            onclick={() => {
              onNavigate?.();
              window.dispatchEvent(new CustomEvent("banhall:flag-issue"));
            }}
            class={`${rowBase} ${idleRow}`}
          >
            <FlagIcon size={16} weight="regular" aria-hidden="true" />
            <span class="min-w-0 translate-y-[0.5px] truncate">Flag issue</span>
          </button>
          {#if isDeveloper}
            <button
              type="button"
              data-workspace-escape
              onclick={() => {
                onNavigate?.();
                goto(currentDashboardHref);
              }}
              class={`${rowBase} ${idleRow}`}
            >
              <ArrowSquareOutIcon size={16} weight="regular" aria-hidden="true" />
              <span class="min-w-0 translate-y-[0.5px] truncate">{currentExperienceLabel}</span>
            </button>
          {/if}
        </div>
      </div>
    </div>
  </div>

  <div class="border-t border-workspace-rail-line px-2 pt-2">
    <!-- One composite footer surface: Settings owns the active state while
         sign-out remains an adjacent action inside the same visual group. -->
    <div
      data-rail-account-actions
      class={`flex items-center rounded-md transition-colors duration-150 ease-out motion-reduce:transition-none ${pathname.startsWith(resolve("/settings")) ? "bg-workspace-rail-selected" : "hover:bg-workspace-rail-hover"}`}
    >
      <a
        href={resolve("/settings")}
        aria-current={pathname.startsWith(resolve("/settings")) ? "page" : undefined}
        onclick={onNavigate}
        class={`flex min-w-0 flex-1 items-center gap-2 rounded-l-md px-2 text-left text-sm font-medium text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir ${variant === "rail" ? "h-9" : "h-11"} ${pathname.startsWith(resolve("/settings")) ? "font-semibold" : ""}`}
      >
        <GearSixIcon size={16} weight="regular" aria-hidden="true" class="shrink-0" />
        <span class="min-w-0 flex-1 truncate">Settings</span>
      </a>
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
