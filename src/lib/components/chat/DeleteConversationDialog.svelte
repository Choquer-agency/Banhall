<script lang="ts">
  // Report chat parity, Phase C (2026-10-20), W3: an admin's "Delete
  // permanently" asks first. Keep is the default; Delete cannot be undone.
  import { AlertDialog } from "bits-ui";

  let {
    open = $bindable(false),
    title,
    onConfirm,
  }: {
    open?: boolean;
    /** The conversation's name, so the admin knows which one goes. */
    title?: string;
    onConfirm: () => void;
  } = $props();

  let keepButton: HTMLButtonElement | null = $state(null);
</script>

<AlertDialog.Root bind:open>
  <AlertDialog.Portal>
    <AlertDialog.Overlay class="fixed inset-0 z-[130] bg-dialog-scrim" />
    <AlertDialog.Content
      data-delete-conversation-dialog
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        keepButton?.focus();
      }}
      class="fixed left-1/2 top-1/2 z-[130] w-[calc(100%-2rem)] max-w-[25rem] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-line bg-surface shadow-dialog"
    >
      <div class="flex flex-col gap-1.5 px-6 pt-6">
        <AlertDialog.Title class="text-lg leading-6 font-medium text-ink">Delete this conversation for everyone? This can't be undone.</AlertDialog.Title>
        {#if title}
          <AlertDialog.Description class="truncate text-sm leading-5 text-ink-muted">{title}</AlertDialog.Description>
        {/if}
      </div>
      <div class="flex items-center justify-end gap-2 px-6 pt-5 pb-5">
        <AlertDialog.Cancel
          bind:ref={keepButton}
          data-keep-conversation
          class="h-9 rounded-lg bg-chrome px-3.5 text-sm leading-5 font-medium text-ink hover:bg-primary-wash focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary pointer-coarse:h-11"
        >Keep</AlertDialog.Cancel>
        <AlertDialog.Action
          data-confirm-delete-conversation
          onclick={() => {
            open = false;
            onConfirm();
          }}
          class="h-9 rounded-lg bg-danger-action px-4 text-sm leading-5 font-medium text-white hover:bg-danger-action-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger focus-visible:ring-offset-2 pointer-coarse:h-11"
        >Delete</AlertDialog.Action>
      </div>
    </AlertDialog.Content>
  </AlertDialog.Portal>
</AlertDialog.Root>
