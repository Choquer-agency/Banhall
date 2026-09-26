<script lang="ts">
  import { isParseAbort } from "$lib/spreadsheetClient";
  import { onDestroy, onMount } from "svelte";
  import { afterNavigate, beforeNavigate, goto } from "$app/navigation";
  import { goToLogin } from "$lib/auth/goToLogin";
  import { toast } from "svelte-sonner";
  import { useAction, useConvexClient, useMutation, useQuery } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { api } from "../../../../convex/_generated/api";
  import type { Id } from "../../../../convex/_generated/dataModel";
  import { DropdownMenu, Label } from "bits-ui";
  import {
    CalendarBlankIcon,
    CaretDownIcon,
    CheckIcon,
    ClipboardTextIcon,
    PlusIcon,
    UploadSimpleIcon,
    WarningCircleIcon,
    XIcon,
  } from "phosphor-svelte";
  import Button from "$lib/components/ui/Button.svelte";
  import Spinner from "$lib/components/ui/Spinner.svelte";
  import FileIcon from "$lib/components/ui/FileIcon.svelte";
  import StatusCallout from "$lib/components/ui/StatusCallout.svelte";
  import AuroraMark from "$lib/components/ui/AuroraMark.svelte";
  import Tooltip from "$lib/components/ui/Tooltip.svelte";
  import Checkbox from "$lib/components/ui/Checkbox.svelte";
  import SelectInput from "$lib/components/ui/SelectInput.svelte";
  import DatePicker from "$lib/components/ui/DatePicker.svelte";
  import IndustrySelect from "$lib/components/ui/IndustrySelect.svelte";
  import ScienceCodePicker from "$lib/components/project/details/ScienceCodePicker.svelte";
  import { fiscalYearParts, formatEdited, scienceCodeDisplay } from "$lib/components/project/details/detailsFormat";
  import { isSupportedFile, parseFileToText, SUPPORTED_ACCEPT, SUPPORTED_LABEL } from "$lib/parseDocument";
  import { CONTEXT_CATEGORIES, type ContextCategoryId } from "$lib/contextCategories";
  import { MAX_TOTAL_TRANSCRIPT_CHARS, MAX_TRANSCRIPTS_PER_PROJECT } from "../../../../convex/lib/transcripts";
  import { userErrorMessage } from "$lib/errors";
  import { uploadOriginal as uploadOriginalTransport } from "$lib/uploads/originalUpload";
  import { appendOutbox } from "$lib/uploads/attemptOutbox";
  import { shouldDropOutboxEntry, withUploadTimeout } from "$lib/uploads/outboxFlush";
  import { guessFileType } from "$lib/components/project-new/shared";
  import TagPicker from "$lib/components/project-new/TagPicker.svelte";
  import NewProjectSection from "$lib/components/project-new/NewProjectSection.svelte";
  import ClientCombobox from "$lib/components/project-new/ClientCombobox.svelte";
  import WriteModeCards from "$lib/components/project-new/WriteModeCards.svelte";
  import StartChecklist from "$lib/components/project-new/StartChecklist.svelte";
  import SupportingDocCard from "$lib/components/project-new/SupportingDocCard.svelte";
  import SupportingDocPreview from "$lib/components/project-new/SupportingDocPreview.svelte";
  import ReviewPdCard from "$lib/components/project-new/ReviewPdCard.svelte";
  import {
    SupportingDocs,
    CATEGORY_LABELS,
    CATEGORY_ORDER,
    hasReadableText,
    readingEtaSeconds,
    supportingMeta,
    countWords,
    type SupportingCategory,
    type SupportingDoc,
  } from "$lib/components/project-new/supportingDocs.svelte";
  import {
    buildChecklist,
    startBlocked,
    startButtonLabel,
    NO_SOURCE_MESSAGE,
  } from "$lib/components/project-new/newProjectChecklist";
  import StartRunDialog, {
    type StartRunExcluded,
    type StartRunSource,
  } from "$lib/components/generation/StartRunDialog.svelte";
  import { parsePdFilename } from "../../../../shared/pdFilename";
  import { detectPdSections as detectSections } from "../../../../shared/pdSectionDetect";
  import {
    isTranscriptFileName,
    TRANSCRIPT_ACCEPT,
    TRANSCRIPT_FORMAT_LABELS,
    type TranscriptSourceFormat,
  } from "../../../../shared/transcriptParse";
  import {
    readPastedTranscript,
    readTranscriptFile,
    releaseOriginalsOnFailure,
    TranscriptFileError,
    uploadTranscriptOriginal,
  } from "$lib/transcriptUpload";
  import { comparePairFromSlots } from "../../../../shared/generationModels";
  import { modelLabelFor, pickerModels, defaultModelIdFor } from "$lib/modelPicker";
  import ComparePairPicker from "$lib/components/generation/ComparePairPicker.svelte";
  import SingleModelPicker from "$lib/components/generation/SingleModelPicker.svelte";
  import { SvelteMap, SvelteSet } from "svelte/reactivity";
  import { dashboardFiscalYear } from "../../../../shared/dashboardProjection";
  import {
    isPreviousYearDocument,
    PREVIOUS_YEAR_ONLY_MESSAGE,
    PREVIOUS_YEAR_TRANSCRIPTS_ONLY_MESSAGE,
    previousYearReportHeader,
  } from "../../../../shared/previousYear";
  import { WORKFLOW_STAGE_LABELS } from "../../../../shared/workflowLabels";
  import WorkspaceChrome from "$lib/components/workspace/WorkspaceChrome.svelte";
  import { takeProjectStart } from "$lib/workspace/projectIntentHandoff";
  import { parseDraftModeParam } from "$lib/workspace/projectDuplicate";
  import { page } from "$app/state";
  import { createRequestId } from "$lib/requestId";
  import { registerSaveHold, SAVE_HOLD_ESCAPE_MS } from "$lib/workspace/saveHold";

  const extractionLifetime = new AbortController();
  onDestroy(() => extractionLifetime.abort());

  const auth = useAuth();
  const client = useConvexClient();
  const createProject = useMutation(api.projects.createProject);
  const generateReport = useMutation(api.generations.requestGeneration);
  const startPdReview = useMutation(api.pdReviews.startPdReview);
  const uploadDocument = useMutation(api.documents.uploadDocument);
  const generateUploadUrl = useMutation(api.documents.generateUploadUrl);
  const discardTranscriptOriginals = useMutation(api.transcripts.discardTranscriptOriginals);
  const claimUpload = useMutation(api.documents.claimUpload);
  const recordUploadAttempts = useMutation(api.uploadAttempts.recordUploadAttempts);
  const user = useQuery(api.users.getCurrentUser, () => (auth.isAuthenticated ? {} : "skip"));
  // BNH-22: team roster for the interviewer picker.
  const teamQ = useQuery(api.users.listTeam, () => (auth.isAuthenticated ? {} : "skip"));
  const interviewerOptions = $derived([
    { value: "", label: "Not set" },
    ...(teamQ.data ?? []).map((member) => ({
      value: member.id,
      label: member.email && member.email !== member.name ? `${member.name} (${member.email})` : member.name,
    })),
  ]);
  // BNH-35: available tags for the tag selector.
  const tagsQ = useQuery(api.tags.listTags, () => (auth.isAuthenticated ? {} : "skip"));
  const allTags = $derived(tagsQ.data ?? []);
  // Client suggestions: the recorded client names (first page, D1 read).
  const companiesQ = useQuery(api.dashboard.listCompanies, () =>
    auth.isAuthenticated ? { paginationOpts: { numItems: 40, cursor: null } } : "skip"
  );
  const clientSuggestions = $derived(
    ((companiesQ.data as { page?: Array<{ clientName: string }> } | undefined)?.page ?? []).map(
      (row) => row.clientName
    )
  );

  // BNH-39: write a new PD from a transcript, or review an existing written PD.
  let mode = $state<"generate" | "review">("generate");
  // Round 2 (E1): Step by step is the default; a card duplicate's drafts= still decides.
  let candidateMode = $state<"compare" | "single" | "iterative">("iterative");
  let singleModelId = $state<string>("");
  // Model catalog: the selectable models, the writing role's default and the
  // planning and pd_review models the start dialog names (decision 52).
  const modelCapabilitiesQ = useQuery(api.providerReadiness.getCapabilities, () => ({}));
  // Compare mode runs exactly 2 models: two slots, each a model or Random.
  let compareSlotA = $state("");
  let compareSlotB = $state("");
  // BNH-10: routes Brain retrieval. Only admins can extend the vocabulary.
  let industry = $state("");
  let scienceCode = $state("");
  let scienceOpen = $state(false);
  let title = $state("");
  let sredTitle = $state(""); // BNH-23: formal SR&ED title
  let clientName = $state("");
  // Flag 2026-08-14 (Michael): settable at creation, not only post-generation.
  let projectNumber = $state("");
  const projectNumberValid = $derived(
    !projectNumber.trim() || /^(?:[1-9][0-9]?[A-Za-z]?|[A-Za-z])$/.test(projectNumber.trim())
  );
  let interviewerUserId = $state("");
  // BNH-22: client-side interview participants (multi-entry).
  let interviewees = $state<string[]>([]);
  let intervieweeDraft = $state("");
  // BNH-35: selected tag ids.
  let selectedTagIds = $state<string[]>([]);
  let fiscalYearEnd = $state(""); // yyyy-mm-dd (BNH-36)
  const FISCAL_QUICK_PICKS = [
    { label: "Mar 31", month: 3, day: 31 },
    { label: "Jun 30", month: 6, day: 30 },
    { label: "Sep 30", month: 9, day: 30 },
    { label: "Dec 31", month: 12, day: 31 },
  ] as const;
  const fiscalDisplay = $derived(
    /^\d{4}-\d{2}-\d{2}$/.test(fiscalYearEnd)
      ? fiscalYearParts(new Date(`${fiscalYearEnd}T00:00:00`).getTime())
      : null
  );
  const scienceDisplay = $derived(scienceCodeDisplay(scienceCode || null));

  function addInterviewee() {
    const name = intervieweeDraft.trim();
    if (!name) return;
    if (!interviewees.some((n) => n.toLowerCase() === name.toLowerCase())) {
      interviewees = [...interviewees, name];
    }
    intervieweeDraft = "";
  }
  function removeInterviewee(idx: number) {
    interviewees = interviewees.filter((_, i) => i !== idx);
  }

  // A project carries an ordered list of transcripts. An item is either text
  // this browser holds (an extracted .docx, or a paste) or a reference to a
  // row on the source project, copied server-side by the duplicate flow.
  type TranscriptItem = {
    id: string;
    label: string;
    wordCount: number;
    charCount: number;
    // 2026-09-24: the detected format, and the file its text came from (its
    // original bytes are uploaded with the project).
    format?: TranscriptSourceFormat;
    file?: File;
    source:
      | { kind: "upload" | "paste"; content: string }
      // A copied row stays in the list when unticked (owner decision 35,
      // 2026-09-25), so the writer can tick it again.
      | { kind: "copy"; fromTranscriptId: Id<"transcripts">; included: boolean };
  };
  let transcriptItems = $state<TranscriptItem[]>([]);
  let pasteDraft = $state("");
  let pasteOpen = $state(false);
  let transcriptItemSeq = 0;

  function addTextTranscript(
    kind: "upload" | "paste",
    label: string,
    content: string,
    extra: { format?: TranscriptSourceFormat; file?: File } = {}
  ) {
    transcriptItems = [
      ...transcriptItems,
      {
        id: `t-${transcriptItemSeq++}`,
        label,
        wordCount: countWords(content),
        charCount: content.length,
        ...extra,
        source: { kind, content },
      },
    ];
  }

  function addPastedTranscript() {
    const text = pasteDraft.trim();
    if (!text) return;
    const pastedCount = transcriptItems.filter((item) => item.source.kind === "paste").length + 1;
    const pasted = readPastedTranscript(text);
    addTextTranscript("paste", `Pasted transcript ${pastedCount}`, pasted.content, { format: pasted.format });
    pasteDraft = "";
    pasteOpen = false;
  }

  function removeTranscriptItem(id: string) {
    transcriptItems = transcriptItems.filter((item) => item.id !== id);
  }

  function setTranscriptIncluded(id: string, included: boolean) {
    transcriptItems = transcriptItems.map((item) =>
      item.id === id && item.source.kind === "copy" ? { ...item, source: { ...item.source, included } } : item
    );
  }

  const isTranscriptIncluded = (item: TranscriptItem) => item.source.kind !== "copy" || item.source.included;
  // What createProject will receive: an unticked copy stays behind.
  const includedTranscriptItems = $derived(transcriptItems.filter(isTranscriptIncluded));

  // Duplicate flow: /project/new?from=<projectId> prefills the page from an
  // existing project (setup + transcript now; documents copied on commit).
  const fromProjectId = page.url.searchParams.get("from");

  // Duplicate from a project card or row (2026-09-25): `drafts=<mode>`
  // preselects that Drafts mode (only an exact Drafts mode id counts;
  // anything else is ignored). A duplicate that carries it is a duplicate to
  // draft again: the copy brings the inputs (transcripts, files and their
  // originals, identity evidence) but not the old report, nor PD reviews
  // unless this is a Review PD project, and then the selected generation or
  // review starts exactly as for a new project. The plain `?from=` link (the
  // old dashboard's Duplicate) stays a full clone that starts nothing.
  const draftsParam = parseDraftModeParam(page.url.searchParams.get("drafts"));
  const generateAfterDuplicate = Boolean(fromProjectId && draftsParam);
  if (draftsParam && !fromProjectId) candidateMode = draftsParam;

  // Home's large start-project prompt is navigation/prefill, not generation:
  // it hands a short editable intent across one immediate client-side route
  // transition. Duplicate remains the richer source and therefore wins.
  const projectStartPrefill = takeProjectStart();
  let projectStartPrefillApplied = $state(false);
  $effect(() => {
    if (fromProjectId || projectStartPrefillApplied) return;
    if (!projectStartPrefill.title && !projectStartPrefill.transcriptText) return;
    projectStartPrefillApplied = true;
    if (!title && projectStartPrefill.title) title = projectStartPrefill.title;
    if (!transcriptItems.length && projectStartPrefill.transcriptText) {
      // A file handed over from Home is already an item; loose text stays in
      // the paste box so the writer can still edit it before starting.
      if (projectStartPrefill.transcriptFileName) {
        addTextTranscript("upload", projectStartPrefill.transcriptFileName, projectStartPrefill.transcriptText);
      } else {
        pasteDraft = projectStartPrefill.transcriptText;
        pasteOpen = true;
      }
    }
  });

  // Client-scoped creation (2026-08-06 second amendment):
  // /project/new?client=<recorded name> prefills the free-text client name
  // from a client lane/section header. Editable text only, never a durable
  // Client reference; creation still always enters intake with the creator
  // as Owner. The duplicate flow's richer prefill wins when both are set.
  const clientPrefill = page.url.searchParams.get("client")?.trim() ?? "";
  let clientPrefillApplied = $state(false);
  $effect(() => {
    if (!clientPrefill || fromProjectId || clientPrefillApplied) return;
    clientPrefillApplied = true;
    if (!clientName) clientName = clientPrefill;
  });

  // Fiscal-year prefill (client/fiscal group quick-create, 2026-08-11):
  // /project/new?fye=YYYY-MM-DD prefills the optional fiscal year-end
  // alongside the client prefill. Strictly validated before applying;
  // anything else is ignored. The duplicate flow's richer prefill wins, and
  // a value the user already typed is never overwritten.
  const fyePrefill = page.url.searchParams.get("fye")?.trim() ?? "";
  let fyePrefillApplied = $state(false);
  $effect(() => {
    if (!fyePrefill || fromProjectId || fyePrefillApplied) return;
    fyePrefillApplied = true;
    if (!fiscalYearEnd && /^\d{4}-\d{2}-\d{2}$/.test(fyePrefill)) fiscalYearEnd = fyePrefill;
  });
  const sourceProjectQ = useQuery(api.projects.getProject, () =>
    auth.isAuthenticated && fromProjectId ? { projectId: fromProjectId as Id<"projects"> } : "skip"
  );
  // Metadata only: a duplicate never downloads transcript text to re-upload
  // it, the server copies the rows by reference.
  const sourceTranscriptsQ = useQuery(api.transcripts.listTranscripts, () =>
    auth.isAuthenticated && fromProjectId ? { projectId: fromProjectId as Id<"projects"> } : "skip"
  );
  // What the copy will bring along besides the transcripts: the source's
  // files, listed so the writer sees them before creating. The copy itself
  // still happens on commit (projectDuplication.copyProjectContent).
  const sourceDocumentsQ = useQuery(api.documents.listDocuments, () =>
    auth.isAuthenticated && fromProjectId ? { projectId: fromProjectId as Id<"projects"> } : "skip"
  );
  // A duplicate to draft again leaves PD reviews and the written PDs they
  // reviewed behind unless it is a Review PD project.
  const copyReviews = $derived(!generateAfterDuplicate || mode === "review");
  const copiedDocuments = $derived(
    fromProjectId
      ? (sourceDocumentsQ.data ?? []).filter((document) => copyReviews || document.source !== "review_pd")
      : []
  );
  type CopiedDocument = (typeof copiedDocuments)[number];

  // Fiscal years as the server reads them (dashboardFiscalYear on the stored
  // time), so the page and copyProjectContent agree on "later".
  const sourceFiscalYear = $derived(dashboardFiscalYear(sourceProjectQ.data?.fiscalYearEnd));
  const fiscalYearEndMs = $derived(
    /^\d{4}-\d{2}-\d{2}$/.test(fiscalYearEnd) ? new Date(`${fiscalYearEnd}T00:00:00`).getTime() : null
  );
  const newFiscalYear = $derived(fiscalYearEndMs === null ? null : dashboardFiscalYear(fiscalYearEndMs));
  const fiscalYearMovedForward = $derived(
    sourceFiscalYear !== null && newFiscalYear !== null && newFiscalYear > sourceFiscalYear
  );

  // Owner decision 35 (2026-09-25): every copied file has a tick box, ticked
  // by default, and anything unticked stays behind. A PD ported in for the
  // original's own year starts unticked on a same-year duplicate. Only the
  // writer's own choices are stored, so that default follows the fiscal year.
  const documentChoices = new SvelteMap<string, boolean>();
  const isPortedSameYear = (document: CopiedDocument) =>
    document.source === "ingestion_port" && !fiscalYearMovedForward;
  const isDocumentIncluded = (document: CopiedDocument) =>
    documentChoices.get(document._id) ?? !isPortedSameYear(document);
  // A leave-out list rather than a copy list: while the list is still
  // loading it is empty, and an empty list copies everything.
  const excludedDocumentIds = $derived(
    copiedDocuments.filter((document) => !isDocumentIncluded(document)).map((document) => document._id)
  );

  // Last year's report (owner decision 35): a card duplicate in Generate PD
  // can bring the original's report in as a Previous-year report, but only
  // once the fiscal year moves forward. The server applies the same rule.
  const sourceReportQ = useQuery(api.projects.getDuplicateSourceReport, () =>
    auth.isAuthenticated && fromProjectId && generateAfterDuplicate
      ? { projectId: fromProjectId as Id<"projects"> }
      : "skip"
  );
  const offerPreviousYearReport = $derived(
    generateAfterDuplicate && mode === "generate" && fiscalYearMovedForward && sourceReportQ.data?.hasText === true
  );
  let previousYearReportIncluded = $state(true);
  const sendPreviousYearReport = $derived(offerPreviousYearReport && previousYearReportIncluded);

  // Same grouping and order as the project's files; written PDs under
  // review, then other files the source kept without a category (chat
  // uploads), close the list.
  const copiedDocumentGroups = $derived.by(() => {
    const known = new Set<string>(CONTEXT_CATEGORIES.map((category) => category.id));
    const groups = CONTEXT_CATEGORIES.map((category) => ({
      id: category.id as string,
      label: category.label,
      files: copiedDocuments.filter((document) => document.category === category.id),
    }));
    groups.push({
      id: "review_pd",
      label: "Written PDs reviewed",
      files: copiedDocuments.filter(
        (document) => document.source === "review_pd" && (!document.category || !known.has(document.category))
      ),
    });
    groups.push({
      id: "uncategorized",
      label: "Chat and other uploads",
      files: copiedDocuments.filter(
        (document) => document.source !== "review_pd" && (!document.category || !known.has(document.category))
      ),
    });
    return groups.filter(
      (group) => group.files.length > 0 || (group.id === "previous_pd" && offerPreviousYearReport)
    );
  });
  const groupHasReport = (groupId: string) => groupId === "previous_pd" && offerPreviousYearReport;
  function groupTicks(group: { id: string; files: CopiedDocument[] }) {
    const ticks = group.files.map(isDocumentIncluded);
    if (groupHasReport(group.id)) ticks.push(previousYearReportIncluded);
    return ticks;
  }
  function setGroupIncluded(group: { id: string; files: CopiedDocument[] }, included: boolean) {
    for (const document of group.files) documentChoices.set(document._id, included);
    if (groupHasReport(group.id)) previousYearReportIncluded = included;
  }
  const copiedTotalCount = $derived(copiedDocuments.length + (offerPreviousYearReport ? 1 : 0));
  const copiedIncludedCount = $derived(
    copiedDocuments.length - excludedDocumentIds.length + (sendPreviousYearReport ? 1 : 0)
  );
  const copiedCountLabel = $derived(
    copiedIncludedCount === copiedTotalCount ? `${copiedTotalCount}` : `${copiedIncludedCount} of ${copiedTotalCount}`
  );
  const copiedFilesNote = $derived(
    !generateAfterDuplicate
      ? "Ticked files are copied when you create the project."
      : mode === "generate"
        ? `Ticked files are copied into the new project and read for the draft. ${
            offerPreviousYearReport
              ? "The old report can come along as last year's report."
              : "The old report stays with the original."
          }`
        : "Ticked files are copied into the new project as context for the review. The old report stays with the original."
  );
  const anythingUnticked = $derived(
    excludedDocumentIds.length > 0 ||
      transcriptItems.some((item) => !isTranscriptIncluded(item)) ||
      (offerPreviousYearReport && !previousYearReportIncluded)
  );
  const copySourceTitle = $derived(sourceProjectQ.data?.title ?? "the original project");
  // Review D-6: a tick row is a 44px touch target on touch screens, and a
  // tap anywhere on it (the name included) toggles its box. The label's
  // ::after covers the row; the box sits above it and stays clickable.
  const TICK_ROW = "relative flex min-w-0 items-center gap-2 pointer-coarse:min-h-11";
  const STRETCHED_LABEL = "after:absolute after:inset-0";
  const copyProjectContent = useAction(api.projectDuplication.copyProjectContent);
  // Owner decision 35 (2026-09-25): a copy of a Review PD project stays a
  // Review PD project, so Write a new PD, and with it Step by step, is not
  // offered.
  const modeLocked = $derived(Boolean(fromProjectId) && sourceProjectQ.data?.mode === "review");

  let prefilled = $state(false);
  $effect(() => {
    const source = sourceProjectQ?.data;
    if (!fromProjectId || !source || prefilled) return;
    prefilled = true;
    title = `${source.title} (copy)`;
    clientName = source.clientName;
    sredTitle = source.sredTitle ?? "";
    industry = source.industry ?? "";
    scienceCode = source.scienceCode ?? "";
    mode = source.mode ?? "generate";
    // Drafts modes belong to Write a new PD. A review project stays a review
    // project; its Drafts choice only shows if the writer switches mode.
    if (draftsParam) candidateMode = draftsParam;
    interviewerUserId = source.interviewerUserId ?? "";
    interviewees = source.interviewees ?? [];
    selectedTagIds = (source.tagIds ?? []) as string[];
    if (source.fiscalYearEnd) fiscalYearEnd = new Date(source.fiscalYearEnd).toISOString().slice(0, 10);
  });
  let transcriptsPrefilled = $state(false);
  $effect(() => {
    const rows = sourceTranscriptsQ?.data;
    if (!fromProjectId || !rows?.length || transcriptsPrefilled) return;
    // Arrival is the one chance to prefill: a writer who already built a list
    // keeps it, and keeps it after removing an item.
    transcriptsPrefilled = true;
    if (transcriptItems.length) return;
    transcriptItems = rows.map((row) => ({
      id: `t-${transcriptItemSeq++}`,
      label: row.label,
      wordCount: row.wordCount,
      charCount: row.charCount,
      ...(row.sourceFormat ? { format: row.sourceFormat } : {}),
      source: { kind: "copy" as const, fromTranscriptId: row._id, included: true },
    }));
  });

  // Supporting documents are read as soon as they are added (E1).
  const baseYear = new Date().getFullYear() - 1;
  const docs = new SupportingDocs({
    lifetime: extractionLifetime.signal,
    defaultYear: () => (newFiscalYear !== null ? newFiscalYear - 1 : baseYear),
  });
  // One optional note per previous-year fiscal year (BNH-9 / BNH-26): it is
  // stored with that year's reports, or on its own when none held text.
  const yearNotes = new SvelteMap<number, string>();
  const previousYears = $derived(
    [...new Set(docs.items.filter((doc) => doc.category === "previous_pd").map((doc) => doc.year))].sort(
      (a, b) => b - a
    )
  );
  const yearChoices = $derived.by(() => {
    const top = (newFiscalYear ?? new Date().getFullYear()) - 1;
    return Array.from({ length: 8 }, (_, index) => top - index);
  });
  const docCategories = $derived<SupportingCategory[]>(
    mode === "review" ? ["transcript", ...CATEGORY_ORDER] : [...CATEGORY_ORDER]
  );
  // In Review a written PD, transcripts come in through Supporting documents
  // with the Transcript chip; they are stored as transcripts.
  const supportingTranscripts = $derived(
    mode === "review" ? docs.items.filter((doc) => doc.category === "transcript") : []
  );
  const supportingFiles = $derived(docs.items.filter((doc) => doc.category !== "transcript" || mode !== "review"));

  // E5: a file that is not a transcript replaces the drop zone with a red box;
  // one that holds no text shows as its own red row with Replace file.
  let transcriptInput: HTMLInputElement | null = $state(null);
  let transcriptDragOver = $state(false);
  let parsingTranscript = $state<string | null>(null);
  let wrongTranscriptFile = $state<{ name: string; video: boolean } | null>(null);
  type TranscriptProblem = { id: string; name: string; text: string };
  let transcriptProblems = $state<TranscriptProblem[]>([]);
  let problemSeq = 0;
  let replacingProblemId: string | null = null;
  const VIDEO_OR_AUDIO = /\.(mp4|mov|m4v|avi|mkv|webm|wmv|mp3|m4a|wav|aac|ogg|flac)$/i;

  // Transcripts arrive as Teams or Otter .docx, WebVTT, SubRip or text
  // exports (2026-09-24, the transcript method). Anything else belongs in
  // Supporting documents; the paste flow stays as the fallback. Each imported
  // file becomes a row with its detected format; the text stays behind the
  // scenes.
  async function handleTranscriptFiles(files: File[]) {
    const wrong = files.find((file) => !isTranscriptFileName(file.name));
    wrongTranscriptFile = wrong ? { name: wrong.name, video: VIDEO_OR_AUDIO.test(wrong.name) } : null;
    const accepted = files.filter((file) => isTranscriptFileName(file.name));
    for (const file of accepted) {
      parsingTranscript = file.name;
      try {
        const read = await readTranscriptFile(file);
        addTextTranscript("upload", read.label, read.content, { format: read.format, file });
        if (replacingProblemId) {
          transcriptProblems = transcriptProblems.filter((problem) => problem.id !== replacingProblemId);
        }
      } catch (error) {
        const text =
          error instanceof TranscriptFileError
            ? error.problem === "empty"
              ? "We could not find any text in this file."
              : error.message
            : `Couldn't read ${file.name}. Try another file.`;
        if (replacingProblemId) {
          transcriptProblems = transcriptProblems.map((problem) =>
            problem.id === replacingProblemId ? { ...problem, name: file.name, text } : problem
          );
        } else {
          transcriptProblems = [...transcriptProblems, { id: `p-${problemSeq++}`, name: file.name, text }];
        }
      } finally {
        parsingTranscript = null;
      }
    }
    replacingProblemId = null;
  }

  function replaceProblem(id: string) {
    replacingProblemId = id;
    transcriptInput?.click();
  }

  // BNH-39 review mode: the existing written PD to review (required), read at once.
  let pdInput: HTMLInputElement | null = $state(null);
  let pdDragOver = $state(false);
  let parsingPd = $state<string | null>(null);
  let pdFileError = $state("");
  let pdDoc = $state<{ name: string; content: string; file: File; pageOffsets?: number[] } | null>(null);
  let pdTitleFromName = $state(false);

  async function handlePdFile(file: File) {
    if (!isSupportedFile(file.name)) {
      pdFileError = `We cannot read ${file.name}. Use ${SUPPORTED_LABEL}.`;
      return;
    }
    pdFileError = "";
    parsingPd = file.name;
    try {
      const parsed = await parseFileToText(file, { signal: extractionLifetime.signal });
      const text = parsed.content.trim();
      if (!text) {
        pdFileError = `We could not find any text in ${file.name}.`;
      } else {
        pdDoc = { name: file.name, content: text, file, pageOffsets: parsed.pageOffsets };
        if (mode === "review") prefillFromPdFileName(file.name);
      }
    } catch (error) {
      if (!isParseAbort(error)) pdFileError = `We could not read ${file.name}. Try another file.`;
    } finally {
      parsingPd = null;
    }
  }

  // PD file-name prefill (writer request 2026-09-09): the firm names PDs
  // "03 3GAMarine 2025-12-31 R1.LR.mo ProjectTitle.docx", so a dropped PD
  // already carries the project number, client, fiscal year-end and title.
  // Only a field the writer has left empty is filled, never one they typed.
  // The initials are shown in the hint only: the domain contract forbids
  // inferring the Owner or a writer from metadata.
  let pdNameHint = $state("");
  function prefillFromPdFileName(fileName: string) {
    pdNameHint = "";
    pdTitleFromName = false;
    const parsed = parsePdFilename(fileName);
    if (!parsed) return;
    const filled: string[] = [];
    if (parsed.projectNumber && !projectNumber.trim()) {
      projectNumber = parsed.projectNumber;
      filled.push(`project ${parsed.projectNumber}`);
    }
    if (parsed.clientName && !clientName.trim()) {
      clientName = parsed.clientName;
      filled.push(parsed.clientName);
    }
    if (parsed.fiscalYearEnd && !fiscalYearEnd) {
      fiscalYearEnd = parsed.fiscalYearEnd;
      filled.push(`FYE ${parsed.fiscalYearEnd}`);
    }
    if (parsed.title && (!sredTitle.trim() || !title.trim())) {
      if (!sredTitle.trim()) sredTitle = parsed.title;
      if (!title.trim()) {
        title = parsed.title;
        pdTitleFromName = true;
      }
      filled.push("title");
    }
    if (!filled.length) return;
    if (parsed.revision) filled.push(`R${parsed.revision}`);
    if (parsed.writerInitials) filled.push(`writer ${parsed.writerInitials}`);
    if (parsed.reviewerInitials) filled.push(`reviewer ${parsed.reviewerInitials}`);
    pdNameHint = `Filled from the file name: ${filled.join(", ")}`;
  }

  let committing = $state(false);
  // When the current save began, for the way out of a stalled one.
  let commitStartedAt = 0;
  let progress = $state("");
  // Set when the page itself navigates away (to the new project or to sign
  // in), so the guard below lets that navigation through.
  let leaving = false;

  // Review D-3: leaving while the project saves would destroy the page
  // mid-save (a new query remounts it) and strand a half-made project. Hold
  // every other navigation until the save opens the project. The root
  // layout's deploy-update reload asks the same hold.
  onMount(() => registerSaveHold(() => committing && !leaving));
  beforeNavigate((navigation) => {
    if (!committing || leaving) return;
    navigation.cancel();
    // Closing the tab or reloading: the browser asks the writer to confirm.
    if (navigation.type === "leave") return;
    const target = navigation.to?.url;
    if (target && Date.now() - commitStartedAt >= SAVE_HOLD_ESCAPE_MS) {
      // A save this slow may have stalled (offline, for example), so the
      // writer can go. Leaving for another page destroys the page, which
      // stops the save before it starts a draft or a PD review.
      toast.warning(
        "Saving is taking longer than usual. If you leave now, the project may be only partly saved and its draft may not start.",
        {
          duration: 10_000,
          action: {
            label: "Leave anyway",
            onClick: () => leaveTo(`${target.pathname}${target.search}${target.hash}`),
          },
        }
      );
      return;
    }
    toast.info("Your project is still being saved. It opens when it is ready.");
  });

  function leaveTo(path: string) {
    leaving = true;
    goto(path);
  }

  $effect(() => {
    if (!auth.isLoading && !auth.isAuthenticated) {
      leaving = true;
      goToLogin();
    }
  });

  // Cancel leaves for the page the writer came from, else My work. While a
  // save holds navigation, the hold rules above apply.
  let cameFrom: string | null = null;
  afterNavigate(({ from }) => {
    if (from?.url && from.url.pathname !== page.url.pathname) cameFrom = `${from.url.pathname}${from.url.search}`;
  });
  function cancel() {
    goto(cameFrom ?? "/my-work");
  }

  const draftWordCount = $derived(countWords(pasteDraft));
  const transcriptWordCount = $derived(
    includedTranscriptItems.reduce((total, item) => total + item.wordCount, 0) +
      supportingTranscripts.reduce((total, doc) => total + doc.words, 0) +
      draftWordCount
  );
  const transcriptCharCount = $derived(
    includedTranscriptItems.reduce((total, item) => total + item.charCount, 0) +
      supportingTranscripts.reduce((total, doc) => total + (doc.transcript?.content.length ?? 0), 0) +
      pasteDraft.trim().length
  );
  // Server caps, checked here so the writer hears about it before the upload
  // loop runs (convex/lib/transcripts.ts holds the one definition).
  const transcriptCountForSubmit = $derived(
    includedTranscriptItems.length + supportingTranscripts.length + (pasteDraft.trim() ? 1 : 0)
  );
  const transcriptsOverCap = $derived(
    transcriptCountForSubmit > MAX_TRANSCRIPTS_PER_PROJECT || transcriptCharCount > MAX_TOTAL_TRANSCRIPT_CHARS
  );
  const overCapMessage = $derived(
    transcriptsOverCap
      ? `A project takes at most ${MAX_TRANSCRIPTS_PER_PROJECT} transcripts and ${(MAX_TOTAL_TRANSCRIPT_CHARS / 1000).toLocaleString()}k characters of transcript text. Remove one to start.`
      : null
  );

  // The sources a draft would read, after the start dialog's leave-out lists
  // (decision 56). The previous-year rule (decision 42) and the readable-
  // source rule run on what remains; the server checks both again.
  type Sources = { hasAny: boolean; hasCurrent: boolean; previousYearMessage: string | null };
  function sourcesAfter(excluded: StartRunExcluded = { transcriptIds: [], documentIds: [] }): Sources {
    const leftOut = new Set([...excluded.transcriptIds, ...excluded.documentIds]);
    const transcripts = [
      ...includedTranscriptItems.map((item) => ({ key: `t:${item.id}`, copy: item.source.kind === "copy" })),
      ...supportingTranscripts.map((doc) => ({ key: `d:${doc.id}`, copy: false })),
      ...(pasteDraft.trim() ? [{ key: "t:draft", copy: false }] : []),
    ].filter((item) => !leftOut.has(item.key));
    // Decision 42, lead note of 2026-09-25: once the fiscal year moves
    // forward, the transcripts copied from the original are last year's too.
    const lastYearTranscripts = fiscalYearMovedForward ? transcripts.filter((item) => item.copy).length : 0;
    const ownFiles = supportingFiles.filter(
      (doc) => doc.category !== "transcript" && !leftOut.has(`d:${doc.id}`) && hasReadableText(doc)
    );
    const currentOwn = ownFiles.filter((doc) => doc.category !== "previous_pd").length;
    const previousOwn = ownFiles.filter((doc) => doc.category === "previous_pd").length;
    // Ticked copied text the AI can read counts as a source. Same test as the
    // server's (non-archived, non-empty); the old report has text by definition.
    const copiedReadable = copiedDocuments.filter(
      (document) =>
        isDocumentIncluded(document) &&
        !document.archived &&
        document.sizeChars > 0 &&
        !leftOut.has(`c:${document._id}`)
    );
    const currentCopied = copiedReadable.filter((document) => !isPreviousYearDocument(document)).length;
    const previousCopied =
      copiedReadable.filter(isPreviousYearDocument).length + (sendPreviousYearReport ? 1 : 0);
    const notes = previousYears.some((year) => (yearNotes.get(year) ?? "").trim()) ? 1 : 0;
    const hasCurrent = transcripts.length > lastYearTranscripts || currentOwn > 0 || currentCopied > 0;
    const hasAny = mode === "review" || transcripts.length > 0 || hasCurrent || previousOwn + notes + previousCopied > 0;
    const onlyPrevious = mode === "generate" && hasAny && !hasCurrent;
    return {
      hasAny,
      hasCurrent,
      previousYearMessage: onlyPrevious
        ? lastYearTranscripts > 0
          ? PREVIOUS_YEAR_TRANSCRIPTS_ONLY_MESSAGE
          : PREVIOUS_YEAR_ONLY_MESSAGE
        : null,
    };
  }
  const sources = $derived(sourcesAfter());

  // E6: the same client, title and fiscal year as an existing project. The
  // query runs 400ms after the writer stops typing; "It is a different
  // project" dismisses the warning for this client and title.
  let duplicateArgs = $state<{ clientName: string; title: string; fiscalYearEnd?: number } | null>(null);
  $effect(() => {
    const next = {
      clientName: clientName.trim(),
      title: title.trim(),
      ...(fiscalYearEndMs !== null ? { fiscalYearEnd: fiscalYearEndMs } : {}),
    };
    const timer = setTimeout(() => {
      duplicateArgs = next.clientName && next.title ? next : null;
    }, 400);
    return () => clearTimeout(timer);
  });
  const sameProjectQ = useQuery(api.projects.findSameProject, () =>
    auth.isAuthenticated && duplicateArgs && !fromProjectId ? duplicateArgs : "skip"
  );
  const dismissedDuplicates = new SvelteSet<string>();
  const duplicateKey = $derived(`${clientName.trim().toLowerCase()}|${title.trim().toLowerCase()}`);
  const sameProject = $derived(
    sameProjectQ.data && duplicateArgs && !dismissedDuplicates.has(duplicateKey) ? sameProjectQ.data : null
  );
  const sameProjectText = $derived.by(() => {
    if (!sameProject) return "";
    const stage = sameProject.workflowStage ? WORKFLOW_STAGE_LABELS[sameProject.workflowStage] : null;
    const edited = formatEdited(sameProject.updatedAt, Date.now());
    return [
      sameProject.title,
      stage,
      sameProject.ownerName ? `owned by ${sameProject.ownerName}` : null,
      `edited ${edited.charAt(0).toLowerCase()}${edited.slice(1)}.`,
    ]
      .filter(Boolean)
      .join(", ");
  });

  const readingCount = $derived(supportingFiles.filter((doc) => doc.status === "reading").length);
  const checklist = $derived(
    buildChecklist({
      mode,
      clientName,
      title,
      transcripts: { count: transcriptCountForSubmit, words: transcriptWordCount },
      unreadableTranscripts: transcriptProblems.length,
      fiscalYearSet: Boolean(fiscalYearEnd),
      scienceCodeSet: Boolean(scienceCode),
      supporting: { count: supportingFiles.length + copiedIncludedCount, reading: readingCount },
      duplicateName: Boolean(sameProject),
      previousYearMessage: sources.previousYearMessage,
      noSource: !sources.hasAny,
      ...(fromProjectId && anythingUnticked
        ? { noSourceMessage: `Tick a transcript or file from ${copySourceTitle}, or add your own.` }
        : {}),
      projectNumberInvalid: !projectNumberValid,
      overCapMessage,
      writtenPd: parsingPd ? "reading" : pdDoc ? "ready" : pdFileError ? "failed" : "missing",
    })
  );
  const blocked = $derived(startBlocked(checklist));
  const startLabel = $derived(startButtonLabel(mode, candidateMode));

  function scrollToTarget(target: string) {
    const selector =
      target === "duplicate"
        ? "[data-same-project]"
        : target === "unreadable"
          ? "[data-transcript-problem]"
          : target === "project-number"
            ? "#projectNumber"
            : target === "written-pd"
              ? "#section-interview"
              : null;
    const element = selector ? document.querySelector<HTMLElement>(selector) : null;
    element?.scrollIntoView({ behavior: "smooth", block: "center" });
    if (target === "project-number") element?.focus();
  }

  // ─── Start dialog (F1, G1 to G3) ───────────────────────────────────────────
  let startOpen = $state(false);
  let startButton: HTMLButtonElement | null = $state(null);
  let bottomStartButton: HTMLButtonElement | null = $state(null);
  let lastStartTrigger: HTMLElement | null = null;
  let now = $state(Date.now());
  $effect(() => {
    if (!startOpen && readingCount === 0) return;
    const timer = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(timer);
  });

  const capabilities = $derived(modelCapabilitiesQ.data);
  const pickedModelLabel = $derived(
    modelLabelFor(singleModelId || defaultModelIdFor(capabilities), capabilities)
  );
  const dialogModels = $derived.by(() => {
    if (mode === "review") {
      return {
        title: capabilities?.pdReviewModelLabel ?? "The review model",
        line: "Reviews the draft, you get a feedback report",
      };
    }
    if (candidateMode === "iterative") {
      const planning = capabilities?.planningModelLabel ?? pickedModelLabel;
      return {
        title: planning,
        line:
          planning === pickedModelLabel
            ? "Writes the ideas and the report."
            : `Writes the ideas. ${pickedModelLabel} writes the report.`,
      };
    }
    if (candidateMode === "single") return { title: pickedModelLabel, line: "Writes the draft, about 3 minutes" };
    const slot = (id: string) => (id ? modelLabelFor(id, capabilities) : "a random model");
    return {
      title: `${slot(compareSlotA)} and ${slot(compareSlotB)}`.replace(/^a random/, "A random"),
      line: "One draft each, you keep the better one",
    };
  });

  function transcriptMeta(item: { wordCount: number; format?: TranscriptSourceFormat }) {
    return `${item.wordCount.toLocaleString("en-US")} words`;
  }

  const dialogSources = $derived.by((): StartRunSource[] => {
    const rows: StartRunSource[] = [];
    if (mode === "review" && pdDoc) {
      const found = docsSectionCount(pdDoc.content, pdDoc.pageOffsets);
      rows.push({
        id: "pd",
        kind: "writtenPd",
        name: pdDoc.name,
        typeLabel: "Written PD",
        meta: `${countWords(pdDoc.content).toLocaleString("en-US")} words, ${found === 3 ? "all 3 sections found" : `${found} of 3 sections found`}`,
        locked: true,
      });
    }
    for (const item of includedTranscriptItems) {
      rows.push({ id: `t:${item.id}`, kind: "transcript", name: item.label, typeLabel: "Transcript", meta: transcriptMeta(item) });
    }
    for (const doc of docs.items) {
      const asTranscript = mode === "review" && doc.category === "transcript";
      rows.push({
        id: `d:${doc.id}`,
        kind: asTranscript ? "transcript" : "document",
        name: doc.name,
        typeLabel: CATEGORY_LABELS[doc.category],
        meta: supportingMeta(doc),
        reading: doc.status === "reading",
        readingEtaSeconds: readingEtaSeconds(doc, now),
      });
    }
    for (const document of copiedDocuments.filter(isDocumentIncluded)) {
      rows.push({
        id: `c:${document._id}`,
        kind: "document",
        name: document.fileName,
        typeLabel: document.category && document.category in CATEGORY_LABELS
          ? CATEGORY_LABELS[document.category as ContextCategoryId]
          : document.source === "review_pd"
            ? "Written PD"
            : "Other supporting docs",
        meta: `Copied from ${copySourceTitle}`,
      });
    }
    return rows;
  });

  function docsSectionCount(content: string, pageOffsets?: number[]) {
    return new Set(detectSections(content, pageOffsets).map((section) => section.section)).size;
  }

  function openStart(trigger: HTMLElement | null) {
    if (blocked || committing) return;
    // A paste still in the box becomes a transcript first, as it always has.
    if (pasteDraft.trim() && mode === "generate") addPastedTranscript();
    lastStartTrigger = trigger;
    startOpen = true;
  }

  function validateExcluded(excluded: StartRunExcluded): string | null {
    if (mode === "review") return null;
    const after = sourcesAfter(excluded);
    if (!after.hasAny) return NO_SOURCE_MESSAGE;
    return after.previousYearMessage;
  }

  function confirmStart(excluded: StartRunExcluded) {
    startOpen = false;
    void commit(excluded);
  }

  async function uploadOriginal(file: File): Promise<Id<"_storage"> | undefined> {
    return uploadOriginalTransport({
      file,
      generateUploadUrl: () => generateUploadUrl({}),
      fetch,
      signal: extractionLifetime.signal,
    });
  }

  /**
   * Durable record of a failed upload during the commit loop, falling back to
   * the local outbox when the network is down. Never throws: one unrecorded
   * failure must not sink a project that is otherwise being created.
   */
  async function recordFailedAttempt(
    projectId: Id<"projects">,
    a: { attemptKey: string; fileName: string; fileSizeBytes?: number; origin: "context_input" | "review_pd" }
  ) {
    try {
      await withUploadTimeout(
        recordUploadAttempts({
          projectId,
          attempts: [
            {
              attemptKey: a.attemptKey,
              fileName: a.fileName,
              ...(a.fileSizeBytes !== undefined ? { fileSizeBytes: a.fileSizeBytes } : {}),
              origin: a.origin,
              failureCode: "upload_failed" as const,
            },
          ],
        })
      );
    } catch (err) {
      console.error("Failed to record upload attempt", err);
      if (shouldDropOutboxEntry(err)) return;
      const userId = user.data?._id;
      if (!userId) return;
      appendOutbox(userId, {
        userId,
        projectId,
        attemptKey: a.attemptKey,
        fileName: a.fileName,
        ...(a.fileSizeBytes !== undefined ? { fileSizeBytes: a.fileSizeBytes } : {}),
        origin: a.origin,
        failureCode: "upload_failed",
        at: Date.now(),
      });
    }
  }

  /**
   * The transcript list as createProject takes it, with the start dialog id
   * of each entry so the leave-out list can name the created rows. Each
   * uploaded file's original bytes go to storage first; a failed upload only
   * drops the original, never the transcript.
   */
  async function transcriptArgs() {
    const entries: Array<{ key: string; arg: Parameters<typeof createProject>[0]["transcripts"][number] }> = [];
    for (const item of includedTranscriptItems) {
      if (item.source.kind === "copy") {
        entries.push({ key: `t:${item.id}`, arg: { fromTranscriptId: item.source.fromTranscriptId, label: item.label } });
        continue;
      }
      const originalStorageId = item.file
        ? await uploadTranscriptOriginal(
            item.file,
            () => generateUploadUrl({}),
            (storageId) => claimUpload({ storageId: storageId as Id<"_storage"> })
          )
        : null;
      entries.push({
        key: `t:${item.id}`,
        arg: {
          content: item.source.content,
          label: item.label,
          ...(item.format ? { sourceFormat: item.format } : {}),
          ...(originalStorageId ? { originalStorageId: originalStorageId as Id<"_storage"> } : {}),
        },
      });
    }
    for (const doc of supportingTranscripts) {
      if (!doc.transcript) continue;
      const originalStorageId = doc.file
        ? await uploadTranscriptOriginal(
            doc.file,
            () => generateUploadUrl({}),
            (storageId) => claimUpload({ storageId: storageId as Id<"_storage"> })
          )
        : null;
      entries.push({
        key: `d:${doc.id}`,
        arg: {
          content: doc.transcript.content,
          label: doc.transcript.label,
          sourceFormat: doc.transcript.format,
          ...(originalStorageId ? { originalStorageId: originalStorageId as Id<"_storage"> } : {}),
        },
      });
    }
    const draft = pasteDraft.trim();
    if (draft) {
      const pastedCount = transcriptItems.filter((item) => item.source.kind === "paste").length + 1;
      const pasted = readPastedTranscript(draft);
      entries.push({
        key: "t:draft",
        arg: { content: pasted.content, label: `Pasted transcript ${pastedCount}`, sourceFormat: pasted.format },
      });
    }
    return entries;
  }

  // What the writer added here themselves, by the name the copy failure
  // message uses for each (review D-2).
  function ownUploadNames(): string[] {
    const names: string[] = [];
    for (const doc of supportingFiles) names.push(doc.name);
    for (const year of previousYears) {
      if ((yearNotes.get(year) ?? "").trim()) names.push(`Previous-year note (FY ${year})`);
    }
    if (mode === "review" && pdDoc) names.push(pdDoc.name);
    return names;
  }

  /**
   * Review F1 and D-2: after a failed copy the project is never drafted or
   * reviewed, but the writer's own files are still saved. Say what was not
   * copied, and which of their own files did not make it either.
   */
  function copyFailedMessage(saved: string[]) {
    const unsaved = ownUploadNames();
    for (const name of saved) {
      const index = unsaved.indexOf(name);
      if (index >= 0) unsaved.splice(index, 1);
    }
    let message = `Some files from ${copySourceTitle} were not copied.`;
    if (!saved.length) {
      message += " Duplicate again, or add them on the project page.";
      if (unsaved.length) message += ` These files you added were not saved either: ${unsaved.join(", ")}.`;
    } else {
      // Review P3-3: the writer's own files are in this project now, so a
      // new duplicate would not have them. Point at this project instead.
      message += ` Add them on the project page. ${
        unsaved.length ? "Some of the files you added here were" : "The files you added here were"
      } saved in this project, so a new duplicate would not include them.`;
      if (unsaved.length) message += ` These were not saved: ${unsaved.join(", ")}.`;
    }
    if (mode === "review" && pdDoc && saved.includes(pdDoc.name)) {
      message += " Start the PD review on the project page once the missing files are added.";
    }
    return message;
  }

  /** The copied documents' ids in the new project, by the source row they came from. */
  async function copiedDocumentIds(projectId: Id<"projects">): Promise<Map<string, Id<"projectDocuments">>> {
    const mapping = new Map<string, Id<"projectDocuments">>();
    try {
      const rows = ((await client.query(api.documents.listDocuments, { projectId })) ?? []) as Array<{
        _id: Id<"projectDocuments">;
        fileName: string;
        category?: string | null;
        source?: string;
      }>;
      const used = new Set<string>();
      for (const document of copiedDocuments.filter(isDocumentIncluded)) {
        const match = rows.find(
          (row) =>
            !used.has(row._id) &&
            row.fileName === document.fileName &&
            (row.category ?? null) === (document.category ?? null)
        );
        if (match) {
          used.add(match._id);
          mapping.set(document._id, match._id);
        }
      }
    } catch (error) {
      console.error("Could not list the copied files", error);
    }
    return mapping;
  }

  async function commit(excluded: StartRunExcluded = { transcriptIds: [], documentIds: [] }) {
    if (committing) return;
    const leftOut = new Set([...excluded.transcriptIds, ...excluded.documentIds]);
    committing = true;
    commitStartedAt = Date.now();
    let createdProjectId: Id<"projects"> | null = null;
    let copyFailed = false;
    // The writer's own files saved so far, by ownUploadNames' names.
    const savedOwn: string[] = [];
    try {
      // Ticked files still being read are waited for; the rest are saved
      // after the run starts, so unticking one starts without it.
      const tickedReading = supportingFiles.filter(
        (doc) => doc.status === "reading" && !leftOut.has(`d:${doc.id}`)
      );
      for (const doc of tickedReading) {
        progress = `Reading ${doc.name}, then starting...`;
        await docs.whenRead([doc.id]);
        extractionLifetime.signal.throwIfAborted();
      }
      progress = "Creating project...";
      const entries = await transcriptArgs();
      const transcripts = entries.map((entry) => entry.arg);
      const originals = transcripts.flatMap((item) =>
        "originalStorageId" in item && item.originalStorageId ? [item.originalStorageId] : []
      );
      // A refused createProject releases the transcript originals it was
      // given; nothing else would ever point to them.
      const { projectId, transcriptIds } = await releaseOriginalsOnFailure(
        originals,
        (storageIds) => discardTranscriptOriginals({ storageIds: storageIds as Id<"_storage">[] }),
        () =>
          createProject({
            title: title.trim(),
            ...(sredTitle.trim() ? { sredTitle: sredTitle.trim() } : {}),
            clientName: clientName.trim(),
            ...(interviewerUserId ? { interviewerUserId: interviewerUserId as Id<"users"> } : {}),
            ...(interviewees.length ? { interviewees } : {}),
            ...(selectedTagIds.length ? { tagIds: selectedTagIds as Id<"tags">[] } : {}),
            ...(fiscalYearEndMs !== null ? { fiscalYearEnd: fiscalYearEndMs } : {}),
            ...(industry ? { industry } : {}),
            ...(scienceCode ? { scienceCode } : {}),
            ...(projectNumber.trim() ? { projectNumber: projectNumber.trim() } : {}),
            mode,
            transcripts,
          })
      );
      extractionLifetime.signal.throwIfAborted();
      createdProjectId = projectId;
      const excludeTranscriptIds = entries
        .map((entry, index) => (leftOut.has(entry.key) ? transcriptIds[index] : null))
        .filter((id): id is Id<"transcripts"> => Boolean(id));
      const excludeDocumentIds: Id<"projectDocuments">[] = [];

      // Duplicate flow: clone the project input package (support docs,
      // archived docs, review PDs, original file bytes, transcript originals
      // included, and identity evidence), minus anything the writer
      // unticked. The transcripts were copied by reference inside
      // createProject above, so the action never shares storage ownership
      // with the source project.
      if (fromProjectId) {
        progress = "Copying all project materials...";
        try {
          await copyProjectContent({
            fromProjectId: fromProjectId as Id<"projects">,
            toProjectId: projectId,
            ...(transcriptIds[0] ? { targetTranscriptId: transcriptIds[0] } : {}),
            // A duplicate to draft again copies inputs only (see draftsParam).
            ...(generateAfterDuplicate ? { includeReport: false, includeReviews: copyReviews } : {}),
            ...(excludedDocumentIds.length
              ? { excludeDocumentIds: excludedDocumentIds as Id<"projectDocuments">[] }
              : {}),
            ...(sendPreviousYearReport ? { previousYearReport: true } : {}),
          });
          if ([...leftOut].some((key) => key.startsWith("c:"))) {
            const mapping = await copiedDocumentIds(projectId);
            for (const key of leftOut) {
              if (!key.startsWith("c:")) continue;
              const id = mapping.get(key.slice(2));
              if (id) excludeDocumentIds.push(id);
            }
          }
        } catch (copyError) {
          if (extractionLifetime.signal.aborted) return;
          console.error(copyError);
          // Review F1: the project exists but may lack the copied files, so
          // it is never drafted or reviewed below. The writer's own files do
          // not depend on the copy, so they are still saved (review D-2).
          copyFailed = true;
        }
      }

      // One unreadable or oversized doc must never sink the whole project:
      // skip it, tell the writer which ones were skipped, and keep going.
      const skippedFiles: string[] = [];
      const uploadDoc = async (doc: SupportingDoc, prefix = ""): Promise<"stored_text" | "stored_empty" | "failed"> => {
        extractionLifetime.signal.throwIfAborted();
        const category = doc.category as ContextCategoryId;
        progress = `Uploading ${doc.name}...`;
        if (doc.pastedText !== null) {
          const id = await uploadDocument({
            projectId,
            fileName: doc.name,
            fileType: "txt",
            content: prefix + doc.pastedText,
            source: "context_input",
            category,
            intake: "pasted",
          });
          if (leftOut.has(`d:${doc.id}`) && id) excludeDocumentIds.push(id);
          savedOwn.push(doc.name);
          return "stored_text";
        }
        const file = doc.file!;
        const attemptKey = createRequestId();
        try {
          await docs.whenRead([doc.id]);
          const current = docs.get(doc.id) ?? doc;
          const extractionFailed = current.status === "failed";
          const content = current.parsed?.content ?? "";
          const fileType = current.parsed?.fileType ?? guessFileType(file.name);
          // Only prefix content we actually extracted. Prefixing an empty
          // extraction would store boilerplate the server reads as real
          // text, and the file would report "Ready for AI" when nothing can
          // be read from it.
          extractionLifetime.signal.throwIfAborted();
          const storageId = await uploadOriginal(file);
          extractionLifetime.signal.throwIfAborted();
          const hasText = content.trim().length > 0;
          const id = await withUploadTimeout(
            uploadDocument({
              projectId,
              fileName: file.name,
              fileType,
              content: hasText ? prefix + content : "",
              source: "context_input",
              category,
              extractionOutcome: extractionFailed ? "failed" : "ok",
              attemptKey,
              ...(storageId ? { storageId } : {}),
              ...(file.type ? { mimeType: file.type } : {}),
            })
          );
          extractionLifetime.signal.throwIfAborted();
          if (leftOut.has(`d:${doc.id}`) && id) excludeDocumentIds.push(id);
          savedOwn.push(file.name);
          return hasText ? "stored_text" : "stored_empty";
        } catch (e) {
          extractionLifetime.signal.throwIfAborted();
          if (isParseAbort(e)) throw e;
          console.error(`upload failed for ${file.name}`, e);
          skippedFiles.push(file.name);
          // The toast is transient; this is what survives the navigation.
          await recordFailedAttempt(projectId, {
            attemptKey,
            fileName: file.name,
            fileSizeBytes: file.size,
            origin: "context_input",
          });
          return "failed";
        }
      };

      // Ticked files first, in SR&ED weight order; left-out files still
      // being read are saved after the run starts.
      const order = (doc: SupportingDoc) => CATEGORY_ORDER.indexOf(doc.category as ContextCategoryId);
      const toSave = supportingFiles
        .filter((doc) => doc.category !== "transcript")
        .sort((a, b) => order(a) - order(b));
      const later = toSave.filter((doc) => doc.status === "reading" && leftOut.has(`d:${doc.id}`));
      const first = toSave.filter((doc) => !later.includes(doc));

      // Previous-year reports carry their fiscal year and that year's note.
      const noteCarried = new Set<number>();
      const saveOne = async (doc: SupportingDoc) => {
        if (doc.category !== "previous_pd") return uploadDoc(doc);
        const note = (yearNotes.get(doc.year) ?? "").trim();
        const outcome = await uploadDoc(
          doc,
          `${previousYearReportHeader(doc.year)}${note ? `Note: ${note}\n` : ""}\n`
        );
        if (outcome === "stored_text") noteCarried.add(doc.year);
        return outcome;
      };
      for (const doc of first) await saveOne(doc);
      // A note no file carried still holds useful prior-year context.
      const saveNotes = async () => {
        for (const year of previousYears) {
          const note = (yearNotes.get(year) ?? "").trim();
          if (!note || noteCarried.has(year)) continue;
          extractionLifetime.signal.throwIfAborted();
          await uploadDocument({
            projectId,
            fileName: `Previous-year note (FY ${year})`,
            fileType: "txt",
            content: `[Previous-year note — fiscal ${year}]\n\n${note}`,
            source: "context_input",
            category: "previous_pd",
            intake: "pasted",
          });
          savedOwn.push(`Previous-year note (FY ${year})`);
        }
      };
      if (later.every((doc) => doc.category !== "previous_pd")) await saveNotes();

      extractionLifetime.signal.throwIfAborted();
      if (mode === "review" && pdDoc) {
        // Runs for duplicates too (the 2026-08-07 stranded-review flag).
        // BNH-39: store the written PD (no category: it must NOT feed a later
        // generation as context; the review agent reads it directly).
        progress = `Uploading ${pdDoc.name}...`;
        const storageId = await uploadOriginal(pdDoc.file);
        extractionLifetime.signal.throwIfAborted();
        const pdAttemptKey = createRequestId();
        let documentId: Id<"projectDocuments">;
        try {
          documentId = await withUploadTimeout(
            uploadDocument({
              projectId,
              fileName: pdDoc.name,
              fileType: guessFileType(pdDoc.name),
              content: pdDoc.content,
              source: "review_pd",
              attemptKey: pdAttemptKey,
              ...(storageId ? { storageId } : {}),
              ...(pdDoc.file.type ? { mimeType: pdDoc.file.type } : {}),
            })
          );
        } catch (e) {
          extractionLifetime.signal.throwIfAborted();
          await recordFailedAttempt(projectId, {
            attemptKey: pdAttemptKey,
            fileName: pdDoc.name,
            fileSizeBytes: pdDoc.file.size,
            origin: "review_pd",
          });
          throw e;
        }
        savedOwn.push(pdDoc.name);
        if (!storageId) {
          toast.warning(`The PD text was saved, but the original file ‘${pdDoc.name}’ could not be uploaded.`);
        }
        extractionLifetime.signal.throwIfAborted();
        if (!copyFailed) {
          progress = "Starting PD review...";
          await startPdReview({
            projectId,
            documentId,
            ...(excludeDocumentIds.length ? { excludeDocumentIds } : {}),
            ...(excludeTranscriptIds.length ? { excludeTranscriptIds } : {}),
          });
        }
      } else if (copyFailed || (fromProjectId && !generateAfterDuplicate)) {
        progress = "Opening duplicate...";
      } else {
        extractionLifetime.signal.throwIfAborted();
        progress = "Starting generation...";
        await generateReport({
          projectId,
          candidateMode,
          ...(candidateMode !== "compare" && singleModelId ? { singleModelId } : {}),
          ...(candidateMode === "compare"
            ? (() => {
                const pair = comparePairFromSlots(compareSlotA, compareSlotB, pickerModels(modelCapabilitiesQ.data));
                return pair ? { compareModelIds: pair } : {};
              })()
            : {}),
          ...(excludeDocumentIds.length ? { excludeDocumentIds } : {}),
          ...(excludeTranscriptIds.length ? { excludeTranscriptIds } : {}),
        });
      }
      // Files the writer left out while they were still being read.
      for (const doc of later) await saveOne(doc);
      if (later.some((doc) => doc.category === "previous_pd")) await saveNotes();
      extractionLifetime.signal.throwIfAborted();
      if (copyFailed) {
        toast.error(copyFailedMessage(savedOwn));
        committing = false;
        progress = "";
        leaveTo(`/project/${projectId}`);
        return;
      }
      if (skippedFiles.length) {
        toast.error(
          `${skippedFiles.length} document(s) could not be uploaded and were skipped: ${skippedFiles.join(", ")}`
        );
      }
      leaveTo(`/project/${projectId}`);
    } catch (e) {
      if (extractionLifetime.signal.aborted || isParseAbort(e)) return;
      console.error(e);
      if (copyFailed && createdProjectId) {
        toast.error(copyFailedMessage(savedOwn));
        committing = false;
        progress = "";
        leaveTo(`/project/${createdProjectId}`);
        return;
      }
      // The project may already exist at this point (createProject succeeded,
      // a later step failed). Land the writer on it rather than stranding them
      // on the page with work they can't see.
      toast.error(userErrorMessage(e, "Something went wrong creating the project. Please try again."));
      committing = false;
      progress = "";
      if (createdProjectId) {
        toast.error(
          mode === "review"
            ? "The project was created but the PD review did not start. Open it and use Start PD review to retry."
            : "The project was created but generation did not start. Open it and use Generate to retry."
        );
        leaveTo(`/project/${createdProjectId}`);
      }
    }
  }

  // ─── Supporting documents: add menu, paste, preview ───────────────────────
  let docsInput: HTMLInputElement | null = $state(null);
  let replaceInput: HTMLInputElement | null = $state(null);
  let replacingDocId: string | null = null;
  let docsDragOver = $state(false);
  let docsError = $state("");
  let docPasteOpen = $state(false);
  let docPasteText = $state("");
  let docPasteCategory = $state<SupportingCategory>("writer_notes");
  let previewId = $state<string | null>(null);
  let previewOpen = $state(false);
  let pdPreviewOpen = $state(false);
  const previewDoc = $derived(previewId ? (docs.get(previewId) ?? null) : null);
  const pdPreviewDoc = $derived<SupportingDoc | null>(
    pdDoc
      ? {
          id: "pd",
          name: pdDoc.name,
          file: pdDoc.file,
          pastedText: null,
          category: "other",
          categoryTouched: true,
          year: baseYear,
          status: "ready",
          progress: null,
          startedAt: 0,
          finishedAt: 0,
          parsed: { fileName: pdDoc.name, fileType: guessFileType(pdDoc.name), content: pdDoc.content, pageOffsets: pdDoc.pageOffsets },
          transcript: null,
          error: null,
          sections: [],
          words: countWords(pdDoc.content),
        }
      : null
  );

  // Review a written PD takes transcript exports here too (E4).
  const isCaptionFile = (name: string) => /\.(vtt|srt)$/i.test(name);
  function addSupportingFiles(files: File[]) {
    const accepted = (file: File) => isSupportedFile(file.name) || (mode === "review" && isCaptionFile(file.name));
    const ok = files.filter(accepted);
    const rejected = files.filter((file) => !accepted(file)).map((file) => file.name);
    docsError = rejected.length ? `We cannot read ${rejected.join(", ")}. Use ${SUPPORTED_LABEL}.` : "";
    if (!ok.length) return;
    if (mode === "review") {
      // Transcript exports go to the transcripts table.
      const transcripts = ok.filter((file) => isCaptionFile(file.name));
      const others = ok.filter((file) => !transcripts.includes(file));
      if (transcripts.length) docs.add(transcripts, "transcript");
      if (others.length) docs.add(others);
      return;
    }
    docs.add(ok);
  }

  function replaceDoc(id: string) {
    replacingDocId = id;
    previewOpen = false;
    replaceInput?.click();
  }

  function removeDoc(id: string) {
    docs.remove(id);
    if (previewId === id) {
      previewOpen = false;
      previewId = null;
    }
  }

  function addDocPaste() {
    const text = docPasteText.trim();
    if (!text) return;
    docs.addPasted(text, docPasteCategory);
    docPasteText = "";
    docPasteOpen = false;
  }

  // ─── Tablet and phone (H1, H2): section chips and the bottom bar ──────────
  // One layout at a time, so no control renders twice: desktop from 1280px
  // (the right column), tablet from 640px, phone below.
  let viewportWidth = $state(typeof window === "undefined" ? 1440 : window.innerWidth);
  onMount(() => {
    const update = () => (viewportWidth = window.innerWidth);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  });
  const layout = $derived<"desktop" | "tablet" | "phone">(
    viewportWidth >= 1280 ? "desktop" : viewportWidth >= 640 ? "tablet" : "phone"
  );
  const sectionChips = $derived([
    { id: "section-project", label: "Project", short: "Project", done: Boolean(clientName.trim() && title.trim()) },
    {
      id: "section-interview",
      label: mode === "review" ? "Written PD" : "Interview",
      short: mode === "review" ? "Written PD" : "Interview",
      done: mode === "review" ? Boolean(pdDoc) : transcriptCountForSubmit > 0,
    },
    {
      id: "section-supporting",
      label: "Supporting documents",
      short: "Supporting",
      done: supportingFiles.length > 0 && readingCount === 0,
    },
    { id: "section-details", label: "Details", short: "Details", done: Boolean(projectNumber.trim() || selectedTagIds.length) },
    { id: "section-mode", label: mode === "review" ? "How to review it" : "How to write it", short: "How", done: true },
  ]);
  let currentSection = $state("section-project");
  let formColumn: HTMLElement | null = $state(null);
  $effect(() => {
    const root = formColumn;
    if (!root || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) currentSection = visible[0].target.id;
      },
      { rootMargin: "-20% 0px -60% 0px" }
    );
    for (const section of root.querySelectorAll("section[data-new-project-section]")) observer.observe(section);
    return () => observer.disconnect();
  });
  function jumpTo(id: string) {
    currentSection = id;
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  const firstBlocking = $derived(checklist.find((row) => row.blocking) ?? null);
  const readySummary = $derived(
    mode === "review"
      ? `Ready: written PD, ${supportingFiles.length} supporting ${supportingFiles.length === 1 ? "document" : "documents"}`
      : `Ready: ${transcriptCountForSubmit} ${transcriptCountForSubmit === 1 ? "transcript" : "transcripts"}, ${supportingFiles.length + copiedIncludedCount} supporting ${supportingFiles.length + copiedIncludedCount === 1 ? "document" : "documents"}`
  );
  const startNote = $derived(
    mode === "review" ? "You get a feedback report. Your draft is never changed." : "You will check your files before anything starts."
  );

  // The shared borderless field (inset line, lagoon on hover and focus).
  const fieldClass =
    "field-control h-9 w-full rounded-md px-2.5 text-sm text-ink placeholder:text-ink-faint pointer-coarse:h-11";
  const labelClass = "text-xs leading-4 font-medium text-ink-secondary";
</script>

{#snippet modelPicker()}
  <div class="flex flex-col gap-1.5 pt-1">
    <span class={labelClass}>Model</span>
    {#if mode === "review"}
      <div data-review-model class="flex h-9 items-center gap-2 rounded-md border border-line bg-canvas px-2.5 text-sm text-ink">
        <AuroraMark size={16} />
        <span class="truncate">{capabilities?.pdReviewModelLabel ?? "The review model"}</span>
      </div>
    {:else if candidateMode !== "compare"}
      <SingleModelPicker bind:value={singleModelId} size="field" />
    {:else}
      <ComparePairPicker bind:slotA={compareSlotA} bind:slotB={compareSlotB} size="field" />
    {/if}
  </div>
{/snippet}

{#snippet modeSwitch()}
  {@const fullWidth = layout === "phone"}
  <div
    class={`flex shrink-0 gap-1 rounded-[10px] bg-chrome p-1 ${fullWidth ? "w-full" : ""}`}
    role="radiogroup"
    aria-label="Project mode"
  >
    {#each [
      { id: "generate", label: "Write a new PD", short: "Write a new PD" },
      { id: "review", label: "Review a written PD", short: "Review a PD" },
    ] as const as opt (opt.id)}
      {@const locked = modeLocked && opt.id !== "review"}
      <!-- aria-disabled, not disabled, so the tooltip still opens. -->
      <Tooltip text={locked ? "A copy of a Review PD project stays a Review PD project." : opt.label}>
        {#snippet children({ props })}
          <button
            {...props}
            type="button"
            role="radio"
            aria-checked={mode === opt.id}
            aria-disabled={locked ? "true" : undefined}
            onclick={() => {
              if (!locked) mode = opt.id;
            }}
            class={`flex h-[30px] items-center justify-center rounded-[7px] px-3 text-[13px] leading-[18px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fir pointer-coarse:h-11 ${
              fullWidth ? "flex-1" : ""
            } ${
              mode === opt.id
                ? "bg-primary-selected text-white"
                : locked
                  ? "cursor-not-allowed text-ink-faint"
                  : "text-ink-secondary hover:bg-primary-wash hover:text-ink"
            }`}
          >
            {fullWidth ? opt.short : opt.label}
          </button>
        {/snippet}
      </Tooltip>
    {/each}
  </div>
{/snippet}

{#snippet transcriptRows()}
  {#if transcriptItems.length || transcriptProblems.length}
    <ul class="flex flex-col" data-transcript-list>
      {#each transcriptItems as item (item.id)}
        {@const copied = item.source.kind === "copy"}
        {@const included = isTranscriptIncluded(item)}
        <li
          data-transcript-item
          data-included={included ? "true" : "false"}
          class="relative flex min-h-11 items-center gap-2.5 border-b border-line-soft py-1.5 last:border-b-0"
        >
          <span class="flex size-7 shrink-0 items-center justify-center"><FileIcon name={item.file?.name ?? item.label} size={28} /></span>
          <span class="flex min-w-0 flex-1 flex-col sm:flex-row sm:items-center sm:gap-2.5">
            {#if copied}
              <!-- The whole row toggles the tick box (review D-6). -->
              <Label.Root
                for={`copy-transcript-${item.id}`}
                class={`block min-w-0 truncate text-sm leading-[19px] font-medium text-ink ${STRETCHED_LABEL}`}
              >{item.label}</Label.Root>
            {:else}
              <span class="block min-w-0 truncate text-sm leading-[19px] font-medium text-ink">{item.label}</span>
            {/if}
            <span class="grow"></span>
            <span class="shrink-0 text-[13px] leading-[19px] text-ink-muted" data-transcript-format>
              {item.format && item.format !== "unknown" ? `${TRANSCRIPT_FORMAT_LABELS[item.format]}, ` : ""}{item.wordCount.toLocaleString("en-US")} words
            </span>
            {#if !included}
              <span class="shrink-0 text-xs text-ink-muted" data-transcript-not-copied>Not copied</span>
            {/if}
          </span>
          {#if copied}
            <!-- A copied transcript is unticked, not removed, so the writer
                 can tick it again (owner decision 35). -->
            <span class="relative z-10 flex">
              <Checkbox
                id={`copy-transcript-${item.id}`}
                checked={included}
                aria-label={`Copy ${item.label}`}
                onCheckedChange={(checked) => setTranscriptIncluded(item.id, checked)}
              />
            </span>
          {:else}
            <CheckIcon size={14} class="shrink-0 text-success" aria-label="Read" />
            <Tooltip text="Remove" delayDuration={300}>
              {#snippet children({ props })}
                <button
                  {...props}
                  type="button"
                  onclick={() => removeTranscriptItem(item.id)}
                  aria-label={`Remove ${item.label}`}
                  class="flex size-7 shrink-0 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-danger-soft hover:text-danger-ink pointer-coarse:size-11"
                >
                  <XIcon size={14} aria-hidden="true" />
                </button>
              {/snippet}
            </Tooltip>
          {/if}
        </li>
      {/each}
    </ul>
    {#each transcriptProblems as problem (problem.id)}
      <div data-transcript-problem>
        <StatusCallout
          tone="danger"
          layout="inline"
          title={problem.name}
          role="alert"
          primaryAction={{ label: "Replace file", onclick: () => replaceProblem(problem.id) }}
          onDismiss={() => (transcriptProblems = transcriptProblems.filter((row) => row.id !== problem.id))}
        >
          {#snippet icon()}<FileIcon name={problem.name} size={28} />{/snippet}
          {problem.text}
        </StatusCallout>
      </div>
    {/each}
    {#if fiscalYearMovedForward && transcriptItems.some((item) => item.source.kind === "copy")}
      <p data-transcripts-year-note class="text-xs text-ink-muted">
        These transcripts are from FY {sourceFiscalYear}. Untick any that don't cover this year's work.
      </p>
    {/if}
  {/if}
{/snippet}

{#snippet copiedFiles()}
  {#if copiedDocumentGroups.length}
    <!-- Duplicate: the source's files. They are not staged here; the server
         copies the ticked ones when the project is created, originals
         included (owner decision 35). -->
    <section data-copied-files aria-labelledby="copied-files-title" class="rounded-xl border border-line-soft bg-surface px-4 py-3">
      <div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <h3 id="copied-files-title" class="min-w-0 truncate text-sm font-medium text-ink">Files from {copySourceTitle}</h3>
        <p data-copied-files-count class="text-xs text-ink-muted">{copiedCountLabel} file{copiedTotalCount === 1 ? "" : "s"}</p>
      </div>
      <p data-copied-files-note class="mt-0.5 text-xs text-ink-muted">{copiedFilesNote}</p>
      <div class="mt-2.5 flex flex-col gap-2.5">
        {#each copiedDocumentGroups as group (group.id)}
          {@const ticks = groupTicks(group)}
          {@const allTicked = ticks.every(Boolean)}
          {@const someTicked = ticks.some(Boolean)}
          <div data-copied-files-group={group.id}>
            <div class={TICK_ROW}>
              <span class="relative z-10 flex">
                <Checkbox
                  id={`copy-group-${group.id}`}
                  checked={allTicked}
                  indeterminate={someTicked && !allTicked}
                  aria-label={`Copy all ${group.label}`}
                  onCheckedChange={(checked) => setGroupIncluded(group, checked)}
                />
              </span>
              <Label.Root for={`copy-group-${group.id}`} class={`text-xs font-medium text-ink-muted ${STRETCHED_LABEL}`}>{group.label}</Label.Root>
            </div>
            <ul class="mt-1 flex flex-col gap-1 text-sm text-ink-secondary">
              {#each group.files as file (file._id)}
                {@const included = isDocumentIncluded(file)}
                <li data-copied-file={file._id} data-included={included ? "true" : "false"} class={TICK_ROW}>
                  <span class="relative z-10 flex">
                    <Checkbox
                      id={`copy-file-${file._id}`}
                      checked={included}
                      aria-label={`Copy ${file.fileName}`}
                      onCheckedChange={(checked) => documentChoices.set(file._id, checked)}
                    />
                  </span>
                  <Label.Root for={`copy-file-${file._id}`} class={`flex min-w-0 ${STRETCHED_LABEL}`}><span class="min-w-0 truncate">{file.fileName}</span></Label.Root>
                  {#if file.archived}
                    <span class="shrink-0 text-xs text-ink-muted">Archived, not read for the draft</span>
                  {:else if isPortedSameYear(file)}
                    <span class="shrink-0 text-xs text-ink-muted">
                      {sourceFiscalYear !== null && newFiscalYear === sourceFiscalYear
                        ? `PD for FY ${sourceFiscalYear}, the same year as this project`
                        : "PD for the original's fiscal year"}
                    </span>
                  {/if}
                </li>
              {/each}
              {#if groupHasReport(group.id)}
                <li data-previous-year-report data-included={previousYearReportIncluded ? "true" : "false"} class={TICK_ROW}>
                  <span class="relative z-10 flex">
                    <Checkbox
                      id="copy-previous-year-report"
                      bind:checked={previousYearReportIncluded}
                      aria-label={`Copy ${copySourceTitle} report (FY ${sourceFiscalYear})`}
                    />
                  </span>
                  <Label.Root for="copy-previous-year-report" class={`flex min-w-0 ${STRETCHED_LABEL}`}><span class="min-w-0 truncate">{copySourceTitle} report (FY {sourceFiscalYear})</span></Label.Root>
                  <span class="shrink-0 text-xs text-ink-muted">Made from the original's latest report</span>
                </li>
              {/if}
            </ul>
          </div>
        {/each}
      </div>
    </section>
  {/if}
{/snippet}

{#if auth.isLoading || !auth.isAuthenticated}
  <div class="flex flex-1 items-center justify-center bg-canvas">
    <Spinner />
  </div>
{:else}
  <!-- Round 2 (E1): one page inside the workspace chrome. The top bar tile,
       breadcrumb and flush panel come with the shell's new props (WS1). -->
  <WorkspaceChrome theme="light" title="New project">
    {#snippet actions()}
      <Button variant="destructive-soft" size="sm" class="h-9 px-3.5! py-0!" onclick={cancel} data-new-project-cancel>Cancel</Button>
    {/snippet}
    {#snippet children()}
      <div class="flex min-h-full flex-col bg-workspace-shell px-2 pb-2 sm:px-3 sm:pb-3">
        <div data-new-project-panel data-work-panel class="flex min-h-0 flex-1 overflow-hidden rounded-[10px] border border-line bg-surface">
          <div class="flex min-w-0 flex-1 flex-col">
            <!-- H1, H2: section chips under the top bar below desktop. -->
            {#if layout !== "desktop"}
            <nav
              aria-label="Sections"
              data-section-chips
              class="sticky top-0 z-10 flex gap-2 overflow-x-auto border-b border-line-soft bg-surface px-4 py-2.5 scrollbar-hidden sm:px-[88px]"
            >
              {#each sectionChips as chip (chip.id)}
                {@const current = currentSection === chip.id}
                <button
                  type="button"
                  data-section-chip={chip.id}
                  aria-current={current ? "true" : undefined}
                  onclick={() => jumpTo(chip.id)}
                  class={`flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] leading-[18px] font-medium transition-colors pointer-coarse:h-11 ${
                    current
                      ? "border-[1.5px] border-primary-selected text-ink"
                      : chip.done
                        ? "border border-transparent bg-chrome text-ink-secondary"
                        : "border border-line text-ink-secondary"
                  }`}
                >
                  {#if current}<span class="size-1.5 rounded-full bg-primary-selected" aria-hidden="true"></span>{:else if chip.done}<CheckIcon size={12} aria-hidden="true" />{/if}
                  {layout === "phone" ? chip.short : chip.label}
                </button>
              {/each}
            </nav>
            {/if}

            <div bind:this={formColumn} data-form-column class={`flex w-full flex-col gap-[22px] pb-8 ${layout === "desktop" ? "max-w-[854px] px-10 pt-7" : layout === "tablet" ? "px-[88px] pt-6" : "px-4 pt-5"}`}>
              <header class="flex flex-col gap-4 sm:flex-row sm:items-end">
                <div class="flex min-w-0 flex-1 flex-col gap-1">
                  <h1 class="font-serif text-[28px] leading-[34px] text-ink">New project</h1>
                  <p class="text-sm leading-5 text-ink-muted" data-new-project-subtitle>
                    {mode === "review"
                      ? "Add the draft and the basics. You become the project Owner."
                      : "Add the interview and the basics. You become the project Owner."}
                  </p>
                </div>
                {@render modeSwitch()}
              </header>

              <NewProjectSection id="section-project" number="01" title="Project" helper="The basics">
                <div class="grid gap-4 sm:grid-cols-[260px_minmax(0,1fr)]">
                  <label class="flex flex-col gap-1.5">
                    <span class={labelClass}>Client</span>
                    <ClientCombobox id="clientName" bind:value={clientName} suggestions={clientSuggestions} />
                  </label>
                  <label class="flex flex-col gap-1.5">
                    <span class={labelClass}>Project title</span>
                    <input
                      id="title"
                      bind:value={title}
                      required
                      placeholder="Project title"
                      class="field-control h-9 w-full rounded-md px-2.5 text-sm text-ink placeholder:text-ink-faint pointer-coarse:h-11"
                      data-same-name={sameProject ? "true" : undefined}
                      style={sameProject ? "box-shadow: inset 0 0 0 1.5px var(--color-warning)" : undefined}
                    />
                  </label>
                </div>
                {#if sameProject}
                  <div data-same-project>
                    <StatusCallout
                      tone="warning"
                      layout="stacked"
                      title={`${sameProject.clientName} already has this project${newFiscalYear !== null ? ` for FY ${newFiscalYear}` : ""}`}
                      role="status"
                      primaryAction={{ label: "Open that project", onclick: () => leaveTo(`/project/${sameProject.projectId}`) }}
                      secondaryAction={{ label: "It is a different project", onclick: () => dismissedDuplicates.add(duplicateKey) }}
                    >
                      {sameProjectText}
                    </StatusCallout>
                  </div>
                {/if}
                <div class="grid gap-4 sm:grid-cols-[260px_minmax(0,1fr)] md:max-xl:grid-cols-3">
                  <div class="flex flex-col gap-1.5">
                    <span class={labelClass} id="fiscal-year-label">Fiscal year</span>
                    <DatePicker
                      id="fiscalYearEnd"
                      bind:value={fiscalYearEnd}
                      heading="Year end"
                      quickPicks={FISCAL_QUICK_PICKS}
                      helper="The fiscal year takes the year of its end date."
                    >
                      {#snippet trigger({ props })}
                        <button {...props} type="button" aria-labelledby="fiscal-year-label" data-fiscal-year class={`${fieldClass} flex items-center gap-2 text-left`}>
                          <CalendarBlankIcon size={14} class="shrink-0 text-ink-muted" aria-hidden="true" />
                          {#if fiscalDisplay}
                            <span class="text-ink">{fiscalDisplay.year}</span>
                            <span class="min-w-0 truncate text-ink-muted"><span class="hidden sm:inline">({fiscalDisplay.date})</span><span class="sm:hidden">({fiscalDisplay.date.replace(/, \d{4}$/, "")})</span></span>
                          {:else}
                            <span class="text-ink-faint">Choose the year end</span>
                          {/if}
                        </button>
                      {/snippet}
                    </DatePicker>
                  </div>
                  <div class="flex flex-col gap-1.5">
                    <span class={labelClass} id="science-code-label">Science code</span>
                    <ScienceCodePicker value={scienceCode || null} bind:open={scienceOpen} onSelect={(code) => { scienceCode = code ?? ""; }}>
                      {#snippet trigger({ props })}
                        <button {...props} type="button" id="scienceCode" aria-labelledby="science-code-label" data-science-code class={`${fieldClass} flex items-center gap-2 text-left`}>
                          {#if scienceDisplay}
                            <span class="hidden font-mono font-medium text-ink sm:inline">{scienceDisplay.code}</span>
                            <span class="min-w-0 flex-1 truncate text-ink sm:text-ink-muted">{scienceDisplay.label}</span>
                          {:else}
                            <span class="min-w-0 flex-1 truncate text-ink-faint">Choose a science code</span>
                          {/if}
                          <CaretDownIcon size={12} class="shrink-0 text-ink-muted" aria-hidden="true" />
                        </button>
                      {/snippet}
                    </ScienceCodePicker>
                  </div>
                  <div class="flex flex-col gap-1.5 sm:max-md:col-span-1 xl:col-span-1">
                    <label for="industry" class={labelClass}>Industry</label>
                    <IndustrySelect id="industry" bind:value={industry} canCreate={user.data?.role === "admin"} />
                  </div>
                </div>
              </NewProjectSection>

              {#if mode === "generate"}
                <NewProjectSection id="section-interview" number="02" title="Interview" helper="Transcripts the PD is written from" gap="10px">
                  {#snippet status()}
                    {#if transcriptProblems.length}
                      <span data-interview-status="problem" class="flex items-center gap-1.5 text-[13px] leading-[19px] font-medium text-danger-ink-muted">
                        <WarningCircleIcon size={14} aria-hidden="true" />
                        {transcriptCountForSubmit} of {transcriptCountForSubmit + transcriptProblems.length} can be read
                      </span>
                    {:else if transcriptCountForSubmit > 0}
                      <span data-interview-status="ready" class="flex items-center gap-1.5 text-[13px] leading-[19px] font-medium text-success-ink-muted">
                        <CheckIcon size={14} aria-hidden="true" />
                        {transcriptWordCount.toLocaleString("en-US")} words
                      </span>
                    {/if}
                  {/snippet}
                  {#if wrongTranscriptFile}
                    <!-- E5: a file that is not a transcript. -->
                    <button
                      type="button"
                      data-transcript-wrong-file
                      onclick={() => transcriptInput?.click()}
                      ondragover={(e) => { e.preventDefault(); transcriptDragOver = true; }}
                      ondragleave={() => (transcriptDragOver = false)}
                      ondrop={(e) => {
                        e.preventDefault();
                        transcriptDragOver = false;
                        const files = e.dataTransfer?.files;
                        if (files?.length) handleTranscriptFiles(Array.from(files));
                      }}
                      class="flex min-h-12 w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-[10px] border-[1.5px] border-dashed border-danger-line bg-danger-surface px-3.5 py-2 text-left"
                    >
                      <WarningCircleIcon size={16} class="shrink-0 text-danger" aria-hidden="true" />
                      <span role="alert" class="text-[13px] leading-[19px] font-medium text-danger-ink">
                        {wrongTranscriptFile.video ? `${wrongTranscriptFile.name} is a video.` : `${wrongTranscriptFile.name} is not a transcript file.`}
                      </span>
                      <span class="text-[13px] leading-[19px] text-danger-ink-muted">Add transcripts as Word, VTT, SRT or text.</span>
                    </button>
                  {:else}
                    <div
                      role="group"
                      aria-label="Add transcripts"
                      ondragover={(e) => { e.preventDefault(); transcriptDragOver = true; }}
                      ondragleave={() => (transcriptDragOver = false)}
                      ondrop={(e) => {
                        e.preventDefault();
                        transcriptDragOver = false;
                        const files = e.dataTransfer?.files;
                        if (files?.length) handleTranscriptFiles(Array.from(files));
                      }}
                      class={`flex min-h-12 items-center gap-3 rounded-[10px] border-[1.5px] border-dashed px-3.5 transition-colors ${
                        transcriptDragOver ? "border-primary-selected bg-primary-wash" : "border-line bg-canvas"
                      }`}
                      data-transcript-drop
                    >
                      {#if parsingTranscript}
                        <span class="inline-flex items-center gap-2 text-[13px] text-ink">
                          <Spinner size="sm" class="border-navy/30 border-t-navy" />
                          Reading {parsingTranscript}...
                        </span>
                      {:else}
                        <button type="button" onclick={() => transcriptInput?.click()} class="flex items-center gap-3 rounded-md text-[13px] leading-[19px] font-medium text-ink hover:underline focus-visible:outline-2 focus-visible:outline-fir pointer-coarse:min-h-11">
                          <UploadSimpleIcon size={16} class="text-ink-secondary" aria-hidden="true" />
                          Drop transcripts
                        </button>
                        <button type="button" data-open-paste onclick={() => (pasteOpen = !pasteOpen)} class="rounded-md text-[13px] leading-[19px] text-ink-muted hover:text-ink hover:underline focus-visible:outline-2 focus-visible:outline-fir pointer-coarse:min-h-11">
                          or paste the text
                        </button>
                      {/if}
                    </div>
                  {/if}
                  {#if pasteOpen}
                    <div class="flex flex-col gap-2" data-paste-panel>
                      <textarea
                        id="transcript"
                        rows={8}
                        bind:value={pasteDraft}
                        aria-label="Transcript text"
                        placeholder="Paste the full interview transcript here"
                        class="field-control rounded-md px-3 py-2 font-serif text-sm leading-relaxed text-ink placeholder:font-sans placeholder:text-ink-faint"
                      ></textarea>
                      <div class="flex justify-end gap-2">
                        <Button type="button" size="sm" variant="ghost" onclick={() => { pasteOpen = false; pasteDraft = ""; }}>Cancel</Button>
                        <Button type="button" size="sm" variant="secondary" disabled={!pasteDraft.trim()} onclick={addPastedTranscript}>Add transcript</Button>
                      </div>
                    </div>
                  {/if}
                  {@render transcriptRows()}
                  <div class="grid gap-4 pt-1 sm:grid-cols-[260px_minmax(0,1fr)]">
                    <div class="flex flex-col gap-1.5">
                      <label for="interviewer" class={labelClass}>Interviewer</label>
                      <SelectInput id="interviewer" bind:value={interviewerUserId} items={interviewerOptions} />
                    </div>
                    <div class="flex flex-col gap-1.5">
                      <label for="interviewee" class={labelClass}>Interviewees</label>
                      <div class="flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1 pointer-coarse:min-h-11">
                        {#each interviewees as name, i (name)}
                          <span class="inline-flex h-6 items-center gap-1 rounded-sm bg-chrome px-2 text-xs font-medium text-ink-secondary">
                            {name}
                            <button type="button" aria-label={`Remove ${name}`} onclick={() => removeInterviewee(i)} class="text-ink-faint hover:text-danger-ink">
                              <XIcon size={10} aria-hidden="true" />
                            </button>
                          </span>
                        {/each}
                        <input
                          id="interviewee"
                          type="text"
                          bind:value={intervieweeDraft}
                          placeholder={interviewees.length ? "Add another" : "Add a name, press Enter"}
                          onkeydown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              addInterviewee();
                            }
                          }}
                          onblur={addInterviewee}
                          class="input-chromeless h-7 min-w-24 flex-1 bg-transparent text-sm text-ink placeholder:text-ink-faint"
                        />
                      </div>
                    </div>
                  </div>
                </NewProjectSection>
              {:else}
                <NewProjectSection id="section-interview" number="02" title="Written PD" helper="The draft you want reviewed" gap="10px">
                  {#snippet status()}
                    {#if pdDoc}
                      <span data-written-pd-status class="flex items-center gap-1.5 text-[13px] leading-[19px] font-medium text-success-ink-muted">
                        <CheckIcon size={14} aria-hidden="true" /> Ready to review
                      </span>
                    {/if}
                  {/snippet}
                  {#if pdDoc}
                    <ReviewPdCard
                      name={pdDoc.name}
                      content={pdDoc.content}
                      pageOffsets={pdDoc.pageOffsets}
                      titleFromFileName={pdTitleFromName}
                      onPreview={() => (pdPreviewOpen = true)}
                      onRemove={() => {
                        pdDoc = null;
                        pdNameHint = "";
                        pdTitleFromName = false;
                      }}
                    />
                  {:else}
                    <button
                      type="button"
                      data-written-pd-drop
                      onclick={() => pdInput?.click()}
                      ondragover={(e) => { e.preventDefault(); pdDragOver = true; }}
                      ondragleave={() => (pdDragOver = false)}
                      ondrop={(e) => {
                        e.preventDefault();
                        pdDragOver = false;
                        const file = e.dataTransfer?.files?.[0];
                        if (file) handlePdFile(file);
                      }}
                      class={`flex min-h-24 flex-col items-center justify-center gap-1 rounded-xl border-[1.5px] border-dashed px-4 text-center transition-colors ${
                        pdDragOver ? "border-primary-selected bg-primary-wash" : "border-line bg-canvas hover:bg-primary-wash"
                      }`}
                    >
                      {#if parsingPd}
                        <span class="inline-flex items-center gap-2 text-[13px] text-ink">
                          <Spinner size="sm" class="border-navy/30 border-t-navy" />
                          Reading {parsingPd}...
                        </span>
                      {:else}
                        <span class="text-sm leading-[18px] font-medium text-ink">Drop the written PD</span>
                        <span class="text-xs leading-4 text-ink-muted">Word, PDF or text</span>
                      {/if}
                    </button>
                  {/if}
                  {#if pdFileError}
                    <p role="alert" class="text-xs text-danger-ink-muted">{pdFileError}</p>
                  {/if}
                  {#if pdNameHint}
                    <div class="flex items-center gap-2 rounded-md bg-primary-wash px-3 py-1.5" role="status">
                      <p class="min-w-0 flex-1 text-xs text-ink-secondary">{pdNameHint}</p>
                      <button
                        type="button"
                        aria-label="Dismiss the file-name hint"
                        class="-my-1 flex size-7 flex-none items-center justify-center rounded-md text-ink-muted transition-colors hover:text-navy focus-visible:outline-2 focus-visible:outline-navy"
                        onclick={() => (pdNameHint = "")}
                      >
                        <XIcon size={14} aria-hidden="true" />
                      </button>
                    </div>
                  {/if}
                  <p class="text-[13px] leading-[19px] text-ink-muted">Add the interview under Supporting documents if you want facts checked against it.</p>
                  {@render transcriptRows()}
                </NewProjectSection>
              {/if}

              <NewProjectSection id="section-supporting" number="03" title="Supporting documents" helper="Optional. Anything that backs up the claim.">
                {#snippet action()}
                  <DropdownMenu.Root>
                    <DropdownMenu.Trigger data-add-supporting class="flex h-[30px] items-center gap-1.5 rounded-[7px] bg-chrome px-2.5 text-[13px] leading-[18px] font-medium text-ink transition-colors hover:bg-primary-wash focus-visible:outline-2 focus-visible:outline-fir pointer-coarse:h-11">
                      <PlusIcon size={12} aria-hidden="true" /> Add <CaretDownIcon size={10} aria-hidden="true" />
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Portal>
                      <DropdownMenu.Content align="end" sideOffset={6} class="z-[130] w-[300px] rounded-[10px] border border-line bg-surface p-1 shadow-popover">
                        <DropdownMenu.Item onSelect={() => docsInput?.click()} data-add-upload class="flex min-h-9 cursor-default items-center gap-2.5 rounded-md px-2.5 text-[13px] text-ink outline-none data-highlighted:bg-primary-wash pointer-coarse:min-h-11">
                          <UploadSimpleIcon size={14} class="text-ink-secondary" aria-hidden="true" />
                          <span class="flex-1">Upload files</span>
                          <span class="text-xs text-ink-muted">PDF, Word, Excel</span>
                        </DropdownMenu.Item>
                        <DropdownMenu.Item onSelect={() => (docPasteOpen = true)} data-add-paste class="flex min-h-9 cursor-default items-center gap-2.5 rounded-md px-2.5 text-[13px] text-ink outline-none data-highlighted:bg-primary-wash pointer-coarse:min-h-11">
                          <ClipboardTextIcon size={14} class="text-ink-secondary" aria-hidden="true" />
                          <span class="flex-1">Paste text or notes</span>
                        </DropdownMenu.Item>
                      </DropdownMenu.Content>
                    </DropdownMenu.Portal>
                  </DropdownMenu.Root>
                {/snippet}
                {@render copiedFiles()}
                {#if docPasteOpen}
                  <div class="flex flex-col gap-2 rounded-xl border border-line-soft p-3" data-doc-paste>
                    <div class="flex flex-wrap items-center gap-2">
                      <span class={labelClass}>Paste as</span>
                      <div class="w-56">
                        <SelectInput
                          size="sm"
                          ariaLabel="Type of pasted text"
                          value={docPasteCategory}
                          onValueChange={(next) => (docPasteCategory = next as SupportingCategory)}
                          items={docCategories.map((category) => ({ value: category, label: CATEGORY_LABELS[category] }))}
                        />
                      </div>
                    </div>
                    <textarea
                      rows={6}
                      bind:value={docPasteText}
                      aria-label="Pasted text"
                      placeholder="Paste notes or text here"
                      class="field-control rounded-md px-3 py-2 text-sm leading-relaxed text-ink placeholder:text-ink-faint"
                    ></textarea>
                    <div class="flex justify-end gap-2">
                      <Button type="button" size="sm" variant="ghost" onclick={() => { docPasteOpen = false; docPasteText = ""; }}>Cancel</Button>
                      <Button type="button" size="sm" variant="secondary" disabled={!docPasteText.trim()} onclick={addDocPaste} data-add-pasted>Add</Button>
                    </div>
                  </div>
                {/if}
                <div
                  role="group"
                  aria-label="Supporting documents"
                  data-supporting-grid
                  class="grid grid-cols-1 gap-3 sm:grid-cols-2 md:max-xl:grid-cols-3"
                  ondragover={(e) => { e.preventDefault(); docsDragOver = true; }}
                  ondragleave={() => (docsDragOver = false)}
                  ondrop={(e) => {
                    e.preventDefault();
                    docsDragOver = false;
                    const files = e.dataTransfer?.files;
                    if (files?.length) addSupportingFiles(Array.from(files));
                  }}
                >
                  {#each docs.items as doc (doc.id)}
                    <SupportingDocCard
                      {doc}
                      categories={docCategories}
                      years={yearChoices}
                      compact={layout === "tablet"}
                      onPreview={() => { previewId = doc.id; previewOpen = true; }}
                      onRemove={() => removeDoc(doc.id)}
                      onReplace={() => replaceDoc(doc.id)}
                      onCategory={(category) => docs.setCategory(doc.id, category)}
                      onYear={(year) => docs.setYear(doc.id, year)}
                    />
                  {/each}
                  <button
                    type="button"
                    data-drop-more
                    onclick={() => docsInput?.click()}
                    class={`flex min-h-24 flex-col items-center justify-center gap-1 rounded-xl border-[1.5px] border-dashed px-4 text-center transition-colors ${
                      docsDragOver ? "border-primary-selected bg-primary-wash" : "border-line bg-canvas hover:bg-primary-wash"
                    }`}
                  >
                    <span class="text-sm leading-[18px] font-medium text-ink">{docs.items.length ? "Drop more files" : "Drop files"}</span>
                    <span class="text-xs leading-4 text-ink-muted">PDF, Word, Excel, text or email</span>
                  </button>
                </div>
                {#if docsError}
                  <p role="alert" class="text-xs text-danger-ink-muted">{docsError}</p>
                {/if}
                {#if previousYears.length}
                  <div class="flex flex-col gap-2" data-year-notes>
                    {#each previousYears as year (year)}
                      <label class="flex flex-col gap-1.5">
                        <span class={labelClass}>Note on the FY {year} report <span class="font-normal text-ink-muted">(optional)</span></span>
                        <input
                          value={yearNotes.get(year) ?? ""}
                          oninput={(e) => yearNotes.set(year, e.currentTarget.value)}
                          placeholder="For example, what changed since last year's claim"
                          class="field-control h-9 w-full rounded-md px-2.5 text-sm text-ink placeholder:text-ink-faint pointer-coarse:h-11"
                        />
                      </label>
                    {/each}
                  </div>
                {/if}
              </NewProjectSection>

              <NewProjectSection id="section-details" number="04" title="Details" helper="Optional" last={true}>
                <div class="grid gap-4 sm:grid-cols-[260px_minmax(0,1fr)]">
                  <div class="flex flex-col gap-1.5">
                    <label for="projectNumber" class={labelClass}>Project number</label>
                    <input id="projectNumber" bind:value={projectNumber} placeholder="For example, P01-A" class="field-control h-9 w-full rounded-md px-2.5 text-sm text-ink placeholder:text-ink-faint pointer-coarse:h-11" aria-invalid={!projectNumberValid} />
                    {#if !projectNumberValid}
                      <p class="text-xs text-danger-ink-muted" role="alert">Use 1 to 20, a letter a to z, or both, like 2a.</p>
                    {/if}
                  </div>
                  <div class="flex flex-col gap-1.5">
                    {#if allTags.length > 0}
                      <TagPicker {allTags} bind:selectedTagIds />
                    {/if}
                  </div>
                  <label class="flex flex-col gap-1.5 sm:col-span-2">
                    <span class={labelClass}>SR&ED title</span>
                    <input id="sredTitle" bind:value={sredTitle} placeholder="Optional. You can set it later." class="field-control h-9 w-full rounded-md px-2.5 text-sm text-ink placeholder:text-ink-faint pointer-coarse:h-11" />
                  </label>
                </div>
              </NewProjectSection>

              <!-- H1, H2: How should we write it? as an inline section. -->
              {#if layout !== "desktop"}
              <section id="section-mode" data-new-project-section="section-mode" class="flex scroll-mt-4 flex-col gap-3.5" aria-labelledby="section-mode-title">
                <div class="flex items-baseline gap-2.5 border-t border-line-soft pt-[22px]">
                  <span class="font-mono text-xs leading-[22px] text-ink-faint" aria-hidden="true">05</span>
                  <h2 id="section-mode-title" class="text-[15px] leading-[22px] font-medium text-ink">
                    {mode === "review" ? "How should we review it?" : "How should we write it?"}
                  </h2>
                </div>
                {#if mode === "generate"}
                  <WriteModeCards bind:value={candidateMode} layout={layout === "tablet" ? "row" : "stack"} />
                {/if}
                {@render modelPicker()}
                <ul class="flex flex-col gap-1" data-bottom-checklist>
                  {#each checklist.filter((row) => row.state === "danger" || row.state === "warning") as row (row.id)}
                    <li class="text-[13px] text-danger-ink">{row.text}</li>
                  {/each}
                </ul>
              </section>
              {/if}
            </div>

            <!-- H1, H2: sticky bottom bar with the start button. -->
            {#if layout !== "desktop"}
            <div data-bottom-bar class="sticky bottom-0 z-10 mt-auto flex flex-col gap-2 border-t border-line-soft bg-surface px-4 py-3 sm:h-16 sm:flex-row sm:items-center sm:px-[88px] sm:py-0">
              <p class={`min-w-0 flex-1 truncate text-[13px] leading-[18px] ${firstBlocking ? "text-danger-ink" : "text-ink-secondary"}`} data-bottom-summary>
                {progress && committing ? progress : firstBlocking ? firstBlocking.text : readySummary}
              </p>
              <button
                type="button"
                bind:this={bottomStartButton}
                data-bottom-start
                disabled={blocked || committing}
                onclick={() => openStart(bottomStartButton)}
                class="flex h-12 w-full items-center justify-center gap-2 rounded-[10px] bg-fir px-5 text-sm font-medium text-white hover:bg-navy-light disabled:cursor-not-allowed disabled:opacity-50 sm:h-10 sm:w-auto"
              >
                {startLabel}
              </button>
            </div>
            {/if}
          </div>

          <!-- Right column (desktop): How should we write it? -->
          {#if layout === "desktop"}
          <aside data-right-column aria-label={mode === "review" ? "How should we review it?" : "How should we write it?"} class="flex w-[360px] shrink-0 flex-col gap-3 border-l border-line-soft bg-canvas px-6 pt-7 pb-6">
            <div class="sticky top-7 flex flex-col gap-3">
              <h2 class="text-[15px] leading-[22px] font-medium text-ink">{mode === "review" ? "How should we review it?" : "How should we write it?"}</h2>
              {#if mode === "generate"}
                <WriteModeCards bind:value={candidateMode} />
              {/if}
              {@render modelPicker()}
              <div class="mt-2.5">
                <StartChecklist
                  rows={checklist}
                  {startLabel}
                  busy={committing}
                  busyLabel={committing && progress ? progress : null}
                  note={startNote}
                  bind:startButton
                  onStart={() => openStart(startButton)}
                  onAction={scrollToTarget}
                />
              </div>
            </div>
          </aside>
          {/if}
        </div>
      </div>

      <input
        bind:this={transcriptInput}
        type="file"
        accept={TRANSCRIPT_ACCEPT}
        multiple
        class="hidden"
        data-transcript-input
        onchange={(e) => {
          if (e.currentTarget.files?.length) handleTranscriptFiles(Array.from(e.currentTarget.files));
          e.currentTarget.value = "";
        }}
      />
      <input
        bind:this={pdInput}
        type="file"
        accept={SUPPORTED_ACCEPT}
        class="hidden"
        data-written-pd-input
        onchange={(e) => {
          const file = e.currentTarget.files?.[0];
          if (file) handlePdFile(file);
          e.currentTarget.value = "";
        }}
      />
      <input
        bind:this={docsInput}
        type="file"
        accept={mode === "review" ? `${SUPPORTED_ACCEPT},.vtt,.srt` : SUPPORTED_ACCEPT}
        multiple
        class="hidden"
        data-supporting-input
        onchange={(e) => {
          if (e.currentTarget.files?.length) addSupportingFiles(Array.from(e.currentTarget.files));
          e.currentTarget.value = "";
        }}
      />
      <input
        bind:this={replaceInput}
        type="file"
        accept={SUPPORTED_ACCEPT}
        class="hidden"
        data-replace-input
        onchange={(e) => {
          const file = e.currentTarget.files?.[0];
          if (file && replacingDocId) docs.replace(replacingDocId, file);
          replacingDocId = null;
          e.currentTarget.value = "";
        }}
      />

      <SupportingDocPreview
        bind:open={previewOpen}
        doc={previewDoc}
        onRemove={() => previewId && removeDoc(previewId)}
        onReplace={() => previewId && replaceDoc(previewId)}
      />
      <SupportingDocPreview
        bind:open={pdPreviewOpen}
        doc={pdPreviewDoc}
        onRemove={() => {
          pdPreviewOpen = false;
          pdDoc = null;
          pdNameHint = "";
        }}
        onReplace={() => {
          pdPreviewOpen = false;
          pdInput?.click();
        }}
      />
      <StartRunDialog
        bind:open={startOpen}
        mode={mode === "review" ? "review" : candidateMode}
        sources={dialogSources}
        models={dialogModels}
        busy={committing}
        validate={validateExcluded}
        onConfirm={confirmStart}
        returnFocus={() => lastStartTrigger}
      />
    {/snippet}
  </WorkspaceChrome>
{/if}
