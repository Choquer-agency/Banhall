<script lang="ts">
  // Team, a past writer's "Edit name" and "Add a name" (writers from
  // initials, 2026-11-16): one field for the name a writer with no login is
  // shown as on Import. Empty goes back to the initials. The server refuses
  // an email address and a name over 120 characters, in words shown here.
  import TeamDialog from "./TeamDialog.svelte";
  import { userErrorMessage } from "$lib/errors";
  import { looksLikeEmail } from "../../../../shared/importSheetRules";

  let {
    open = $bindable(false),
    initials,
    name,
    onSubmit,
  }: {
    open?: boolean;
    initials: string | null;
    name: string | null;
    onSubmit: (name: string) => Promise<unknown>;
  } = $props();

  let value = $state("");
  let saving = $state(false);
  let error = $state("");
  let input: HTMLInputElement | null = $state(null);

  $effect(() => {
    if (open) {
      value = name ?? "";
      error = "";
    }
  });

  const title = $derived(name ? `Edit the name of ${name}` : initials ? `Add a name for ${initials}` : "Add a name");

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (saving) return;
    const typed = value.trim();
    if (looksLikeEmail(typed)) {
      error = "Type the writer's name, not an email address.";
      return;
    }
    if (!typed && !initials) {
      error = "Type the writer's name.";
      return;
    }
    saving = true;
    error = "";
    try {
      await onSubmit(typed);
      open = false;
    } catch (cause) {
      error = userErrorMessage(cause, "The name could not be saved. Try again.");
    } finally {
      saving = false;
    }
  }
</script>

<TeamDialog
  bind:open
  width={460}
  busy={saving}
  testId="writer-name-dialog"
  initialFocus={() => input}
  {title}
  description="Files from this writer show this name on Import. They still have no login."
>
  <form id="writer-name-form" class="flex flex-col gap-1.5 px-7 pt-5" onsubmit={submit} novalidate>
    <label for="writer-name" class="text-xs leading-[calc(4/3)] font-medium text-ink-secondary">Name</label>
    <input
      bind:this={input}
      id="writer-name"
      data-writer-name-input
      type="text"
      autocomplete="off"
      maxlength="120"
      placeholder="Dana Whitlock"
      bind:value
      aria-invalid={error ? "true" : undefined}
      class="field-control h-10 rounded-[0.625rem] px-3 text-[0.8125rem] text-ink placeholder:text-ink-muted"
    />
    {#if initials}
      <p class="text-xs leading-[calc(4/3)] text-ink-muted">Leave it empty to show {initials}.</p>
    {/if}
    {#if error}
      <p role="alert" class="mt-1 rounded-[0.625rem] border border-danger-line bg-danger-surface px-3 py-2 text-[0.8125rem] leading-[calc(18/13)] text-danger-ink-muted">{error}</p>
    {/if}
  </form>
  {#snippet footer()}
    <div class="mt-5 flex items-center justify-end gap-2 border-t border-line-soft py-4 pl-7 pr-5">
      <button type="button" disabled={saving} onclick={() => (open = false)} class="h-9 rounded-lg bg-chrome px-3.5 text-sm leading-[calc(10/7)] font-medium text-ink hover:bg-primary-wash disabled:opacity-50">Cancel</button>
      <button type="submit" form="writer-name-form" data-writer-name-save disabled={saving} class="h-9 rounded-lg bg-fir px-4 text-sm leading-[calc(10/7)] font-medium text-white disabled:opacity-50">{saving ? "Saving..." : "Save"}</button>
    </div>
  {/snippet}
</TeamDialog>
