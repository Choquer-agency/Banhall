<!--
  Add files (2026-11-04, Paper "Modal A0" to "A3"): a centred dialog to
  drop or pick files. Each file starts at once and shows its step and the
  share sent; a file over 50 MB says "Too large, up to 50 MB" and is never
  sent. Closing (Add files, the close button, Esc) keeps the uploads going:
  they carry on in the page's Just added list. Cancel stops the files still
  on their way.
-->
<script lang="ts">
  import { Dialog } from "bits-ui";
  import DropZone from "./DropZone.svelte";
  import UploadRow from "./UploadRow.svelte";
  import { inFlight, type UploadEntry } from "./uploads";

  let {
    open = $bindable(false),
    uploads,
    onFiles,
    onStop,
    onRetry,
    onDismiss,
    onCancel,
  }: {
    open?: boolean;
    /** This company's files being added, in the order picked. */
    uploads: readonly UploadEntry[];
    onFiles: (files: File[]) => void;
    onStop: (id: number) => void;
    onRetry: (id: number) => void;
    onDismiss: (id: number) => void;
    /** Stops every file still on its way and closes. */
    onCancel: () => void;
  } = $props();

  // Only the files picked while this dialog was open are listed in it.
  let firstShown = $state<number | null>(null);
  $effect(() => {
    if (open && firstShown === null) firstShown = Math.max(-1, ...uploads.map((upload) => upload.id)) + 1;
    if (!open) firstShown = null;
  });
  const listed = $derived(firstShown === null ? [] : uploads.filter((upload) => upload.id >= firstShown!));
  const anyInFlight = $derived(listed.some(inFlight));
</script>

<Dialog.Root bind:open>
  <Dialog.Portal>
    <Dialog.Overlay class="fixed inset-0 z-[105] bg-form-dialog-scrim" />
    <Dialog.Content
      data-company-files-add-dialog
      class="fixed top-1/2 left-1/2 z-[105] flex max-h-[calc(100dvh-2rem)] w-[32.5rem] max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl bg-surface shadow-dialog outline-none"
    >
      <div class="flex items-center justify-between gap-3 px-6 pt-6 pb-4">
        <Dialog.Title class="text-[0.9375rem] leading-[calc(22/15)] font-medium text-ink">Add files</Dialog.Title>
        <Dialog.Close
          aria-label="Close"
          class="flex size-7 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-primary-wash hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-navy motion-reduce:transition-none pointer-coarse:size-11"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </Dialog.Close>
      </div>
      <Dialog.Description class="sr-only">Drop files here or browse for them. Up to 50 MB each.</Dialog.Description>
      <div class="flex min-h-0 flex-col gap-2.5 overflow-y-auto px-5">
        <DropZone
          compact={listed.length > 0}
          title={listed.length > 0 ? "Drop more files" : "Drop files"}
          hint="Up to 50 MB each"
          {onFiles}
        />
        {#if listed.length > 0}
          <ul class="flex flex-col gap-2" aria-label="Files being added" data-company-files-add-list>
            {#each listed as upload (upload.id)}
              <UploadRow
                {upload}
                onStop={() => onStop(upload.id)}
                onRetry={() => onRetry(upload.id)}
                onDismiss={() => onDismiss(upload.id)}
              />
            {/each}
          </ul>
        {/if}
      </div>
      {#if listed.length > 0}
        <div class="flex items-center justify-end gap-2 px-5 pt-4 pb-5">
          <button
            type="button"
            onclick={onCancel}
            disabled={!anyInFlight}
            class="h-9 rounded-lg px-3.5 text-sm leading-[calc(10/7)] text-ink-secondary transition-colors hover:bg-primary-wash hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:opacity-50 motion-reduce:transition-none pointer-coarse:h-11"
          >Cancel</button>
          <button
            type="button"
            onclick={() => (open = false)}
            data-company-files-add-done
            class="h-9 rounded-lg bg-primary-selected px-4 text-sm leading-[calc(10/7)] font-medium text-white transition-colors hover:bg-primary-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy motion-reduce:transition-none pointer-coarse:h-11"
          >Add files</button>
        </div>
      {:else}
        <p class="px-6 pt-4 pb-5 text-xs leading-[calc(4/3)] text-ink-muted">Closing this won't stop uploads. Check their labels once they finish.</p>
      {/if}
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
