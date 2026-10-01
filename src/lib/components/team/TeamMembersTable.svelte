<script lang="ts">
  // C1 members table: Name (260), Email (flex), Role (120), Last active
  // (110). The Admin viewers' 28px row menu (decision 54) sits over the right
  // end of Last active rather than in a column of its own, so the columns
  // keep the board's positions (Role at x 1108 on C1). 36px
  // header (12/16 muted on canvas), 48px rows, 24px avatars with 10px
  // initials in their role's tone (the same rule as the rail).
  import Avatar from "$lib/components/ui/Avatar.svelte";
  import RoleChip from "$lib/components/ui/RoleChip.svelte";
  import { roleAvatarTone } from "$lib/components/ui/avatarTone";
  import { roleChipKind } from "$lib/roles/roleChip";
  import MemberRowMenu from "./MemberRowMenu.svelte";
  import { lastActiveLabel } from "$lib/team/teamFormat";
  import { personInitials } from "../../../../shared/personInitials";
  import type { Role } from "../../../../shared/roles";

  export type TeamMember = {
    _id: string;
    name: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    role: Role;
    isOwner: boolean;
    isDeveloper: boolean;
    lastActiveAt: number | null;
    isSelf: boolean;
  };

  let {
    members,
    now,
    showActions,
    onChangeRole,
    onSetPassword,
  }: {
    members: TeamMember[];
    now: number;
    showActions: boolean;
    onChangeRole: (member: TeamMember, role: Role) => void;
    onSetPassword: (member: TeamMember) => void;
  } = $props();
</script>

<div data-team-members class="flex shrink-0 flex-col overflow-x-auto rounded-[0.625rem] border border-line-soft">
  <div class="min-w-[45rem]" role="table" aria-label="Team members">
    <div role="row" class="flex h-9 items-center gap-4 border-b border-line-soft bg-canvas px-4 text-xs leading-4 text-ink-muted">
      <span role="columnheader" class="w-[16.25rem] shrink-0">Name</span>
      <span role="columnheader" class="min-w-0 flex-1">Email</span>
      <span role="columnheader" class="w-[7.5rem] shrink-0">Role</span>
      <span role="columnheader" class="w-[6.875rem] shrink-0">Last active</span>
      {#if showActions}<span role="columnheader" class="sr-only">Actions</span>{/if}
    </div>
    {#each members as member (member._id)}
      <div role="row" data-member-row={member._id} class="relative flex h-12 items-center gap-4 border-b border-line-soft px-4 last:border-b-0">
        <span role="cell" class="flex w-[16.25rem] shrink-0 items-center gap-2.5">
          <Avatar name={member.name} initials={personInitials(member)} tone={roleAvatarTone(roleChipKind(member))} size={24} />
          <span class="truncate text-[0.8125rem] leading-[1.1875rem] font-medium text-ink">{member.name}</span>
        </span>
        <span role="cell" class="min-w-0 flex-1 truncate text-[0.8125rem] leading-[1.1875rem] text-ink-secondary">{member.email ?? ""}</span>
        <span role="cell" class="flex w-[7.5rem] shrink-0">
          <RoleChip role={member.role} isOwner={member.isOwner} isDeveloper={member.isDeveloper} />
        </span>
        <span role="cell" data-last-active class={`w-[6.875rem] shrink-0 truncate text-[0.8125rem] leading-[1.1875rem] text-ink-muted ${showActions ? "pr-8" : ""}`}>
          {lastActiveLabel(member.lastActiveAt, member.isSelf, now)}
        </span>
        {#if showActions}
          <span role="cell" data-member-actions class="absolute right-4 top-1/2 flex w-7 -translate-y-1/2 justify-end">
            <MemberRowMenu
              name={member.name}
              userId={member._id}
              role={member.role}
              isSelf={member.isSelf}
              onChangeRole={(role) => onChangeRole(member, role)}
              onSetPassword={() => onSetPassword(member)}
            />
          </span>
        {/if}
      </div>
    {/each}
  </div>
</div>
