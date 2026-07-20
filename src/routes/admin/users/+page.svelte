<script lang="ts">
  import AppNav from "$lib/components/ui/AppNav.svelte";
  import PageBar from "$lib/components/ui/PageBar.svelte";
  import Input from "$lib/components/ui/Input.svelte";
  import Checkbox from "$lib/components/ui/Checkbox.svelte";
  import SelectInput from "$lib/components/ui/SelectInput.svelte";
  import Spinner from "$lib/components/ui/Spinner.svelte";
  import { userErrorMessage } from "$lib/errors";
  import { goto } from "$app/navigation";
  import { useQuery, useMutation } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { api } from "../../../../convex/_generated/api";
  import type { Id } from "../../../../convex/_generated/dataModel";
  import { ROLE_LABELS, type Role } from "../../../../shared/roles";

  const ROLE_ITEMS = (Object.entries(ROLE_LABELS) as [Role, string][]).map(
    ([value, label]) => ({ value, label })
  );

  const auth = useAuth();
  const currentUserQ = useQuery(api.users.getCurrentUser, () =>
    auth.isAuthenticated ? {} : "skip"
  );
  const isAdmin = $derived(currentUserQ.data?.role === "admin");
  const usersQ = useQuery(api.users.listUsers, () =>
    auth.isAuthenticated && isAdmin ? {} : "skip"
  );
  const setUserRole = useMutation(api.users.setUserRole);

  // Invite-only membership: create/list/revoke invites (admin only).
  const invitesQ = useQuery(api.invites.listInvites, () =>
    auth.isAuthenticated && isAdmin ? {} : "skip"
  );
  const createInvite = useMutation(api.invites.createInvite);
  const revokeInvite = useMutation(api.invites.revokeInvite);

  let inviteFirst = $state("");
  let inviteLast = $state("");
  let inviteEmail = $state("");
  let inviteRole = $state<string>("writer");
  // Same shape the browser's type="email" accepts — one non-space local part,
  // @, domain with a dot.
  const inviteValid = $derived(
    Boolean(
      inviteFirst.trim() &&
        inviteLast.trim() &&
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inviteEmail.trim())
    )
  );
  let inviteSending = $state(false);
  let inviteError = $state("");
  let lastInviteLink = $state("");
  let copiedInviteId = $state<string | null>(null);

  function inviteLink(token: string): string {
    return `${location.origin}/signup/${token}`;
  }

  async function handleCreateInvite() {
    if (inviteSending) return;
    inviteError = "";
    lastInviteLink = "";
    inviteSending = true;
    try {
      const { token } = await createInvite({
        email: inviteEmail,
        firstName: inviteFirst,
        lastName: inviteLast,
        role: inviteRole as Role,
      });
      lastInviteLink = inviteLink(token);
      await navigator.clipboard.writeText(lastInviteLink).catch(() => {});
      inviteFirst = "";
      inviteLast = "";
      inviteEmail = "";
      inviteRole = "writer";
    } catch (cause) {
      inviteError = userErrorMessage(cause, "The invite could not be created.");
    } finally {
      inviteSending = false;
    }
  }

  async function copyInvite(id: string, token: string) {
    try {
      await navigator.clipboard.writeText(inviteLink(token));
      copiedInviteId = id;
      setTimeout(() => (copiedInviteId = null), 1600);
    } catch {
      /* clipboard unavailable */
    }
  }

  // Per-writer flavor (Phase A): admins can view/edit each user's custom
  // writing instructions from an expandable row.
  const profilesQ = useQuery(api.writerProfiles.listProfiles, () =>
    auth.isAuthenticated && isAdmin ? {} : "skip"
  );
  const saveProfileForUser = useMutation(api.writerProfiles.saveProfileForUser);
  const profileByUserId = $derived(
    new Map((profilesQ.data ?? []).map((p) => [p.userId as string, p]))
  );

  let expandedUserId = $state<string | null>(null);
  let flavorText = $state("");
  let flavorEnabled = $state(true);
  let flavorSaving = $state(false);
  let flavorSaved = $state(false);
  let flavorError = $state("");
  // Snapshot of the server values the form was seeded from — lets us tell
  // "user typed" apart from "server changed underneath us".
  let flavorSeed = $state<{ text: string; enabled: boolean } | null>(null);

  function seedFlavor(userId: Id<"users">) {
    const profile = profileByUserId.get(userId);
    flavorText = profile?.customInstructions ?? "";
    flavorEnabled = profile?.enabled ?? true;
    flavorSeed = { text: flavorText, enabled: flavorEnabled };
  }

  function toggleFlavor(userId: Id<"users">) {
    if (expandedUserId === userId) {
      expandedUserId = null;
      return;
    }
    seedFlavor(userId);
    flavorSaved = false;
    flavorError = "";
    expandedUserId = userId;
  }

  // Realtime: while the row is open and the admin hasn't typed, follow
  // server changes (e.g. the user saving their own /settings). Once the
  // admin edits, their draft wins until save (last-write-wins).
  $effect(() => {
    const userId = expandedUserId;
    if (!userId || !flavorSeed) return;
    const profile = profileByUserId.get(userId);
    const serverText = profile?.customInstructions ?? "";
    const serverEnabled = profile?.enabled ?? true;
    const dirty =
      flavorText !== flavorSeed.text || flavorEnabled !== flavorSeed.enabled;
    const serverChanged =
      serverText !== flavorSeed.text || serverEnabled !== flavorSeed.enabled;
    if (serverChanged && !dirty) {
      flavorText = serverText;
      flavorEnabled = serverEnabled;
      flavorSeed = { text: serverText, enabled: serverEnabled };
    }
  });

  async function handleFlavorSave(userId: Id<"users">) {
    if (flavorSaving) return;
    flavorError = "";
    flavorSaved = false;
    flavorSaving = true;
    try {
      await saveProfileForUser({
        userId,
        customInstructions: flavorText,
        enabled: flavorEnabled,
      });
      // Saved values are the new baseline — future server changes flow in.
      flavorSeed = { text: flavorText, enabled: flavorEnabled };
      flavorSaved = true;
      setTimeout(() => (flavorSaved = false), 2500);
    } catch (cause) {
      flavorError = userErrorMessage(cause, "Could not save the writing preferences.");
    } finally {
      flavorSaving = false;
    }
  }

  $effect(() => {
    if (!auth.isLoading && !auth.isAuthenticated) {
      goto("/login", { replaceState: true });
    }
  });

  const users = $derived(usersQ.data ?? []);

  let savingId = $state<string | null>(null);
  let error = $state("");

  // Local mirror of each row's role so a server rejection (e.g. self-demotion)
  // can snap the SelectInput back to the stored role.
  let roleOverrides = $state<Record<string, Role>>({});

  async function handleRoleChange(userId: Id<"users">, role: Role, previousRole: Role) {
    if (savingId) return;
    error = "";
    savingId = userId;
    roleOverrides[userId] = role;
    try {
      await setUserRole({ userId, role });
      // Drop the optimistic override once the server confirms — the live
      // listUsers row takes back over, so changes from other admins/tabs
      // keep showing through in realtime.
      delete roleOverrides[userId];
    } catch (cause) {
      error = userErrorMessage(cause, "Could not update the role.");
      roleOverrides[userId] = previousRole;
    } finally {
      savingId = null;
    }
  }

  function joinedDate(ms: number | undefined) {
    return ms
      ? new Date(ms).toLocaleDateString("en-CA", {
          dateStyle: "medium",
        })
      : "—";
  }
