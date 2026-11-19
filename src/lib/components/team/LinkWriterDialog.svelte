<script lang="ts">
  // Team, a past writer's "Link to an account" (writers from initials,
  // 2026-11-16): choose a team member who has no past writer linked yet,
  // then confirm. Their past PDs, approved ones included, show under that
  // person from then on. Never done automatically; the server checks it is
  // an Admin and the member can take it.
  import TeamDialog from "./TeamDialog.svelte";
  import SelectInput from "$lib/components/ui/SelectInput.svelte";
  import { userErrorMessage } from "$lib/errors";

  let {
    open = $bindable(false),
    writerLabel,
    members,
    preselect = null,
    onSubmit,
  }: {
    open?: boolean;
    /** The past writer: "DW" or "Dana Whitlock". */
    writerLabel: string;
    /** The members who may take it (no past writer linked yet). */
    members: readonly { _id: string; name: string }[];
    /** A member to start with (the same-initials hint's Link). */
    preselect?: string | null;
    onSubmit: (userId: string) => Promise<unknown>;
  } = $props();

  let chosen = $state("");
  let saving = $state(false);
  let error = $state("");

  $effect(() => {
    if (open) {
      chosen = preselect && members.some((member) => member._id === preselect) ? preselect : "";
      error = "";
    }
  });

  const items = $derived(members.map((member) => ({ value: member._id, label: member.name })));
  const chosenName = $derived(members.find((member) => member._id === chosen)?.name ?? null);

  async function submit() {
    if (saving || !chosen) return;
    saving = true;
    error = "";
    try {
      await onSubmit(chosen);
      open = false;
    } catch (cause) {
      error = userErrorMessage(cause, "The writer could not be linked. Try again.");
    } finally {
      saving = false;
    }
  }
</script>

<TeamDialog
  bind:open
  width={480}
  busy={saving}
  testId="link-writer-dialog"
  title={`Link ${writerLabel} to an account`}
  description="Choose the team member this writer is. Only people with no past writer linked are listed."
>
  <div class="flex flex-col gap-1.5 px-7 pt-5">
    <span id="link-writer-label" class="text-xs leading-[calc(4/3)] font-medium text-ink-secondary">Team member</span>
    {#if members.length === 0}
      <p data-link-writer-none class="text-[0.8125rem] leading-[calc(18/13)] text-ink-muted">Everyone on the team already has a past writer linked.</p>
    {:else}
      <SelectInput bind:value={chosen} {items} placeholder="Choose a team member" ariaLabel="Team member" />
    {/if}
    {#if chosenName}
      <p data-link-writer-confirm class="mt-2 text-[0.8125rem] leading-[calc(18/13)] text-ink-secondary">
        The past PDs of {writerLabel} will show under {chosenName}.
      </p>
    {/if}
    {#if error}
      <p role="alert" class="mt-2 rounded-[0.625rem] border border-danger-line bg-danger-surface px-3 py-2 text-[0.8125rem] leading-[calc(18/13)] text-danger-ink-muted">{error}</p>
    {/if}
  </div>
  {#snippet footer()}
    <div class="mt-5 flex items-center justify-end gap-2 border-t border-line-soft py-4 pl-7 pr-5">
      <button type="button" disabled={saving} onclick={() => (open = false)} class="h-9 rounded-lg bg-chrome px-3.5 text-sm leading-[calc(10/7)] font-medium text-ink hover:bg-primary-wash disabled:opacity-50">Cancel</button>
      <button type="button" data-link-writer-save disabled={saving || !chosen} onclick={submit} class="h-9 rounded-lg bg-fir px-4 text-sm leading-[calc(10/7)] font-medium text-white disabled:opacity-50">{saving ? "Linking..." : "Link"}</button>
    </div>
  {/snippet}
</TeamDialog>
