<script lang="ts" module>
  // PSOS-04: one outbox-flush attempt per user per project per app session.
  // Module-local so re-entering the route doesn't re-fire it. Keyed by user as
  // well as project because a session can change hands without a sign-out (an
  // expiry, then a different person signs in) — keying on project alone would
  // silently skip the second user's own queued failures.
  const flushedOutboxProjects = new Set<string>();
</script>

<script lang="ts">
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import WorkspaceShell from "$lib/components/workspace/WorkspaceShell.svelte";
  import WorkspaceShellControls from "$lib/components/workspace/WorkspaceShellControls.svelte";
  import { page } from "$app/state";
  import { useConvexClient, useQuery, useMutation, useAction } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { scale } from "svelte/transition";
  import { overlayFade, modalPop } from "$lib/motion";
  import { api } from "../../../../convex/_generated/api";
  import type { Id } from "../../../../convex/_generated/dataModel";
  import ProjectStateBadge from "$lib/components/dashboard/ProjectStateBadge.svelte";
  import Button from "$lib/components/ui/Button.svelte";
  import Spinner from "$lib/components/ui/Spinner.svelte";
  import ChatIcon from "$lib/components/ui/ChatIcon.svelte";
  import GenerationProgress from "$lib/components/generation/GenerationProgress.svelte";
  import CandidateSelection from "$lib/components/generation/CandidateSelection.svelte";
  import GenerationStatusChip from "$lib/components/generation/GenerationStatusChip.svelte";
  import IterativeStepper from "$lib/components/generation/IterativeStepper.svelte";
  import Editor from "$lib/components/editor/Editor.svelte";
  import type {
    CommentRange,
    ResearchSelection,
    WriterEditorHandle,
  } from "$lib/components/editor/types";
  import QAScorePanel from "$lib/components/editor/QAScorePanel.svelte";
  import QARailPanel from "$lib/components/qa/QARailPanel.svelte";
  import QALauncher from "$lib/components/qa/QALauncher.svelte";
  import Tooltip from "$lib/components/ui/Tooltip.svelte";
  import ChronologyTable from "$lib/components/editor/ChronologyTable.svelte";
  import ModelTestSummary from "$lib/components/editor/ModelTestSummary.svelte";
  import FilesPanel from "$lib/components/editor/FilesPanel.svelte";
  import Disclosure from "$lib/components/ui/Disclosure.svelte";
  import DisclosureChevron from "$lib/components/ui/DisclosureChevron.svelte";
  import { normalizeExtractedText } from "$lib/parseDocument";
  import { projectPagingPosition } from "$lib/workspace/projectPagingContext";
  import ProjectHighlights from "$lib/components/project/ProjectHighlights.svelte";
  import FilingReadinessPanel from "$lib/components/evidence/FilingReadinessPanel.svelte";
  import LogsPanel from "$lib/components/editor/LogsPanel.svelte";
  import CommentOverlay from "$lib/components/comments/CommentOverlay.svelte";
  import AgentChatPanel from "$lib/components/chat/AgentChatPanel.svelte";
  import VersionHistory from "$lib/components/history/VersionHistory.svelte";
  import EditableText from "$lib/components/project/EditableText.svelte";
  import PdReviewReport from "$lib/components/review-pd/PdReviewReport.svelte";
  import PdReviewStart from "$lib/components/review-pd/PdReviewStart.svelte";
  import TagPicker from "$lib/components/project-new/TagPicker.svelte";
  import SelectInput from "$lib/components/ui/SelectInput.svelte";
  import IndustryField from "$lib/components/project/IndustryField.svelte";
  import FiscalYearField from "$lib/components/project/FiscalYearField.svelte";
  import ScienceCodeField from "$lib/components/project/ScienceCodeField.svelte";
  import ExportValidationDialog from "$lib/components/export/ExportValidationDialog.svelte";
  import {
    canonicalizeExportPreflight,
    isSameExportRevision,
    validateExport,
    type CanonicalExportReport,
    type ExportValidationResult,
  } from "$lib/exportValidation";
  import { userErrorCode, userErrorMessage } from "$lib/errors";
  import { flushOutboxFor } from "$lib/uploads/outboxFlush";
  import { toast } from "svelte-sonner";
  import { comparePairFromSlots, type CandidateModelId } from "../../../../shared/generationModels";
  import ComparePairPicker from "$lib/components/generation/ComparePairPicker.svelte";
  import SingleModelPicker from "$lib/components/generation/SingleModelPicker.svelte";
  import GhostCompareDialog from "$lib/components/generation/GhostCompareDialog.svelte";
  import { displayName } from "$lib/displayName";
  import {
    PROJECT_TYPE_LABELS,
    effectiveProjectType,
  } from "../../../../shared/projectTypes";

  const auth = useAuth();
  // New-UI shell wiring (2026-08-10): same contract WorkspaceChrome uses —
  // rail visibility, drawer, and rail destinations for the report workspace.
  let navigationOpen = $state(false);
  let railHidden = $state(false);
  const shellConfigQ = useQuery(api.myWork.getViewConfig, () => (auth.isAuthenticated ? {} : "skip"));
  const myWorkAvailable = $derived(Boolean(shellConfigQ.data?.ready && !shellConfigQ.data?.killSwitch));
  function workspaceHref(pathname: "/my-work" | "/projects") {
    const url = new URL(page.url);
    url.searchParams.delete("view");
    url.searchParams.delete("workspace");
    return `${resolve(pathname)}${url.search}`;
  }
  const currentDashboardHref = $derived.by(() => {
    const url = new URL(page.url);
    url.searchParams.set("workspace", "current");
    return `${url.pathname}${url.search}`;
  });
  const convex = useConvexClient();
  const projectId = $derived(page.params.id as Id<"projects">);

  const projectQ = useQuery(api.projects.getProject, () =>
    auth.isAuthenticated ? { projectId } : "skip"
  );
  const reportQ = useQuery(api.reports.getLatestReport, () =>
    auth.isAuthenticated ? { projectId } : "skip"
  );
  const generationQ = useQuery(api.generations.getLatestGeneration, () =>
    auth.isAuthenticated ? { projectId } : "skip"
  );
  const transcriptQ = useQuery(api.transcripts.getTranscript, () =>
    auth.isAuthenticated ? { projectId } : "skip"
  );
  const userQ = useQuery(api.users.getCurrentUser, () =>
    auth.isAuthenticated ? {} : "skip"
  );
  const commentsQ = useQuery(api.comments.listComments, () =>
    auth.isAuthenticated && reportQ.data
      ? { projectId, reportId: reportQ.data._id }
      : "skip"
  );
  const viewSummaryQ = useQuery(api.reportViews.getViewSummary, () =>
    auth.isAuthenticated ? { projectId } : "skip"
  );
  // BNH-39: review-mode projects show the AI feedback report on the written PD.
  const pdReviewQ = useQuery(api.pdReviews.getLatestPdReview, () =>
    auth.isAuthenticated ? { projectId } : "skip"
  );
  const tagsQ = useQuery(api.tags.listTags, () =>
    auth.isAuthenticated ? {} : "skip"
  );
  // 2026-08-11 (second) amendment: a review project links back to the source
  // project it reviews. Gated on sourceProjectId so non-review projects (the
  // overwhelming majority) subscribe to nothing extra.
  const sourceProjectQ = useQuery(api.projects.getProject, () =>
    auth.isAuthenticated && projectQ.data?.sourceProjectId
      ? { projectId: projectQ.data.sourceProjectId }
      : "skip"
  );

  const generateReport = useMutation(api.generations.requestGeneration);
  const recordUploadAttempts = useMutation(api.uploadAttempts.recordUploadAttempts);
  const logPdReviewEvent = useMutation(api.pdReviews.logPdReviewEvent);
  const updateReport = useMutation(api.reports.updateReportContent);
  const createSnapshot = useMutation(api.snapshots.createManualSnapshot);
  const markProposalApplied = useMutation(api.chatV2.markProposalApplied);
  const updateTitles = useMutation(api.projects.updateProjectTitles);
  const updateProjectNumber = useMutation(api.projects.setProjectNumber);
  // Per-company project number / draft letter (2026-08-11 amendment).
  // Mirrors the server rule: "1".."20", a letter "A".."Z", or combined "2A".
  const PROJECT_NUMBER_PATTERN = /^(?:[1-9][0-9]?[A-Z]?|[A-Z])$/;
  let projectNumberError = $state("");
  async function saveProjectNumber(value: string) {
    projectNumberError = "";
    const next = value.trim().toUpperCase();
    const numericPart = next.match(/^[0-9]+/)?.[0];
    if (
      next &&
      (!PROJECT_NUMBER_PATTERN.test(next) ||
        (numericPart !== undefined && Number(numericPart) > 20))
    ) {
      projectNumberError = "Use 1–20, a letter A–Z, or combined like 2A.";
      return;
    }
    try {
      await updateProjectNumber({
        projectId,
        projectNumber: next || undefined,
      });
    } catch (error) {
      projectNumberError = userErrorMessage(
        error,
        "The project number could not be updated."
      );
    }
  }
  const updateProjectTags = useMutation(api.projects.updateProjectTags);
  const authorizeExport = useMutation(api.reports.authorizeExport);
  const completeExport = useMutation(api.reports.completeExport);
  const failExport = useMutation(api.reports.failExport);
  const publishForReview = useMutation(api.projects.publishForReview);
  // 2026-08-11 (second) amendment: start PD-review mode from this project's
  // written report — creates the associated review project (inherited title,
  // writer, documents, transcript; report snapshot as the PD under review)
  // and navigates to it. The AI review is already running when we arrive.
  const createReviewFromProject = useAction(api.reviewFromProject.createReviewFromProject);
  let startingReview = $state(false);
  async function handleStartAiReview() {
    if (startingReview) return;
    startingReview = true;
    try {
      const { projectId: reviewProjectId } = await createReviewFromProject({
        projectId,
      });
      await goto(`/project/${reviewProjectId}`);
    } catch (error) {
      toast.error(
        userErrorMessage(error, "The AI review could not be started.")
      );
    } finally {
      startingReview = false;
    }
  }

  const project = $derived(projectQ.data);
  const report = $derived(reportQ.data);
  const generation = $derived(generationQ.data);
  const transcript = $derived(transcriptQ.data);
  const user = $derived(userQ.data);
  const canShare = $derived(
    Boolean(
      project &&
        user &&
        (project.createdBy === user._id || user.role === "admin")
    )
  );
  const viewSummary = $derived(viewSummaryQ.data);
  const pdReview = $derived(pdReviewQ.data);
  const allTags = $derived(tagsQ.data ?? []);
  const writerLabel = $derived(project?.writer?.trim() || "Unknown writer");
  const interviewerLabel = $derived(project?.interviewer?.trim() || null);
  const interviewees = $derived(
    (project?.interviewees ?? []).map((name) => name.trim()).filter(Boolean)
  );

  let editorRef: WriterEditorHandle | null = $state(null);
  let lastSnapshotAt = 0;
  let saving = $state(false);
  let saveError = $state("");
  let localRevision = $state(0);
  let pendingSaves = 0;
  let saveChain: Promise<void> = Promise.resolve();
  let showHistory = $state(false);
  // Iterative-mode cancel (button lives in the PageBar; modal below).
  let confirmCancelIterative = $state(false);
  let cancellingIterative = $state(false);
  const cancelIterativeMut = useMutation(api.generations.cancelIterativeGeneration);
  const requestReportQaMut = useMutation(api.generations.requestReportQa);

  // Section-by-section vs one-shot comparison (iterative mode only).
  let ghostCompareOpen = $state(false);
  const ghostSnapshotQ = useQuery(api.snapshots.getGhostSnapshot, () =>
    generationQ.data?.candidateMode === "iterative" &&
    generationQ.data.status === "completed"
      ? { generationId: generationQ.data._id }
      : "skip"
  );
  const ghostSnapshot = $derived(ghostSnapshotQ.data ?? null);
  async function cancelIterative() {
    if (cancellingIterative || !generation) return;
    cancellingIterative = true;
    try {
      await cancelIterativeMut({ generationId: generation._id });
    } catch (e) {
      console.error(e);
      toast.error(userErrorMessage(e, "The draft could not be cancelled."));
    } finally {
      cancellingIterative = false;
      confirmCancelIterative = false;
    }
  }
  let pendingHighlight = $state<{
    from: number;
    to: number;
    text: string;
    x?: number;
    y?: number;
  } | null>(null);
  let copied = $state(false);
  let sharing = $state(false);
  let shareError = $state("");
  let shareLink = $state("");
  let exporting = $state(false);
  let hoveredCommentId = $state<string | null>(null);
  let pendingChatHighlight = $state<{
    from: number;
    to: number;
    text: string;
  } | null>(null);
  let pendingResearch = $state<ResearchSelection | null>(null);
  let exportValidation = $state<ExportValidationResult | null>(null);
  let exportError = $state("");
  let pendingExport = $state<Readonly<CanonicalExportReport> | null>(null);
  let workspaceMaximized = $state(false);
  let candidateMaximized = $state(false);
  let generationError = $state("");
  // string[] (not Id<"tags">[]) so it can bind into the shared TagPicker.
  let selectedTagIds = $state<string[]>([]);
  let tagsSaving = $state(false);
  let tagError = $state("");

  // BNH-30: one-by-one replace-and-scan-next session.
  type ReplaceMatch = { from: number; to: number; replaceWith: string; text: string };
  type ReplaceSession = {
    pairs: { find: string; replaceWith: string }[];
    // chatMessages id (legacy chat) or chatProposals id (agent chat).
    messageId: string;
    cursor: number;
    total: number;
    position: number;
    current: ReplaceMatch | null;
    replaced: number;
  };
  let replaceSession = $state<ReplaceSession | null>(null);
  let replaceNotice = $state<string | null>(null);
  function notifyReplace(msg: string) {
    replaceNotice = msg;
    setTimeout(() => (replaceNotice = null), 4000);
  }

  function markApplied(id: string) {
    return markProposalApplied({ proposalId: id as Id<"chatProposals"> });
  }

  function startReplaceReview(
    pairs: { find: string; replaceWith: string }[],
    messageId: string
  ) {
    const ed = editorRef;
    if (!ed || !report) return;
    const matches = ed.findReplaceMatches(pairs);
    if (matches.length === 0) {
      notifyReplace(
        `No matching passage remains for “${pairs[0]?.find ?? "this suggestion"}”. The report may have changed; refine or ask again.`
      );
      return;
    }
    // Snapshot once so the whole stepping pass can be undone.
    createSnapshot({ reportId: report._id, reason: "manual" }).catch(() => {});
    const first = matches[0];
    ed.highlightRange(first.from, first.to, first.text);
    replaceSession = {
      pairs,
      messageId,
      cursor: 0,
      total: matches.length,
      position: 1,
      current: first,
      replaced: 0,
    };
  }

  function advanceReplace(cursor: number, addedReplaced: number) {
    const sess = replaceSession;
    const ed = editorRef;
    if (!sess || !ed) return;
    const next =
      ed.findReplaceMatches(sess.pairs).find((m) => m.from >= cursor) ?? null;
    const replaced = sess.replaced + addedReplaced;
    if (next) {
      ed.highlightRange(next.from, next.to, next.text);
      replaceSession = { ...sess, cursor, position: sess.position + 1, current: next, replaced };
    } else {
      ed.clearHighlight();
      if (replaced > 0) markApplied(sess.messageId).catch(() => {});
      replaceSession = null;
    }
  }

  function replaceAndNext() {
    const sess = replaceSession;
    const ed = editorRef;
    if (!sess?.current || !ed) return;
    ed.replaceRange(sess.current.from, sess.current.to, sess.current.replaceWith);
    advanceReplace(sess.current.from + sess.current.replaceWith.length, 1);
  }

  function keepOriginalAndNext() {
    const sess = replaceSession;
    if (!sess?.current) return;
    advanceReplace(sess.current.to, 0);
  }

  function replaceAllRemaining() {
    const sess = replaceSession;
    const ed = editorRef;
    if (!sess || !ed) return;
    let cursor = sess.current ? sess.current.from : sess.cursor;
    let replaced = sess.replaced;
    for (let i = 0; i < 5000; i++) {
      const m = ed.findReplaceMatches(sess.pairs).find((x) => x.from >= cursor);
      if (!m) break;
      ed.replaceRange(m.from, m.to, m.replaceWith);
      cursor = m.from + m.replaceWith.length;
      replaced++;
    }
    ed.clearHighlight();
    if (replaced > 0) markApplied(sess.messageId).catch(() => {});
    replaceSession = null;
  }

  function endReplaceReview() {
    editorRef?.clearHighlight();
    replaceSession = null;
  }

  /** Jump to the exact paragraph identified by the QA agent's [P#] marker. */
  function locateGap(gap: { section: string; paragraph: number | null }) {
    editorRef?.locateSectionParagraph(gap.section, gap.paragraph);
  }

  function handleAskAI(selection: { from: number; to: number; text: string }) {
    chatOpen = true; // make sure the panel is visible before the pill lands
    pendingChatHighlight = selection;
  }

  function handleResearch(selection: ResearchSelection) {
    chatOpen = true;
    qaOpen = false;
    railView = "chat";
    pendingChatHighlight = null;
    pendingResearch = selection;
  }

  // BNH-14: resizable, closable chat rail. Width + open state persist across
  // sessions (localStorage). Drag clamps keep both panes usable: chat never
  // narrower than 24% nor wider than 55% of the workspace. (2026-07-03: the
  // rail stays right-docked and resizable; only open/close changed — the
  // panel now pops up from the bottom instead of sliding in from the side.)
  const CHAT_MIN = 0.24;
  const CHAT_MAX = 0.55;
  let chatRatio = $state(0.31);
  let chatOpen = $state(true);
  let chatFocus = $state(false);
  let mobileWorkspaceView = $state<"report" | "assistant">("report");
  let projectDetailsOpen = $state(false);
  const projectDetailsBodyId = "project-details-body";
  // Intake workbench (2026-08-08 Obvious-parity amendment): the NO-REPORT
  // state mirrors the report workbench's split — a persistent left CONTEXT
  // pane (files evidence + interview transcript) beside the primary intake/
  // generation work surface, replacing the single 768px long-scroll column
  // whose ~27k-px transcript owned the page scroll. Same clamps and resize
  // grammar as the assistant rail; its own persisted key so the two splits
  // stay independent. No chat is implied anywhere in this state.
  let contextRatio = $state(0.31);
  // The context pane is closable on desktop (2026-08-13): same open/reopen
  // grammar as the assistant rail — close control inside the pane, reopen
  // control at the far left of the page bar, width animating to 0. Persisted
  // under its own key; the mobile Work/Context switch is independent.
  let contextOpen = $state(true);
  let mobileIntakeView = $state<"work" | "context">("work");
  // Review-mode projects (client meeting 2026-08-10): the written PD and its
  // feedback report are the focus, so the interview transcript collapses to a
  // compact disclosure row by default — one click to expand. Generate-mode
  // projects keep the always-visible transcript.
  let reviewTranscriptOpen = $state(false);
  const reviewTranscriptBodyId = "review-transcript-body";
  // Review workbench (2026-08-13): the verdict leads the work pane, so the
  // metadata grid demotes into a collapsed disclosure. The page bar already
  // carries the route's h1 title.
  // List-context paging (2026-08-13, Attio-research P1): position of this
  // project inside the bounded page the invoking Projects surface stashed.
  // Recomputed per projectId; null when the reader arrived another way.
  const pagingPosition = $derived(projectPagingPosition(projectId));
  const transcriptWordCount = $derived(
    transcript?.content
      ? transcript.content.trim().split(/\s+/).filter(Boolean).length
      : 0
  );
  let intakeEl: HTMLDivElement | null = $state(null);
  let contextDragging = $state(false);
  // BNH-47: QA rail panel — independent toggle; opening either closes the
  // other so the right rail hosts one passive-review surface at a time.
  let qaOpen = $state(false);
  // Which card occupies the rail (also while both are closed, for the sink
  // animation and so exactly one card is in flow at a time).
  let railView = $state<"chat" | "qa">("chat");
  let workspaceEl: HTMLDivElement | null = $state(null);
  let dragging = $state(false);

  // Send any upload failures this user queued while offline. Page-level rather
  // than inside FilesPanel so it runs in every state of the page, including the
  // ones that render no files panel at all.
  $effect(() => {
    const userId = userQ.data?._id;
    if (!userId) return;
    const flushKey = `${userId}:${projectId}`;
    if (flushedOutboxProjects.has(flushKey)) return;
    // Added synchronously so a reactive re-run cannot double-fire it.
    flushedOutboxProjects.add(flushKey);
    void flushOutboxFor(userId, projectId, (attempts) =>
      recordUploadAttempts({ projectId, attempts })
    );
  });

  $effect(() => {
    // Restore once from locals only — reading component state here would make
    // this effect re-run on every toggle and stomp the user's click.
    const r = localStorage.getItem("banhall_chat_ratio");
    if (r) chatRatio = Math.min(CHAT_MAX, Math.max(CHAT_MIN, parseFloat(r)));
    const c = localStorage.getItem("banhall_intake_context_ratio");
    if (c) contextRatio = Math.min(CHAT_MAX, Math.max(CHAT_MIN, parseFloat(c)));
    contextOpen = localStorage.getItem("banhall_intake_context_open") !== "0";
    const savedQa = localStorage.getItem("banhall_qa_open") === "1";
    chatOpen = !savedQa && localStorage.getItem("banhall_chat_open") !== "0";
    qaOpen = savedQa;
    if (savedQa) railView = "qa";
    workspaceMaximized = localStorage.getItem("banhall_project_editor_maximized") === "1";
    candidateMaximized = localStorage.getItem("banhall_candidate_editor_maximized") === "1";
  });
  $effect(() => {
    localStorage.setItem("banhall_chat_ratio", String(chatRatio));
    localStorage.setItem("banhall_intake_context_ratio", String(contextRatio));
    localStorage.setItem("banhall_intake_context_open", contextOpen ? "1" : "0");
    localStorage.setItem("banhall_chat_open", chatOpen ? "1" : "0");
    localStorage.setItem("banhall_qa_open", qaOpen ? "1" : "0");
    localStorage.setItem("banhall_project_editor_maximized", workspaceMaximized ? "1" : "0");
    localStorage.setItem("banhall_candidate_editor_maximized", candidateMaximized ? "1" : "0");
  });

  $effect(() => {
    function onMove(e: MouseEvent) {
      if (!dragging || !workspaceEl) return;
      const rect = workspaceEl.getBoundingClientRect();
      const ratio = (e.clientX - rect.left) / rect.width;
      chatRatio = Math.min(CHAT_MAX, Math.max(CHAT_MIN, ratio));
    }
    function onUp() {
      if (dragging) {
        dragging = false;
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
      }
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  });

  function startDrag(e: MouseEvent) {
    e.preventDefault();
    dragging = true;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
  }
  function adjustRail(delta: number) {
    chatRatio = Math.min(CHAT_MAX, Math.max(CHAT_MIN, chatRatio + delta));
  }

  // Intake context-pane resize — same drag/keyboard grammar as the assistant
  // rail, tracked separately so the intake split never fights the chat split.
  $effect(() => {
    function onMove(e: MouseEvent) {
      if (!contextDragging || !intakeEl) return;
      const rect = intakeEl.getBoundingClientRect();
      const ratio = (e.clientX - rect.left) / rect.width;
      contextRatio = Math.min(CHAT_MAX, Math.max(CHAT_MIN, ratio));
    }
    function onUp() {
      if (contextDragging) {
        contextDragging = false;
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
      }
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  });
  function startContextDrag(e: MouseEvent) {
    e.preventDefault();
    contextDragging = true;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
  }
  function adjustContext(delta: number) {
    contextRatio = Math.min(CHAT_MAX, Math.max(CHAT_MIN, contextRatio + delta));
  }


  // Build comment ranges for editor highlights (only unresolved comments)
  const commentRanges: CommentRange[] = $derived(
    (commentsQ.data ?? [])
      .filter((c) => !c.resolved)
      .map((c) => ({
        id: c._id,
        from: c.highlightFrom,
        to: c.highlightTo,
        text: c.highlightText,
        isClient: c.commenterType === "client",
      }))
  );

  $effect(() => {
    if (!auth.isLoading && !auth.isAuthenticated) {
      goto("/login", { replaceState: true });
    }
  });
  $effect(() => {
    if (report && pendingSaves === 0) localRevision = report.revisionNumber ?? 0;
  });
  $effect(() => {
    if (project) selectedTagIds = [...(project.tagIds ?? [])];
  });

  // Persist every TagPicker toggle; on failure re-sync from the server row.
  async function handleTagsChange(ids: string[]) {
    if (!project) return;
    tagsSaving = true;
    tagError = "";
    try {
      await updateProjectTags({ projectId, tagIds: ids as Id<"tags">[] });
    } catch (error) {
      selectedTagIds = [...(project.tagIds ?? [])];
      tagError = userErrorMessage(error, "The project tags could not be updated.");
    } finally {
      tagsSaving = false;
    }
  }


  async function handleEditorUpdate(json: string) {
    if (!report) return;
    const reportId = report._id;
    pendingSaves += 1;
    saving = true;
    saveError = "";
    const save = async () => {
      // Take a restore-point checkpoint of the prior state at most once every
      // 5 minutes of active editing (deduped + log-thinned server-side).
      const now = Date.now();
      if (now - lastSnapshotAt > 300_000) {
        lastSnapshotAt = now;
        createSnapshot({ reportId, reason: "manual" }).catch(() => {});
      }
      localRevision = await updateReport({
        reportId,
        content: json,
        expectedRevisionNumber: localRevision,
      });
    };
    saveChain = saveChain.then(save, save);
    try {
      await saveChain;
    } catch (error) {
      saveError = userErrorMessage(error, "The report could not be saved.");
    } finally {
      pendingSaves -= 1;
      saving = pendingSaves > 0;
    }
  }
  async function flushEditor(): Promise<number> {
    await editorRef?.flushPendingSave();
    await saveChain;
    if (saveError) throw new Error(saveError);
    return localRevision;
  }

  // BNH-45: writer-tunable report length (client email — shorter for quick
  // review, full to write right up to the CRA line limits).
  // string (not the literal union) so it can bind:value into SelectInput;
  // the items list gates the values. Cast where the mutation needs the union.
  let lengthTarget = $state<string>("standard");
  let candidateMode = $state<"compare" | "single" | "iterative">("compare");
  let singleModelId = $state<CandidateModelId | "">("");
  // Compare mode runs exactly 2 models — two slots, each a model or Random.
  let compareSlotA = $state("");
  let compareSlotB = $state("");

  // BNH-52: a completed test never re-runs silently — confirm modal first,
  // then the mutation is called with force. Prior results stay (report
  // versions + "generated" snapshots + generation rows are never deleted).
  let confirmRegenerate = $state<"transcript" | "review" | null>(null);
  const requiresRegenerationConfirmation = $derived(
    Boolean(report) ||
      generation?.status === "completed" ||
      generation?.status === "awaiting_selection"
  );

  async function runGenerate(source: "transcript" | "review", force: boolean) {
    if (!transcript) return;
    confirmRegenerate = null;
    generationError = "";
    if (source === "review") {
      // BNH-39: comparison draft from the review report — logged, then the
      // normal generation flow takes over.
      logPdReviewEvent({
        projectId,
        ...(pdReview ? { reviewId: pdReview._id } : {}),
        action: "generate_from_review",
      }).catch(() => {});
    }
    try {
      await generateReport({
        projectId,
        transcriptId: transcript._id,
        lengthTarget: lengthTarget as "concise" | "standard" | "full",
        candidateMode,
        ...(candidateMode !== "compare" && singleModelId
          ? { singleModelId }
          : {}),
        ...(candidateMode === "compare"
          ? (() => {
              const pair = comparePairFromSlots(compareSlotA, compareSlotB);
              return pair ? { compareModelIds: pair } : {};
            })()
          : {}),
        ...(force ? { confirmRegeneration: true } : {}),
      });
    } catch (error) {
      generationError = userErrorMessage(
        error,
        "The report generation could not be started."
      );
    }
  }

  function handleRegenerate() {
    if (requiresRegenerationConfirmation) {
      confirmRegenerate = "transcript";
      return;
    }
    runGenerate("transcript", false);
  }

  function handleGenerateFromReview() {
    if (requiresRegenerationConfirmation) {
      confirmRegenerate = "review";
      return;
    }
    runGenerate("review", false);
  }

  async function handleCopyShareLink() {
    if (!project || !report || sharing) return;
    sharing = true;
    shareError = "";
    try {
      await publishForReview({ projectId, reportId: report._id });
      shareLink = `${window.location.origin}/review/${project.shareToken}`;
    } catch (error) {
      shareError = userErrorMessage(
        error,
        "The report could not be published for client review."
      );
    } finally {
      sharing = false;
    }
  }

  async function copyPublishedReviewLink() {
    if (!shareLink) return;
    shareError = "";
    try {
      await navigator.clipboard.writeText(shareLink);
      copied = true;
      setTimeout(() => (copied = false), 2000);
    } catch {
      shareError =
        "Automatic copy is unavailable. Select the review link and copy it manually.";
    }
  }

  function handleComment(selection: {
    from: number;
    to: number;
    text: string;
    x?: number;
    y?: number;
  }) {
    pendingHighlight = selection;
  }

  async function sha256Hex(value: string | Blob): Promise<string> {
    const bytes =
      typeof value === "string"
        ? new TextEncoder().encode(value)
        : new Uint8Array(await value.arrayBuffer());
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0")
    ).join("");
  }

  async function runExport(
    canonical: Readonly<CanonicalExportReport>,
    exportId: Id<"reportExports">
  ) {
    try {
      const year = canonical.fiscalYearEnd
        ? new Date(canonical.fiscalYearEnd).getFullYear()
        : new Date().getFullYear();
      const safeClient = canonical.clientName
        .replace(/[^a-zA-Z0-9\s\-]/g, "")
        .replace(/\s+/g, "_");
      // Lazy imports: file-saver touches browser globals at module init (SSR).
      const [{ exportToTemplateDocx }, { saveAs }] = await Promise.all([
        import("$lib/exportTemplateDocx"),
        import("file-saver"),
      ]);
      const blob = await exportToTemplateDocx(canonical);
      const [canonicalDtoHash, documentHash] = await Promise.all([
        sha256Hex(JSON.stringify(canonical)),
        sha256Hex(blob),
      ]);
      saveAs(blob, `${safeClient}_Schedule60_FY${year}.docx`);
      await completeExport({ exportId, canonicalDtoHash, documentHash });
      pendingExport = null;
    } catch (error) {
      const message = userErrorMessage(error, "The DOCX export failed.");
      await failExport({ exportId, failureCode: message }).catch(() => {});
      throw error;
    }
  }

  async function authorizeAndRunExport(
    canonical: Readonly<CanonicalExportReport>
  ) {
    exporting = true;
    exportError = "";
    try {
      const authorized = await authorizeExport({
        reportId: canonical.reportId as Id<"reports">,
        expectedRevisionNumber: canonical.revisionNumber,
        expectedContentHash: canonical.contentHash,
      });
      if (!isSameExportRevision(canonical, authorized)) {
        await failExport({
          exportId: authorized.exportId,
          failureCode: "stale_revision",
        }).catch(() => {});
        throw new Error(
          "The report changed after export preflight. Start the export again."
        );
      }
      await runExport(canonical, authorized.exportId);
    } catch (error) {
      // Filing-readiness and field gates come back as structured domain
      // errors — show them in the validation dialog, not a raw toast.
      const code = userErrorCode(error);
      if (code === "EVIDENCE_REQUIRED" || code === "INVALID_INPUT") {
        const label =
          code === "INVALID_INPUT" ? "Science code" : "Filing readiness";
        exportValidation = {
          errors: userErrorMessage(error, "The export is blocked.")
            .split("\n")
            .filter(Boolean)
            .map((message) => ({
              severity: "error" as const,
              field: "filing_readiness",
              label,
              message,
            })),
          warnings: [],
        };
      } else {
        exportError = userErrorMessage(error, "The export could not be completed.");
      }
    } finally {
      exporting = false;
    }
  }

  // Filing-readiness blockers surfaced BEFORE export instead of a raw server
  // error at authorize time (alerts: EVIDENCE_REQUIRED flag, Jul 17).
  // Deduped by code+message: getFilingReadiness emits one blocker per material
  // claim, all sharing code and message, and the modal shows no per-claim
  // detail — duplicates crashed the keyed each (alerts: each_key_duplicate,
  // Aug 18).
  let readinessBlockers = $state<Array<{ code: string; message: string }>>([]);
  function dedupeBlockers(
    blockers: Array<{ code: string; message: string }>
  ): Array<{ code: string; message: string }> {
    const seen = new Set<string>();
    return blockers.filter(({ code, message }) => {
      const key = `${code}:${message}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  async function handleExport() {
    if (!report) return;
    exporting = true;
    exportError = "";
    pendingExport = null;
    exportValidation = null;
    readinessBlockers = [];
    try {
      const readiness = await convex.query(api.projects.getProjectReadiness, {
        projectId,
        reportId: report._id,
      });
      if (readiness && !readiness.ready) {
        readinessBlockers = dedupeBlockers(readiness.blockers);
        return;
      }
      const flushedRevision = await flushEditor();
      const preflight = await convex.query(api.reports.preflightExport, {
        reportId: report._id,
      });
      if (preflight.revisionNumber !== flushedRevision) {
        throw new Error(
          "The report changed while export preflight was loading. Start the export again."
        );
      }
      const canonical = canonicalizeExportPreflight(preflight);
      const result = validateExport(canonical);
      if (result.errors.length > 0) {
        exportValidation = result;
        return;
      }
      if (result.warnings.length > 0) {
        pendingExport = canonical;
        exportValidation = result;
        return;
      }
      await authorizeAndRunExport(canonical);
    } catch (error) {
      exportError = userErrorMessage(error, "The export preflight could not be completed.");
    } finally {
      exporting = false;
    }
  }

  async function proceedAfterExportWarnings() {
    const canonical = pendingExport;
    pendingExport = null;
    exportValidation = null;
    if (canonical) await authorizeAndRunExport(canonical);
  }

  function cancelExportValidation() {
    pendingExport = null;
    exportValidation = null;
  }

  // Iterative (section-by-section) generations render the stepper for their
  // whole active life — including "running" (a section drafting) and
  // "awaiting_input" (writer reviewing) — instead of GenerationProgress or
  // CandidateSelection. "reserved"/pre-fan-out still shows the progress card
  // (the stepper has nothing to show until section runs exist).
  const isIterative = $derived(generation?.candidateMode === "iterative");
  const showIterativeStepper = $derived(
    isIterative &&
      (generation?.status === "running" || generation?.status === "awaiting_input")
  );
  const isGenerating = $derived(
    generation?.status === "reserved" ||
      (generation?.status === "running" && !isIterative)
  );
  const awaitingSelection = $derived(generation?.status === "awaiting_selection");
  // A failed generation gets the progress/retry view — except in review mode,
  // where the PD review stays the main view (its own retry CTA regenerates).
  const showFailedGeneration = $derived(
    generation?.status === "failed" && !report && project?.mode !== "review"
  );
  // The intake workbench renders when no report exists and nothing louder
  // (generation progress, selection, stepper) owns the page — the same
  // condition the template gates on, shared so the page-bar reopen control
  // cannot drift from the state it reopens.
  const showIntakeWorkbench = $derived(
    !report &&
      !isGenerating &&
      !awaitingSelection &&
      !showIterativeStepper &&
      !showFailedGeneration
  );
</script>

<svelte:window
  onkeydown={(e) => {
    if (e.key === "Escape" && chatFocus && !replaceSession) chatFocus = false;
    else if (e.key === "Escape" && chatOpen && !replaceSession) {
      chatOpen = false;
      mobileWorkspaceView = "report";
    }
  }}
/>

<!-- data-report-cohort marks every top-level state of the preview page so
     route-shape tests (and the rollback-purity sentinel) can tell the two
     report cohorts apart even while both sit in identical loading DOM. The
     frozen CurrentProjectPage must never carry this marker. -->
{#if auth.isLoading || !auth.isAuthenticated || project === undefined}
  <div class="flex flex-1 items-center justify-center bg-canvas" data-report-cohort="preview">
    <Spinner />
  </div>
{:else if project === null}
  <div class="flex flex-1 flex-col items-center justify-center gap-2 bg-canvas" data-report-cohort="preview">
    <h1 class="text-title text-gray-600">Project not found</h1>
    <a href="/dashboard" class="text-sm text-navy hover:underline">Back to dashboard</a>
  </div>
{:else}
  <!-- h-dvh (not h-screen): dynamic viewport units track mobile browser
       chrome, matching the workspace shell containment convention. -->
  <!-- New-UI shell (2026-08-10, owner direction): the report workspace sits
       in the light workspace shell — rail + ONE thin project header (Obvious
       anatomy: workflow + title + stage left, ghost actions right) replacing
       the classic dark AppNav + PageBar double band. -->
  <WorkspaceShell
    kind="chrome"
    theme="light"
    bind:navigationOpen
    bind:railHidden
    displayedView={null}
    {myWorkAvailable}
    myWorkHref={workspaceHref("/my-work")}
    projectsHref={workspaceHref("/projects")}
    {currentDashboardHref}
    onFocusSearch={() => void goto(workspaceHref("/projects"))}
    drawerDescription="Navigate between work, projects, and account pages."
  >
  <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-canvas" data-report-cohort="preview">

    {#snippet projectMetadata()}
      <div data-project-overview class="mb-5 border-b border-line-soft pb-4">
        <div class="flex min-w-0 items-center gap-3">
          <!-- headingLevel 2: the workspace bar below AppNav carries the page's
               single h1 (a11y P0 — one unambiguous main heading per route). -->
          <div class="min-w-0 flex-1">
            <EditableText
              value={project.title}
              placeholder="Set internal title"
              variant="heading"
              headingLevel={2}
              headingClass="text-xl font-medium tracking-tight text-ink"
              label="internal project title"
              required
              onSave={async (value) => {
                await updateTitles({ projectId, title: value.trim() });
              }}
            />
          </div>
          <button
            data-project-details-toggle
            type="button"
            onclick={() => (projectDetailsOpen = !projectDetailsOpen)}
            aria-expanded={projectDetailsOpen}
            aria-controls={projectDetailsBodyId}
            class="flex min-h-9 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-ink-muted transition-colors hover:bg-primary-wash hover:text-primary-selected focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy motion-reduce:transition-none pointer-coarse:min-h-11"
          >
            Project details
            <DisclosureChevron open={projectDetailsOpen} tone="neutral" class="size-3.5" />
          </button>
        </div>
        <!-- Highlights band (2026-08-13, Attio-research P1): the project's
             load-bearing facts at a glance, honest empties included.
             mt-5 (2026-08-19): the divider needs clear air below the title. -->
        <div class="mt-5">
          <ProjectHighlights {projectId} fiscalYearEnd={project.fiscalYearEnd ?? null} padBottom={projectDetailsOpen} />
        </div>
        <!-- Attribute rows (same amendment): the Attio record-page grammar —
             fixed label column + value per row — replacing the stacked
             label-over-value grid. Editing affordances are unchanged. The
             rows are progressively disclosed so the report remains primary. -->
        <Disclosure id={projectDetailsBodyId} open={projectDetailsOpen}>
          <!-- No top border here: a border on the collapsing body pops at the
               end of the Disclosure exit. The highlights band's own border
               and padding carry the separation in both states. -->
          <div data-project-details class="@container pt-1">
            <div class="grid grid-cols-1 gap-x-8 text-[13px] @2xl:grid-cols-2">
          <div class="grid min-h-9 grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-x-3 py-1 @md:grid-cols-[7.5rem_minmax(0,1fr)] @2xl:col-span-2">
            <span class="text-label">SR&amp;ED title</span>
            <div class="min-w-0">
              <EditableText
                value={project.sredTitle ?? ""}
                placeholder="Add the formal SR&ED title (finalize at the end)"
                label="SR&ED title"
                onSave={async (value) => {
                  await updateTitles({ projectId, sredTitle: value });
                }}
              />
            </div>
          </div>
          <div class="grid min-h-9 grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-x-3 py-1 @md:grid-cols-[7.5rem_minmax(0,1fr)]">
            <span class="text-label">Client</span>
            <p class="min-w-0 truncate text-gray-800">{project.clientName}</p>
          </div>
          <div class="grid min-h-9 grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-x-3 py-1 @md:grid-cols-[7.5rem_minmax(0,1fr)]">
            <!-- Domain truth (product-domain vocabulary): `project.writer` is
                 the writer metadata field, NOT the immutable Creator
                 (`projects.createdBy`). Labelling it "Created by" conflated
                 Writer with Creator; the field now says what it holds. -->
            <span class="text-label">Writer</span>
            <p class="min-w-0 truncate text-gray-800">{writerLabel}</p>
          </div>
          {#if interviewerLabel}
            <div class="grid min-h-9 grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-x-3 py-1 @md:grid-cols-[7.5rem_minmax(0,1fr)]">
              <span class="text-label">Interviewer</span>
              <p class="min-w-0 truncate text-gray-800">{interviewerLabel}</p>
            </div>
          {/if}
          {#if interviewees.length > 0}
            <div class="grid min-h-9 grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-x-3 py-1 @md:grid-cols-[7.5rem_minmax(0,1fr)]">
              <span class="text-label">Interviewees</span>
              <p class="min-w-0 text-gray-800">{interviewees.join(", ")}</p>
            </div>
          {/if}
          <div class="grid min-h-9 grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-x-3 py-1 @md:grid-cols-[7.5rem_minmax(0,1fr)]">
            <span class="text-label">Created</span>
            <p class="min-w-0 text-gray-800">
              {new Date(project.createdAt).toLocaleDateString("en-US", {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </p>
          </div>
          <div class="grid min-h-9 grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-x-3 py-1 @md:grid-cols-[7.5rem_minmax(0,1fr)]">
            <span class="text-label">Fiscal year-end</span>
            <div class="min-w-0">
              <FiscalYearField
                {projectId}
                fiscalYearEnd={project.fiscalYearEnd ?? null}
              />
            </div>
          </div>
          <div class="grid min-h-9 grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-x-3 py-1 @md:grid-cols-[7.5rem_minmax(0,1fr)]">
            <span class="text-label">Industry</span>
            <div class="min-w-0">
              <IndustryField
                {projectId}
                industry={project.industry ?? null}
                canCreate={user?.role === "admin"}
              />
            </div>
          </div>
          <div class="grid min-h-9 grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-x-3 py-1 @md:grid-cols-[7.5rem_minmax(0,1fr)]">
            <span class="text-label">Project #</span>
            <div class="min-w-0">
              <EditableText
                value={project.projectNumber ?? ""}
                placeholder="e.g. 2, A, or 2a"
                label="project number"
                onSave={saveProjectNumber}
              />
              {#if projectNumberError}
                <p class="mt-1 text-xs text-red-700" role="alert">{projectNumberError}</p>
              {/if}
            </div>
          </div>
          <div class="grid min-h-9 grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-x-3 py-1 @md:grid-cols-[7.5rem_minmax(0,1fr)]">
            <span class="text-label">Project type</span>
            <p class="min-w-0 truncate text-gray-800">
              {PROJECT_TYPE_LABELS[effectiveProjectType(project)]}
            </p>
          </div>
          <div class="grid min-h-9 grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-x-3 py-1 @md:grid-cols-[7.5rem_minmax(0,1fr)]">
            <span class="text-label">Science code</span>
            <div class="min-w-0">
              <ScienceCodeField
                {projectId}
                scienceCode={project.scienceCode ?? null}
              />
            </div>
          </div>
          {#if project.sourceProjectId}
            <!-- 2026-08-11 (second) amendment: navigational association only —
                 the review project links to the project it reviews. -->
            <div class="grid min-h-9 grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-x-3 py-1 @md:grid-cols-[7.5rem_minmax(0,1fr)]">
              <span class="text-label">Reviews</span>
              <p class="min-w-0 truncate">
                <a
                  href={`/project/${project.sourceProjectId}`}
                  class="text-sm text-primary-selected hover:underline"
                >
                  {sourceProjectQ.data?.title ?? "Open source project"}
                </a>
              </p>
            </div>
          {/if}
          <div class="grid min-h-9 grid-cols-[6.5rem_minmax(0,1fr)] items-start gap-x-3 py-1 @md:grid-cols-[7.5rem_minmax(0,1fr)] @2xl:col-span-2">
            <span class="text-label pt-1.5">
              Tags{#if tagsSaving}<span class="ml-2 normal-case tracking-normal text-ink-muted">Saving…</span>{/if}
            </span>
            <div class="min-w-0">
              <TagPicker
                {allTags}
                bind:selectedTagIds
                label={null}
                onChange={handleTagsChange}
              />
              {#if tagError}
                <p class="mt-1 text-xs text-red-700" role="alert">{tagError}</p>
              {/if}
            </div>
          </div>
        </div>
        {#if viewSummary && viewSummary.totalViews > 0}
          <div class="mt-3 flex flex-wrap items-center gap-3">
            <div class="flex items-center gap-1.5 text-xs text-ink-muted">
              <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
              {viewSummary.totalViews} view{viewSummary.totalViews !== 1 ? "s" : ""}
            </div>
            {#each viewSummary.uniqueViewers as viewer (`${viewer.name}-${viewer.type}`)}
              <span class="inline-flex items-center gap-1 rounded-full bg-chrome px-2 py-0.5 text-xs text-gray-500">
                {viewer.name}
                <span class="text-ink-muted">
                  {new Date(viewer.lastViewed).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })}
                </span>
              </span>
            {/each}
          </div>
        {/if}
          </div>
        </Disclosure>
      </div>
    {/snippet}

    <!-- Page bar — the second band of the dense two-level workspace header
         (Obvious anatomy: ~54px app bar + 44px project bar). It carries the
         page's SINGLE h1 project title beside the workflow control so every
         generation state keeps one unambiguous main heading (a11y P0). -->
    <header data-workspace-page-header class="flex h-[49px] shrink-0 items-center gap-2 border-b border-workspace-rail-line px-3 sm:px-4">
      <WorkspaceShellControls
        tone="light"
        onOpenNavigation={() => (navigationOpen = true)}
        {railHidden}
        onToggleRail={() => (railHidden = !railHidden)}
      />
      <div class="flex min-w-0 flex-1 items-center gap-2">
        {#if report && user && !chatOpen && !awaitingSelection && !showIterativeStepper}
          <!-- Obvious puts the reopen-panel control at the FAR LEFT with the
               open-panel glyph, not a chat icon in the right cluster. -->
          <button
            type="button"
            title="Open AI assistant"
            aria-label="Open AI assistant"
            onclick={() => {
              qaOpen = false;
              chatOpen = true;
              railView = "chat";
              mobileWorkspaceView = "assistant";
            }}
            class="flex size-7 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-chrome/60 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy motion-reduce:transition-none pointer-coarse:size-11"
          >
            <svg class="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="M4 7C4 5.343 5.343 4 7 4h10c1.657 0 3 1.343 3 3v10c0 1.657-1.343 3-3 3H7c-1.657 0-3-1.343-3-3V7zM15 5v14" />
            </svg>
          </button>
        {/if}
        {#if showIntakeWorkbench && !contextOpen}
          <!-- Same far-left reopen grammar as the assistant rail: the panel
               that closed comes back from where Obvious puts it. Desktop only —
               narrow screens keep the Work/Context switch. -->
          <button
            type="button"
            title="Show project context"
            aria-label="Show project context"
            onclick={() => (contextOpen = true)}
            class="hidden size-7 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-chrome/60 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy motion-reduce:transition-none lg:flex"
          >
            <svg class="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="M4 7C4 5.343 5.343 4 7 4h10c1.657 0 3 1.343 3 3v10c0 1.657-1.343 3-3 3H7c-1.657 0-3-1.343-3-3V7zM15 5v14" />
            </svg>
          </button>
        {/if}
        <!-- Single h1 for the route (a11y P0), carried by the thin header. -->
        <h1 data-project-heading class="min-w-0 truncate text-sm font-medium text-ink max-sm:sr-only">
          {project.title}
        </h1>
        {#if !project.workflowStage}
          <ProjectStateBadge workflowStage={project.workflowStage} legacyStatus={project.status} />
        {/if}
        {#if generation && generation.status !== "completed"}
          <span class="hidden lg:inline-flex">
            <GenerationStatusChip
              status={generation.status}
              candidatesDone={generation.candidatesDone ?? 0}
              candidatesFailed={generation.candidatesFailed ?? 0}
            />
          </span>
        {/if}
      </div>
      <div class="flex shrink-0 items-center gap-1">
        {#if pagingPosition}
          <!-- "N of M in <where>" — flow-state paging over the bounded page
               the invoking list stashed; count keeps the + qualifier when
               that page was bounded. No subscriptions: prev/next navigate
               within the already-loaded id list. -->
          <span data-paging-context class="hidden items-center gap-0.5 lg:flex">
            <span class="whitespace-nowrap text-xs text-ink-muted">
              <span class="text-data">{pagingPosition.index + 1} of {pagingPosition.total}{pagingPosition.bounded ? "+" : ""}</span>
              in {pagingPosition.label}
            </span>
            <button
              type="button"
              title="Previous project"
              aria-label={`Previous project in ${pagingPosition.label}`}
              disabled={!pagingPosition.prevId}
              onclick={() => {
                const id = pagingPosition?.prevId;
                if (id) void goto(resolve("/project/[id]", { id }));
              }}
              class="flex size-7 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-chrome/60 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent motion-reduce:transition-none"
            >
              <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" /></svg>
            </button>
            <button
              type="button"
              title="Next project"
              aria-label={`Next project in ${pagingPosition.label}`}
              disabled={!pagingPosition.nextId}
              onclick={() => {
                const id = pagingPosition?.nextId;
                if (id) void goto(resolve("/project/[id]", { id }));
              }}
              class="flex size-7 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-chrome/60 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent motion-reduce:transition-none"
            >
              <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" /></svg>
            </button>
          </span>
        {/if}
        {#if saving}
          <span class="hidden text-xs text-ink-faint sm:inline">Saving…</span>
        {/if}
        {#if saveError}
          <span class="hidden max-w-60 truncate text-xs text-red-700 sm:inline" role="alert">Save failed: {saveError}</span>
        {/if}
        {#if shareError}
          <span class="hidden max-w-60 truncate text-xs text-red-700 sm:inline" role="alert">Share failed: {shareError}</span>
        {/if}
        {#if showIterativeStepper && generation?.iterativeModelLabel}
          <span class="hidden text-xs text-ink-muted sm:inline">Model: {generation.iterativeModelLabel}</span>
        {/if}
        {#if showIterativeStepper}
          <button
            type="button"
            onclick={() => (confirmCancelIterative = true)}
            class="flex h-7 items-center rounded-full px-2.5 text-xs text-ink-muted transition-colors hover:bg-chrome/60 hover:text-red-700 motion-reduce:transition-none"
          >
            Cancel iterative draft
          </button>
        {/if}
        {#if report && !awaitingSelection && !showIterativeStepper}
          <!-- 2026-08-11: start PD-review mode from this written report — the
               review lives as an associated project (sourceProjectId). -->
          <button type="button" title="Start AI review" aria-label={startingReview ? "Starting AI review…" : "Start AI review"} onclick={handleStartAiReview} disabled={startingReview} class="flex size-7 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-chrome/60 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:opacity-40 motion-reduce:transition-none pointer-coarse:size-11">
            <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
            </svg>
          </button>
          {#if canShare}
            <button type="button" title="Publish and copy review link" aria-label={sharing ? "Publishing…" : "Share"} onclick={handleCopyShareLink} disabled={sharing} class="flex size-7 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-chrome/60 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:opacity-40 motion-reduce:transition-none pointer-coarse:size-11">
              <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
              </svg>
            </button>
          {/if}
          {#if ghostSnapshot}
            <button type="button" title="Compare with the one-shot draft" aria-label="Compare drafts" onclick={() => (ghostCompareOpen = true)} class="flex size-7 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-chrome/60 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:opacity-40 motion-reduce:transition-none pointer-coarse:size-11">
              <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" d="M9 4v16m6-16v16M4 8h4m8 0h4M4 16h4m8 0h4M6 4h12a2 2 0 012 2v12a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2z" />
              </svg>
            </button>
          {/if}
          <button type="button" title="History" aria-label="History" onclick={() => (showHistory = true)} class="flex size-7 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-chrome/60 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:opacity-40 motion-reduce:transition-none pointer-coarse:size-11">
            <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </button>
          <button
            type="button"
            title={workspaceMaximized ? "Exit focus mode" : "Enter focus mode"}
            aria-label={workspaceMaximized ? "Exit focus mode" : "Enter focus mode"}
            onclick={() => (workspaceMaximized = !workspaceMaximized)}
            class="flex size-7 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-chrome/60 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:opacity-40 motion-reduce:transition-none pointer-coarse:size-11"
          >
            <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
              {#if workspaceMaximized}
                <path stroke-linecap="round" stroke-linejoin="round" d="M9 9H4.5M9 9V4.5M15 9h4.5M15 9V4.5M9 15H4.5M9 15v4.5M15 15h4.5M15 15v4.5" />
              {:else}
                <path stroke-linecap="round" stroke-linejoin="round" d="M7 3H3v4M3 3l6 6m8-6h4v4m0-4-6 6M7 21H3v-4m0 4 6-6m8 6h4v-4m0 4-6-6" />
              {/if}
            </svg>
          </button>
          <button type="button" title="Export .docx" aria-label={exporting ? "Exporting…" : "Export .docx"} onclick={handleExport} disabled={exporting} class="flex size-7 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-chrome/60 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:opacity-40 motion-reduce:transition-none pointer-coarse:size-11">
            <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
          </button>
          <a title="Financial" aria-label="Financial" href={`/project/${projectId}/financial`} class="flex size-7 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-chrome/60 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:opacity-40 motion-reduce:transition-none pointer-coarse:size-11">
            <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </a>
        {:else if awaitingSelection}
          <button
            type="button"
            title={candidateMaximized ? "Exit focus mode" : "Enter focus mode"}
            aria-label={candidateMaximized ? "Exit focus mode" : "Enter focus mode"}
            onclick={() => (candidateMaximized = !candidateMaximized)}
            class="flex size-7 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-chrome/60 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:opacity-40 motion-reduce:transition-none pointer-coarse:size-11"
          >
            <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
              {#if candidateMaximized}
                <path stroke-linecap="round" stroke-linejoin="round" d="M9 9H4.5M9 9V4.5M15 9h4.5M15 9V4.5M9 15H4.5M9 15v4.5M15 15h4.5M15 15v4.5" />
              {:else}
                <path stroke-linecap="round" stroke-linejoin="round" d="M7 3H3v4M3 3l6 6m8-6h4v4m0-4-6 6M7 21H3v-4m0 4 6-6m8 6h4v-4m0 4-6-6" />
              {/if}
            </svg>
          </button>
        {/if}
      </div>
    </header>

    <!-- Generation progress — no metadata header; the progress card is the page -->
    {#if generation && (isGenerating || showFailedGeneration)}
      <!-- `my-auto` rather than `items-center`: a centred flex child that
           overflows its scroll container cannot be scrolled back to at the top
           edge. Auto margins centre it identically while it fits, and yield
           when the files panel below makes the content taller than the view. -->
      <div class="flex min-h-0 flex-1 overflow-y-auto">
        <div class="mx-auto my-auto w-full max-w-3xl px-6 py-8">
          <GenerationProgress generationId={generation._id} />
          {#if !report}
            <!-- Uploads that failed on the way in have no other home while a
                 generation is running or has failed — the editor (and its files
                 panel) only exists once there is a report. -->
            <div class="mt-6">
              <FilesPanel {projectId} initiallyOpen={showFailedGeneration} />
            </div>
          {/if}
        </div>
      </div>
    {/if}

    <!-- Iterative mode: section-by-section review stepper -->
    {#if generation && showIterativeStepper}
      <div class="min-h-0 flex-1 overflow-y-auto">
        <div class="mx-auto w-full max-w-[var(--container-shell)] px-6 py-8">
          <IterativeStepper generationId={generation._id} />
        </div>
      </div>
    {/if}

    <!-- BNH-15: choose between candidate drafts before they become the report -->
    {#if generation && awaitingSelection}
      <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
        <CandidateSelection generationId={generation._id} bind:maximized={candidateMaximized} />
      </div>
    {/if}
    {#if generationError}
      <p class="mx-auto mt-4 w-full max-w-3xl px-6 text-sm text-red-700" role="alert">
        {generationError}
      </p>
    {/if}

    <!-- Report + Agent workbench. Wide screens mirror the inspected Obvious
         composition (conversation left, artifact right); narrow screens use
         one explicit pane at a time so neither surface is percentage-squeezed. -->
    {#if !awaitingSelection && !showIterativeStepper && report}
      {#if user}
        <div class="flex shrink-0 items-center justify-center gap-0.5 border-b border-line-soft bg-white px-3 py-2 lg:hidden" role="group" aria-label="Project workspace pane">
          <button
            type="button"
            aria-pressed={mobileWorkspaceView === "report"}
            onclick={() => (mobileWorkspaceView = "report")}
            class={`min-h-11 rounded-full px-4 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy ${mobileWorkspaceView === "report" ? "bg-navy text-white" : "text-ink-muted hover:bg-primary-wash hover:text-navy"}`}
          >Report</button>
          <button
            type="button"
            aria-pressed={mobileWorkspaceView === "assistant"}
            onclick={() => {
              chatOpen = true;
              qaOpen = false;
              railView = "chat";
              mobileWorkspaceView = "assistant";
            }}
            class={`min-h-11 rounded-full px-4 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy ${mobileWorkspaceView === "assistant" ? "bg-navy text-white" : "text-ink-muted hover:bg-primary-wash hover:text-navy"}`}
          >Agent</button>
        </div>
      {/if}
      <div bind:this={workspaceEl} data-project-workspace class="mx-auto flex min-h-0 w-full max-w-full flex-1 flex-col overflow-hidden transition-[max-width] duration-[325ms] ease-out motion-reduce:transition-none lg:flex-row-reverse">
        <div inert={chatFocus} class={`[container-type:inline-size] ${mobileWorkspaceView === "report" && !chatFocus ? "flex" : "hidden"} min-h-0 min-w-0 w-full flex-1 flex-col overflow-y-auto ${chatFocus ? "lg:hidden" : "lg:flex"}`}>
            <div data-report-surface class={`w-full max-w-full px-4 transition-[padding] duration-[325ms] ease-out motion-reduce:transition-none sm:px-6 ${workspaceMaximized ? "py-5 sm:py-6" : "py-6 sm:py-8"}`}>
              <!-- Project info header -->
              {@render projectMetadata()}

              <!-- Editor column -->
              <Editor
                bind:this={editorRef}
                content={report.content}
                onUpdate={handleEditorUpdate}
                onComment={handleComment}
                onAskAI={handleAskAI}
                onResearch={handleResearch}
                editable={true}
                {commentRanges}
                onHoverComment={(id) => (hoveredCommentId = id)}
              />

              <!-- Supporting panels (QA moved to the right rail — BNH-47) -->
              <div class="mt-8 mb-12">
                <!-- 2026-08-11 (second) amendment: review-mode projects keep
                     the AI feedback visible ALONGSIDE the PD in the editor.
                     Previously the review report only rendered in the
                     no-report intake state, so a review project with a report
                     (e.g. created from an existing project) hid its feedback. -->
                {#if project.mode === "review" && pdReview}
                  <div class="mb-4">
                    <PdReviewReport
                      review={pdReview}
                      hasTranscript={Boolean(transcript?.content?.trim())}
                      onGenerate={handleGenerateFromReview}
                    />
                  </div>
                {/if}
                <!-- BNH-48: revealed model test scores, once selection happened -->
                {#if generation}
                  <ModelTestSummary generationId={generation._id} />
                {/if}
                <div class="mt-4">
                  <ChronologyTable agentOutputs={generation?.agentOutputs} />
                </div>
                <div class="mt-4">
                  <FilesPanel {projectId} reportId={report._id} />
                </div>
                {#if user}
                  <div class="mt-4">
                    <FilingReadinessPanel
                      {projectId}
                      reportId={report._id}
                      clientName={project.clientName}
                      userRole={user.role}
                    />
                  </div>
                {/if}
                <LogsPanel {projectId} />
              </div>
            </div>
          </div>

        <!-- Draggable divider -->
        {#if report && user && (chatOpen || qaOpen) && !chatFocus}
          <button
            type="button"
            onmousedown={startDrag}
            role="slider"
            aria-label="Resize assistant panel"
            aria-orientation="vertical"
            aria-valuemin={Math.round(CHAT_MIN * 100)}
            aria-valuemax={Math.round(CHAT_MAX * 100)}
            aria-valuenow={Math.round(chatRatio * 100)}
            onkeydown={(event) => {
              if (event.key === "ArrowLeft") adjustRail(-0.02);
              else if (event.key === "ArrowRight") adjustRail(0.02);
              else if (event.key === "Home") chatRatio = CHAT_MIN;
              else if (event.key === "End") chatRatio = CHAT_MAX;
              else return;
              event.preventDefault();
            }}
            title="Drag or use arrow keys to resize"
            class="group hidden w-3 flex-none cursor-col-resize items-center justify-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-navy lg:flex"
          >
            <div class="h-10 w-1 rounded-full bg-gray-300 transition-colors group-hover:bg-primary"></div>
          </button>
        {/if}

        <!-- Chat rail — right-docked + resizable. Open/close is a bottom-up
             pop (reference: 21st.dev glowing assistant): the panel rises from
             the bottom with a slight overshoot and sinks away on close. The
             panel stays mounted so chat state survives close/reopen. -->
        {#if report && user}
          <aside
            class={`relative [container-type:inline-size] ${mobileWorkspaceView === "assistant" || chatFocus ? "flex" : "hidden"} min-h-0 w-full flex-1 flex-col overflow-hidden bg-white lg:flex lg:w-[var(--assistant-width)] lg:flex-none ${chatOpen || qaOpen || chatFocus ? "lg:border-r lg:border-line-soft" : ""} ${dragging ? "" : "transition-all duration-[325ms] ease-out"}`}
            style={`--assistant-width: ${chatFocus ? "100%" : chatOpen || qaOpen ? `${chatRatio * 100}%` : "0%"}`}
          >
            <!-- BNH-47: QA review — shared rail card (in flow; exactly one
                 of chat/QA is in flow at a time via railView) -->
            {#if railView === "qa"}
              <QARailPanel
                open={qaOpen}
                onClose={() => {
                  qaOpen = false;
                  mobileWorkspaceView = "report";
                }}
                modelName={generation?.selectedModelLabel ?? generation?.iterativeModelLabel ?? null}
                agentOutputs={generation?.agentOutputs}
                reportContent={report.content}
                reportId={report._id}
                onLocateGap={locateGap}
                onRunQa={generation?.status === "completed"
                  ? async () => {
                      await requestReportQaMut({ generationId: generation._id });
                    }
                  : undefined}
                postQaStatus={generation?.postQaStatus ?? null}
              />
            {/if}
            <div
              class={`chat-rise relative flex h-full origin-bottom flex-col overflow-hidden bg-white ${chatOpen ? "" : "is-closed"} ${railView !== "chat" ? "hidden" : ""}`}
              role="dialog"
              aria-label="AI assistant"
              inert={!chatOpen}
            >
              <button
                onclick={() => {
                  chatOpen = false;
                  chatFocus = false;
                  mobileWorkspaceView = "report";
                }}
                title="Close assistant (Esc)"
                aria-label="Close assistant"
                class="absolute right-2.5 top-1.5 z-10 flex size-7 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-chrome/60 hover:text-ink motion-reduce:transition-none"
              >
                <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
              <AgentChatPanel
                  {projectId}
                  reportId={report._id}
                  pendingHighlight={pendingChatHighlight}
                  onClearHighlight={() => (pendingChatHighlight = null)}
                  {pendingResearch}
                  onClearResearch={() => (pendingResearch = null)}
                  onReferenceText={(texts, scrollTo) => editorRef?.highlightText(texts, scrollTo)}
                  onReviewReplacements={startReplaceReview}
                  onPreviewProposal={(pairs, on) => {
                    if (on && pairs.length) editorRef?.previewProposal(pairs);
                    else editorRef?.clearProposalPreview();
                  }}
                  reviewingId={replaceSession?.messageId ?? null}
                  onBeforeApply={flushEditor}
                  isFull={chatFocus}
                  onToggleFull={() => {
                    chatOpen = true;
                    qaOpen = false;
                    railView = "chat";
                    chatFocus = !chatFocus;
                    if (chatFocus) mobileWorkspaceView = "assistant";
                  }}
                />
            </div>
          </aside>
        {/if}

        <!-- Launcher pills when the respective panel is closed -->
        {#if report && user && !chatOpen}
          <Tooltip text="Open AI assistant" side="left" delayDuration={300}>
            {#snippet children({ props })}
              <button
                {...props}
                in:scale={{ duration: 200, start: 0.6, delay: 240 }}
                out:scale={{ duration: 150, start: 0.6 }}
                onclick={() => {
                  qaOpen = false;
                  chatOpen = true;
                  railView = "chat";
                  mobileWorkspaceView = "assistant";
                }}
                aria-label="Open AI assistant"
                class="chat-pill-glow fixed bottom-6 right-6 z-[70] flex h-11 w-11 items-center justify-center rounded-full bg-navy text-white transition-transform hover:scale-105"
              >
                <ChatIcon class="h-4.5 w-4.5" />
              </button>
            {/snippet}
          </Tooltip>
        {/if}
        {#if report && user && !qaOpen}
          <QALauncher
            right={chatOpen ? "1.5rem" : "5rem"}
            onOpen={() => {
              chatOpen = false;
              qaOpen = true;
              railView = "qa";
              chatFocus = false;
              mobileWorkspaceView = "assistant";
            }}
          />
        {/if}
      </div>
    {/if}

    <!-- BNH-30: one-by-one replace stepper — Word-style "replace & find next" -->
    {#if replaceSession}
      <div class="fixed bottom-6 left-1/2 z-[80] -translate-x-1/2">
        <div class="card flex items-center gap-3 px-4 py-3 shadow-xl">
          <div class="flex flex-col">
            <span class="text-xs font-medium text-gray-400">
              Reviewing replacements
            </span>
            <span class="text-sm font-semibold text-navy">
              {replaceSession.current
                ? `Instance ${replaceSession.position} of ${replaceSession.total}`
                : "Done"}
              {#if replaceSession.current}
                <span class="ml-2 font-normal text-gray-500">
                  “{replaceSession.current.text}” →
                  <span class="text-primary-dark">
                    {replaceSession.current.replaceWith}
                  </span>
                </span>
              {/if}
            </span>
          </div>
          <div class="ml-2 flex items-center gap-1.5">
            <button
              onclick={replaceAndNext}
              class="inline-flex items-center gap-1 rounded-lg bg-primary-selected px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-primary-dark"
            >
              Replace · Next
              <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </button>
            <button
              onclick={replaceAllRemaining}
              class="rounded-lg border border-line bg-white px-3 py-2 text-xs font-medium text-navy transition-colors hover:bg-primary-wash"
            >
              Replace All
            </button>
            <button
              onclick={keepOriginalAndNext}
              class="rounded-lg px-3 py-2 text-xs font-medium text-ink-secondary transition-colors hover:bg-primary-wash hover:text-navy"
            >
              Keep original
            </button>
            <button
              onclick={endReplaceReview}
              title="Stop reviewing"
              class="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-primary-wash hover:text-gray-600"
            >
              <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    {/if}

    <!-- BNH-30: transient notice (e.g. text not found to replace) -->
    {#if replaceNotice}
      <div class="fixed bottom-6 left-1/2 z-[85] -translate-x-1/2 rounded-lg bg-navy px-4 py-2 text-sm text-white shadow-xl">
        {replaceNotice}
      </div>
    {/if}

    <!-- Comment authoring + hover overlay (single view) -->
    {#if !awaitingSelection && !showIterativeStepper && report && user}
      <CommentOverlay
        {projectId}
        reportId={report._id}
        commenterId={user._id}
        commenterName={displayName(user, "Consultant")}
        {hoveredCommentId}
        {pendingHighlight}
        onClearPending={() => (pendingHighlight = null)}
      />
    {/if}

    <!-- BNH-52: confirm re-running an already-generated test -->
    {#if confirmRegenerate}
      {@const regenSource = confirmRegenerate}
      <div transition:overlayFade class="fixed inset-0 z-[100] flex items-center justify-center bg-navy/30 px-4" role="dialog" aria-modal="true" aria-labelledby="regen-title">
        <div transition:modalPop class="card w-full max-w-md p-6 shadow-xl">
          <div class="flex items-start gap-3">
            <span class="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-amber-100 text-amber-600">
              <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
            </span>
            <div>
              <h3 id="regen-title" class="text-base font-semibold text-gray-900">
                This project already has a generated test
              </h3>
              <p class="mt-1.5 text-sm leading-relaxed text-gray-600">
                {#if candidateMode === "single"}
                  Re-running generates one fresh draft and adds it directly as a
                  new report version.
                {:else if candidateMode === "iterative"}
                  Re-running drafts the report section by section — you review and
                  approve each section — and adds a new report version at the end.
                {:else}
                  Re-running generates two fresh candidate drafts and adds a new
                  report version after you select one.
                {/if}
                Previous results are preserved in version history — nothing is deleted.
              </p>
            </div>
          </div>
          <div class="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onclick={() => (confirmRegenerate = null)}
              class="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-chrome"
            >
              Cancel
            </button>
            <button
              type="button"
              onclick={() => runGenerate(regenSource, true)}
              class="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-dark"
            >
              Re-run generation
            </button>
          </div>
        </div>
      </div>
    {/if}

    <!-- Version history modal -->
    {#if showHistory && report}
      <VersionHistory
        reportId={report._id}
        beforeSnapshot={flushEditor}
        onClose={() => (showHistory = false)}
      />
    {/if}

    {#if shareLink}
      <div
        transition:overlayFade
        class="fixed inset-0 z-[110] flex items-center justify-center bg-navy/30 px-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-link-title"
      >
        <div transition:modalPop class="card w-full max-w-lg p-6 shadow-xl">
          <h3 id="share-link-title" class="text-base font-semibold text-gray-900">
            Review link published
          </h3>
          <p class="mt-1.5 text-sm leading-relaxed text-gray-600">
            The current report is available for client review. Anyone with this link
            can read it and leave comments.
          </p>
          <label for="published-review-link" class="mt-5 block text-xs font-medium uppercase tracking-wide text-gray-500">
            Client review link
          </label>
          <input
            id="published-review-link"
            value={shareLink}
            readonly
            onfocus={(event) => event.currentTarget.select()}
            onclick={(event) => event.currentTarget.select()}
            class="field-control mt-1.5 w-full rounded-lg px-3 py-2 font-mono text-xs text-gray-700"
          />
          {#if shareError}
            <p class="mt-2 text-sm text-red-700" role="alert">{shareError}</p>
          {/if}
          <div class="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onclick={() => {
                shareLink = "";
                shareError = "";
                copied = false;
              }}
              class="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-chrome"
            >
              Close
            </button>
            <button
              type="button"
              onclick={copyPublishedReviewLink}
              class="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-dark"
            >
              {copied ? "Copied!" : "Copy link"}
            </button>
          </div>
        </div>
      </div>
    {/if}

    {#if exportValidation}
      <ExportValidationDialog
        errors={exportValidation.errors}
        warnings={exportValidation.warnings}
        onCancel={cancelExportValidation}
        onProceed={proceedAfterExportWarnings}
      />
    {/if}
    {#if exportError}
      <div class="fixed bottom-5 left-1/2 z-[110] -translate-x-1/2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 shadow-lg" role="alert">
        Export failed: {exportError}
      </div>
    {/if}

    <!-- Filing-readiness blockers: caught pre-export with a path to fix -->
    {#if readinessBlockers.length}
      <div class="fixed inset-0 z-[110] flex items-center justify-center bg-navy/30 px-4" role="dialog" aria-modal="true" aria-labelledby="readiness-blockers-title">
        <div class="card w-full max-w-md p-6 shadow-xl">
          <h3 id="readiness-blockers-title" class="text-base font-semibold text-gray-900">
            Not ready to export yet
          </h3>
          <p class="mt-1.5 text-sm leading-relaxed text-gray-600">
            The official export needs filing evidence in place first:
          </p>
          <ul class="mt-3 flex flex-col gap-2">
            {#each readinessBlockers as blocker (`${blocker.code}:${blocker.message}`)}
              <li class="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                <svg class="mt-0.5 h-4 w-4 flex-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                </svg>
                {blocker.message}
              </li>
            {/each}
          </ul>
          <p class="mt-3 text-xs text-gray-500">
            Add and verify evidence in the Filing readiness panel below the report, then export again.
          </p>
          <div class="mt-5 flex justify-end">
            <button
              type="button"
              onclick={() => (readinessBlockers = [])}
              class="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-dark"
            >
              Got it
            </button>
          </div>
        </div>
      </div>
    {/if}

    <!-- No report, not generating — the INTAKE WORKBENCH (2026-08-08
         Obvious-parity amendment). Desktop ≥lg mirrors the report
         workbench's split anatomy: a persistent left CONTEXT pane (files
         evidence + interview transcript — the project's conversation-like
         source material) beside the primary intake/generation work surface,
         each owning its own vertical scroll, with the same resizable
         separator grammar. This replaces the single 768px long-scroll
         column whose transcript drove a ~27k-px page. Narrow screens use
         explicit Work/Context switches with one pane visible at a time.
         The state stays HONEST: no report and no chat exist here — the
         left pane is source context, never a fabricated conversation. -->
    {#if showIntakeWorkbench}
      {@const transcriptVisible = !(project.mode === "review" && !transcript?.content?.trim())}
      <div class="flex shrink-0 items-center justify-center gap-0.5 border-b border-line-soft bg-white px-3 py-2 lg:hidden" role="group" aria-label="Project intake pane">
        <button
          type="button"
          aria-pressed={mobileIntakeView === "work"}
          onclick={() => (mobileIntakeView = "work")}
          class={`min-h-11 rounded-full px-4 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy ${mobileIntakeView === "work" ? "bg-navy text-white" : "text-ink-muted hover:bg-primary-wash hover:text-navy"}`}
        >Work</button>
        <button
          type="button"
          aria-pressed={mobileIntakeView === "context"}
          onclick={() => (mobileIntakeView = "context")}
          class={`min-h-11 rounded-full px-4 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy ${mobileIntakeView === "context" ? "bg-navy text-white" : "text-ink-muted hover:bg-primary-wash hover:text-navy"}`}
        >Context</button>
      </div>
      <!-- DOM order = work → separator → context (primary surface first for
           focus order, matching the report workbench); lg:flex-row-reverse
           places context on the LEFT visually, like the inspected Obvious
           project composition. -->
      <div bind:this={intakeEl} data-intake-workbench class="mx-auto flex min-h-0 w-full max-w-[var(--container-shell)] flex-1 overflow-hidden lg:flex-row-reverse">
        <main
          aria-label="Project intake and generation"
          data-intake-pane="work"
          class={`${mobileIntakeView === "work" ? "flex" : "hidden"} min-h-0 flex-1 flex-col overflow-y-auto lg:flex`}
        >
          <div class="mx-auto w-full max-w-3xl px-6 py-8">
            <!-- Project attributes live in the persistent left context pane;
                 this primary plane begins with the actual work, matching the
                 Attio record/detail split. -->

            {#if project.mode === "review" && generation?.status === "failed"}
              <div class="mb-8 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5">
                <p class="text-sm text-red-700">
                  The comparison draft stopped before it completed. Use “Generate PD for comparison” below to try again.
                </p>
              </div>
            {/if}

            {#if project.mode === "review" && pdReview}
              <PdReviewReport
                review={pdReview}
                hasTranscript={Boolean(transcript?.content?.trim())}
                onGenerate={handleGenerateFromReview}
              />
            {:else if project.mode === "review" && pdReviewQ.data === null}
              <!-- Stranded review project (2026-08-07 flag): no review row
                   exists, so the report block renders nothing and the writer
                   had no recovery path. Offer start/upload here. -->
              <PdReviewStart projectId={project._id} />
            {/if}

            {#if transcript && transcriptVisible}
              <section aria-labelledby="intake-generation-heading" class="mt-8">
                <h2 id="intake-generation-heading" class="text-sm font-semibold uppercase tracking-wide text-gray-400">
                  Draft generation
                </h2>
                <div class="mt-3 flex flex-wrap items-center gap-2">
                  {#if project.mode !== "review"}
                    <div
                      class="inline-grid grid-cols-3 gap-1 rounded-lg bg-chrome p-1"
                      role="radiogroup"
                      aria-label="Draft generation mode"
                    >
                      {#each [
                        { id: "compare", label: "Compare" },
                        { id: "single", label: "Single draft" },
                        { id: "iterative", label: "Section by section" },
                      ] as const as opt (opt.id)}
                        <button
                          type="button"
                          role="radio"
                          aria-checked={candidateMode === opt.id}
                          onclick={() => (candidateMode = opt.id)}
                          class={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy ${
                            candidateMode === opt.id
                              ? "bg-white text-navy shadow-sm ring-1 ring-gray-200"
                              : "text-gray-500 hover:text-gray-700"
                          }`}
                        >
                          {opt.label}
                        </button>
                      {/each}
                    </div>
                  {/if}
                  {#if project.mode !== "review"}
                    {#if candidateMode !== "compare"}
                      <SingleModelPicker bind:value={singleModelId} />
                    {:else}
                      <ComparePairPicker bind:slotA={compareSlotA} bind:slotB={compareSlotB} />
                    {/if}
                  {/if}
                  <SelectInput
                    size="sm"
                    bind:value={lengthTarget}
                    items={[
                      { value: "concise", label: "Concise (~70% of limit)" },
                      { value: "standard", label: "Standard (~90%)" },
                      { value: "full", label: "Full (to the line limit)" },
                    ]}
                    class="w-52"
                  />
                  <Button
                    onclick={handleRegenerate}
                    class="text-xs"
                  >
                    Generate Report
                  </Button>
                </div>
              </section>
            {/if}
          </div>
        </main>

        <!-- Draggable separator between context and work (desktop only) -->
        {#if contextOpen}
        <button
          type="button"
          onmousedown={startContextDrag}
          role="slider"
          aria-label="Resize context panel"
          aria-orientation="vertical"
          aria-valuemin={Math.round(CHAT_MIN * 100)}
          aria-valuemax={Math.round(CHAT_MAX * 100)}
          aria-valuenow={Math.round(contextRatio * 100)}
          onkeydown={(event) => {
            if (event.key === "ArrowLeft") adjustContext(-0.02);
            else if (event.key === "ArrowRight") adjustContext(0.02);
            else if (event.key === "Home") contextRatio = CHAT_MIN;
            else if (event.key === "End") contextRatio = CHAT_MAX;
            else return;
            event.preventDefault();
          }}
          title="Drag or use arrow keys to resize"
          class="group hidden w-3 flex-none cursor-col-resize items-center justify-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-navy lg:flex"
        >
          <div class="h-10 w-1 rounded-full bg-gray-300 transition-colors group-hover:bg-primary"></div>
        </button>
        {/if}

        <aside
          aria-label="Project context"
          data-intake-pane="context"
          inert={!contextOpen && mobileIntakeView !== "context"}
          class={`${mobileIntakeView === "context" ? "flex" : "hidden"} min-h-0 w-full flex-1 flex-col overflow-hidden bg-white lg:flex lg:w-[var(--context-width)] lg:flex-none ${contextOpen ? "lg:border-r lg:border-line-soft" : "lg:opacity-0"} ${contextDragging ? "" : "lg:transition-[width,opacity] lg:duration-[325ms] lg:ease-out motion-reduce:transition-none"}`}
          style={`--context-width: ${contextOpen ? contextRatio * 100 : 0}%`}
        >
          <!-- Pane header: names the surface and carries the close control
               (assistant-rail grammar). Desktop only — narrow screens close
               via the Work/Context switch. -->
          <div class={`hidden shrink-0 items-center justify-between pt-4 lg:flex ${contextOpen ? "px-5" : "lg:px-0"}`}>
            <h2 class="text-label">Context</h2>
            <button
              type="button"
              title="Close context panel"
              aria-label="Close project context"
              onclick={() => (contextOpen = false)}
              class="flex size-7 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-chrome/60 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy motion-reduce:transition-none"
            >
              <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div class={`min-h-0 flex-1 overflow-y-auto py-6 lg:pt-3 ${contextOpen ? "px-5" : "px-5 lg:px-0"}`}>
            <div data-project-record-details>
              {@render projectMetadata()}
            </div>
            <!-- Reachable later: a project with no report still has to show
                 what happened to its uploads. -->
            <FilesPanel {projectId} />

            {#if transcriptVisible}
              <div class="mt-6">
                {#if project.mode === "review"}
                  <!-- Review mode: the written PD/feedback is the focus — the
                       transcript stays behind a compact disclosure row
                       (collapsed by default; FilesPanel disclosure grammar). -->
                  <h2 class="m-0">
                    <button
                      type="button"
                      onclick={() => (reviewTranscriptOpen = !reviewTranscriptOpen)}
                      aria-expanded={reviewTranscriptOpen}
                      aria-controls={reviewTranscriptBodyId}
                      class="flex min-h-9 w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-primary-wash focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-navy motion-reduce:transition-none"
                    >
                      <span class="text-sm font-medium uppercase tracking-wide text-gray-400">
                        Transcript
                      </span>
                      {#if transcript && transcriptWordCount > 0}
                        <span class="text-xs text-gray-400">
                          · {transcriptWordCount.toLocaleString()} words
                        </span>
                      {/if}
                      <span class="ml-auto flex items-center" aria-hidden="true">
                        <DisclosureChevron open={reviewTranscriptOpen} />
                      </span>
                    </button>
                  </h2>
                  <Disclosure id={reviewTranscriptBodyId} open={reviewTranscriptOpen}>
                    <div class="pt-1">
                      {#if transcript}
                        <div class="rounded-lg border border-gray-200 bg-white p-4">
                          <p class="whitespace-pre-wrap font-serif text-sm leading-relaxed text-gray-700">
                            {normalizeExtractedText(transcript.content)}
                          </p>
                        </div>
                      {:else}
                        <p class="text-sm text-gray-400">
                          Loading transcript...
                        </p>
                      {/if}
                    </div>
                  </Disclosure>
                {:else}
                  <h2 class="text-sm font-semibold uppercase tracking-wide text-gray-400">
                    Transcript
                  </h2>
                  {#if transcript}
                    <div class="mt-3 rounded-lg border border-gray-200 bg-white p-4">
                      <p class="whitespace-pre-wrap font-serif text-sm leading-relaxed text-gray-700">
                        {normalizeExtractedText(transcript.content)}
                      </p>
                    </div>
                  {:else}
                    <p class="mt-3 text-sm text-gray-400">
                      Loading transcript...
                    </p>
                  {/if}
                {/if}
              </div>
            {/if}
          </div>
        </aside>
      </div>
    {/if}

    {#if ghostSnapshot && report}
      <GhostCompareDialog
        bind:open={ghostCompareOpen}
        reportContent={report.content}
        ghostContent={ghostSnapshot.content}
        ghostLabel={ghostSnapshot.label?.replace(/^One-shot ghost draft \(comparison — (.*)\)$/, "$1") ?? "one-shot"}
      />
    {/if}

    <!-- Iterative cancel confirmation (button lives in the PageBar) -->
    {#if confirmCancelIterative}
      <div class="fixed inset-0 z-[100] flex items-center justify-center bg-navy/30 px-4" role="dialog" aria-modal="true" aria-labelledby="cancel-iterative-title">
        <div class="card w-full max-w-md p-6 shadow-xl">
          <h3 id="cancel-iterative-title" class="text-base font-semibold text-gray-900">
            Cancel this section-by-section draft?
          </h3>
          <p class="mt-1.5 text-sm leading-relaxed text-gray-600">
            Approved sections and drafts in progress will be discarded, and the project
            returns to its previous state. This cannot be undone.
          </p>
          <div class="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onclick={() => (confirmCancelIterative = false)}
              class="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-chrome"
            >
              Keep drafting
            </button>
            <button
              type="button"
              onclick={cancelIterative}
              disabled={cancellingIterative}
              class="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-50"
            >
              {#if cancellingIterative}
                <Spinner size="sm" class="h-3.5 w-3.5 border-white" />
              {/if}
              Cancel draft
            </button>
          </div>
        </div>
      </div>
    {/if}
  </div>
  </WorkspaceShell>
{/if}