</script>

{#if auth.isLoading || !auth.isAuthenticated}
  <div class="flex flex-1 items-center justify-center bg-canvas">
    <Spinner />
  </div>
{:else}
  <div class="flex flex-1 flex-col bg-canvas">
    <AppNav breadcrumbs={[{ label: "Users & roles" }]} />
    <PageBar backHref="/dashboard" backLabel="Back" />

    <main class="mx-auto w-full max-w-[var(--container-shell)] px-6 pt-12 pb-10">
      {#if currentUserQ.data === undefined}
        <div class="flex min-h-[40vh] items-center justify-center"><Spinner /></div>
      {:else if !isAdmin}
        <h1 class="text-display">Users & roles</h1>
        <p class="mt-3 text-sm text-gray-500">
          Role management is available to administrators only.
        </p>
      {:else}
        <h1 class="text-display">Users & roles</h1>
        <p class="mt-1 text-sm text-gray-500">
          Consultants vote and comment on QA observations; managers and admins can
          also reclassify their severity.
        </p>

        <!-- Invite a team member: accounts are invite-only -->
        <section class="card mt-6 p-5">
          <h2 class="text-sm font-semibold text-gray-900">Invite a team member</h2>
          <p class="mt-0.5 text-xs text-gray-500">
            Creates a one-time signup link (valid 7 days) — copy it and send it
            to them yourself.
          </p>
          <!-- Full-width responsive grid: 1 col on phones, 2 on small, all
               five cells on one row from lg up (email gets the widest track,
               button hugs its content aligned to the field baseline). -->
          <form
            class="mt-4 grid w-full grid-cols-1 items-end gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1.6fr_1fr_auto]"
            onsubmit={(e) => {
              e.preventDefault();
              handleCreateInvite();
            }}
          >
            <Input id="invite-first" label="First name" bind:value={inviteFirst} required class="w-full" />
            <Input id="invite-last" label="Last name" bind:value={inviteLast} required class="w-full" />
            <Input id="invite-email" label="Email" type="email" bind:value={inviteEmail} required class="w-full" />
            <div class="flex flex-col gap-1.5">
              <label for="invite-role" class="text-sm font-medium text-gray-700">Role</label>
              <SelectInput id="invite-role" bind:value={inviteRole} items={ROLE_ITEMS} class="w-full" />
            </div>
            <button
              type="submit"
              disabled={inviteSending || !inviteValid}
              title={inviteValid ? undefined : "Fill in first name, last name, and a valid email"}
              class="inline-flex h-[42px] items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50 sm:col-span-2 lg:col-span-1"
            >
              {#if inviteSending}
                <Spinner size="sm" class="h-3.5 w-3.5 border-white" />
              {/if}
              Create invite
            </button>
          </form>
          {#if inviteError}
            <p role="alert" class="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{inviteError}</p>
          {/if}
          {#if lastInviteLink}
            <div class="mt-3 flex items-center gap-2 rounded-lg bg-primary-wash px-3 py-2">
              <span class="min-w-0 flex-1 truncate font-mono text-xs text-navy">{lastInviteLink}</span>
              <button
                type="button"
                onclick={() => navigator.clipboard.writeText(lastInviteLink)}
                class="flex-none rounded-md bg-white px-2.5 py-1 text-xs font-medium text-navy transition-colors hover:bg-gray-50"
              >
                Copy
              </button>
            </div>
            <p class="mt-1.5 text-xs text-gray-400">Link copied to your clipboard.</p>
          {/if}

          {#if (invitesQ.data ?? []).length}
            <div class="mt-5 border-t border-gray-100 pt-4">
              <h3 class="text-xs font-semibold uppercase tracking-wide text-gray-400">Invites</h3>
              <ul class="mt-2 flex flex-col gap-1.5">
                {#each invitesQ.data ?? [] as invite (invite._id)}
                  <li class="flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-gray-50">
                    <span class="min-w-0 flex-1 truncate">
                      <span class="font-medium text-gray-800">{invite.firstName} {invite.lastName}</span>
                      <span class="text-gray-400"> · {invite.email} · {ROLE_LABELS[invite.role]}</span>
                    </span>
                    <span
                      class={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                        invite.status === "pending"
                          ? "bg-primary-wash text-primary-dark"
                          : invite.status === "accepted"
                            ? "bg-primary text-white"
                            : "bg-gray-100 text-gray-500"
                      }`}
                    >
                      {invite.status}
                    </span>
                    {#if invite.status === "pending"}
                      <button
                        type="button"
                        onclick={() => copyInvite(invite._id, invite.token)}
                        class="rounded-md px-2 py-1 text-xs font-medium text-gray-500 transition-colors hover:bg-primary-wash hover:text-navy"
                      >
                        {copiedInviteId === invite._id ? "Copied" : "Copy link"}
                      </button>
                      <button
                        type="button"
                        onclick={() => revokeInvite({ inviteId: invite._id })}
                        class="rounded-md px-2 py-1 text-xs font-medium text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600"
                      >
                        Revoke
                      </button>
                    {/if}
                  </li>
                {/each}
              </ul>
            </div>
          {/if}
        </section>

        {#if error}
          <p role="alert" class="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
            {error}
          </p>
        {/if}

        {#if usersQ.data === undefined}
          <div class="flex min-h-[40vh] items-center justify-center"><Spinner /></div>
        {:else if users.length === 0}
          <p class="mt-8 text-sm text-gray-400">No users yet.</p>
        {:else}
          <div class="card mt-6 overflow-hidden">
            <table class="w-full text-sm">
              <thead>
                <tr class="text-label border-b border-gray-100 text-left">
                  <th class="px-4 py-2.5 font-medium">Name</th>
                  <th class="px-4 py-2.5 font-medium">Email</th>
                  <th class="px-4 py-2.5 font-medium">Joined</th>
                  <th class="px-4 py-2.5 font-medium">Role</th>
                  <th class="px-4 py-2.5 font-medium">Flavor</th>
                </tr>
              </thead>
              <tbody>
                {#each users as row (row._id)}
                  <tr class="border-b border-gray-50 align-middle {expandedUserId === row._id ? '' : 'last:border-0'}">
                    <td class="px-4 py-2.5 font-medium text-gray-800">
                      {row.displayName ?? row.name ?? "—"}
                      {#if row._id === currentUserQ.data?._id}
                        <span class="ml-1.5 rounded-full bg-navy/5 px-2 py-0.5 text-xs font-medium text-navy">You</span>
                      {/if}
                    </td>
                    <td class="px-4 py-2.5 text-gray-600">{row.email ?? "—"}</td>
                    <td class="px-4 py-2.5 text-gray-500">{joinedDate(row.createdAt)}</td>
                    <td class="px-4 py-2.5">
                      <span class="flex items-center gap-2">
                        <SelectInput
                          size="sm"
                          value={roleOverrides[row._id] ?? row.role ?? "writer"}
                          items={ROLE_ITEMS}
                          disabled={savingId !== null}
                          class="w-32"
                          onValueChange={(next) =>
                            handleRoleChange(row._id, next as Role, row.role ?? "writer")}
                        />
                        {#if savingId === row._id}
                          <span class="text-xs text-gray-400">Saving…</span>
                        {/if}
                      </span>
                    </td>
                    <!-- Expandable row per design system: chevron at the row's
                         right edge, points down closed → up open, primary when
                         open. -->
                    <td class="px-4 py-2.5">
                      <button
                        type="button"
                        onclick={() => toggleFlavor(row._id)}
                        aria-expanded={expandedUserId === row._id}
                        class="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-xs font-medium transition-colors hover:bg-primary-wash {expandedUserId === row._id ? 'text-navy' : 'text-gray-500 hover:text-navy'}"
                      >
                        {#if profileByUserId.get(row._id)?.customInstructions.trim()}
                          {profileByUserId.get(row._id)?.enabled ? "Set" : "Off"}
                        {:else}
                          None
                        {/if}
                        <svg
                          class="h-3.5 w-3.5 flex-shrink-0 transition-transform {expandedUserId === row._id ? 'rotate-180 text-primary' : ''}"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          stroke-width="2"
                        >
                          <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                    </td>
                  </tr>
                  {#if expandedUserId === row._id}
                    <tr class="border-b border-gray-50 last:border-0">
                      <td colspan="5" class="bg-gray-50/50 px-4 py-4">
                        <div>
                          <p class="text-label">
                            Writing preferences for {row.displayName ?? row.email ?? "this user"}
                          </p>
                          <p class="mt-1 text-xs text-gray-500">
                            Injected into every generation this user requests. Never
                            overrides CRA structural requirements, banned-word rules,
                            or length limits.
                          </p>
                          <textarea
                            rows={6}
                            bind:value={flavorText}
                            placeholder="e.g. Prefer short declarative sentences. Avoid the passive voice."
                            class="mt-2 block w-full rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 text-sm leading-relaxed text-gray-900 placeholder:text-gray-400 focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
                          ></textarea>
                          <span class="mt-1 block text-right text-xs text-gray-400">
                            {flavorText.length.toLocaleString()} characters
                          </span>
                          <div class="mt-2 flex items-center justify-between gap-4">
                            <Checkbox bind:checked={flavorEnabled} labelText="Apply to this user's generations" />
                            <span class="flex items-center gap-3">
                              {#if flavorSaved}
                                <span class="text-xs text-primary">Saved</span>
                              {/if}
                              <button
                                type="button"
                                onclick={() => handleFlavorSave(row._id)}
                                disabled={flavorSaving}
                                class="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-primary-dark disabled:opacity-50"
                              >
                                {flavorSaving ? "Saving…" : "Save"}
                              </button>
                            </span>
                          </div>
                          {#if flavorError}
                            <p role="alert" class="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
                              {flavorError}
                            </p>
                          {/if}
                        </div>
                      </td>
                    </tr>
                  {/if}
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      {/if}
    </main>
  </div>
{/if}
