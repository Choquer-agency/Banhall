<script lang="ts">
  // /settings/account (round 2, I1 and I1b): Photo, Name, Email, Role,
  // Signed in and Password rows. Photo and name are staged together and saved
  // by the one save bar; the password change keeps its own action because it
  // is a credential change, not part of the form.
  import { beforeNavigate } from "$app/navigation";
  import Input from "$lib/components/ui/Input.svelte";
  import Spinner from "$lib/components/ui/Spinner.svelte";
  import RoleChip from "$lib/components/ui/RoleChip.svelte";
  import SettingsRow from "$lib/components/settings/SettingsRow.svelte";
  import SettingsSaveBar from "$lib/components/settings/SettingsSaveBar.svelte";
  import PhotoField from "$lib/components/settings/PhotoField.svelte";
  import SessionsRow from "$lib/components/settings/SessionsRow.svelte";
  import { displayName } from "$lib/displayName";
  import { userErrorMessage } from "$lib/errors";
  import type { StagedPhoto } from "$lib/settings/photo";
  import { useQuery, useMutation } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { toast } from "svelte-sonner";
  import { api } from "../../../../convex/_generated/api";
  import { round2Api } from "../../../../convex/lib/round2Api";
  import type { Id } from "../../../../convex/_generated/dataModel";

  const auth = useAuth();
  const meQ = useQuery(api.users.getCurrentUser, () =>
    auth.isAuthenticated ? {} : "skip"
  );
  const updateMyProfile = useMutation(api.users.updateMyProfile);
  const changeMyPassword = useMutation(api.users.changeMyPassword);
  const generateUploadUrl = useMutation(api.documents.generateUploadUrl);
  const claimUpload = useMutation(api.documents.claimUpload);
  const setMyPhoto = useMutation(round2Api.account.setMyPhoto);
  const removeMyPhoto = useMutation(round2Api.account.removeMyPhoto);
  const discardUpload = useMutation(api.transcripts.discardTranscriptOriginals);

  // Name: first/last shown everywhere your work is labeled.
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

  const nameDirty = $derived(
    nameSeed !== null && (firstName !== nameSeed.first || lastName !== nameSeed.last)
  );
  let photo = $state<StagedPhoto>({ kind: "none" });
  const dirty = $derived(nameDirty || photo.kind !== "none");
  let saving = $state(false);
  let saveError = $state("");

  function discard() {
    if (photo.kind === "file") URL.revokeObjectURL(photo.previewUrl);
    photo = { kind: "none" };
    if (nameSeed) {
      firstName = nameSeed.first;
      lastName = nameSeed.last;
      // Legacy single-field names re-seed their suggested split.
      nameSeed = null;
    }
    saveError = "";
  }

  async function uploadPhoto(file: File): Promise<Id<"_storage">> {
    const url = await generateUploadUrl({});
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": file.type },
      body: file,
    });
    if (!response.ok) throw new Error("The photo did not upload. Try again.");
    const { storageId } = (await response.json()) as { storageId: Id<"_storage"> };
    const claimed = await claimUpload({ storageId });
    if (!claimed) throw new Error("The photo did not upload. Try again.");
    try {
      await setMyPhoto({ storageId });
    } catch (cause) {
      // A refused photo cannot delete itself (the mutation rolls back);
      // release this upload now instead of waiting for the daily sweep.
      await discardUpload({ storageIds: [storageId] }).catch(() => {});
      throw cause;
    }
    return storageId;
  }

  async function save() {
    if (saving || !dirty) return;
    saving = true;
    saveError = "";
    try {
      if (photo.kind === "file") {
        await uploadPhoto(photo.file);
        URL.revokeObjectURL(photo.previewUrl);
      } else if (photo.kind === "remove") {
        await removeMyPhoto({});
      }
      photo = { kind: "none" };
      if (nameDirty) {
        await updateMyProfile({ firstName, lastName });
        nameSeed = { first: firstName, last: lastName };
      }
      toast.success("Changes saved");
    } catch (cause) {
      saveError = userErrorMessage(cause, "Could not save your changes.");
    } finally {
      saving = false;
    }
  }

  // Leaving with unsaved changes (not designed, proposed copy).
  beforeNavigate((navigation) => {
    if (!dirty || saving) return;
    if (!confirm("Discard your changes?")) navigation.cancel();
  });

  // Password: its own action (a credential change), opened on request.
  let passwordOpen = $state(false);
  let currentPassword = $state("");
  let newPassword = $state("");
  let confirmPassword = $state("");
  const passwordReady = $derived(
    currentPassword.length > 0 && newPassword.length > 0 && confirmPassword.length > 0
  );
  let passwordSaving = $state(false);
  let passwordError = $state("");

  async function handlePasswordChange(e: SubmitEvent) {
    e.preventDefault();
    if (passwordSaving || !passwordReady) return;
    passwordError = "";
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
      passwordOpen = false;
      toast.success("Password updated");
    } catch (cause) {
      passwordError = userErrorMessage(cause, "Could not change your password.");
    } finally {
      passwordSaving = false;
    }
  }

  const fieldLabel = "text-xs font-medium leading-4 text-ink-secondary";
