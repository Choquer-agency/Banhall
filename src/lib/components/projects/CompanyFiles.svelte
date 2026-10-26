<!--
  The Files tab of a company page (2026-10-26, Phase C; Paper Z8a keeps the
  tab, its content is new): the files a company holds for every project
  linked to it. Consultants, Managers and Admins see and add them; Managers
  and Admins also archive, restore and remove them (companyFiles.read, .add,
  .manage). A file is read in the browser and its original stored, as in a
  project's files panel; the server reads what the browser could not.

  A company known only by its projects' name has no company row yet: the
  tab says it has no files, and the first upload makes the row.
-->
<script lang="ts">
  import { AlertDialog, DropdownMenu } from "bits-ui";
  import { useMutation, useQuery } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { ArchiveIcon, ArrowCounterClockwiseIcon, EyeIcon, TrashIcon } from "phosphor-svelte";
  import { api } from "../../../../convex/_generated/api";
  import type { Id } from "../../../../convex/_generated/dataModel";
  import FileIcon from "$lib/components/ui/FileIcon.svelte";
  import { MessageContent } from "$lib/components/chat/primitives";
  import { SUPPORTED_ACCEPT, normalizeExtractedText } from "$lib/parseDocument";
  import { statusLabel } from "$lib/uploads/processingStatus";
  import { storeCompanyFile } from "$lib/uploads/storeCompanyFile";
  import { userErrorMessage } from "$lib/errors";
  import { quotableFileText } from "../../../../shared/wordMarkdown";

  let {
    companyKey,
    companyName,
    canAdd = false,
    canManage = false,
  }: {
    companyKey: string;
    companyName: string;
    canAdd?: boolean;
    canManage?: boolean;
  } = $props();

  /** Longer Markdown is shown as plain text (as in the files panel). */
  const MARKDOWN_PREVIEW_MAX_CHARS = 200_000;

  const auth = useAuth();
  const ensureCompany = useMutation(api.companyFiles.ensureCompanyForKey);
  const generateUploadUrl = useMutation(api.companyFiles.generateCompanyUploadUrl);
  const addCompanyFile = useMutation(api.companyFiles.addCompanyFile);
  const setCompanyFileArchived = useMutation(api.companyFiles.setCompanyFileArchived);
  const removeCompanyFile = useMutation(api.companyFiles.removeCompanyFile);

  const companyQ = useQuery(api.companyFiles.companyForKey, () =>
    auth.isAuthenticated ? { key: companyKey } : "skip"
  );
  /** Set by the first upload when the company had no row. */
  let madeClientId = $state<Id<"clients"> | null>(null);
  const clientId = $derived(companyQ.data?.clientId ?? madeClientId);
  let showArchived = $state(false);
  const filesQ = useQuery(api.companyFiles.listCompanyFiles, () => (clientId ? { clientId } : "skip"));
  const archivedQ = useQuery(api.companyFiles.listCompanyFiles, () =>
    clientId && showArchived ? { clientId, archived: true } : "skip"
  );

  type Listed = NonNullable<typeof filesQ.data>["files"][number];

  const files = $derived(filesQ.data?.files ?? []);
  const loading = $derived(
    companyQ.data === undefined || (clientId !== null && filesQ.data === undefined && !filesQ.error)
  );
  const failed = $derived(Boolean(companyQ.error || filesQ.error));

  // ─── Uploads ──────────────────────────────────────────────────────────────
  // One at a time, in the order picked. Each file keeps its own key, so Try
  // again after a lost answer finds the row the first save made.
  type Upload = { id: number; name: string; file: File; attemptKey: string; error: string | null };
  let uploads = $state<Upload[]>([]);
  let nextUploadId = 0;
  let inputEl: HTMLInputElement | null = $state(null);
  /** Files waiting their turn while another is being added. */
  const pending: Upload[] = [];
  let running = false;

  async function companyIdForUpload(): Promise<Id<"clients">> {
    if (clientId) return clientId;
    const made = await ensureCompany({ key: companyKey });
    madeClientId = made.clientId;
    return made.clientId;
  }

  function queue(entries: Upload[]) {
    pending.push(...entries);
    if (!running) void drain();
  }

  async function drain() {
    running = true;
    while (pending.length > 0) {
      const upload = pending.shift()!;
      try {
        const target = await companyIdForUpload();
        await storeCompanyFile(
          { generateUploadUrl: () => generateUploadUrl({}), addCompanyFile: (args) => addCompanyFile(args) },
          { clientId: target, file: upload.file, attemptKey: upload.attemptKey }
        );
        uploads = uploads.filter((entry) => entry.id !== upload.id);
      } catch (error) {
        const message = userErrorMessage(error, "This file could not be added. Try again.");
        uploads = uploads.map((entry) => (entry.id === upload.id ? { ...entry, error: message } : entry));
      }
    }
    running = false;
  }

  function addFiles(picked: File[]) {
    const entries = picked.map((file) => ({ id: nextUploadId++, name: file.name, file, attemptKey: crypto.randomUUID(), error: null }));
    uploads = [...uploads, ...entries];
    queue(entries);
  }

  function retryUpload(id: number) {
    const upload = uploads.find((entry) => entry.id === id);
    if (!upload) return;
    uploads = uploads.map((entry) => (entry.id === id ? { ...entry, error: null } : entry));
    queue([{ ...upload, error: null }]);
  }

  function dismissUpload(id: number) {
    uploads = uploads.filter((entry) => entry.id !== id);
  }

  // ─── Preview ──────────────────────────────────────────────────────────────
  let preview = $state<Listed | null>(null);
  const previewIsPdf = $derived(preview !== null && preview.fileType === "pdf" && Boolean(preview.url));
  const previewIsImage = $derived(
    preview !== null && (preview.mimeType?.startsWith("image/") ?? false) && Boolean(preview.url)
  );
  const previewContentQ = useQuery(api.companyFiles.getCompanyFileContent, () =>
    preview && !previewIsPdf && !previewIsImage ? { companyFileId: preview._id } : "skip"
  );

  /** The preview takes focus when it opens, so Escape and screen readers start there. */
  function focusOnMount(node: HTMLElement) {
    node.focus();
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    if (preview && event.key === "Escape" && !event.defaultPrevented) {
      event.preventDefault();
      preview = null;
    }
  }

  // ─── Archive, restore, remove ─────────────────────────────────────────────
  let actionError = $state<string | null>(null);
  let removing = $state<Listed | null>(null);
  let removeOpen = $state(false);

  async function setArchived(file: Listed, archived: boolean) {
    actionError = null;
    try {
      await setCompanyFileArchived({ companyFileId: file._id, archived });
    } catch (error) {
      actionError = userErrorMessage(error, archived ? "The file could not be archived." : "The file could not be restored.");
    }
  }

  async function remove(file: Listed) {
    actionError = null;
    try {
      await removeCompanyFile({ companyFileId: file._id });
    } catch (error) {
      actionError = userErrorMessage(error, "The file could not be removed.");
    }
  }

  // ─── Words ────────────────────────────────────────────────────────────────
  const KIND_LABELS: Record<string, string> = {
    pdf: "PDF",
    docx: "Word",
    xlsx: "Spreadsheet",
    msg: "Email",
    eml: "Email",
    txt: "Text",
    md: "Text",
    image: "Image",
    other: "File",
  };

  function kindLabel(file: Listed): string {
    const type = file.labels?.documentType;
    if (type && type !== "other") return type.charAt(0).toUpperCase() + type.slice(1);
    return KIND_LABELS[file.fileType] ?? "File";
  }

  function sizeLabel(file: Listed): string {
    if (file.wordCount > 0) return `${file.wordCount.toLocaleString("en-US")} ${file.wordCount === 1 ? "word" : "words"}`;
    return "No text";
  }

  function addedLabel(file: Listed): string {
    const date = new Date(file.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    return file.addedBy ? `Added by ${file.addedBy}, ${date}` : `Added ${date}`;
  }

  const quietButton =
    "flex h-[1.875rem] shrink-0 items-center rounded-[0.4375rem] border border-line px-2.5 text-[0.8125rem] leading-[calc(18/13)] text-ink-secondary transition-colors hover:bg-primary-wash hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy motion-reduce:transition-none pointer-coarse:h-11";
  const textButton =
    "shrink-0 rounded-md text-[0.8125rem] leading-[calc(18/13)] font-medium text-primary-selected hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy pointer-coarse:min-h-11";
  const menuItem =
    "flex h-8 w-full cursor-default items-center gap-2 rounded-md px-2 text-[0.8125rem] text-ink outline-none data-[highlighted]:bg-primary-wash pointer-coarse:h-11";
</script>

<svelte:window onkeydown={handleWindowKeydown} />

{#snippet fileRow(file: Listed)}
  <li class="flex min-w-0 items-start gap-3 px-4 py-3" data-company-file={file._id}>
    <span class="flex w-6 shrink-0 justify-center pt-0.5"><FileIcon name={file.fileName} size={24} /></span>
    <div class="min-w-0 flex-1">
      <button
        type="button"
        data-company-file-open
        onclick={() => (preview = file)}
        class="block max-w-full truncate rounded-sm text-left text-sm leading-[calc(10/7)] font-medium text-ink hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
      >{file.fileName}</button>
      {#if file.labels?.summary}
        <p class="truncate text-[0.8125rem] leading-[calc(18/13)] text-ink-secondary" data-company-file-summary>{file.labels.summary}</p>
      {/if}
      <p class="flex flex-wrap items-center gap-x-2 text-xs leading-[calc(4/3)] text-ink-muted">
        <span>{kindLabel(file)}</span>
        <span aria-hidden="true">·</span>
        <span>{sizeLabel(file)}</span>
        <span aria-hidden="true">·</span>
        <span>{addedLabel(file)}</span>
        {#if file.processingStatus !== "ready"}
          <span class="flex h-5 items-center rounded-[0.3125rem] bg-gray-50 px-[0.4375rem] text-ink-secondary" data-company-file-status>{statusLabel(file.processingStatus)}</span>
        {/if}
      </p>
    </div>
    <span class="flex w-6 shrink-0 justify-center">
      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          aria-label={`More actions for ${file.fileName}`}
          data-company-file-menu={file._id}
          class="flex size-6 items-center justify-center rounded-md text-ink-secondary transition-colors hover:bg-primary-wash hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-navy data-[state=open]:bg-primary-wash motion-reduce:transition-none"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><circle cx="3" cy="7" r="1.3" fill="currentColor" /><circle cx="7" cy="7" r="1.3" fill="currentColor" /><circle cx="11" cy="7" r="1.3" fill="currentColor" /></svg>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            side="bottom"
            align="end"
            sideOffset={6}
            class="z-[100] min-w-[11.25rem] rounded-xl border border-line bg-surface p-1.5 shadow-menu outline-none"
          >
            <DropdownMenu.Item onSelect={() => (preview = file)} data-company-file-action="open" class={menuItem}>
              <EyeIcon size="0.9375rem" class="text-ink-muted" aria-hidden="true" />
              Open
            </DropdownMenu.Item>
            {#if canManage}
              {#if file.archived}
                <DropdownMenu.Item onSelect={() => void setArchived(file, false)} data-company-file-action="restore" class={menuItem}>
                  <ArrowCounterClockwiseIcon size="0.9375rem" class="text-ink-muted" aria-hidden="true" />
                  Restore
                </DropdownMenu.Item>
              {:else}
                <DropdownMenu.Item onSelect={() => void setArchived(file, true)} data-company-file-action="archive" class={menuItem}>
                  <ArchiveIcon size="0.9375rem" class="text-ink-muted" aria-hidden="true" />
                  Archive
                </DropdownMenu.Item>
              {/if}
              <DropdownMenu.Separator class="mx-1 my-1 h-px bg-line-soft" />
              <DropdownMenu.Item
                onSelect={() => {
                  removing = file;
                  removeOpen = true;
                }}
                data-company-file-action="remove"
                class="flex h-8 w-full cursor-default items-center gap-2 rounded-md px-2 text-[0.8125rem] text-danger-ink-muted outline-none data-[highlighted]:bg-danger-surface pointer-coarse:h-11"
              >
                <TrashIcon size="0.9375rem" aria-hidden="true" />
                Remove
              </DropdownMenu.Item>
            {/if}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </span>
  </li>
{/snippet}

<div class="flex flex-col gap-4" data-company-files>
  <div class="flex flex-wrap items-center gap-3">
    <p class="min-w-0 flex-1 text-[0.8125rem] leading-[calc(18/13)] text-ink-secondary">
      Every project of {companyName} can use these files in its drafts and chat.
    </p>
    {#if canAdd}
      <input
        bind:this={inputEl}
        data-company-files-input
        type="file"
        multiple
        class="hidden"
        tabindex={-1}
        aria-hidden="true"
        accept={SUPPORTED_ACCEPT}
        onchange={(event) => {
          const input = event.currentTarget;
          if (input.files?.length) addFiles(Array.from(input.files));
          input.value = "";
        }}
      />
      <button type="button" data-company-files-upload onclick={() => inputEl?.click()} class={quietButton}>Upload files</button>
    {/if}
  </div>

  {#if uploads.length > 0}
    <ul class="flex flex-col gap-1.5" aria-label="Files being added" data-company-file-uploads>
      {#each uploads as upload (upload.id)}
        <li class="flex min-w-0 items-center gap-2 text-[0.8125rem] leading-[calc(18/13)]" role={upload.error ? "alert" : "status"}>
          <span class="min-w-0 truncate text-ink">{upload.name}</span>
          {#if upload.error}
            <span class="min-w-0 flex-1 truncate text-danger-ink-muted">{upload.error}</span>
            <button type="button" onclick={() => retryUpload(upload.id)} class={textButton}>Try again</button>
            <button type="button" onclick={() => dismissUpload(upload.id)} class={textButton}>Dismiss</button>
          {:else}
            <span class="text-ink-muted">Adding...</span>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  {#if actionError}
    <p role="alert" class="text-[0.8125rem] leading-[calc(18/13)] text-danger-ink-muted" data-company-files-error>{actionError}</p>
  {/if}

  {#if failed}
    <p role="alert" class="py-6 text-[0.8125rem] leading-[calc(18/13)] text-ink" data-company-files-failed>The files could not be loaded.</p>
  {:else if loading}
    <div role="status" aria-label="Loading files" class="flex flex-col gap-2" data-company-files-loading>
      {#each [0, 1, 2] as item (item)}
        <div class="h-14 animate-pulse rounded-lg bg-chrome motion-reduce:animate-none"></div>
      {/each}
    </div>
  {:else if files.length === 0}
    <p class="py-6 text-[0.8125rem] leading-[calc(18/13)] text-ink-secondary" data-company-files-empty>
      {companyName} has no files yet.{canAdd ? " Upload past reports, scoping notes or background the writers should know." : ""}
    </p>
  {:else}
    <ul class="divide-y divide-line-soft rounded-xl border border-line" aria-label="Company files" data-company-files-list>
      {#each files as file (file._id)}
        {@render fileRow(file)}
      {/each}
    </ul>
    {#if filesQ.data?.truncated}
      <p class="text-xs leading-[calc(4/3)] text-ink-muted">Showing the newest {files.length} files.</p>
    {/if}
  {/if}

  {#if clientId && !failed}
    <div class="flex flex-col gap-3 pt-2">
      <button
        type="button"
        data-company-files-archived-toggle
        aria-expanded={showArchived}
        onclick={() => (showArchived = !showArchived)}
        class={`${textButton} self-start`}
      >{showArchived ? "Hide archived files" : "Show archived files"}</button>
      {#if showArchived}
        {#if archivedQ.data === undefined}
          <p role="status" class="text-[0.8125rem] leading-[calc(18/13)] text-ink-muted">Loading...</p>
        {:else if archivedQ.data.files.length === 0}
          <p class="text-[0.8125rem] leading-[calc(18/13)] text-ink-muted" data-company-files-archived-empty>No archived files.</p>
        {:else}
          <ul class="divide-y divide-line-soft rounded-xl border border-line" aria-label="Archived company files" data-company-files-archived>
            {#each archivedQ.data.files as file (file._id)}
              {@render fileRow(file)}
            {/each}
          </ul>
        {/if}
      {/if}
    </div>
  {/if}
</div>

{#if preview}
  {@const url = preview.url}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-6" onclick={() => (preview = null)}>
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      use:focusOnMount
      aria-label={preview.fileName}
      class="flex h-[80vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-surface shadow-dialog"
      onclick={(event) => event.stopPropagation()}
      data-company-file-preview
    >
      <div class="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
        <span class="truncate text-sm leading-[calc(10/7)] font-medium text-ink">{preview.fileName}</span>
        <div class="flex items-center gap-2">
          {#if url}
            <a href={url} target="_blank" rel="noopener noreferrer" class={quietButton}>Open in tab</a>
          {/if}
          <button
            type="button"
            onclick={() => (preview = null)}
            aria-label="Close preview"
            class="flex size-8 items-center justify-center rounded-lg text-ink-muted hover:bg-primary-wash hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-navy"
          >
            <svg class="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
      </div>
      <div class="flex-1 overflow-auto bg-canvas">
        {#if previewIsPdf && url}
          <iframe src={url} class="h-full w-full" title={preview.fileName}></iframe>
        {:else if previewIsImage && url}
          <img src={url} alt={preview.fileName} class="mx-auto max-h-full" />
        {:else if previewContentQ.data === undefined}
          <p class="px-6 py-6 text-sm leading-[calc(10/7)] text-ink-muted">Loading...</p>
        {:else if previewContentQ.data?.textFormat === "markdown" && previewContentQ.data.content.trim() && previewContentQ.data.content.length <= MARKDOWN_PREVIEW_MAX_CHARS}
          <div class="px-6 py-6" data-testid="company-file-preview-markdown">
            <MessageContent markdown role="assistant" text={previewContentQ.data.content} />
          </div>
        {:else}
          <pre class="whitespace-pre-wrap px-6 py-6 font-sans text-sm leading-[1.6] text-ink-secondary">{previewContentQ.data?.content
              ? normalizeExtractedText(quotableFileText(previewContentQ.data.content, previewContentQ.data.textFormat))
              : "No text content."}</pre>
        {/if}
      </div>
    </div>
  </div>
{/if}

<AlertDialog.Root bind:open={removeOpen}>
  <AlertDialog.Portal>
    <AlertDialog.Overlay class="fixed inset-0 z-[130] bg-dialog-scrim" />
    <AlertDialog.Content
      data-company-file-remove-dialog
      class="fixed left-1/2 top-1/2 z-[130] w-[calc(100%-2rem)] max-w-[25rem] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-line bg-surface shadow-dialog"
    >
      <div class="flex flex-col gap-1.5 px-6 pt-6">
        <AlertDialog.Title class="text-lg leading-[calc(4/3)] font-medium text-ink">Remove this file for every project of {companyName}?</AlertDialog.Title>
        <AlertDialog.Description class="text-sm leading-[calc(10/7)] text-ink-muted">
          {removing?.fileName}. Drafts already written from it keep their copy. This can't be undone; archive it instead to keep it.
        </AlertDialog.Description>
      </div>
      <div class="flex items-center justify-end gap-2 px-6 pt-5 pb-5">
        <AlertDialog.Cancel
          class="h-9 rounded-lg bg-chrome px-3.5 text-sm leading-[calc(10/7)] font-medium text-ink hover:bg-primary-wash focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary pointer-coarse:h-11"
        >Keep</AlertDialog.Cancel>
        <AlertDialog.Action
          data-confirm-company-file-remove
          onclick={() => {
            removeOpen = false;
            if (removing) void remove(removing);
          }}
          class="h-9 rounded-lg bg-danger-action px-4 text-sm leading-[calc(10/7)] font-medium text-white hover:bg-danger-action-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger focus-visible:ring-offset-2 pointer-coarse:h-11"
        >Remove</AlertDialog.Action>
      </div>
    </AlertDialog.Content>
  </AlertDialog.Portal>
</AlertDialog.Root>
