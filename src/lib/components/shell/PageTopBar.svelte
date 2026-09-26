<script lang="ts">
  import type { PageIcon } from "$lib/components/shell/pageIcon";
  /**
   * Round 2 top bar (every A to D and I board, decision 53): a 56px row with
   * the shell controls, the page icon tile, then either a title (plus an
   * optional muted subtitle) or a breadcrumb ("Admin / House rules"). Right:
   * a status slot, the bell (What's new, with the unseen dot) and the page
   * actions. The centre stays free for the View as pill, which the shell
   * layers over this bar.
   *
   * `variant="bleed"` (H1, tablet): the bar sits on white over a full-bleed
   * page with a soft line under it, 20px sides, and no page tile or bell.
   * `variant="phone"` (H2): a 52px bar with a back arrow (when `onBack` is
   * set) and the page title in 16px, no breadcrumb, tile or bell.
   */
  import type { Snippet } from "svelte";
  import { resolve } from "$app/paths";
  import { IconArrowLeft, IconBell } from "$lib/components/icons";
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
    variant = "default",
    onBack = null,
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
    variant?: "default" | "bleed" | "phone";
    /** Phone variant: the back arrow's action, in place of the shell controls. */
    onBack?: (() => void) | null;
  } = $props();

  const plain = $derived(variant !== "default");

  const auth = useAuth();
  // The plain variants draw no bell, so they read no unseen count.
  const unseenQ = useQuery(api.changelog.unseenCount, () => (auth.isAuthenticated && !plain ? {} : "skip"));
  const unseen = $derived(unseenQ.data ?? 0);
</script>

<header
  data-workspace-page-header
  data-page-top-bar
  data-variant={variant}
  class={`flex shrink-0 items-center ${
    variant === "phone"
      ? "h-[52px] gap-2 border-b border-line-soft bg-surface pr-3 pl-2"
      : variant === "bleed"
        ? "h-14 gap-2.5 border-b border-line-soft bg-surface px-5"
        : "h-14 gap-2.5 px-2"
  }`}
>
  {#if variant === "phone" && onBack}
    <button
      type="button"
      data-page-back
      aria-label="Back"
      onclick={onBack}
      class="flex size-11 shrink-0 items-center justify-center rounded-lg text-ink transition-colors hover:bg-primary-wash focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir motion-reduce:transition-none"
    >
      <IconArrowLeft size={20} strokeWidth={1.8} />
    </button>
  {:else}
    <WorkspaceShellControls {tone} {onOpenNavigation} {railHidden} {onToggleRail} />
  {/if}
  {#if !plain && (icon || iconSnippet)}
    <PageIconTile {icon}>{@render iconSnippet?.()}</PageIconTile>
  {/if}
  {#if variant === "phone"}
    <h1 class="min-w-0 flex-1 truncate text-base leading-[22px] font-medium text-ink">{title}</h1>
  {:else if breadcrumb}
    <!-- B3: "Admin /" is one muted run, then the 10px bar gap, then the page. -->
    <nav aria-label="Breadcrumb" class="flex min-w-0 items-center gap-2.5 text-sm leading-5">
      <span class="shrink-0 whitespace-pre text-ink-muted"><a
          href={breadcrumb.href}
          data-page-breadcrumb
          class="rounded-sm transition-colors hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir motion-reduce:transition-none"
        >{breadcrumb.label}</a><span aria-hidden="true">{" /"}</span></span>
      <h1 aria-current="page" class="min-w-0 truncate font-medium text-ink">{title}</h1>
    </nav>
  {:else}
    <h1 class="shrink-0 truncate text-sm font-medium leading-5 text-ink">{title}</h1>
    {#if subtitle}
      <p data-page-subtitle class="min-w-0 truncate text-xs leading-[18px] text-ink-muted max-sm:hidden">{subtitle}</p>
    {/if}
  {/if}
  {#if variant !== "phone"}<div class="flex-1"></div>{/if}
  {@render status?.()}
  {#if !plain}
  <a
    href={resolve("/changelog")}
    data-top-bar-bell
    aria-label={unseen > 0 ? `What's new, ${unseen} new update${unseen === 1 ? "" : "s"}` : "What's new"}
    class="relative flex size-9 shrink-0 items-center justify-center rounded-[7px] text-ink-secondary transition-colors hover:bg-primary-wash hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir motion-reduce:transition-none pointer-coarse:size-11"
  >
    <IconBell size={16} strokeWidth={1.5} />
    {#if unseen > 0}
      <span aria-hidden="true" class="absolute right-2.5 top-2 size-1.5 rounded-full bg-primary"></span>
    {/if}
  </a>
  {/if}
  {@render actions?.()}
</header>
