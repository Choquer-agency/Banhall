<script lang="ts">
  // C4 "Change role" submenu: a heading, one role chip per allowed role and a
  // check on the current one. Shared by the invite and member row menus.
  // Board values: 224px card, heading 12/16 muted (6/8/4 padding), 34px rows
  // with a 14px primary-selected check (stroke 2.2) and 4px-radius chips.
  import { DropdownMenu } from "bits-ui";
  import { IconCheck, IconChevronRight, IconUsers } from "$lib/components/icons";
  import RoleChip from "$lib/components/ui/RoleChip.svelte";
  import { MENU_CONTENT, MENU_ITEM } from "./menuStyles";
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
    class={`${MENU_ITEM} text-ink data-[state=open]:bg-workspace-rail-selected`}
  >
    <IconUsers size={15} strokeWidth={1.5} class="shrink-0" />
    <span class="flex-1">Change role</span>
    <IconChevronRight size={12} strokeWidth={2} class="shrink-0 text-ink-muted" />
  </DropdownMenu.SubTrigger>
  <DropdownMenu.SubContent sideOffset={6} class={`z-[110] w-56 ${MENU_CONTENT}`}>
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
            {#if role === current}<IconCheck size={14} strokeWidth={2.2} aria-label="Current role" aria-hidden="false" role="img" class="text-primary-selected" />{/if}
          </span>
          <RoleChip {role} radius={4} />
        </DropdownMenu.Item>
      {/each}
    </DropdownMenu.Group>
  </DropdownMenu.SubContent>
</DropdownMenu.Sub>
