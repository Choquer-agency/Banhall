<script lang="ts">
  // Report chat parity, Phase B (2026-10-20), W2: Stop on a reply someone
  // else started asks first. It never restricts Stop (owner, 2026-10-19):
  // "Stop reply" always stops, for everyone.
  import { AlertDialog } from "bits-ui";

  let {
    open = $bindable(false),
    name,
    onConfirm,
  }: {
    open?: boolean;
    /** The person who started the reply, when their name is on record. */
    name?: string;
    onConfirm: () => void;
  } = $props();

  const title = $derived(name ? `Stop ${name}'s reply?` : "Stop this reply?");
  const body = $derived(
    name
      ? `${name} started this reply. Stopping it ends it for everyone.`
      : "Someone else started this reply. Stopping it ends it for everyone."
  );
  let keepButton: HTMLButtonElement | null = $state(null);
</script>

<AlertDialog.Root bind:open>
  <AlertDialog.Portal>
    <AlertDialog.Overlay class="fixed inset-0 z-[130] bg-dialog-scrim" />
    <AlertDialog.Content
      data-stop-reply-dialog
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        keepButton?.focus();
      }}
      class="fixed left-1/2 top-1/2 z-[130] w-[calc(100%-2rem)] max-w-[25rem] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-line bg-surface shadow-dialog"
    >
      <div class="flex flex-col gap-1.5 px-6 pt-6">
        <AlertDialog.Title class="text-lg leading-6 font-medium text-ink">{title}</AlertDialog.Title>
        <AlertDialog.Description class="text-sm leading-5 text-ink-muted">{body}</AlertDialog.Description>
      </div>
      <div class="flex items-center justify-end gap-2 px-6 pt-5 pb-5">
        <AlertDialog.Cancel
          bind:ref={keepButton}
          data-keep-reply
          class="h-9 rounded-lg bg-chrome px-3.5 pointer-coarse:h-11 text-sm leading-5 font-medium text-ink hover:bg-primary-wash focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >Keep going</AlertDialog.Cancel>
        <AlertDialog.Action
          data-confirm-stop-reply
          onclick={() => {
            open = false;
            onConfirm();
          }}
          class="h-9 rounded-lg bg-danger-action px-4 pointer-coarse:h-11 text-sm leading-5 font-medium text-white hover:bg-danger-action-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger focus-visible:ring-offset-2"
        >Stop reply</AlertDialog.Action>
      </div>
    </AlertDialog.Content>
  </AlertDialog.Portal>
</AlertDialog.Root>
