<script lang="ts">
  // Team, confirming a change to a past writer (writers from initials,
  // 2026-11-16): Delete (a writer no file points at) and Unlink past
  // writer. Built like Revoke invite (C5): Cancel (chrome, focused on open)
  // and the action, both 36px with radius 8; Delete in the filled red.
  import TeamDialog from "./TeamDialog.svelte";
  import { userErrorMessage } from "$lib/errors";

  let {
    open = $bindable(false),
    title,
    description,
    confirmLabel,
    busyLabel,
    danger = false,
    testId,
    onConfirm,
  }: {
    open?: boolean;
    title: string;
    description: string;
    confirmLabel: string;
    busyLabel: string;
    danger?: boolean;
    testId: string;
    onConfirm: () => Promise<unknown>;
  } = $props();

  let cancelButton: HTMLButtonElement | null = $state(null);
  let busy = $state(false);
  let error = $state("");

  $effect(() => {
    if (open) error = "";
  });

  async function confirm() {
    if (busy) return;
    busy = true;
    error = "";
    try {
      await onConfirm();
      open = false;
    } catch (cause) {
      error = userErrorMessage(cause, "That did not work. Try again.");
    } finally {
      busy = false;
    }
  }
</script>

<TeamDialog bind:open width={460} {busy} {testId} {title} {description} initialFocus={() => cancelButton}>
  {#if error}
    <p role="alert" class="mx-7 mt-4 rounded-lg border border-danger-line bg-danger-surface px-3 py-2 text-[0.8125rem] leading-[calc(18/13)] text-danger-ink-muted">{error}</p>
  {/if}
  {#snippet footer()}
    <div class="flex items-center justify-end gap-2 pb-[1.125rem] pl-7 pr-5 pt-5">
      <button
        bind:this={cancelButton}
        type="button"
        data-writer-confirm-cancel
        disabled={busy}
        onclick={() => (open = false)}
        class="h-9 rounded-lg bg-chrome px-3.5 text-sm leading-[calc(10/7)] font-medium text-ink hover:bg-primary-wash focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
      >Cancel</button>
      <button
        type="button"
        data-writer-confirm
        disabled={busy}
        onclick={() => void confirm()}
        class={`h-9 rounded-lg px-4 text-sm leading-[calc(10/7)] font-medium text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-50 ${
          danger ? "bg-danger-action hover:bg-danger-action-hover focus-visible:ring-danger" : "bg-fir focus-visible:ring-primary"
        }`}
      >{busy ? busyLabel : confirmLabel}</button>
    </div>
  {/snippet}
</TeamDialog>
