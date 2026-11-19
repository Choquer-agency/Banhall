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
    EMAIL_COLUMN,
    INITIALS_COLUMN,
    LAST_ACTIVE_COLUMN,
    MENU_CELL,
    MENU_ROOM,
    MUTED_TEXT,
    NAME_COLUMN,
    NAME_TEXT,
    NEUTRAL_CHIP,
    PEOPLE_FRAME,
    PEOPLE_HEADER_ROW,
    PEOPLE_ROW,
    PEOPLE_TABLE,
    QUIET_TEXT,
    ROLE_COLUMN,
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
    /** The one member with the same saved initials, if exactly one: the Link dialog starts with them. */
    sameInitialsAs: { userId: string; name: string; canLink: boolean } | null;
  };

  let {
    writers,
    showActions,
    onInvite,
    onEditName,
    onLink,
    onDelete,
  }: {
    writers: PastWriter[];
    showActions: boolean;
    onInvite: (writer: PastWriter) => void;
    onEditName: (writer: PastWriter) => void;
    onLink: (writer: PastWriter) => void;
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
        <span role="columnheader" class={ROLE_COLUMN}>Role</span>
        <span role="columnheader" class={LAST_ACTIVE_COLUMN}>Last active</span>
        {#if showActions}<span role="columnheader" class="sr-only">Actions</span>{/if}
      </div>
      {#each writers as writer (writer._id)}
        <div role="row" data-past-writer-row={writer._id} class={PEOPLE_ROW}>
          <span role="cell" class={`flex items-center ${NAME_COLUMN}`}>
            <span data-past-writer-name class={NAME_TEXT}>{writer.label}</span>
          </span>
          <span role="cell" data-past-writer-initials class={`${INITIALS_COLUMN} ${QUIET_TEXT}`}>{writer.initials ?? ""}</span>
          <span role="cell" data-past-writer-email class={`${EMAIL_COLUMN} ${QUIET_TEXT}`}></span>
          <span role="cell" class={`flex ${ROLE_COLUMN}`}>
            <span data-past-writer-role class={NEUTRAL_CHIP}>{NO_LOGIN}</span>
          </span>
          <span role="cell" data-past-writer-last-active class={`${LAST_ACTIVE_COLUMN} ${MUTED_TEXT} ${showActions ? MENU_ROOM : ""}`}>
            {writer.invitePending ? "Invite sent" : ""}
          </span>
          {#if showActions}
            <span role="cell" class={MENU_CELL}>
              <PastWriterRowMenu
                label={writer.label}
                writerId={writer._id}
                canInvite={!writer.invitePending}
                canDelete={writer.canDelete}
                onInvite={() => onInvite(writer)}
                onEditName={() => onEditName(writer)}
                onLink={() => onLink(writer)}
                onDelete={() => onDelete(writer)}
              />
            </span>
          {/if}
        </div>
      {/each}
    </div>
  </div>
</section>
