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
    PDS_COLUMN,
    PEOPLE_FRAME,
    PEOPLE_HEADER_ROW,
    PEOPLE_ROW,
    PEOPLE_TABLE,
    QUIET_TEXT,
    ROLE_COLUMN,
    WEIGHT_COLUMN,
  } from "./teamColumns";
  import type { Role } from "../../../../shared/roles";
  import {
    WRITER_STAFF_ROLE_LABELS,
    writerWeight,
    writerWeightText,
    type WriterStaffRole,
  } from "../../../../shared/writerWeight";

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
    /** The custom writer weight (0 to 1), or null for the default. Omitted unless Owner/Developer Admin. */
    weight?: number | null;
    /** Banhall PD staff role (technical_manager, technical_writer, junior_technical_writer, financial). */
    staffRole?: WriterStaffRole | null;
    /** Number of imported PDs linked to this member's writer profile. */
    pdCount?: number;
  };

  let {
    members,
    now,
    showActions,
    showWeights = false,
    onChangeRole,
    onChangeStaffRole = null,
    onSetPassword,
    onEditInitials,
    onSetWeight = null,
    onUnlinkWriter,
  }: {
    members: TeamMember[];
    now: number;
    showActions: boolean;
    showWeights?: boolean;
    onChangeRole: (member: TeamMember, role: Role) => void;
    onChangeStaffRole?: ((member: TeamMember, staffRole: WriterStaffRole | null) => void) | null;
    onSetPassword: (member: TeamMember) => void;
    onEditInitials: (member: TeamMember) => void;
    onSetWeight?: ((member: TeamMember) => void) | null;
    onUnlinkWriter: (member: TeamMember) => void;
  } = $props();
</script>

<div id="team-people" data-team-members class={PEOPLE_FRAME}>
  <div class={PEOPLE_TABLE} role="table" aria-label="Team members">
    <div role="row" class={PEOPLE_HEADER_ROW}>
      <span role="columnheader" class={NAME_COLUMN}>Name</span>
      <span role="columnheader" class={INITIALS_COLUMN}>Initials</span>
      <span role="columnheader" class={EMAIL_COLUMN}>Email</span>
      <span role="columnheader" class={PDS_COLUMN}>PDs</span>
      {#if showWeights}<span role="columnheader" class={WEIGHT_COLUMN}>Weight</span>{/if}
      <span role="columnheader" class={ROLE_COLUMN}>Role</span>
      <span role="columnheader" class={LAST_ACTIVE_COLUMN}>Last active</span>
      {#if showActions}<span role="columnheader" class="sr-only">Actions</span>{/if}
    </div>
    {#each members as member (member._id)}
      {@const pdCount = member.pdCount ?? 0}
      {@const effectiveWeight = writerWeight(member.weight, member.staffRole)}
      {@const hasCustomWeight = member.weight !== undefined && member.weight !== null}
      <div role="row" data-member-row={member._id} class={PEOPLE_ROW}>
        <!-- Plain names, no avatar (owner rule; Paper S11, 2026-10-28). -->
        <span role="cell" class={`flex items-center gap-2 ${NAME_COLUMN}`}>
          <span data-member-name class={NAME_TEXT}>{member.name}</span>
          {#if member.staffRole}
            <span data-member-staff-role class="shrink-0 truncate text-xs leading-[calc(4/3)] text-ink-muted">{WRITER_STAFF_ROLE_LABELS[member.staffRole]}</span>
          {/if}
        </span>
        <span role="cell" data-member-initials class={`${INITIALS_COLUMN} ${QUIET_TEXT}`}>{member.initials ?? ""}</span>
        <span role="cell" class={`${EMAIL_COLUMN} ${QUIET_TEXT}`}>{member.email ?? ""}</span>
        <span role="cell" data-member-pds class={`${PDS_COLUMN} ${pdCount > 0 ? QUIET_TEXT : MUTED_TEXT}`}>
          {pdCount > 0 ? pdCount : "-"}
        </span>
        {#if showWeights}
          <span role="cell" data-member-weight class={`${WEIGHT_COLUMN} flex justify-end`}>
            {#if onSetWeight}
              <button
                type="button"
                data-member-weight-button={member._id}
                onclick={() => onSetWeight(member)}
                title={hasCustomWeight ? "Custom writer weight - click to edit" : "Default writer weight - click to edit"}
                aria-label={`Edit weight for ${member.name} (${writerWeightText(effectiveWeight)})`}
                class={`inline-flex h-6 items-center rounded px-1.5 text-[0.8125rem] leading-[calc(19/13)] transition-colors hover:bg-primary-wash focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir ${
                  hasCustomWeight ? "font-medium text-ink" : "text-ink-muted"
                }`}
              >{writerWeightText(effectiveWeight)}</button>
            {:else}
              <span class={hasCustomWeight ? "text-[0.8125rem] leading-[calc(19/13)] font-medium text-ink" : MUTED_TEXT}>
                {writerWeightText(effectiveWeight)}
              </span>
            {/if}
          </span>
        {/if}
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
              staffRole={member.staffRole ?? null}
              isSelf={member.isSelf}
              linkedWriterLabel={member.linkedWriter?.label ?? null}
              onChangeRole={(role) => onChangeRole(member, role)}
              onChangeStaffRole={onChangeStaffRole ? (staffRole) => onChangeStaffRole(member, staffRole) : null}
              onSetPassword={() => onSetPassword(member)}
              onEditInitials={() => onEditInitials(member)}
              onSetWeight={showWeights && onSetWeight ? () => onSetWeight(member) : null}
              onUnlinkWriter={member.linkedWriter ? () => onUnlinkWriter(member) : null}
            />
          </span>
        {/if}
      </div>
    {/each}
  </div>
</div>
