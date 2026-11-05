<!--
  Replace file (2026-11-04, Paper "Replace R1" to "R4"; Managers and
  Admins): drop or pick the new version, which is read in the browser and
  its original stored at once, then Replace file swaps it in. Dropping a
  file on a row opens this at the upload step. A file over 50 MB says "Too
  large, up to 50 MB" and is never sent. Drafts already made keep the old
  text (the server keeps it as their version).
-->
<script lang="ts">
  import { Dialog } from "bits-ui";
  import FileIcon from "$lib/components/ui/FileIcon.svelte";
  import { userErrorMessage } from "$lib/errors";
  import { isParseAbort } from "$lib/spreadsheetClient";
  import {
    CompanyFileTooLargeError,
    isTooLarge,
    type CompanyFileProgress,
    type PreparedCompanyFile,
  } from "$lib/uploads/storeCompanyFile";
  import DropZone from "./DropZone.svelte";
  import UploadRow from "./UploadRow.svelte";
  import type { ListedCompanyFile } from "./fileMeta";
  import type { UploadPhase } from "./uploads";

  let {
    open = $bindable(false),
    target,
    initialFile = null,
    prepare,
    commit,
    onCloseAutoFocus,
  }: {
    open?: boolean;
    target: ListedCompanyFile | null;
    /** A file dropped on the row: the dialog starts at the upload step. */
    initialFile?: File | null;
    prepare: (file: File, onProgress: (progress: CompanyFileProgress) => void, signal: AbortSignal) => Promise<PreparedCompanyFile>;
    commit: (target: ListedCompanyFile, prepared: PreparedCompanyFile) => Promise<void>;
    onCloseAutoFocus?: (event: Event) => void;
  } = $props();

  type Pending = { id: number; file: File; phase: UploadPhase; fraction: number; error: string | null; prepared?: PreparedCompanyFile };
  let pending = $state<Pending | null>(null);
  let committing = $state(false);
  let commitError = $state<string | null>(null);
  let controller: AbortController | null = null;
  let nextId = 0;
  let startedFrom: File | null = null;
  /** One per opening: a swap that finishes after its dialog closed and opened again does nothing. */
  let session = 0;

  function reset() {
    controller?.abort();
    controller = null;
    pending = null;
    committing = false;
    commitError = null;
  }

  $effect(() => {
    if (!open) {
      startedFrom = null;
      session += 1;
      reset();
      return;
    }
    if (initialFile && initialFile !== startedFrom) {
      startedFrom = initialFile;
      start(initialFile);
    }
  });

  function start(file: File) {
    controller?.abort();
    commitError = null;
    const id = nextId++;
    if (isTooLarge(file)) {
      pending = { id, file, phase: "too_large", fraction: 0, error: null };
      return;
    }
    const own = new AbortController();
    controller = own;
    pending = { id, file, phase: "reading", fraction: 0, error: null };
    const update = (patch: Partial<Pending>) => {
      if (pending?.id === id) pending = { ...pending, ...patch };
    };
    void prepare(
      file,
      (progress) => update(progress.phase === "uploading" ? { phase: "uploading", fraction: progress.fraction } : { phase: progress.phase }),
      own.signal
    )
      .then((prepared) => {
        if (!prepared.storageId) {
          update({ phase: "failed", error: "The new version could not be uploaded. Try again." });
          return;
        }
        update({ phase: "done", fraction: 1, prepared });
      })
      .catch((error) => {
        if (own.signal.aborted || isParseAbort(error)) return;
        if (error instanceof CompanyFileTooLargeError) update({ phase: "too_large" });
        else update({ phase: "failed", error: userErrorMessage(error, "The new version could not be uploaded. Try again.") });
      });
  }

  async function swap() {
    if (!target || !pending?.prepared || committing) return;
    const mine = session;
    committing = true;
    commitError = null;
    try {
      await commit(target, pending.prepared);
      if (mine === session) open = false;
    } catch (error) {
      if (mine === session) commitError = userErrorMessage(error, "The file could not be replaced. The old version is unchanged.");
    } finally {
      if (mine === session) committing = false;
    }
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Portal>
    <Dialog.Overlay class="fixed inset-0 z-[105] bg-form-dialog-scrim" />
    <Dialog.Content
      data-company-file-replace-dialog
      {onCloseAutoFocus}
      onEscapeKeydown={(event) => {
        // While the swap is saving, the dialog stays until it is done.
        if (committing) event.preventDefault();
      }}
      onInteractOutside={(event) => {
        if (committing) event.preventDefault();
      }}
      class="fixed top-1/2 left-1/2 z-[105] flex max-h-[calc(100dvh-2rem)] w-[32.5rem] max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl bg-surface shadow-dialog outline-none"
    >
      <div class="flex items-start justify-between gap-3 px-6 pt-6 pb-4">
        <div class="flex min-w-0 flex-col gap-1.5">
          <Dialog.Title class="text-[0.9375rem] leading-[calc(22/15)] font-medium text-ink">Replace file</Dialog.Title>
          {#if target}
            <p class="flex min-w-0 items-center gap-1.5 text-[0.8125rem] leading-[calc(18/13)] text-ink-secondary">
              <FileIcon name={target.fileName} size={16} />
              <span class="truncate" data-replace-target>{target.fileName}</span>
            </p>
          {/if}
        </div>
        <Dialog.Close
          disabled={committing}
          aria-label="Close"
          class="flex size-7 shrink-0 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-primary-wash hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-navy disabled:opacity-40 motion-reduce:transition-none pointer-coarse:size-11"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </Dialog.Close>
      </div>
      <Dialog.Description class="sr-only">Drop the new version here or browse for it. One file, up to 50 MB.</Dialog.Description>
      <div class="flex flex-col gap-2.5 px-5">
        {#if pending}
          <ul aria-label="New version">
            <UploadRow
              upload={{ id: pending.id, name: pending.file.name, size: pending.file.size, phase: pending.phase, fraction: pending.fraction, error: pending.error }}
              doneLabel="Uploaded and read"
              onStop={reset}
              onRetry={() => pending && start(pending.file)}
              onDismiss={reset}
            />
          </ul>
        {:else}
          <DropZone multiple={false} title="Drop the new version" hint="One file, up to 50 MB" onFiles={(files) => files[0] && start(files[0])} />
        {/if}
        {#if commitError}
          <p role="alert" class="text-[0.8125rem] leading-[calc(18/13)] text-danger-ink-muted" data-replace-error>{commitError}</p>
        {/if}
      </div>
      <p class={`px-6 pt-4 text-xs leading-[calc(4/3)] text-ink-muted ${pending ? "" : "pb-5"}`}>The new version keeps the same label. Reports already made keep the old one.</p>
      {#if pending}
        <div class="flex items-center justify-end gap-2 px-5 pt-4 pb-5">
          <button
            type="button"
            onclick={() => (open = false)}
            disabled={committing}
            class="h-9 rounded-lg px-3.5 text-sm leading-[calc(10/7)] text-ink-secondary transition-colors hover:bg-primary-wash hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:opacity-50 motion-reduce:transition-none pointer-coarse:h-11"
          >Cancel</button>
          <button
          type="button"
          onclick={() => void swap()}
          disabled={pending?.phase !== "done" || committing}
          data-replace-confirm
          class="h-9 rounded-lg bg-primary-selected px-4 text-sm leading-[calc(10/7)] font-medium text-white transition-colors hover:bg-primary-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:bg-chrome disabled:text-ink-faint motion-reduce:transition-none pointer-coarse:h-11"
        >{committing ? "Replacing..." : "Replace file"}</button>
        </div>
      {/if}
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
