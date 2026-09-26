<script lang="ts">
  // Admin member action (decision 54): set a temporary password for someone
  // who forgot theirs (decision 50, "ask an Admin"). Same generate, copy and
  // confirm flow as /admin/users; users.setTemporaryPassword signs every
  // session out.
  import TeamDialog from "./TeamDialog.svelte";
  import { generateTemporaryPassword } from "$lib/team/temporaryPassword";
  import { userErrorMessage } from "$lib/errors";

  let {
    open = $bindable(false),
    name,
    onSubmit,
  }: {
    open?: boolean;
    name: string;
    onSubmit: (password: string) => Promise<unknown>;
  } = $props();

  let password = $state("");
  let saving = $state(false);
  let saved = $state(false);
  let copied = $state(false);
  let error = $state("");

  $effect(() => {
    if (open) {
      password = generateTemporaryPassword();
      saved = false;
      copied = false;
      error = "";
    }
  });

  async function copy() {
    try {
      await navigator.clipboard.writeText(password);
      copied = true;
    } catch {
      copied = false;
    }
  }

  async function submit() {
    if (saving || password.length < 8) return;
    saving = true;
    error = "";
    try {
      await onSubmit(password);
      saved = true;
      await copy();
    } catch (cause) {
      error = userErrorMessage(cause, "The password could not be set. Try again.");
    } finally {
      saving = false;
    }
  }
</script>

<TeamDialog
  bind:open
  width={480}
  busy={saving}
  testId="temporary-password-dialog"
  title={`Set a temporary password for ${name}`}
  description="Share it with them in person or by a secure channel. They are signed out everywhere and can change it in Settings."
>
  <div class="flex flex-col gap-1.5 px-7 pt-5">
    <label for="temporary-password" class="text-xs font-medium text-ink-secondary">Temporary password</label>
    <div class="flex items-center gap-2">
      <input
        id="temporary-password"
        type="text"
        autocomplete="off"
        spellcheck="false"
        bind:value={password}
        disabled={saved}
        class="field-control h-10 min-w-0 flex-1 rounded-[10px] px-3 font-mono text-[13px] text-ink disabled:bg-canvas"
      />
      <button type="button" onclick={() => { password = generateTemporaryPassword(); copied = false; }} disabled={saved} class="h-10 rounded-[10px] bg-chrome px-3 text-[13px] font-medium text-ink hover:bg-primary-wash disabled:opacity-50">New one</button>
      <button type="button" onclick={copy} class="h-10 rounded-[10px] bg-chrome px-3 text-[13px] font-medium text-ink hover:bg-primary-wash">{copied ? "Copied" : "Copy"}</button>
    </div>
    {#if password.length > 0 && password.length < 8}
      <p class="text-xs text-danger-ink-muted">Use at least 8 characters.</p>
    {/if}
    {#if saved}
      <p role="status" class="mt-2 rounded-[10px] border border-success-line bg-success-surface px-3 py-2 text-[13px] text-success-ink-muted">
        Password set{copied ? " and copied" : ""}. {name} was signed out everywhere.
      </p>
    {/if}
    {#if error}
      <p role="alert" class="mt-2 rounded-[10px] border border-danger-line bg-danger-surface px-3 py-2 text-[13px] text-danger-ink-muted">{error}</p>
    {/if}
  </div>
  {#snippet footer()}
    <div class="mt-5 flex items-center justify-end gap-2 border-t border-line-soft py-4 pl-7 pr-5">
      {#if saved}
        <button type="button" onclick={() => (open = false)} class="h-9 rounded-[10px] bg-fir px-4 text-sm font-medium text-white">Done</button>
      {:else}
        <button type="button" disabled={saving} onclick={() => (open = false)} class="h-9 rounded-[10px] bg-destructive-soft px-3.5 text-sm font-medium text-destructive-soft-ink hover:bg-destructive-soft-hover disabled:opacity-50">Cancel</button>
        <button type="button" disabled={saving || password.length < 8} onclick={submit} class="h-9 rounded-[10px] bg-fir px-4 text-sm font-medium text-white disabled:opacity-50">{saving ? "Setting..." : "Set password"}</button>
      {/if}
    </div>
  {/snippet}
</TeamDialog>
