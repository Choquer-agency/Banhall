<script lang="ts">
  /**
   * The Projects company header while the page loads (the page frame,
   * 2026-10-28): the same 64px row as `ClientArea`'s, so nothing moves when
   * the page arrives. The title is "All projects", or the company named by
   * `?client=` once the company list knows it (a quiet block until then); the
   * search is drawn but not yet usable, and New project shows while the
   * sidebar is collapsed, as on the loaded header. The expand button and,
   * from 768 to 1023px, the menu button and the bell sit where the loaded
   * header draws them, so the title does not move when the page arrives.
   */
  import { page } from "$app/state";
  import { useQuery } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { api } from "../../../../convex/_generated/api";
  import { IconSearch } from "$lib/components/icons";
  import { resolve } from "$app/paths";
  import { CLIENT_PARAM } from "$lib/projects/clientList";
  import { topBarPrimary } from "$lib/components/shell/topBar";
  import { sectionSidebar } from "$lib/workspace/sectionSidebar.svelte";
  import WorkspaceShellControls from "$lib/components/workspace/WorkspaceShellControls.svelte";
  import SectionSidebarExpand from "$lib/components/workspace/SectionSidebarExpand.svelte";
  import TopBarBell from "$lib/components/shell/TopBarBell.svelte";

  let { onOpenNavigation }: { onOpenNavigation?: () => void } = $props();

  const auth = useAuth();
  const clientsQ = useQuery(api.clients.listClients, () => (auth.isAuthenticated ? {} : "skip"));
  const key = $derived(page.url.searchParams.get(CLIENT_PARAM) || null);
  const title = $derived.by(() => {
    if (key === null) return "All projects";
    return clientsQ.data?.clients.find((client) => client.key === key)?.name ?? null;
  });
</script>

<div data-client-header data-loading class="flex shrink-0 flex-wrap items-center gap-3 px-4 pb-3 sm:px-6 md:h-16 md:flex-nowrap md:pb-0 lg:px-8">
  {#if onOpenNavigation}
    <div class="contents max-md:hidden">
      <WorkspaceShellControls tone="light" {onOpenNavigation} />
    </div>
  {/if}
  <SectionSidebarExpand />
  {#if title}
    <h1 data-client-title class="min-w-0 truncate text-[1.375rem] font-medium leading-[calc(14/11)] text-ink">{title}</h1>
  {:else}
    <span aria-hidden="true" class="h-7 w-48 animate-pulse rounded-md bg-chrome motion-reduce:animate-none"></span>
  {/if}
  <div class="flex-1"></div>
  {#if onOpenNavigation}
    <TopBarBell class="max-md:hidden" />
  {/if}
  <div class="relative w-[18.75rem] max-w-full max-md:order-last max-md:w-full">
    <IconSearch size={14} strokeWidth={2} class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
    <input
      type="search"
      disabled
      aria-label="Search projects"
      placeholder="Search projects"
      class="field-control h-9 w-full rounded-lg pl-[2.125rem] pr-3 text-sm leading-[calc(9/7)] text-ink placeholder:text-ink-muted pointer-coarse:h-11"
    />
  </div>
  {#if sectionSidebar.collapsed && sectionSidebar.mounted > 0}
    <!-- As the loaded header: New project while the sidebar is collapsed. -->
    <a href={resolve("/project/new")} data-top-bar-primary class={`${topBarPrimary} max-md:hidden`}>New project</a>
  {/if}
</div>
