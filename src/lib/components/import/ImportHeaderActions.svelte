<!--
  The Import page's top bar actions (2026-11-12, Paper Files 1): "Get the
  uploader" (a quiet button with a download mark, 38px, radius 9, 14/18 in
  secondary ink) and "Add files" (the filled main button with a plus).
  Add files opens a small menu, "Files" or "A folder", each a hidden file
  input; a folder gives every file its path inside the folder, as a drop
  does, so the company and fiscal year are read from the folder names.
-->
<script lang="ts">
  import { DropdownMenu } from "bits-ui";
  import { FileIcon, FolderIcon } from "phosphor-svelte";
  import { filesFromInput, type IntakeFile } from "./importIntake";
  import ImportUploaderDialog from "./ImportUploaderDialog.svelte";
  import BulkImportClientsDialog from "$lib/components/clients/BulkImportClientsDialog.svelte";

  let { onFiles }: { onFiles: (files: IntakeFile[]) => void } = $props();

  let filesInput = $state<HTMLInputElement | null>(null);
  let folderInput = $state<HTMLInputElement | null>(null);
  let uploaderOpen = $state(false);
  let uploaderButton = $state<HTMLButtonElement | null>(null);
  let bulkImportOpen = $state(false);
  let bulkImportButton = $state<HTMLButtonElement | null>(null);

  function picked(input: HTMLInputElement) {
    const files = filesFromInput(input.files);
    // The same files can be picked again later.
    input.value = "";
    if (files.length > 0) onFiles(files);
  }

  const MENU_ITEM =
    "flex min-h-9 w-full cursor-default items-center gap-2.5 rounded-md px-2.5 text-sm leading-[calc(9/7)] text-ink-secondary outline-none data-[highlighted]:bg-primary-wash data-[highlighted]:text-ink pointer-coarse:min-h-11";
  const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fir";
</script>

<div data-import-header-actions class="flex shrink-0 items-center gap-3">
  <button
    bind:this={bulkImportButton}
    type="button"
    data-import-companies
    aria-haspopup="dialog"
    onclick={() => (bulkImportOpen = true)}
    class={`inline-flex h-[2.375rem] shrink-0 items-center gap-1.5 rounded-[0.5625rem] px-3 text-sm leading-[calc(9/7)] text-ink-secondary transition-colors hover:bg-primary-wash hover:text-ink motion-reduce:transition-none pointer-coarse:h-11 ${focusRing}`}
  >
    Import companies
  </button>

  <button
    bind:this={uploaderButton}
    type="button"
    data-import-get-uploader
    aria-haspopup="dialog"
    onclick={() => (uploaderOpen = true)}
    class={`inline-flex h-[2.375rem] shrink-0 items-center gap-1.5 rounded-[0.5625rem] px-3 text-sm leading-[calc(9/7)] text-ink-secondary transition-colors hover:bg-primary-wash hover:text-ink motion-reduce:transition-none pointer-coarse:h-11 ${focusRing}`}
  >
    <svg width="14" height="14" viewBox="0 0 24 24" data-board-icon class="shrink-0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M12 4v11" /><path d="M7 10l5 5 5-5" /><path d="M5 20h14" />
    </svg>
    Get the uploader
  </button>

  <DropdownMenu.Root>
    <DropdownMenu.Trigger
      data-import-add-files
      class={`inline-flex h-[2.375rem] shrink-0 items-center gap-1.5 rounded-[0.5625rem] bg-primary-selected px-3.5 text-sm leading-[calc(9/7)] font-medium text-white transition-colors hover:bg-primary-dark data-[state=open]:bg-primary-dark motion-reduce:transition-none pointer-coarse:h-11 ${focusRing}`}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" data-board-icon class="shrink-0" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M12 5v14M5 12h14" />
      </svg>
      Add files
    </DropdownMenu.Trigger>
    <DropdownMenu.Portal>
      <DropdownMenu.Content
        side="bottom"
        align="end"
        sideOffset={6}
        collisionPadding={12}
        data-import-add-menu
        class="z-[100] w-[12.5rem] rounded-lg border border-line bg-surface p-1 shadow-menu outline-none"
      >
        <DropdownMenu.Item data-import-add-option="files" onSelect={() => filesInput?.click()} class={MENU_ITEM}>
          <FileIcon size="0.875rem" aria-hidden="true" class="shrink-0" />
          Files
        </DropdownMenu.Item>
        <DropdownMenu.Item data-import-add-option="folder" onSelect={() => folderInput?.click()} class={MENU_ITEM}>
          <FolderIcon size="0.875rem" aria-hidden="true" class="shrink-0" />
          A folder
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>

  <input
    bind:this={filesInput}
    type="file"
    multiple
    hidden
    tabindex="-1"
    data-import-files-input
    accept=".docx,.doc,.pdf,.txt,.vtt"
    onchange={(event) => picked(event.currentTarget)}
  />
  <input
    bind:this={folderInput}
    type="file"
    multiple
    hidden
    tabindex="-1"
    webkitdirectory
    data-import-folder-input
    onchange={(event) => picked(event.currentTarget)}
  />
</div>

<ImportUploaderDialog bind:open={uploaderOpen} returnFocus={() => uploaderButton} />
<BulkImportClientsDialog bind:open={bulkImportOpen} returnFocus={() => bulkImportButton} />
