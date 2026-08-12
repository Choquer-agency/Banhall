<script lang="ts">
  // Branded fir workspace rail — Obvious's rail ANATOMY (255px surface,
  // dense 34px rows, selection by quiet filled capsule, sentence case) on
  // Banhall's fir `bg-shell` (PRODUCT.md Brand Commitments: "fir navigation
  // surface" — Obvious's monochrome charcoal material is deliberately not
  // copied). Banhall identity stays: the Banhall logo (white wordmark on
  // fir, the established AppNav treatment — the raw wordmark carries navy
  // strokes that vanish on fir), Banhall vocabulary, and lagoon keyboard
  // focus. IA (2026-08-10): identity row, New + search, Home / Projects,
  // then the bottom utility group — Settings, Admin (admins only), Flag
  // issue, and the current-dashboard escape — above the account row. Recents
  // and the More menu left the rail. Home and Projects are real links to the
  // canonical /my-work and /projects routes; the parent passes ready-made
  // hrefs so the rail stays presentational. Rendered fixed at ≥1280px
  // (`variant="rail"`) and inside the navigation drawer below
  // (`variant="drawer"`, 44px touch rows). The desktop rail also collapses
  // to a 64px icon-only mini rail (`collapsed`, 2026-08-11 Obvious parity):
  // every row keeps its icon centered with a `title` tooltip and an
  // sr-only/aria name; labels, the wordmark, and section headings leave the
  // visible layout. The drawer instance ALWAYS renders expanded. Portaled
  // menus re-declare `data-workspace-theme="dark"` so they stay in the dark
  // scope.
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { useQuery } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { api } from "../../../../convex/_generated/api";
  import NavActions from "$lib/components/ui/NavActions.svelte";
  import Tooltip from "$lib/components/ui/Tooltip.svelte";
  import { displayName } from "$lib/displayName";
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
    /**
     * Icon-only 64px mini-rail presentation (desktop rail only — the drawer
     * variant ignores it and always renders expanded).
     */
    collapsed?: boolean;
    displayedView: DashboardView | null;
    myWorkAvailable: boolean;
    myWorkHref: string;
    projectsHref: string;
    currentDashboardHref: string;
    currentExperienceLabel?: string;
    onFocusSearch: () => void;
    onNavigate?: () => void;
    /** Desktop-only collapse control, placed on the rail like Obvious. */
    onToggleRail?: (() => void) | null;
  } = $props();

  const auth = useAuth();
  const userQ = useQuery(api.users.getCurrentUser, () => (auth.isAuthenticated ? {} : "skip"));
  const accountLabel = $derived(displayName(userQ.data, ""));

  // Icon-only mini rail applies to the desktop rail only; the drawer
  // instance of this component always renders expanded.
  const iconOnly = $derived(variant === "rail" && collapsed);

  // 34px dense rows on the fixed rail; 44px touch rows inside the drawer.
  // Collapsed rows grow to 44px under coarse pointers (touch-target rule).
  const rowSize = $derived(
    variant === "rail" ? (collapsed ? "h-[34px] pointer-coarse:h-11" : "h-[34px]") : "min-h-11"
  );
  const rowBase = $derived(
    iconOnly
      ? `${rowSize} flex w-full items-center justify-center rounded-xl text-[0.8125rem] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-light motion-reduce:transition-none`
      : `${rowSize} flex w-full items-center gap-2.5 whitespace-nowrap rounded-xl px-2.5 text-left text-[0.8125rem] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-light motion-reduce:transition-none`
  );
  // Hidden-not-removed labels keep every accessible name intact while the
  // mini rail shows icons only; `title` supplies the hover tooltip.
  const labelClass = $derived(iconOnly ? "sr-only" : "");
  const rowTitle = (label: string) => (iconOnly ? label : undefined);
  // Quiet tone-on-tone selection capsule on fir. Measured contrast (WCAG):
  // idle white/65 on fir #0A3A38 ≈ 6.2:1; selected white ≈ 12.5:1. Lagoon
  // text on fir measures ≈ 4.45:1 (< 4.5) so selection stays white, never
  // lagoon-tinted.
  const idleRow = "text-white/65 hover:bg-white/5 hover:text-white";
  const selectedRow = "bg-white/10 text-white";

  // Admin destinations (visibility only; server checks stay authoritative).
  // Every row carries an icon — Obvious rail parity.
  const ADMIN_LINKS = [
    { href: "/admin/brain", label: "The Brain", icon: "M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h10.5a2.25 2.25 0 002.25-2.25V6.75a2.25 2.25 0 00-2.25-2.25H6.75A2.25 2.25 0 004.5 6.75v10.5a2.25 2.25 0 002.25 2.25zm.75-12h9v9h-9v-9z" },
    { href: "/admin/tags", label: "Project tags", icon: "M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3zM6 6h.008v.008H6V6z" },
    { href: "/admin/reviews", label: "QA reviews", icon: "M11.35 3.836c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m8.9-4.414c.376.03.75.057 1.123.08 1.131.094 1.976 1.057 1.976 2.192V16.5A2.25 2.25 0 0118 18.75h-2.25m-7.5-10.5H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V18.75m-7.5-10.5h6.375c.621 0 1.125.504 1.125 1.125v9.375m-8.25-3l1.5 1.5 3-3.75" },
    { href: "/admin/users", label: "Users & roles", icon: "M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" },
    { href: "/admin/models", label: "Model preferences", icon: "M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" },
    { href: "/admin/usage", label: "AI usage & cost", icon: "M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" },
  ] as const;