</script>

<svelte:head><title>Account - Settings</title></svelte:head>

{#if meQ.data === undefined}
  <div class="flex min-h-[40vh] items-center justify-center"><Spinner /></div>
{:else}
  {@const me = meQ.data}
  <div data-settings-account class="flex flex-col gap-6">
    <div class="flex flex-col">
      <SettingsRow label="Photo" hint="Shown next to your name.">
        <PhotoField
          name={displayName(me, "")}
          seed={me?._id}
          currentUrl={me?.imageUrl ?? null}
          bind:staged={photo}
          disabled={saving}
        />
      </SettingsRow>

      <SettingsRow label="Name">
        <div class="grid gap-2 sm:grid-cols-2">
          <label class="flex flex-col gap-1.5">
            <span class={fieldLabel}>First</span>
            <input id="firstName" data-settings-name-input class="field-control settings-name-input h-9 w-full rounded-lg px-2.5 text-sm leading-5 text-ink placeholder:text-ink-faint disabled:opacity-60" bind:value={firstName} autocomplete="given-name" disabled={saving} />
          </label>
          <label class="flex flex-col gap-1.5">
            <span class={fieldLabel}>Last</span>
            <input id="lastName" data-settings-name-input class="field-control settings-name-input h-9 w-full rounded-lg px-2.5 text-sm leading-5 text-ink placeholder:text-ink-faint disabled:opacity-60" bind:value={lastName} autocomplete="family-name" disabled={saving} />
          </label>
        </div>
      </SettingsRow>

      <SettingsRow label="Email" hint="Managed by your sign-in.">
        <p data-settings-email class="text-sm leading-5 text-ink">{me?.email ?? ""}</p>
      </SettingsRow>

      <SettingsRow label="Role" hint="Set by an Admin in Team.">
        <RoleChip role={me?.role ?? null} isOwner={me?.isOwner === true} isDeveloper={me?.isDeveloper === true} />
      </SettingsRow>

      <SessionsRow />

      <SettingsRow label="Password" hint="Use at least 8 characters. Changing it signs you out on your other devices." last>
        {#if passwordOpen}
          <form data-password-form class="flex max-w-xl flex-col gap-3" onsubmit={handlePasswordChange}>
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
            {#if passwordError}
              <p role="alert" class="rounded-md bg-danger-surface px-3 py-2 text-sm text-danger-ink-muted">{passwordError}</p>
            {/if}
            <div class="flex items-center justify-end gap-2">
              <button
                type="button"
                onclick={() => {
                  passwordOpen = false;
                  passwordError = "";
                }}
                class="inline-flex h-9 items-center rounded-lg px-3.5 text-sm font-medium text-ink-secondary transition-colors hover:bg-primary-wash hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fir pointer-coarse:h-11"
              >Cancel</button>
              <button
                type="submit"
                disabled={!passwordReady || passwordSaving}
                class="inline-flex h-9 items-center rounded-lg bg-fir px-4 text-sm font-medium text-white transition-colors hover:bg-navy-light focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fir disabled:opacity-50 pointer-coarse:h-11"
              >{passwordSaving ? "Updating..." : "Update password"}</button>
            </div>
          </form>
        {:else}
          <button
            type="button"
            data-change-password
            onclick={() => (passwordOpen = true)}
            class="inline-flex h-8 items-center rounded-lg bg-chrome px-3.5 text-sm font-medium text-ink transition-colors hover:bg-primary-wash focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fir motion-reduce:transition-none pointer-coarse:h-11"
          >Change password</button>
        {/if}
      </SettingsRow>
    </div>

    {#if saveError}
      <p role="alert" data-settings-save-error class="rounded-md bg-danger-surface px-3 py-2 text-sm text-danger-ink-muted">{saveError}</p>
    {/if}
    <SettingsSaveBar class="mt-1" {dirty} {saving} onSave={save} onDiscard={discard} />
  </div>
{/if}

<style>
  /* I1b: the field being edited gets a 1.5px primary-selected edge and a 3px
     lagoon halo. Scoped so it outranks the shared .field-control focus line. */
  .settings-name-input:focus,
  .settings-name-input:focus-visible {
    box-shadow:
      inset 0 0 0 1.5px var(--color-primary-selected),
      0 0 0 3px var(--color-settings-field-ring);
  }
</style>
