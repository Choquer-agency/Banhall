<script lang="ts">
  // Admin actions on a past writer (Team, Past writers; writers from
  // initials, 2026-11-16, 2026-11-17): Invite to Banhall (not while an
  // invite for them waits), Link to a team member, Edit name, and Delete,
  // which is offered only when no file points at the writer. 2026-11-18
  // (second): Set weight.
  import { DropdownMenu } from "bits-ui";
  import { LinkIcon, ScalesIcon, TrashIcon, UserPlusIcon } from "phosphor-svelte";
  import { IconMore, IconPencil, IconTag } from "$lib/components/icons";
  import StaffRoleSubmenu from "./StaffRoleSubmenu.svelte";
  import { MENU_CONTENT, MENU_ITEM, ROW_MENU_TRIGGER } from "./menuStyles";
  import type { WriterStaffRole } from "../../../../shared/writerWeight";

  let {
    label,
    writerId,
    staffRole = null,
    canInvite,
    canDelete,
    onInvite,
    onEditName,
    onEditDetails = null,
    onChangeStaffRole = null,
    onLink,
    onSetWeight = null,
    onDelete,
  }: {
    label: string;
    writerId: string;
    staffRole?: WriterStaffRole | null;
    canInvite: boolean;
    canDelete: boolean;
    onInvite: () => void;
    onEditName: () => void;
    onEditDetails?: (() => void) | null;
    onChangeStaffRole?: ((staffRole: WriterStaffRole | null) => void) | null;
    onLink: () => void;
    /** Set weight (2026-11-18); absent: the item does not show. */
    onSetWeight?: (() => void) | null;
    onDelete: () => void;
  } = $props();
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger aria-label={`More actions for ${label}`} data-past-writer-menu={writerId} class={ROW_MENU_TRIGGER}>
    <IconMore size={16} strokeWidth={3} />
  </DropdownMenu.Trigger>
  <DropdownMenu.Portal>
    <DropdownMenu.Content side="bottom" align="end" sideOffset={4} class={`w-[14rem] ${MENU_CONTENT}`}>
      {#if canInvite}
        <DropdownMenu.Item data-menu-item="invite" onSelect={onInvite} class={`${MENU_ITEM} text-ink`}>
          <UserPlusIcon size="0.9375rem" aria-hidden="true" class="shrink-0" />Invite to Banhall
        </DropdownMenu.Item>
      {/if}
      <DropdownMenu.Item data-menu-item="link" onSelect={onLink} class={`${MENU_ITEM} text-ink`}>
        <LinkIcon size="0.9375rem" aria-hidden="true" class="shrink-0" />Link to a team member
      </DropdownMenu.Item>
      <DropdownMenu.Item data-menu-item="edit-name" onSelect={onEditName} class={`${MENU_ITEM} text-ink`}>
        <IconPencil size={15} strokeWidth={1.5} class="shrink-0" />Edit name
      </DropdownMenu.Item>
      {#if onEditDetails}
        <DropdownMenu.Item data-menu-item="edit-details" onSelect={onEditDetails} class={`${MENU_ITEM} text-ink`}>
          <IconTag size={15} strokeWidth={1.5} class="shrink-0" />Edit initials and status
        </DropdownMenu.Item>
      {/if}
      {#if onChangeStaffRole}
        <StaffRoleSubmenu current={staffRole} showDefaultWeights={Boolean(onSetWeight)} onSelect={onChangeStaffRole} />
      {/if}
      {#if onSetWeight}
        <DropdownMenu.Item data-menu-item="weight" onSelect={onSetWeight} class={`${MENU_ITEM} text-ink`}>
          <ScalesIcon size="0.9375rem" aria-hidden="true" class="shrink-0" />Set weight
        </DropdownMenu.Item>
      {/if}
      {#if canDelete}
        <DropdownMenu.Separator class="my-1 h-px bg-line-soft" />
        <DropdownMenu.Item data-menu-item="delete" onSelect={onDelete} class={`${MENU_ITEM} text-danger`}>
          <TrashIcon size="0.9375rem" aria-hidden="true" class="shrink-0" />Delete
        </DropdownMenu.Item>
      {/if}
    </DropdownMenu.Content>
  </DropdownMenu.Portal>
</DropdownMenu.Root>
