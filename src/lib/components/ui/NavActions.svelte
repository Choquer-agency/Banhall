<!--
  Default right-side cluster for the app bar: icon buttons for Alerts,
  Requests, and What's new (with unseen badges) + the avatar account menu.
  Text links died Jul 20 — six labels fought the breadcrumb for one row.
  Icons carry tooltips (design rule 11); identity/admin/sign-out live in
  UserMenu. Pages with contextual actions render them via AppNav's
  `actions` snippet, which appears to the LEFT of this cluster.
-->
<script lang="ts">
  import { page } from "$app/state";
  import { useQuery } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
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

  const current = $derived(page.url.pathname);

  const linkClass = (href: string) =>
    `relative flex h-8 w-8 items-center justify-center rounded-md transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-light ${
      current.startsWith(href)
        ? "bg-white/15 text-white"
        : "text-white/60 hover:bg-white/10 hover:text-white"
    }`;
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

<div class="flex items-center gap-1" role="group" aria-label="App shortcuts">
  <Tooltip text={openAlerts ? `Alerts — ${openAlerts} open` : "Alerts"}>
    {#snippet children({ props })}
      <a {...props} href="/alerts" aria-label="Alerts" class={linkClass("/alerts")}>
        <svg class="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
          <path stroke-linecap="round" stroke-linejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
        </svg>
        {@render badge(openAlerts, "bg-red-500")}
      </a>
    {/snippet}
  </Tooltip>

  <Tooltip text="Feature requests">
    {#snippet children({ props })}
      <a {...props} href="/requests" aria-label="Feature requests" class={linkClass("/requests")}>
        <svg class="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" />
        </svg>
      </a>
    {/snippet}
  </Tooltip>

  <Tooltip text={unseenChangelog ? `What's new — ${unseenChangelog} unread` : "What's new"}>
    {#snippet children({ props })}
      <a {...props} href="/changelog" aria-label="What's new" class={linkClass("/changelog")}>
        <svg class="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
          <path stroke-linecap="round" stroke-linejoin="round" d="M10.34 15.84c-.688-.06-1.386-.09-2.09-.09H7.5a4.5 4.5 0 110-9h.75c.704 0 1.402-.03 2.09-.09m0 9.18c.253.962.584 1.892.985 2.783.247.55.06 1.21-.463 1.511l-.657.38c-.551.318-1.26.117-1.527-.461a20.845 20.845 0 01-1.44-4.282m3.102.069a18.03 18.03 0 01-.59-4.59c0-1.586.205-3.124.59-4.59m0 9.18a23.848 23.848 0 018.835 2.535M10.34 6.66a23.847 23.847 0 008.835-2.535m0 0A23.74 23.74 0 0018.795 3m.38 1.125a23.91 23.91 0 011.014 5.395m-1.014 8.855c-.118.38-.245.754-.38 1.125m.38-1.125a23.91 23.91 0 001.014-5.395m0-3.46c.495.413.811 1.035.811 1.73 0 .695-.316 1.317-.811 1.73" />
        </svg>
        {@render badge(unseenChangelog, "bg-primary")}
      </a>
    {/snippet}
  </Tooltip>

  <div class="ml-2 border-l border-white/15 pl-3">
    <UserMenu />
  </div>
</div>
