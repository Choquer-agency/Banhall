<script lang="ts">
  // Admin member actions on Team (decision 54; not on the boards, built in
  // C4's style): change role, set a temporary password, edit writing
  // preferences on /admin/users. Owner and Developer flags stay there.
  // 2026-11-16 (writers from initials): edit the initials Import matches
  // file names against, and unlink a past writer an Admin linked to them.
  // 2026-11-18 (second): set the person's writer weight.
  import { DropdownMenu } from "bits-ui";
  import { LinkBreakIcon, ScalesIcon } from "phosphor-svelte";
  import { IconLock, IconMore, IconPencil, IconTag } from "$lib/components/icons";
  import { resolve } from "$app/paths";
  import RoleSubmenu from "./RoleSubmenu.svelte";
  import StaffRoleSubmenu from "./StaffRoleSubmenu.svelte";
  import { MENU_CONTENT, MENU_ITEM, ROW_MENU_TRIGGER } from "./menuStyles";
  import type { Role } from "../../../../shared/roles";
  import type { WriterStaffRole } from "../../../../shared/writerWeight";

  let {
    name,
    userId,
    role,
    staffRole = null,
    isSelf,
    linkedWriterLabel = null,
    onChangeRole,
    onChangeStaffRole = null,
    onSetPassword,
    onEditInitials,
    onSetWeight = null,
    onUnlinkWriter = null,
  }: {
    name: string;
    userId: string;
    role: Role;
    staffRole?: WriterStaffRole | null;
    isSelf: boolean;
    /** The past writer an Admin linked to this person ("DW"), if any. */
    linkedWriterLabel?: string | null;
    onChangeRole: (role: Role) => void;
    onChangeStaffRole?: ((staffRole: WriterStaffRole | null) => void) | null;
    onSetPassword: () => void;
    onEditInitials: () => void;
    /** Set weight (2026-11-18); absent: the item does not show. */
    onSetWeight?: (() => void) | null;
    onUnlinkWriter?: (() => void) | null;
  } = $props();

  const writingHref = $derived(`${resolve("/admin/users")}?user=${encodeURIComponent(userId)}`);
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger aria-label={`More actions for ${name}`} data-member-menu={userId} class={ROW_MENU_TRIGGER}>
    <IconMore size={16} strokeWidth={3} />
  </DropdownMenu.Trigger>
  <DropdownMenu.Portal>
    <DropdownMenu.Content side="bottom" align="end" sideOffset={4} class={`w-[14.5rem] ${MENU_CONTENT}`}>
      <RoleSubmenu heading="Role" roles={["writer", "manager", "admin"]} current={role} onSelect={onChangeRole} />
      {#if onChangeStaffRole}
        <StaffRoleSubmenu current={staffRole} onSelect={onChangeStaffRole} />
      {/if}
      {#if !isSelf}
        <DropdownMenu.Item data-menu-item="password" onSelect={onSetPassword} class={`${MENU_ITEM} text-ink`}>
          <IconLock size={15} strokeWidth={1.5} class="shrink-0" />Set a temporary password
        </DropdownMenu.Item>
      {/if}
      <DropdownMenu.Item data-menu-item="initials" onSelect={onEditInitials} class={`${MENU_ITEM} text-ink`}>
        <IconTag size={15} strokeWidth={1.5} class="shrink-0" />Edit initials
      </DropdownMenu.Item>
      {#if onSetWeight}
        <DropdownMenu.Item data-menu-item="weight" onSelect={onSetWeight} class={`${MENU_ITEM} text-ink`}>
          <ScalesIcon size="0.9375rem" aria-hidden="true" class="shrink-0" />Set weight
        </DropdownMenu.Item>
      {/if}
      {#if linkedWriterLabel && onUnlinkWriter}
        <DropdownMenu.Item data-menu-item="unlink-writer" onSelect={onUnlinkWriter} class={`${MENU_ITEM} text-ink`}>
          <LinkBreakIcon size="0.9375rem" aria-hidden="true" class="shrink-0" /><span class="truncate">Unlink past writer {linkedWriterLabel}</span>
        </DropdownMenu.Item>
      {/if}
      <DropdownMenu.Item class={`${MENU_ITEM} text-ink`}>
        {#snippet child({ props })}
          <a {...props} href={writingHref} data-menu-item="writing">
            <IconPencil size={15} strokeWidth={1.5} class="shrink-0" />Edit writing preferences
          </a>
        {/snippet}
      </DropdownMenu.Item>
    </DropdownMenu.Content>
  </DropdownMenu.Portal>
</DropdownMenu.Root>
