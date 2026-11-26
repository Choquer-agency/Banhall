<!--
  The file preview panel (Paper Files 7 and Files 8, node 5Z7U-0): a 1000px
  split-pane view opened from any file's name or row menu.
  - Header: PD number muted + title, "{Company} - {Category}" subtitle,
    "{i} of {N}" with < > prev/next navigation, and close button.
  - Left document pane (bg-gray-50): "What AI read" | "Original" segmented
    switch, short caption, right-aligned Download link, and a Ledger Paper
    document sheet showing cleaned structured text (paged 20k chars at a time
    via sheetFileText) or the rendered original file (.docx via Mammoth, .pdf
    via pdf.js, .xlsx/.csv tables, .msg/.eml emails, text, or image).
  - Right Labels pane (360px): clean Paper layout with Company, Category,
    Fiscal year end, Version, Writer, Science code (amber highlight strip when
    missing), Approved details on Approved, and Provenance below a hairline
    (File, Added, Folder, Size) with a persistent "More details" disclosure
    for PD number, Reviewer, CRA reviewed, and filename initials slots.
  - Footer: stays mounted across Prev/Next transitions; shows Delete + helper
    note or approval block reason on left, primary Approve and next on right
    (or Put back on Deleted).
-->
<script lang="ts">
  import { Dialog } from "bits-ui";
  import type { FunctionArgs } from "convex/server";
  import { tick, untrack } from "svelte";
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
  import { downloadOriginals } from "$lib/components/companies/files/downloadOriginals";
  import { companiesPath } from "$lib/companies/companies";
  import { userErrorMessage } from "$lib/errors";
  import { approveRefusalFor, categoryTakes } from "../../../../shared/importSheetRules";
  import { matchClientInitials } from "../../../../shared/pdSectionC";
  import { documentSheetSubtitle, formatAiReadDocument, formatFolderPath } from "./aiReadFormat";
  import { BRAIN_STATE_TEXT, NOT_ON_COMPANY_PAGE, refusalText } from "./importApprove";
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
  import { CATEGORY_NAMES, checkLines, FILE_VIEW_MAX_CHARS, textNote } from "./importFileView";
  import { fileCells, isBeingRead, yearEndDate, type SheetFileRow, type SheetTab } from "./importFormat";
  import {
    detectFileKind,
    fileTypeLabel,
    formatFileSize,
    originalCaption,
    renderDocxPreview,
    renderEmailPreview,
    renderPdfPages,
    renderSpreadsheetPreview,
    SHEET_PREVIEW_MAX_BYTES,
    type EmailPreview,
    type SheetPreview,
  } from "./originalPreview";
  import { AMBER, CHOICE_ROW, PICK_CARET_SIZE, PICK_CONTROL, SHEET_SMALL, SHOW_MORE } from "./sheetLayout";

  type LabelPatch = FunctionArgs<typeof api.ingestion.setSheetLabels>["patch"];

  const TEXT_PREVIEW_MAX_BYTES = 5 * 1024 * 1024;
  const BINARY_PREVIEW_MAX_BYTES = 25 * 1024 * 1024;

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

  const uid = $props.id();
  const approveReasonId = `${uid}-approve-reason`;

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

  // Keep one approval session alive across "Approve and next" while the panel
  // stays open, and watch its progress so async refusals surface immediately.
  let approvalId = $state<Id<"importApprovals"> | null>(null);
  let reportedRefusals = 0;
  const approvalProgressQ = useQuery(api.ingestion.approvalProgress, () => (approvalId ? {} : "skip"));

  $effect(() => {
    const activeId = approvalId;
    const rows = approvalProgressQ.data;
    if (!activeId || !rows) return;
    const mine = rows.find((entry) => entry.approvalId === activeId);
    if (!mine) return;
    if (mine.refused > reportedRefusals) {
      reportedRefusals = mine.refused;
      toast.error("A file could not be approved and stayed on To review.", {
        ...IMPORT_TOAST,
        description: "Check the approval line on the Import sheet for the reason.",
      });
    }
  });

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
  // Kept sticky across Prev/Next while the panel remains open; reset on close.
  let viewMode = $state<"ai" | "original">("ai");
  let moreDetailsOpen = $state(false);
  let lastTab = $state<SheetTab>("review");

  type LoadedText = { text: string; total: number; source: "full" | "preview" | "none"; cutAtImport: boolean };
  let loaded = $state<LoadedText | null>(null);
  let loading = $state(false);
  let textError = $state<string | null>(null);

  type OriginalState =
    | { status: "idle" }
    | { status: "loading" }
    | { status: "too_large"; kind: "pdf" | "docx" | "spreadsheet" | "email" | "text" }
    | { status: "ready"; kind: "pdf"; pageCount: number; drawn: number }
    | { status: "ready"; kind: "docx"; html: string }
    | { status: "ready"; kind: "spreadsheet"; sheet: SheetPreview }
    | { status: "ready"; kind: "email"; email: EmailPreview }
    | { status: "ready"; kind: "text"; text: string }
    | { status: "error"; message: string };
  let original = $state<OriginalState>({ status: "idle" });
  let pdfHost = $state<HTMLDivElement | null>(null);
  let downloading = $state(false);

  // Each open of the panel, or of another file, is a new generation so
  // in-flight fetches from an earlier file or earlier open are ignored.
  let generation = 0;

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

  // A new file starts its text from the top; closing resets sticky panel state
  // and ends the active single-file approval session.
  $effect(() => {
    const target = id;
    untrack(() => {
      generation += 1;
      loaded = null;
      loading = false;
      textError = null;
      original = { status: "idle" };
      if (!target) {
        viewMode = "ai";
        moreDetailsOpen = false;
        approvalId = null;
        reportedRefusals = 0;
      } else {
        void loadFrom(target, 0);
      }
    });
  });

  // Extract primitive preview inputs so Convex live updates to labels on the
  // same file never abort or reload the Original preview.
  const previewId = $derived(file?._id ?? null);
  const previewUrl = $derived(file?.originalUrl ?? null);
  const previewName = $derived(file?.name ?? null);
  const previewSize = $derived(file?.size ?? null);
  const fileKind = $derived(previewName ? detectFileKind(previewName) : "other");

  function previewLimitFor(kind: "pdf" | "docx" | "spreadsheet" | "email" | "text"): number {
    if (kind === "spreadsheet") return SHEET_PREVIEW_MAX_BYTES;
    if (kind === "text") return TEXT_PREVIEW_MAX_BYTES;
    return BINARY_PREVIEW_MAX_BYTES;
  }

  $effect(() => {
    const targetId = previewId;
    const url = previewUrl;
    const kind = fileKind;
    const size = previewSize;
    const fileName = previewName;
    const wantsFetch =
      viewMode === "original" &&
      Boolean(targetId && url && fileName) &&
      (kind === "pdf" || kind === "docx" || kind === "spreadsheet" || kind === "email" || kind === "text");

    if (!wantsFetch || !targetId || !url || !fileName) {
      original = { status: "idle" };
      return;
    }

    const limit = previewLimitFor(kind);
    if (size !== null && size > limit) {
      original = { status: "too_large", kind };
      return;
    }

    const controller = new AbortController();
    const { signal } = controller;
    original = { status: "loading" };

    void (async () => {
      try {
        const response = await globalThis.fetch(url, { signal });
        if (!response.ok) throw new Error("The original file could not be loaded.");
        if (signal.aborted) return;

        const contentLength = Number(response.headers.get("content-length") ?? 0);
        if (contentLength > limit) {
          controller.abort();
          original = { status: "too_large", kind };
          return;
        }

        const buffer = await response.arrayBuffer();
        if (signal.aborted) return;
        if (buffer.byteLength > limit) {
          original = { status: "too_large", kind };
          return;
        }

        if (kind === "text") {
          const text = new TextDecoder().decode(buffer);
          if (!signal.aborted) original = { status: "ready", kind: "text", text };
          return;
        }

        if (kind === "pdf") {
          original = { status: "ready", kind: "pdf", pageCount: 0, drawn: 0 };
          await tick();
          const host = pdfHost;
          if (!host || signal.aborted) return;
          host.replaceChildren();
          const result = await renderPdfPages(buffer, host, () => !signal.aborted);
          if (!signal.aborted) original = { status: "ready", kind: "pdf", ...result };
        } else if (kind === "docx") {
          const html = await renderDocxPreview(buffer);
          if (!signal.aborted) original = { status: "ready", kind: "docx", html };
        } else if (kind === "spreadsheet") {
          const sheet = await renderSpreadsheetPreview(buffer);
          if (!signal.aborted) original = { status: "ready", kind: "spreadsheet", sheet };
        } else if (kind === "email") {
          const email = await renderEmailPreview(buffer, fileName);
          if (!signal.aborted) original = { status: "ready", kind: "email", email };
        }
      } catch (error) {
        if (signal.aborted) return;
        original = { status: "error", message: userErrorMessage(error, "The original file could not be previewed.") };
      }
    })();

    return () => controller.abort();
  });

  // ─── Derived state & formatted AI document ──────────────────────────────
  const shown = $derived(loaded?.text.length ?? 0);
  const canShowMore = $derived(Boolean(loaded && shown < loaded.total && shown < FILE_VIEW_MAX_CHARS));
  const note = $derived(loaded ? textNote({ shown, total: loaded.total, source: loaded.source, cutAtImport: loaded.cutAtImport }) : null);
  const sheetTab = $derived<SheetTab>(file?.sheetTab ?? (file?.status === "approved" ? "approved" : file?.status === "pending_review" ? "review" : "deleted"));
  $effect(() => {
    if (file) lastTab = sheetTab;
  });
  const can = $derived(file ? rowAbilities(file, sheetTab) : null);
  const approved = $derived(file?.status === "approved");
  const isReview = $derived(file?.sheetTab === "review");
  const isDeleted = $derived(file?.sheetTab === "deleted");
  const checks = $derived(file && isReview ? checkLines(file.checkReasons) : []);
  const companyMissingInline = $derived(Boolean(file && isReview && !approved && can?.menu && file.checkReasons.includes("no_company")));
  const yearMissingInline = $derived(Boolean(file && isReview && !approved && can?.edit && file.checkReasons.includes("no_fiscal_year")));
  const writerMissingInline = $derived(
    Boolean(file && isReview && !approved && can?.writer && (cells?.writer?.tone === "amber" || file.checkReasons.includes("no_writer")))
  );
  const codeMissingInline = $derived(
    Boolean(file && isReview && !approved && can?.scienceCode && (cells?.scienceCode?.kind === "missing" || file.checkReasons.includes("no_science_code")))
  );
  const extraChecks = $derived(
    checks.filter(
      (line) =>
        !(companyMissingInline && line === "Needs a company") &&
        !(yearMissingInline && line === "Needs a fiscal year") &&
        !(writerMissingInline && line === "Needs a writer") &&
        !(codeMissingInline && line === "Needs a science code")
    )
  );
  const approveBlockReason = $derived.by(() => {
    if (!file || !isReview) return null;
    if (file.approveBlock) {
      if (file.approveBlock.reason === "needs_check" && checks[0]) return checks[0];
      return refusalText(file.approveBlock);
    }
    const localRefusal = approveRefusalFor(file);
    if (localRefusal) {
      if (localRefusal === "needs_check" && checks[0]) return checks[0];
      return refusalText({ reason: localRefusal });
    }
    return null;
  });
  const canApprove = $derived(Boolean(file && isReview && approveBlockReason === null));
  const subtitle = $derived.by(() => {
    if (!file) return "Loading the file";
    const company = file.clientName?.trim();
    const category = CATEGORY_NAMES[file.category];
    return company ? `${company} - ${category}` : category;
  });

  const documentTitle = $derived(cells?.title ?? file?.name ?? "File");
  const documentSubtitle = $derived(file ? documentSheetSubtitle(file.category, file.clientName) : "");
  const formattedAiRead = $derived(
    loaded && loaded.text && file
      ? formatAiReadDocument(loaded.text, { documentTitle, category: file.category })
      : { blocks: [], hasScienceCodeField: false }
  );
  // Only show the synthetic missing-code banner once the full stored text is loaded
  // so truncated (>20k char) PDs are not falsely reported as missing a code.
  const showMissingCodeCallout = $derived(
    Boolean(isReview && cells?.scienceCode?.kind === "missing" && loaded && shown >= loaded.total && !formattedAiRead.hasScienceCodeField)
  );
  const showInitialsSlots = $derived(
    Boolean(file && isReview && !isBeingRead(file.status) && categoryTakes("writerName", file.category))
  );
  const hasAiFilledField = $derived(Boolean(!approved && cells?.scienceCode?.kind === "code" && cells.scienceCode.fromDocument));
  const hasSecondaryFields = $derived(
    Boolean(
      !approved &&
        file &&
        can &&
        (can.pdNumber ||
          file.pdNumber ||
          can.reviewer ||
          file.reviewerName ||
          (file.category === "final_pd" && (can.craReviewed || file.craReviewed)) ||
          showInitialsSlots)
    )
  );
  const moreDetailsSummary = $derived.by(() => {
    if (!file || moreDetailsOpen) return null;
    const parts: string[] = [];
    if (file.pdNumber) parts.push(`PD ${file.pdNumber}`);
    if (cells?.reviewer && !cells.reviewer.missing) parts.push(cells.reviewer.text);
    if (cells?.craReviewed) parts.push("CRA");
    const matchedClient =
      file.clientInitials && file.documentClientNames?.length
        ? matchClientInitials(file.documentClientNames, file.clientInitials, { companyName: file.clientName })
        : null;
    if (matchedClient) parts.push(matchedClient.name);
    return parts.length > 0 ? parts.slice(0, 2).join(" - ") : null;
  });

  // ─── Inline label editing (To review) ───────────────────────────────────
  let acting = $state(false);
  const followsInitials = $derived(
    Boolean(file && file.writerNameSource !== "person" && !(file.editedLabels ?? []).includes("writerName"))
  );

  async function oneFile(call: () => Promise<BatchResult>, fallback: string): Promise<boolean> {
    if (!file) return false;
    const targetId = file._id;
    try {
      const result = await call();
      if (result.skipped.length > 0) {
        toast.error("The change was not saved.", { ...IMPORT_TOAST, description: skippedText(result.skipped, sheetTab) });
      }
      return result.changedIds.includes(targetId);
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

  async function handleDownload(event: MouseEvent) {
    if (!file?.originalUrl) return;
    // Let modifier clicks open in a new tab naturally via the link href.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    if (downloading) return;
    downloading = true;
    try {
      await downloadOriginals([{ fileName: file.name, url: file.originalUrl, bytes: file.size }], file.name);
    } catch (error) {
      toast.error(userErrorMessage(error, "The original file could not be downloaded."), IMPORT_TOAST);
    } finally {
      downloading = false;
    }
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
      const result = await approveFiles({ ids: [targetId], ...(approvalId ? { approvalId } : {}) });
      if (result?.approvalId) approvalId = result.approvalId;
      if (onRemoved) onRemoved(targetId);
      else onClose();
    } catch (error) {
      toast.error(userErrorMessage(error, "The file could not be approved."), IMPORT_TOAST);
    } finally {
      acting = false;
    }
  }

  // ─── Provenance formatting (Paper Files 7) ──────────────────────────────
  const addedPrimary = $derived.by(() => {
    if (!file) return "";
    if (file.batchSource === "page") {
      return file.addedByName ? `Added on the page by ${file.addedByName}` : "Added on the page";
    }
    if (file.batchSource === "uploader" || (!file.batchSource && file.addedVia === "folder_upload")) {
      return file.addedByName ? `With the uploader by ${file.addedByName}` : "With the uploader";
    }
    return "By OneDrive sync";
  });
  const addedDate = $derived(
    file && Number.isFinite(file.addedAt)
      ? new Date(file.addedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
      : ""
  );
  const folderDisplay = $derived(file ? formatFolderPath(file.path, file.name) : "");
  const sizeAndType = $derived.by(() => {
    if (!file) return "";
    const size = formatFileSize(file.size);
    const kind = fileTypeLabel(file.name);
    return size ? `${size}, ${kind}` : kind;
  });

  const PANEL_PICKER =
    "group/pick -mx-2 inline-flex min-h-7 max-w-full min-w-0 items-center gap-1 rounded-md px-2 text-left text-[0.8125rem] leading-[calc(18/13)] text-ink transition-colors duration-150 ease-out hover:bg-primary-wash focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir data-[state=open]:bg-primary-wash motion-reduce:transition-none pointer-coarse:min-h-11";
  const FALLBACK_DOWNLOAD =
    "inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-xs leading-[calc(4/3)] font-medium text-ink transition-colors duration-150 ease-out hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir motion-reduce:transition-none pointer-coarse:min-h-11";
  const AMBER_STRIP = "-mx-3 items-start rounded-r-md border-l-2 border-import-pick-line bg-warning-surface/70 px-3 py-3";
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
      <header class="flex shrink-0 items-center justify-between gap-4 border-b border-line-soft px-6 py-4">
        <div class="flex min-w-0 flex-1 flex-col gap-0.5">
          <Dialog.Title
            class="flex min-w-0 items-baseline gap-2.5 text-[1.0625rem] leading-[1.35] font-medium text-ink"
            data-import-file-panel-title
          >
            {#if cells?.prefix}<span class="shrink-0 font-normal text-ink-muted">{cells.prefix}</span>{/if}
            <span class="min-w-0 truncate">{documentTitle}</span>
          </Dialog.Title>
          <Dialog.Description class="truncate text-[0.8125rem] leading-[1.35] text-ink-muted">{subtitle}</Dialog.Description>
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
      <div class="flex min-h-0 flex-1 flex-col overflow-y-auto md:flex-row md:overflow-hidden" data-import-file-panel-body>
        {#if id && fileQ.data === null}
          <div class="flex flex-1 items-start p-6">
            <p class="text-[0.8125rem] leading-[calc(18/13)] text-ink-secondary">This file is no longer in Import.</p>
          </div>
        {:else if file && cells && can}
          <!-- Left document pane -->
          <section class="flex min-h-[24rem] min-w-0 flex-1 flex-col bg-gray-50 md:min-h-0" aria-label="Document preview">
            <div class="flex shrink-0 flex-wrap items-center justify-between gap-3 px-6 py-3.5">
              <div class="flex min-w-0 items-center gap-3">
                <div
                  role="group"
                  aria-label="Document view"
                  class="inline-flex items-center rounded-lg border border-line bg-surface p-0.5"
                >
                  <button
                    type="button"
                    aria-pressed={viewMode === "ai"}
                    data-import-file-panel-view="ai"
                    onclick={() => (viewMode = "ai")}
                    class={`rounded-md px-3 py-1 text-xs leading-[calc(4/3)] transition-colors duration-150 ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir motion-reduce:transition-none pointer-coarse:min-h-11 ${
                      viewMode === "ai"
                        ? "bg-action-primary font-medium text-action-primary-foreground"
                        : "text-ink-secondary hover:bg-primary-wash hover:text-ink"
                    }`}
                  >What AI read</button>
                  <button
                    type="button"
                    aria-pressed={viewMode === "original"}
                    data-import-file-panel-view="original"
                    onclick={() => (viewMode = "original")}
                    class={`rounded-md px-3 py-1 text-xs leading-[calc(4/3)] transition-colors duration-150 ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir motion-reduce:transition-none pointer-coarse:min-h-11 ${
                      viewMode === "original"
                        ? "bg-action-primary font-medium text-action-primary-foreground"
                        : "text-ink-secondary hover:bg-primary-wash hover:text-ink"
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
                  onclick={(event) => void handleDownload(event)}
                  class="inline-flex items-center rounded-sm text-[0.8125rem] leading-[calc(18/13)] font-medium text-primary-selected transition-colors duration-150 ease-out hover:text-primary-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir motion-reduce:transition-none pointer-coarse:min-h-11"
                >{downloading ? "Downloading..." : "Download"}</a>
              {/if}
            </div>

            <div class="min-h-0 flex-1 overflow-y-auto px-6 pb-8">
              {#if viewMode === "ai"}
                <article class="mx-auto w-full max-w-[39rem] rounded-xl border border-line-soft bg-surface px-10 py-9 shadow-pd-thumb">
                  {#if textError}
                    <p role="alert" class="text-[0.8125rem] leading-[calc(18/13)] text-ink-secondary">{textError}</p>
                  {:else if !loaded}
                    <div role="status" aria-label="Loading the text" class="flex flex-col gap-3">
                      <span class="h-5 w-1/2 animate-pulse rounded-sm bg-gray-50 motion-reduce:animate-none"></span>
                      <span class="h-3 w-1/3 animate-pulse rounded-sm bg-gray-50 motion-reduce:animate-none"></span>
                      <div class="mt-4 flex flex-col gap-2.5">
                        {#each [0, 1, 2, 3] as index (index)}
                          <span class={`h-3 animate-pulse rounded-sm bg-gray-50 motion-reduce:animate-none ${index === 3 ? "w-2/3" : "w-full"}`}></span>
                        {/each}
                      </div>
                    </div>
                  {:else if loaded.source === "none" || loaded.total === 0}
                    <p data-import-file-panel-no-text class="text-[0.8125rem] leading-[calc(18/13)] text-ink-secondary">
                      No text could be read from this file.
                    </p>
                  {:else}
                    <header class="mb-6">
                      <h3 class="text-[1.125rem] leading-[1.35] font-medium text-ink">{documentTitle}</h3>
                      <p class="mt-1 text-[0.8125rem] leading-[1.45] text-ink-muted">{documentSubtitle}</p>
                    </header>

                    {#if showMissingCodeCallout}
                      <div
                        data-import-file-panel-callout
                        class="mb-5 rounded-r-lg border-l-2 border-import-pick-line bg-warning-surface/70 px-3.5 py-2 text-[0.8125rem] leading-[1.45]"
                      >
                        <span class="font-medium text-ink">Field of science or technology code:</span>
                        <span class="ml-1 text-warning-ink">to be added</span>
                      </div>
                    {/if}

                    <div data-import-file-panel-text class="min-w-0 break-words">
                      {#each formattedAiRead.blocks as block, idx (idx)}
                        {#if block.kind === "metadata"}
                          <dl class="mt-5 flex flex-col gap-2 text-[0.8125rem] leading-[1.45] first:mt-0">
                            {#each block.rows as row, rowIdx (rowIdx)}
                              <div class="grid grid-cols-[8.75rem_minmax(0,1fr)] items-baseline gap-x-4">
                                <dt class="text-ink-muted">{row.label}</dt>
                                <dd class="min-w-0 text-ink-secondary">{row.value}</dd>
                              </div>
                            {/each}
                          </dl>
                        {:else if block.kind === "callout"}
                          <div
                            data-import-file-panel-callout
                            class="mt-4 rounded-r-lg border-l-2 border-import-pick-line bg-warning-surface/70 px-3.5 py-2 text-[0.8125rem] leading-[1.45] first:mt-0"
                          >
                            <span class="font-medium text-ink">{block.label}:</span>
                            <span class="ml-1 text-warning-ink">{block.value}</span>
                          </div>
                        {:else if block.kind === "heading"}
                          <h4 class="mt-6 text-[0.8125rem] leading-[1.45] font-medium text-ink first:mt-0">{block.text}</h4>
                        {:else if block.kind === "list"}
                          {#if block.ordered}
                            <ol
                              start={block.start && block.start > 1 ? block.start : undefined}
                              class="mt-2 flex list-decimal flex-col gap-1.5 pl-5 text-[0.8125rem] leading-[1.6] text-ink-secondary first:mt-0"
                            >
                              {#each block.items as item, itemIdx (itemIdx)}
                                <li>{item}</li>
                              {/each}
                            </ol>
                          {:else}
                            <ul class="mt-2 flex list-disc flex-col gap-1.5 pl-4 text-[0.8125rem] leading-[1.6] text-ink-secondary first:mt-0">
                              {#each block.items as item, itemIdx (itemIdx)}
                                <li>{item}</li>
                              {/each}
                            </ul>
                          {/if}
                        {:else}
                          <p class="mt-2 text-[0.8125rem] leading-[1.65] text-ink-secondary first:mt-0">{block.text}</p>
                        {/if}
                      {/each}
                    </div>

                    {#if note}
                      <p data-import-file-panel-text-note class={`mt-6 border-t border-line-soft pt-3 ${SHEET_SMALL} text-ink-muted`}>{note}</p>
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
                </article>
              {:else if !file.originalUrl}
                <div class="mx-auto flex w-full max-w-[39rem] flex-col items-start gap-2 rounded-sm border border-line-soft bg-surface px-10 py-9 shadow-preview-page">
                  <p data-import-file-panel-no-original class="text-[0.8125rem] leading-[calc(18/13)] text-ink-secondary">
                    The original file is not stored here.
                  </p>
                </div>
              {:else if fileKind === "image"}
                <div class="mx-auto flex w-full max-w-[39rem] justify-center rounded-sm border border-line-soft bg-surface p-6 shadow-preview-page">
                  <img
                    src={file.originalUrl}
                    alt={file.name}
                    data-import-file-panel-original-image
                    class="max-h-[42rem] max-w-full rounded-md object-contain"
                  />
                </div>
              {:else if fileKind === "pdf" || fileKind === "docx" || fileKind === "spreadsheet" || fileKind === "email" || fileKind === "text"}
                <div class="mx-auto w-full max-w-[39rem] rounded-sm border border-line-soft bg-surface px-10 py-9 shadow-preview-page">
                  {#if original.status === "loading" || original.status === "idle"}
                    <div role="status" aria-label="Loading the original file" class="flex flex-col gap-2.5">
                      {#each [0, 1, 2, 3, 4] as index (index)}
                        <span class={`h-3 animate-pulse rounded-sm bg-gray-50 motion-reduce:animate-none ${index === 4 ? "w-1/2" : "w-full"}`}></span>
                      {/each}
                    </div>
                  {:else if original.status === "too_large"}
                    <div class="flex flex-col items-start gap-3">
                      <p class="text-[0.8125rem] leading-[calc(18/13)] text-ink-secondary">
                        This {original.kind === "spreadsheet" ? "spreadsheet" : original.kind === "text" ? "text file" : "file"} is too large to preview here. Download it or switch to What AI read.
                      </p>
                      <a
                        href={file.originalUrl}
                        download={file.name}
                        target="_blank"
                        rel="noopener noreferrer"
                        onclick={(event) => void handleDownload(event)}
                        class={FALLBACK_DOWNLOAD}
                      >
                        <DownloadSimpleIcon size="0.875rem" aria-hidden="true" />
                        <span>Download original</span>
                      </a>
                    </div>
                  {:else if original.status === "error"}
                    <div class="flex flex-col items-start gap-3">
                      <p role="alert" class="text-[0.8125rem] leading-[calc(18/13)] text-ink-secondary">{original.message}</p>
                      <a
                        href={file.originalUrl}
                        download={file.name}
                        target="_blank"
                        rel="noopener noreferrer"
                        onclick={(event) => void handleDownload(event)}
                        class={FALLBACK_DOWNLOAD}
                      >
                        <DownloadSimpleIcon size="0.875rem" aria-hidden="true" />
                        <span>Download original</span>
                      </a>
                    </div>
                  {:else if original.kind === "pdf"}
                    <div bind:this={pdfHost} data-import-file-panel-original-pdf class="flex flex-col gap-2 bg-line-soft"></div>
                    {#if original.drawn > 0 && original.pageCount > original.drawn}
                      <p class={`mt-4 ${SHEET_SMALL} text-ink-muted`}>
                        Showing the first {original.drawn} of {original.pageCount} pages. Download to see the rest.
                      </p>
                    {/if}
                  {:else if original.kind === "docx"}
                    {#if original.html.trim().length > 0}
                      <!-- Safe: HTML is sanitized by sanitizeWordHtml in previewRenderers.ts -->
                      <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                      <div data-import-file-panel-original-docx class="docx-preview">{@html original.html}</div>
                      <p class={`mt-5 border-t border-line-soft pt-3 ${SHEET_SMALL} text-ink-muted`}>
                        Text and tables from Word. Download the original to view embedded images or exact layout.
                      </p>
                    {:else}
                      <div class="flex flex-col items-start gap-3">
                        <p class="text-[0.8125rem] leading-[calc(18/13)] text-ink-secondary">
                          This Word file has no previewable text (embedded images are omitted here). Download the original to view it.
                        </p>
                        <a
                          href={file.originalUrl}
                          download={file.name}
                          target="_blank"
                          rel="noopener noreferrer"
                          onclick={(event) => void handleDownload(event)}
                          class={FALLBACK_DOWNLOAD}
                        >
                          <DownloadSimpleIcon size="0.875rem" aria-hidden="true" />
                          <span>Download original</span>
                        </a>
                      </div>
                    {/if}
                  {:else if original.kind === "spreadsheet"}
                    <div data-import-file-panel-original-sheet class="flex flex-col gap-2">
                      {#if original.sheet.rows.length === 0}
                        <p class="text-[0.8125rem] leading-[calc(18/13)] text-ink-muted">The first sheet is empty.</p>
                      {:else}
                        {#if original.sheet.sheetName}
                          <h4 class={`${SHEET_SMALL} font-medium text-ink-muted`}>{original.sheet.sheetName}</h4>
                        {/if}
                        <div class="overflow-x-auto rounded-lg border border-line-soft">
                          <table class="w-full border-collapse text-left text-xs leading-[1.4]">
                            <tbody>
                              {#each original.sheet.rows as row, rowIndex (rowIndex)}
                                <tr class={rowIndex === 0 ? "bg-gray-50 font-medium text-ink" : "border-t border-line-soft text-ink-secondary"}>
                                  {#each row as cell, colIndex (colIndex)}
                                    <td class="max-w-[14rem] truncate border-r border-line-soft px-2.5 py-1.5 whitespace-nowrap last:border-r-0">{cell}</td>
                                  {/each}
                                </tr>
                              {/each}
                            </tbody>
                          </table>
                        </div>
                        {#if original.sheet.moreRows || original.sheet.moreColumns}
                          <p class={`${SHEET_SMALL} text-ink-muted`}>Showing the first rows and columns. Download to see the rest.</p>
                        {/if}
                      {/if}
                    </div>
                  {:else if original.kind === "email"}
                    <div data-import-file-panel-original-email class="flex flex-col gap-4">
                      <div class="flex flex-col gap-2 border-b border-line-soft pb-4">
                        <p class="text-base leading-[1.35] font-medium text-ink">{original.email.subject || "(No subject)"}</p>
                        <dl class="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-x-2 gap-y-1 text-[0.8125rem] leading-[calc(18/13)]">
                          {#if original.email.from}<dt class="text-ink-muted">From</dt><dd class="min-w-0 break-words text-ink">{original.email.from}</dd>{/if}
                          {#if original.email.to}<dt class="text-ink-muted">To</dt><dd class="min-w-0 break-words text-ink">{original.email.to}</dd>{/if}
                          {#if original.email.date}<dt class="text-ink-muted">Date</dt><dd class="min-w-0 text-ink-secondary">{original.email.date}</dd>{/if}
                        </dl>
                      </div>
                      <pre class="font-sans text-[0.8125rem] leading-[1.6] whitespace-pre-wrap break-words text-ink-secondary">{original.email.body || "This email has no text."}</pre>
                    </div>
                  {:else}
                    <pre
                      data-import-file-panel-original-text
                      class="font-sans text-[0.8125rem] leading-[1.6] whitespace-pre-wrap break-words text-ink-secondary"
                    >{original.text}</pre>
                  {/if}
                </div>
              {:else}
                <div class="mx-auto flex w-full max-w-[39rem] flex-col items-start gap-3 rounded-sm border border-line-soft bg-surface px-10 py-9 shadow-preview-page">
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
                    onclick={(event) => void handleDownload(event)}
                    class={FALLBACK_DOWNLOAD}
                  >
                    <DownloadSimpleIcon size="0.875rem" aria-hidden="true" />
                    <span>Download {file.name}</span>
                  </a>
                </div>
              {/if}
            </div>
          </section>

          <!-- Right Labels pane (Paper Files 7 & Files 8, node 5Z7U-0) -->
          <aside
            class="flex w-full shrink-0 flex-col border-t border-line-soft bg-surface px-6 py-5 md:w-[22.5rem] md:overflow-y-auto md:border-t-0 md:border-l"
            aria-label="File labels and details"
          >
            <div class="mb-5 flex items-center justify-between gap-2">
              <span class="text-[0.8125rem] leading-[1.35] text-ink-muted">Labels</span>
              {#if hasAiFilledField}
                <span class="inline-flex items-center gap-1.5 text-[0.8125rem] leading-[1.35] text-ink-muted">
                  <AuroraMark size={13} />
                  <span>Filled in by AI</span>
                </span>
              {/if}
            </div>

            {#if extraChecks.length > 0}
              <ul
                data-import-file-panel-checks
                class={`mb-4 flex flex-col gap-1 rounded-lg bg-warning-surface px-3 py-2 text-xs leading-[calc(4/3)] ${AMBER}`}
              >
                {#each extraChecks as line (line)}<li>{line}</li>{/each}
              </ul>
            {/if}

            <dl data-import-file-panel-labels class="flex flex-col gap-3">
              <!-- Company -->
              <div
                class={`grid grid-cols-[6.75rem_minmax(0,1fr)] gap-x-3 ${companyMissingInline ? AMBER_STRIP : "items-center"}`}
              >
                <dt class={`${SHEET_SMALL} ${companyMissingInline ? "pt-1" : ""} text-ink-muted`}>Company</dt>
                <dd class="min-w-0 text-[0.8125rem] leading-[calc(18/13)] text-ink" data-import-file-panel-label="Company">
                  {#if can.menu}
                    <ImportPickerPopover label="Company" align="end">
                      {#snippet trigger({ props })}
                        <button
                          {...props}
                          type="button"
                          data-import-panel-company-edit
                          class={companyMissingInline ? PICK_CONTROL : PANEL_PICKER}
                        >
                          <span class="truncate">{file.clientName?.trim() || "Choose company"}</span>
                          <CaretDownIcon size={PICK_CARET_SIZE} aria-hidden="true" class={companyMissingInline ? "shrink-0" : "shrink-0 text-ink-muted"} />
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
                    {#if companyMissingInline}
                      <p data-import-file-panel-inline-check class={`mt-2 ${SHEET_SMALL} text-ink-secondary`}>Needs a company</p>
                    {/if}
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
                <div
                  class={`grid grid-cols-[6.75rem_minmax(0,1fr)] gap-x-3 ${yearMissingInline ? AMBER_STRIP : "items-start"}`}
                >
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
                          <button
                            {...props}
                            type="button"
                            data-import-panel-year-edit
                            class={yearMissingInline ? PICK_CONTROL : PANEL_PICKER}
                          >
                            <span class="truncate">{file.fiscalYearEnd !== undefined ? yearEndDate(file.fiscalYearEnd) : "Set year end"}</span>
                            <CaretDownIcon size={PICK_CARET_SIZE} aria-hidden="true" class={yearMissingInline ? "shrink-0" : "shrink-0 text-ink-muted"} />
                          </button>
                        {/snippet}
                      </DatePicker>
                      {#if yearMissingInline}
                        <p data-import-file-panel-inline-check class={`mt-2 ${SHEET_SMALL} text-ink-secondary`}>Needs a fiscal year</p>
                      {:else if cells.fiscalYear}
                        <div class={`${SHEET_SMALL} mt-0.5 text-ink-muted`}>
                          Fiscal year {cells.fiscalYear.text}{file.fiscalYearEndAssumed ? " - assumed from folder" : ""}
                        </div>
                      {/if}
                    {:else if file.fiscalYearEnd !== undefined}
                      <span class="text-ink-secondary">{yearEndDate(file.fiscalYearEnd)}</span>
                      {#if cells.fiscalYear}
                        <div class={`${SHEET_SMALL} mt-0.5 text-ink-muted`}>
                          Fiscal year {cells.fiscalYear.text}{file.fiscalYearEndAssumed ? " - assumed from folder" : ""}
                        </div>
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

              <!-- Writer (omitted on Approved where ImportApprovedDetails edits it) -->
              {#if !approved && (can.writer || cells.writer)}
                <div
                  class={`grid grid-cols-[6.75rem_minmax(0,1fr)] gap-x-3 ${writerMissingInline ? AMBER_STRIP : "items-center"}`}
                >
                  <dt class={`${SHEET_SMALL} ${writerMissingInline ? "pt-1" : ""} text-ink-muted`}>Writer</dt>
                  <dd class="min-w-0 text-[0.8125rem] leading-[calc(18/13)] text-ink" data-import-file-panel-label="Writer">
                    {#if can.writer}
                      <ImportPickerPopover label="Writer" align="end">
                        {#snippet trigger({ props })}
                          {#if writerMissingInline}
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
                            initials={followsInitials ? (cells.writer?.initials ?? null) : null}
                            onPick={(picked) => {
                              close();
                              pickWriter(picked);
                            }}
                          />
                        {/snippet}
                      </ImportPickerPopover>
                      {#if writerMissingInline}
                        <p data-import-file-panel-inline-check class={`mt-2 ${SHEET_SMALL} text-ink-secondary`}>Needs a writer</p>
                      {/if}
                      {#if file.coWriterInitials && file.coWriterInitials.length > 0}
                        <p class={`mt-1 ${SHEET_SMALL} text-ink-muted`}>Co-writers: {file.coWriterInitials.join(", ")}</p>
                      {/if}
                    {:else if cells.writer}
                      <span class="text-ink-secondary">{cells.writer.tone === "amber" ? "No writer yet" : cells.writer.text}</span>
                    {/if}
                  </dd>
                </div>
              {/if}

              <!-- Science code (omitted on Approved where ImportApprovedDetails edits it) -->
              {#if !approved && (can.scienceCode || cells.scienceCode)}
                <div
                  class={`grid grid-cols-[6.75rem_minmax(0,1fr)] gap-x-3 ${codeMissingInline ? AMBER_STRIP : "items-center"}`}
                >
                  <dt class={`${SHEET_SMALL} ${codeMissingInline ? "pt-1" : ""} text-ink-muted`}>Science code</dt>
                  <dd class="min-w-0 text-[0.8125rem] leading-[calc(18/13)] text-ink" data-import-file-panel-label="Science code">
                    {#if can.scienceCode}
                      <ImportPickerPopover label="Science code" align="end" width="w-[22rem]">
                        {#snippet trigger({ props })}
                          {#if codeMissingInline}
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
                          {:else}
                            <button {...props} type="button" data-import-panel-code-edit class={PANEL_PICKER}>
                              <span class="truncate text-ink-muted">Pick a code</span>
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
                      {#if codeMissingInline}
                        <p data-import-file-panel-inline-check class={`mt-2 ${SHEET_SMALL} text-ink-secondary`}>
                          The document has no code.
                        </p>
                      {/if}
                    {:else if cells.scienceCode?.kind === "code"}
                      <span class="text-ink-secondary">{[cells.scienceCode.code, cells.scienceCode.title].filter(Boolean).join(" ")}</span>
                    {:else if cells.scienceCode?.kind === "missing"}
                      <span class={AMBER}>{cells.scienceCode.text}</span>
                    {/if}
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
                        class="inline-flex items-center text-primary-selected underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir pointer-coarse:min-h-11"
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

            {#if approved}
              <ImportApprovedDetails {file} onSentBack={onClose} />
            {/if}

            <!-- Provenance section (File, Added, Folder, Size) -->
            <div class="mt-6 border-t border-line-soft pt-5">
              <dl class="flex flex-col gap-3.5">
                <div class="grid grid-cols-[6.75rem_minmax(0,1fr)] items-baseline gap-x-3">
                  <dt class={`${SHEET_SMALL} text-ink-muted`}>File</dt>
                  <dd
                    title={file.name}
                    class="min-w-0 font-mono text-[0.75rem] leading-[1.5] break-words text-ink-secondary"
                    data-import-file-panel-label="File"
                  >
                    {file.name}
                  </dd>
                </div>
                <div class="grid grid-cols-[6.75rem_minmax(0,1fr)] items-baseline gap-x-3">
                  <dt class={`${SHEET_SMALL} text-ink-muted`}>Added</dt>
                  <dd class={`${SHEET_SMALL} flex flex-col gap-0.5 text-ink-secondary`} data-import-file-panel-label="Added">
                    <span>{addedPrimary}</span>
                    {#if addedDate}<span class="text-ink-muted">{addedDate}</span>{/if}
                  </dd>
                </div>
                {#if folderDisplay}
                  <div class="grid grid-cols-[6.75rem_minmax(0,1fr)] items-baseline gap-x-3">
                    <dt class={`${SHEET_SMALL} text-ink-muted`}>Folder</dt>
                    <dd
                      title={file.path}
                      class="min-w-0 font-mono text-[0.75rem] leading-[1.5] break-words text-ink-secondary"
                      data-import-file-panel-label="Path"
                    >
                      {folderDisplay}
                    </dd>
                  </div>
                {/if}
                <div class="grid grid-cols-[6.75rem_minmax(0,1fr)] items-baseline gap-x-3">
                  <dt class={`${SHEET_SMALL} text-ink-muted`}>Size</dt>
                  <dd class={`${SHEET_SMALL} text-ink-secondary`} data-import-file-panel-label="Size">{sizeAndType}</dd>
                </div>
              </dl>
            </div>

            <!-- Persistent disclosure for secondary fields (PD number, Reviewer, CRA reviewed, Filename initials) -->
            {#if hasSecondaryFields}
              <div class="mt-5 border-t border-line-soft pt-4">
                <button
                  type="button"
                  aria-expanded={moreDetailsOpen}
                  data-import-file-panel-more-details
                  onclick={() => (moreDetailsOpen = !moreDetailsOpen)}
                  class="flex w-full items-center justify-between gap-2 rounded-sm text-xs leading-[calc(4/3)] text-ink-muted transition-colors duration-150 ease-out hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir motion-reduce:transition-none pointer-coarse:min-h-11"
                >
                  <span class="shrink-0 font-medium">More details</span>
                  <span class="flex min-w-0 items-center justify-end gap-1.5">
                    {#if moreDetailsSummary}
                      <span class="min-w-0 truncate text-right text-ink-faint">{moreDetailsSummary}</span>
                    {/if}
                    <CaretDownIcon
                      size={PICK_CARET_SIZE}
                      aria-hidden="true"
                      class={`shrink-0 transition-transform duration-200 ease-out motion-reduce:transition-none ${moreDetailsOpen ? "rotate-180" : ""}`}
                    />
                  </span>
                </button>

                <!-- Always mounted inside a CSS grid collapse so hiding never wipes unsaved initials edits. -->
                <div
                  class={`grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none ${
                    moreDetailsOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                  }`}
                >
                  <div class="overflow-hidden" inert={!moreDetailsOpen}>
                    <div class="flex flex-col gap-4 pt-3">
                      <dl class="flex flex-col gap-2.5">
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
                                <span class="text-ink-secondary">PD {file.pdNumber}</span>
                              {/if}
                            </dd>
                          </div>
                        {/if}

                        {#if can.reviewer || file.reviewerName}
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
                                      {#if cells.reviewer?.inProgress}
                                        <span
                                          title="Review in progress"
                                          aria-label="Review in progress"
                                          class="size-1.5 shrink-0 rounded-full bg-warning-ink"
                                        ></span>
                                      {/if}
                                      <CaretDownIcon size={PICK_CARET_SIZE} aria-hidden="true" class="shrink-0 text-ink-muted" />
                                    </button>
                                  {/snippet}
                                  {#snippet content({ close })}
                                    <ImportWriterList
                                      role="reviewer"
                                      currentWriterId={file.reviewerId ?? null}
                                      initials={file.reviewerSource !== "person" ? (cells.reviewer?.initials ?? null) : null}
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

                        {#if file.category === "final_pd" && (can.craReviewed || file.craReviewed)}
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
                      </dl>

                      {#if showInitialsSlots}
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
                    </div>
                  </div>
                </div>
              </div>
            {/if}
          </aside>
        {:else}
          <div role="status" aria-label="Loading the file" class="flex flex-1 flex-col gap-2.5 p-6">
            {#each [0, 1, 2, 3] as index (index)}
              <span class="h-3.5 w-2/3 animate-pulse rounded-sm bg-gray-50 motion-reduce:animate-none"></span>
            {/each}
          </div>
        {/if}
      </div>

      <!-- Footer stays mounted during Prev/Next loading so height and focus do not jump. -->
      {#if id !== null && fileQ.data !== null}
        {@const footerTab = file ? sheetTab : lastTab}
        {@const readyFile = Boolean(file && can && file._id === id)}
        <footer class="flex shrink-0 items-center justify-between gap-4 border-t border-line-soft bg-surface px-6 py-3.5">
          {#if footerTab === "review"}
            <div class="flex min-w-0 items-center gap-3">
              <button
                type="button"
                data-import-file-panel-delete
                disabled={!readyFile || !can?.remove || acting}
                onclick={() => void handleDelete()}
                class="inline-flex h-9 shrink-0 items-center justify-center rounded-lg border border-line bg-surface px-3.5 text-[0.8125rem] leading-[calc(18/13)] font-medium text-ink transition-colors duration-150 ease-out hover:border-danger-ink-muted/40 hover:bg-danger-surface hover:text-danger-ink-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir disabled:opacity-45 motion-reduce:transition-none pointer-coarse:min-h-11"
              >Delete</button>
              {#if readyFile && approveBlockReason}
                <span
                  id={approveReasonId}
                  data-import-file-panel-approve-reason
                  class={`min-w-0 truncate ${SHEET_SMALL} ${AMBER}`}
                  title={approveBlockReason}
                >{approveBlockReason}</span>
              {:else}
                <span class={`hidden truncate ${SHEET_SMALL} text-ink-muted sm:inline`}>
                  Moves it to Deleted. Nothing changes on any computer.
                </span>
              {/if}
            </div>

            <button
              type="button"
              data-import-file-panel-approve
              disabled={!readyFile || !canApprove || acting}
              aria-describedby={readyFile && approveBlockReason ? approveReasonId : undefined}
              onclick={() => void handleApprove()}
              class="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-action-primary px-3.5 text-[0.8125rem] leading-[calc(18/13)] font-medium text-action-primary-foreground transition-colors duration-150 ease-out hover:bg-action-primary-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir disabled:opacity-45 motion-reduce:transition-none pointer-coarse:min-h-11"
            >
              <CheckIcon size="0.875rem" aria-hidden="true" />
              <span>{hasNext ? "Approve and next" : "Approve"}</span>
            </button>
          {:else if footerTab === "deleted"}
            <span class={`${SHEET_SMALL} text-ink-muted`}>In Deleted</span>
            {#if !readyFile || can?.putBack}
              <button
                type="button"
                data-import-file-panel-put-back
                disabled={!readyFile || acting}
                onclick={() => void handlePutBack()}
                class="inline-flex h-9 shrink-0 items-center justify-center rounded-lg bg-action-primary px-3.5 text-[0.8125rem] leading-[calc(18/13)] font-medium text-action-primary-foreground transition-colors duration-150 ease-out hover:bg-action-primary-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir disabled:opacity-45 motion-reduce:transition-none pointer-coarse:min-h-11"
              >Put back</button>
            {/if}
          {:else}
            <span class={`${SHEET_SMALL} truncate text-ink-muted`}>
              {file?.companyPage ? `Approved on ${file.companyPage.name}` : "Approved"}
            </span>
            <Dialog.Close
              class="inline-flex h-9 shrink-0 items-center justify-center rounded-lg border border-line bg-surface px-3.5 text-[0.8125rem] leading-[calc(18/13)] font-medium text-ink transition-colors duration-150 ease-out hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir motion-reduce:transition-none pointer-coarse:min-h-11"
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

  .docx-preview :global(a) {
    color: var(--color-primary-selected);
    text-decoration: underline;
  }
</style>
