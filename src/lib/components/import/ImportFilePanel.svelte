<!--
  The file preview panel (Paper Files 7 and Files 8): a 1000px split-pane view
  opened from any file's name or row menu.
  - Header: PD number muted + title, "{Company} - {Category}" subtitle,
    "{i} of {N}" with < > prev/next navigation, and close button.
  - Left document pane (bg-gray-50): "What AI read" | "Original" segmented
    switch, short caption, right-aligned Download link, and a Ledger Paper
    document sheet showing extracted text (paged 20k chars at a time via
    sheetFileText) or the rendered original file (.docx via Mammoth, .pdf
    iframe, .xlsx/.csv tables, or image).
  - Right Labels & Details pane (360px): editable pickers on To review
    (Company, Category, Fiscal year end, Version, Writer, Reviewer, Science
    code with an amber highlight strip when missing, PD number, CRA reviewed),
    initials slot editing, Approved details on Approved, and provenance below a
    hairline (Added, Folder, Size).
  - Footer: Delete + helper note on left, primary Approve and next on right
    (or Put back on Deleted).
-->
<script lang="ts">
  import { Dialog } from "bits-ui";
  import type { FunctionArgs } from "convex/server";
  import { untrack } from "svelte";
  import { useAction, useMutation, useQuery } from "convex-svelte";
  import { toast } from "svelte-sonner";
  import {
    CaretDownIcon,
    CaretLeftIcon,
    CaretRightIcon,
    CheckIcon,
    DownloadSimpleIcon,
    FileTextIcon,
    SealCheckIcon,
  } from "phosphor-svelte";
  import { resolve } from "$app/paths";
  import { api } from "../../../../convex/_generated/api";
  import type { Id } from "../../../../convex/_generated/dataModel";
  import { IconClose } from "$lib/components/icons";
  import AuroraMark from "$lib/components/ui/AuroraMark.svelte";
  import DatePicker from "$lib/components/ui/DatePicker.svelte";
  import ScienceCodeList from "$lib/components/project/details/ScienceCodeList.svelte";
  import { companiesPath } from "$lib/companies/companies";
  import { userErrorMessage } from "$lib/errors";
  import { approveRefusalFor, categoryTakes } from "../../../../shared/importSheetRules";
  import { matchClientInitials } from "../../../../shared/pdSectionC";
  import { BRAIN_STATE_TEXT, NOT_ON_COMPANY_PAGE } from "./importApprove";
  import { CRA_REVIEWED } from "./importApproved";
  import { deleteFiles, IMPORT_TOAST, matchWriter, moveUndo, putBackFiles } from "./importActions";
  import ImportApprovedDetails from "./ImportApprovedDetails.svelte";
  import ImportCompanyList from "./ImportCompanyList.svelte";
  import ImportInitialsSlots from "./ImportInitialsSlots.svelte";
  import ImportPdNumberList from "./ImportPdNumberList.svelte";
  import ImportPickerPopover from "./ImportPickerPopover.svelte";
  import ImportVersionPicker from "./ImportVersionPicker.svelte";
  import ImportWriterList, { type PickedWriter } from "./ImportWriterList.svelte";
  import {
    CHOOSE_REVIEWER,
    CHOOSE_WRITER,
    dateInputFromUtcDay,
    MOVE_CATEGORIES,
    moveBackGroups,
    movedText,
    rowAbilities,
    skippedText,
    utcDayFromDateInput,
    yearEndCalendarStart,
    YEAR_END_HELPER,
    YEAR_END_QUICK_PICKS,
    type BatchResult,
    type MovePatch,
  } from "./importEdit";
  import { CATEGORY_NAMES, checkLines, fileStateText, FILE_VIEW_MAX_CHARS, textNote } from "./importFileView";
  import { fileCells, isBeingRead, yearEndDate, type SheetFileRow, type SheetTab } from "./importFormat";
  import {
    detectFileKind,
    fileTypeLabel,
    formatFileSize,
    originalCaption,
    renderDocxPreview,
    renderSpreadsheetPreview,
    type SpreadsheetSheetPreview,
  } from "./originalPreview";
  import { AMBER, CHOICE_ROW, PICK_CARET_SIZE, PICK_CONTROL, SHEET_SMALL, SHOW_MORE } from "./sheetLayout";

  type LabelPatch = FunctionArgs<typeof api.ingestion.setSheetLabels>["patch"];

  let {
    id = null,
    fileIds = [],
    onSelectFile,
    onRemoved,
    onClose,
  }: {
    /** The file shown; null closes the panel. */
    id?: SheetFileRow["_id"] | null;
    /** Ordered sibling file IDs from the sheet for prev/next navigation. */
    fileIds?: readonly SheetFileRow["_id"][];
    /** Navigates to another file in the current sheet list. */
    onSelectFile?: (id: SheetFileRow["_id"]) => void;
    /** Called after approving, deleting, or putting back the current file. */
    onRemoved?: (id: SheetFileRow["_id"]) => void;
    onClose: () => void;
  } = $props();

  const fileQ = useQuery(api.ingestion.sheetFile, () => (id ? { id } : "skip"));
  const file = $derived(id && fileQ.data ? fileQ.data : null);
  const cells = $derived(file ? fileCells(file) : null);
  const readText = useAction(api.ingestion.sheetFileText);

  const setLabels = useMutation(api.ingestion.setSheetLabels);
  const removeItems = useMutation(api.ingestion.removeItems);
  const restoreItems = useMutation(api.ingestion.restoreItems);
  const matchInitials = useMutation(api.ingestion.matchWriterInitials);
  const confirmName = useMutation(api.ingestion.confirmWriterName);
  const setReviewers = useMutation(api.ingestion.setFileReviewers);
  const setCraReviewed = useMutation(api.ingestion.setCraReviewed);
  const approveFiles = useMutation(api.ingestion.approveFiles);

  // ─── Prev / Next file navigation ────────────────────────────────────────
  const currentIndex = $derived(id ? fileIds.indexOf(id) : -1);
  const showPager = $derived(fileIds.length > 1 && currentIndex >= 0 && Boolean(onSelectFile));
  const hasPrev = $derived(showPager && currentIndex > 0);
  const hasNext = $derived(showPager && currentIndex < fileIds.length - 1);

  function goPrev() {
    if (!hasPrev || !onSelectFile) return;
    onSelectFile(fileIds[currentIndex - 1]);
  }

  function goNext() {
    if (!hasNext || !onSelectFile) return;
    onSelectFile(fileIds[currentIndex + 1]);
  }

  // ─── Document view mode (What AI read | Original) ───────────────────────
  let viewMode = $state<"ai" | "original">("ai");

  type LoadedText = { text: string; total: number; source: "full" | "preview" | "none"; cutAtImport: boolean };
  let loaded = $state<LoadedText | null>(null);
  let loading = $state(false);
  let textError = $state<string | null>(null);

  type OriginalState =
    | { status: "idle" }
    | { status: "loading" }
    | { status: "ready"; kind: "docx"; html: string }
    | { status: "ready"; kind: "spreadsheet"; sheets: SpreadsheetSheetPreview[] }
    | { status: "ready"; kind: "text"; text: string }
    | { status: "error"; message: string };
  let original = $state<OriginalState>({ status: "idle" });

  // Each open of the panel, or of another file, is a new generation so
  // in-flight fetches from an earlier file or earlier open are ignored.
  let generation = 0;
  let originalGeneration = 0;

  async function loadFrom(target: SheetFileRow["_id"], start: number) {
    const asked = generation;
    const current = () => asked === generation && target === id;
    loading = true;
    textError = null;
    try {
      const page = await readText({ id: target, start });
      if (!current()) return;
      if (!page) {
        loaded = { text: "", total: 0, source: "none", cutAtImport: false };
        return;
      }
      if (start > 0 && start !== loaded?.text.length) return;
      const before = start === 0 ? "" : (loaded?.text ?? "");
      loaded = { text: before + page.text, total: page.total, source: page.source, cutAtImport: page.cutAtImport };
    } catch (error) {
      if (current()) textError = userErrorMessage(error, "The text could not be loaded.");
    } finally {
      if (current()) loading = false;
    }
  }

  // A new file, or the same file opened again, starts its text from the top.
  $effect(() => {
    const target = id;
    untrack(() => {
      generation += 1;
      originalGeneration += 1;
      viewMode = "ai";
      loaded = null;
      loading = false;
      textError = null;
      original = { status: "idle" };
      if (target) void loadFrom(target, 0);
    });
  });

  const fileKind = $derived(file ? detectFileKind(file.name) : "other");

  async function loadOriginal(targetId: SheetFileRow["_id"], url: string, kind: ReturnType<typeof detectFileKind>) {
    const asked = ++originalGeneration;
    const current = () => asked === originalGeneration && targetId === id;
    original = { status: "loading" };
    try {
      const response = await globalThis.fetch(url);
      if (!response.ok) throw new Error("The original file could not be loaded.");
      if (!current()) return;
      if (kind === "docx") {
        const buffer = await response.arrayBuffer();
        const html = await renderDocxPreview(buffer);
        if (current()) original = { status: "ready", kind: "docx", html };
      } else if (kind === "spreadsheet") {
        const buffer = await response.arrayBuffer();
        const sheets = await renderSpreadsheetPreview(buffer);
        if (current()) original = { status: "ready", kind: "spreadsheet", sheets };
      } else if (kind === "text") {
        const text = await response.text();
        if (current()) original = { status: "ready", kind: "text", text };
      }
    } catch (error) {
      if (current()) original = { status: "error", message: userErrorMessage(error, "The original file could not be previewed.") };
    }
  }

  $effect(() => {
    if (viewMode !== "original" || !file || !file.originalUrl) return;
    if (fileKind !== "docx" && fileKind !== "spreadsheet" && fileKind !== "text") return;
    if (untrack(() => original.status !== "idle")) return;
    const targetId = file._id;
    const url = file.originalUrl;
    const kind = fileKind;
    untrack(() => void loadOriginal(targetId, url, kind));
  });

  // ─── Derived state & abilities ──────────────────────────────────────────
  const shown = $derived(loaded?.text.length ?? 0);
  const canShowMore = $derived(Boolean(loaded && shown < loaded.total && shown < FILE_VIEW_MAX_CHARS));
  const note = $derived(loaded ? textNote({ shown, total: loaded.total, source: loaded.source, cutAtImport: loaded.cutAtImport }) : null);
  const sheetTab = $derived<SheetTab>(file?.sheetTab ?? (file?.status === "approved" ? "approved" : file?.status === "pending_review" ? "review" : "deleted"));
  const can = $derived(file ? rowAbilities(file, sheetTab) : null);
  const approved = $derived(file?.status === "approved");
  const isReview = $derived(file?.sheetTab === "review");
  const isDeleted = $derived(file?.sheetTab === "deleted");
  const checks = $derived(file && isReview ? checkLines(file.checkReasons) : []);
  const canEditInitials = $derived(
    Boolean(file && isReview && !isBeingRead(file.status) && categoryTakes("writerName", file.category))
  );
  const canApprove = $derived(Boolean(file && isReview && approveRefusalFor(file) === null));
  const subtitle = $derived.by(() => {
    if (!file) return "Loading the file";
    const company = file.clientName?.trim();
    const category = CATEGORY_NAMES[file.category];
    return company ? `${company} - ${category}` : category;
  });

  // ─── Inline label editing (To review) ───────────────────────────────────
  let acting = $state(false);
  const followsInitials = $derived(
    Boolean(file && file.writerNameSource !== "person" && !(file.editedLabels ?? []).includes("writerName"))
  );

  async function oneFile(call: () => Promise<BatchResult>, fallback: string): Promise<boolean> {
    if (!file) return false;
    try {
      const result = await call();
      if (result.skipped.length > 0) {
        toast.error("The change was not saved.", { ...IMPORT_TOAST, description: skippedText(result.skipped, sheetTab) });
      }
      return result.changedIds.includes(file._id);
    } catch (error) {
      toast.error(userErrorMessage(error, fallback), IMPORT_TOAST);
      return false;
    }
  }

  async function change(patch: LabelPatch): Promise<boolean> {
    if (!file) return false;
    return oneFile(() => setLabels({ ids: [file._id], patch }), "The change could not be saved.");
  }

  async function move(patch: MovePatch): Promise<boolean> {
    if (!file) return false;
    const back =
      "category" in patch
        ? moveBackGroups("category", [{ _id: file._id, before: file.category }])
        : moveBackGroups("company", [{ _id: file._id, before: file.clientName ?? null }]);
    const moved = await change(patch);
    if (moved) toast(movedText(patch), { ...IMPORT_TOAST, ...moveUndo(back, setLabels, sheetTab) });
    return moved;
  }

  function pickYear(value: string) {
    if (!file) return;
    const end = utcDayFromDateInput(value);
    if (end === null) return;
    if (end === file.fiscalYearEnd && !file.fiscalYearEndAssumed) return;
    void change({ fiscalYearEnd: end });
  }

  async function confirmWriter(writerId: Id<"pdWriters">) {
    try {
      await confirmName({ writerId });
    } catch (error) {
      toast.error(userErrorMessage(error, "The writer could not be saved."), IMPORT_TOAST);
    }
  }

  function pickWriter(picked: PickedWriter) {
    if (!file || !cells) return;
    if (picked.current) {
      if (picked.nameFromDocument && picked.choice.kind === "writer") void confirmWriter(picked.choice.writerId);
      return;
    }
    const initials = followsInitials ? (cells.writer?.initials ?? null) : null;
    if (initials) void matchWriter(initials, picked, matchInitials);
    else void change({ writer: picked.choice });
  }

  function pickReviewer(picked: PickedWriter) {
    if (!file || !cells || picked.current) return;
    const initials = file.reviewerSource !== "person" ? (cells.reviewer?.initials ?? null) : null;
    if (initials) void matchWriter(initials, picked, matchInitials, "reviewer");
    else void oneFile(() => setReviewers({ ids: [file._id], reviewer: picked.choice }), "The reviewer could not be saved.");
  }

  function toggleCra() {
    if (!file || !cells) return;
    const next = !cells.craReviewed;
    void oneFile(() => setCraReviewed({ ids: [file._id], reviewed: next }), "The change could not be saved.").then((done) => {
      if (done) toast(next ? "Marked as reviewed by CRA" : `Cleared "${CRA_REVIEWED}"`, IMPORT_TOAST);
    });
  }

  // ─── Footer actions (Delete / Put back / Approve and next) ──────────────
  async function handleDelete() {
    if (!file || acting) return;
    acting = true;
    const targetId = file._id;
    try {
      const result = await deleteFiles([targetId], removeItems, restoreItems, { tab: sheetTab });
      if (result.changedIds.includes(targetId)) {
        if (onRemoved) onRemoved(targetId);
        else onClose();
      }
    } finally {
      acting = false;
    }
  }

  async function handlePutBack() {
    if (!file || acting) return;
    acting = true;
    const targetId = file._id;
    try {
      const result = await putBackFiles([targetId], restoreItems, { tab: "deleted" });
      if (result.changedIds.includes(targetId)) {
        if (onRemoved) onRemoved(targetId);
        else onClose();
      }
    } finally {
      acting = false;
    }
  }

  async function handleApprove() {
    if (!file || !canApprove || acting) return;
    acting = true;
    const targetId = file._id;
    try {
      await approveFiles({ ids: [targetId] });
      if (onRemoved) onRemoved(targetId);
      else onClose();
    } catch (error) {
      toast.error(userErrorMessage(error, "The file could not be approved."), IMPORT_TOAST);
    } finally {
      acting = false;
    }
  }

  // ─── Supplementary read-only labels ─────────────────────────────────────
  const clientInitialsFormatted = $derived.by(() => {
    if (!file) return null;
    const allCodes = [file.clientInitials, ...(file.extraClientInitials ?? [])].filter(
      (code): code is string => Boolean(code)
    );
    if (allCodes.length === 0) return null;
    return allCodes
      .map((code) => {
        const hit = matchClientInitials(file.documentClientNames, code, { companyName: file.clientName });
        return hit ? `${code} - ${hit.name}` : code;
      })
      .join(", ");
  });

  const addedText = $derived.by(() => {
    if (!file) return "";
    const date = new Date(file.addedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    return file.addedVia === "folder_upload" ? `With the uploader, ${date}` : `By OneDrive sync, ${date}`;
  });

  const sizeAndType = $derived.by(() => {
    if (!file) return "";
    const size = formatFileSize(file.size);
    const kind = fileTypeLabel(file.name);
    return size ? `${size}, ${kind}` : kind;
  });

  const PANEL_PICKER =
    "group/pick -mx-2 inline-flex min-h-7 max-w-full min-w-0 items-center gap-1 rounded-md px-2 text-left text-[0.8125rem] leading-[calc(18/13)] text-ink transition-colors duration-150 ease-out hover:bg-primary-wash focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir data-[state=open]:bg-primary-wash motion-reduce:transition-none pointer-coarse:min-h-11";
</script>

<Dialog.Root
  open={id !== null}
  onOpenChange={(open) => {
    if (!open) onClose();
  }}
>
  <Dialog.Portal>
    <Dialog.Overlay
      class="fixed inset-0 z-[105] bg-form-dialog-scrim transition-opacity duration-200 ease-out motion-reduce:transition-none"
      data-import-file-panel-scrim
    />
    <Dialog.Content
      data-import-file-panel
      class="fixed inset-y-0 right-0 z-[106] flex w-full max-w-[62.5rem] flex-col border-l border-line bg-surface shadow-dialog outline-none"
    >
      <!-- Header: PD number + title, "{Company} - {Category}" subtitle, {i} of {N} < >, Close -->
      <header class="flex shrink-0 items-center justify-between gap-4 border-b border-line-soft px-6 py-3.5">
        <div class="flex min-w-0 flex-1 flex-col gap-0.5">
          <Dialog.Title
            class="flex min-w-0 items-baseline gap-2.5 text-[1rem] leading-[1.35] font-medium text-ink"
            data-import-file-panel-title
          >
            {#if cells?.prefix}<span class="shrink-0 font-normal text-ink-muted">{cells.prefix}</span>{/if}
            <span class="min-w-0 truncate">{cells?.title ?? "File"}</span>
          </Dialog.Title>
          <Dialog.Description class={`${SHEET_SMALL} truncate text-ink-muted`}>{subtitle}</Dialog.Description>
        </div>

        <div class="flex shrink-0 items-center gap-2">
          {#if showPager}
            <span data-import-file-panel-counter class={`${SHEET_SMALL} tabular-nums text-ink-muted`}>
              {currentIndex + 1} of {fileIds.length}
            </span>
            <div class="flex items-center gap-1">
              <button
                type="button"
                aria-label="Previous file"
                data-import-file-panel-prev
                disabled={!hasPrev}
                onclick={goPrev}
                class="flex size-7 items-center justify-center rounded-md border border-line bg-surface text-ink-secondary transition-colors duration-150 ease-out hover:bg-gray-50 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir disabled:opacity-40 disabled:hover:bg-surface motion-reduce:transition-none pointer-coarse:size-11"
              >
                <CaretLeftIcon size="0.8125rem" aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label="Next file"
                data-import-file-panel-next
                disabled={!hasNext}
                onclick={goNext}
                class="flex size-7 items-center justify-center rounded-md border border-line bg-surface text-ink-secondary transition-colors duration-150 ease-out hover:bg-gray-50 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir disabled:opacity-40 disabled:hover:bg-surface motion-reduce:transition-none pointer-coarse:size-11"
              >
                <CaretRightIcon size="0.8125rem" aria-hidden="true" />
              </button>
            </div>
            <span class="mx-1 h-4 w-px bg-line-soft" aria-hidden="true"></span>
          {/if}

          <Dialog.Close
            aria-label="Close the file"
            data-import-file-panel-close
            class="-mr-1 flex size-8 shrink-0 items-center justify-center rounded-md text-ink-muted transition-colors duration-150 ease-out hover:bg-primary-wash hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir motion-reduce:transition-none pointer-coarse:size-11"
          >
            <IconClose size={14} strokeWidth={1.8} />
          </Dialog.Close>
        </div>
      </header>

      <!-- Main split-pane body -->
      <div class="flex min-h-0 flex-1 flex-col md:flex-row" data-import-file-panel-body>
        {#if id && fileQ.data === null}
          <div class="flex flex-1 items-start p-6">
            <p class="text-[0.8125rem] leading-[calc(18/13)] text-ink-secondary">This file is no longer in Import.</p>
          </div>
        {:else if file && cells && can}
          <!-- Left document pane -->
          <section class="flex min-h-0 min-w-0 flex-1 flex-col bg-gray-50" aria-label="Document preview">
            <div class="flex shrink-0 flex-wrap items-center justify-between gap-3 px-6 py-3">
              <div class="flex min-w-0 items-center gap-3">
                <div
                  role="tablist"
                  aria-label="Document view"
                  class="inline-flex items-center rounded-lg border border-line bg-surface p-0.5"
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={viewMode === "ai"}
                    data-import-file-panel-view="ai"
                    onclick={() => (viewMode = "ai")}
                    class={`rounded-md px-2.5 py-1 text-xs leading-[calc(4/3)] transition-colors duration-150 ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir motion-reduce:transition-none pointer-coarse:min-h-11 ${
                      viewMode === "ai"
                        ? "bg-primary font-medium text-on-primary"
                        : "text-ink-secondary hover:text-ink"
                    }`}
                  >What AI read</button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={viewMode === "original"}
                    data-import-file-panel-view="original"
                    onclick={() => (viewMode = "original")}
                    class={`rounded-md px-2.5 py-1 text-xs leading-[calc(4/3)] transition-colors duration-150 ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir motion-reduce:transition-none pointer-coarse:min-h-11 ${
                      viewMode === "original"
                        ? "bg-primary font-medium text-on-primary"
                        : "text-ink-secondary hover:text-ink"
                    }`}
                  >Original</button>
                </div>
                <span data-import-file-panel-caption class={`hidden truncate ${SHEET_SMALL} text-ink-muted sm:inline`}>
                  {viewMode === "ai" ? "What AI read from the file" : originalCaption(file.name)}
                </span>
              </div>

              {#if file.originalUrl}
                <a
                  href={file.originalUrl}
                  download={file.name}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-import-file-panel-download
                  class="inline-flex items-center gap-1 rounded-sm text-xs leading-[calc(4/3)] font-medium text-primary-selected transition-colors duration-150 ease-out hover:text-primary-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir motion-reduce:transition-none"
                >
                  <DownloadSimpleIcon size="0.8125rem" aria-hidden="true" />
                  <span>Download</span>
                </a>
              {/if}
            </div>

            <div class="min-h-0 flex-1 overflow-y-auto px-6 pb-8">
              {#if viewMode === "ai"}
                <div class="mx-auto w-full max-w-[38rem] rounded-xl border border-line-soft bg-surface px-7 py-6 shadow-xs">
                  {#if textError}
                    <p role="alert" class="text-[0.8125rem] leading-[calc(18/13)] text-ink-secondary">{textError}</p>
                  {:else if !loaded}
                    <div role="status" aria-label="Loading the text" class="flex flex-col gap-2.5">
                      {#each [0, 1, 2, 3, 4] as index (index)}
                        <span class={`h-3 animate-pulse rounded-sm bg-gray-50 motion-reduce:animate-none ${index === 4 ? "w-2/3" : "w-full"}`}></span>
                      {/each}
                    </div>
                  {:else if loaded.source === "none" || loaded.total === 0}
                    <p data-import-file-panel-no-text class="text-[0.8125rem] leading-[calc(18/13)] text-ink-secondary">
                      No text could be read from this file.
                    </p>
                  {:else}
                    <div
                      data-import-file-panel-text
                      class="text-[0.8125rem] leading-[1.6] whitespace-pre-wrap break-words text-ink-secondary"
                    >{loaded.text}</div>
                    {#if note}
                      <p data-import-file-panel-text-note class={`mt-4 border-t border-line-soft pt-3 ${SHEET_SMALL} text-ink-muted`}>{note}</p>
                    {/if}
                    {#if canShowMore && id}
                      <button
                        type="button"
                        data-import-file-panel-more
                        disabled={loading}
                        onclick={() => id && void loadFrom(id, shown)}
                        class={`mt-2 ${SHOW_MORE}`}
                      >{loading ? "Loading..." : "Show more"}</button>
                    {/if}
                  {/if}
                </div>
              {:else if !file.originalUrl}
                <div class="mx-auto flex w-full max-w-[38rem] flex-col items-start gap-2 rounded-xl border border-line-soft bg-surface px-7 py-6 shadow-xs">
                  <p data-import-file-panel-no-original class="text-[0.8125rem] leading-[calc(18/13)] text-ink-secondary">
                    The original file is not stored here.
                  </p>
                </div>
              {:else if fileKind === "pdf"}
                <iframe
                  src={file.originalUrl}
                  title={file.name}
                  data-import-file-panel-original-pdf
                  class="h-[44rem] w-full rounded-xl border border-line-soft bg-surface shadow-xs"
                ></iframe>
              {:else if fileKind === "image"}
                <div class="mx-auto flex w-full max-w-[38rem] justify-center rounded-xl border border-line-soft bg-surface p-5 shadow-xs">
                  <img
                    src={file.originalUrl}
                    alt={file.name}
                    data-import-file-panel-original-image
                    class="max-h-[42rem] max-w-full rounded-md object-contain"
                  />
                </div>
              {:else if fileKind === "docx" || fileKind === "spreadsheet" || fileKind === "text"}
                <div class="mx-auto w-full max-w-[38rem] rounded-xl border border-line-soft bg-surface px-7 py-6 shadow-xs">
                  {#if original.status === "loading" || original.status === "idle"}
                    <div role="status" aria-label="Loading the original file" class="flex flex-col gap-2.5">
                      {#each [0, 1, 2, 3, 4] as index (index)}
                        <span class={`h-3 animate-pulse rounded-sm bg-gray-50 motion-reduce:animate-none ${index === 4 ? "w-1/2" : "w-full"}`}></span>
                      {/each}
                    </div>
                  {:else if original.status === "error"}
                    <div class="flex flex-col items-start gap-3">
                      <p role="alert" class="text-[0.8125rem] leading-[calc(18/13)] text-ink-secondary">{original.message}</p>
                      <a
                        href={file.originalUrl}
                        download={file.name}
                        target="_blank"
                        rel="noopener noreferrer"
                        class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-xs leading-[calc(4/3)] font-medium text-ink transition-colors duration-150 ease-out hover:bg-gray-50 motion-reduce:transition-none"
                      >
                        <DownloadSimpleIcon size="0.875rem" aria-hidden="true" />
                        <span>Download original</span>
                      </a>
                    </div>
                  {:else if original.kind === "docx"}
                    <!-- Safe: HTML is sanitized by sanitizeDocumentHtml in originalPreview.ts -->
                    <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                    <div data-import-file-panel-original-docx class="docx-preview">{@html original.html}</div>
                  {:else if original.kind === "spreadsheet"}
                    <div data-import-file-panel-original-sheet class="flex flex-col gap-5">
                      {#each original.sheets as sheet (sheet.name)}
                        <div class="flex flex-col gap-2">
                          <h4 class={`${SHEET_SMALL} font-medium text-ink-muted`}>{sheet.name}</h4>
                          <div class="overflow-x-auto rounded-lg border border-line-soft">
                            <table class="w-full border-collapse text-left text-xs leading-[1.4]">
                              <tbody>
                                {#each sheet.rows as row, rowIndex (rowIndex)}
                                  <tr class={rowIndex === 0 ? "bg-gray-50 font-medium text-ink" : "border-t border-line-soft text-ink-secondary"}>
                                    {#each row as cell, colIndex (colIndex)}
                                      <td class="border-r border-line-soft px-2.5 py-1.5 whitespace-nowrap last:border-r-0">{cell}</td>
                                    {/each}
                                  </tr>
                                {/each}
                              </tbody>
                            </table>
                          </div>
                          {#if sheet.truncatedRows || sheet.truncatedCols}
                            <p class={`${SHEET_SMALL} text-ink-muted`}>Showing the start of this sheet. Download to see all rows.</p>
                          {/if}
                        </div>
                      {/each}
                    </div>
                  {:else}
                    <pre
                      data-import-file-panel-original-text
                      class="text-[0.8125rem] leading-[1.6] whitespace-pre-wrap break-words text-ink-secondary"
                    >{original.text}</pre>
                  {/if}
                </div>
              {:else}
                <div class="mx-auto flex w-full max-w-[38rem] flex-col items-start gap-3 rounded-xl border border-line-soft bg-surface px-7 py-6 shadow-xs">
                  <div class="flex items-center gap-2 text-ink-secondary">
                    <FileTextIcon size="1rem" aria-hidden="true" />
                    <span class="text-[0.8125rem] leading-[calc(18/13)]">
                      Browser preview is not available for {fileTypeLabel(file.name).toLowerCase()}s.
                    </span>
                  </div>
                  <a
                    href={file.originalUrl}
                    download={file.name}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-xs leading-[calc(4/3)] font-medium text-ink transition-colors duration-150 ease-out hover:bg-gray-50 motion-reduce:transition-none"
                  >
                    <DownloadSimpleIcon size="0.875rem" aria-hidden="true" />
                    <span>Download {file.name}</span>
                  </a>
                </div>
              {/if}
            </div>
          </section>

          <!-- Right Labels & Details pane -->
          <aside
            class="flex w-full shrink-0 flex-col overflow-y-auto border-t border-line-soft bg-surface px-5 py-4 md:w-[22.5rem] md:border-t-0 md:border-l"
            aria-label="File labels and details"
          >
            <div class="mb-3 flex items-center justify-between gap-2">
              <span class={`${SHEET_SMALL} text-ink-muted`}>Labels</span>
              <span class={`inline-flex items-center gap-1.5 ${SHEET_SMALL} text-ink-muted`}>
                <AuroraMark size={13} />
                <span>Filled in by AI</span>
              </span>
            </div>

            {#if checks.length > 0}
              <ul
                data-import-file-panel-checks
                class={`mb-3 flex flex-col gap-1 rounded-lg bg-warning-surface px-3 py-2 text-xs leading-[calc(4/3)] ${AMBER}`}
              >
                {#each checks as line (line)}<li>{line}</li>{/each}
              </ul>
            {/if}

            <dl data-import-file-panel-labels class="flex flex-col gap-2">
              <!-- Company -->
              <div class="grid grid-cols-[6.75rem_minmax(0,1fr)] items-center gap-x-3">
                <dt class={`${SHEET_SMALL} text-ink-muted`}>Company</dt>
                <dd class="min-w-0 text-[0.8125rem] leading-[calc(18/13)] text-ink" data-import-file-panel-label="Company">
                  {#if can.menu}
                    <ImportPickerPopover label="Company" align="end">
                      {#snippet trigger({ props })}
                        <button {...props} type="button" data-import-panel-company-edit class={PANEL_PICKER}>
                          <span class="truncate">{file.clientName?.trim() || "No company yet"}</span>
                          <CaretDownIcon size={PICK_CARET_SIZE} aria-hidden="true" class="shrink-0 text-ink-muted" />
                        </button>
                      {/snippet}
                      {#snippet content({ close })}
                        <ImportCompanyList
                          current={file.clientName ?? null}
                          onPick={(name) => {
                            close();
                            void move({ company: name });
                          }}
                        />
                      {/snippet}
                    </ImportPickerPopover>
                  {:else}
                    <span class="break-words text-ink-secondary">{file.clientName?.trim() || "No company yet"}</span>
                  {/if}
                </dd>
              </div>

              <!-- Category (keeps data-import-file-panel-label="Kind" for compatibility) -->
              <div class="grid grid-cols-[6.75rem_minmax(0,1fr)] items-center gap-x-3">
                <dt class={`${SHEET_SMALL} text-ink-muted`}>Category</dt>
                <dd class="min-w-0 text-[0.8125rem] leading-[calc(18/13)] text-ink" data-import-file-panel-label="Kind">
                  {#if can.menu}
                    <ImportPickerPopover label="Category" align="end" width="w-[14rem]">
                      {#snippet trigger({ props })}
                        <button {...props} type="button" data-import-panel-category-edit class={PANEL_PICKER}>
                          <span class="truncate">{CATEGORY_NAMES[file.category]}</span>
                          <CaretDownIcon size={PICK_CARET_SIZE} aria-hidden="true" class="shrink-0 text-ink-muted" />
                        </button>
                      {/snippet}
                      {#snippet content({ close })}
                        <div class="flex flex-col gap-0.5 p-1">
                          {#each MOVE_CATEGORIES as option (option.category)}
                            <button
                              type="button"
                              aria-pressed={option.category === file.category}
                              onclick={() => {
                                close();
                                if (option.category !== file.category) void move({ category: option.category });
                              }}
                              class={CHOICE_ROW}
                            >
                              <span class="min-w-0 flex-1 truncate">{option.label}</span>
                              {#if option.category === file.category}
                                <CheckIcon size="0.8125rem" aria-hidden="true" class="shrink-0 text-primary-selected" />
                              {/if}
                            </button>
                          {/each}
                        </div>
                      {/snippet}
                    </ImportPickerPopover>
                  {:else}
                    <span class="text-ink-secondary">{CATEGORY_NAMES[file.category]}</span>
                  {/if}
                </dd>
              </div>

              <!-- Fiscal year end -->
              {#if can.edit || file.fiscalYearEnd !== undefined}
                <div class="grid grid-cols-[6.75rem_minmax(0,1fr)] items-start gap-x-3">
                  <dt class={`${SHEET_SMALL} pt-1 text-ink-muted`}>Fiscal year end</dt>
                  <dd class="min-w-0 text-[0.8125rem] leading-[calc(18/13)] text-ink" data-import-file-panel-label="Fiscal year">
                    {#if can.edit}
                      <DatePicker
                        bind:value={() => dateInputFromUtcDay(file.fiscalYearEnd), () => {}}
                        openOn={yearEndCalendarStart([file.fiscalYearEnd])}
                        heading="Year end"
                        quickPicks={YEAR_END_QUICK_PICKS}
                        helper={YEAR_END_HELPER}
                        onCommit={pickYear}
                      >
                        {#snippet trigger({ props })}
                          <button {...props} type="button" data-import-panel-year-edit class={PANEL_PICKER}>
                            <span class="truncate">{file.fiscalYearEnd !== undefined ? yearEndDate(file.fiscalYearEnd) : "Set year end"}</span>
                            <CaretDownIcon size={PICK_CARET_SIZE} aria-hidden="true" class="shrink-0 text-ink-muted" />
                          </button>
                        {/snippet}
                      </DatePicker>
                      {#if cells.fiscalYear}
                        <div class={`${SHEET_SMALL} text-ink-muted`}>Fiscal year {cells.fiscalYear.text}</div>
                      {/if}
                    {:else if file.fiscalYearEnd !== undefined}
                      <span class="text-ink-secondary">{yearEndDate(file.fiscalYearEnd)}</span>
                      {#if cells.fiscalYear}
                        <div class={`${SHEET_SMALL} text-ink-muted`}>Fiscal year {cells.fiscalYear.text}</div>
                      {/if}
                    {/if}
                  </dd>
                </div>
              {/if}

              <!-- Version -->
              {#if can.version || cells.version}
                <div class="grid grid-cols-[6.75rem_minmax(0,1fr)] items-center gap-x-3">
                  <dt class={`${SHEET_SMALL} text-ink-muted`}>Version</dt>
                  <dd class="min-w-0 text-[0.8125rem] leading-[calc(18/13)] text-ink" data-import-file-panel-label="Version">
                    {#if can.version}
                      <ImportVersionPicker code={file.versionCode} number={file.versionNumber} onPick={(version) => change({ version })}>
                        {#snippet trigger({ props })}
                          <button {...props} type="button" data-import-panel-version-edit class={PANEL_PICKER}>
                            <span class="truncate">{cells.version ?? "Set version"}</span>
                            <CaretDownIcon size={PICK_CARET_SIZE} aria-hidden="true" class="shrink-0 text-ink-muted" />
                          </button>
                        {/snippet}
                      </ImportVersionPicker>
                    {:else if cells.version}
                      <span class="text-ink-secondary">{cells.version}</span>
                    {/if}
                  </dd>
                </div>
              {/if}

              <!-- PD number -->
              {#if can.pdNumber || file.pdNumber}
                <div class="grid grid-cols-[6.75rem_minmax(0,1fr)] items-center gap-x-3">
                  <dt class={`${SHEET_SMALL} text-ink-muted`}>PD number</dt>
                  <dd class="min-w-0 text-[0.8125rem] leading-[calc(18/13)] text-ink" data-import-file-panel-label="PD number">
                    {#if can.pdNumber}
                      <ImportPickerPopover label="PD number" align="end">
                        {#snippet trigger({ props })}
                          <button {...props} type="button" data-import-panel-pd-number-edit class={PANEL_PICKER}>
                            <span class="truncate">{file.pdNumber ? `PD ${file.pdNumber}` : "Set PD number"}</span>
                            <CaretDownIcon size={PICK_CARET_SIZE} aria-hidden="true" class="shrink-0 text-ink-muted" />
                          </button>
                        {/snippet}
                        {#snippet content({ close })}
                          <ImportPdNumberList
                            current={file.pdNumber ?? null}
                            onPick={(pdNumber) => {
                              close();
                              void change({ pdNumber });
                            }}
                          />
                        {/snippet}
                      </ImportPickerPopover>
                    {:else if file.pdNumber}
                      <span class="text-ink-secondary">{file.pdNumber}</span>
                    {/if}
                  </dd>
                </div>
              {/if}

              <!-- Writer (omitted on Approved where ImportApprovedDetails edits it) -->
              {#if !approved && (can.writer || cells.writer)}
                {@const writerMissing = cells.writer?.tone === "amber"}
                <div
                  class={`grid grid-cols-[6.75rem_minmax(0,1fr)] items-center gap-x-3 ${
                    writerMissing && can.writer ? "-mx-5 border-l-2 border-warning-ink bg-warning-surface/70 px-5 py-2" : ""
                  }`}
                >
                  <dt class={`${SHEET_SMALL} text-ink-muted`}>Writer</dt>
                  <dd class="min-w-0 text-[0.8125rem] leading-[calc(18/13)] text-ink" data-import-file-panel-label="Writer">
                    {#if can.writer}
                      <ImportPickerPopover label="Writer" align="end">
                        {#snippet trigger({ props })}
                          {#if writerMissing}
                            <button {...props} type="button" data-import-panel-writer-edit class={PICK_CONTROL}>
                              <span class="truncate">{CHOOSE_WRITER}</span>
                              <CaretDownIcon size={PICK_CARET_SIZE} aria-hidden="true" class="shrink-0" />
                            </button>
                          {:else}
                            <button {...props} type="button" data-import-panel-writer-edit class={PANEL_PICKER}>
                              <span class="truncate">{cells.writer?.text ?? CHOOSE_WRITER}</span>
                              <CaretDownIcon size={PICK_CARET_SIZE} aria-hidden="true" class="shrink-0 text-ink-muted" />
                            </button>
                          {/if}
                        {/snippet}
                        {#snippet content({ close })}
                          <ImportWriterList
                            currentWriterId={file.writerId ?? null}
                            onPick={(picked) => {
                              close();
                              pickWriter(picked);
                            }}
                          />
                        {/snippet}
                      </ImportPickerPopover>
                    {:else if cells.writer}
                      <span class="text-ink-secondary">{writerMissing ? "No writer yet" : cells.writer.text}</span>
                    {/if}
                  </dd>
                </div>
              {/if}

              <!-- Reviewer (omitted on Approved where ImportApprovedDetails edits it) -->
              {#if !approved && (can.reviewer || file.reviewerName)}
                <div class="grid grid-cols-[6.75rem_minmax(0,1fr)] items-center gap-x-3">
                  <dt class={`${SHEET_SMALL} text-ink-muted`}>Reviewer</dt>
                  <dd class="min-w-0 text-[0.8125rem] leading-[calc(18/13)] text-ink" data-import-file-panel-label="Reviewer">
                    {#if can.reviewer}
                      <ImportPickerPopover label="Reviewer" align="end">
                        {#snippet trigger({ props })}
                          <button {...props} type="button" data-import-panel-reviewer-edit class={PANEL_PICKER}>
                            <span class={`truncate ${cells.reviewer && !cells.reviewer.missing ? "text-ink" : "text-ink-muted"}`}>
                              {cells.reviewer && !cells.reviewer.missing ? cells.reviewer.text : CHOOSE_REVIEWER}
                            </span>
                            <CaretDownIcon size={PICK_CARET_SIZE} aria-hidden="true" class="shrink-0 text-ink-muted" />
                          </button>
                        {/snippet}
                        {#snippet content({ close })}
                          <ImportWriterList
                            role="reviewer"
                            currentWriterId={file.reviewerId ?? null}
                            onPick={(picked) => {
                              close();
                              pickReviewer(picked);
                            }}
                          />
                        {/snippet}
                      </ImportPickerPopover>
                    {:else if file.reviewerName}
                      <span class="text-ink-secondary">{file.reviewerName}</span>
                    {/if}
                  </dd>
                </div>
              {/if}

              <!-- Science code (omitted on Approved where ImportApprovedDetails edits it) -->
              {#if !approved && (can.scienceCode || cells.scienceCode)}
                {@const codeMissing = cells.scienceCode?.kind === "missing"}
                <div
                  class={`grid grid-cols-[6.75rem_minmax(0,1fr)] items-start gap-x-3 ${
                    codeMissing && can.scienceCode ? "-mx-5 border-l-2 border-warning-ink bg-warning-surface/70 px-5 py-2.5" : ""
                  }`}
                >
                  <dt class={`${SHEET_SMALL} pt-1 text-ink-muted`}>Science code</dt>
                  <dd class="min-w-0 text-[0.8125rem] leading-[calc(18/13)] text-ink" data-import-file-panel-label="Science code">
                    {#if can.scienceCode}
                      <ImportPickerPopover label="Science code" align="end" width="w-[22rem]">
                        {#snippet trigger({ props })}
                          {#if codeMissing}
                            <button {...props} type="button" data-import-panel-code-edit class={PICK_CONTROL}>
                              <span class="truncate">Pick a code</span>
                              <CaretDownIcon size={PICK_CARET_SIZE} aria-hidden="true" class="shrink-0" />
                            </button>
                          {:else if cells.scienceCode?.kind === "code"}
                            <button {...props} type="button" data-import-panel-code-edit class={PANEL_PICKER}>
                              {#if cells.scienceCode.fromDocument}
                                <AuroraMark size={13} label="Filled in by AI" />
                              {/if}
                              <span class="truncate">{[cells.scienceCode.code, cells.scienceCode.title].filter(Boolean).join(" ")}</span>
                              <CaretDownIcon size={PICK_CARET_SIZE} aria-hidden="true" class="shrink-0 text-ink-muted" />
                            </button>
                          {/if}
                        {/snippet}
                        {#snippet content({ close })}
                          <ScienceCodeList
                            value={file.scienceCode ?? null}
                            clearable={false}
                            onSelect={(code) => {
                              close();
                              if (!code || (code === file.scienceCode && file.scienceCodeSource === "person")) return;
                              void change({ scienceCode: code });
                            }}
                          />
                        {/snippet}
                      </ImportPickerPopover>
                      {#if codeMissing}
                        <p class={`mt-1.5 ${SHEET_SMALL} text-ink-secondary`}>The document has no code.</p>
                      {/if}
                    {:else if cells.scienceCode?.kind === "code"}
                      <span class="text-ink-secondary">{[cells.scienceCode.code, cells.scienceCode.title].filter(Boolean).join(" ")}</span>
                    {:else if cells.scienceCode?.kind === "missing"}
                      <span class={AMBER}>{cells.scienceCode.text}</span>
                    {/if}
                  </dd>
                </div>
              {/if}

              <!-- CRA reviewed -->
              {#if !approved && file.category === "final_pd" && (can.craReviewed || file.craReviewed)}
                <div class="grid grid-cols-[6.75rem_minmax(0,1fr)] items-center gap-x-3">
                  <dt class={`${SHEET_SMALL} text-ink-muted`}>CRA</dt>
                  <dd class="min-w-0 text-[0.8125rem] leading-[calc(18/13)] text-ink" data-import-file-panel-label="CRA">
                    {#if can.craReviewed}
                      <button
                        type="button"
                        aria-pressed={cells.craReviewed}
                        data-import-panel-cra-toggle
                        onclick={toggleCra}
                        class={`inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs leading-[calc(4/3)] transition-colors duration-150 ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir motion-reduce:transition-none pointer-coarse:min-h-11 ${
                          cells.craReviewed
                            ? "border-primary-selected bg-primary-wash text-primary-selected"
                            : "border-line bg-surface text-ink-secondary hover:bg-gray-50 hover:text-ink"
                        }`}
                      >
                        <SealCheckIcon size="0.8125rem" aria-hidden="true" />
                        <span>{CRA_REVIEWED}</span>
                      </button>
                    {:else if file.craReviewed}
                      <span class="text-ink-secondary">{CRA_REVIEWED}</span>
                    {/if}
                  </dd>
                </div>
              {/if}

              <!-- Quiet read-only metadata -->
              <div class="grid grid-cols-[6.75rem_minmax(0,1fr)] items-baseline gap-x-3">
                <dt class={`${SHEET_SMALL} text-ink-muted`}>Status</dt>
                <dd class="min-w-0 text-[0.8125rem] leading-[calc(18/13)] text-ink-secondary" data-import-file-panel-label="Where">
                  {fileStateText(file)}
                </dd>
              </div>

              {#if file.coWriterInitials && file.coWriterInitials.length > 0}
                <div class="grid grid-cols-[6.75rem_minmax(0,1fr)] items-baseline gap-x-3">
                  <dt class={`${SHEET_SMALL} text-ink-muted`}>Co-writers</dt>
                  <dd class="min-w-0 text-[0.8125rem] leading-[calc(18/13)] text-ink-secondary" data-import-file-panel-label="Co-writers">
                    {file.coWriterInitials.join(", ")}
                  </dd>
                </div>
              {/if}

              {#if file.reviewerInitials}
                <div class="grid grid-cols-[6.75rem_minmax(0,1fr)] items-baseline gap-x-3">
                  <dt class={`${SHEET_SMALL} text-ink-muted`}>Reviewer initials</dt>
                  <dd class="min-w-0 text-[0.8125rem] leading-[calc(18/13)] text-ink-secondary" data-import-file-panel-label="Reviewer initials">
                    {file.reviewerInProgress ? `${file.reviewerInitials} (in progress)` : file.reviewerInitials}
                  </dd>
                </div>
              {/if}

              {#if clientInitialsFormatted}
                <div class="grid grid-cols-[6.75rem_minmax(0,1fr)] items-baseline gap-x-3">
                  <dt class={`${SHEET_SMALL} text-ink-muted`}>Client initials</dt>
                  <dd class="min-w-0 text-[0.8125rem] leading-[calc(18/13)] break-words text-ink-secondary" data-import-file-panel-label="Client initials">
                    {clientInitialsFormatted}
                  </dd>
                </div>
              {/if}

              {#if file.financialInitials}
                <div class="grid grid-cols-[6.75rem_minmax(0,1fr)] items-baseline gap-x-3">
                  <dt class={`${SHEET_SMALL} text-ink-muted`}>Financial initials</dt>
                  <dd class="min-w-0 text-[0.8125rem] leading-[calc(18/13)] text-ink-secondary" data-import-file-panel-label="Financial initials">
                    {file.financialInitials}
                  </dd>
                </div>
              {/if}

              {#if approved}
                <div class="grid grid-cols-[6.75rem_minmax(0,1fr)] items-baseline gap-x-3">
                  <dt class={`${SHEET_SMALL} text-ink-muted`}>Company page</dt>
                  <dd class="min-w-0 text-[0.8125rem] leading-[calc(18/13)] break-words text-ink-secondary" data-import-file-panel-label="Company page">
                    {#if file.companyPage}
                      <a
                        href={companiesPath(resolve("/"), file.companyPage.key)}
                        class="text-primary-selected underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir"
                      >{file.companyPage.name}</a>
                    {:else}
                      {NOT_ON_COMPANY_PAGE}
                    {/if}
                  </dd>
                </div>
                {#if file.brain}
                  <div class="grid grid-cols-[6.75rem_minmax(0,1fr)] items-baseline gap-x-3">
                    <dt class={`${SHEET_SMALL} text-ink-muted`}>Brain</dt>
                    <dd class="min-w-0 text-[0.8125rem] leading-[calc(18/13)] text-ink-secondary" data-import-file-panel-label="Brain">
                      {BRAIN_STATE_TEXT[file.brain]}
                    </dd>
                  </div>
                {/if}
              {/if}
            </dl>

            {#if canEditInitials}
              <ImportInitialsSlots
                fileId={file._id}
                writerInitials={file.writerInitials}
                reviewerInitials={file.reviewerInitials}
                clientInitials={file.clientInitials}
                financialInitials={file.financialInitials}
                coWriterInitials={file.coWriterInitials}
                extraClientInitials={file.extraClientInitials}
                initialsGroups={file.initialsGroups}
                reviewerInProgress={file.reviewerInProgress}
                documentClientNames={file.documentClientNames}
                companyName={file.clientName}
              />
            {/if}

            {#if approved}
              <ImportApprovedDetails {file} onSentBack={onClose} />
            {/if}

            <!-- Provenance section (Added, Folder, Size) -->
            <div class="mt-4 border-t border-line-soft pt-4">
              <dl class="flex flex-col gap-2.5">
                <div class="grid grid-cols-[6.75rem_minmax(0,1fr)] items-baseline gap-x-3">
                  <dt class={`${SHEET_SMALL} text-ink-muted`}>Added</dt>
                  <dd class={`${SHEET_SMALL} text-ink-secondary`} data-import-file-panel-label="Added">{addedText}</dd>
                </div>
                <div class="grid grid-cols-[6.75rem_minmax(0,1fr)] items-baseline gap-x-3">
                  <dt class={`${SHEET_SMALL} text-ink-muted`}>Folder</dt>
                  <dd class="min-w-0 font-mono text-[0.75rem] leading-[1.45] break-all text-ink-secondary" data-import-file-panel-label="Path">
                    {file.path}
                  </dd>
                </div>
                <div class="grid grid-cols-[6.75rem_minmax(0,1fr)] items-baseline gap-x-3">
                  <dt class={`${SHEET_SMALL} text-ink-muted`}>Size</dt>
                  <dd class={`${SHEET_SMALL} text-ink-secondary`} data-import-file-panel-label="Size">{sizeAndType}</dd>
                </div>
              </dl>
            </div>
          </aside>
        {:else}
          <div role="status" aria-label="Loading the file" class="flex flex-1 flex-col gap-2.5 p-6">
            {#each [0, 1, 2, 3] as index (index)}
              <span class="h-3.5 w-2/3 animate-pulse rounded-sm bg-gray-50 motion-reduce:animate-none"></span>
            {/each}
          </div>
        {/if}
      </div>

      <!-- Footer -->
      {#if file && can}
        <footer class="flex shrink-0 items-center justify-between gap-4 border-t border-line-soft bg-surface px-6 py-3">
          {#if isReview}
            <div class="flex min-w-0 items-center gap-3">
              <button
                type="button"
                data-import-file-panel-delete
                disabled={!can.remove || acting}
                onclick={() => void handleDelete()}
                class="inline-flex h-8 shrink-0 items-center justify-center rounded-lg border border-line bg-surface px-3 text-xs leading-[calc(4/3)] font-medium text-ink transition-colors duration-150 ease-out hover:border-danger-ink-muted/40 hover:bg-danger-surface hover:text-danger-ink-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir disabled:opacity-45 motion-reduce:transition-none pointer-coarse:min-h-11"
              >Delete</button>
              <span class={`hidden truncate ${SHEET_SMALL} text-ink-muted sm:inline`}>
                Moves it to Deleted. Nothing changes on any computer.
              </span>
            </div>

            <button
              type="button"
              data-import-file-panel-approve
              disabled={!canApprove || acting}
              title={!canApprove ? (checks[0] ?? "Still needs checks before approving") : undefined}
              onclick={() => void handleApprove()}
              class="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-xs leading-[calc(4/3)] font-medium text-on-primary transition-colors duration-150 ease-out hover:bg-primary-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir disabled:opacity-45 motion-reduce:transition-none pointer-coarse:min-h-11"
            >
              <CheckIcon size="0.875rem" aria-hidden="true" />
              <span>{hasNext ? "Approve and next" : "Approve"}</span>
            </button>
          {:else if isDeleted}
            <span class={`${SHEET_SMALL} text-ink-muted`}>In Deleted</span>
            {#if can.putBack}
              <button
                type="button"
                data-import-file-panel-put-back
                disabled={acting}
                onclick={() => void handlePutBack()}
                class="inline-flex h-8 shrink-0 items-center justify-center rounded-lg bg-primary px-3.5 text-xs leading-[calc(4/3)] font-medium text-on-primary transition-colors duration-150 ease-out hover:bg-primary-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir disabled:opacity-45 motion-reduce:transition-none pointer-coarse:min-h-11"
              >Put back</button>
            {/if}
          {:else}
            <span class={`${SHEET_SMALL} truncate text-ink-muted`}>
              {file.companyPage ? `Approved on ${file.companyPage.name}` : "Approved"}
            </span>
            <Dialog.Close
              class="inline-flex h-8 shrink-0 items-center justify-center rounded-lg border border-line bg-surface px-3 text-xs leading-[calc(4/3)] font-medium text-ink transition-colors duration-150 ease-out hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir motion-reduce:transition-none pointer-coarse:min-h-11"
            >Close</Dialog.Close>
          {/if}
        </footer>
      {/if}
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>

<style>
  .docx-preview {
    color: var(--color-ink-secondary);
    font-size: 0.8125rem;
    line-height: 1.6;
  }

  .docx-preview :global(h1),
  .docx-preview :global(h2),
  .docx-preview :global(h3),
  .docx-preview :global(h4) {
    color: var(--color-ink);
    font-weight: 500;
    line-height: 1.35;
    margin-top: 1.25rem;
    margin-bottom: 0.5rem;
  }

  .docx-preview :global(h1) {
    font-size: 1.0625rem;
    margin-top: 0;
  }

  .docx-preview :global(h2) {
    font-size: 0.9375rem;
  }

  .docx-preview :global(h3),
  .docx-preview :global(h4) {
    font-size: 0.875rem;
  }

  .docx-preview :global(p) {
    margin-bottom: 0.75rem;
  }

  .docx-preview :global(ul),
  .docx-preview :global(ol) {
    margin-bottom: 0.75rem;
    padding-left: 1.25rem;
  }

  .docx-preview :global(ul) {
    list-style-type: disc;
  }

  .docx-preview :global(ol) {
    list-style-type: decimal;
  }

  .docx-preview :global(li) {
    margin-bottom: 0.25rem;
  }

  .docx-preview :global(strong),
  .docx-preview :global(b) {
    color: var(--color-ink);
    font-weight: 500;
  }

  .docx-preview :global(table) {
    width: 100%;
    border-collapse: collapse;
    margin: 1rem 0;
    font-size: 0.75rem;
    line-height: 1.45;
  }

  .docx-preview :global(th),
  .docx-preview :global(td) {
    border: 1px solid var(--color-line-soft);
    padding: 0.375rem 0.625rem;
    text-align: left;
    vertical-align: top;
  }

  .docx-preview :global(th) {
    background: var(--color-gray-50);
    color: var(--color-ink);
    font-weight: 500;
  }

  .docx-preview :global(img) {
    max-width: 100%;
    height: auto;
    margin: 0.75rem 0;
    border-radius: 0.375rem;
  }
</style>
