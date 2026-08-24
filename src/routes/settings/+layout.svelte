<script lang="ts">
  // Settings shell: auth guard + one chrome for every /settings/* page.
  // Sections are real routes; this layout owns the sub-rail nav (workspace
  // experience) or the inline nav column (current experience) and the child
  // page owns only its own content.
  import type { Snippet } from "svelte";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { resolve } from "$app/paths";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import AppNav from "$lib/components/ui/AppNav.svelte";
  import PageBar from "$lib/components/ui/PageBar.svelte";
  import PageContainer from "$lib/components/ui/PageContainer.svelte";
  import Spinner from "$lib/components/ui/Spinner.svelte";
  import WorkspaceChrome from "$lib/components/workspace/WorkspaceChrome.svelte";
  import WorkspaceGate from "$lib/workspace/WorkspaceGate.svelte";
  import { SETTINGS_SECTIONS, settingsSectionForPath } from "$lib/settings/sections";

  let { children: pageContent }: { children: Snippet } = $props();

  const auth = useAuth();
  $effect(() => {
    if (!auth.isLoading && !auth.isAuthenticated) {
      goto("/login", { replaceState: true });
    }
  });

  const links = SETTINGS_SECTIONS.map((s) => ({ ...s, href: resolve(s.path) }));
  const active = $derived(settingsSectionForPath(page.url.pathname));
</script>

{#snippet sectionNav(layout: "rail" | "inline")}
  <nav aria-label="Settings sections" class={layout === "rail" ? "" : "md:sticky md:top-4"}>
    <!-- Inline variant scrolls horizontally only below md; the scroll box gets
         inner padding so focus rings are not clipped. -->
    <ul class={layout === "rail" ? "flex flex-col gap-1.5" : "flex gap-1 max-md:-my-1 max-md:overflow-x-auto max-md:py-1 md:flex-col md:gap-px"}>
      {#each links as item (item.key)}
        {@const current = active.key === item.key}
        <li>
          <a
            href={item.href}
            aria-current={current ? "page" : undefined}
            class={`flex h-8 w-full items-center whitespace-nowrap rounded-md px-2.5 text-left font-medium transition-colors duration-150 ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir motion-reduce:transition-none ${layout === "rail" ? "text-[0.8125rem]" : "text-sm"} ${
              current
                ? layout === "rail"
                  ? "bg-white font-semibold text-ink"
                  : "bg-workspace-rail-selected font-semibold text-ink"
                : layout === "rail"
                  ? "text-ink-secondary hover:bg-workspace-subrail-hover hover:text-ink"
                  : "text-ink-secondary hover:bg-workspace-rail-hover hover:text-ink"
            }`}
          >
            {item.label}
          </a>
        </li>
      {/each}
    </ul>
  </nav>
{/snippet}

{#if auth.isLoading || !auth.isAuthenticated}
  <div class="flex flex-1 items-center justify-center bg-canvas">
    <Spinner />
  </div>
{:else}
  <WorkspaceGate currentWhileLoading={false}>
    {#snippet current()}
      <div class="flex flex-1 flex-col bg-canvas">
        <AppNav breadcrumbs={[{ label: "Settings" }, { label: active.label }]} />
        <PageBar backHref="/dashboard" backLabel="Back" />
        <PageContainer>
          <h1 class="text-display">Settings</h1>
          <p class="mt-1 max-w-2xl text-sm text-ink-muted">
            Your name, your password, and how Banhall writes your reports.
          </p>
          <div class="mt-8 grid items-start gap-8 md:grid-cols-[11.5rem_minmax(0,1fr)]">
            {@render sectionNav("inline")}
            <div class="min-w-0">{@render pageContent()}</div>
          </div>
        </PageContainer>
      </div>
    {/snippet}
    {#snippet preview()}
      <WorkspaceChrome title="Settings" description={active.description}>
        {#snippet subrail()}
          {@render sectionNav("rail")}
        {/snippet}
        {#snippet children()}
          <PageContainer class="max-w-none! page-gutter! page-gutter-y! pb-12!">
            <div class="mb-6 md:hidden">{@render sectionNav("inline")}</div>
            {@render pageContent()}
          </PageContainer>
        {/snippet}
      </WorkspaceChrome>
    {/snippet}
  </WorkspaceGate>
{/if}
