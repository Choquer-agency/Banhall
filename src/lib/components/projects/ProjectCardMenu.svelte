<!--
  The "..." menu on a Projects page card (Paper V1, 2026-10-14 amendment;
  Open removed 2026-10-16, a click on the card opens it): Edit details,
  Duplicate and Delete. The trigger shows on card hover
  and on keyboard focus inside the card, and always on touch screens, so
  nothing is hover-only. It sits above the card's stretched title link
  (`relative z-10`). Duplicate and Delete appear only when the viewer may use
  them; the host decides (canCreateProjects, canDeleteProject) and opens the
  shared Delete dialog.
-->
<script lang="ts">
  import { DropdownMenu } from "bits-ui";
  import { CopyIcon, PencilSimpleIcon, TrashIcon } from "phosphor-svelte";
  import { IconMore } from "$lib/components/icons";

  let {
    projectId,
    projectTitle,
    canDuplicate = false,
    canDelete = false,
    onEditDetails,
    onDuplicate,
    onDelete,
  }: {
    projectId: string;
    projectTitle: string;
    canDuplicate?: boolean;
    canDelete?: boolean;
    onEditDetails: () => void;
    onDuplicate: () => void;
    onDelete: () => void;
  } = $props();

  const item =
    "flex h-8 w-full cursor-default items-center gap-2 rounded-md px-2 text-[0.8125rem] text-ink outline-none data-[highlighted]:bg-primary-wash pointer-coarse:h-11";
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger
    aria-label={`More actions for ${projectTitle}`}
    data-card-menu={projectId}
    class="relative z-10 -my-0.5 flex size-[1.375rem] shrink-0 items-center justify-center rounded-[0.3125rem] border border-line bg-surface text-ink opacity-0 transition-opacity hover:bg-primary-wash focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-navy group-hover/project:opacity-100 group-focus-within/project:opacity-100 data-[state=open]:opacity-100 motion-reduce:transition-none pointer-coarse:opacity-100 pointer-coarse:before:absolute pointer-coarse:before:-inset-[0.6875rem] pointer-coarse:before:content-['']"
  >
    <IconMore size={14} strokeWidth={2.4} />
  </DropdownMenu.Trigger>
  <DropdownMenu.Portal>
    <DropdownMenu.Content
      side="bottom"
      align="end"
      sideOffset={6}
      data-card-menu-content={projectId}
      class="z-[100] min-w-[11.25rem] rounded-xl border border-line bg-surface p-1.5 shadow-menu outline-none"
    >
      <DropdownMenu.Item onSelect={onEditDetails} data-card-menu-item="edit" class={item}>
        <PencilSimpleIcon size="0.9375rem" class="text-ink-muted" aria-hidden="true" />
        Edit details
      </DropdownMenu.Item>
      {#if canDuplicate}
        <DropdownMenu.Item onSelect={onDuplicate} data-card-menu-item="duplicate" class={item}>
          <CopyIcon size="0.9375rem" class="text-ink-muted" aria-hidden="true" />
          Duplicate
        </DropdownMenu.Item>
      {/if}
      {#if canDelete}
        <DropdownMenu.Separator class="mx-1 my-1 h-px bg-line-soft" />
        <DropdownMenu.Item
          onSelect={onDelete}
          data-card-menu-item="delete"
          class="flex h-8 w-full cursor-default items-center gap-2 rounded-md px-2 text-[0.8125rem] text-danger-ink-muted outline-none data-[highlighted]:bg-danger-surface pointer-coarse:h-11"
        >
          <TrashIcon size="0.9375rem" aria-hidden="true" />
          Delete
        </DropdownMenu.Item>
      {/if}
    </DropdownMenu.Content>
  </DropdownMenu.Portal>
</DropdownMenu.Root>
