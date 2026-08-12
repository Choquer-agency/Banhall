<script lang="ts">
  /**
   * Workspace preview rollout controls for /admin/users (slice 4).
   *
   * Exposure only, never authorization: the dual gate in
   * convex/workspaceRollout.ts (master switch AND per-user row, fail-closed)
   * decides who *sees* the workspace preview; role/capability checks decide
   * what anyone may *do*. This card is the only enable path — the internal
   * CLI mutations are deliberately disable-only.
   *
   * Concurrency: every public mutation echoes the `version` read from
   * `getAdminState` / `listEnabledAccess` as `expectedVersion`. On
   * STALE_REVISION the live queries have already refreshed, so the recovery
   * copy asks the admin to review the reloaded state and retry.
   *
   * The pilot is configured operationally (an authenticated admin enables the
   * pilot user's own row) — no user identity is ever hardcoded here.
   */
  import Button from "$lib/components/ui/Button.svelte";
  import Spinner from "$lib/components/ui/Spinner.svelte";
  import { useQuery, useMutation } from "convex-svelte";
  import { userErrorCode, userErrorMessage } from "$lib/errors";
  import { api } from "../../../../convex/_generated/api";
  import type { Id } from "../../../../convex/_generated/dataModel";

  type Member = {
    _id: Id<"users">;
    displayName: string;
    email?: string;
    role?: "writer" | "manager" | "admin";
    hasAuthAccount: boolean;
  };

  type MasterArgs = { enabled: boolean; expectedVersion: number };
  type UserAccessArgs = { userId: Id<"users">; enabled: boolean; expectedVersion: number };

  let {
    members,
    currentUserId,
    // Test seams: default to the real Convex mutations.
    runSetMasterSwitch,
    runSetUserAccess,
  }: {
    members: Member[];
    currentUserId?: Id<"users">;
    runSetMasterSwitch?: (args: MasterArgs) => Promise<unknown>;
    runSetUserAccess?: (args: UserAccessArgs) => Promise<unknown>;
  } = $props();

  const setMasterSwitchMutation = useMutation(api.workspaceRollout.setMasterSwitch);
  const setUserAccessMutation = useMutation(api.workspaceRollout.setUserAccess);
  const setMasterSwitch = $derived(runSetMasterSwitch ?? setMasterSwitchMutation);
  const setUserAccess = $derived(runSetUserAccess ?? setUserAccessMutation);

  let selectedUserId = $state<string>("");

  const adminStateQ = useQuery(api.workspaceRollout.getAdminState, () =>
    selectedUserId ? { userId: selectedUserId as Id<"users"> } : {}
  );
  const enabledAccessQ = useQuery(api.workspaceRollout.listEnabledAccess, () => ({}));
  const eventsQ = useQuery(api.workspaceRollout.listRolloutEvents, () => ({}));

  const master = $derived(adminStateQ.data?.master);
  const selectedAccess = $derived(adminStateQ.data?.userAccess);
  const selectedMember = $derived(
    members.find((member) => member._id === selectedUserId) ?? null
  );
  const selectedEnableBlocked = $derived(
    selectedMember !== null && (!selectedMember.hasAuthAccount || !selectedMember.role)
  );

  const STALE_COPY =
    "The rollout configuration changed since it was read. The latest state is shown above — review it and retry.";

  let masterBusy = $state(false);
  let masterError = $state("");
  let userBusy = $state<string | null>(null);
  let userError = $state("");

  function failureCopy(cause: unknown, fallback: string): string {
    if (userErrorCode(cause) === "STALE_REVISION") return STALE_COPY;
    return userErrorMessage(cause, fallback);
  }

  async function toggleMaster() {
    if (masterBusy || !master) return;
    masterError = "";
    masterBusy = true;
    try {
      await setMasterSwitch({ enabled: !master.enabled, expectedVersion: master.version });
    } catch (cause) {
      masterError = failureCopy(cause, "The master switch could not be changed.");
    } finally {
      masterBusy = false;
    }
  }

  async function applyUserAccess(userId: Id<"users">, enabled: boolean, expectedVersion: number) {
    if (userBusy) return;
    userError = "";
    userBusy = userId;
    try {
      await setUserAccess({ userId, enabled, expectedVersion });
    } catch (cause) {
      userError = failureCopy(
        cause,
        enabled ? "Preview access could not be enabled." : "Preview access could not be disabled."
      );
    } finally {
      userBusy = null;
    }
  }

  function eventLabel(event: NonNullable<typeof eventsQ.data>[number]): string {
    const action = event.enabled ? "enabled" : "disabled";
    const subject =
      event.scope === "master"
        ? "Master switch"
        : `Access for ${event.targetName ?? "unknown user"}`;
    return `${subject} ${action} by ${event.actorName}`;
  }

  function eventTime(ms: number): string {
    return new Date(ms).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" });
  }
</script>

