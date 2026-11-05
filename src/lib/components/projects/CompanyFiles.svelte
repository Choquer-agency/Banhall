<!--
  The Files tab of a company page: the files a company holds for every
  project linked to it (2026-10-26, Phase C), redesigned with the company
  profile (2026-11-04, Paper "Companies redesign, round 3", sections 2 to 4).

  - The list groups files: those nothing could be read from, then by fiscal
    year, then no fiscal year; archived files last ("Archived, not used by
    the AI") with Restore and Delete. Find a file filters by name.
  - Each row: type icon, name, category (else the AI's kind) and words, a
    preview eye before the date on hover, and a menu: Edit details
    (companyFiles.add), Download original, Replace file, then Archive and
    Delete (companyFiles.manage). Edit details opens the category and
    fiscal year chips in the row; Archive happens at once with Undo; Delete
    asks first.
  - Select ticks files for a dark bar at the bottom with Download: one file
    as itself, several as one zip.
  - Add files opens a centred dialog; files can also be dropped anywhere on
    the page while the tab shows (a light overlay and a dark bar: "Drop to
    add <n> files to <company>", "Up to 50 MB each"). A file dropped on a
    file's row opens Replace file for it (Managers and Admins; others add).
    Each file shows its progress; one over 50 MB says "Too large, up to 50
    MB" and is not sent. Files added here wait in Just added for a person to
    confirm their category and fiscal year.
  - The preview is a full-screen viewer (FilePreview.svelte).

  A company known only by its projects' name has no company row yet: the
  tab says it has no files, and the first upload makes the row. The tab
  stays mounted while hidden, so files still being added finish; the list
  is read while hidden too, so the frame's Files tab can show its count
  (`onCount`).
-->
<script lang="ts">
  import { AlertDialog, DropdownMenu } from "bits-ui";
  import { useMutation, useQuery } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { SvelteSet } from "svelte/reactivity";
  import { toast } from "svelte-sonner";
  import { api } from "../../../../convex/_generated/api";
  import type { Id } from "../../../../convex/_generated/dataModel";
  import FileIcon from "$lib/components/ui/FileIcon.svelte";
  import Checkbox from "$lib/components/ui/Checkbox.svelte";
  import { userErrorMessage } from "$lib/errors";
  import { isParseAbort } from "$lib/spreadsheetClient";
  import {
    CompanyFileTooLargeError,
    isTooLarge,
    prepareCompanyFile,
    storeCompanyFile,
    type PreparedCompanyFile,
  } from "$lib/uploads/storeCompanyFile";
  import AddFilesDialog from "$lib/components/companies/files/AddFilesDialog.svelte";
  import FileDetailsChips from "$lib/components/companies/files/FileDetailsChips.svelte";
  import FilePreview from "$lib/components/companies/files/FilePreview.svelte";
  import ReplaceFileDialog from "$lib/components/companies/files/ReplaceFileDialog.svelte";
  import UploadRow from "$lib/components/companies/files/UploadRow.svelte";
  import {
    addedLabel,
    couldNotRead,
    describeFile,
    draggedFileTypes,
    draggedTypeLabel,
    dragHasFiles,
    fiscalYearOf,
    fiscalYearOptions,
    groupFiles,
    wordsLabel,
    type CompanyFileCategory,
    type ListedCompanyFile,
  } from "$lib/components/companies/files/fileMeta";
  import {
    downloadOriginals,
    MAX_DOWNLOAD_FILES,
    NoOriginalsError,
    TooMuchToDownloadError,
  } from "$lib/components/companies/files/downloadOriginals";
  import { inFlight, type UploadEntry } from "$lib/components/companies/files/uploads";

  let {
    companyKey,
    companyName,
    active = true,
    canAdd = false,
    canManage = false,
    canEdit = undefined,
    onCount = undefined,
  }: {
    companyKey: string;
    companyName: string;
    /**
     * Shown. The tab stays mounted while hidden, so files still being added
     * finish and their refusals are shown when it is shown again; the page
     * drop and the archived list work only while it shows.
     */
    active?: boolean;
    canAdd?: boolean;
    canManage?: boolean;
    /** Edit details (companyFiles.add); the same as `canAdd` when not given. */
    canEdit?: boolean;
    /** The number of files (not archived), or null while unknown, for the tab's count. */
    onCount?: (count: number | null) => void;
  } = $props();

  const mayEdit = $derived(canEdit ?? canAdd);
  /** How long a file just added waits for its labels before its chips show anyway. */
  const LABEL_WAIT_MS = 120_000;

  const auth = useAuth();
  const ensureCompany = useMutation(api.companyFiles.ensureCompanyForKey);
  const generateUploadUrl = useMutation(api.companyFiles.generateCompanyUploadUrl);
  const addCompanyFile = useMutation(api.companyFiles.addCompanyFile);
  const setCompanyFileArchived = useMutation(api.companyFiles.setCompanyFileArchived);
  const removeCompanyFile = useMutation(api.companyFiles.removeCompanyFile);
  const setFilesFiscalYear = useMutation(api.companyFiles.setCompanyFilesFiscalYear);
  const setFilesArchived = useMutation(api.companyFiles.setCompanyFilesArchived);
  const removeFiles = useMutation(api.companyFiles.removeCompanyFiles);
  const updateDetails = useMutation(api.companyFiles.updateCompanyFileDetails);
  const replaceCompanyFile = useMutation(api.companyFiles.replaceCompanyFile);

  const companyQ = useQuery(api.companyFiles.companyForKey, () => (auth.isAuthenticated ? { key: companyKey } : "skip"));
  /** Company rows the first uploads made, by company key. */
  let madeClientIds = $state<Record<string, Id<"clients">>>({});
  const clientId = $derived(companyQ.data?.clientId ?? madeClientIds[companyKey] ?? null);
  const filesQ = useQuery(api.companyFiles.listCompanyFiles, () => (clientId ? { clientId } : "skip"));
  const archivedQ = useQuery(api.companyFiles.listCompanyFiles, () =>
    active && clientId ? { clientId, archived: true } : "skip"
  );

  const files = $derived(filesQ.data?.files ?? []);
  const archived = $derived(archivedQ.data?.files ?? []);
  const loading = $derived(
    companyQ.data === undefined || (clientId !== null && filesQ.data === undefined && !filesQ.error)
  );
  const failed = $derived(Boolean(companyQ.error || filesQ.error));

  // The frame's Files tab count.
  $effect(() => {
    const count = failed ? null : companyQ.data === null && !clientId ? 0 : filesQ.data ? files.length : null;
    onCount?.(count);
  });

  // A clock for files waiting on their labels.
  let now = $state(Date.now());
  $effect(() => {
    const timer = setInterval(() => (now = Date.now()), 15_000);
    return () => clearInterval(timer);
  });

  // ─── Uploads ──────────────────────────────────────────────────────────────
  // One at a time, in the order picked, each to the company it was picked
  // for (the tab may show another company by then). Each file keeps its own
  // key, so Try again after a lost answer finds the row the first save made.
  let uploads = $state<UploadEntry[]>([]);
  const shownUploads = $derived(uploads.filter((entry) => entry.companyKey === companyKey));
  /** Files added from this page, waiting for a person to confirm their details, by company key. */
  let justAdded = $state<{ companyKey: string; id: Id<"companyFiles"> }[]>([]);
  const justAddedIds = $derived(new Set(justAdded.filter((entry) => entry.companyKey === companyKey).map((entry) => entry.id)));
  let nextUploadId = 0;
  const pending: UploadEntry[] = [];
  const controllers = new Map<number, AbortController>();
  let running = false;

  async function targetOf(upload: UploadEntry): Promise<Id<"clients">> {
    const known = upload.clientId ?? madeClientIds[upload.companyKey];
    if (known) return known;
    const made = await ensureCompany({ key: upload.companyKey });
    madeClientIds = { ...madeClientIds, [upload.companyKey]: made.clientId };
    return made.clientId;
  }

  function patchUpload(id: number, patch: Partial<UploadEntry>) {
    uploads = uploads.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry));
  }

  function queue(entries: UploadEntry[]) {
    pending.push(...entries);
    if (!running) void drain();
  }

  async function drain() {
    running = true;
    while (pending.length > 0) {
      const upload = pending.shift()!;
      const controller = new AbortController();
      controllers.set(upload.id, controller);
      try {
        const { companyFileId } = await storeCompanyFile(
          { generateUploadUrl: () => generateUploadUrl({}), addCompanyFile: (args) => addCompanyFile(args) },
          {
            clientId: await targetOf(upload),
            file: upload.file,
            attemptKey: upload.attemptKey,
            signal: controller.signal,
            onProgress: (progress) =>
              patchUpload(upload.id, progress.phase === "uploading" ? { phase: "uploading", fraction: progress.fraction } : { phase: progress.phase }),
          }
        );
        uploads = uploads.filter((entry) => entry.id !== upload.id);
        if (!justAdded.some((entry) => entry.id === companyFileId)) {
          justAdded = [...justAdded, { companyKey: upload.companyKey, id: companyFileId }];
        }
      } catch (error) {
        if (controller.signal.aborted || isParseAbort(error)) {
          uploads = uploads.filter((entry) => entry.id !== upload.id);
        } else if (error instanceof CompanyFileTooLargeError) {
          patchUpload(upload.id, { phase: "too_large" });
        } else {
          patchUpload(upload.id, { phase: "failed", error: userErrorMessage(error, "This file could not be added. Try again.") });
        }
      } finally {
        controllers.delete(upload.id);
      }
    }
    running = false;
  }

  function addFiles(picked: File[]) {
    if (!canAdd || picked.length === 0) return;
    const entries: UploadEntry[] = picked.map((file) => ({
      id: nextUploadId++,
      name: file.name,
      size: file.size,
      file,
      attemptKey: crypto.randomUUID(),
      companyKey,
      clientId,
      // Over 50 MB: refused here, never sent.
      phase: isTooLarge(file) ? "too_large" : "waiting",
      fraction: 0,
      error: null,
    }));
    uploads = [...uploads, ...entries];
    queue(entries.filter((entry) => entry.phase === "waiting"));
  }

  function retryUpload(id: number) {
    const upload = uploads.find((entry) => entry.id === id);
    if (!upload || upload.phase !== "failed") return;
    patchUpload(id, { phase: "waiting", error: null, fraction: 0 });
    queue([{ ...upload, phase: "waiting", error: null }]);
  }

  function stopUpload(id: number) {
    const current = uploads.find((entry) => entry.id === id);
    if (current && !inFlight(current)) return;
    const waiting = pending.findIndex((entry) => entry.id === id);
    if (waiting >= 0) pending.splice(waiting, 1);
    controllers.get(id)?.abort();
    uploads = uploads.filter((entry) => entry.id !== id);
  }

  function dismissUpload(id: number) {
    uploads = uploads.filter((entry) => entry.id !== id);
  }

  function stopAllUploads() {
    for (const upload of shownUploads) if (inFlight(upload)) stopUpload(upload.id);
    addOpen = false;
  }

  // ─── Just added: confirm the details ──────────────────────────────────────
  const justAddedFiles = $derived(
    justAdded
      .filter((entry) => entry.companyKey === companyKey)
      .map((entry) => files.find((file) => file._id === entry.id))
      .filter((file): file is ListedCompanyFile => file !== undefined)
  );
  /** Files nobody confirmed yet whose labels are still being made. */
  function labelling(file: ListedCompanyFile): boolean {
    return !file.labels && !couldNotRead(file) && now - file.createdAt < LABEL_WAIT_MS;
  }
  let savingDetails = $state<Id<"companyFiles"> | null>(null);

  async function saveDetails(
    file: ListedCompanyFile,
    details: { category: CompanyFileCategory | null; fiscalYear: number | null },
    after: () => void
  ) {
    // Confirming what is shown (the AI label's year included) writes nothing.
    const unchanged = details.category === (file.category ?? null) && details.fiscalYear === fiscalYearOf(file);
    if (unchanged) {
      after();
      return;
    }
    savingDetails = file._id;
    try {
      await updateDetails({ companyFileId: file._id, category: details.category, fiscalYear: details.fiscalYear });
      after();
    } catch (error) {
      toast.error(userErrorMessage(error, "The details could not be saved."));
    } finally {
      savingDetails = null;
    }
  }

  function confirmJustAdded(id: Id<"companyFiles">) {
    justAdded = justAdded.filter((entry) => entry.id !== id);
  }

  // ─── Edit details in the row ──────────────────────────────────────────────
  let editingId = $state<Id<"companyFiles"> | null>(null);

  // ─── Search, groups ───────────────────────────────────────────────────────
  let search = $state("");
  const query = $derived(search.trim().toLowerCase());
  const matches = (file: ListedCompanyFile) => !query || file.fileName.toLowerCase().includes(query);
  const listedFiles = $derived(files.filter((file) => !justAddedIds.has(file._id) && matches(file)));
  const groups = $derived(groupFiles(listedFiles));
  const shownArchived = $derived(archived.filter(matches));
  /** Every file the preview can move through, in the order shown. */
  const previewOrder = $derived([...justAddedFiles, ...groups.flatMap((group) => group.files)]);

  // ─── Select and download ──────────────────────────────────────────────────
  let selectMode = $state(false);
  const selected = new SvelteSet<Id<"companyFiles">>();
  let downloading = $state(false);
  const selectedFiles = $derived([...files, ...archived].filter((file) => selected.has(file._id)));

  // Files that left the list leave the selection.
  $effect(() => {
    const present = new Set([...files, ...archived].map((file) => file._id));
    for (const id of selected) if (!present.has(id)) selected.delete(id);
  });

  function clearSelection() {
    selected.clear();
    selectMode = false;
  }

  /** The server's bounds per call (convex/companyFiles.ts); more are sent in turns. */
  const BULK_FILE_LIMIT = 200;
  const BULK_REMOVE_LIMIT = 50;
  let bulkBusy = $state(false);

  function chunks<T>(items: readonly T[], size: number): T[][] {
    const out: T[][] = [];
    for (let at = 0; at < items.length; at += size) out.push(items.slice(at, at + size));
    return out;
  }

  const filesWord = (count: number) => `${count} ${count === 1 ? "file" : "files"}`;

  /** Move to fiscal year: every selected file under one year (null: none). */
  async function moveSelected(fiscalYear: number | null) {
    if (!clientId || bulkBusy || selectedFiles.length === 0) return;
    bulkBusy = true;
    const ids = selectedFiles.map((file) => file._id);
    try {
      for (const part of chunks(ids, BULK_FILE_LIMIT)) await setFilesFiscalYear({ clientId, companyFileIds: part, fiscalYear });
      justAdded = justAdded.filter((entry) => !ids.includes(entry.id));
      toast(`${filesWord(ids.length)} moved to ${fiscalYear === null ? "no fiscal year" : `FY ${fiscalYear}`}`);
      clearSelection();
    } catch (error) {
      toast.error(userErrorMessage(error, "The files could not be moved."));
    } finally {
      bulkBusy = false;
    }
  }

  /** Archive: the selected files not archived yet, at once, with one Undo for the batch. */
  async function archiveSelected() {
    if (!clientId || bulkBusy) return;
    const target = clientId;
    const ids = selectedFiles.filter((file) => !file.archived).map((file) => file._id);
    if (ids.length === 0) return;
    bulkBusy = true;
    try {
      const changed: Id<"companyFiles">[] = [];
      for (const part of chunks(ids, BULK_FILE_LIMIT)) {
        changed.push(...(await setFilesArchived({ clientId: target, companyFileIds: part, archived: true })).changed);
      }
      clearSelection();
      toast(`${filesWord(changed.length)} archived`, {
        action: {
          label: "Undo",
          onClick: () =>
            void (async () => {
              try {
                for (const part of chunks(changed, BULK_FILE_LIMIT)) await setFilesArchived({ clientId: target, companyFileIds: part, archived: false });
              } catch (error) {
                toast.error(userErrorMessage(error, "The files could not be restored."));
              }
            })(),
        },
      });
    } catch (error) {
      toast.error(userErrorMessage(error, "The files could not be archived."));
    } finally {
      bulkBusy = false;
    }
  }

  /** Delete: every selected file, after one confirmation. */
  async function removeSelected(ids: Id<"companyFiles">[]) {
    if (!clientId || bulkBusy || ids.length === 0) return;
    bulkBusy = true;
    // Each call is its own transaction: when a later one fails, the earlier
    // ones stand, and the files not deleted stay selected.
    const done: Id<"companyFiles">[] = [];
    try {
      for (const part of chunks(ids, BULK_REMOVE_LIMIT)) {
        await removeFiles({ clientId, companyFileIds: part });
        done.push(...part);
      }
      clearSelection();
      toast(`${filesWord(done.length)} deleted`);
    } catch (error) {
      const reason = userErrorMessage(error, "The files could not be deleted.");
      for (const id of done) selected.delete(id);
      toast.error(done.length > 0 ? `Deleted ${done.length} of ${ids.length} files. The rest could not be deleted: ${reason}` : reason);
    } finally {
      justAdded = justAdded.filter((entry) => !done.includes(entry.id));
      bulkBusy = false;
    }
  }

  async function download(list: readonly ListedCompanyFile[]) {
    if (downloading || list.length === 0) return;
    downloading = true;
    try {
      const { skipped } = await downloadOriginals(list, `${companyName} files`);
      if (skipped > 0) toast.info(`${skipped} ${skipped === 1 ? "file has" : "files have"} no original and ${skipped === 1 ? "was" : "were"} left out.`);
    } catch (error) {
      toast.error(
        error instanceof NoOriginalsError || error instanceof TooMuchToDownloadError
          ? error.message
          : userErrorMessage(error, "The originals could not be downloaded.")
      );
    } finally {
      downloading = false;
    }
  }

  // ─── Preview ──────────────────────────────────────────────────────────────
  let previewOpen = $state(false);
  let previewIndex = $state(0);
  /** The row whose file the preview opened on; focus goes back to it on close. */
  let previewReturnId: string | null = null;
  const previewFiles = $derived(previewOpen ? previewOrder : []);

  function openPreview(file: ListedCompanyFile) {
    const index = previewOrder.findIndex((candidate) => candidate._id === file._id);
    if (index < 0) return;
    previewReturnId = file._id;
    previewIndex = index;
    previewOpen = true;
  }

  function focusRow(id: string | null, event: Event) {
    const target = id
      ? document.querySelector<HTMLElement>(`[data-company-file="${CSS.escape(id)}"] [data-company-file-open]`)
      : null;
    if (!target) return;
    event.preventDefault();
    target.focus();
  }

  // ─── Archive, restore, delete ─────────────────────────────────────────────
  let deleting = $state<ListedCompanyFile | null>(null);
  /** The selection's files, when Delete was pressed on the selection bar. */
  let deletingMany = $state<Id<"companyFiles">[] | null>(null);
  let deleteOpen = $state(false);

  async function setArchived(file: ListedCompanyFile, value: boolean) {
    try {
      await setCompanyFileArchived({ companyFileId: file._id, archived: value });
      if (value) {
        toast("File archived", { action: { label: "Undo", onClick: () => void setArchived(file, false) } });
      }
    } catch (error) {
      toast.error(userErrorMessage(error, value ? "The file could not be archived." : "The file could not be restored."));
    }
  }

  async function remove(file: ListedCompanyFile) {
    try {
      await removeCompanyFile({ companyFileId: file._id });
      justAdded = justAdded.filter((entry) => entry.id !== file._id);
      toast("File deleted");
    } catch (error) {
      toast.error(userErrorMessage(error, "The file could not be deleted."));
    }
  }

  // ─── Replace ──────────────────────────────────────────────────────────────
  let replaceOpen = $state(false);
  let replaceTarget = $state<ListedCompanyFile | null>(null);
  let replaceFile = $state<File | null>(null);
  let replaceReturnId: string | null = null;

  function openReplace(file: ListedCompanyFile, dropped: File | null = null) {
    replaceTarget = file;
    replaceFile = dropped;
    replaceReturnId = file._id;
    replaceOpen = true;
  }

  function prepareReplacement(file: File, onProgress: Parameters<typeof prepareCompanyFile>[1]["onProgress"], signal: AbortSignal) {
    return prepareCompanyFile({ generateUploadUrl: () => generateUploadUrl({}) }, { file, signal, ...(onProgress ? { onProgress } : {}) });
  }

  async function commitReplacement(target: ListedCompanyFile, prepared: PreparedCompanyFile) {
    if (!prepared.storageId) throw new Error("The new version could not be uploaded. Try again.");
    await replaceCompanyFile({
      companyFileId: target._id,
      fileName: prepared.fileName,
      fileType: prepared.fileType,
      content: prepared.content,
      storageId: prepared.storageId,
      extractionOutcome: prepared.extractionFailed ? "failed" : "ok",
      ...(prepared.textFormat ? { textFormat: prepared.textFormat } : {}),
      ...(prepared.mimeType ? { mimeType: prepared.mimeType } : {}),
    });
    toast("File replaced");
  }

  // ─── Add files dialog and the page drop ───────────────────────────────────
  let addOpen = $state(false);
  /** The types of the files being dragged over the page, or null. */
  let dragTypes = $state<string[] | null>(null);
  /** The row a single file is being dragged over, for Replace file. */
  let dragRowId = $state<Id<"companyFiles"> | null>(null);
  const anyDialogOpen = $derived(addOpen || replaceOpen || previewOpen || deleteOpen);
  const pageDropOn = $derived(active && canAdd && !anyDialogOpen && !failed);
  const replaceOnRow = $derived(canManage && dragTypes !== null && dragTypes.length === 1);

  $effect(() => {
    if (!pageDropOn) {
      dragTypes = null;
      dragRowId = null;
      return;
    }
    let depth = 0;
    const reset = () => {
      depth = 0;
      dragTypes = null;
      dragRowId = null;
    };
    const enter = (event: DragEvent) => {
      if (!dragHasFiles(event)) return;
      event.preventDefault();
      depth += 1;
      if (depth === 1 || dragTypes === null) dragTypes = draggedFileTypes(event);
    };
    const over = (event: DragEvent) => {
      if (!dragHasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    };
    const leave = (event: DragEvent) => {
      if (!dragHasFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) reset();
    };
    const drop = (event: DragEvent) => {
      if (!dragHasFiles(event)) return;
      event.preventDefault();
      const dropped = Array.from(event.dataTransfer?.files ?? []);
      reset();
      addFiles(dropped);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") reset();
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    window.addEventListener("dragend", reset);
    window.addEventListener("blur", reset);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
      window.removeEventListener("dragend", reset);
      window.removeEventListener("blur", reset);
      window.removeEventListener("keydown", key);
    };
  });

  function rowDragOver(event: DragEvent, file: ListedCompanyFile) {
    // The website file is read again, never replaced by hand: a drop on it adds.
    if (!replaceOnRow || file.fromWebsite || !dragHasFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    dragRowId = file._id;
  }

  function rowDragLeave(event: DragEvent, file: ListedCompanyFile) {
    const next = event.relatedTarget as Node | null;
    if (dragRowId === file._id && !(next && (event.currentTarget as HTMLElement).contains(next))) dragRowId = null;
  }

  function rowDrop(event: DragEvent, file: ListedCompanyFile) {
    if (!replaceOnRow || file.fromWebsite || !dragHasFiles(event)) return;
    const dropped = Array.from(event.dataTransfer?.files ?? []);
    if (dropped.length !== 1) return;
    // The page's drop (add) does not see it.
    event.preventDefault();
    event.stopPropagation();
    dragTypes = null;
    dragRowId = null;
    openReplace(file, dropped[0]!);
  }

  // ─── Classes ──────────────────────────────────────────────────────────────
  const menuItem =
    "flex min-h-9 w-full cursor-default items-center gap-2.5 rounded-md px-2.5 text-sm leading-[calc(9/7)] text-ink-secondary outline-none data-[highlighted]:bg-primary-wash data-[highlighted]:text-ink data-[disabled]:opacity-50 pointer-coarse:min-h-11";
  const rowIconButton =
    "flex size-8 shrink-0 items-center justify-center rounded-md text-ink-secondary transition-colors hover:bg-gray-100 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-navy motion-reduce:transition-none pointer-coarse:size-11";
  const textAction =
    "rounded-md px-1.5 py-1 text-xs leading-[calc(4/3)] text-ink-secondary transition-colors hover:bg-primary-wash hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-navy motion-reduce:transition-none pointer-coarse:min-h-11";
  const barButton =
    "inline-flex h-8 items-center gap-1.5 rounded-[0.4375rem] px-3 text-[0.8125rem] leading-[calc(18/13)] font-medium whitespace-nowrap transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-light disabled:opacity-50 motion-reduce:transition-none pointer-coarse:h-11";
  const toolbarButton =
    "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md pr-3 pl-2.5 text-[0.8125rem] leading-[calc(18/13)] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy motion-reduce:transition-none pointer-coarse:h-11";
</script>

{#snippet countBadge(count: number, muted = false)}
  <span class={`flex h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-full px-1 text-[0.625rem] leading-[1.2] ${muted ? "bg-gray-50 text-ink-faint" : "bg-chrome text-primary-selected"}`}>{count}</span>
{/snippet}

{#snippet rowMenu(file: ListedCompanyFile)}
  <DropdownMenu.Root>
    <DropdownMenu.Trigger
      aria-label={`More actions for ${file.fileName}`}
      data-company-file-menu={file._id}
      class={`${rowIconButton} data-[state=open]:bg-primary-wash data-[state=open]:text-ink`}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.7" fill="currentColor" /><circle cx="12" cy="12" r="1.7" fill="currentColor" /><circle cx="19" cy="12" r="1.7" fill="currentColor" /></svg>
    </DropdownMenu.Trigger>
    <DropdownMenu.Portal>
      <DropdownMenu.Content side="bottom" align="end" sideOffset={6} class="z-[100] w-[13.75rem] rounded-lg border border-line bg-surface p-1 shadow-menu outline-none">
        {#if mayEdit}
          <DropdownMenu.Item onSelect={() => (editingId = file._id)} data-company-file-action="edit" class={menuItem}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4" /></svg>
            Edit details
          </DropdownMenu.Item>
        {/if}
        <DropdownMenu.Item disabled={!file.url} onSelect={() => void download([file])} data-company-file-action="download" class={menuItem}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></svg>
          Download original
        </DropdownMenu.Item>
        {#if canManage}
          {#if !file.fromWebsite}
            <DropdownMenu.Item onSelect={() => openReplace(file)} data-company-file-action="replace" class={menuItem}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h13l-3-3M20 16H7l3 3" /></svg>
              Replace file
            </DropdownMenu.Item>
          {/if}
          <DropdownMenu.Separator class="-mx-1 my-1 h-px bg-line-soft" />
          <DropdownMenu.Item onSelect={() => void setArchived(file, true)} data-company-file-action="archive" class={menuItem}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="4" rx="1" /><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4" /></svg>
            Archive
          </DropdownMenu.Item>
          <DropdownMenu.Item
            onSelect={() => {
              deleting = file;
              deletingMany = null;
              deleteOpen = true;
            }}
            data-company-file-action="delete"
            class="flex min-h-9 w-full cursor-default items-center gap-2.5 rounded-md px-2.5 text-sm leading-[calc(9/7)] text-danger-ink-muted outline-none data-[highlighted]:bg-danger-surface pointer-coarse:min-h-11"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>
            Delete
          </DropdownMenu.Item>
        {/if}
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>
{/snippet}

{#snippet selectBox(file: ListedCompanyFile)}
  {#if selectMode}
    <span class="flex w-5 shrink-0 justify-center">
      <Checkbox
        checked={selected.has(file._id)}
        disabled={!selected.has(file._id) && selected.size >= MAX_DOWNLOAD_FILES}
        onCheckedChange={(value) => (value ? selected.add(file._id) : selected.delete(file._id))}
        aria-label={`Select ${file.fileName}`}
        data-company-file-select={file._id}
      />
    </span>
  {/if}
{/snippet}

{#snippet fileRow(file: ListedCompanyFile)}
  {@const editing = editingId === file._id}
  {@const dropHere = dragRowId === file._id}
  <li
    class={`group relative flex min-h-[3.75rem] min-w-0 flex-col justify-center gap-2 border-b border-line-soft px-2.5 py-2.5 last:border-b-0 ${dropHere ? "z-[1] rounded-lg bg-primary-wash ring-1 ring-primary" : selected.has(file._id) ? "bg-primary-wash/60" : "hover:bg-gray-50"}`}
    data-company-file={file._id}
    ondragover={(event) => rowDragOver(event, file)}
    ondragleave={(event) => rowDragLeave(event, file)}
    ondrop={(event) => rowDrop(event, file)}
  >
    <div class="flex min-w-0 items-center gap-3.5">
      {@render selectBox(file)}
      <span class="flex size-8 shrink-0 items-center justify-center"><FileIcon name={file.fileName} size={28} /></span>
      <div class="flex min-w-0 flex-1 flex-col gap-0.5">
        <button
          type="button"
          data-company-file-open
          onclick={() => openPreview(file)}
          class="max-w-full truncate rounded-sm text-left text-[0.8125rem] leading-[calc(18/13)] text-ink hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
        >{file.fileName}</button>
        {#if couldNotRead(file)}
          <p class="truncate text-xs leading-[calc(4/3)] text-gap-text" data-company-file-status>No text could be read. Drafts can name it but not quote it.</p>
        {:else}
          <p class="truncate text-xs leading-[calc(4/3)] text-ink-muted" data-company-file-kind>
            {describeFile(file)}{file.wordCount > 0 ? `, ${wordsLabel(file.wordCount)}` : ""}
          </p>
        {/if}
      </div>
      {#if dropHere}
        <span class="flex shrink-0 items-center gap-2 pr-2 text-[0.8125rem] leading-[calc(18/13)] font-medium text-primary-selected" data-company-file-drop-replace>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h13l-3-3M20 16H7l3 3" /></svg>
          Drop to replace this file
        </span>
      {:else}
        <button
          type="button"
          aria-label={`Preview ${file.fileName}`}
          onclick={() => openPreview(file)}
          data-company-file-preview-button
          class={`${rowIconButton} opacity-0 group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100`}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg>
        </button>
        <span class="shrink-0 text-xs leading-[calc(4/3)] text-ink-muted">{addedLabel(file.createdAt)}</span>
        {@render rowMenu(file)}
      {/if}
    </div>
    {#if editing}
      <div class="pl-[3.375rem]">
        <FileDetailsChips
          {file}
          busy={savingDetails === file._id}
          onCancel={() => (editingId = null)}
          onSave={(details) => void saveDetails(file, details, () => (editingId = null))}
        />
      </div>
    {/if}
  </li>
{/snippet}

<div class="flex flex-col" data-company-files>
  <div class="flex flex-wrap items-end gap-3">
    <div class="flex min-w-0 flex-1 flex-col gap-1">
      <h2 class="font-serif text-2xl leading-[calc(4/3)] text-ink">Files</h2>
      <p class="text-[0.8125rem] leading-[calc(18/13)] text-ink-muted">The documents drafts and chat use on every {companyName} project.</p>
    </div>
    <div role="search" class="relative w-[12.5rem] shrink-0">
      <svg class="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-muted" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
      <input
        bind:value={search}
        type="search"
        aria-label="Find a file"
        placeholder="Find a file"
        autocomplete="off"
        data-company-files-search
        onkeydown={(event) => {
          if (event.key === "Escape" && search) {
            event.stopPropagation();
            search = "";
          }
        }}
        class="field-control h-8 w-full rounded-md pr-2.5 pl-[1.875rem] text-[0.8125rem] leading-[calc(18/13)] text-ink placeholder:text-ink-faint pointer-coarse:h-11"
      />
    </div>
    <button
      type="button"
      aria-pressed={selectMode}
      data-company-files-select
      onclick={() => (selectMode ? clearSelection() : (selectMode = true))}
      class={`${toolbarButton} shadow-[inset_0_0_0_1px_var(--color-line)] ${selectMode ? "bg-gray-50 text-ink" : "bg-surface text-ink-secondary hover:bg-gray-50"}`}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 7 2 2 4-4M3 17l2 2 4-4M13 6h8M13 12h8M13 18h8" /></svg>
      Select
    </button>
    {#if canAdd}
      <button type="button" data-company-files-add onclick={() => (addOpen = true)} class={`${toolbarButton} bg-chrome text-primary-selected hover:bg-primary-wash`}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        Add files
      </button>
    {/if}
  </div>

  {#if dragTypes !== null || shownUploads.length > 0 || justAddedFiles.length > 0}
    <section class="flex flex-col gap-2 pt-7" aria-label="Just added" data-company-files-just-added>
      <h3 class="flex items-center gap-2 text-xs leading-[calc(4/3)] tracking-[0.04em] text-ink-muted uppercase">
        Just added {@render countBadge((dragTypes?.length ?? 0) + shownUploads.length + justAddedFiles.length)}
      </h3>
      {#if dragTypes !== null}
        <ul class="flex flex-col gap-1.5 rounded-xl bg-primary-wash p-1.5 ring-1 ring-primary-line-soft" aria-label="Files to drop" data-company-files-drop-preview>
          {#each dragTypes as type, position (position)}
            {@const named = draggedTypeLabel(type)}
            <li class="flex items-center gap-3.5 rounded-lg bg-surface px-3 py-2.5 shadow-[0_1px_2px_var(--color-line)]">
              <span class="flex size-8 shrink-0 items-center justify-center"><FileIcon name={named.name} size={28} /></span>
              <span class="flex flex-col">
                <span class="text-[0.8125rem] leading-[calc(18/13)] text-ink">{named.label}</span>
                <span class="text-xs leading-[calc(4/3)] text-ink-faint">Ready to add</span>
              </span>
            </li>
          {/each}
        </ul>
      {/if}
      {#if shownUploads.length > 0 || justAddedFiles.length > 0}
        <ul class="flex flex-col border-y border-line-soft [&>li]:border-b [&>li]:border-line-soft [&>li:last-child]:border-b-0" aria-label="Files being added" data-company-file-uploads>
          {#each shownUploads as upload (upload.id)}
            <UploadRow
              {upload}
              variant="row"
              onStop={() => stopUpload(upload.id)}
              onRetry={() => retryUpload(upload.id)}
              onDismiss={() => dismissUpload(upload.id)}
            />
          {/each}
          {#each justAddedFiles as file (file._id)}
            <li class="flex min-h-[3.75rem] min-w-0 items-center gap-3.5 px-2.5 py-2.5" data-company-file={file._id} data-company-file-just-added>
              <span class="flex size-8 shrink-0 items-center justify-center"><FileIcon name={file.fileName} size={28} /></span>
              <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                <button
                  type="button"
                  data-company-file-open
                  onclick={() => openPreview(file)}
                  class="max-w-full truncate rounded-sm text-left text-[0.8125rem] leading-[calc(18/13)] text-ink hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
                >{file.fileName}</button>
                {#if labelling(file)}
                  <p class="flex items-center gap-1.5 text-xs leading-[calc(4/3)] text-primary-selected" data-company-file-labelling>
                    <span class="size-3 animate-spin rounded-full border-2 border-primary-line-soft border-t-primary-selected motion-reduce:animate-none" aria-hidden="true"></span>
                    Reading and labelling
                  </p>
                {:else if couldNotRead(file)}
                  <p class="truncate text-xs leading-[calc(4/3)] text-gap-text">No text could be read. Drafts can name it but not quote it.</p>
                {:else}
                  <p class="truncate text-xs leading-[calc(4/3)] text-ink-muted">
                    {file.labels?.summary || describeFile(file)}{file.wordCount > 0 ? `, ${wordsLabel(file.wordCount)}` : ""}
                  </p>
                {/if}
              </div>
              {#if labelling(file)}
                <span class="flex shrink-0 gap-3" aria-hidden="true">
                  <span class="h-7 w-[8.25rem] rounded-md bg-gray-50"></span>
                  <span class="h-7 w-[5.25rem] rounded-md bg-gray-50"></span>
                </span>
              {:else if mayEdit}
                <span class="shrink-0">
                  <FileDetailsChips
                    {file}
                    action="Confirm"
                    busy={savingDetails === file._id}
                    onSave={(details) => void saveDetails(file, details, () => confirmJustAdded(file._id))}
                  />
                </span>
              {/if}
              {@render rowMenu(file)}
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {/if}

  {#if failed}
    <p role="alert" class="py-6 text-[0.8125rem] leading-[calc(18/13)] text-ink" data-company-files-failed>The files could not be loaded.</p>
  {:else if loading}
    <div role="status" aria-label="Loading files" class="flex flex-col gap-2 pt-7" data-company-files-loading>
      {#each [0, 1, 2] as item (item)}
        <div class="h-14 animate-pulse rounded-lg bg-chrome motion-reduce:animate-none"></div>
      {/each}
    </div>
  {:else if files.length === 0 && justAddedFiles.length === 0 && shownUploads.length === 0}
    <p class="py-8 text-[0.8125rem] leading-[calc(18/13)] text-ink-secondary" data-company-files-empty>
      {companyName} has no files yet.{canAdd ? " Add past reports, scoping notes or background the writers should know, or drop them here." : ""}
    </p>
  {:else}
    {#if query && groups.length === 0 && shownArchived.length === 0}
      <p class="py-8 text-[0.8125rem] leading-[calc(18/13)] text-ink-secondary" data-company-files-no-match>No file matches "{search.trim()}".</p>
    {/if}
    <div data-company-files-list>
      {#each groups as group (group.key)}
        <section class="flex flex-col gap-2 pt-7" aria-label={group.label} data-company-files-group={group.key}>
          <h3 class="flex items-center gap-2 text-xs leading-[calc(4/3)] tracking-[0.04em] text-ink-muted uppercase">
            {#if group.warning}<span class="size-1.5 rounded-full bg-warning" aria-hidden="true"></span>{/if}
            {group.label}
            {@render countBadge(group.files.length)}
          </h3>
          <ul class="flex flex-col border-y border-line-soft">
            {#each group.files as file (file._id)}
              {@render fileRow(file)}
            {/each}
          </ul>
        </section>
      {/each}
    </div>
    {#if filesQ.data?.truncated}
      <p class="pt-3 text-xs leading-[calc(4/3)] text-ink-muted">Showing the newest {files.length} files.</p>
    {/if}
  {/if}

  {#if clientId && !failed}
    {#if archivedQ.error}
      <p role="alert" class="pt-7 text-[0.8125rem] leading-[calc(18/13)] text-ink" data-company-files-archived-failed>Archived files could not be loaded.</p>
    {:else if shownArchived.length > 0}
      <section class="flex flex-col gap-2 pt-7" aria-label="Archived, not used by the AI" data-company-files-archived>
        <h3 class="flex items-center gap-2 text-xs leading-[calc(4/3)] tracking-[0.04em] text-ink-muted uppercase">
          Archived, not used by the AI {@render countBadge(shownArchived.length, true)}
        </h3>
        <ul class="flex flex-col border-y border-line-soft">
          {#each shownArchived as file (file._id)}
            <li class="flex min-h-[3.25rem] min-w-0 items-center gap-3.5 border-b border-line-soft px-2.5 py-2 last:border-b-0" data-company-file={file._id} data-company-file-archived>
              {@render selectBox(file)}
              <span class="flex size-8 shrink-0 items-center justify-center opacity-50"><FileIcon name={file.fileName} size={28} /></span>
              <span class="min-w-0 flex-1 truncate text-[0.8125rem] leading-[calc(18/13)] text-ink-muted">{file.fileName}</span>
              {#if canManage}
                <button type="button" onclick={() => void setArchived(file, false)} data-company-file-action="restore" aria-label={`Restore ${file.fileName}`} class={textAction}>Restore</button>
                <button
                  type="button"
                  onclick={() => {
                    deleting = file;
                    deletingMany = null;
                    deleteOpen = true;
                  }}
                  data-company-file-action="delete"
                  aria-label={`Delete ${file.fileName}`}
                  class={textAction}
                >Delete</button>
              {/if}
            </li>
          {/each}
        </ul>
      </section>
    {/if}
  {/if}
</div>

{#if selected.size > 0}
  <div
    role="toolbar"
    aria-label="Selected files"
    data-company-files-selection-bar
    class="fixed bottom-8 left-1/2 z-[90] flex h-12 -translate-x-1/2 items-center gap-1.5 rounded-xl bg-ink pr-1.5 pl-4 shadow-dialog"
  >
    <span class="flex h-6 items-center border-r border-white/20 pr-3.5 text-[0.8125rem] leading-[calc(18/13)] font-medium whitespace-nowrap text-white" aria-live="polite">
      {selected.size} {selected.size === 1 ? "file" : "files"} selected{#if selected.size >= MAX_DOWNLOAD_FILES}<span class="font-normal text-on-ink-muted">, the most at once</span>{/if}
    </span>
    {#if mayEdit}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger disabled={bulkBusy} data-company-files-move class={`ml-1.5 ${barButton} bg-white/10 text-white hover:bg-white/15 data-[state=open]:bg-white/15`}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" class="text-on-ink-muted"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>
          Move to fiscal year
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="text-ink-faint"><path d="M6 9l6 6 6-6" /></svg>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content side="top" align="start" sideOffset={8} class="z-[100] max-h-72 w-[12.5rem] overflow-y-auto rounded-lg border border-line bg-surface p-1 shadow-menu outline-none">
            {#each fiscalYearOptions() as year (year)}
              <DropdownMenu.Item onSelect={() => void moveSelected(year)} data-company-files-move-year={year} class={menuItem}>FY {year}</DropdownMenu.Item>
            {/each}
            <DropdownMenu.Separator class="-mx-1 my-1 h-px bg-line-soft" />
            <DropdownMenu.Item onSelect={() => void moveSelected(null)} data-company-files-move-year="none" class={menuItem}>No fiscal year</DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    {/if}
    {#if canManage}
      <button
        type="button"
        onclick={() => void archiveSelected()}
        disabled={bulkBusy || selectedFiles.every((file) => file.archived)}
        data-company-files-archive
        class={`${mayEdit ? "" : "ml-1.5"} ${barButton} bg-white/10 text-white hover:bg-white/15`}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" class="text-on-ink-muted"><rect x="3" y="4" width="18" height="4" rx="1" /><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4" /></svg>
        Archive
      </button>
      <button
        type="button"
        onclick={() => {
          deleting = null;
          deletingMany = selectedFiles.map((file) => file._id);
          deleteOpen = true;
        }}
        disabled={bulkBusy}
        data-company-files-delete
        class={`${barButton} bg-danger/15 text-danger-border hover:bg-danger/25`}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="text-danger-line"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>
        Delete
      </button>
    {/if}
    <button
      type="button"
      onclick={() => void download(selectedFiles)}
      disabled={downloading}
      data-company-files-download
      class="{mayEdit || canManage ? '' : 'ml-1.5'} inline-flex h-8 items-center gap-1.5 rounded-[0.4375rem] bg-primary-selected px-3 text-[0.8125rem] leading-[calc(18/13)] font-medium text-white transition-colors hover:bg-primary-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-light disabled:opacity-60 motion-reduce:transition-none pointer-coarse:h-11"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></svg>
      {downloading ? "Downloading..." : "Download"}
    </button>
    <span class="ml-1.5 flex h-6 w-[2.375rem] shrink-0 items-center justify-center border-l border-white/20 pl-1">
      <button
        type="button"
        aria-label="Clear selection"
        onclick={clearSelection}
        data-company-files-clear
        class="flex size-7 items-center justify-center rounded-md text-on-ink-muted transition-colors hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-light motion-reduce:transition-none pointer-coarse:size-11"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
    </span>
  </div>
{/if}

{#if dragTypes !== null}
  <div class="pointer-events-none fixed inset-0 z-[95] flex items-end justify-center bg-primary-wash/20 pb-8" data-company-files-drop-overlay>
    {#if dragRowId}
      <div class="flex h-12 items-center gap-3 rounded-xl bg-ink pr-2 pl-4 shadow-dialog">
        <span class="text-[0.8125rem] leading-[calc(18/13)] font-medium text-white">Drop on a file to replace it</span>
        <span class="h-6 w-px bg-white/20" aria-hidden="true"></span>
        <span class="flex h-8 items-center gap-2 rounded-[0.4375rem] bg-white/10 px-3 text-[0.8125rem] leading-[calc(18/13)] text-white">
          Cancel <kbd class="rounded-sm bg-white/15 px-1.5 font-sans text-[0.625rem] leading-[1.6] text-on-ink-muted">Esc</kbd>
        </span>
      </div>
    {:else}
      <div class="flex h-12 items-center gap-2 rounded-xl bg-ink pr-4 pl-2 shadow-dialog">
        <span class="flex size-8 items-center justify-center rounded-[0.4375rem] bg-primary-selected text-white" aria-hidden="true">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></svg>
        </span>
        <span class="pr-1.5 pl-1 text-[0.8125rem] leading-[calc(18/13)] font-medium whitespace-nowrap text-white" data-company-files-drop-message>
          Drop to add {dragTypes.length || 1} {dragTypes.length === 1 ? "file" : "files"} to {companyName}
        </span>
        <span class="h-6 w-px bg-white/20" aria-hidden="true"></span>
        <span class="pl-1.5 text-[0.8125rem] leading-[calc(18/13)] whitespace-nowrap text-on-ink-muted">Up to 50 MB each</span>
      </div>
    {/if}
  </div>
{/if}

<AddFilesDialog
  bind:open={addOpen}
  uploads={shownUploads}
  onFiles={addFiles}
  onStop={stopUpload}
  onRetry={retryUpload}
  onDismiss={dismissUpload}
  onCancel={stopAllUploads}
/>

<ReplaceFileDialog
  bind:open={replaceOpen}
  target={replaceTarget}
  initialFile={replaceFile}
  prepare={prepareReplacement}
  commit={commitReplacement}
  onCloseAutoFocus={(event) => focusRow(replaceReturnId, event)}
/>

<FilePreview
  files={previewFiles}
  bind:open={previewOpen}
  bind:index={previewIndex}
  onCloseAutoFocus={(event) => focusRow(previewReturnId, event)}
/>

<AlertDialog.Root bind:open={deleteOpen}>
  <AlertDialog.Portal>
    <AlertDialog.Overlay class="fixed inset-0 z-[130] bg-dialog-scrim" />
    <AlertDialog.Content
      data-company-file-delete-dialog
      class="fixed top-1/2 left-1/2 z-[130] w-[calc(100%-2rem)] max-w-[20rem] -translate-x-1/2 -translate-y-1/2 rounded-xl bg-surface shadow-dialog"
    >
      <div class="flex flex-col gap-2 px-4 pt-4">
        {#if deletingMany}
          <AlertDialog.Title class="text-sm leading-[calc(10/7)] font-medium text-ink">Delete {filesWord(deletingMany.length)}?</AlertDialog.Title>
          <AlertDialog.Description class="text-[0.8125rem] leading-[calc(18/13)] text-ink-secondary">
            {deletingMany.length === 1 ? "It's" : "They're"} removed for good. Drafts already written keep what they used.
          </AlertDialog.Description>
        {:else}
          <AlertDialog.Title class="text-sm leading-[calc(10/7)] font-medium break-words text-ink">Delete {deleting?.fileName}?</AlertDialog.Title>
          <AlertDialog.Description class="text-[0.8125rem] leading-[calc(18/13)] text-ink-secondary">
            It's removed for good. Drafts already written keep what they used.
          </AlertDialog.Description>
        {/if}
      </div>
      <div class="flex items-center justify-end gap-2 px-4 pt-4 pb-4">
        <AlertDialog.Cancel
          class="h-8 rounded-md bg-surface px-3 text-[0.8125rem] leading-[calc(18/13)] text-ink shadow-[inset_0_0_0_1px_var(--color-line)] transition-colors hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy pointer-coarse:h-11"
        >Cancel</AlertDialog.Cancel>
        <AlertDialog.Action
          data-confirm-company-file-delete
          onclick={() => {
            deleteOpen = false;
            if (deletingMany) void removeSelected(deletingMany);
            else if (deleting) void remove(deleting);
          }}
          class="h-8 rounded-md bg-danger-action px-3 text-[0.8125rem] leading-[calc(18/13)] font-medium text-white transition-colors hover:bg-danger-action-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger pointer-coarse:h-11"
        >Delete</AlertDialog.Action>
      </div>
    </AlertDialog.Content>
  </AlertDialog.Portal>
</AlertDialog.Root>
