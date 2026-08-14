<!--
  Default right-side cluster for the app bar: icon buttons for Alerts,
  Requests, and What's new (with unseen badges) + the avatar account menu.
  Text links died Jul 20 — six labels fought the breadcrumb for one row.
  Icons carry tooltips (design rule 11); identity/admin/sign-out live in
  UserMenu. Pages with contextual actions render them via AppNav's
  `actions` snippet, which appears to the LEFT of this cluster.
-->
<script lang="ts">
  import { resolve } from "$app/paths";
  import { page } from "$app/state";
  import { useQuery } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { BellIcon, LightbulbIcon, MegaphoneIcon } from "phosphor-svelte";
  import { api } from "../../../../convex/_generated/api";
  import Tooltip from "$lib/components/ui/Tooltip.svelte";
  import UserMenu from "$lib/components/ui/UserMenu.svelte";

  const auth = useAuth();
  const openAlertsQ = useQuery(api.errorReports.openCount, () =>
    auth.isAuthenticated ? {} : "skip"
  );
  const unseenChangelogQ = useQuery(api.changelog.unseenCount, () =>
    auth.isAuthenticated ? {} : "skip"
  );
  const openAlerts = $derived(openAlertsQ.data ?? 0);
  const unseenChangelog = $derived(unseenChangelogQ.data ?? 0);

  let {
    tone = "dark",
    menuTheme = "light",
    menuLayer = "app",
    orientation = "horizontal",
  }: {
    tone?: "dark" | "light";
    /** Theme of the portaled account menu — "dark" inside the dark workspace shell. */
    menuTheme?: "light" | "dark";
    /** Layer used by the portaled account menu. */
    menuLayer?: "app" | "drawer";
    /** "vertical" stacks the cluster for the collapsed icon-only mini rail. */
    orientation?: "horizontal" | "vertical";
  } = $props();

  const current = $derived(page.url.pathname);

  const linkClass = (href: string) => {
    const active = current.startsWith(href);
    const palette = tone === "light"
      ? active
        ? "bg-chrome text-navy"
        : "text-ink-muted hover:bg-primary-wash hover:text-navy"
      : active
        ? "bg-white/15 text-white"
        : "text-white/60 hover:bg-white/10 hover:text-white";
    return `relative flex h-11 w-11 items-center justify-center rounded-md transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary md:h-8 md:w-8 ${palette}`;
  };
</script>

{#snippet badge(count: number, color: string)}
  {#if count > 0}
    <span
      class={`absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-none text-white ${color}`}
    >
      {count > 99 ? "99+" : count}
    </span>
  {/if}
{/snippet}

<div
  class={`flex items-center gap-1 ${orientation === "vertical" ? "flex-col" : ""}`}
  role="group"
  aria-label="App shortcuts"
>
  <Tooltip text={openAlerts ? `Alerts, ${openAlerts} open` : "Alerts"}>
    {#snippet children({ props })}
      <a {...props} href={resolve("/alerts")} aria-label="Alerts" class={linkClass("/alerts")}>
        <BellIcon size={18} weight="regular" aria-hidden="true" />
        {@render badge(openAlerts, "bg-red-500")}
      </a>
    {/snippet}
  </Tooltip>

  <Tooltip text="Feature requests">
    {#snippet children({ props })}
      <a {...props} href={resolve("/requests")} aria-label="Feature requests" class={linkClass("/requests")}>
        <LightbulbIcon size={18} weight="regular" aria-hidden="true" />
      </a>
    {/snippet}
  </Tooltip>

  <Tooltip text={unseenChangelog ? `What's new, ${unseenChangelog} unread` : "What's new"}>
    {#snippet children({ props })}
      <a {...props} href={resolve("/changelog")} aria-label="What's new" class={linkClass("/changelog")}>
        <MegaphoneIcon size={18} weight="regular" aria-hidden="true" />
        {@render badge(unseenChangelog, "bg-primary")}
      </a>
    {/snippet}
  </Tooltip>

  <div
    class={`${orientation === "vertical" ? "mt-1 flex w-full justify-center border-t pt-2" : "ml-2 border-l pl-3"} ${tone === "light" ? "border-line" : "border-white/15"}`}
  >
    <UserMenu {tone} {menuTheme} {menuLayer} />
  </div>
</div>
