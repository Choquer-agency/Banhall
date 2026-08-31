<script lang="ts">
  /**
   * Presentation-only admin page frame. Routes retain every query, mutation,
   * auth check, and content branch; this component owns only landmarks,
   * width, gutters, the compact heading, and the UI-only rollback seam.
   */
  import type { Snippet } from "svelte";
  import { page } from "$app/state";
  import AppNav from "$lib/components/ui/AppNav.svelte";
  import PageBar from "$lib/components/ui/PageBar.svelte";
  import WorkspaceChrome from "$lib/components/workspace/WorkspaceChrome.svelte";

  let {
    title,
    description = null,
    width = "wide",
    flush = false,
    children,
    actions,
  }: {
    title: string;
    description?: string | null;
    width?: "wide" | "compact";
    flush?: boolean;
    children: Snippet;
    actions?: Snippet;
  } = $props();

  const useCurrentPresentation = $derived(page.url.searchParams.get("workspace") === "current");
  const contentWidth = $derived(
    width === "compact" ? "max-w-3xl" : "max-w-[var(--container-shell)]"
  );
  const currentPresentationHref = $derived.by(() => {
    const url = new URL(page.url);
    url.searchParams.set("workspace", "current");
    return `${url.pathname}${url.search}${url.hash}`;
  });
</script>

{#if useCurrentPresentation}
  <div data-admin-presentation="current" class="min-h-screen bg-canvas">
    <AppNav breadcrumbs={[{ label: title }]} />
    <PageBar backHref="/dashboard" backLabel="Back" {actions} />

    <main class={`mx-auto w-full ${contentWidth} page-gutter page-gutter-y pb-10`}>
      <header class="border-b border-line-soft pb-5">
        <h1 class="text-display">{title}</h1>
        {#if description}<p class="mt-2 text-body">{description}</p>{/if}
      </header>
      <div class="pt-6">
        {@render children()}
      </div>
    </main>
  </div>
{:else}
  <WorkspaceChrome
    {title}
    {description}
    theme="light"
    currentExperienceHref={currentPresentationHref}
    currentExperienceLabel="Current admin page"
    {actions}
  >
    <!-- Workspace presentation is full width (2026-08-10 direction: every
         page except Home spans the plane); the `?workspace=current`
         rollback keeps its centered widths above. -->
    <div
      data-admin-presentation="workspace"
      data-admin-content-width={width}
      data-admin-content-flush={flush ? "" : undefined}
      class={flush ? "w-full" : "w-full page-gutter page-gutter-y pb-8"}
    >
      {@render children()}
    </div>
  </WorkspaceChrome>
{/if}
