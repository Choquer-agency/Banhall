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
  import { IconShield } from "$lib/components/icons";
  import { resolve } from "$app/paths";

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
  <!-- Round 2 B3: 56px top bar with the shield tile and "Admin / {title}",
       page actions in the top bar, then the padded panel with the serif
       heading and description. Full width, no sub-rail. While a developer
       views Banhall as a role without settings.configure, WorkspaceChrome
       shows the D4 hidden-page state instead (`viewAsGate`). -->
  <WorkspaceChrome
    {title}
    icon={IconShield}
    breadcrumb={{ label: "Admin", href: resolve("/admin/house-rules") }}
    theme="light"
    panel={flush ? "flush" : "padded"}
    padding="admin"
    viewAsGate="admin"
    currentExperienceHref={currentPresentationHref}
    currentExperienceLabel="Current admin page"
    {actions}
  >
    <div
      data-admin-presentation="workspace"
      data-admin-content-width={width}
      data-admin-content-flush={flush ? "" : undefined}
      class="flex w-full flex-col"
    >
      <header data-admin-page-heading class={`flex flex-col gap-1 ${flush ? "px-5 pt-7 md:px-10" : ""}`}>
        <h2 class="font-serif text-[28px] font-normal leading-[34px] text-ink">{title}</h2>
        <!-- B3: the description is 14/20 in muted ink (the board, not the spec's 15px). -->
        {#if description}<p data-admin-page-description class="text-sm leading-5 text-ink-muted">{description}</p>{/if}
      </header>
      <div class="pt-5">
        {@render children()}
      </div>
    </div>
  </WorkspaceChrome>
{/if}
