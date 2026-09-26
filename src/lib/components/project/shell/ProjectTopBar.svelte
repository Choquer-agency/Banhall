<!--
  Project top bar (ui-design-final.md section 2; round 2 boards F2 to F5):
  the 26px page icon tile, "Projects /" and the project title (the route's
  single h1) on the left, 10px apart; on the right the bell, then the page
  actions. On a phone (H4) it is a back arrow, the title and the More menu.
  Tools the screens do not show (AI review, Share, Compare, History,
  Financial) sit in a More menu (decision 19).

  `flush` (Reading the interview, H3 and H4): below 1280px the panel under
  the bar is flush, so the bar becomes a white strip with a hairline; on a
  tablet it drops the page tile and the bell, as H3 draws it.
-->
<script lang="ts" module>
  export type TopBarMoreItem = {
    id: string;
    label: string;
    onSelect?: () => void;
    href?: string;
    disabled?: boolean;
  };
</script>

<script lang="ts">
  import type { Snippet } from "svelte";
  import { DropdownMenu } from "bits-ui";
  import { IconArrowLeft, IconBell, IconDocument, IconMore } from "$lib/components/icons";
  import PageIconTile from "$lib/components/shell/PageIconTile.svelte";
  import { resolve } from "$app/paths";
  import { useQuery } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { api } from "../../../../../convex/_generated/api";
  import WorkspaceShellControls from "$lib/components/workspace/WorkspaceShellControls.svelte";

  let {
    title,
    projectsHref,
    railHidden = false,
    onToggleRail,
    onOpenNavigation,
    leading,
    status,
    actions,
    moreItems = [],
    flush = false,
  }: {
    title: string;
    projectsHref: string;
    railHidden?: boolean;
    onToggleRail?: () => void;
    onOpenNavigation: () => void;
    /** Extra controls right after the rail controls (e.g. reopen a closed pane). */
    leading?: Snippet;
    /** Quiet state before the bell (saving, errors, list paging). */
    status?: Snippet;
    /** Page actions after the bell (Export, Send for review, Cancel generation). */
    actions?: Snippet;
    moreItems?: TopBarMoreItem[];
    /** The panel below is flush under 1280px (H3, H4). */
    flush?: boolean;
  } = $props();

  const auth = useAuth();
  const unseenQ = useQuery(api.changelog.unseenCount, () => (auth.isAuthenticated ? {} : "skip"));
  const unseen = $derived(unseenQ.data ?? 0);

  // Board F2: 36px icon buttons, radius 7; 44px on a phone (H4) and on
  // coarse pointers.
  const iconButton =
    "flex size-9 shrink-0 items-center justify-center rounded-[7px] text-ink-secondary transition-colors hover:bg-primary-wash hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir data-[state=open]:bg-primary-wash pointer-coarse:size-11";
</script>

{#snippet moreMenu(placement: "desktop" | "phone")}
  <DropdownMenu.Root>
    <DropdownMenu.Trigger
      aria-label="More actions"
      class={`${iconButton} ${placement === "phone" ? "size-11! text-ink! sm:hidden" : "max-sm:hidden"}`}
      data-top-bar-more={placement}
    >
      <IconMore size={placement === "phone" ? 18 : 16} />
    </DropdownMenu.Trigger>
    <DropdownMenu.Portal>
      <DropdownMenu.Content
        side="bottom"
        align="end"
        sideOffset={6}
        class="z-[100] min-w-48 rounded-xl border border-line bg-surface p-1 shadow-lg outline-none"
      >
        {#each moreItems as item (item.id)}
          {#if item.href}
            <DropdownMenu.Item disabled={item.disabled} class="rounded-md text-[13px] text-ink outline-none data-[highlighted]:bg-primary-wash data-[disabled]:opacity-50">
              {#snippet child({ props })}
                <a {...props} href={item.href} data-top-bar-more-item={item.id} class="flex h-8 w-full items-center rounded-md px-2.5 text-[13px] text-ink outline-none data-[highlighted]:bg-primary-wash">{item.label}</a>
              {/snippet}
            </DropdownMenu.Item>
          {:else}
            <DropdownMenu.Item
              disabled={item.disabled}
              onSelect={item.onSelect}
              data-top-bar-more-item={item.id}
              class="flex h-8 w-full cursor-default items-center rounded-md px-2.5 text-[13px] text-ink outline-none data-[highlighted]:bg-primary-wash data-[disabled]:opacity-50"
            >
              {item.label}
            </DropdownMenu.Item>
          {/if}
        {/each}
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>
{/snippet}

<header
  data-workspace-page-header
  data-top-bar-flush={flush || undefined}
  class={`flex shrink-0 items-center gap-2 px-2 max-sm:h-[52px] sm:h-14 sm:gap-2.5 sm:px-5 ${
    flush ? "max-xl:border-b max-xl:border-line-soft max-xl:bg-surface" : ""
  }`}
>
  <!-- Phone (H4): a back arrow to Projects replaces the menu button and the
       breadcrumb; from 640px the workspace controls return. -->
  <a
    href={projectsHref}
    aria-label="Back to projects"
    data-top-bar-back
    class="flex size-11 shrink-0 items-center justify-center rounded-lg text-ink transition-colors hover:bg-primary-wash focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir motion-reduce:transition-none sm:hidden"
  >
    <IconArrowLeft size={20} strokeWidth={1.8} />
  </a>
  <div class="contents max-sm:hidden">
    <WorkspaceShellControls
      tone="light"
      {onOpenNavigation}
      {railHidden}
      onToggleRail={onToggleRail ?? null}
    />
  </div>
  {@render leading?.()}
  <div class="flex min-w-0 flex-1 items-center gap-2.5 text-sm leading-5">
    <!-- Round 2 top bars: the document icon on the 26px page tile. -->
    <PageIconTile icon={IconDocument} class={`max-sm:hidden ${flush ? "max-xl:hidden" : ""}`} />
    <span class="shrink-0 text-ink-muted max-sm:hidden" data-top-bar-breadcrumb>
      <a href={projectsHref} class="rounded-sm transition-colors hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir">Projects</a>
      <span aria-hidden="true">/</span>
    </span>
    <h1 data-project-heading class="min-w-0 truncate font-medium text-ink max-sm:text-base max-sm:leading-[22px]">{title}</h1>
  </div>
  <div class="flex shrink-0 items-center gap-2.5">
    {@render status?.()}
    <a
      href={resolve("/changelog")}
      data-top-bar-bell
      aria-label={unseen > 0 ? `Notifications, ${unseen} new update${unseen === 1 ? "" : "s"}` : "Notifications"}
      class={`relative max-sm:hidden ${flush ? "max-xl:hidden" : ""} ${iconButton}`}
    >
      <IconBell size={16} strokeWidth={1.5} />
      {#if unseen > 0}
        <span aria-hidden="true" data-top-bar-bell-dot class="absolute top-2 right-[9px] size-1.5 rounded-full bg-primary"></span>
      {/if}
    </a>
    <!-- Desktop keeps Send for review at the right edge (board 2.1); the
         phone puts the More dots at the far right (H4). Each sits
         in the markup where it shows, so tab order matches the eye; the
         other is display:none. -->
    {#if moreItems.length > 0}
      {@render moreMenu("desktop")}
    {/if}
    {@render actions?.()}
    {#if moreItems.length > 0}
      {@render moreMenu("phone")}
    {/if}
  </div>
</header>
