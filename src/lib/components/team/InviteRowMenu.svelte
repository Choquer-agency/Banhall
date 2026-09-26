<script lang="ts">
  // C4 pending invite row menu: copy the link, change the role the invite
  // grants, make a fresh link, revoke. Admin appears in "Invite as" only for
  // viewers who may invite Admins (roles.manage).
  import { DropdownMenu } from "bits-ui";
  import { ArrowClockwiseIcon, DotsThreeIcon, LinkIcon, ProhibitIcon } from "phosphor-svelte";
  import RoleSubmenu from "./RoleSubmenu.svelte";
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
  const item =
    "flex h-8 w-full cursor-default items-center gap-2 rounded-md px-2 text-[13px] text-ink outline-none data-[highlighted]:bg-workspace-rail-selected";
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger
    aria-label={`More actions for the invite to ${email}`}
    data-invite-menu={email}
    class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-muted hover:bg-primary-wash hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
  >
    <DotsThreeIcon size={16} weight="bold" aria-hidden="true" />
  </DropdownMenu.Trigger>
  <DropdownMenu.Portal>
    <DropdownMenu.Content
      side="bottom"
      align="end"
      sideOffset={4}
      class="z-[100] w-[216px] rounded-xl border border-line bg-surface p-1.5 shadow-popover outline-none"
    >
      <DropdownMenu.Item data-menu-item="copy" onSelect={onCopy} class={item}>
        <LinkIcon size={15} aria-hidden="true" class="text-ink-secondary" />Copy invite link
      </DropdownMenu.Item>
      <RoleSubmenu heading="Invite as" {roles} current={role} onSelect={onChangeRole} />
      <DropdownMenu.Item data-menu-item="resend" onSelect={onResend} class={item}>
        <ArrowClockwiseIcon size={15} aria-hidden="true" class="text-ink-secondary" />Resend invite
      </DropdownMenu.Item>
      <DropdownMenu.Separator class="my-1 h-px bg-line-soft" />
      <DropdownMenu.Item data-menu-item="revoke" onSelect={onRevoke} class={`${item} text-danger`}>
        <ProhibitIcon size={15} aria-hidden="true" />Revoke invite
      </DropdownMenu.Item>
    </DropdownMenu.Content>
  </DropdownMenu.Portal>
</DropdownMenu.Root>
