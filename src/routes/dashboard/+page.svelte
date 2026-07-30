<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { useQuery } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { api } from "../../../convex/_generated/api";
  import AppNav from "$lib/components/ui/AppNav.svelte";
  import Spinner from "$lib/components/ui/Spinner.svelte";
  import AllProjectsView from "$lib/components/dashboard/AllProjectsView.svelte";
  import MyWorkView from "$lib/components/mywork/MyWorkView.svelte";
  import { resolveDashboardView, type DashboardView } from "$lib/dashboard/viewMode";

  const auth = useAuth();
  const configQ = useQuery(api.myWork.getViewConfig, () => auth.isAuthenticated ? {} : "skip");
  let sessionLoaded = $state(false);
  let sessionView = $state<string | null>(null);
  const SESSION_KEY = "banhall.dashboardView";

  $effect(() => {
    if (sessionLoaded) return;
    sessionLoaded = true;
    sessionView = sessionStorage.getItem(SESSION_KEY);
  });
  $effect(() => {
    if (!auth.isLoading && !auth.isAuthenticated) goto("/login", { replaceState: true });
  });

  const resolvedView = $derived.by(() => {
    if (configQ.error && sessionLoaded) return "all_projects" as const;
    const config = configQ.data;
    if (!config || !sessionLoaded) return null;
    return resolveDashboardView({
      killSwitch: config.killSwitch,
      ready: config.ready,
      urlView: page.url.searchParams.get("view"),
      sessionView,
      configuredDefault: config.configuredDefault,
    });
  });
  const myWorkAvailable = $derived(Boolean(configQ.data?.ready && !configQ.data?.killSwitch));

  function selectView(view: DashboardView) {
    sessionStorage.setItem(SESSION_KEY, view);
    sessionView = view;
    const url = new URL(page.url);
    url.searchParams.set("view", view);
    goto(`${url.pathname}${url.search}`, { replaceState: true, noScroll: true, keepFocus: true });
  }
</script>

{#if auth.isLoading || !auth.isAuthenticated || resolvedView === null}
  <div class="flex flex-1 items-center justify-center bg-canvas"><Spinner /></div>
{:else}
  <div class="flex flex-1 flex-col bg-canvas">
    <AppNav />
    {#if configQ.error}<p class="border-b border-amber-200 bg-amber-50 px-6 py-2 text-center text-sm text-amber-950" role="status">My work is temporarily unavailable. All projects remains available.</p>{/if}
    <div class="border-b border-line bg-white"><div class="mx-auto flex min-h-12 w-full max-w-[var(--container-shell)] items-center px-6"><nav aria-label="Dashboard view" class="flex rounded-lg bg-chrome p-1"><button type="button" class={`min-h-11 rounded-md px-4 text-sm font-semibold ${resolvedView === "my_work" ? "bg-white text-navy shadow-sm" : "text-ink-muted hover:text-navy"}`} aria-current={resolvedView === "my_work" ? "page" : undefined} onclick={() => selectView("my_work")} disabled={!myWorkAvailable}>My work</button><button type="button" class={`min-h-11 rounded-md px-4 text-sm font-semibold ${resolvedView === "all_projects" ? "bg-white text-navy shadow-sm" : "text-ink-muted hover:text-navy"}`} aria-current={resolvedView === "all_projects" ? "page" : undefined} onclick={() => selectView("all_projects")}>All projects</button></nav></div></div>
    {#if resolvedView === "my_work"}
      <main class="mx-auto w-full max-w-[var(--container-shell)] flex-1 px-6 py-12"><MyWorkView /></main>
    {:else}
      <AllProjectsView />
    {/if}
  </div>
{/if}
