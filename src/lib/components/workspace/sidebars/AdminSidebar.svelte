<script lang="ts">
  /**
   * The Admin section sidebar (the page frame, owner 2026-10-28, answers 1
   * and 2): the admin pages in board order (`ADMIN_RAIL_ROUTES`), the
   * Import row with the To review count at its right (2026-11-12, Paper
   * Files 1: "Import 504"; files that could not be read are counted there
   * and marked on the page), and for developers Alerts
   * (with the open count) and Feature requests at the foot. Visibility reads
   * the effective viewer, as the drawer does: only someone who may open Admin
   * (`settings.configure`, View as applied) sees it, and nothing shows until
   * the viewer is known. The pages check access on the server.
   */
  import { page } from "$app/state";
  import { resolve } from "$app/paths";
  import { useQuery } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { api } from "../../../../../convex/_generated/api";
  import { IconLightbulb, IconWarning } from "$lib/components/icons";
  import AdminRouteIcon from "$lib/components/shell/AdminRouteIcon.svelte";
  import { ADMIN_IMPORT_PATH, ADMIN_RAIL_ROUTES } from "$lib/dashboard/adminRoutes";
  import { badgeLabel, canSeeAdmin, canSeeAlerts } from "$lib/shell/navigation";
  import { effectiveViewer } from "$lib/shell/viewAs.svelte";
  import SectionSidebar from "../SectionSidebar.svelte";
  import SectionSidebarLink from "../SectionSidebarLink.svelte";

  const auth = useAuth();
  const userQ = useQuery(api.users.getCurrentUser, () => (auth.isAuthenticated ? {} : "skip"));
  const viewer = $derived(effectiveViewer(userQ.data));
  // The Import page's To review count; null for anyone the sheet is not for.
  const importQ = useQuery(api.ingestion.sheetTotals, () =>
    auth.isAuthenticated && canSeeAdmin(viewer) ? { tab: "review" as const } : "skip"
  );
  const alertsQ = useQuery(api.errorReports.openCount, () =>
    auth.isAuthenticated && canSeeAlerts(viewer) ? {} : "skip"
  );
  // Nothing to review shows no count; more files than the totals read show as "1,000+".
  const importCount = $derived(
    importQ.data && importQ.data.files > 0
      ? `${importQ.data.files.toLocaleString("en-US")}${importQ.data.complete ? "" : "+"}`
      : null
  );
  const openAlerts = $derived(alertsQ.data ?? 0);
  const pathname = $derived(page.url.pathname);
  const isCurrent = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const alertsHref = resolve("/alerts");
  const requestsHref = resolve("/requests");
</script>

{#if userQ.data && canSeeAdmin(viewer)}
<SectionSidebar section="admin" title="Admin">
  <nav aria-label="Admin" class="flex min-h-full flex-col gap-0.5 pt-3">
    {#each ADMIN_RAIL_ROUTES as route (route.href)}
      {@const href = resolve(route.href as "/")}
      <SectionSidebarLink
        {href}
        label={route.label}
        data-admin-link={route.href}
        active={isCurrent(href)}
        count={route.href === ADMIN_IMPORT_PATH ? importCount : null}
      >
        {#snippet icon()}<AdminRouteIcon icon={route.icon} size={16} />{/snippet}
      </SectionSidebarLink>
    {/each}
    {#if viewer.isDeveloper}
      <div aria-hidden="true" class="min-h-5 flex-1"></div>
      {#if canSeeAlerts(viewer)}
        <SectionSidebarLink href={alertsHref} label="Alerts" data-admin-developer-link="alerts" active={isCurrent(alertsHref)}>
          {#snippet icon()}<IconWarning size={16} strokeWidth={1.5} class="shrink-0" />{/snippet}
          {#snippet trailing()}
            {#if openAlerts > 0}
              <span
                data-rail-badge="danger"
                aria-label={`${openAlerts} open`}
                class="flex h-[1.125rem] min-w-5 shrink-0 items-center justify-center rounded-full bg-danger px-1.5 text-[0.6875rem] font-medium leading-[calc(12/11)] text-white"
              >{badgeLabel(openAlerts)}</span>
            {/if}
          {/snippet}
        </SectionSidebarLink>
      {/if}
      <SectionSidebarLink href={requestsHref} label="Feature requests" data-admin-developer-link="requests" active={isCurrent(requestsHref)}>
        {#snippet icon()}<IconLightbulb size={16} strokeWidth={1.5} class="shrink-0" />{/snippet}
      </SectionSidebarLink>
    {/if}
  </nav>
</SectionSidebar>
{/if}
