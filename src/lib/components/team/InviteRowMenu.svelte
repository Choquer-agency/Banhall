<script lang="ts">
  // C4 pending invite row menu: copy the link, change the role the invite
  // grants, make a fresh link, revoke. Admin appears in "Invite as" only for
  // viewers who may invite Admins (roles.manage). Board values: 220px menu,
  // 6px padding, radius 12, the menu shadow; 32px items with 15px icons
  // (stroke 1.5) in ink and 13/19 text; Revoke in the danger red.
  import { DropdownMenu } from "bits-ui";
  import { IconArrowLeft, IconBook, IconLogout, IconMore } from "$lib/components/icons";
  import RoleSubmenu from "./RoleSubmenu.svelte";
  import { MENU_CONTENT, MENU_ITEM, ROW_MENU_TRIGGER } from "./menuStyles";
  import type { Role } from "../../../../shared/roles";

  let {
    email,
    role,
    canInviteAdmin,
    onCopy,
    onChangeRole,
    onResend,
    onRevoke,
  }: {
    email: string;
    role: Role;
    canInviteAdmin: boolean;
    onCopy: () => void;
    onChangeRole: (role: Role) => void;
    onResend: () => void;
    onRevoke: () => void;
  } = $props();

  const roles = $derived<Role[]>(canInviteAdmin ? ["writer", "manager", "admin"] : ["writer", "manager"]);
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger
    aria-label={`More actions for the invite to ${email}`}
    data-invite-menu={email}
    class={ROW_MENU_TRIGGER}
  >
    <IconMore size={16} strokeWidth={3} />
  </DropdownMenu.Trigger>
  <DropdownMenu.Portal>
    <DropdownMenu.Content side="bottom" align="end" sideOffset={4} class={`w-[220px] ${MENU_CONTENT}`}>
      <DropdownMenu.Item data-menu-item="copy" onSelect={onCopy} class={`${MENU_ITEM} text-ink`}>
        <IconBook size={15} strokeWidth={1.5} class="shrink-0" />Copy invite link
      </DropdownMenu.Item>
      <RoleSubmenu heading="Invite as" {roles} current={role} onSelect={onChangeRole} />
      <DropdownMenu.Item data-menu-item="resend" onSelect={onResend} class={`${MENU_ITEM} text-ink`}>
        <IconArrowLeft size={15} strokeWidth={1.5} class="shrink-0" />Resend invite
      </DropdownMenu.Item>
      <DropdownMenu.Separator class="my-1 h-px bg-line-soft" />
      <DropdownMenu.Item data-menu-item="revoke" onSelect={onRevoke} class={`${MENU_ITEM} text-danger`}>
        <IconLogout size={15} strokeWidth={1.5} class="shrink-0" />Revoke invite
      </DropdownMenu.Item>
    </DropdownMenu.Content>
  </DropdownMenu.Portal>
</DropdownMenu.Root>
