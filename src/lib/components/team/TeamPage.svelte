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
  import TeamSidebar from "$lib/components/workspace/sidebars/TeamSidebar.svelte";
  import ViewAsHiddenPage from "$lib/components/shell/ViewAsHiddenPage.svelte";
  import { effectiveViewer } from "$lib/shell/viewAs.svelte";
  import { inviteLink } from "$lib/team/inviteEmails";
  import { userErrorMessage } from "$lib/errors";
  import { hasCapability } from "../../../../shared/capabilities";
  import { rosterWriterName } from "../../../../shared/importSheetRules";
  import type { Role } from "../../../../shared/roles";
  import TeamMembersTable, { type TeamMember } from "./TeamMembersTable.svelte";
  import PendingInvitesTable, { type PendingInvite } from "./PendingInvitesTable.svelte";
  import InviteDialog from "./InviteDialog.svelte";
  import RevokeInviteDialog from "./RevokeInviteDialog.svelte";
  import TemporaryPasswordDialog from "./TemporaryPasswordDialog.svelte";
  import PastWritersTable, { type PastWriter } from "./PastWritersTable.svelte";
  import InitialsDialog from "./InitialsDialog.svelte";
  import WriterNameDialog from "./WriterNameDialog.svelte";
  import LinkWriterDialog from "./LinkWriterDialog.svelte";
  import WriterConfirmDialog from "./WriterConfirmDialog.svelte";
  import WriterWeightDialog from "./WriterWeightDialog.svelte";
  import AddPastWriterDialog, { type PastWriterFormValues } from "./AddPastWriterDialog.svelte";
  import {
    canManageWriterWeights,
    defaultWeightForStaffRole,
    WRITER_STAFF_ROLE_DEFAULT_WEIGHTS,
    WRITER_STAFF_ROLE_LABELS,
    writerWeightText,
    type WriterStaffRole,
  } from "../../../../shared/writerWeight";

  let { origin = typeof window === "undefined" ? "" : window.location.origin }: { origin?: string } = $props();

  const auth = useAuth();
  const userQ = useQuery(api.users.getCurrentUser, () => (auth.isAuthenticated ? {} : "skip"));
  const user = $derived(userQ.data);
  const realCanView = $derived(hasCapability(user?.role, "team.view"));
  const viewer = $derived(effectiveViewer(user));
  const canView = $derived(hasCapability(viewer.role, "team.view"));
  const canInvite = $derived(hasCapability(viewer.role, "invites.manage"));
  const isAdminViewer = $derived(hasCapability(viewer.role, "roles.manage"));
  const canManageWeights = $derived(canManageWriterWeights(viewer));

  const membersQ = useQuery(api.team.listMembers, () => (auth.isAuthenticated && realCanView ? {} : "skip"));
  const invitesQ = useQuery(api.invites.listTeamInvites, () =>
    auth.isAuthenticated && realCanView ? {} : "skip",
  );
  // 2026-11-16: writers with no login (Team, Past writers), read like the members.
  const pastWritersQ = useQuery(api.users.listPastWriters, () => (auth.isAuthenticated && realCanView ? {} : "skip"));
  const members = $derived((membersQ.data ?? []) as TeamMember[]);
  const invites = $derived((invitesQ.data ?? []) as PendingInvite[]);
  const pastWriters = $derived((pastWritersQ.data ?? []) as PastWriter[]);

  const createInvites = useMutation(api.invites.createInvites);
  const resendInvite = useMutation(api.invites.resendInvite);
  const changeInviteRole = useMutation(api.invites.changeInviteRole);
  const revokeInvite = useMutation(api.invites.revokeInvite);
  const setUserRole = useMutation(api.users.setUserRole);
  const setTemporaryPassword = useMutation(api.users.setTemporaryPassword);
  const setUserInitials = useMutation(api.users.setUserInitials);
  const renamePastWriter = useMutation(api.users.renamePastWriter);
  const linkPastWriter = useMutation(api.users.linkPastWriter);
  const unlinkPastWriter = useMutation(api.users.unlinkPastWriter);
  const deletePastWriter = useMutation(api.users.deletePastWriter);
  const setWriterWeight = useMutation(api.users.setWriterWeight);
  const setWriterStaffRole = useMutation(api.users.setWriterStaffRole);
  const createPastWriter = useMutation(api.users.createPastWriter);
  const updatePastWriter = useMutation(api.users.updatePastWriter);

  // Relative times ("12 min ago") move on without a refetch.
  let now = $state(Date.now());
  const tick = setInterval(() => (now = Date.now()), 30_000);
  onDestroy(() => clearInterval(tick));

  let inviteOpen = $state(false);
  /** The past writer the invite dialog is for (2026-11-17), or null for Invite people. */
  let inviteFor = $state<PastWriter | null>(null);
  let revokeTarget = $state<PendingInvite | null>(null);
  let revokeOpen = $state(false);
  let revoking = $state(false);
  let revokeError = $state<string | null>(null);
  let passwordTarget = $state<TeamMember | null>(null);
  let passwordOpen = $state(false);
  let initialsTarget = $state<TeamMember | null>(null);
  let initialsOpen = $state(false);
  let nameTarget = $state<PastWriter | null>(null);
  let nameOpen = $state(false);
  let pastWriterDialogOpen = $state(false);
  let pastWriterDialogMode = $state<"create" | "edit">("create");
  let pastWriterEditTarget = $state<PastWriter | null>(null);
  let linkTarget = $state<PastWriter | null>(null);
  let linkOpen = $state(false);
  let deleteTarget = $state<PastWriter | null>(null);
  let deleteOpen = $state(false);
  /** Whose writer weight the weight dialog sets (2026-11-18): a member or a past writer. */
  let weightTarget = $state<{ kind: "member"; member: TeamMember } | { kind: "writer"; writer: PastWriter } | null>(null);
  let weightOpen = $state(false);
  let unlinkTarget = $state<TeamMember | null>(null);
  let unlinkOpen = $state(false);
  /** The members a past writer may be linked to: none linked to them yet. */
  const linkable = $derived(members.filter((member) => member.linkedWriter === null));
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

  // ─── Writers from initials (2026-11-16) ───────────────────────────────────

  function askInitials(member: TeamMember) {
    initialsTarget = member;
    initialsOpen = true;
  }

  async function saveInitials(initials: string) {
    const member = initialsTarget!;
    const result = await setUserInitials({ userId: member._id as Id<"users">, initials });
    toast.success(result.initials ? `Initials for ${member.name} saved as ${result.initials}.` : `${member.name} has no initials now.`);
  }

  function askUnlink(member: TeamMember) {
    if (!member.linkedWriter) return;
    unlinkTarget = member;
    unlinkOpen = true;
  }

  async function unlinkWriter() {
    const member = unlinkTarget!;
    const writer = member.linkedWriter!;
    await unlinkPastWriter({ writerId: writer.writerId as Id<"pdWriters"> });
    toast.success(`${writer.label} is unlinked from ${member.name}. It is listed under Past writers again.`);
  }

  function askName(writer: PastWriter) {
    nameTarget = writer;
    nameOpen = true;
  }

  async function saveName(name: string) {
    await renamePastWriter({ writerId: nameTarget!._id as Id<"pdWriters">, name });
  }

  function askLink(writer: PastWriter) {
    linkTarget = writer;
    linkOpen = true;
  }

  function openInvite() {
    inviteFor = null;
    inviteOpen = true;
  }

  /** Invite a past writer (Admins): the invite dialog for this one person; accepting it links them. */
  function askInvite(writer: PastWriter) {
    inviteFor = writer;
    inviteOpen = true;
  }

  async function saveLink(userId: string) {
    const writer = linkTarget!;
    const result = await linkPastWriter({ writerId: writer._id as Id<"pdWriters">, userId: userId as Id<"users"> });
    toast.success(`${writer.label} is linked to ${result.label}. Their past PDs show under them now.`);
  }

  // ─── Writer weights (2026-11-18 (second)) ───────────────────────────────

  function askMemberWeight(member: TeamMember) {
    weightTarget = { kind: "member", member };
    weightOpen = true;
  }

  function askWriterWeight(writer: PastWriter) {
    weightTarget = { kind: "writer", writer };
    weightOpen = true;
  }

  const weightName = $derived(
    weightTarget?.kind === "member" ? weightTarget.member.name : weightTarget?.kind === "writer" ? weightTarget.writer.label : "",
  );
  const weightNow = $derived(
    (weightTarget?.kind === "member" ? weightTarget.member.weight : weightTarget?.kind === "writer" ? weightTarget.writer.weight : null) ?? null,
  );
  const weightStaffRole = $derived<WriterStaffRole | null>(
    (weightTarget?.kind === "member" ? weightTarget.member.staffRole : weightTarget?.kind === "writer" ? weightTarget.writer.staffRole : null) ?? null,
  );

  async function saveWeight(weight: number | null) {
    const target = weightTarget!;
    const result = await setWriterWeight(
      target.kind === "member"
        ? { userId: target.member._id as Id<"users">, weight }
        : { writerId: target.writer._id as Id<"pdWriters">, weight },
    );
    const effectiveDefault = defaultWeightForStaffRole(weightStaffRole);
    const roleDefault = weightStaffRole ? WRITER_STAFF_ROLE_DEFAULT_WEIGHTS[weightStaffRole] : null;
    toast.success(
      result.weight === null
        ? roleDefault !== null && weightStaffRole
          ? `${weightName} uses the ${WRITER_STAFF_ROLE_LABELS[weightStaffRole]} default weight of ${writerWeightText(effectiveDefault)} now.`
          : `${weightName} uses the default weight of ${writerWeightText(effectiveDefault)} now.`
        : `Weight for ${weightName} saved as ${writerWeightText(result.weight)}.`,
    );
  }

  async function changeMemberStaffRole(member: TeamMember, staffRole: WriterStaffRole | null) {
    if ((member.staffRole ?? null) === staffRole) return;
    try {
      await setWriterStaffRole({ userId: member._id as Id<"users">, staffRole });
      toast.success(
        staffRole
          ? `${member.name} is set as ${WRITER_STAFF_ROLE_LABELS[staffRole]}.`
          : `PD role cleared for ${member.name}.`,
      );
    } catch (cause) {
      toast.error(userErrorMessage(cause, "The PD role could not be saved. Try again."));
    }
  }

  async function changeWriterStaffRole(writer: PastWriter, staffRole: WriterStaffRole | null) {
    if ((writer.staffRole ?? null) === staffRole) return;
    try {
      await setWriterStaffRole({ writerId: writer._id as Id<"pdWriters">, staffRole });
      toast.success(
        staffRole
          ? `${writer.label} is set as ${WRITER_STAFF_ROLE_LABELS[staffRole]}.`
          : `PD role cleared for ${writer.label}.`,
      );
    } catch (cause) {
      toast.error(userErrorMessage(cause, "The PD role could not be saved. Try again."));
    }
  }

  function openAddPastWriter() {
    pastWriterDialogMode = "create";
    pastWriterEditTarget = null;
    pastWriterDialogOpen = true;
  }

  function askEditPastWriterDetails(writer: PastWriter) {
    pastWriterDialogMode = "edit";
    pastWriterEditTarget = writer;
    pastWriterDialogOpen = true;
  }

  async function savePastWriterDetails(values: PastWriterFormValues) {
    if (pastWriterDialogMode === "create") {
      const result = await createPastWriter({
        name: values.name,
        initials: values.initials || undefined,
        staffRole: values.staffRole,
        isActive: values.isActive,
        ...(canManageWeights ? { weight: values.weight } : {}),
      });
      toast.success(`${result.label} added.`);
      return;
    }
    const target = pastWriterEditTarget!;
    const result = await updatePastWriter({
      writerId: target._id as Id<"pdWriters">,
      name: values.name,
      initials: values.initials,
      staffRole: values.staffRole,
      isActive: values.isActive,
    });
    toast.success(`${result.label} updated.`);
  }

  function askDelete(writer: PastWriter) {
    deleteTarget = writer;
    deleteOpen = true;
  }

  async function removeWriter() {
    const writer = deleteTarget!;
    await deletePastWriter({ writerId: writer._id as Id<"pdWriters"> });
    toast.success(`${writer.label} deleted.`);
  }
