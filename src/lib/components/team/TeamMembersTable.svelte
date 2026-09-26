<script lang="ts">
  // C1 members table: Name (260), Email (flex), Role (120), Last active
  // (110), plus a 28px actions column for Admin viewers (decision 54). 36px
  // header (12/16 muted on canvas), 48px rows, 24px avatars with 10px
  // initials in the person's own tone (the same seed as the rail).
  import Avatar from "$lib/components/ui/Avatar.svelte";
  import RoleChip from "$lib/components/ui/RoleChip.svelte";
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

<div data-team-members class="flex shrink-0 flex-col overflow-x-auto rounded-[10px] border border-line-soft">
  <div class="min-w-[720px]" role="table" aria-label="Team members">
    <div role="row" class="flex h-9 items-center gap-4 border-b border-line-soft bg-canvas px-4 text-xs leading-4 text-ink-muted">
      <span role="columnheader" class="w-[260px] shrink-0">Name</span>
      <span role="columnheader" class="min-w-0 flex-1">Email</span>
      <span role="columnheader" class="w-[120px] shrink-0">Role</span>
      <span role="columnheader" class="w-[110px] shrink-0">Last active</span>
      {#if showActions}<span role="columnheader" class="w-7 shrink-0"><span class="sr-only">Actions</span></span>{/if}
    </div>
    {#each members as member (member._id)}
      <div role="row" data-member-row={member._id} class="flex h-12 items-center gap-4 border-b border-line-soft px-4 last:border-b-0">
        <span role="cell" class="flex w-[260px] shrink-0 items-center gap-2.5">
          <Avatar name={member.name} initials={personInitials(member)} seed={member._id} size={24} />
          <span class="truncate text-[13px] leading-[19px] font-medium text-ink">{member.name}</span>
        </span>
        <span role="cell" class="min-w-0 flex-1 truncate text-[13px] leading-[19px] text-ink-secondary">{member.email ?? ""}</span>
        <span role="cell" class="flex w-[120px] shrink-0">
          <RoleChip role={member.role} isOwner={member.isOwner} isDeveloper={member.isDeveloper} />
        </span>
        <span role="cell" data-last-active class="w-[110px] shrink-0 text-[13px] leading-[19px] text-ink-muted">
          {lastActiveLabel(member.lastActiveAt, member.isSelf, now)}
        </span>
        {#if showActions}
          <span role="cell" class="flex w-7 shrink-0 justify-end">
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
