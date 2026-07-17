<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { useConvexClient, useQuery, useMutation } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-auth-svelte/sveltekit";
  import { PUBLIC_AGENT_CHAT } from "$env/static/public";
  import { scale } from "svelte/transition";
  import { overlayFade, modalPop } from "$lib/motion";
  import { api } from "../../../../convex/_generated/api";
  import type { Id } from "../../../../convex/_generated/dataModel";
  import Badge from "$lib/components/ui/Badge.svelte";
  import Button from "$lib/components/ui/Button.svelte";
  import IconAction from "$lib/components/ui/IconAction.svelte";
  import Spinner from "$lib/components/ui/Spinner.svelte";
  import AppNav from "$lib/components/ui/AppNav.svelte";
  import ChatIcon from "$lib/components/ui/ChatIcon.svelte";
  import PageBar from "$lib/components/ui/PageBar.svelte";
  import GenerationProgress from "$lib/components/generation/GenerationProgress.svelte";
  import CandidateSelection from "$lib/components/generation/CandidateSelection.svelte";
  import IterativeStepper from "$lib/components/generation/IterativeStepper.svelte";
  import Editor from "$lib/components/editor/Editor.svelte";
  import type {
    CommentRange,
    WriterEditorHandle,
  } from "$lib/components/editor/types";
  import QAScorePanel from "$lib/components/editor/QAScorePanel.svelte";
  import QARailPanel from "$lib/components/qa/QARailPanel.svelte";
  import QALauncher from "$lib/components/qa/QALauncher.svelte";
  import Tooltip from "$lib/components/ui/Tooltip.svelte";
  import ChronologyTable from "$lib/components/editor/ChronologyTable.svelte";
  import ModelTestSummary from "$lib/components/editor/ModelTestSummary.svelte";
  import FilesPanel from "$lib/components/editor/FilesPanel.svelte";
  import FilingReadinessPanel from "$lib/components/evidence/FilingReadinessPanel.svelte";
  import LogsPanel from "$lib/components/editor/LogsPanel.svelte";
  import CommentOverlay from "$lib/components/comments/CommentOverlay.svelte";
  import ChatPanel from "$lib/components/chat/ChatPanel.svelte";
  import AgentChatPanel from "$lib/components/chat/AgentChatPanel.svelte";
  import VersionHistory from "$lib/components/history/VersionHistory.svelte";
  import EditableText from "$lib/components/project/EditableText.svelte";
  import PdReviewReport from "$lib/components/review-pd/PdReviewReport.svelte";
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
  import { toast } from "svelte-sonner";
  import { comparePairFromSlots, type CandidateModelId } from "../../../../shared/generationModels";
  import ComparePairPicker from "$lib/components/generation/ComparePairPicker.svelte";
  import SingleModelPicker from "$lib/components/generation/SingleModelPicker.svelte";
  import GhostCompareDialog from "$lib/components/generation/GhostCompareDialog.svelte";

  // BNH-10 P2 parallel-run: flip chat to the streaming @convex-dev/agent backend.
  const AGENT_CHAT = PUBLIC_AGENT_CHAT === "1";

  const auth = useAuth();
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

  const generateReport = useMutation(api.generations.requestGeneration);
  const logPdReviewEvent = useMutation(api.pdReviews.logPdReviewEvent);
  const updateReport = useMutation(api.reports.updateReportContent);
  const createSnapshot = useMutation(api.snapshots.createManualSnapshot);
  const markEditApplied = useMutation(api.chat.markProposedEditApplied);
  const markProposalApplied = useMutation(api.chatV2.markProposalApplied);
  const updateTitles = useMutation(api.projects.updateProjectTitles);
  const updateProjectTags = useMutation(api.projects.updateProjectTags);
  const authorizeExport = useMutation(api.reports.authorizeExport);
  const completeExport = useMutation(api.reports.completeExport);
  const failExport = useMutation(api.reports.failExport);
  const publishForReview = useMutation(api.projects.publishForReview);

  const project = $derived(projectQ.data);
  const report = $derived(reportQ.data);
  const generation = $derived(generationQ.data);
  const transcript = $derived(transcriptQ.data);
  const user = $derived(userQ.data);
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

  // Route "mark applied" to whichever chat backend owns the id.
  function markApplied(id: string) {
    if (AGENT_CHAT) {
      return markProposalApplied({ proposalId: id as Id<"chatProposals"> });
    }
    return markEditApplied({ messageId: id as Id<"chatMessages"> });
  }

  function startReplaceReview(
    pairs: { find: string; replaceWith: string }[],
    messageId: string
  ) {
    const ed = editorRef;
    if (!ed || !report) return;
    const matches = ed.findReplaceMatches(pairs);
    if (matches.length === 0) {
      // Nothing left to replace — almost always because it's already applied.
      // Collapse the card so its buttons stop looking actionable.
      notifyReplace(
        `No remaining “${pairs[0]?.find ?? "matches"}” in the report — already applied.`
      );
      markApplied(messageId).catch(() => {});
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

  function rejectAndNext() {
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

  // BNH-14: resizable, closable chat rail. Width + open state persist across
  // sessions (localStorage). Drag clamps keep both panes usable: chat never
  // narrower than 24% nor wider than 55% of the workspace. (2026-07-03: the
  // rail stays right-docked and resizable; only open/close changed — the
  // panel now pops up from the bottom instead of sliding in from the side.)
  const CHAT_MIN = 0.24;
  const CHAT_MAX = 0.55;
  let chatRatio = $state(0.42);
  let chatOpen = $state(true);
  // BNH-47: QA rail panel — independent toggle; opening either closes the
  // other so the right rail hosts one passive-review surface at a time.
  let qaOpen = $state(false);
  // Which card occupies the rail (also while both are closed, for the sink
  // animation and so exactly one card is in flow at a time).
  let railView = $state<"chat" | "qa">("chat");
  let workspaceEl: HTMLDivElement | null = $state(null);
  let dragging = $state(false);

  $effect(() => {
    // Restore once from locals only — reading component state here would make
    // this effect re-run on every toggle and stomp the user's click.
    const r = localStorage.getItem("banhall_chat_ratio");
    if (r) chatRatio = Math.min(CHAT_MAX, Math.max(CHAT_MIN, parseFloat(r)));
    const savedQa = localStorage.getItem("banhall_qa_open") === "1";
    chatOpen = !savedQa && localStorage.getItem("banhall_chat_open") !== "0";
    qaOpen = savedQa;
    if (savedQa) railView = "qa";
    workspaceMaximized = localStorage.getItem("banhall_project_editor_maximized") === "1";
    candidateMaximized = localStorage.getItem("banhall_candidate_editor_maximized") === "1";
  });
  $effect(() => {
    localStorage.setItem("banhall_chat_ratio", String(chatRatio));
    localStorage.setItem("banhall_chat_open", chatOpen ? "1" : "0");
    localStorage.setItem("banhall_qa_open", qaOpen ? "1" : "0");
    localStorage.setItem("banhall_project_editor_maximized", workspaceMaximized ? "1" : "0");
    localStorage.setItem("banhall_candidate_editor_maximized", candidateMaximized ? "1" : "0");
  });

  $effect(() => {
    function onMove(e: MouseEvent) {
      if (!dragging || !workspaceEl) return;
      const rect = workspaceEl.getBoundingClientRect();
      const ratio = (rect.right - e.clientX) / rect.width;
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
  let readinessBlockers = $state<Array<{ code: string; message: string }>>([]);

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
        readinessBlockers = readiness.blockers;
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
</script>

<svelte:window
  onkeydown={(e) => {
    if (e.key === "Escape" && chatOpen && !replaceSession) chatOpen = false;
  }}
/>

{#if auth.isLoading || !auth.isAuthenticated || project === undefined}
  <div class="flex flex-1 items-center justify-center bg-canvas">
    <Spinner />
  </div>
{:else if project === null}
  <div class="flex flex-1 flex-col items-center justify-center gap-2 bg-canvas">
    <p class="text-gray-500">Project not found.</p>
    <a href="/dashboard" class="text-sm text-navy hover:underline">Back to dashboard</a>
  </div>
{:else}
  <div class="flex h-screen flex-col overflow-hidden bg-canvas">
    <!-- App bar — same AppNav as everywhere; home icon + report breadcrumb -->
    <AppNav home="icon" breadcrumbs={[{ label: project.title }]}>
      {#snippet actions()}
        {#if saving}
          <span class="hidden text-xs text-white/40 sm:inline">Saving…</span>
        {/if}
        {#if saveError}
          <span class="hidden max-w-72 truncate text-xs text-red-200 sm:inline" role="alert">
            Save failed: {saveError}
          </span>
        {/if}
        {#if shareError}
          <span class="hidden max-w-72 truncate text-xs text-red-200 sm:inline" role="alert">
            Share failed: {shareError}
          </span>
        {/if}
        <Badge
          status={awaitingSelection
            ? "awaiting"
            : generation?.status === "awaiting_input"
              ? "awaiting_input"
              : project.status}
          dot
        />
      {/snippet}
    </AppNav>

    {#snippet projectMetadata()}
      <div class="mb-8 border-b border-gray-200 pb-6">
        <EditableText
          value={project.title}
          placeholder="Set internal title"
          variant="heading"
          label="internal project title"
          required
          onSave={async (value) => {
            await updateTitles({ projectId, title: value.trim() });
          }}
        />
        <div class="mt-5 grid grid-cols-1 gap-x-10 gap-y-4 text-sm sm:grid-cols-2">
          <div>
            <span class="text-label block">SR&amp;ED title</span>
            <EditableText
              value={project.sredTitle ?? ""}
              placeholder="Add the formal SR&ED title (finalize at the end)"
              label="SR&ED title"
              onSave={async (value) => {
                await updateTitles({ projectId, sredTitle: value });
              }}
            />
          </div>
          <div>
            <span class="text-label block">Client</span>
            <p class="mt-1 text-gray-800">{project.clientName}</p>
          </div>
          <div>
            <span class="text-label block">Consultant</span>
            <p class="mt-1 text-gray-800">{writerLabel}</p>
          </div>
          {#if interviewerLabel}
            <div>
              <span class="text-label block">Interviewer</span>
              <p class="mt-1 text-gray-800">{interviewerLabel}</p>
            </div>
          {/if}
          {#if interviewees.length > 0}
            <div>
              <span class="text-label block">Interviewees</span>
              <p class="mt-1 text-gray-800">{interviewees.join(", ")}</p>
            </div>
          {/if}
          <div>
            <span class="text-label block">Created</span>
            <p class="mt-1 text-gray-800">
              {new Date(project.createdAt).toLocaleDateString("en-US", {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </p>
          </div>
          <div>
            <span class="text-label block">Fiscal year-end</span>
            <FiscalYearField
              {projectId}
              fiscalYearEnd={project.fiscalYearEnd ?? null}
            />
          </div>
          <div>
            <span class="text-label block">Industry</span>
            <IndustryField
              {projectId}
              industry={project.industry ?? null}
              canCreate={user?.role === "admin"}
            />
          </div>
          <div>
            <span class="text-label block">Science code</span>
            <ScienceCodeField
              {projectId}
              scienceCode={project.scienceCode ?? null}
            />
          </div>
          <div class="sm:col-span-2">
            <div class="flex items-center gap-2">
              <span class="text-label block">Tags</span>
              {#if tagsSaving}
                <span class="text-xs text-gray-400">Saving…</span>
              {/if}
            </div>
            <div class="mt-1.5">
              <TagPicker
                {allTags}
                bind:selectedTagIds
                label={null}
                onChange={handleTagsChange}
              />
            </div>
            {#if tagError}
              <p class="mt-1 text-xs text-red-700" role="alert">{tagError}</p>
            {/if}
          </div>
        </div>
        {#if viewSummary && viewSummary.totalViews > 0}
          <div class="mt-3 flex flex-wrap items-center gap-3">
            <div class="flex items-center gap-1.5 text-xs text-gray-400">
              <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
              {viewSummary.totalViews} view{viewSummary.totalViews !== 1 ? "s" : ""}
            </div>
            {#each viewSummary.uniqueViewers as viewer (`${viewer.name}-${viewer.type}`)}
              <span class="inline-flex items-center gap-1 rounded-full bg-chrome px-2 py-0.5 text-xs text-gray-500">
                {viewer.name}
                <span class="text-gray-300">
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
    {/snippet}

    <!-- Page bar: back + report actions (hidden while picking a draft) -->
    <PageBar>
      {#snippet center()}
        {#if showIterativeStepper && generation?.iterativeModelLabel}
          <span class="text-xs text-gray-400">Model: {generation.iterativeModelLabel}</span>
        {/if}
      {/snippet}
      {#snippet actions()}
        {#if showIterativeStepper}
          <button
            type="button"
            onclick={() => (confirmCancelIterative = true)}
            class="px-2 text-xs text-gray-400 transition-colors hover:text-red-600"
          >
            Cancel iterative draft
          </button>
        {/if}
        {#if report && !awaitingSelection && !showIterativeStepper}
            <IconAction
              label={sharing ? "Publishing…" : "Share"}
              title="Publish and copy review link"
              onclick={handleCopyShareLink}
              disabled={sharing}
            >
              {#snippet icon()}
                <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                </svg>
              {/snippet}
            </IconAction>
            {#if ghostSnapshot}
              <IconAction
                label="Compare drafts"
                title="Compare with the one-shot draft"
                onclick={() => (ghostCompareOpen = true)}
              >
                {#snippet icon()}
                  <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M9 4v16m6-16v16M4 8h4m8 0h4M4 16h4m8 0h4M6 4h12a2 2 0 012 2v12a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2z" />
                  </svg>
                {/snippet}
              </IconAction>
            {/if}
            <IconAction label="History" onclick={() => (showHistory = true)}>
              {#snippet icon()}
                <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              {/snippet}
            </IconAction>
            <IconAction
              label={workspaceMaximized ? "Minimize" : "Maximize"}
              title={workspaceMaximized ? "Minimize editor" : "Maximize editor"}
              onclick={() => (workspaceMaximized = !workspaceMaximized)}
            >
              {#snippet icon()}
                <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  {#if workspaceMaximized}
                    <path stroke-linecap="round" stroke-linejoin="round" d="M9 9H4.5M9 9V4.5M15 9h4.5M15 9V4.5M9 15H4.5M9 15v4.5M15 15h4.5M15 15v4.5" />
                  {:else}
                    <path stroke-linecap="round" stroke-linejoin="round" d="M7 3H3v4M3 3l6 6m8-6h4v4m0-4-6 6M7 21H3v-4m0 4 6-6m8 6h4v-4m0 4-6-6" />
                  {/if}
                </svg>
              {/snippet}
            </IconAction>
            <IconAction
              label={exporting ? "Exporting…" : "Export .docx"}
              title="Export .docx"
              onclick={handleExport}
              disabled={exporting}
            >
              {#snippet icon()}
                <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
              {/snippet}
            </IconAction>
            <IconAction label="Financial" href={`/project/${projectId}/financial`}>
              {#snippet icon()}
                <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              {/snippet}
            </IconAction>
        {:else if awaitingSelection}
          <IconAction
            label={candidateMaximized ? "Minimize" : "Maximize"}
            title={candidateMaximized ? "Minimize draft selection" : "Maximize draft selection"}
            onclick={() => (candidateMaximized = !candidateMaximized)}
          >
            {#snippet icon()}
              <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                {#if candidateMaximized}
                  <path stroke-linecap="round" stroke-linejoin="round" d="M9 9H4.5M9 9V4.5M15 9h4.5M15 9V4.5M9 15H4.5M9 15v4.5M15 15h4.5M15 15v4.5" />
                {:else}
                  <path stroke-linecap="round" stroke-linejoin="round" d="M7 3H3v4M3 3l6 6m8-6h4v4m0-4-6 6M7 21H3v-4m0 4 6-6m8 6h4v-4m0 4-6-6" />
                {/if}
              </svg>
            {/snippet}
          </IconAction>
        {/if}
      {/snippet}
    </PageBar>

    <!-- Generation progress — no metadata header; the progress card is the page -->
    {#if generation && (isGenerating || showFailedGeneration)}
      <div class="flex min-h-0 flex-1 items-center overflow-y-auto">
        <div class="mx-auto w-full max-w-3xl px-6 py-8">
          <GenerationProgress generationId={generation._id} />
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

    <!-- Editor workspace + chat rail (single view, resizable — BNH-14) -->
    {#if !awaitingSelection && !showIterativeStepper && report}
      <div bind:this={workspaceEl} class={`mx-auto flex min-h-0 w-full flex-1 overflow-hidden transition-[max-width] duration-[325ms] ease-out motion-reduce:transition-none ${workspaceMaximized ? "max-w-full" : "max-w-[var(--container-shell)]"}`}>
        <div class="min-h-0 flex-1 overflow-y-auto">
            <div class={`mx-auto transition-[max-width,padding] duration-[325ms] ease-out motion-reduce:transition-none ${workspaceMaximized ? "max-w-full px-7 py-6" : chatOpen || qaOpen ? "max-w-report px-10 py-10" : "max-w-[var(--container-shell)] px-10 py-10"}`}>
              <!-- Project info header -->
              {@render projectMetadata()}

              <!-- Editor column -->
              <Editor
                bind:this={editorRef}
                content={report.content}
                onUpdate={handleEditorUpdate}
                onComment={handleComment}
                onAskAI={handleAskAI}
                editable={true}
                {commentRanges}
                onHoverComment={(id) => (hoveredCommentId = id)}
              />

              <!-- Supporting panels (QA moved to the right rail — BNH-47) -->
              <div class="mt-8 mb-12">
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
        {#if report && user && (chatOpen || qaOpen)}
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
              if (event.key === "ArrowLeft") adjustRail(0.02);
              else if (event.key === "ArrowRight") adjustRail(-0.02);
              else if (event.key === "Home") chatRatio = CHAT_MIN;
              else if (event.key === "End") chatRatio = CHAT_MAX;
              else return;
              event.preventDefault();
            }}
            title="Drag or use arrow keys to resize"
            class="group flex w-3 flex-none cursor-col-resize items-center justify-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-navy"
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
            class={`relative flex min-h-0 flex-none flex-col overflow-hidden bg-canvas py-6 ${chatOpen || qaOpen ? (workspaceMaximized ? "pl-1 pr-7" : "pl-1 pr-6") : ""} ${dragging ? "" : "transition-all duration-[325ms] ease-out"}`}
            style={`width: ${chatOpen || qaOpen ? `${chatRatio * 100}%` : "0%"}`}
          >
            <!-- BNH-47: QA review — shared rail card (in flow; exactly one
                 of chat/QA is in flow at a time via railView) -->
            {#if railView === "qa"}
              <QARailPanel
                open={qaOpen}
                onClose={() => (qaOpen = false)}
                modelName={generation?.selectedModelLabel ?? generation?.iterativeModelLabel ?? null}
                agentOutputs={generation?.agentOutputs}
                reportContent={report.content}
                reportId={report._id}
                onLocateGap={locateGap}
                onRunQa={generation?.candidateMode === "iterative" && generation.status === "completed"
                  ? async () => {
                      await requestReportQaMut({ generationId: generation._id });
                    }
                  : undefined}
                postQaStatus={generation?.postQaStatus ?? null}
              />
            {/if}
            <div
              class={`chat-rise relative flex h-full origin-bottom flex-col overflow-hidden rounded-2xl border border-chrome bg-white ${chatOpen ? "" : "is-closed"} ${railView !== "chat" ? "hidden" : ""}`}
              role="dialog"
              aria-label="AI assistant"
              inert={!chatOpen}
            >
              <button
                onclick={() => (chatOpen = false)}
                title="Close assistant (Esc)"
                aria-label="Close assistant"
                class="absolute right-3 top-3 z-10 flex h-7 w-7 items-center justify-center rounded-md text-gray-400 transition-colors hover:text-navy"
              >
                <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
              {#if AGENT_CHAT}
                <AgentChatPanel
                  {projectId}
                  reportId={report._id}
                  pendingHighlight={pendingChatHighlight}
                  onClearHighlight={() => (pendingChatHighlight = null)}
                  onReferenceText={(texts, scrollTo) => editorRef?.highlightText(texts, scrollTo)}
                  onReviewReplacements={startReplaceReview}
                  onPreviewProposal={(pairs, on) => {
                    if (on && pairs.length) editorRef?.previewProposal(pairs);
                    else editorRef?.clearProposalPreview();
                  }}
                  reviewingId={replaceSession?.messageId ?? null}
                />
              {:else}
                <ChatPanel
                  {projectId}
                  reportId={report._id}
                  pendingHighlight={pendingChatHighlight}
                  onClearHighlight={() => (pendingChatHighlight = null)}
                  onReferenceText={(texts, scrollTo) => editorRef?.highlightText(texts, scrollTo)}
                  onReviewReplacements={startReplaceReview}
                  reviewingMessageId={(replaceSession?.messageId ?? null) as Id<"chatMessages"> | null}
                />
              {/if}
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
              class="inline-flex items-center gap-1 rounded-lg bg-green-500 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-green-600"
            >
              Replace · Next
              <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </button>
            <button
              onclick={replaceAllRemaining}
              class="rounded-lg bg-orange-500 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-orange-600"
            >
              Replace All
            </button>
            <button
              onclick={rejectAndNext}
              class="rounded-lg bg-red-500 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-red-600"
            >
              Reject
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
        commenterName={user.name ?? user.email ?? "Consultant"}
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
            class="mt-1.5 w-full rounded-lg border border-gray-200 bg-chrome px-3 py-2 font-mono text-xs text-gray-700 focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
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
            {#each readinessBlockers as blocker (blocker.code)}
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

    <!-- No report, not generating — review-mode feedback report or transcript -->
    {#if !report && !isGenerating && !awaitingSelection && !showIterativeStepper && !showFailedGeneration}
      <main class="mx-auto w-full max-w-3xl min-h-0 flex-1 overflow-y-auto px-6 py-8">
        {@render projectMetadata()}

        {#if project.mode === "review" && generation?.status === "failed"}
          <div class="mt-8 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5">
            <p class="text-sm text-red-700">
              The comparison draft generation failed{generation.error ? `: ${generation.error}` : "."}
              Use “Generate PD for comparison” below to retry.
            </p>
          </div>
        {/if}

        {#if project.mode === "review" && pdReview}
          <div class="mt-8">
            <PdReviewReport
              review={pdReview}
              hasTranscript={Boolean(transcript?.content?.trim())}
              onGenerate={handleGenerateFromReview}
            />
          </div>
        {/if}

        <div class="mt-8" hidden={project.mode === "review" && !transcript?.content?.trim()}>
          <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 class="text-sm font-semibold uppercase tracking-wide text-gray-400">
              Transcript
            </h2>
            {#if transcript}
              <div class="flex flex-wrap items-center gap-2 sm:justify-end">
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
                  <div class="ml-auto">
                    {#if candidateMode !== "compare"}
                      <SingleModelPicker bind:value={singleModelId} />
                    {:else}
                      <ComparePairPicker bind:slotA={compareSlotA} bind:slotB={compareSlotB} />
                    {/if}
                  </div>
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
            {/if}
          </div>
          {#if transcript}
            <div class="mt-3 rounded-lg border border-gray-200 bg-white p-4">
              <p class="whitespace-pre-wrap font-serif text-sm leading-relaxed text-gray-700">
                {transcript.content}
              </p>
            </div>
          {:else}
            <p class="mt-3 text-sm text-gray-400">
              Loading transcript...
            </p>
          {/if}
        </div>
      </main>
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
{/if}

