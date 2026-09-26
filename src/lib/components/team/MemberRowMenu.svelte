<script lang="ts">
  // Admin member actions on Team (decision 54; not on the boards, built in
  // C4's style): change role, set a temporary password, edit writing
  // preferences on /admin/users. Owner and Developer flags stay there.
  import { DropdownMenu } from "bits-ui";
  import { DotsThreeIcon, KeyIcon, PencilSimpleIcon } from "phosphor-svelte";
  import { resolve } from "$app/paths";
  import RoleSubmenu from "./RoleSubmenu.svelte";
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

  const item =
    "flex h-8 w-full cursor-default items-center gap-2 rounded-md px-2 text-[13px] text-ink outline-none data-[highlighted]:bg-workspace-rail-selected";
  const writingHref = $derived(`${resolve("/admin/users")}?user=${encodeURIComponent(userId)}`);
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger
    aria-label={`More actions for ${name}`}
    data-member-menu={userId}
    class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-muted hover:bg-primary-wash hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
  >
    <DotsThreeIcon size={16} weight="bold" aria-hidden="true" />
  </DropdownMenu.Trigger>
  <DropdownMenu.Portal>
    <DropdownMenu.Content
      side="bottom"
      align="end"
      sideOffset={4}
      class="z-[100] w-[232px] rounded-xl border border-line bg-surface p-1.5 shadow-popover outline-none"
    >
      <RoleSubmenu heading="Role" roles={["writer", "manager", "admin"]} current={role} onSelect={onChangeRole} />
      {#if !isSelf}
        <DropdownMenu.Item data-menu-item="password" onSelect={onSetPassword} class={item}>
          <KeyIcon size={15} aria-hidden="true" class="text-ink-secondary" />Set a temporary password
        </DropdownMenu.Item>
      {/if}
      <DropdownMenu.Item class={item}>
        {#snippet child({ props })}
          <a {...props} href={writingHref} data-menu-item="writing">
            <PencilSimpleIcon size={15} aria-hidden="true" class="text-ink-secondary" />Edit writing preferences
          </a>
        {/snippet}
      </DropdownMenu.Item>
    </DropdownMenu.Content>
  </DropdownMenu.Portal>
</DropdownMenu.Root>
