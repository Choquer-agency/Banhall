<script lang="ts">
  // Admin member actions on Team (decision 54; not on the boards, built in
  // C4's style): change role, set a temporary password, edit writing
  // preferences on /admin/users. Owner and Developer flags stay there.
  import { DropdownMenu } from "bits-ui";
  import { IconLock, IconMore, IconPencil } from "$lib/components/icons";
  import { resolve } from "$app/paths";
  import RoleSubmenu from "./RoleSubmenu.svelte";
  import { MENU_CONTENT, MENU_ITEM, ROW_MENU_TRIGGER } from "./menuStyles";
  import type { Role } from "../../../../shared/roles";

  let {
    name,
    userId,
    role,
    isSelf,
    onChangeRole,
    onSetPassword,
  }: {
    name: string;
    userId: string;
    role: Role;
    isSelf: boolean;
    onChangeRole: (role: Role) => void;
    onSetPassword: () => void;
  } = $props();

  const writingHref = $derived(`${resolve("/admin/users")}?user=${encodeURIComponent(userId)}`);
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger aria-label={`More actions for ${name}`} data-member-menu={userId} class={ROW_MENU_TRIGGER}>
    <IconMore size={16} strokeWidth={3} />
  </DropdownMenu.Trigger>
  <DropdownMenu.Portal>
    <DropdownMenu.Content side="bottom" align="end" sideOffset={4} class={`w-[232px] ${MENU_CONTENT}`}>
      <RoleSubmenu heading="Role" roles={["writer", "manager", "admin"]} current={role} onSelect={onChangeRole} />
      {#if !isSelf}
        <DropdownMenu.Item data-menu-item="password" onSelect={onSetPassword} class={`${MENU_ITEM} text-ink`}>
          <IconLock size={15} strokeWidth={1.5} class="shrink-0" />Set a temporary password
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
