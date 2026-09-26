<script lang="ts">
  import type { PageIcon } from "$lib/components/shell/pageIcon";
  /**
   * Round 2 top bar (every A to D and I board, decision 53): a 56px row with
   * the shell controls, the page icon tile, then either a title (plus an
   * optional muted subtitle) or a breadcrumb ("Admin / House rules"). Right:
   * a status slot, the bell (What's new, with the unseen dot) and the page
   * actions. The centre stays free for the View as pill, which the shell
   * layers over this bar.
   */
  import type { Snippet } from "svelte";
  import { resolve } from "$app/paths";
  import { BellIcon } from "phosphor-svelte";
  import { useQuery } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { api } from "../../../../convex/_generated/api";
  import WorkspaceShellControls from "$lib/components/workspace/WorkspaceShellControls.svelte";
  import PageIconTile from "$lib/components/shell/PageIconTile.svelte";

  let {
    title,
    subtitle = null,
    breadcrumb = null,
    icon = undefined,
    iconSnippet = undefined,
    tone = "light",
    railHidden = false,
    onOpenNavigation,
    onToggleRail = null,
    status = undefined,
    actions = undefined,
  }: {
    title: string;
    subtitle?: string | null;
    /** Parent page link shown before the title ("Admin /"). */
    breadcrumb?: { label: string; href: string } | null;
    icon?: PageIcon;
    iconSnippet?: Snippet;
    tone?: "light" | "dark";
    railHidden?: boolean;
    onOpenNavigation: () => void;
    onToggleRail?: (() => void) | null;
    status?: Snippet;
    actions?: Snippet;
  } = $props();

  const auth = useAuth();
  const unseenQ = useQuery(api.changelog.unseenCount, () => (auth.isAuthenticated ? {} : "skip"));
  const unseen = $derived(unseenQ.data ?? 0);
</script>

<header
  data-workspace-page-header
  data-page-top-bar
  class="flex h-14 shrink-0 items-center gap-2.5 px-2"
>
  <WorkspaceShellControls {tone} {onOpenNavigation} {railHidden} {onToggleRail} />
  {#if icon || iconSnippet}
    <PageIconTile {icon}>{@render iconSnippet?.()}</PageIconTile>
  {/if}
  {#if breadcrumb}
    <nav aria-label="Breadcrumb" class="flex min-w-0 items-center gap-1.5 text-sm leading-5">
      <a
        href={breadcrumb.href}
        data-page-breadcrumb
        class="shrink-0 rounded-sm text-ink-muted transition-colors hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir motion-reduce:transition-none"
      >{breadcrumb.label}</a>
      <span aria-hidden="true" class="text-ink-muted">/</span>
      <h1 aria-current="page" class="min-w-0 truncate font-medium text-ink">{title}</h1>
    </nav>
  {:else}
    <h1 class="shrink-0 truncate text-sm font-medium leading-5 text-ink">{title}</h1>
    {#if subtitle}
      <p data-page-subtitle class="min-w-0 truncate text-xs leading-[18px] text-ink-muted max-sm:hidden">{subtitle}</p>
    {/if}
  {/if}
  <div class="flex-1"></div>
  {@render status?.()}
  <a
    href={resolve("/changelog")}
    data-top-bar-bell
    aria-label={unseen > 0 ? `What's new, ${unseen} new update${unseen === 1 ? "" : "s"}` : "What's new"}
    class="relative flex size-9 shrink-0 items-center justify-center rounded-[7px] text-ink-secondary transition-colors hover:bg-primary-wash hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir motion-reduce:transition-none pointer-coarse:size-11"
  >
    <BellIcon size={16} aria-hidden="true" />
    {#if unseen > 0}
      <span aria-hidden="true" class="absolute right-2.5 top-2 size-1.5 rounded-full bg-primary"></span>
    {/if}
  </a>
  {@render actions?.()}
</header>
