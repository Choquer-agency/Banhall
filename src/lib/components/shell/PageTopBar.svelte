<script lang="ts" module>
  /** The top bar's one filled button (38px, radius 9, 15/500). */
  export type TopBarPrimaryAction = {
    label: string;
    /** A link when set; otherwise a button that calls `onclick`. */
    href?: string;
    onclick?: () => void;
    disabled?: boolean;
  };
</script>

<script lang="ts">
  import type { PageIcon } from "$lib/components/shell/pageIcon";
  /**
   * The page top bar (the page frame, owner 2026-10-28; Paper S9 and S11):
   * a 64px row at the top of the white card, sharing the content's side
   * inset (32px on a desktop). The page title at 22/28 500 in ink, then a
   * muted 15/20 count ("7 people") or a muted line, then on the right the
   * status slot, the page actions and one primary button. The bell moved to
   * the global bar; below 1024px, where there is no global bar, the bar keeps
   * the hamburger and the bell as before. While the page's section sidebar is
   * collapsed, its expand button leads the bar.
   *
   * `variant="bleed"` (H1, tablet): a soft line under the bar, 20px sides,
   * no bell. `variant="phone"` (H2): a 52px bar with a back arrow (when
   * `onBack` is set) and the page title in 16px, no breadcrumb or bell.
   */
  import type { Snippet } from "svelte";
  import { IconArrowLeft } from "$lib/components/icons";
  import TopBarBell from "$lib/components/shell/TopBarBell.svelte";
  import WorkspaceShellControls from "$lib/components/workspace/WorkspaceShellControls.svelte";
  import SectionSidebarExpand from "$lib/components/workspace/SectionSidebarExpand.svelte";
  import { topBarPrimary } from "$lib/components/shell/topBar";
  import { sectionSidebar } from "$lib/workspace/sectionSidebar.svelte";

  let {
    title,
    count = null,
    subtitle = null,
    breadcrumb = null,
    tone = "light",
    onOpenNavigation,
    status = undefined,
    actions = undefined,
    primaryAction = null,
    primaryActionInSidebar = false,
    sidebarToggle = false,
    variant = "default",
    onBack = null,
    titleTag = "h1",
    class: className = "",
  }: {
    title: string;
    /** Muted count after the title ("7 people", "42"). */
    count?: string | number | null;
    subtitle?: string | null;
    /** Parent page link shown before the title ("Admin /"). */
    breadcrumb?: { label: string; href: string } | null;
    /** @deprecated The bar draws no page tile (2026-10-19). */
    icon?: PageIcon;
    /** @deprecated The bar draws no page tile (2026-10-19). */
    iconSnippet?: Snippet;
    tone?: "light" | "dark";
    onOpenNavigation: () => void;
    status?: Snippet;
    actions?: Snippet;
    /** The filled button at the right edge ("Invite people"). */
    primaryAction?: TopBarPrimaryAction | null;
    /**
     * The section sidebar carries the same action from 768px ("New project",
     * "Invite people"), so the bar shows it only below that, or while the
     * sidebar is collapsed or not drawn.
     */
    primaryActionInSidebar?: boolean;
    /** The page has a section sidebar: lead with its expand button while it is collapsed. */
    sidebarToggle?: boolean;
    variant?: "default" | "bleed" | "phone";
    /** Phone variant: the back arrow's action, in place of the shell controls. */
    onBack?: (() => void) | null;
    /** `p` when the page's h1 is elsewhere (the phone bar over a company on Projects). */
    titleTag?: "h1" | "p";
    class?: string;
  } = $props();

  // Only small screens draw the bell here; the plain variants never do.
  const plain = $derived(variant !== "default");

  const focusRing =
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir";
  const sidebarHoldsAction = $derived(
    primaryActionInSidebar && sectionSidebar.mounted > 0 && !sectionSidebar.collapsed
  );
  const primaryClass = $derived(`${topBarPrimary} ${sidebarHoldsAction ? "md:hidden" : ""}`);
</script>

<header
  data-workspace-page-header
  data-page-top-bar
  data-variant={variant}
  class={`flex shrink-0 items-center ${
    variant === "phone"
      ? "h-[3.25rem] gap-2 border-b border-line-soft bg-surface pr-3 pl-2"
      : variant === "bleed"
        ? "h-16 gap-2.5 border-b border-line-soft bg-surface px-5"
        : "h-16 gap-3 px-4 sm:px-6 lg:px-8"
  } ${className}`}
>
  {#if variant === "phone" && onBack}
    <button
      type="button"
      data-page-back
      aria-label="Back"
      onclick={onBack}
      class={`flex size-11 shrink-0 items-center justify-center rounded-lg text-ink transition-colors hover:bg-primary-wash ${focusRing} motion-reduce:transition-none`}
    >
      <IconArrowLeft size={20} strokeWidth={1.8} />
    </button>
  {:else}
    <WorkspaceShellControls {tone} {onOpenNavigation} />
  {/if}
  {#if sidebarToggle && !plain}<SectionSidebarExpand />{/if}
  {#if variant === "phone"}
    <h1 class="min-w-0 flex-1 truncate text-base leading-[1.375] font-medium text-ink">{title}</h1>
  {:else if breadcrumb}
    <!-- B3: "Admin /" is one muted run, then the bar gap, then the page. -->
    <nav aria-label="Breadcrumb" class="flex min-w-0 items-center gap-2.5 text-[1.375rem] leading-[calc(14/11)]">
      <span class="shrink-0 whitespace-pre text-ink-muted"><a
          href={breadcrumb.href}
          data-page-breadcrumb
          class={`rounded-sm transition-colors hover:text-ink ${focusRing} motion-reduce:transition-none`}
        >{breadcrumb.label}</a><span aria-hidden="true">{" /"}</span></span>
      <h1 aria-current="page" class="min-w-0 truncate font-medium text-ink">{title}</h1>
    </nav>
  {:else}
    <svelte:element this={titleTag} data-page-title class="min-w-0 shrink truncate text-[1.375rem] font-medium leading-[calc(14/11)] text-ink">{title}</svelte:element>
    {#if count !== null && count !== undefined && count !== ""}
      <span data-page-count class="shrink-0 text-[0.9375rem] leading-[calc(4/3)] text-ink-muted">{count}</span>
    {/if}
    {#if subtitle}
      <p data-page-subtitle class="min-w-0 truncate text-sm leading-[calc(10/7)] text-ink-muted max-sm:hidden">{subtitle}</p>
    {/if}
  {/if}
  {#if variant !== "phone"}<div class="flex-1"></div>{/if}
  {@render status?.()}
  {#if !plain}
    <!-- Below 1024px only: from there the global bar holds the bell. -->
    <TopBarBell />
  {/if}
  {@render actions?.()}
  {#if primaryAction}
    {#if primaryAction.href && !primaryAction.disabled}
      <a href={primaryAction.href} data-top-bar-primary class={primaryClass}>{primaryAction.label}</a>
    {:else}
      <button
        type="button"
        data-top-bar-primary
        disabled={primaryAction.disabled}
        onclick={() => primaryAction?.onclick?.()}
        class={primaryClass}
      >{primaryAction.label}</button>
    {/if}
  {/if}
</header>
