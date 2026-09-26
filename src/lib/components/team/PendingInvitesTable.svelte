<script lang="ts">
  // C1, C2 Pending invites: Email (flex), Role (120), Invited by (150),
  // Status (170), actions (150). Rows the viewer may not manage (a Manager
  // looking at an Admin invite) show no actions.
  import { CheckIcon } from "phosphor-svelte";
  import RoleChip from "$lib/components/ui/RoleChip.svelte";
  import InviteRowMenu from "./InviteRowMenu.svelte";
  import { expiredLabel, sentLabel } from "$lib/team/teamFormat";
  import type { Role } from "../../../../shared/roles";

  export type PendingInvite = {
    _id: string;
    email: string;
    role: Role;
    invitedByName: string | null;
    sentAt: number;
    expiresAt: number;
    expired: boolean;
    canManage: boolean;
    token?: string;
  };

  let {
    invites,
    now,
    canInviteAdmin,
    copiedId,
    onCopy,
    onResend,
    onChangeRole,
    onRevoke,
  }: {
    invites: PendingInvite[];
    now: number;
    canInviteAdmin: boolean;
    copiedId: string | null;
    onCopy: (invite: PendingInvite) => void;
    onResend: (invite: PendingInvite) => void;
    onChangeRole: (invite: PendingInvite, role: Role) => void;
    onRevoke: (invite: PendingInvite) => void;
  } = $props();
</script>

<section data-pending-invites class="flex shrink-0 flex-col gap-2.5 pt-2">
  <h2 class="flex items-center gap-2">
    <span class="text-[15px] leading-[22px] font-medium text-ink">Pending invites</span>
    <span data-pending-count class="flex h-5 items-center rounded-full bg-chrome px-[7px] text-xs leading-4 font-medium text-ink-secondary">{invites.length}</span>
  </h2>
  <div class="overflow-x-auto rounded-[10px] border border-line-soft">
    <div class="min-w-[760px]" role="table" aria-label="Pending invites">
      <div role="row" class="flex h-9 items-center gap-4 border-b border-line-soft bg-canvas px-4 text-xs leading-4 text-ink-muted">
        <span role="columnheader" class="min-w-0 flex-1">Email</span>
        <span role="columnheader" class="w-[120px] shrink-0">Role</span>
        <span role="columnheader" class="w-[150px] shrink-0">Invited by</span>
        <span role="columnheader" class="w-[170px] shrink-0">Status</span>
        <span role="columnheader" class="w-[150px] shrink-0"><span class="sr-only">Actions</span></span>
      </div>
      {#each invites as invite (invite._id)}
        <div role="row" data-invite-row={invite.email} class="flex h-[52px] items-center gap-4 border-b border-line-soft px-4 last:border-b-0">
          <span role="cell" class="flex min-w-0 flex-1 items-center gap-2.5">
            <span aria-hidden="true" class="h-6 w-6 shrink-0 rounded-full border-[1.5px] border-dashed border-gray-300"></span>
            <span class="truncate text-[13px] leading-[19px] font-medium text-ink">{invite.email}</span>
          </span>
          <span role="cell" class="flex w-[120px] shrink-0"><RoleChip role={invite.role} /></span>
          <span role="cell" class="w-[150px] shrink-0 truncate text-[13px] leading-[19px] text-ink-secondary">{invite.invitedByName ?? ""}</span>
          <span role="cell" data-invite-status={invite.expired ? "expired" : "pending"} class="flex w-[170px] shrink-0 items-center gap-1.5">
            <span aria-hidden="true" class={`h-1.5 w-1.5 shrink-0 rounded-full ${invite.expired ? "bg-danger" : "bg-warning"}`}></span>
            <span class="truncate text-[13px] leading-[19px] text-ink-secondary">
              {invite.expired ? expiredLabel(invite.sentAt) : sentLabel(invite.sentAt, now)}
            </span>
          </span>
          <span role="cell" class="flex w-[150px] shrink-0 items-center justify-end gap-1">
            {#if invite.canManage}
              {#if copiedId === invite._id}
                <span role="status" data-link-copied class="flex items-center gap-[5px] text-[13px] leading-[18px] font-medium text-success-ink-muted">
                  <CheckIcon size={13} weight="bold" aria-hidden="true" />Link copied
                </span>
              {:else if invite.expired}
                <button
                  type="button"
                  data-resend={invite.email}
                  onclick={() => onResend(invite)}
                  class="flex h-8 items-center rounded-md bg-chrome px-2.5 text-[13px] leading-[18px] font-medium text-ink hover:bg-primary-wash focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >Resend</button>
              {/if}
              <InviteRowMenu
                email={invite.email}
                role={invite.role}
                {canInviteAdmin}
                onCopy={() => onCopy(invite)}
                onChangeRole={(role) => onChangeRole(invite, role)}
                onResend={() => onResend(invite)}
                onRevoke={() => onRevoke(invite)}
              />
            {/if}
          </span>
        </div>
      {/each}
    </div>
  </div>
</section>
