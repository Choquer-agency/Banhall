<script lang="ts">
  import { workPanelPadding } from "$lib/components/shell/topBar";
  // Round 2 Team page (C1-C5; decisions 47, 48, 50, 54). Managers and Admins
  // see members and pending invites; Managers invite Consultants and
  // Managers; only Admins invite Admins, change roles and set temporary
  // passwords. The server enforces every rule; the page only hides what the
  // effective viewer cannot use. View as (WS1) is presentation only.
  import { onDestroy } from "svelte";
  import { resolve } from "$app/paths";
  import { useMutation, useQuery } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { toast } from "svelte-sonner";
  import { api } from "../../../../convex/_generated/api";
  import type { Id } from "../../../../convex/_generated/dataModel";
  import WorkspaceChrome from "$lib/components/workspace/WorkspaceChrome.svelte";
  import ViewAsHiddenPage from "$lib/components/shell/ViewAsHiddenPage.svelte";
  import { effectiveViewer } from "$lib/shell/viewAs.svelte";
  import { inviteLink } from "$lib/team/inviteEmails";
  import { userErrorMessage } from "$lib/errors";
  import { hasCapability } from "../../../../shared/capabilities";
  import type { Role } from "../../../../shared/roles";
  import TeamMembersTable, { type TeamMember } from "./TeamMembersTable.svelte";
  import PendingInvitesTable, { type PendingInvite } from "./PendingInvitesTable.svelte";
  import InviteDialog from "./InviteDialog.svelte";
  import RevokeInviteDialog from "./RevokeInviteDialog.svelte";
  import TemporaryPasswordDialog from "./TemporaryPasswordDialog.svelte";

  let { origin = typeof window === "undefined" ? "" : window.location.origin }: { origin?: string } = $props();

  const auth = useAuth();
  const userQ = useQuery(api.users.getCurrentUser, () => (auth.isAuthenticated ? {} : "skip"));
  const user = $derived(userQ.data);
  const realCanView = $derived(hasCapability(user?.role, "team.view"));
  const viewer = $derived(effectiveViewer(user));
  const canView = $derived(hasCapability(viewer.role, "team.view"));
  const canInvite = $derived(hasCapability(viewer.role, "invites.manage"));
  const isAdminViewer = $derived(hasCapability(viewer.role, "roles.manage"));

  const membersQ = useQuery(api.team.listMembers, () => (auth.isAuthenticated && realCanView ? {} : "skip"));
  const invitesQ = useQuery(api.invites.listTeamInvites, () =>
    auth.isAuthenticated && realCanView ? {} : "skip",
  );
  const members = $derived((membersQ.data ?? []) as TeamMember[]);
  const invites = $derived((invitesQ.data ?? []) as PendingInvite[]);

  const createInvites = useMutation(api.invites.createInvites);
  const resendInvite = useMutation(api.invites.resendInvite);
  const changeInviteRole = useMutation(api.invites.changeInviteRole);
  const revokeInvite = useMutation(api.invites.revokeInvite);
  const setUserRole = useMutation(api.users.setUserRole);
  const setTemporaryPassword = useMutation(api.users.setTemporaryPassword);

  // Relative times ("12 min ago") move on without a refetch.
  let now = $state(Date.now());
  const tick = setInterval(() => (now = Date.now()), 30_000);
  onDestroy(() => clearInterval(tick));

  let inviteOpen = $state(false);
  let revokeTarget = $state<PendingInvite | null>(null);
  let revokeOpen = $state(false);
  let revoking = $state(false);
  let revokeError = $state<string | null>(null);
  let passwordTarget = $state<TeamMember | null>(null);
  let passwordOpen = $state(false);
  let copiedId = $state<string | null>(null);
  let copiedTimer: ReturnType<typeof setTimeout> | undefined;
  onDestroy(() => clearTimeout(copiedTimer));

  const subtitle = $derived(
    isAdminViewer
      ? "Everyone who works in Banhall. Managers and above can invite. An Admin changes roles."
      : "Everyone who works in Banhall. You can invite Consultants and Managers. An Admin changes roles.",
  );

  function showCopied(inviteId: string) {
    copiedId = inviteId;
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => (copiedId = null), 4000);
  }

  async function copyLink(invite: PendingInvite) {
    if (!invite.token) return;
    try {
      await navigator.clipboard.writeText(inviteLink(origin, invite.token));
      showCopied(invite._id);
      toast.success(`Invite link copied for ${invite.email}.`);
    } catch {
      toast.error("The link could not be copied. Try again.");
    }
  }

  async function resend(invite: PendingInvite) {
    try {
      const { token } = await resendInvite({ inviteId: invite._id as Id<"invites"> });
      await navigator.clipboard.writeText(inviteLink(origin, token)).catch(() => {});
      showCopied(invite._id);
      toast.success(`New link for ${invite.email} copied. The old link no longer works.`);
    } catch (cause) {
      toast.error(userErrorMessage(cause, "The invite could not be resent. Try again."));
    }
  }

  async function changeRole(invite: PendingInvite, role: Role) {
    if (role === invite.role) return;
    try {
      await changeInviteRole({ inviteId: invite._id as Id<"invites">, role });
    } catch (cause) {
      toast.error(userErrorMessage(cause, "The role could not be changed. Try again."));
    }
  }

  function askRevoke(invite: PendingInvite) {
    revokeTarget = invite;
    revokeError = null;
    revokeOpen = true;
  }

  async function confirmRevoke() {
    if (!revokeTarget || revoking) return;
    revoking = true;
    revokeError = null;
    try {
      await revokeInvite({ inviteId: revokeTarget._id as Id<"invites"> });
      revokeOpen = false;
      toast.success(`Invite for ${revokeTarget.email} revoked.`);
    } catch (cause) {
      revokeError = userErrorMessage(cause, "The invite could not be revoked. Try again.");
    } finally {
      revoking = false;
    }
  }

  async function changeMemberRole(member: TeamMember, role: Role) {
    if (role === member.role) return;
    try {
      await setUserRole({ userId: member._id as Id<"users">, role });
    } catch (cause) {
      toast.error(userErrorMessage(cause, "The role could not be changed. Try again."));
    }
  }

  function askPassword(member: TeamMember) {
    passwordTarget = member;
    passwordOpen = true;
  }
