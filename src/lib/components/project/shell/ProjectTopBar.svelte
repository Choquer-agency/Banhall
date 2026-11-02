<!--
  Project top bar (the page frame, owner 2026-10-28; Paper A1, S12, P0):
  52px inside the white card, 12px sides, 8px gaps and a soft line under it.
  The 30px outlined back button on every width, "Projects /" in muted ink
  and the project title (the route's single h1) at 14/20 500, then 6px
  apart the page actions (Export, Send for review) and the "..." More menu
  last. Tools the screens do not show (AI review, Share, Compare, History,
  Financial) sit in the More menu (decision 19). The bell lives in the
  global bar; below 1024px, with no global bar, the bar keeps the hamburger
  (from 640px) and the bell as before. A phone (H4) shows the back button,
  the title and More.

  `flush` (Reading the interview, H3 and H4): only the phone keeps the More
  dots there (H4); F2 and H3 show none.

  Star (2026-11-02): with `projectId`, the person's private star sits right
  after the title (`ProjectStarButton`, 30px, 44px on touch screens).
-->
<script lang="ts" module>
  export type TopBarMoreItem = {
    id: string;
    label: string;
    onSelect?: () => void;
    href?: string;
    disabled?: boolean;
    /** A destructive action (Delete project): red, after a divider. */
    danger?: boolean;
  };
</script>

<script lang="ts">
  import type { Snippet } from "svelte";
  import { DropdownMenu } from "bits-ui";
  import { TrashIcon } from "phosphor-svelte";
  import { IconBell } from "$lib/components/icons";
  import FrameIcon from "$lib/components/workspace/FrameIcon.svelte";
  import { resolve } from "$app/paths";
  import { useQuery } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { api } from "../../../../../convex/_generated/api";
  import type { Id } from "../../../../../convex/_generated/dataModel";
  import { whatsNewLabel } from "$lib/shell/navigation";
  import WorkspaceShellControls from "$lib/components/workspace/WorkspaceShellControls.svelte";
  import ProjectStarButton from "$lib/components/projects/ProjectStarButton.svelte";

  let {
    title,
    projectsHref,
    onOpenNavigation,
    leading,
    status,
    actions,
    moreItems = [],
    flush = false,
    projectId = null,
  }: {
    title: string;
    projectsHref: string;
    onOpenNavigation: () => void;
    /** Extra controls right after the rail controls (e.g. reopen a closed pane). */
    leading?: Snippet;
    /** Quiet state before the actions (saving, errors, list paging). */
    status?: Snippet;
    /** Page actions (Export, Send for review, Cancel generation), before More. */
    actions?: Snippet;
    moreItems?: TopBarMoreItem[];
    /** Reading the interview (H3, H4): More on a phone only. */
    flush?: boolean;
    /** The project, for the star after the title; none without it. */
    projectId?: string | null;
  } = $props();

  const auth = useAuth();
  const unseenQ = useQuery(api.changelog.unseenCount, () => (auth.isAuthenticated ? {} : "skip"));
  const unseen = $derived(unseenQ.data ?? 0);
  const starQ = useQuery(api.projects.isProjectStarred, () =>
    auth.isAuthenticated && projectId ? { projectId: projectId as Id<"projects"> } : "skip"
  );

  const focusRing =
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir";
  // Paper A1: 30px buttons, radius 7; 44px on a phone (H4) and on coarse pointers.
  const iconButton = `flex size-[1.875rem] shrink-0 items-center justify-center rounded-[0.4375rem] text-ink-secondary transition-colors hover:bg-primary-wash hover:text-ink ${focusRing} data-[state=open]:bg-primary-wash max-sm:size-11 pointer-coarse:size-11`;
</script>

{#snippet moreMenu()}
  <DropdownMenu.Root>
    <DropdownMenu.Trigger
      aria-label="More actions"
      class={`${iconButton} max-sm:text-ink ${flush ? "sm:hidden" : ""}`}
      data-top-bar-more
    >
      <FrameIcon name="more" />
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
            <DropdownMenu.Item disabled={item.disabled} class="rounded-md text-[0.8125rem] text-ink outline-none data-[highlighted]:bg-primary-wash data-[disabled]:opacity-50">
              {#snippet child({ props })}
                <a {...props} href={item.href} data-top-bar-more-item={item.id} class="flex h-8 w-full items-center rounded-md px-2.5 text-[0.8125rem] text-ink outline-none data-[highlighted]:bg-primary-wash">{item.label}</a>
              {/snippet}
            </DropdownMenu.Item>
          {:else if item.danger}
            <DropdownMenu.Separator class="mx-1 my-1 h-px bg-line-soft" />
            <DropdownMenu.Item
              disabled={item.disabled}
              onSelect={item.onSelect}
              data-top-bar-more-item={item.id}
              class="flex h-8 w-full cursor-default items-center gap-2 rounded-md px-2.5 text-[0.8125rem] text-danger-ink-muted outline-none data-[highlighted]:bg-danger-surface data-[disabled]:opacity-50"
            >
              <TrashIcon size="0.875rem" aria-hidden="true" />
              {item.label}
            </DropdownMenu.Item>
          {:else}
            <DropdownMenu.Item
              disabled={item.disabled}
              onSelect={item.onSelect}
              data-top-bar-more-item={item.id}
              class="flex h-8 w-full cursor-default items-center rounded-md px-2.5 text-[0.8125rem] text-ink outline-none data-[highlighted]:bg-primary-wash data-[disabled]:opacity-50"
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
  data-project-top-bar
  data-top-bar-flush={flush || undefined}
  class="flex h-[3.25rem] shrink-0 items-center gap-2 border-b border-line-soft bg-surface px-3"
>
  <!-- From 640px to 1024px the drawer's hamburger leads, as before. -->
  <div class="contents max-sm:hidden">
    <WorkspaceShellControls tone="light" {onOpenNavigation} />
  </div>
  <a
    href={projectsHref}
    aria-label="Back to projects"
    data-top-bar-back
    class={`flex size-[1.875rem] shrink-0 items-center justify-center rounded-[0.4375rem] border border-line bg-surface text-ink transition-colors hover:bg-primary-wash ${focusRing} motion-reduce:transition-none max-sm:size-11 pointer-coarse:size-11`}
  >
    <FrameIcon name="back" />
  </a>
  {@render leading?.()}
  <div class="flex min-w-0 flex-1 items-center gap-2 text-sm leading-[calc(10/7)]">
    <span class="shrink-0 whitespace-pre text-ink-muted max-sm:hidden" data-top-bar-breadcrumb><a
        href={projectsHref}
        class={`rounded-sm transition-colors hover:text-ink ${focusRing}`}
      >Projects</a><span aria-hidden="true">{" /"}</span></span>
    <h1 data-project-heading class="min-w-0 truncate font-medium text-ink max-sm:text-base max-sm:leading-[1.375]">{title}</h1>
    {#if projectId && starQ.data !== undefined}
      <ProjectStarButton {projectId} projectTitle={title} starred={starQ.data} variant="bar" class="-ml-1" />
    {/if}
  </div>
  <div class="flex shrink-0 items-center gap-1.5">
    {@render status?.()}
    <a
      href={resolve("/changelog")}
      data-top-bar-bell
      aria-label={whatsNewLabel(unseen)}
      class={`relative max-sm:hidden lg:hidden ${iconButton}`}
    >
      <IconBell size={16} strokeWidth={1.5} />
      {#if unseen > 0}
        <span aria-hidden="true" data-top-bar-bell-dot class="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-primary"></span>
      {/if}
    </a>
    {@render actions?.()}
    <!-- Paper A1: "..." last, after the page actions, on every width. -->
    {#if moreItems.length > 0}
      {@render moreMenu()}
    {/if}
  </div>
</header>