</script>

{#snippet teamSidebar()}
  <TeamSidebar
    peopleCount={membersQ.data ? members.length : null}
    invitesCount={invitesQ.data && !invitesQ.error ? invites.length : null}
    onInvite={canInvite ? openInvite : null}
  />
{/snippet}

<!-- The page frame (Paper S11, 2026-10-28): the Team sidebar with Invite
     people, People and Pending invites; the top bar names the page with the
     people count. A phone has no sidebar, so its bar keeps Invite people. -->
<WorkspaceChrome
  title="Team"
  count={canView && membersQ.data ? (members.length === 1 ? "1 person" : `${members.length} people`) : null}
  panel="flush"
  viewAsGate="team"
  primaryAction={user && canView && canInvite ? { label: "Invite people", onclick: openInvite } : null}
  primaryActionInSidebar
  sidebar={user && realCanView && canView ? teamSidebar : undefined}
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
      <div class="flex flex-wrap items-center justify-between gap-3">
        <p data-team-subtitle class="text-sm leading-[calc(10/7)] text-ink-muted">{subtitle}</p>
        {#if isAdminViewer}
          <button
            type="button"
            data-add-past-writer
            onclick={openAddPastWriter}
            class="h-8 shrink-0 rounded-lg border border-line bg-surface px-3 text-xs font-medium text-ink transition-colors hover:bg-primary-wash focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fir"
          >Add person without login</button>
        {/if}
      </div>
      {#if membersQ.data === undefined}
        <div data-team-loading class="flex flex-col overflow-hidden rounded-[0.625rem] border border-line-soft" aria-busy="true">
          {#each [0, 1, 2, 3] as row (row)}
            <div class="flex h-12 items-center gap-4 border-b border-line-soft px-4 last:border-b-0">
              <div class="h-3 w-40 animate-pulse rounded bg-chrome"></div>
            </div>
          {/each}
        </div>
      {:else}
        <TeamMembersTable
          {members}
          {now}
          showActions={isAdminViewer}
          showWeights={canManageWeights}
          onChangeRole={changeMemberRole}
          onChangeStaffRole={isAdminViewer ? changeMemberStaffRole : null}
          onSetPassword={askPassword}
          onEditInitials={askInitials}
          onSetWeight={canManageWeights ? askMemberWeight : null}
          onUnlinkWriter={askUnlink}
        />
      {/if}
      {#if invitesQ.data !== undefined || invitesQ.error}
        <PendingInvitesTable
          failed={Boolean(invitesQ.error)}
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
      {#if pastWriters.length > 0}
        <PastWritersTable
          writers={pastWriters}
          showActions={isAdminViewer}
          showWeights={canManageWeights}
          onInvite={askInvite}
          onEditName={askName}
          onEditDetails={isAdminViewer ? askEditPastWriterDetails : null}
          onChangeStaffRole={isAdminViewer ? changeWriterStaffRole : null}
          onLink={askLink}
          onSetWeight={canManageWeights ? askWriterWeight : null}
          onDelete={askDelete}
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
    forPerson={inviteFor?.label ?? null}
    onSend={(emails, role) =>
      createInvites({ emails, role, ...(inviteFor ? { pdWriterId: inviteFor._id as Id<"pdWriters"> } : {}) })}
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
{#if isAdminViewer && initialsTarget}
  <InitialsDialog
    bind:open={initialsOpen}
    name={initialsTarget.name}
    initials={initialsTarget.initials}
    others={members.filter((member) => member._id !== initialsTarget?._id)}
    hasRealName={rosterWriterName({ name: initialsTarget.name, email: initialsTarget.email }) !== null}
    onSubmit={saveInitials}
  />
{/if}
{#if isAdminViewer && nameTarget}
  <WriterNameDialog bind:open={nameOpen} initials={nameTarget.initials} name={nameTarget.name} onSubmit={saveName} />
{/if}
{#if isAdminViewer}
  <AddPastWriterDialog
    bind:open={pastWriterDialogOpen}
    mode={pastWriterDialogMode}
    canSetWeight={canManageWeights}
    initialName={pastWriterEditTarget?.name ?? null}
    initialInitials={pastWriterEditTarget?.initials ?? null}
    initialStaffRole={pastWriterEditTarget?.staffRole ?? null}
    initialIsActive={pastWriterEditTarget?.isActive ?? true}
    onSubmit={savePastWriterDetails}
  />
{/if}
{#if isAdminViewer && linkTarget}
  <LinkWriterDialog
    bind:open={linkOpen}
    writerLabel={linkTarget.label}
    members={linkable}
    sameInitialsAs={linkTarget.sameInitialsAs?.canLink ? linkTarget.sameInitialsAs : null}
    onSubmit={saveLink}
  />
{/if}
{#if canManageWeights && weightTarget}
  <WriterWeightDialog
    bind:open={weightOpen}
    name={weightName}
    weight={weightNow}
    staffRole={weightStaffRole}
    onSubmit={saveWeight}
  />
{/if}
{#if isAdminViewer && deleteTarget}
  <WriterConfirmDialog
    bind:open={deleteOpen}
    testId="delete-writer-dialog"
    title={`Delete ${deleteTarget.label}?`}
    description="No file points at this writer. It is removed from Past writers and the Import writer list, and a pick that names it goes too."
    confirmLabel="Delete writer"
    busyLabel="Deleting..."
    danger
    onConfirm={removeWriter}
  />
{/if}
{#if isAdminViewer && unlinkTarget?.linkedWriter}
  <WriterConfirmDialog
    bind:open={unlinkOpen}
    testId="unlink-writer-dialog"
    title={`Unlink ${unlinkTarget.linkedWriter.label} from ${unlinkTarget.name}?`}
    description={`Its past PDs will show as ${unlinkTarget.linkedWriter.label} again, with no login, and it goes back under Past writers. You can link it again later.`}
    confirmLabel="Unlink"
    busyLabel="Unlinking..."
    onConfirm={unlinkWriter}
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
