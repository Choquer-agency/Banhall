<script lang="ts">
  import AppNav from "$lib/components/ui/AppNav.svelte";
  import PageBar from "$lib/components/ui/PageBar.svelte";
  import PageContainer from "$lib/components/ui/PageContainer.svelte";
  import Checkbox from "$lib/components/ui/Checkbox.svelte";
  import Spinner from "$lib/components/ui/Spinner.svelte";
  import Button from "$lib/components/ui/Button.svelte";
  import Input from "$lib/components/ui/Input.svelte";
  import { userErrorMessage } from "$lib/errors";
  import { goto } from "$app/navigation";
  import { useQuery, useMutation } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { api } from "../../../convex/_generated/api";


  const auth = useAuth();
  const profileQ = useQuery(api.writerProfiles.getMyProfile, () =>
    auth.isAuthenticated ? {} : "skip"
  );
  const saveMyProfile = useMutation(api.writerProfiles.saveMyProfile);
  const meQ = useQuery(api.users.getCurrentUser, () =>
    auth.isAuthenticated ? {} : "skip"
  );
  const updateMyProfile = useMutation(api.users.updateMyProfile);
  const changeMyPassword = useMutation(api.users.changeMyPassword);

  // "Your name" card — first/last shown everywhere your work is labeled.
  // Non-dirty re-seed: follows server changes (other tab, admin edit) until
  // the user starts typing; their draft then wins until save.
  let firstName = $state("");
  let lastName = $state("");
  let nameSeed = $state<{ first: string; last: string } | null>(null);
  $effect(() => {
    if (meQ.data === undefined) return;
    let serverFirst = meQ.data?.firstName ?? "";
    let serverLast = meQ.data?.lastName ?? "";
    // Legacy single-field name: prefill a best-effort split for review.
    if (!serverFirst && !serverLast && meQ.data?.name) {
      const parts = meQ.data.name.trim().split(/\s+/);
      serverFirst = parts[0] ?? "";
      serverLast = parts.slice(1).join(" ");
    }
    const dirty =
      nameSeed !== null &&
      (firstName !== nameSeed.first || lastName !== nameSeed.last);
    const serverChanged =
      nameSeed === null ||
      serverFirst !== nameSeed.first ||
      serverLast !== nameSeed.last;
    if (serverChanged && !dirty) {
      firstName = serverFirst;
      lastName = serverLast;
      nameSeed = { first: serverFirst, last: serverLast };
    }
  });

  let nameSaving = $state(false);
  let nameSaved = $state(false);
  let nameError = $state("");
  async function handleNameSave() {
    if (nameSaving) return;
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
  let passwordSaving = $state(false);
  let passwordSaved = $state(false);
  let passwordError = $state("");

  async function handlePasswordChange(e: SubmitEvent) {
    e.preventDefault();
    if (passwordSaving) return;
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

  $effect(() => {
    if (!auth.isLoading && !auth.isAuthenticated) {
      goto("/login", { replaceState: true });
    }
  });

  // Writing preferences — same non-dirty re-seed: an admin editing this
  // user's flavor from /admin/users shows up here live unless the user is
  // mid-edit (their draft wins until save).
  let customInstructions = $state("");
  let enabled = $state(true);
  let prefSeed = $state<{ text: string; enabled: boolean } | null>(null);
  $effect(() => {
    if (profileQ.data === undefined) return;
    const serverText = profileQ.data?.customInstructions ?? "";
    const serverEnabled = profileQ.data?.enabled ?? true;
    const dirty =
      prefSeed !== null &&
      (customInstructions !== prefSeed.text || enabled !== prefSeed.enabled);
    const serverChanged =
      prefSeed === null ||
      serverText !== prefSeed.text ||
      serverEnabled !== prefSeed.enabled;
    if (serverChanged && !dirty) {
      customInstructions = serverText;
      enabled = serverEnabled;
      prefSeed = { text: serverText, enabled: serverEnabled };
    }
  });

  let saving = $state(false);
  let saved = $state(false);
  let error = $state("");

  async function handleSave() {
    if (saving) return;
    error = "";
    saved = false;
    saving = true;
    try {
      await saveMyProfile({ customInstructions, enabled });
      prefSeed = { text: customInstructions, enabled };
      saved = true;
      setTimeout(() => (saved = false), 2500);
    } catch (cause) {
      error = userErrorMessage(cause, "Could not save your writing preferences.");
    } finally {
      saving = false;
    }
  }
</script>

{#if auth.isLoading || !auth.isAuthenticated}
  <div class="flex flex-1 items-center justify-center bg-canvas">
    <Spinner />
  </div>
{:else}
  <div class="flex flex-1 flex-col bg-canvas">
    <AppNav breadcrumbs={[{ label: "Settings" }]} />
    <PageBar backHref="/dashboard" backLabel="Back" />

    <PageContainer>
      <h1 class="text-display">Settings</h1>
      <p class="mt-1 max-w-2xl text-sm text-gray-500">
        Manage your account details, sign-in security, and report-writing preferences.
      </p>

      {#if profileQ.data === undefined || meQ.data === undefined}
        <div class="flex min-h-[40vh] items-center justify-center"><Spinner /></div>
      {:else}
        <div class="mt-8 grid items-start gap-8 lg:grid-cols-[minmax(20rem,0.85fr)_minmax(0,1.35fr)]">
          <div class="flex flex-col gap-8">
            <section class="card p-6">
              <h2 class="text-title">Your name</h2>
              <p class="mt-1 text-sm text-gray-500">
                Shown on reports, the team roster, and review history.
              </p>
              <div class="mt-4 grid gap-3 sm:grid-cols-2">
                <Input id="firstName" label="First name" bind:value={firstName} class="w-full" />
                <Input id="lastName" label="Last name" bind:value={lastName} class="w-full" />
              </div>
              <div class="mt-4 flex min-h-10 items-center justify-end gap-3">
                {#if nameSaved}
                  <span role="status" class="text-xs text-primary">Saved</span>
                {/if}
                <Button onclick={handleNameSave} disabled={nameSaving}>
                  {nameSaving ? "Saving…" : "Save name"}
                </Button>
              </div>
              {#if nameError}
                <p role="alert" class="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
                  {nameError}
                </p>
              {/if}
            </section>

            <section id="security" class="card p-6">
              <h2 class="text-title">Password</h2>
              <p class="mt-1 text-sm text-gray-500">
                Changing your password signs out your other active sessions.
              </p>
              <form class="mt-4 flex flex-col gap-4" onsubmit={handlePasswordChange}>
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
                    <span role="status" class="text-xs text-primary">Password changed</span>
                  {/if}
                  <Button type="submit" disabled={passwordSaving}>
                    {passwordSaving ? "Changing…" : "Change password"}
                  </Button>
                </div>
              </form>
              {#if passwordError}
                <p role="alert" class="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
                  {passwordError}
                </p>
              {/if}
            </section>
          </div>

          <section class="card p-6">
            <h2 class="text-title">Writing preferences</h2>
            <p class="mt-1 max-w-2xl text-sm text-gray-500">
              Applied to every report you generate. Never overrides CRA structural
              requirements, banned-word rules, or length limits.
            </p>

            <label class="mt-4 block">
              <span class="text-label">Your personal style instructions</span>
              <textarea
                rows={14}
                bind:value={customInstructions}
                placeholder={"e.g. Prefer short declarative sentences. Lead each iteration with the hypothesis tested. Avoid the passive voice in the work narrative."}
                class="mt-2 block w-full rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 text-sm leading-relaxed text-gray-900 placeholder:text-gray-400 focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
              ></textarea>
              <span class="mt-1 block text-right text-xs text-gray-400">
                {customInstructions.length.toLocaleString()} characters
              </span>
            </label>

            <div class="mt-4 flex flex-wrap items-center justify-between gap-4">
              <Checkbox bind:checked={enabled} labelText="Apply my preferences to new generations" />
              <span class="flex items-center gap-3">
                {#if saved}
                  <span role="status" class="text-xs text-primary">Saved</span>
                {/if}
                <Button onclick={handleSave} disabled={saving}>
                  {saving ? "Saving…" : "Save preferences"}
                </Button>
              </span>
            </div>

            {#if error}
              <p role="alert" class="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
                {error}
              </p>
            {/if}
          </section>
        </div>
      {/if}
    </PageContainer>
  </div>
{/if}
