<script lang="ts">
  // C4 "Change role" submenu: a heading, one role chip per allowed role and a
  // check on the current one. Shared by the invite and member row menus.
  import { DropdownMenu } from "bits-ui";
  import { CaretRightIcon, CheckIcon, UserSwitchIcon } from "phosphor-svelte";
  import RoleChip from "$lib/components/ui/RoleChip.svelte";
  import type { Role } from "../../../../shared/roles";

  let {
    heading,
    roles,
    current,
    onSelect,
  }: {
    heading: string;
    roles: Role[];
    current: Role;
    onSelect: (role: Role) => void;
  } = $props();
</script>

<DropdownMenu.Sub>
  <DropdownMenu.SubTrigger
    data-menu-item="change-role"
    class="flex h-8 w-full cursor-default items-center gap-2 rounded-md px-2 text-[13px] text-ink outline-none data-[highlighted]:bg-workspace-rail-selected data-[state=open]:bg-workspace-rail-selected"
  >
    <UserSwitchIcon size={15} aria-hidden="true" class="text-ink-secondary" />
    <span class="flex-1">Change role</span>
    <CaretRightIcon size={12} aria-hidden="true" class="text-ink-muted" />
  </DropdownMenu.SubTrigger>
  <DropdownMenu.SubContent
    sideOffset={6}
    class="z-[110] w-56 rounded-xl border border-line bg-surface p-1.5 shadow-popover outline-none"
  >
    <DropdownMenu.Group>
      <DropdownMenu.GroupHeading class="px-2 pb-1 pt-1.5 text-xs leading-4 text-ink-muted">{heading}</DropdownMenu.GroupHeading>
      {#each roles as role (role)}
        <DropdownMenu.Item
          data-role-choice={role}
          aria-checked={role === current}
          onSelect={() => onSelect(role)}
          class="flex h-[34px] cursor-default items-center gap-2.5 rounded-md px-2 outline-none data-[highlighted]:bg-primary-wash"
        >
          <span class="flex w-3.5 shrink-0 justify-center">
            {#if role === current}<CheckIcon size={14} weight="bold" aria-label="Current role" class="text-ink" />{/if}
          </span>
          <RoleChip {role} />
        </DropdownMenu.Item>
      {/each}
    </DropdownMenu.Group>
  </DropdownMenu.SubContent>
</DropdownMenu.Sub>
