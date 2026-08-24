<script lang="ts">
  // /settings/account: profile name and sign-in password on one page.
  // Each block follows the settings-row pattern: heading + help on the left,
  // the form on the right, hairline between rows.
  import Button from "$lib/components/ui/Button.svelte";
  import Input from "$lib/components/ui/Input.svelte";
  import Spinner from "$lib/components/ui/Spinner.svelte";
  import { userErrorMessage } from "$lib/errors";
  import { useQuery, useMutation } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { api } from "../../../../convex/_generated/api";

  const auth = useAuth();
  const meQ = useQuery(api.users.getCurrentUser, () =>
    auth.isAuthenticated ? {} : "skip"
  );
  const updateMyProfile = useMutation(api.users.updateMyProfile);
  const changeMyPassword = useMutation(api.users.changeMyPassword);

  // "Your name": first/last shown everywhere your work is labeled.
  // Non-dirty re-seed: follows server changes (other tab, admin edit) until
  // the user starts typing; their draft then wins until save.
  let firstName = $state("");
  let lastName = $state("");
  let nameSeed = $state<{ first: string; last: string } | null>(null);
  $effect(() => {
    if (meQ.data === undefined) return;
    const serverFirst = meQ.data?.firstName ?? "";
    const serverLast = meQ.data?.lastName ?? "";
    // Legacy single-field name: prefill a best-effort split into the DRAFT
    // only. The seed stays at the true server state (empty), so the form
    // starts dirty and the writer can confirm the split with one Save.
    let draftFirst = serverFirst;
    let draftLast = serverLast;
    if (!serverFirst && !serverLast && meQ.data?.name) {
      const parts = meQ.data.name.trim().split(/\s+/);
      draftFirst = parts[0] ?? "";
      draftLast = parts.slice(1).join(" ");
    }
    const dirty =
      nameSeed !== null &&
      (firstName !== nameSeed.first || lastName !== nameSeed.last);
    const serverChanged =
      nameSeed === null ||
      serverFirst !== nameSeed.first ||
      serverLast !== nameSeed.last;
    if (serverChanged && !dirty) {
      firstName = draftFirst;
      lastName = draftLast;
      nameSeed = { first: serverFirst, last: serverLast };
    }
  });

  // Save is inert until the draft differs from what the server has.
  const nameDirty = $derived(
    nameSeed !== null && (firstName !== nameSeed.first || lastName !== nameSeed.last)
  );
  let nameSaving = $state(false);
  let nameSaved = $state(false);
  let nameError = $state("");
  async function handleNameSave(e: SubmitEvent) {
    e.preventDefault();
    if (nameSaving || !nameDirty) return;
    nameError = "";
    nameSaved = false;
    nameSaving = true;
    try {
      await updateMyProfile({ firstName, lastName });
      nameSeed = { first: firstName, last: lastName };
      nameSaved = true;
      setTimeout(() => (nameSaved = false), 2500);
    } catch (cause) {
      nameError = userErrorMessage(cause, "Could not save your name.");
    } finally {
      nameSaving = false;
    }
  }

  let currentPassword = $state("");
  let newPassword = $state("");
  let confirmPassword = $state("");
  // Change is inert until every field is filled.
  const passwordReady = $derived(
    currentPassword.length > 0 && newPassword.length > 0 && confirmPassword.length > 0
  );
  let passwordSaving = $state(false);
  let passwordSaved = $state(false);
  let passwordError = $state("");

  async function handlePasswordChange(e: SubmitEvent) {
    e.preventDefault();
    if (passwordSaving || !passwordReady) return;
    passwordError = "";
    passwordSaved = false;
    if (newPassword !== confirmPassword) {
      passwordError = "New passwords do not match.";
      return;
    }
    if (newPassword.length < 8) {
      passwordError = "New password must be at least 8 characters.";
      return;
    }
    passwordSaving = true;
    try {
      await changeMyPassword({ currentPassword, newPassword });
      currentPassword = "";
      newPassword = "";
      confirmPassword = "";
      passwordSaved = true;
      setTimeout(() => (passwordSaved = false), 3000);
    } catch (cause) {
      passwordError = userErrorMessage(cause, "Could not change your password.");
    } finally {
      passwordSaving = false;
    }
  }
</script>

<svelte:head><title>Account · Settings</title></svelte:head>

{#if meQ.data === undefined}
  <div class="flex min-h-[40vh] items-center justify-center"><Spinner /></div>
{:else}
  <div class="divide-y divide-line-soft">
    <section class="settings-row">
      <div class="settings-row-heading">
        <h2 class="text-title">Your name</h2>
        <p class="mt-1 text-sm text-ink-muted">
          Appears on every report you write, on the team roster, and in review history.
        </p>
      </div>
      <form class="settings-row-form" onsubmit={handleNameSave}>
        <div class="grid gap-3 sm:grid-cols-2">
          <Input id="firstName" label="First name" bind:value={firstName} class="w-full" />
          <Input id="lastName" label="Last name" bind:value={lastName} class="w-full" />
        </div>
        <div class="flex min-h-10 items-center justify-end gap-3">
          {#if nameSaved}
            <span role="status" class="text-xs text-primary">Name saved</span>
          {/if}
          <Button type="submit" size="sm" disabled={!nameDirty || nameSaving}>
            {nameSaving ? "Saving…" : "Save name"}
          </Button>
        </div>
        {#if nameError}
          <p role="alert" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{nameError}</p>
        {/if}
      </form>
    </section>

    <section class="settings-row">
      <div class="settings-row-heading">
        <h2 class="text-title">Email</h2>
        <p class="mt-1 text-sm text-ink-muted">You sign in with this address. Ask an admin to change it.</p>
      </div>
      <div class="settings-row-form">
        <p class="text-sm font-medium text-gray-700">Email</p>
        <p class="text-sm text-ink">{meQ.data?.email ?? ""}</p>
      </div>
    </section>

    <section class="settings-row">
      <div class="settings-row-heading">
        <h2 class="text-title">Password</h2>
        <p class="mt-1 text-sm text-ink-muted">
          Use at least 8 characters. Changing it signs you out on your other devices.
        </p>
      </div>
      <form class="settings-row-form" onsubmit={handlePasswordChange}>
        <Input
          id="current-password"
          label="Current password"
          type="password"
          bind:value={currentPassword}
          autocomplete="current-password"
          required
        />
        <div class="grid gap-3 sm:grid-cols-2">
          <Input
            id="new-password"
            label="New password"
            type="password"
            bind:value={newPassword}
            autocomplete="new-password"
            minlength={8}
            required
          />
          <Input
            id="confirm-password"
            label="Confirm new password"
            type="password"
            bind:value={confirmPassword}
            autocomplete="new-password"
            minlength={8}
            required
          />
        </div>
        <div class="flex min-h-10 items-center justify-end gap-3">
          {#if passwordSaved}
            <span role="status" class="text-xs text-primary">Password updated</span>
          {/if}
          <Button type="submit" size="sm" disabled={!passwordReady || passwordSaving}>
            {passwordSaving ? "Updating…" : "Update password"}
          </Button>
        </div>
        {#if passwordError}
          <p role="alert" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{passwordError}</p>
        {/if}
      </form>
    </section>
  </div>
{/if}