</script>

{#snippet workIcon()}
  <!-- Home destination icon (2026-08-08 amendment: /my-work presents as Home). -->
  <svg class="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75" /></svg>
{/snippet}

{#snippet projectsIcon()}
  <svg class="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6.75h5.1l1.5 1.5h9.9v8.25A2.25 2.25 0 0118 18.75H6a2.25 2.25 0 01-2.25-2.25V6.75z" /></svg>
{/snippet}

<nav aria-label="Workspace" class="flex h-full min-h-0 flex-col px-2.5 py-3 text-white">
  <!-- Everything above the pinned account row scrolls when the admin set
       plus utilities exceed a short viewport (drawer especially). -->
  <div class="scrollbar-hidden flex min-h-0 flex-1 flex-col overflow-y-auto">
  <!-- Identity row (single workspace — no switcher). The desktop rail owns
       its collapse/expand control in BOTH states (2026-08-11 mini rail): the
       collapsed 64px rail keeps the toggle reachable, so it is never
       off-canvas. The wide wordmark leaves the collapsed layout; its
       destination stays reachable via Home. -->
  <div class={`mb-2 flex items-center gap-1 ${iconOnly ? "justify-center" : ""}`}>
    {#if !iconOnly}
      <a
        href={resolve("/dashboard")}
        aria-label="Banhall dashboard"
        onclick={onNavigate}
        class={`${rowSize} flex min-w-0 flex-1 items-center rounded-xl px-2.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-light`}
      >
        <!-- White wordmark on fir — the established AppNav brand treatment. -->
        <img src="/logo.png" alt="Banhall" class="h-5 w-auto brightness-0 invert" />
      </a>
    {/if}
    {#if variant === "rail" && onToggleRail}
      <Tooltip text={collapsed ? "Expand navigation rail" : "Collapse navigation rail"} side={collapsed ? "right" : "top"}>
        {#snippet children({ props })}
          <button
            {...props}
            type="button"
            data-rail-toggle
            aria-controls="workspace-rail"
            aria-label={collapsed ? "Expand navigation rail" : "Collapse navigation rail"}
            aria-expanded={collapsed ? "false" : "true"}
            onclick={onToggleRail}
            class="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-xl text-white/65 transition-colors hover:bg-white/8 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-light motion-reduce:transition-none pointer-coarse:h-11 pointer-coarse:w-11"
          >
            <svg class="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
              <rect x="3.75" y="4.75" width="16.5" height="14.5" rx="2.25" stroke-linejoin="round" />
              <path stroke-linecap="round" d="M9.25 5v14" />
            </svg>
          </button>
        {/snippet}
      </Tooltip>
    {/if}
  </div>

  <!-- Creation action on every view (2026-08-10 chrome-less Home amendment,
       Obvious parity: the sidebar "New" is the constant creation anchor).
       Home's intake composition remains the primary path; this is the
       persistent secondary anchor, not a duplicate header CTA. -->
  <div class={`mb-3 flex ${iconOnly ? "flex-col items-stretch gap-1" : "items-center gap-1.5"}`}>
    <!-- Collapsed: the New capsule keeps its filled treatment as a plus
         icon button; search stacks below it as a plain icon row. -->
    <a
      href={resolve("/project/new")}
      onclick={onNavigate}
      title={rowTitle("New project")}
      class={iconOnly
        ? `${rowSize} flex w-full items-center justify-center rounded-xl bg-white/8 text-white transition-colors hover:bg-white/12 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-light motion-reduce:transition-none`
        : `${rowSize} flex flex-1 items-center gap-2 rounded-xl bg-white/8 px-2.5 text-[0.8125rem] font-medium text-white transition-colors hover:bg-white/12 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-light motion-reduce:transition-none`}
    >
      <svg class="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" d="M12 5v14M5 12h14" /></svg>
      <span class={labelClass}>New project</span>
    </a>
    <Tooltip text="Search projects" side={iconOnly ? "right" : "top"}>
      {#snippet children({ props })}
        <button
          {...props}
          type="button"
          aria-label="Search projects"
          onclick={onFocusSearch}
          class={`${variant === "rail" ? (collapsed ? "h-[34px] w-full pointer-coarse:h-11" : "h-[34px] w-[34px]") : "h-11 w-11"} flex shrink-0 items-center justify-center rounded-xl text-white/65 transition-colors hover:bg-white/5 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-light motion-reduce:transition-none`}
        >
          <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
        </button>
      {/snippet}
    </Tooltip>
  </div>

  <!-- Primary navigation -->
  <div class="flex flex-col gap-0.5">
    <!-- Tooltip trigger props spread straight onto the link — the earlier
         focusable wrapper span created a duplicate "Home" focus stop around
         the nested Home link (a11y P0, 2026-08-08 audit). -->
    <Tooltip text={myWorkAvailable ? "Your assigned and owned work" : "Home is temporarily unavailable"} side="right">
      {#snippet children({ props })}
        <a
          {...props}
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
          {@render workIcon()}
          <span class={labelClass}>Home</span>
        </a>
      {/snippet}
    </Tooltip>

    <a
      href={projectsHref}
      title={rowTitle("Projects")}
      class={`${rowBase} ${displayedView === "all_projects" ? selectedRow : idleRow}`}
      aria-current={displayedView === "all_projects" ? "page" : undefined}
      onclick={onNavigate}
    >
      {@render projectsIcon()}
      <span class={labelClass}>Projects</span>
    </a>

    <!-- Settings belongs to the primary navigation (2026-08-10 direction). -->
    <a href={resolve("/settings")} onclick={onNavigate} title={rowTitle("Settings")} class={`${rowBase} ${idleRow}`}>
      <svg class="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.28z" /><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
      <span class={labelClass}>Settings</span>
    </a>
  </div>

  <!-- Admin section (2026-08-10 direction): admins get their own labelled
       set of links below the primary navigation. Visibility only — the
       admin routes keep their server-enforced checks. -->
  {#if userQ.data?.role === "admin"}
    <div data-rail-admin class="mt-4 flex flex-col gap-0.5">
      <!-- The section heading leaves the visible collapsed layout but stays
           in the accessibility tree. -->
      <p class={iconOnly ? "sr-only" : "px-2.5 pb-1 text-xs font-medium text-white/55"}>Admin</p>
      {#each ADMIN_LINKS as link (link.href)}
        <a href={resolve(link.href)} onclick={onNavigate} title={rowTitle(link.label)} class={`${rowBase} ${idleRow}`}>
          <svg class="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d={link.icon} /></svg>
          <span class={iconOnly ? "sr-only" : "min-w-0 truncate"}>{link.label}</span>
        </a>
      {/each}
    </div>
  {/if}

  <div class="min-h-4 flex-1" aria-hidden="true"></div>

  <!-- Utility navigation (2026-08-10 rail IA): Flag issue (raises the
       ErrorMonitor dialog — the global floating button hides inside the
       workspace shell) and the contract-required current-dashboard escape.
       Recents left the rail (Home's "Recently opened" band owns device-local
       recency); the More menu is retired — Self-Serve intake remains at
       /project/questionnaire. -->
  <div class="flex flex-col gap-0.5 border-t border-white/8 pt-2.5">
    <button
      type="button"
      data-rail-flag-issue
      title={rowTitle("Flag issue")}
      onclick={() => {
        onNavigate?.();
        window.dispatchEvent(new CustomEvent("banhall:flag-issue"));
      }}
      class={`${rowBase} ${idleRow}`}
    >
      <svg class="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M3 3v1.5M3 21v-6m0 0l2.77-.693a9 9 0 016.208.682l.108.054a9 9 0 006.086.71l3.114-.732a48.524 48.524 0 01-.005-10.499l-3.11.732a9 9 0 01-6.085-.711l-.108-.054a9 9 0 00-6.208-.682L3 4.5M3 15V4.5" /></svg>
      <span class={labelClass}>Flag issue</span>
    </button>
    <button
      type="button"
      data-workspace-escape
      title={rowTitle(currentExperienceLabel)}
      onclick={() => {
        onNavigate?.();
        goto(currentDashboardHref);
      }}
      class={`${rowBase} ${idleRow}`}
    >
      <svg class="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M10.5 6H6.75A2.25 2.25 0 004.5 8.25v9A2.25 2.25 0 006.75 19.5h9A2.25 2.25 0 0018 17.25V13.5M13.5 4.5h6m0 0v6m0-6l-9 9" /></svg>
      <span class={labelClass}>{currentExperienceLabel}</span>
    </button>
  </div>
  </div>

  <!-- Account + utilities: alerts / feature requests / what's new / account
       menu (settings, admin, sign out) — relocated from the retired topbar.
       Collapsed: the display name leaves the layout (it names, it does not
       act) and the action cluster stacks vertically as icon rows. -->
  <div class={`mt-2 flex border-t border-white/8 pt-2.5 ${iconOnly ? "flex-col items-center gap-1" : "items-center gap-2"}`}>
    {#if !iconOnly}
      <p class="min-w-0 flex-1 truncate px-2.5 text-[0.8125rem] font-medium text-white/65">{accountLabel}</p>
    {/if}
    <NavActions
      tone="dark"
      menuTheme="dark"
      menuLayer={variant === "drawer" ? "drawer" : "app"}
      orientation={iconOnly ? "vertical" : "horizontal"}
    />
  </div>
</nav>
