<script lang="ts" module>
  /** The top bar's one filled button (Rail v3 top bar: 38px, radius 9, 15/500). */
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
   * The standard top bar (owner rule, Paper "Top bar" on board Z11a,
   * 2026-10-19 amendment in docs/design-system.md): a 64px row, 8px sides,
   * the page title at 22/28 500 in ink, then a muted 15px count (or a muted
   * subtitle), or a breadcrumb ("Admin / House rules"). Right: a status slot,
   * the bell (What's new, with the unseen dot), the page actions and the
   * primary button. The centre stays free for the View as pill, which the
   * shell layers over this bar. Every workspace screen uses it.
   *
   * `variant="bleed"` (H1, tablet): the bar sits on white over a full-bleed
   * page with a soft line under it, 20px sides, and no bell.
   * `variant="phone"` (H2): a 52px bar with a back arrow (when `onBack` is
   * set) and the page title in 16px, no breadcrumb or bell.
   *
   * `icon` and `iconSnippet` are still accepted but draw nothing: the
   * standard bar has no page tile.
   */
  import type { Snippet } from "svelte";
  import { resolve } from "$app/paths";
  import { IconArrowLeft, IconBell } from "$lib/components/icons";
  import { useQuery } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { api } from "../../../../convex/_generated/api";
  import WorkspaceShellControls from "$lib/components/workspace/WorkspaceShellControls.svelte";

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
    variant = "default",
    onBack = null,
  }: {
    title: string;
    /** Muted count after the title ("42", "1000+"). */
    count?: string | number | null;
    subtitle?: string | null;
    /** Parent page link shown before the title ("Admin /"). */
    breadcrumb?: { label: string; href: string } | null;
    /** @deprecated The standard bar draws no page tile (2026-10-19). */
    icon?: PageIcon;
    /** @deprecated The standard bar draws no page tile (2026-10-19). */
    iconSnippet?: Snippet;
    tone?: "light" | "dark";
    /** @deprecated The rail draws its own collapse control (2026-10-19). */
    railHidden?: boolean;
    onOpenNavigation: () => void;
    /** @deprecated The rail draws its own collapse control (2026-10-19). */
    onToggleRail?: (() => void) | null;
    status?: Snippet;
    actions?: Snippet;
    /** The filled button at the right edge ("New project"). */
    primaryAction?: TopBarPrimaryAction | null;
    variant?: "default" | "bleed" | "phone";
    /** Phone variant: the back arrow's action, in place of the shell controls. */
    onBack?: (() => void) | null;
  } = $props();

  const plain = $derived(variant !== "default");

  const auth = useAuth();
  // The plain variants draw no bell, so they read no unseen count.
  const unseenQ = useQuery(api.changelog.unseenCount, () => (auth.isAuthenticated && !plain ? {} : "skip"));
  const unseen = $derived(unseenQ.data ?? 0);

  const focusRing =
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir";
  const primaryClass =
    "inline-flex h-[2.375rem] shrink-0 items-center rounded-[0.5625rem] bg-primary-selected px-4 text-[0.9375rem] font-medium leading-5 text-white transition-colors hover:bg-primary-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fir disabled:opacity-60 motion-reduce:transition-none pointer-coarse:h-11";
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
        : "h-16 gap-2.5 px-2"
  }`}
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
  {#if variant === "phone"}
    <h1 class="min-w-0 flex-1 truncate text-base leading-[1.375rem] font-medium text-ink">{title}</h1>
  {:else if breadcrumb}
    <!-- B3: "Admin /" is one muted run, then the bar gap, then the page. -->
    <nav aria-label="Breadcrumb" class="flex min-w-0 items-center gap-2.5 text-[1.375rem] leading-7">
      <span class="shrink-0 whitespace-pre text-ink-muted"><a
          href={breadcrumb.href}
          data-page-breadcrumb
          class={`rounded-sm transition-colors hover:text-ink ${focusRing} motion-reduce:transition-none`}
        >{breadcrumb.label}</a><span aria-hidden="true">{" /"}</span></span>
      <h1 aria-current="page" class="min-w-0 truncate font-medium text-ink">{title}</h1>
    </nav>
  {:else}
    <h1 class="min-w-0 shrink truncate text-[1.375rem] font-medium leading-7 text-ink">{title}</h1>
    {#if count !== null && count !== undefined && count !== ""}
      <span data-page-count class="shrink-0 text-[0.9375rem] leading-5 text-ink-muted">{count}</span>
    {/if}
    {#if subtitle}
      <p data-page-subtitle class="min-w-0 truncate text-[0.9375rem] leading-5 text-ink-muted max-sm:hidden">{subtitle}</p>
    {/if}
  {/if}
  {#if variant !== "phone"}<div class="flex-1"></div>{/if}
  {@render status?.()}
  {#if !plain}
  <a
    href={resolve("/changelog")}
    data-top-bar-bell
    aria-label={unseen > 0 ? `What's new, ${unseen} new update${unseen === 1 ? "" : "s"}` : "What's new"}
    class={`relative flex size-9 shrink-0 items-center justify-center rounded-[0.4375rem] text-ink-secondary transition-colors hover:bg-primary-wash hover:text-ink ${focusRing} motion-reduce:transition-none pointer-coarse:size-11`}
  >
    <IconBell size={16} strokeWidth={1.5} />
    {#if unseen > 0}
      <span aria-hidden="true" class="absolute right-2.5 top-2 size-1.5 rounded-full bg-primary"></span>
    {/if}
  </a>
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
