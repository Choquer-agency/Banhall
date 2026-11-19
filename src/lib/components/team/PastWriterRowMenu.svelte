<script lang="ts">
  // Admin actions on a past writer (Team, Past writers; writers from
  // initials, 2026-11-16): Edit name, Link to an account, and Delete, which
  // is offered only when no file points at the writer.
  import { DropdownMenu } from "bits-ui";
  import { LinkIcon, TrashIcon } from "phosphor-svelte";
  import { IconMore, IconPencil } from "$lib/components/icons";
  import { MENU_CONTENT, MENU_ITEM, ROW_MENU_TRIGGER } from "./menuStyles";

  let {
    label,
    writerId,
    canDelete,
    onEditName,
    onLink,
    onDelete,
  }: {
    label: string;
    writerId: string;
    canDelete: boolean;
    onEditName: () => void;
    onLink: () => void;
    onDelete: () => void;
  } = $props();
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger aria-label={`More actions for ${label}`} data-past-writer-menu={writerId} class={ROW_MENU_TRIGGER}>
    <IconMore size={16} strokeWidth={3} />
  </DropdownMenu.Trigger>
  <DropdownMenu.Portal>
    <DropdownMenu.Content side="bottom" align="end" sideOffset={4} class={`w-[13.5rem] ${MENU_CONTENT}`}>
      <DropdownMenu.Item data-menu-item="edit-name" onSelect={onEditName} class={`${MENU_ITEM} text-ink`}>
        <IconPencil size={15} strokeWidth={1.5} class="shrink-0" />Edit name
      </DropdownMenu.Item>
      <DropdownMenu.Item data-menu-item="link" onSelect={onLink} class={`${MENU_ITEM} text-ink`}>
        <LinkIcon size="0.9375rem" aria-hidden="true" class="shrink-0" />Link to an account
      </DropdownMenu.Item>
      {#if canDelete}
        <DropdownMenu.Separator class="my-1 h-px bg-line-soft" />
        <DropdownMenu.Item data-menu-item="delete" onSelect={onDelete} class={`${MENU_ITEM} text-danger`}>
          <TrashIcon size="0.9375rem" aria-hidden="true" class="shrink-0" />Delete
        </DropdownMenu.Item>
      {/if}
    </DropdownMenu.Content>
  </DropdownMenu.Portal>
</DropdownMenu.Root>
