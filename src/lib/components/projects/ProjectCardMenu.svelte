<!--
  The "..." menu on a Projects page card (Paper V1, 2026-10-14 amendment;
  Open removed 2026-10-16, a click on the card opens it): Edit details,
  Duplicate and Delete. The trigger always shows in the card's stage band
  (Paper Z11a), so nothing is hover-only. It sits above the card's stretched title link
  (`relative z-10`). Duplicate and Delete appear only when the viewer may use
  them; the host decides (canCreateProjects, canDeleteProject) and opens the
  shared Delete dialog.
-->
<script lang="ts">
  import { DropdownMenu } from "bits-ui";
  import { CopyIcon, PencilSimpleIcon, TrashIcon } from "phosphor-svelte";

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
    class="relative z-10 flex size-6 shrink-0 items-center justify-center rounded-md text-ink-secondary transition-colors hover:bg-white/70 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-navy data-[state=open]:bg-white/70 motion-reduce:transition-none pointer-coarse:before:absolute pointer-coarse:before:-inset-[0.625rem] pointer-coarse:before:content-['']"
  >
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><circle cx="3" cy="7" r="1.3" fill="currentColor" /><circle cx="7" cy="7" r="1.3" fill="currentColor" /><circle cx="11" cy="7" r="1.3" fill="currentColor" /></svg>
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
