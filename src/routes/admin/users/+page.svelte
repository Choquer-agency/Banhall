<script lang="ts">
  import AppNav from "$lib/components/ui/AppNav.svelte";
  import PageBar from "$lib/components/ui/PageBar.svelte";
  import SelectInput from "$lib/components/ui/SelectInput.svelte";
  import Spinner from "$lib/components/ui/Spinner.svelte";
  import { userErrorMessage } from "$lib/errors";
  import { goto } from "$app/navigation";
  import { useQuery, useMutation } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-auth-svelte/sveltekit";
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

  function toggleFlavor(userId: Id<"users">) {
    if (expandedUserId === userId) {
      expandedUserId = null;
      return;
    }
    const profile = profileByUserId.get(userId);
    flavorText = profile?.customInstructions ?? "";
    flavorEnabled = profile?.enabled ?? true;
    flavorSaved = false;
    flavorError = "";
    expandedUserId = userId;
  }

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
                      {row.name ?? "—"}
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
                            Writing preferences for {row.name ?? row.email ?? "this user"}
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
                            <label class="flex items-center gap-2 text-sm text-gray-600">
                              <input
                                type="checkbox"
                                bind:checked={flavorEnabled}
                                class="h-3.5 w-3.5 accent-primary"
                              />
                              Apply to this user's generations
                            </label>
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
