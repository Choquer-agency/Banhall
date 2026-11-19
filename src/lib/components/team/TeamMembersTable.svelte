<script lang="ts">
  // C1 members table: Name (260), Initials (56, 2026-11-16: the saved
  // initials Import matches file names against), Email (flex), Role (120),
  // Last active (110). The Admin viewers' 28px row menu (decision 54) sits over the right
  // end of Last active rather than in a column of its own, so the columns
  // keep the board's positions (Role at x 1108 on C1). 36px
  // header (12/16 muted on canvas), 48px rows, plain names with no avatar
  // (owner rule, Paper S11). The columns are teamColumns.ts, shared with
  // Past writers (2026-11-17) so the two tables line up.
  import RoleChip from "$lib/components/ui/RoleChip.svelte";
  import MemberRowMenu from "./MemberRowMenu.svelte";
  import { lastActiveLabel } from "$lib/team/teamFormat";
  import {
    EMAIL_COLUMN,
    INITIALS_COLUMN,
    LAST_ACTIVE_COLUMN,
    MENU_CELL,
    MENU_ROOM,
    MUTED_TEXT,
    NAME_COLUMN,
    NAME_TEXT,
    PEOPLE_FRAME,
    PEOPLE_HEADER_ROW,
    PEOPLE_ROW,
    PEOPLE_TABLE,
    QUIET_TEXT,
    ROLE_COLUMN,
  } from "./teamColumns";
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
    /** Saved initials, or null for none (2026-11-16). */
    initials: string | null;
    /** The past writer an Admin linked to this account, if any. */
    linkedWriter: { writerId: string; label: string; initials: string | null; fileCount: number } | null;
  };

  let {
    members,
    now,
    showActions,
    onChangeRole,
    onSetPassword,
    onEditInitials,
    onUnlinkWriter,
  }: {
    members: TeamMember[];
    now: number;
    showActions: boolean;
    onChangeRole: (member: TeamMember, role: Role) => void;
    onSetPassword: (member: TeamMember) => void;
    onEditInitials: (member: TeamMember) => void;
    onUnlinkWriter: (member: TeamMember) => void;
  } = $props();
</script>

<div id="team-people" data-team-members class={PEOPLE_FRAME}>
  <div class={PEOPLE_TABLE} role="table" aria-label="Team members">
    <div role="row" class={PEOPLE_HEADER_ROW}>
      <span role="columnheader" class={NAME_COLUMN}>Name</span>
      <span role="columnheader" class={INITIALS_COLUMN}>Initials</span>
      <span role="columnheader" class={EMAIL_COLUMN}>Email</span>
      <span role="columnheader" class={ROLE_COLUMN}>Role</span>
      <span role="columnheader" class={LAST_ACTIVE_COLUMN}>Last active</span>
      {#if showActions}<span role="columnheader" class="sr-only">Actions</span>{/if}
    </div>
    {#each members as member (member._id)}
      <div role="row" data-member-row={member._id} class={PEOPLE_ROW}>
        <!-- Plain names, no avatar (owner rule; Paper S11, 2026-10-28). -->
        <span role="cell" class={`flex items-center ${NAME_COLUMN}`}>
          <span data-member-name class={NAME_TEXT}>{member.name}</span>
        </span>
        <span role="cell" data-member-initials class={`${INITIALS_COLUMN} ${QUIET_TEXT}`}>{member.initials ?? ""}</span>
        <span role="cell" class={`${EMAIL_COLUMN} ${QUIET_TEXT}`}>{member.email ?? ""}</span>
        <span role="cell" class={`flex ${ROLE_COLUMN}`}>
          <RoleChip role={member.role} isOwner={member.isOwner} isDeveloper={member.isDeveloper} />
        </span>
        <span role="cell" data-last-active class={`${LAST_ACTIVE_COLUMN} ${MUTED_TEXT} ${showActions ? MENU_ROOM : ""}`}>
          {lastActiveLabel(member.lastActiveAt, member.isSelf, now)}
        </span>
        {#if showActions}
          <span role="cell" data-member-actions class={MENU_CELL}>
            <MemberRowMenu
              name={member.name}
              userId={member._id}
              role={member.role}
              isSelf={member.isSelf}
              linkedWriterLabel={member.linkedWriter?.label ?? null}
              onChangeRole={(role) => onChangeRole(member, role)}
              onSetPassword={() => onSetPassword(member)}
              onEditInitials={() => onEditInitials(member)}
              onUnlinkWriter={member.linkedWriter ? () => onUnlinkWriter(member) : null}
            />
          </span>
        {/if}
      </div>
    {/each}
  </div>
</div>