<section class="card mt-8 p-6" aria-labelledby="workspace-rollout-title">
  <h2 id="workspace-rollout-title" class="text-title">Workspace preview rollout</h2>
  <p class="mt-0.5 text-xs text-gray-500">
    Controls who sees the new workspace preview. Exposure only — it never grants or removes
    permissions. Both the master switch and a member's own row must be on; anything ambiguous
    fails closed.
  </p>

  {#if adminStateQ.data === undefined}
    <div class="mt-6 flex items-center justify-center py-6"><Spinner /></div>
  {:else}
    <!-- Master switch -->
    <div class="mt-5 flex flex-wrap items-center gap-3">
      <span class="text-sm font-medium text-gray-800">Master switch</span>
      <span
        class={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
          master?.enabled ? "bg-primary text-white" : "bg-gray-100 text-gray-500"
        }`}
      >
        {master?.enabled ? "On" : "Off"}
      </span>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        role="switch"
        aria-checked={master?.enabled === true}
        aria-label="Master switch for the workspace preview"
        disabled={masterBusy || master?.duplicates === true}
        onclick={toggleMaster}
      >
        {masterBusy ? "Saving…" : master?.enabled ? "Turn off" : "Turn on"}
      </Button>
    </div>
    {#if master?.duplicates}
      <p role="alert" class="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
        The master setting has duplicate rows and is failing closed. Run the internal emergency-off
        operation to repair it, then reload.
      </p>
    {/if}
    {#if masterError}
      <p role="alert" class="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{masterError}</p>
    {/if}

    <!-- Per-member access -->
    <div class="mt-6 border-t border-gray-100 pt-4">
      <h3 class="text-xs font-semibold uppercase tracking-wide text-gray-400">Member access</h3>
      <div class="mt-2 flex flex-wrap items-end gap-3">
        <div class="flex min-w-56 flex-col gap-1.5">
          <label for="workspace-rollout-member" class="text-sm font-medium text-gray-700">
            Team member
          </label>
          <select
            id="workspace-rollout-member"
            bind:value={selectedUserId}
            class="h-9 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
          >
            <option value="">Select a member…</option>
            {#each members as member (member._id)}
              <option value={member._id}>
                {member.displayName}{member._id === currentUserId ? " (you)" : ""}{member.email
                  ? ` · ${member.email}`
                  : ""}
              </option>
            {/each}
          </select>
        </div>
        {#if selectedMember}
          <Button
            type="button"
            size="sm"
            disabled={userBusy !== null ||
              selectedAccess?.enabled === true ||
              selectedAccess?.duplicates === true ||
              selectedEnableBlocked}
            onclick={() =>
              applyUserAccess(selectedMember._id, true, selectedAccess?.version ?? 0)}
          >
            {userBusy === selectedMember._id ? "Saving…" : "Enable preview"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={userBusy !== null || !selectedAccess || selectedAccess.enabled === false}
            onclick={() =>
              applyUserAccess(selectedMember._id, false, selectedAccess?.version ?? 0)}
          >
            Disable
          </Button>
        {/if}
      </div>
      {#if selectedMember}
        <p class="mt-2 text-xs text-gray-500" role="status">
          {#if selectedAccess?.duplicates}
            This member has duplicate access rows and is failing closed. Disable through the
            internal cleanup operation, then reload.
          {:else if selectedAccess?.enabled}
            Preview is enabled for {selectedMember.displayName}.
          {:else if selectedEnableBlocked}
            Only an active internal member with a role and a linked sign-in can be granted the
            preview.
          {:else}
            Preview is off for {selectedMember.displayName}.
          {/if}
        </p>
      {/if}
      {#if userError}
        <p role="alert" class="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{userError}</p>
      {/if}
    </div>

    <!-- Enabled members -->
    <div class="mt-6 border-t border-gray-100 pt-4">
      <h3 class="text-xs font-semibold uppercase tracking-wide text-gray-400">Enabled members</h3>
      {#if enabledAccessQ.data === undefined}
        <p class="mt-2 text-xs text-gray-400">Loading…</p>
      {:else if enabledAccessQ.data.entries.length === 0}
        <p class="mt-2 text-xs text-gray-400">
          Nobody has the preview enabled{master?.enabled ? "" : " (master switch is off)"}.
        </p>
      {:else}
        <ul class="mt-2 flex flex-col gap-1.5">
          {#each enabledAccessQ.data.entries as entry (entry.userId)}
            <li class="flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-gray-50">
              <span class="min-w-0 flex-1 truncate">
                <span class="font-medium text-gray-800">{entry.displayName}</span>
                {#if entry.email}
                  <span class="text-gray-400"> · {entry.email}</span>
                {/if}
              </span>
              {#if entry.duplicates}
                <span
                  class="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-600"
                >
                  Duplicate rows
                </span>
              {/if}
              <Button
                type="button"
                variant="danger-ghost"
                size="sm"
                disabled={userBusy !== null || entry.duplicates}
                aria-label={`Disable the workspace preview for ${entry.displayName}`}
                onclick={() => applyUserAccess(entry.userId, false, entry.version)}
              >
                {userBusy === entry.userId ? "Saving…" : "Disable"}
              </Button>
            </li>
          {/each}
        </ul>
        {#if enabledAccessQ.data.truncated}
          <p class="mt-2 text-xs text-gray-400">
            The list was truncated — more access rows exist than could be shown.
          </p>
        {/if}
      {/if}
    </div>

    <!-- Recent audit events -->
    <div class="mt-6 border-t border-gray-100 pt-4">
      <h3 class="text-xs font-semibold uppercase tracking-wide text-gray-400">Recent changes</h3>
      {#if eventsQ.data === undefined}
        <p class="mt-2 text-xs text-gray-400">Loading…</p>
      {:else if eventsQ.data.length === 0}
        <p class="mt-2 text-xs text-gray-400">No rollout changes recorded yet.</p>
      {:else}
        <ul class="mt-2 flex flex-col gap-1">
          {#each eventsQ.data as event (event.id)}
            <li class="flex items-baseline gap-3 px-2 py-1 text-xs">
              <span class="flex-none font-mono text-gray-400">{eventTime(event.occurredAt)}</span>
              <span class="min-w-0 flex-1 text-gray-600">{eventLabel(event)}</span>
              <span class="flex-none uppercase tracking-wide text-[10px] text-gray-400">
                {event.via}
              </span>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}
</section>