</script>

<!-- Owner, 2026-10-19: the standard header (title and one plain main
     button) and the shared panel inset, as on Projects. -->
<WorkspaceChrome
  title="Team"
  panel="flush"
  viewAsGate="team"
  primaryAction={user && canView && canInvite ? { label: "Invite", onclick: () => (inviteOpen = true) } : null}
>
  <div data-team-page class={`flex flex-col gap-5 ${workPanelPadding}`}>
    {#if user === undefined}
      <div data-team-loading class="flex flex-col gap-3" aria-busy="true">
        <div class="h-8 w-40 animate-pulse rounded bg-chrome"></div>
        {#each [0, 1, 2, 3] as row (row)}<div class="h-12 animate-pulse rounded bg-chrome/70"></div>{/each}
      </div>
    {:else if !realCanView}
      <div data-team-no-access class="mx-auto flex max-w-[26.25rem] flex-col items-center gap-3 py-20 text-center">
        <p class="font-serif text-2xl leading-[1.25] text-ink">Team is for Managers and Admins.</p>
        <a href={resolve("/my-work")} class="inline-flex h-9 items-center rounded-[0.625rem] bg-chrome px-3.5 text-sm font-medium text-ink hover:bg-primary-wash">Back to Home</a>
      </div>
    {:else if !canView}
      <ViewAsHiddenPage pageName="Team" />
    {:else}
      <p data-team-subtitle class="text-sm leading-[calc(10/7)] text-ink-muted">{subtitle}</p>
      {#if membersQ.data === undefined}
        <div data-team-loading class="flex flex-col overflow-hidden rounded-[0.625rem] border border-line-soft" aria-busy="true">
          {#each [0, 1, 2, 3] as row (row)}
            <div class="flex h-12 items-center gap-4 border-b border-line-soft px-4 last:border-b-0">
              <div class="h-6 w-6 animate-pulse rounded-full bg-chrome"></div>
              <div class="h-3 w-40 animate-pulse rounded bg-chrome"></div>
            </div>
          {/each}
        </div>
      {:else}
        <TeamMembersTable
          {members}
          {now}
          showActions={isAdminViewer}
          onChangeRole={changeMemberRole}
          onSetPassword={askPassword}
        />
      {/if}
      {#if invites.length > 0}
        <PendingInvitesTable
          {invites}
          {now}
          canInviteAdmin={isAdminViewer}
          {copiedId}
          onCopy={copyLink}
          onResend={resend}
          onChangeRole={changeRole}
          onRevoke={askRevoke}
        />
      {/if}
    {/if}
  </div>
</WorkspaceChrome>

{#if canInvite}
  <InviteDialog
    bind:open={inviteOpen}
    canInviteAdmin={isAdminViewer}
    {origin}
    onSend={(emails, role) => createInvites({ emails, role })}
  />
{/if}
{#if revokeTarget}
  <RevokeInviteDialog
    bind:open={revokeOpen}
    email={revokeTarget.email}
    busy={revoking}
    errorMessage={revokeError}
    onConfirm={confirmRevoke}
  />
{/if}
{#if passwordTarget}
  <TemporaryPasswordDialog
    bind:open={passwordOpen}
    name={passwordTarget.name}
    onSubmit={(temporaryPassword) =>
      setTemporaryPassword({ userId: passwordTarget!._id as Id<"users">, temporaryPassword })}
  />
{/if}
