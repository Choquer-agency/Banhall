<!--
  Project top bar (ui-design-final.md section 2): page icon, "Projects /"
  breadcrumb and the project title (the route's single h1) on the left; on
  the right the bell, then the page actions. On a phone (board 3.6) it is a
  back chevron, the title and the More menu. Tools the screens do not show
  (AI review, Share, Compare, History, Financial) sit in a More menu
  (decision 19).
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
  import { BellIcon, CaretLeftIcon, DotsThreeIcon, DotsThreeVerticalIcon, FileTextIcon } from "phosphor-svelte";
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
  } = $props();

  const auth = useAuth();
  const unseenQ = useQuery(api.changelog.unseenCount, () => (auth.isAuthenticated ? {} : "skip"));
  const unseen = $derived(unseenQ.data ?? 0);

  const iconButton =
    "flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-secondary transition-colors hover:bg-primary-wash hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir data-[state=open]:bg-primary-wash pointer-coarse:size-11";
</script>

<header data-workspace-page-header class="flex h-14 shrink-0 items-center gap-2 px-3 sm:px-5">
  <!-- Phone (board 3.6): a back chevron to Projects replaces the menu button
       and the breadcrumb; from 640px the workspace controls return. -->
  <a
    href={projectsHref}
    aria-label="Back to projects"
    data-top-bar-back
    class="-ml-2 flex size-11 shrink-0 items-center justify-center rounded-lg text-ink-secondary transition-colors hover:bg-primary-wash hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir motion-reduce:transition-none sm:hidden"
  >
    <CaretLeftIcon size={18} aria-hidden="true" />
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
  <div class="flex min-w-0 flex-1 items-center gap-2 text-sm">
    <FileTextIcon size={16} aria-hidden="true" class="shrink-0 text-primary-selected max-sm:hidden" />
    <a href={projectsHref} class="shrink-0 text-ink-muted transition-colors hover:text-ink max-sm:hidden">Projects</a>
    <span aria-hidden="true" class="text-ink-faint max-sm:hidden">/</span>
    <h1 data-project-heading class="min-w-0 truncate text-sm font-medium text-ink">{title}</h1>
  </div>
  <div class="flex shrink-0 items-center gap-2">
    {@render status?.()}
    <a
      href={resolve("/changelog")}
      data-top-bar-bell
      aria-label={unseen > 0 ? `Notifications, ${unseen} new update${unseen === 1 ? "" : "s"}` : "Notifications"}
      class={`relative max-sm:hidden ${iconButton}`}
    >
      <BellIcon size={17} aria-hidden="true" />
      {#if unseen > 0}
        <span aria-hidden="true" class="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-primary"></span>
      {/if}
    </a>
    {#if moreItems.length > 0}
      <DropdownMenu.Root>
        <!-- Phone (board 3.6): a vertical kebab at the far right. -->
        <DropdownMenu.Trigger aria-label="More actions" class={`${iconButton} max-sm:order-last`} data-top-bar-more>
          <DotsThreeIcon size={18} weight="bold" aria-hidden="true" class="max-sm:hidden" />
          <DotsThreeVerticalIcon size={18} weight="bold" aria-hidden="true" class="sm:hidden" />
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
    {/if}
    {@render actions?.()}
  </div>
</header>
