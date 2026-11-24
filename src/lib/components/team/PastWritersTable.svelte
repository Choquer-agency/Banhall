<script lang="ts">
  // Team, Past writers (writers from initials, 2026-11-16; owner, 2026-11-17:
  // "same layout as above"): the writers with no login that imported PDs
  // point at, under the members and pending invites, shown only when there
  // is at least one. The same grid as the members table (teamColumns.ts):
  // Name (its name, or its initials), Initials, Email (empty), Role (a quiet
  // "No login" tag), Last active ("Invite sent" while an invite an Admin
  // sent for it waits). Admins get a row menu: Invite to Banhall, Link to a
  // team member, Edit name, and Delete when no file points at it. Others
  // see it read only. Where a name came from and how many PDs point at a
  // writer stay on the server, not on this table.
  import PastWriterRowMenu from "./PastWriterRowMenu.svelte";
  import { NO_LOGIN } from "../../../../shared/importSheetRules";
  import {
    WRITER_STAFF_ROLE_LABELS,
    writerWeight,
    writerWeightText,
    type WriterStaffRole,
  } from "../../../../shared/writerWeight";
  import {
    EMAIL_COLUMN,
    INITIALS_COLUMN,
    LAST_ACTIVE_COLUMN,
    MENU_CELL,
    MENU_ROOM,
    MUTED_TEXT,
    NAME_COLUMN,
    NAME_TEXT,
    NEUTRAL_CHIP,
    PDS_COLUMN,
    PEOPLE_FRAME,
    PEOPLE_HEADER_ROW,
    PEOPLE_ROW,
    PEOPLE_TABLE,
    QUIET_TEXT,
    ROLE_COLUMN,
    WEIGHT_COLUMN,
  } from "./teamColumns";

  export type PastWriter = {
    _id: string;
    name: string | null;
    initials: string | null;
    label: string;
    /** No file points at it or remembers it from before a pick. */
    canDelete: boolean;
    /** An invite an Admin sent for this person is waiting (2026-11-17). */
    invitePending: boolean;
    /** The custom writer weight (0 to 1), or null for the default. Omitted unless Owner/Developer Admin. */
    weight?: number | null;
    /** Banhall PD staff role, if assigned. */
    staffRole?: WriterStaffRole | null;
    /** Whether this non-login writer is still active (true) or former staff (false). */
    isActive?: boolean;
    /** Number of imported PDs as writer/reviewer. */
    fileCount?: number;
    reviewCount?: number;
    /** The one member with the same saved initials, if exactly one: the Link dialog starts with them. */
    sameInitialsAs: { userId: string; name: string; canLink: boolean } | null;
  };

  let {
    writers,
    showActions,
    showWeights = false,
    onInvite,
    onEditName,
    onEditDetails = null,
    onChangeStaffRole = null,
    onLink,
    onSetWeight = null,
    onDelete,
  }: {
    writers: PastWriter[];
    showActions: boolean;
    showWeights?: boolean;
    onInvite: (writer: PastWriter) => void;
    onEditName: (writer: PastWriter) => void;
    onEditDetails?: ((writer: PastWriter) => void) | null;
    onChangeStaffRole?: ((writer: PastWriter, staffRole: WriterStaffRole | null) => void) | null;
    onLink: (writer: PastWriter) => void;
    onSetWeight?: ((writer: PastWriter) => void) | null;
    onDelete: (writer: PastWriter) => void;
  } = $props();
</script>

<section id="team-past-writers" data-past-writers class="flex shrink-0 scroll-mt-4 flex-col gap-2.5 pt-2">
  <div class="flex flex-col gap-1">
    <h2 class="flex items-center gap-2">
      <span class="text-[0.9375rem] leading-[calc(22/15)] font-medium text-ink">Past writers</span>
      <span data-past-writers-count class="flex h-5 items-center rounded-full bg-chrome px-[0.4375rem] text-xs leading-[calc(4/3)] font-medium text-ink-secondary">{writers.length}</span>
    </h2>
    <p class="text-[0.8125rem] leading-[calc(19/13)] text-ink-muted">
      People who wrote imported PDs and have no login. They can be chosen as a writer on Import, but cannot sign in or be given work.
    </p>
  </div>
  <div class={PEOPLE_FRAME}>
    <div class={PEOPLE_TABLE} role="table" aria-label="Past writers">
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
      {#each writers as writer (writer._id)}
        {@const pdCount = writer.fileCount ?? 0}
        {@const effectiveWeight = writerWeight(writer.weight, writer.staffRole)}
        {@const hasCustomWeight = writer.weight !== undefined && writer.weight !== null}
        <div role="row" data-past-writer-row={writer._id} class={PEOPLE_ROW}>
          <span role="cell" class={`flex items-center ${NAME_COLUMN}`}>
            <span data-past-writer-name class={NAME_TEXT}>{writer.label}</span>
          </span>
          <span role="cell" data-past-writer-initials class={`${INITIALS_COLUMN} ${QUIET_TEXT}`}>{writer.initials ?? ""}</span>
          <span role="cell" data-past-writer-email class={`${EMAIL_COLUMN} ${QUIET_TEXT}`}>{writer.staffRole ? WRITER_STAFF_ROLE_LABELS[writer.staffRole] : ""}</span>
          <span role="cell" data-past-writer-pds class={`${PDS_COLUMN} ${pdCount > 0 ? QUIET_TEXT : MUTED_TEXT}`}>
            {pdCount > 0 ? pdCount : "-"}
          </span>
          {#if showWeights}
            <span role="cell" data-past-writer-weight class={`${WEIGHT_COLUMN} flex justify-end`}>
              {#if onSetWeight}
                <button
                  type="button"
                  data-past-writer-weight-button={writer._id}
                  onclick={() => onSetWeight(writer)}
                  title={hasCustomWeight ? "Custom writer weight - click to edit" : "Default writer weight - click to edit"}
                  aria-label={`Edit weight for ${writer.label} (${writerWeightText(effectiveWeight)})`}
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
            <span data-past-writer-role class={NEUTRAL_CHIP}>{NO_LOGIN}</span>
          </span>
          <span role="cell" data-past-writer-last-active class={`${LAST_ACTIVE_COLUMN} ${MUTED_TEXT} ${showActions ? MENU_ROOM : ""}`}>
            {writer.invitePending ? "Invite sent" : writer.isActive === false ? "Former" : ""}
          </span>
          {#if showActions}
            <span role="cell" class={MENU_CELL}>
              <PastWriterRowMenu
                label={writer.label}
                writerId={writer._id}
                staffRole={writer.staffRole ?? null}
                canInvite={!writer.invitePending}
                canDelete={writer.canDelete}
                onInvite={() => onInvite(writer)}
                onEditName={() => onEditName(writer)}
                onEditDetails={onEditDetails ? () => onEditDetails(writer) : null}
                onChangeStaffRole={onChangeStaffRole ? (staffRole) => onChangeStaffRole(writer, staffRole) : null}
                onLink={() => onLink(writer)}
                onSetWeight={showWeights && onSetWeight ? () => onSetWeight(writer) : null}
                onDelete={() => onDelete(writer)}
              />
            </span>
          {/if}
        </div>
      {/each}
    </div>
  </div>
</section>
