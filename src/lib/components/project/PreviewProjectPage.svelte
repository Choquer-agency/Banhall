<script lang="ts" module>
  // PSOS-04: one outbox-flush attempt per user per project per app session.
  // Module-local so re-entering the route doesn't re-fire it. Keyed by user as
  // well as project because a session can change hands without a sign-out (an
  // expiry, then a different person signs in) — keying on project alone would
  // silently skip the second user's own queued failures.
  const flushedOutboxProjects = new Set<string>();
</script>

<script lang="ts">
  import { onDestroy, tick, untrack } from "svelte";
  import { goto, pushState } from "$app/navigation";
  import { goToLogin } from "$lib/auth/goToLogin";
  import { resolve } from "$app/paths";
  import WorkspaceShell from "$lib/components/workspace/WorkspaceShell.svelte";
  import { page } from "$app/state";
  import { useConvexClient, useQuery, useMutation, useAction } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { overlayFade, modalPop } from "$lib/motion";
  import { api } from "../../../../convex/_generated/api";
  import type { Id } from "../../../../convex/_generated/dataModel";
  import ProjectStateBadge from "$lib/components/dashboard/ProjectStateBadge.svelte";
  import Button from "$lib/components/ui/Button.svelte";
  import Spinner from "$lib/components/ui/Spinner.svelte";
  import GenerationProgress from "$lib/components/generation/GenerationProgress.svelte";
  import GenerationStatusChip from "$lib/components/generation/GenerationStatusChip.svelte";
  import SeedWorkspace from "$lib/components/seeds/SeedWorkspace.svelte";
  import SeedSummaryReview from "$lib/components/seeds/SeedSummaryReview.svelte";
  import SeedInitializationRecovery from "$lib/components/seeds/SeedInitializationRecovery.svelte";
  import { seedsApi } from "$lib/components/seeds/api";
  import {
    focusSummaryOpener,
    SEED_SIGNED_OFF_SUMMARY_TRIGGER_ID,
    SEED_SUMMARY_TAB_ID,
  } from "$lib/components/seeds/summaryFocus";
  import {
    focusGenerationProgress,
    GENERATION_PROGRESS_HEADING_ID,
    GENERATION_PROGRESS_REGION_ID,
  } from "$lib/components/generation/progressFocus";
  import SeedDraftingView from "$lib/components/generation/writing/SeedDraftingView.svelte";
  import StopDraftingDialog from "$lib/components/generation/writing/StopDraftingDialog.svelte";
  import NotDraftedBanner from "$lib/components/generation/writing/NotDraftedBanner.svelte";
  import DraftReadyToast from "$lib/components/generation/writing/DraftReadyToast.svelte";
  import { seedRedraftAttempt } from "$lib/components/generation/writing/draftProgress";
  import { notDraftedReportSections } from "../../../../convex/lib/tiptapReport";
  import { PD_SECTION_HEADINGS } from "../../../../shared/pdSubsections";
  import Editor from "$lib/components/editor/Editor.svelte";
  import type {
    CommentRange,
    ResearchSelection,
    WriterEditorHandle,
  } from "$lib/components/editor/types";
  import QAScorePanel from "$lib/components/editor/QAScorePanel.svelte";
  import ChronologyTable from "$lib/components/editor/ChronologyTable.svelte";
  import ModelTestSummary from "$lib/components/editor/ModelTestSummary.svelte";
  import FilesPanel from "$lib/components/editor/FilesPanel.svelte";
  import Disclosure from "$lib/components/ui/Disclosure.svelte";
  import DisclosureChevron from "$lib/components/ui/DisclosureChevron.svelte";
  import { normalizeExtractedText } from "$lib/parseDocument";
  import { projectPagingPosition } from "$lib/workspace/projectPagingContext";
  import FilingReadinessPanel from "$lib/components/evidence/FilingReadinessPanel.svelte";
  import LogsPanel from "$lib/components/editor/LogsPanel.svelte";
  import CommentOverlay from "$lib/components/comments/CommentOverlay.svelte";
  import LazyModule from "$lib/components/ui/LazyModule.svelte";
  import PdReviewReport from "$lib/components/review-pd/PdReviewReport.svelte";
  import PdReviewStart from "$lib/components/review-pd/PdReviewStart.svelte";
  import SelectInput from "$lib/components/ui/SelectInput.svelte";
  import ProjectTopBar, { type TopBarMoreItem } from "$lib/components/project/shell/ProjectTopBar.svelte";
  import PanelToolbar, { type PanelTab } from "$lib/components/project/shell/PanelToolbar.svelte";
  import QaToggle from "$lib/components/qa/QaToggle.svelte";
  import QaFinishedNotice from "$lib/components/qa/QaFinishedNotice.svelte";
  import { qaSectionScores } from "$lib/qa/qaSectionScores";
  import { markQaDismissed, markQaSeen, readQaSeen, type QaSeenState } from "$lib/qa/qaSeen";
  import SourcesView from "$lib/components/project/shell/SourcesView.svelte";
  import TranscriptSpeakersPopover from "$lib/components/project/shell/TranscriptSpeakersPopover.svelte";
  import {
    readTranscriptFile,
    releaseOriginalsOnFailure,
    TranscriptFileError,
    transcriptContentHash,
    uploadTranscriptOriginal,
  } from "$lib/transcriptUpload";
  import DetailsPanel from "$lib/components/project/details/DetailsPanel.svelte";
  import DetailsPopover from "$lib/components/project/details/DetailsPopover.svelte";
  import DetailsMore from "$lib/components/project/details/DetailsMore.svelte";
  import { useDetailsData } from "$lib/components/project/details/detailsData.svelte";
  import type { WorkflowStage } from "../../../../shared/workflowStages";
  import ExportValidationDialog from "$lib/components/export/ExportValidationDialog.svelte";
  import {
    canonicalizeExportPreflight,
    isSameExportRevision,
    validateExport,
    type CanonicalExportReport,
    type ExportValidationResult,
  } from "$lib/exportValidation";
  import { userErrorCode, userErrorMessage, userErrorReason } from "$lib/errors";
  import { flushOutboxFor } from "$lib/uploads/outboxFlush";
  import { toast } from "svelte-sonner";
  import { comparePairFromSlots } from "../../../../shared/generationModels";
  import { pickerModels } from "$lib/modelPicker";
  import ComparePairPicker from "$lib/components/generation/ComparePairPicker.svelte";
  import SingleModelPicker from "$lib/components/generation/SingleModelPicker.svelte";
  import GhostCompareDialog from "$lib/components/generation/GhostCompareDialog.svelte";
  import { displayName } from "$lib/displayName";
  import { projectCapabilityAllows } from "../../../../shared/capabilities";
  import { setProposalSectionSource } from "$lib/chat/proposalSection";

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
  const reportGenerationQ = useQuery(api.generations.getGenerationSeedView, () =>
    auth.isAuthenticated && reportQ.data?.generationId
      ? { generationId: reportQ.data.generationId }
      : "skip"
  );
  const transcriptsQ = useQuery(api.transcripts.listTranscripts, () =>
    auth.isAuthenticated ? { projectId } : "skip"
  );
  // Which transcript is open. "default" means the reader has not chosen yet:
  // generate-mode projects open the first transcript, review-mode projects open
  // none (2026-08-10: there the written PD is the focus). One id, so exactly
  // one body can be subscribed.
  let openChoice = $state<Id<"transcripts"> | "default" | null>("default");
  const openTranscriptId = $derived.by(() => {
    const transcripts = transcriptsQ.data;
    // Paging to the previous/next project keeps this component mounted, so a
    // chosen id can outlive the list it came from. An id no loaded row carries
    // is not a choice: it falls back to the default rather than holding a body
    // subscription nothing on screen shows.
    const choice =
      openChoice !== null &&
      openChoice !== "default" &&
      transcripts !== undefined &&
      !transcripts.some((t) => t._id === openChoice)
        ? "default"
        : openChoice;
    if (choice !== "default") return choice;
    return projectQ.data?.mode === "review" ? null : (transcripts?.[0]?._id ?? null);
  });
  // 2026-09-24 (transcript method): opening a transcript queues its fact
  // extraction in the background; the server ignores it when the method is
  // off or the facts already exist.
  const requestTranscriptFacts = useMutation(api.transcripts.requestTranscriptFacts);
  function toggleTranscript(transcriptId: Id<"transcripts">) {
    const opening = openTranscriptId !== transcriptId;
    openChoice = opening ? transcriptId : null;
    if (opening) void requestTranscriptFacts({ transcriptId }).catch(() => {});
  }

  // Metadata only above; the body of the one open transcript below. A project
  // with ten interviews costs ten rows of a few hundred bytes, not ten bodies.
  const openTranscriptQ = useQuery(api.transcripts.getTranscriptContent, () =>
    auth.isAuthenticated && openTranscriptId
      ? { transcriptId: openTranscriptId }
      : "skip"
  );
  const documentsQ = useQuery(api.documents.listDocuments, () =>
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
  // BNH-39: review-mode projects show the AI feedback report on the written PD.
  const pdReviewQ = useQuery(api.pdReviews.getLatestPdReview, () =>
    auth.isAuthenticated ? { projectId } : "skip"
  );
  // 2026-09-15 metadata gate: the same scope the metadata mutations enforce
  // (Owner, open-work-item collaborator, Manager, Admin). While the answer is
  // still loading the controls stay editable so an eligible editor never sees
  // a read-only flash; a definite `false` swaps them for plain values.
  const editAccessQ = useQuery(api.projects.getProjectEditAccess, () =>
    auth.isAuthenticated ? { projectId } : "skip"
  );
  // Loading keeps the controls editable (no read-only flash for an eligible
  // editor; the server still rejects an ineligible save). A query error is
  // not "loading": fail closed to read-only until it resolves.
  const canEditDetails = $derived(
    editAccessQ.error ? false : (editAccessQ.data?.canEditDetails ?? true)
  );

  const generateReport = useMutation(api.generations.requestGeneration);
  const recordUploadAttempts = useMutation(api.uploadAttempts.recordUploadAttempts);
  const logPdReviewEvent = useMutation(api.pdReviews.logPdReviewEvent);
  const updateReport = useMutation(api.reports.updateReportContent);
  const createSnapshot = useMutation(api.snapshots.createManualSnapshot);
  const markProposalApplied = useMutation(api.chatV2.markProposalApplied);
  const authorizeExport = useMutation(api.reports.authorizeExport);
  const completeExport = useMutation(api.reports.completeExport);
  const failExport = useMutation(api.reports.failExport);
  const publishForReview = useMutation(api.projects.publishForReview);
  // 2026-09-24 (transcript method): Add, Replace and Remove on the Sources tab.
  const addTranscriptMut = useMutation(api.transcripts.addTranscript);
  const replaceTranscriptMut = useMutation(api.transcripts.replaceTranscript);
  const removeTranscriptMut = useMutation(api.transcripts.removeTranscript);
  const discardTranscriptOriginalsMut = useMutation(api.transcripts.discardTranscriptOriginals);
  const generateTranscriptUploadUrl = useMutation(api.documents.generateUploadUrl);
  const claimTranscriptUpload = useMutation(api.documents.claimUpload);
  let transcriptBusy = $state(false);

  /**
   * Reads a transcript file and stores it as a new or replacing row. The
   * duplicate check leaves out the row being replaced, as the server does.
   * When the server refuses the change, the original file uploaded for it
   * is released again.
   */
  async function storeTranscriptFile(file: File, replacing: string | null) {
    if (transcriptBusy) return;
    transcriptBusy = true;
    try {
      const read = await readTranscriptFile(file);
      const hash = await transcriptContentHash(read.content);
      const duplicate = transcripts.find((row) => row.contentHash === hash && row._id !== replacing);
      if (duplicate) {
        toast.error(`This transcript is already added (${duplicate.label}).`);
        return;
      }
      const originalStorageId = await uploadTranscriptOriginal(
        file,
        () => generateTranscriptUploadUrl({}),
        (storageId) => claimTranscriptUpload({ storageId: storageId as Id<"_storage"> })
      );
      const upload = {
        content: read.content,
        label: read.label,
        sourceFormat: read.format,
        ...(originalStorageId ? { originalStorageId: originalStorageId as Id<"_storage"> } : {}),
      };
      await releaseOriginalsOnFailure(
        originalStorageId ? [originalStorageId] : [],
        (storageIds) => discardTranscriptOriginalsMut({ storageIds: storageIds as Id<"_storage">[] }),
        () =>
          replacing
            ? replaceTranscriptMut({ transcriptId: replacing as Id<"transcripts">, ...upload })
            : addTranscriptMut({ projectId, ...upload })
      );
      toast.success(replacing ? `Replaced with ${file.name}` : `Added ${file.name}`);
    } catch (error) {
      toast.error(
        error instanceof TranscriptFileError
          ? error.message
          : userErrorMessage(error, "The transcript could not be saved.")
      );
    } finally {
      transcriptBusy = false;
    }
  }

  // Speakers popover: one transcript's speaker rows, subscribed only while
  // its popover is open.
  let speakersOpenFor = $state<string | null>(null);
  const speakersQ = useQuery(api.transcripts.getTranscriptSpeakers, () =>
    speakersOpenFor ? { transcriptId: speakersOpenFor as Id<"transcripts"> } : "skip"
  );
  const setSpeakerRoleMut = useMutation(api.transcripts.setSpeakerRole);
  const confirmSpeakersMut = useMutation(api.transcripts.confirmSpeakers);
  let speakersBusy = $state(false);

  async function setSpeakerRole(
    transcriptId: string,
    label: string,
    role: "interviewer" | "client" | "other"
  ) {
    speakersBusy = true;
    try {
      await setSpeakerRoleMut({ transcriptId: transcriptId as Id<"transcripts">, label, role });
    } catch (error) {
      toast.error(userErrorMessage(error, "The speaker's role could not be saved."));
    } finally {
      speakersBusy = false;
    }
  }

  async function confirmSpeakers(transcriptId: string) {
    speakersBusy = true;
    try {
      await confirmSpeakersMut({ transcriptId: transcriptId as Id<"transcripts"> });
    } catch (error) {
      toast.error(userErrorMessage(error, "The speakers could not be confirmed."));
    } finally {
      speakersBusy = false;
    }
  }

  async function removeTranscript(transcriptId: string) {
    if (transcriptBusy) return;
    transcriptBusy = true;
    try {
      await removeTranscriptMut({ transcriptId: transcriptId as Id<"transcripts"> });
      toast.success("Transcript removed");
    } catch (error) {
      toast.error(userErrorMessage(error, "The transcript could not be removed."));
    } finally {
      transcriptBusy = false;
    }
  }
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
  // Suggested-edit cards in the assistant name their Section ("Suggested edit for 242").
  setProposalSectionSource(() => report?.content);
  const generation = $derived(generationQ.data);
  const transcripts = $derived(transcriptsQ.data ?? []);
  const openTranscript = $derived(openTranscriptQ.data);
  const user = $derived(userQ.data);
  // Same authority as publishForReview: project.setStage (the current
  // Owner, a Manager or an Admin), never createdBy.
  const canShare = $derived(
    Boolean(
      project &&
        user &&
        projectCapabilityAllows(user.role, "project.setStage", project, user._id)
    )
  );
  const pdReview = $derived(pdReviewQ.data);

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
  // Sprint 1 story 6 (CAP-2): while a replace session is active, autosave is
  // held and the latest editor JSON parks here (see handleEditorUpdate). The
  // session exit writes it through markProposalApplied, which snapshots the
  // pre-session content, fences on the revision, writes content + status and
  // bumps the revision in one transaction — no content for that proposal ever
  // reaches the report without its snapshot.
  let sessionDraftJson: string | null = null;
  // The in-flight session exit: stepper handlers bail while it runs and
  // flushEditor awaits it.
  let finishingReplace: Promise<void> | null = null;
  function notifyReplace(msg: string) {
    replaceNotice = msg;
    setTimeout(() => (replaceNotice = null), 4000);
  }

  function markApplied(id: string, content: string, expectedRevisionNumber: number) {
    return markProposalApplied({
      proposalId: id as Id<"chatProposals">,
      content,
      expectedRevisionNumber,
    });
  }

  async function startReplaceReview(
    pairs: { find: string; replaceWith: string }[],
    messageId: string
  ) {
    // Close any session still open and persist pending typing through the
    // normal save path first, so the pre_chat_edit snapshot taken at this
    // session's exit equals the document exactly as it stands now. A standing
    // save error stays visible in the header; it does not block the review.
    try {
      await flushEditor();
    } catch {
      /* surfaced via saveError */
    }
    const ed = editorRef;
    if (!ed || !report || replaceSession || finishingReplace) return;
    if (reportReadOnly) {
      notifyReplace("Drafting the missing sections. Editing resumes when they are in.");
      return;
    }
    const matches = ed.findReplaceMatches(pairs);
    if (matches.length === 0) {
      notifyReplace(
        `No matching passage remains for “${pairs[0]?.find ?? "this suggestion"}”. The report may have changed; refine or ask again.`
      );
      return;
    }
    const first = matches[0];
    ed.highlightRange(first.from, first.to, first.text);
    sessionDraftJson = null;
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

  /**
   * The single exit for every replace session. Order matters: the flush runs
   * while autosave is still held, so the latest visible document lands in
   * sessionDraftJson instead of a plain save; only then is the hold released.
   * With at least one replacement the document is written through
   * markProposalApplied (snapshot + revision fence + content + status, one
   * transaction). With none, anything typed during the session takes the
   * normal save path. Never rejects: failures surface via notifyReplace.
   */
  function finishReplaceSession(sess: ReplaceSession): Promise<void> {
    if (finishingReplace) return finishingReplace;
    const run = async () => {
      try {
        const ed = editorRef;
        ed?.clearHighlight();
        // Capture while replaceSession is still set (autosave held).
        await ed?.flushPendingSave();
        const draft = sessionDraftJson;
        sessionDraftJson = null;
        replaceSession = null;
        if (sess.replaced > 0) {
          if (draft === null) {
            notifyReplace(
              "The replaced text is still in the editor but could not be captured for saving. Make any edit to save it."
            );
            return;
          }
          pendingSaves += 1;
          saving = true;
          saveError = "";
          const apply = async () => {
            const result = await markApplied(sess.messageId, draft, localRevision);
            localRevision = result.revisionNumber;
          };
          saveChain = saveChain.then(apply, apply);
          try {
            await saveChain;
          } catch (error) {
            // A stale revision or a rejected write must not crash the page:
            // the header keeps the persistent save error, the stepper shows
            // the notice, and the text stays in the editor.
            const message = userErrorMessage(error, "The replacements could not be saved.");
            saveError = message;
            notifyReplace(message);
          } finally {
            pendingSaves -= 1;
            saving = pendingSaves > 0;
          }
        } else if (draft !== null) {
          await handleEditorUpdate(draft);
        }
      } catch (error) {
        notifyReplace(userErrorMessage(error, "The replacements could not be saved."));
      } finally {
        finishingReplace = null;
      }
    };
    finishingReplace = run();
    return finishingReplace;
  }

  function advanceReplace(cursor: number, addedReplaced: number) {
    const sess = replaceSession;
    const ed = editorRef;
    if (!sess || !ed || finishingReplace) return;
    const next =
      ed.findReplaceMatches(sess.pairs).find((m) => m.from >= cursor) ?? null;
    const replaced = sess.replaced + addedReplaced;
    if (next) {
      ed.highlightRange(next.from, next.to, next.text);
      replaceSession = { ...sess, cursor, position: sess.position + 1, current: next, replaced };
    } else {
      void finishReplaceSession({ ...sess, replaced });
    }
  }

  function replaceAndNext() {
    const sess = replaceSession;
    const ed = editorRef;
    if (!sess?.current || !ed || finishingReplace) return;
    // Count only a replacement that changed the document; a refused one is
    // stepped over like "Keep original" (review g1).
    const changed = ed.replaceRange(sess.current.from, sess.current.to, sess.current.replaceWith);
    if (changed) advanceReplace(sess.current.from + sess.current.replaceWith.length, 1);
    else advanceReplace(sess.current.to, 0);
  }

  function keepOriginalAndNext() {
    const sess = replaceSession;
    if (!sess?.current || finishingReplace) return;
    advanceReplace(sess.current.to, 0);
  }

  function replaceAllRemaining() {
    const sess = replaceSession;
    const ed = editorRef;
    if (!sess || !ed || finishingReplace) return;
    let cursor = sess.current ? sess.current.from : sess.cursor;
    let replaced = sess.replaced;
    for (let i = 0; i < 5000; i++) {
      const m = ed.findReplaceMatches(sess.pairs).find((x) => x.from >= cursor);
      if (!m) break;
      if (ed.replaceRange(m.from, m.to, m.replaceWith)) {
        cursor = m.from + m.replaceWith.length;
        replaced++;
      } else {
        // Refused: step past it instead of finding it again.
        cursor = m.to;
      }
    }
    void finishReplaceSession({ ...sess, replaced });
  }

  function endReplaceReview() {
    const sess = replaceSession;
    if (!sess || finishingReplace) return;
    void finishReplaceSession(sess);
  }

  /** Jump to the exact paragraph identified by the QA agent's [P#] marker. */
  function locateGap(gap: { section: string; paragraph: number | null }) {
    editorRef?.locateSectionParagraph(gap.section, gap.paragraph);
  }

  function handleAskAI(selection: { from: number; to: number; text: string }) {
    void leaveDetailsThen(() => openSidePanel("chat"));
    pendingChatHighlight = selection;
  }

  function handleResearch(selection: ResearchSelection) {
    void leaveDetailsThen(() => openSidePanel("chat"));
    pendingChatHighlight = null;
    pendingResearch = selection;
  }

  // Side slot (ui-design-final.md section 8): the Assistant, QA and Details
  // share one right panel, 400px by default, resized with a hairline divider
  // (pointer and keyboard). Chat and QA open state persist as before; the
  // width persists per browser. The intake context split keeps its ratio
  // clamps below.
  const CHAT_MIN = 0.24;
  const CHAT_MAX = 0.55;
  const SIDE_PANEL_MIN = 320;
  const SIDE_PANEL_MAX = 640;
  const SIDE_PANEL_DEFAULT = 400;
  const clampSidePanel = (width: number) =>
    Math.round(Math.min(SIDE_PANEL_MAX, Math.max(SIDE_PANEL_MIN, width)));
  let sidePanelWidth = $state(SIDE_PANEL_DEFAULT);
  let chatOpen = $state(true);
  let chatPreferencesReady = $state(false);
  let chatFocus = $state(false);
  let desktopAssistant = $state(false);
  $effect(() => {
    const media = window.matchMedia("(min-width: 64rem)");
    const update = () => (desktopAssistant = media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  });
  // Narrow screens show one pane at a time: the report, or the side panel
  // ("assistant" names every side panel: Assistant, QA or Details).
  let mobileWorkspaceView = $state<"report" | "assistant">("report");
  let detailsOpen = $state(false);
  let detailsView = $state<"details" | "handoff">("details");
  let handOffStage = $state<WorkflowStage | null>(null);
  let detailsPeekOpen = $state(false);
  let detailsButton = $state<HTMLButtonElement | null>(null);
  // Sources tab: the main surfaces stay mounted (hidden) so no draft or
  // editor state is lost while it shows.
  let sourcesOpen = $state(false);
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
  // feedback report are the focus, so every transcript starts collapsed —
  // one click to expand. Generate-mode projects open the first one.
  const transcriptBodyIdPrefix = "transcript-body";
  // Review workbench (2026-08-13): the verdict leads the work pane, so the
  // metadata grid demotes into a collapsed disclosure. The page bar already
  // carries the route's h1 title.
  // List-context paging (2026-08-13, Attio-research P1): position of this
  // project inside the bounded page the invoking Projects surface stashed.
  // Recomputed per projectId; null when the reader arrived another way.
  const pagingPosition = $derived(projectPagingPosition(projectId));
  // The generation gate the backend enforces (convex/generations.ts:371-383):
  // a transcript, or failing that a context document with readable text. A
  // review project with no transcript keeps generating from the feedback
  // report's own button, as it does today.
  const canGenerate = $derived(
    transcriptsQ.data !== undefined &&
      (transcripts.length > 0 ||
        (project?.mode !== "review" &&
          (documentsQ.data ?? []).some((doc) => !doc.archived && doc.sizeChars > 0)))
  );
  let intakeEl: HTMLDivElement | null = $state(null);
  let contextDragging = $state(false);
  // BNH-47: QA rail panel. Opening one side panel closes the others so the
  // side slot hosts one surface at a time.
  let qaOpen = $state(false);
  // Which surface occupies the side slot (also while all are closed, so
  // exactly one is in flow at a time).
  let railView = $state<"chat" | "qa" | "details">("chat");
  let workspaceEl: HTMLDivElement | null = $state(null);
  let dragging = $state(false);

  function openSidePanel(view: "chat" | "qa" | "details") {
    chatOpen = view === "chat";
    qaOpen = view === "qa";
    detailsOpen = view === "details";
    railView = view;
    if (view !== "chat") chatFocus = false;
    mobileWorkspaceView = "assistant";
  }
  function closeSidePanel() {
    chatOpen = false;
    qaOpen = false;
    detailsOpen = false;
    chatFocus = false;
    mobileWorkspaceView = "report";
  }
  // Narrow screens show the side panel only as their active pane.
  const sidePanelOnScreen = $derived(desktopAssistant || mobileWorkspaceView === "assistant");
  function toggleSidePanel(view: "chat" | "qa" | "details") {
    const open = view === "chat" ? chatOpen : view === "qa" ? qaOpen : detailsOpen;
    if (open && sidePanelOnScreen) closeSidePanel();
    else openSidePanel(view);
  }
  function openDetails(view: "details" | "handoff" = "details", stage: WorkflowStage | null = null) {
    detailsView = view;
    handOffStage = stage;
    detailsPeekOpen = false;
    openSidePanel("details");
  }
  // Leaving an open Details panel from the host (the toolbar toggles, Ask
  // assistant, Open QA) first lets it save a pending project number edit; a
  // failed save keeps it open with the error instead of losing the edit.
  let detailsPanel = $state<{ requestClose: () => Promise<boolean> } | undefined>();
  // The Assistant's pinned composer, measured, so a corner notice can sit above it.
  let assistantComposerHeight = $state(0);
  // One leave at a time: a second click while the save runs is ignored, so
  // two toggles cannot open and at once close a panel (review g2 B5).
  let leavingDetails = false;
  async function leaveDetailsThen(next: () => void) {
    if (leavingDetails) return;
    const panel = detailsOpen && railView === "details" ? detailsPanel : undefined;
    // Nothing to save: act at once (synchronously, as callers expect).
    if (!panel) {
      next();
      return;
    }
    leavingDetails = true;
    try {
      if (await panel.requestClose()) {
        next();
      } else if (!sidePanelOnScreen) {
        // The failed save sits in a panel a phone tab moved off screen:
        // bring it back so the writer sees the error (review g2 B4).
        mobileWorkspaceView = "assistant";
      }
    } finally {
      leavingDetails = false;
    }
  }
  // The Details (i) toggle, wherever it sits: the panel toolbar, or beside
  // the narrow Outline/Seeds switch during the seed stage (board 3.6). On a
  // narrow screen the toggle moves between those two places, so keyboard
  // focus follows it to the one now shown (review g2 B9).
  async function toggleDetails() {
    const focused = document.activeElement;
    const fromToggle =
      focused instanceof HTMLElement && (focused === detailsButton || focused.hasAttribute("data-seed-details-toggle"));
    if (detailsOpen && sidePanelOnScreen) await leaveDetailsThen(closeSidePanel);
    else openDetails();
    await tick();
    if (!fromToggle || (focused.isConnected && focused.getClientRects().length > 0)) return;
    const counterpart = [detailsButton, document.querySelector<HTMLElement>("[data-seed-details-toggle]")].find(
      (element): element is HTMLElement => !!element && element !== focused && element.isConnected && element.getClientRects().length > 0
    );
    counterpart?.focus();
  }

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
    const w = Number(localStorage.getItem("banhall_side_panel_width"));
    if (Number.isFinite(w) && w > 0) sidePanelWidth = clampSidePanel(w);
    const c = localStorage.getItem("banhall_intake_context_ratio");
    if (c) contextRatio = Math.min(CHAT_MAX, Math.max(CHAT_MIN, parseFloat(c)));
    contextOpen = localStorage.getItem("banhall_intake_context_open") !== "0";
    const savedQa = localStorage.getItem("banhall_qa_open") === "1";
    chatOpen = !savedQa && localStorage.getItem("banhall_chat_open") !== "0";
    qaOpen = savedQa;
    if (savedQa) railView = "qa";
    workspaceMaximized = localStorage.getItem("banhall_project_editor_maximized") === "1";
    candidateMaximized = localStorage.getItem("banhall_candidate_editor_maximized") === "1";
    chatPreferencesReady = true;
  });
  $effect(() => {
    localStorage.setItem("banhall_side_panel_width", String(sidePanelWidth));
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
      sidePanelWidth = clampSidePanel(rect.right - e.clientX);
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
    sidePanelWidth = clampSidePanel(sidePanelWidth + delta);
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
      goToLogin();
    }
  });
  $effect(() => {
    if (report && pendingSaves === 0) localRevision = report.revisionNumber ?? 0;
  });


  async function handleEditorUpdate(json: string) {
    // CAP-2: a replace session holds autosave. Park the latest document here;
    // finishReplaceSession writes it when the session ends.
    if (replaceSession) {
      sessionDraftJson = json;
      return;
    }
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
    // A replace session holds autosave, so "everything visible is persisted"
    // starts with closing that session through its transactional write.
    if (finishingReplace) await finishingReplace;
    else if (replaceSession) await finishReplaceSession(replaceSession);
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
  let singleModelId = $state<string>("");
  // Model catalog: the random compare fill draws from the selectable set.
  const modelCapabilitiesQ = useQuery(api.providerReadiness.getCapabilities, () => ({}));
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
        lengthTarget: lengthTarget as "concise" | "standard" | "full",
        candidateMode,
        ...(candidateMode !== "compare" && singleModelId
          ? { singleModelId }
          : {}),
        ...(candidateMode === "compare"
          ? (() => {
              const pair = comparePairFromSlots(
                compareSlotA,
                compareSlotB,
                pickerModels(modelCapabilitiesQ.data)
              );
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
  const isSeedWorkflow = $derived(
    isIterative && generation?.gatedWorkflow === "seeds"
  );
  let seedSummaryRequested = $state(false);
  $effect(() => {
    seedSummaryRequested = page.url.searchParams.get("view") === "summary";
  });
  const seedSummaryOpen = $derived(
    seedSummaryRequested &&
      (isSeedWorkflow ||
        (reportGenerationQ.data?.gatedWorkflow === "seeds" && !!reportGenerationQ.data.summaryVersionId))
  );
  const showSeedWorkspace = $derived(
    isSeedWorkflow && generation?.seedPhase === "seeding" && !seedSummaryOpen
  );
  // A legacy section-approval run owns the main surface for its whole active
  // life (running or awaiting input), and a compare run owns it while it
  // awaits candidate selection; a report-owned frozen Summary URL never
  // renders beside either and becomes reachable again once it ends (A10, R6-05).
  const showIterativeStepper = $derived(
    isIterative && !isSeedWorkflow &&
      (generation?.status === "running" || generation?.status === "awaiting_input")
  );
  const showSeedSummary = $derived(
    seedSummaryRequested &&
      ((isSeedWorkflow && generation?.seedPhase === "seeding") ||
        (!showIterativeStepper &&
          generation?.status !== "awaiting_selection" &&
          !(isSeedWorkflow &&
            (generation?.seedPhase === "initializing" ||
              generation?.seedPhase === "drafting" ||
              generation?.seedPhase === "draftFailed")) &&
          reportGenerationQ.data?.gatedWorkflow === "seeds" &&
          !!reportGenerationQ.data.summaryVersionId))
  );
  const seedSummaryOwner = $derived(
    isSeedWorkflow && generation?.seedPhase === "seeding"
      ? generation
      : reportGenerationQ.data?.gatedWorkflow === "seeds"
        ? reportGenerationQ.data
        : null
  );
  const showSeedRecovery = $derived(
    isSeedWorkflow && generation?.seedPhase === "draftFailed"
  );
  // A10: only the Seed phases that own the main surface suppress an existing
  // report and its actions; single, compare and legacy section runs keep
  // their prior report visibility while they generate.
  const showSeedDrafting = $derived(
    isSeedWorkflow &&
      (generation?.seedPhase === "initializing" || generation?.seedPhase === "drafting")
  );
  // A7: leaving Summary Review returns focus to the trigger the host
  // re-creates (Back action, browser history). When an accepted sign-off
  // replaces the Seed surfaces with Seed drafting instead, no trigger exists:
  // focus moves to the generation-progress heading once it renders, whether
  // the generation subscription changes before or after the sign-off command
  // resolves.
  let seedSummaryWasShown = false;
  let seedSignOffAccepted = false;
  // A5/A7: this host's lifetime fences every deferred Seed operation below. A
  // response or callback arriving after the host was destroyed changes no
  // URL, Summary state or focus.
  let hostDisposed = false;
  onDestroy(() => {
    hostDisposed = true;
  });
  // A deferred focus operation belongs to the host lifetime, project, user,
  // generation and transition that scheduled it (A5/A7, R5-04). That
  // ownership is rechecked after rendering and before focusing, so an obsolete
  // callback never focuses a replacement page, and a newer transition
  // supersedes an older one still waiting to render.
  let seedFocusToken = 0;
  // Which control opened Summary Review, so leaving it returns focus there:
  // the panel toolbar's Summary tab, or the workspace "Review summary"
  // trigger (also the destination after a browser-history return).
  let summaryOpener: "tab" | "trigger" = "trigger";
  function scheduleSeedFocus(transition: "return" | "drafting") {
    const token = ++seedFocusToken;
    const opener = summaryOpener;
    const owner = {
      projectId: String(projectId),
      userId: user?._id ?? "anonymous",
      generationId: String(generation?._id ?? ""),
    };
    void tick().then(() => {
      if (hostDisposed || token !== seedFocusToken) return;
      if (
        String(projectId) !== owner.projectId ||
        (user?._id ?? "anonymous") !== owner.userId ||
        String(generation?._id ?? "") !== owner.generationId
      ) return;
      if (showSeedDrafting) {
        // The same generation entered Seed drafting: the progress surface is
        // the destination of an accepted sign-off and of a return that
        // coincides with it.
        focusGenerationProgress();
      } else if (transition === "return" && !showSeedSummary) {
        focusSummaryOpener(opener);
      }
    });
  }
  $effect(() => {
    const shown = showSeedSummary;
    const drafting = showSeedDrafting;
    const phase = generation?.seedPhase;
    untrack(() => {
      if (seedSummaryWasShown && !shown) scheduleSeedFocus("return");
      else if (seedSignOffAccepted && drafting) scheduleSeedFocus("drafting");
      // The accepted sign-off is consumed by drafting, or dropped once the
      // run has left the seed stage without it.
      if (drafting || (phase !== "seeding" && !shown)) seedSignOffAccepted = false;
      seedSummaryWasShown = shown;
    });
  });
  // A5/A7: an accepted sign-off completes only for the generation and user
  // that submitted it, and only while this host lives. A response arriving
  // after the host was destroyed, or after that generation or user was
  // replaced, changes no URL, Summary state or focus. The same generation
  // entering drafting before the command resolves still completes normally.
  function completeSeedSignOff(submitted: { generationId: string; userId: string }) {
    if (hostDisposed) return;
    if (
      String(generation?._id) !== String(submitted.generationId) ||
      (user?._id ?? "anonymous") !== submitted.userId
    ) return;
    seedSignOffAccepted = true;
    setSeedSummary(false);
  }
  const isGenerating = $derived(
    generation?.status === "reserved" ||
      (generation?.status === "running" &&
        (!isIterative ||
          (isSeedWorkflow &&
            (generation?.seedPhase === "initializing" || generation?.seedPhase === "drafting"))))
  );
  const awaitingSelection = $derived(generation?.status === "awaiting_selection");
  // The server refuses transcript changes while any generation is active
  // (convex/transcripts.ts); the Sources tab says so up front.
  const transcriptChangesBlocked = $derived(
    generation?.status === "reserved" ||
      generation?.status === "running" ||
      generation?.status === "awaiting_selection" ||
      generation?.status === "awaiting_input"
  );
  // A failed generation gets the progress/retry view — except in review mode,
  // where the PD review stays the main view (its own retry CTA regenerates).
  const showFailedGeneration = $derived(
    generation?.status === "failed" &&
      !showSeedRecovery &&
      !report &&
      project?.mode !== "review"
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
      !showSeedWorkspace &&
      !showSeedSummary &&
      !showSeedRecovery &&
      !showFailedGeneration
  );

  function setSeedSummary(open: boolean) {
    const url = new URL(page.url);
    if (open) url.searchParams.set("view", "summary");
    else if (url.searchParams.get("view") === "summary") url.searchParams.delete("view");
    pushState(`${url.pathname}${url.search}`, {});
    seedSummaryRequested = open;
  }

  // The report surface and its actions (Export, Send for review, the top-bar
  // More menu, the Assistant and QA toggles) show only when no generation
  // surface owns the page.
  const reportActionsVisible = $derived(
    Boolean(report) &&
      !awaitingSelection &&
      !showIterativeStepper &&
      !showSeedSummary &&
      !showSeedWorkspace &&
      !showSeedRecovery &&
      !showSeedDrafting
  );

  // Writing view (ui-design-final.md sections 6 and 7). A signed-off
  // Step-by-step run drafts into the Report tab: the pill, the skeleton and
  // the corner ring replace the centred progress card for these runs only;
  // single, compare and legacy section runs keep GenerationProgress. The
  // same progress read serves the completed report of a signed-off run:
  // whether a "Draft the rest" redraft is live, and when a run this page
  // watched has just finished.
  const writingGenerationId = $derived(
    isSeedWorkflow && generation?.seedPhase === "drafting" && generation.summaryVersionId
      ? generation._id
      : null
  );
  const reportSeedGenerationId = $derived(
    report &&
      reportGenerationQ.data?.gatedWorkflow === "seeds" &&
      reportGenerationQ.data.summaryVersionId &&
      reportGenerationQ.data._id === report.generationId
      ? reportGenerationQ.data._id
      : null
  );
  const draftProgressGenerationId = $derived(writingGenerationId ?? reportSeedGenerationId);
  const draftProgressQ = useQuery(api.generations.getSeedDraftProgress, () =>
    auth.isAuthenticated && draftProgressGenerationId
      ? { generationId: draftProgressGenerationId }
      : "skip"
  );
  const draftProgress = $derived(draftProgressGenerationId ? draftProgressQ.data : undefined);
  // `null` means the server does not treat the run as a signed-off Seed
  // draft, and a failed read cannot show honest progress: in both cases the
  // page falls back to the centred progress card.
  const showWritingView = $derived(
    writingGenerationId !== null && draftProgress !== null && !draftProgressQ.error
  );
  let writingScrollEl = $state<HTMLElement | null>(null);

  // A7 continued: focus that landed on the progress region while the draft
  // progress was loading moves to the writing view's heading once it renders.
  $effect(() => {
    if (!showWritingView || !draftProgress) return;
    void tick().then(() => {
      if (hostDisposed) return;
      if (document.activeElement?.id === GENERATION_PROGRESS_REGION_ID) focusGenerationProgress();
    });
  });

  // Stop (FR-43, owner decision 20): the pill's Stop opens the confirmation;
  // only its primary asks the server to stop after the Section in progress.
  const stopDraftingMut = useMutation(api.generations.stopOrderedGeneration);
  let stopDialogOpen = $state(false);
  let stopError = $state<string | null>(null);
  const writingSectionNumber = $derived.by(() => {
    const progress = draftProgress;
    if (!progress?.currentSectionKey) return null;
    return progress.sections.find((section) => section.key === progress.currentSectionKey)?.number ?? null;
  });
  function openStopDialog() {
    stopError = null;
    stopDialogOpen = true;
  }
  async function confirmStopDrafting() {
    const generationId = writingGenerationId;
    if (!generationId) return;
    stopError = null;
    try {
      await stopDraftingMut({ generationId });
    } catch (error) {
      stopError =
        userErrorReason(error) === "DRAFT_COMPLETE"
          ? "Every section is already drafted. The report is being put together, so there is nothing left to stop."
          : userErrorCode(error) === "STALE_REVISION"
            ? "This draft is no longer running."
            : userErrorMessage(error, "The draft could not be stopped. Try again.");
      throw error;
    }
  }

  // "Not drafted" Sections of a stopped report: the Sections whose body is
  // still exactly the placeholder, so a Section the writer filled by hand is
  // never offered for redrafting.
  const notDraftedSections = $derived.by(() => {
    if (!report || !reportSeedGenerationId) return [];
    return notDraftedReportSections(report.content).map((key) => ({
      number: PD_SECTION_HEADINGS[key].number,
      title: PD_SECTION_HEADINGS[key].title,
    }));
  });
  const redraftLive = $derived(
    reportSeedGenerationId !== null &&
      draftProgressGenerationId === reportSeedGenerationId &&
      draftProgress?.phase === "drafting"
  );
  const redraftMut = useMutation(api.generations.redraftMissingSections);
  let redraftError = $state<string | null>(null);
  // The latest redraft attempt's terminal status and sanitized error, when
  // the progress read carries them (optional field, read defensively).
  const redraftAttempt = $derived(seedRedraftAttempt(draftProgress));
  const redraftFailure = $derived(
    reportSeedGenerationId !== null && redraftAttempt?.status === "failed"
      ? { error: redraftAttempt.error }
      : null
  );
  // "Draft the rest" holds the report read-only from the click until the
  // server content with the filled Sections is in (or the attempt ends): the
  // pending autosave is flushed first, and no keystroke can land between the
  // server merge and the editor taking the merged document. While the
  // redraft is live the progress read keeps it read-only (redraftLive); the
  // hold covers the flush, the request, and a response that arrives before
  // the live phase is visible.
  type RedraftHold = {
    token: number;
    generationId: string;
    baselineAttemptId: string | null;
    requested: boolean;
  };
  let redraftHold = $state.raw<RedraftHold | null>(null);
  let redraftHoldToken = 0;
  const reportReadOnly = $derived(redraftLive || redraftHold !== null);
  $effect(() => {
    const hold = redraftHold;
    if (!hold) return;
    const generationId = reportSeedGenerationId ? String(reportSeedGenerationId) : null;
    const phase = draftProgress?.phase;
    const attempt = redraftAttempt;
    untrack(() => {
      if (redraftHold?.token !== hold.token) return;
      // Another report or generation took the page: nothing to wait for.
      if (generationId !== hold.generationId) {
        redraftHold = null;
        return;
      }
      if (!hold.requested) return;
      const attemptEnded =
        attempt !== null && attempt.attemptId !== hold.baselineAttemptId && attempt.status !== "running";
      // The request resolved: the live phase (redraftLive) now keeps the
      // report read-only until the merged content arrives with its end.
      if (attemptEnded || (phase !== undefined && phase !== "drafting")) redraftHold = null;
    });
  });
  async function draftTheRest() {
    const generationId = reportSeedGenerationId;
    if (!generationId || redraftHold) return;
    redraftError = null;
    const token = ++redraftHoldToken;
    redraftHold = {
      token,
      generationId: String(generationId),
      baselineAttemptId: redraftAttempt?.attemptId ?? null,
      requested: false,
    };
    const release = () => {
      if (redraftHold?.token === token) redraftHold = null;
    };
    try {
      // Every edit the writer made is saved before the server merges.
      await flushEditor();
    } catch {
      release();
      redraftError = "Your latest edits could not be saved, so the missing sections were not drafted. Try again.";
      return;
    }
    try {
      const result = await redraftMut({ generationId });
      if (result.status === "nothing_to_draft") {
        release();
        toast.info("Every section already has text, so there was nothing to draft.");
      } else if (redraftHold?.token === token) {
        redraftHold = { ...redraftHold, requested: true };
      }
    } catch (error) {
      release();
      const code = userErrorCode(error);
      redraftError =
        code === "GENERATION_ACTIVE"
          ? "Another draft is running for this project. Try again when it finishes."
          : code === "NOT_AUTHORIZED"
            ? "You do not have permission to edit this report, so you cannot draft the missing sections."
            : userErrorReason(error) === "NOT_STOPPED"
              ? "This draft was not stopped, so there are no missing sections to draft."
              : userErrorMessage(error, "Could not start drafting the missing sections. Try again.");
    }
  }

  // Draft ready (4.4): a run this page watched while it was writing that
  // then completes with every Section drafted. A stopped run shows the
  // Not drafted banner instead.
  const watchedDrafts = new Set<string>();
  let draftReadyFor = $state<string | null>(null);
  $effect(() => {
    const id = writingGenerationId ?? (redraftLive ? reportSeedGenerationId : null);
    if (id) untrack(() => watchedDrafts.add(String(id)));
  });
  $effect(() => {
    const id = reportSeedGenerationId ? String(reportSeedGenerationId) : null;
    if (!id || !reportActionsVisible || draftProgress?.phase !== "completed") return;
    if (generation?._id !== reportSeedGenerationId || generation?.status !== "completed") return;
    if (notDraftedSections.length > 0) return;
    untrack(() => {
      if (!watchedDrafts.has(id)) return;
      watchedDrafts.delete(id);
      draftReadyFor = id;
    });
  });

  // Effective side-panel visibility (see sidePanelOpen): the Assistant and QA
  // render only beside the report, so elsewhere their saved open state keeps
  // no panel, divider or full screen on the page.
  const sideSurfacesAvailable = $derived(Boolean(report && user && reportActionsVisible));
  const chatShown = $derived(chatOpen && sideSurfacesAvailable);
  const qaShown = $derived(qaOpen && sideSurfacesAvailable);
  // The persisted open state (chatOpen, qaOpen) is a preference. A surface
  // the page does not offer right now (Seed phases, writing, intake) takes
  // no room: the side panel is open only for a surface that can show.
  const sidePanelOpen = $derived(chatShown || qaShown || detailsOpen);
  const assistantFull = $derived(chatFocus && chatShown);
  // Whether the main pane (the tab content) is on screen: not behind
  // Assistant full screen, and not replaced by the side panel on a narrow
  // screen.
  const mainPaneVisible = $derived(
    !assistantFull && !(sidePanelOpen && mobileWorkspaceView === "assistant" && !desktopAssistant)
  );
  // The Assistant's composer is on screen where the corner notice would sit.
  const noticeAboveComposer = $derived(
    railView === "chat" && chatShown && assistantComposerHeight > 0 && !mainPaneVisible
  );

  // Panel toolbar tabs (ui-design-final.md section 2). A Step-by-step run
  // shows Plan, Summary, Report and Sources; everything else Report and
  // Sources. Tabs map onto the existing surfaces: Summary is still the
  // `?view=summary` state with its focus and fencing rules.
  const seedMode = $derived(isSeedWorkflow || reportGenerationQ.data?.gatedWorkflow === "seeds");
  const seeding = $derived(isSeedWorkflow && generation?.seedPhase === "seeding");
  const seedOutlineQ = useQuery(seedsApi.getOutline, () =>
    auth.isAuthenticated && seeding && generation ? { generationId: generation._id } : "skip"
  );
  // Board 3.6: below the large breakpoint the seed stage puts the Details
  // toggle beside the Outline/Seeds switch, so the toolbar drops its own.
  // While the panel covers the narrow screen, the toolbar toggle returns so
  // it can be closed where the seed workspace is hidden.
  // The pane switch exists only while the seed workspace shows its Outline
  // (not on Sources, not while the Outline loads); the toolbar keeps the
  // toggle otherwise (review g2 B8).
  const seedDetailsInPaneSwitch = $derived(
    showSeedWorkspace &&
      !sourcesOpen &&
      seedOutlineQ.data?.generationId === generation?._id &&
      !desktopAssistant &&
      !(detailsOpen && sidePanelOnScreen)
  );
  const planReady = $derived(Boolean(seeding && seedOutlineQ.data?.readiness?.ready));
  const signedOffSummaryAvailable = $derived(
    Boolean(report) &&
      !awaitingSelection &&
      !showIterativeStepper &&
      !showSeedWorkspace &&
      !showSeedRecovery &&
      !showSeedDrafting &&
      reportGenerationQ.data?.gatedWorkflow === "seeds" &&
      !!reportGenerationQ.data.summaryVersionId
  );
  const seedSignedOff = $derived(
    seedMode && !seeding && (signedOffSummaryAvailable || showSeedDrafting || showSeedRecovery || !!generation?.summaryVersionId)
  );
  const activeTab = $derived<PanelTab["id"]>(
    sourcesOpen
      ? "sources"
      : showSeedSummary || showSeedRecovery
        ? "summary"
        : showSeedWorkspace
          ? "plan"
          : "report"
  );
  const sourceCount = $derived(
    transcripts.length + (documentsQ.data ?? []).filter((doc) => !doc.archived).length
  );
  const panelTabs = $derived.by((): PanelTab[] => {
    const sources: PanelTab = { id: "sources", label: "Sources", count: sourceCount || null };
    if (!seedMode) return [{ id: "report", label: "Report" }, sources];
    return [
      { id: "plan", label: "Plan", done: seedSignedOff || planReady, disabled: !seeding },
      {
        id: "summary",
        label: "Summary",
        done: seedSignedOff,
        status: seeding && planReady ? "Ready" : null,
        disabled: !(seeding || signedOffSummaryAvailable || showSeedSummary || showSeedRecovery),
        ...(signedOffSummaryAvailable
          ? { triggerId: SEED_SIGNED_OFF_SUMMARY_TRIGGER_ID, ariaLabel: "Signed-off Summary" }
          : { triggerId: SEED_SUMMARY_TAB_ID }),
      },
      { id: "report", label: "Report", disabled: seeding },
      sources,
    ];
  });
  function selectTab(id: PanelTab["id"]) {
    // Every tab shows main content: leave Assistant full screen, and on a
    // narrow screen show the main pane instead of the side panel.
    chatFocus = false;
    mobileWorkspaceView = "report";
    if (id === "sources") {
      sourcesOpen = true;
      mobileWorkspaceView = "report";
      return;
    }
    sourcesOpen = false;
    if (id === "summary") {
      if (!showSeedSummary && !showSeedRecovery) {
        summaryOpener = "tab";
        setSeedSummary(true);
      }
      return;
    }
    if (id === "report") mobileWorkspaceView = "report";
    if (showSeedSummary) setSeedSummary(false);
  }

  // Details panel data and actions go through one adapter module.
  const details = useDetailsData({
    projectId: () => projectId,
    currentUserId: () => userQ.data?._id,
    canEditDetails: () => canEditDetails,
    panelOpen: () => detailsOpen,
    teamNeeded: () => detailsOpen && detailsView === "handoff",
  });

  // QA toggle and the "QA finished" notice (ui-design-final.md section 7):
  // the score and Section rows come from the stored scorecard; "seen" is
  // browser-local per generation and QA completion (src/lib/qa/qaSeen.ts).
  const qaScores = $derived(qaSectionScores(generation?.agentOutputs ?? null));
  const qaScore = $derived(qaScores?.overall ?? null);
  const qaState = $derived<"idle" | "running" | "done">(
    generation?.postQaStatus === "running" ? "running" : qaScore !== null ? "done" : "idle"
  );
  const qaCompletedAt = $derived(generation?.postQaCompletedAt ?? null);
  let qaSeenTick = $state(0);
  const qaSeen = $derived.by((): QaSeenState | null => {
    void qaSeenTick;
    if (!generation || qaCompletedAt === null || qaState !== "done") return null;
    return readQaSeen(String(generation._id), qaCompletedAt);
  });
  const qaUnseen = $derived(qaSeen !== null && qaSeen !== "seen");
  // The QA panel is rendered and on screen: its side surface is the one in
  // the slot, and on a narrow screen the side panel is the active pane.
  const qaOnScreen = $derived(qaShown && railView === "qa" && sidePanelOnScreen);
  // Showing QA marks the current result seen: no notice, no dot. A restored
  // or kept-open preference whose panel is not on screen marks nothing.
  $effect(() => {
    if (!qaOnScreen || !generation || qaCompletedAt === null || qaState !== "done") return;
    const generationId = String(generation._id);
    const completedAt = qaCompletedAt;
    untrack(() => {
      if (readQaSeen(generationId, completedAt) === "seen") return;
      markQaSeen(generationId, completedAt);
      qaSeenTick += 1;
    });
  });
  function dismissQaNotice() {
    if (!generation || qaCompletedAt === null) return;
    markQaDismissed(String(generation._id), qaCompletedAt);
    qaSeenTick += 1;
  }
  function openQaFromNotice() {
    void leaveDetailsThen(() => openSidePanel("qa"));
  }
  const showQaFinished = $derived(
    reportActionsVisible && qaSeen === "unseen" && !qaOnScreen
  );

  const topBarMoreItems = $derived.by((): TopBarMoreItem[] => {
    if (!reportActionsVisible) return [];
    return [
      {
        id: "ai-review",
        label: startingReview ? "Starting AI review..." : "Start AI review",
        onSelect: handleStartAiReview,
        disabled: startingReview,
      },
      ...(canShare
        ? [{ id: "share", label: sharing ? "Publishing..." : "Share review link", onSelect: handleCopyShareLink, disabled: sharing }]
        : []),
      ...(ghostSnapshot
        ? [{ id: "compare", label: "Compare with the one-shot draft", onSelect: () => (ghostCompareOpen = true) }]
        : []),
      { id: "history", label: "History", onSelect: () => (showHistory = true) },
      { id: "financial", label: "Financial", href: `/project/${projectId}/financial` },
    ];
  });
</script>

<svelte:window
  onpopstate={() => (seedSummaryRequested = new URL(window.location.href).searchParams.get("view") === "summary")}
  onkeydown={(e) => {
    if (e.key === "Escape" && assistantFull && !replaceSession) chatFocus = false;
    else if (e.key === "Escape" && chatShown && !replaceSession) {
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
  <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-workspace-rail" data-report-cohort="preview">
    <!-- Top bar (ui-design-final.md section 2): the route's single h1 lives
         here; page actions sit at the right, the rest in the More menu. -->
    <ProjectTopBar
      title={project.title}
      projectsHref={workspaceHref("/projects")}
      {railHidden}
      onToggleRail={() => (railHidden = !railHidden)}
      onOpenNavigation={() => (navigationOpen = true)}
      moreItems={topBarMoreItems}
    >
      {#snippet leading()}
        {#if showIntakeWorkbench && !contextOpen}
          <!-- The intake context pane reopens from the far left, desktop only;
               narrow screens keep the Work/Context switch. -->
          <button
            type="button"
            title="Show project context"
            aria-label="Show project context"
            onclick={() => (contextOpen = true)}
            class="hidden size-8 shrink-0 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-primary-wash hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy motion-reduce:transition-none lg:flex"
          >
            <svg class="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="M4 7C4 5.343 5.343 4 7 4h10c1.657 0 3 1.343 3 3v10c0 1.657-1.343 3-3 3H7c-1.657 0-3-1.343-3-3V7zM15 5v14" />
            </svg>
          </button>
        {/if}
      {/snippet}
      {#snippet status()}
        {#if !project.workflowStage}
          <ProjectStateBadge workflowStage={project.workflowStage} legacyStatus={project.status} />
        {/if}
        {#if generation && generation.status !== "completed"}
          <span class="hidden lg:inline-flex">
            <GenerationStatusChip
              status={generation.status}
              candidatesDone={generation.candidatesDone ?? 0}
              candidatesFailed={generation.candidatesFailed ?? 0}
              surface="light"
            />
          </span>
        {/if}
        {#if pagingPosition}
          <!-- "N of M in <where>": flow-state paging over the bounded page the
               invoking list stashed. No subscriptions. -->
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
              class="flex size-7 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-primary-wash hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent motion-reduce:transition-none"
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
              class="flex size-7 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-primary-wash hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent motion-reduce:transition-none"
            >
              <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" /></svg>
            </button>
          </span>
        {/if}
        {#if saving}
          <span class="hidden text-xs text-ink-faint sm:inline">Saving...</span>
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
      {/snippet}
      {#snippet actions()}
        {#if (showIterativeStepper || showSeedWorkspace) && (!isSeedWorkflow || generation?.seedCanEdit)}
          <!-- Seed stage: the one top-bar cancel. While drafting after
               sign-off the writing pill's Stop is the only cancel. -->
          <Button variant="secondary" size="sm" class="h-9" onclick={() => (confirmCancelIterative = true)}>
            Cancel generation
          </Button>
        {/if}
        {#if reportActionsVisible}
          <!-- Board 2.1: 36px buttons, 13px labels, radius 7. -->
          <Button
            variant="secondary"
            size="sm"
            class="h-9 gap-1.5 rounded-[7px]! px-3! text-[13px]!"
            aria-label={exporting ? "Exporting..." : "Export .docx"}
            onclick={handleExport}
            disabled={exporting}
          >
            <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            <span class="max-sm:sr-only">Export</span>
          </Button>
          <Button
            size="sm"
            class="h-9 rounded-[7px]! px-3.5! text-[13px]! max-sm:hidden"
            data-send-for-review
            disabled={!details.data?.permissions.canHandOff}
            title={details.data && !details.data.permissions.canHandOff ? (details.handOffReason ?? undefined) : undefined}
            onclick={() => void leaveDetailsThen(() => openDetails("handoff", "internal_review"))}
          >
            Send for review
          </Button>
        {:else if awaitingSelection}
          <button
            type="button"
            title={candidateMaximized ? "Exit focus mode" : "Enter focus mode"}
            aria-label={candidateMaximized ? "Exit focus mode" : "Enter focus mode"}
            onclick={() => (candidateMaximized = !candidateMaximized)}
            class="flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-primary-wash hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy motion-reduce:transition-none pointer-coarse:size-11"
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
      {/snippet}
    </ProjectTopBar>

    <div data-project-card class="mx-3 mb-3 flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-workspace-rail-line bg-surface">
      <PanelToolbar
        tabs={panelTabs}
        {activeTab}
        onSelectTab={selectTab}
        showFullWidth={reportActionsVisible && !sourcesOpen && !assistantFull}
        fullWidth={workspaceMaximized}
        onToggleFullWidth={() => (workspaceMaximized = !workspaceMaximized)}
        showDetails={!seedDetailsInPaneSwitch}
        detailsActive={detailsOpen && sidePanelOnScreen}
        onToggleDetails={toggleDetails}
        bind:detailsButton
        showAssistant={reportActionsVisible && !!user}
        showQa={reportActionsVisible && !!user}
        assistantActive={chatShown && sidePanelOnScreen}
        onToggleAssistant={() => void leaveDetailsThen(() => toggleSidePanel("chat"))}
      >
        {#snippet detailsPeek()}
          <DetailsPopover
            data={details.data}
            anchor={detailsButton}
            bind:open={detailsPeekOpen}
            disabled={detailsOpen}
            onOpenAll={() => openDetails()}
          />
        {/snippet}
        {#snippet qa()}
          {#if reportActionsVisible && user}
            <QaToggle
              state={qaState}
              score={qaScore}
              unseen={qaUnseen}
              active={qaShown && sidePanelOnScreen}
              onToggle={() => void leaveDetailsThen(() => toggleSidePanel("qa"))}
            />
          {/if}
        {/snippet}
      </PanelToolbar>

      <div bind:this={workspaceEl} data-project-body class="flex min-h-0 flex-1 overflow-hidden">
        <div
          data-project-main
          inert={assistantFull}
          class={`relative flex min-h-0 min-w-0 flex-1 flex-col ${assistantFull ? "hidden" : ""} ${sidePanelOpen && mobileWorkspaceView === "assistant" ? "max-lg:hidden" : ""}`}
        >
          <!-- Draft ready (board 4.4): where the writing pill was, top centre
               of the Report tab. Export and Send for review are back in the
               top bar. -->
          {#if draftReadyFor && reportActionsVisible && !sourcesOpen}
            <div class="pointer-events-none absolute inset-x-0 top-6 z-30 flex justify-center px-4" data-draft-ready-host>
              <div class="pointer-events-auto max-w-full">
                {#key draftReadyFor}
                  <DraftReadyToast
                    qaRunning={generation?.postQaStatus === "running"}
                    onClose={() => (draftReadyFor = null)}
                  />
                {/key}
              </div>
            </div>
          {/if}
          <!-- QA finished (board 4.5): 24px inside the report panel's bottom
               right corner until opened or dismissed; it scrolls rather than
               clips in a short window. -->
          {#if showQaFinished && qaScores && mainPaneVisible}
            <div class="absolute bottom-6 right-6 z-[85] max-h-[calc(100%-3rem)] overflow-y-auto max-sm:inset-x-4 max-sm:bottom-4 max-sm:max-h-[calc(100%-2rem)]" data-qa-finished-host>
              {@render qaFinishedNotice()}
            </div>
          {/if}
          {#if sourcesOpen}
            <div class="min-h-0 flex-1 overflow-y-auto">
              <SourcesView
                transcripts={transcripts}
                documents={documentsQ.data ?? []}
                loading={transcriptsQ.data === undefined || documentsQ.data === undefined}
                canEditTranscripts={!!user?.role}
                transcriptsBlockedReason={transcriptChangesBlocked
                  ? "Transcripts can't change while a report is generating."
                  : null}
                {transcriptBusy}
                onAddTranscript={(file) => storeTranscriptFile(file, null)}
                onReplaceTranscript={(transcriptId, file) => storeTranscriptFile(file, transcriptId)}
                onRemoveTranscript={removeTranscript}
                transcriptSpeakers={transcriptSpeakersChip}
              />
            </div>
          {/if}
          <div class={`flex min-h-0 flex-1 flex-col ${sourcesOpen ? "hidden" : ""}`}>
    {#if generation && showWritingView}
      <!-- Writing view (ui-design-final.md section 6, boards 4.1 to 4.3): the
           signed-off Step-by-step draft writes into the Report tab. The
           transform makes this pane the containing block of the fixed corner
           ring, so the ring sits in the report panel's corner. -->
      <div class="relative flex min-h-0 flex-1 flex-col [transform:translateZ(0)]" data-writing-pane>
        <div bind:this={writingScrollEl} class="min-h-0 flex-1 overflow-y-auto" data-writing-scroll>
          <!-- A7: the region receives focus when Seed drafting replaces
               Summary Review, and hands it to the draft's heading once the
               progress read arrives. -->
          <div
            id={GENERATION_PROGRESS_REGION_ID}
            role="region"
            aria-label="Generation progress"
            tabindex="-1"
            class="mx-auto w-full max-w-[808px] px-6 pb-24 pt-6 outline-none"
          >
            {#if draftProgress}
              {#key generation._id}
                <SeedDraftingView
                  progress={draftProgress}
                  reportTitle={project.title}
                  headingId={GENERATION_PROGRESS_HEADING_ID}
                  scrollContainer={writingScrollEl}
                  onStop={generation.seedCanEdit ? openStopDialog : undefined}
                  stopDisabled={stopDialogOpen}
                />
              {/key}
            {:else}
              <p class="flex items-center justify-center gap-2 py-16 text-body text-ink-muted">
                <Spinner size="sm" /> Loading the draft...
              </p>
            {/if}
          </div>
        </div>
      </div>
      <StopDraftingDialog
        bind:open={stopDialogOpen}
        currentSectionNumber={writingSectionNumber}
        errorMessage={stopError}
        onConfirm={confirmStopDrafting}
        onCancel={() => (stopError = null)}
      />
    {:else if generation && (isGenerating || showFailedGeneration)}
      <!-- Generation progress: no metadata header; the progress card is the page. -->
      <!-- `my-auto` rather than `items-center`: a centred flex child that
           overflows its scroll container cannot be scrolled back to at the top
           edge. Auto margins centre it identically while it fits, and yield
           when the files panel below makes the content taller than the view. -->
      <div class="flex min-h-0 flex-1 overflow-y-auto">
        <!-- A7: the region receives focus when Seed drafting replaces Summary
             Review, and hands it to the progress heading once that renders. -->
        <div
          id={GENERATION_PROGRESS_REGION_ID}
          role="region"
          aria-label="Generation progress"
          tabindex="-1"
          class="mx-auto my-auto w-full max-w-3xl rounded-xl px-6 py-8 outline-none focus-visible:ring-2 focus-visible:ring-navy"
        >
          <GenerationProgress generationId={generation._id} />
          {#if isSeedWorkflow && generation.seedStageError}
            <!-- A5 (R6-07): a retry's pending state and refusal belong to the
                 user and generation that submitted it. -->
            {#key `${user?._id}:${generation._id}`}
              <SeedInitializationRecovery
                generationId={generation._id}
                message={generation.seedStageError}
                canEdit={generation.seedCanEdit}
              />
            {/key}
          {/if}
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

    {#if generation && showSeedWorkspace}
      <div class="min-h-0 flex-1 overflow-hidden">
        <!-- Every Seed surface is keyed by its full owner, so no local state,
             pending work or draft buffer crosses a user or generation. -->
        {#key `${user?._id}:${generation._id}`}
          <SeedWorkspace
            generationId={generation._id}
            {projectId}
            userId={user?._id ?? "anonymous"}
            hostVisible={mainPaneVisible && !sourcesOpen}
            onReviewSummary={() => {
              summaryOpener = "trigger";
              setSeedSummary(true);
            }}
          >
            {#snippet paneSwitchEnd()}
              <!-- Board 3.6: the page's Details toggle beside the switch. -->
              <button
                type="button"
                data-seed-details-toggle
                aria-pressed={detailsOpen && sidePanelOnScreen}
                aria-label="Details"
                onclick={toggleDetails}
                class={`flex size-10 shrink-0 items-center justify-center rounded-lg transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir motion-reduce:transition-none pointer-coarse:size-11 ${
                  detailsOpen && sidePanelOnScreen
                    ? "bg-workspace-rail-selected text-fir"
                    : "text-ink-secondary hover:bg-primary-wash hover:text-ink"
                }`}
              >
                <svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></svg>
              </button>
            {/snippet}
          </SeedWorkspace>
        {/key}
      </div>
    {/if}

    {#if seedSummaryOwner && showSeedSummary}
      <div class="min-h-0 flex-1 overflow-hidden">
        {#key `${user?._id}:${seedSummaryOwner._id}:${seedSummaryOwner.summaryVersionId ?? "live"}`}
          <SeedSummaryReview
            generationId={seedSummaryOwner._id}
            userId={user?._id ?? "anonymous"}
            versionId={seedSummaryOwner.summaryVersionId}
            readOnly={seedSummaryOwner.seedPhase !== "seeding"}
            focusHeadingOnMount
            onClose={() => setSeedSummary(false)}
            onSignedOff={completeSeedSignOff}
          />
        {/key}
      </div>
    {/if}

    {#if generation && showSeedRecovery}
      <div class="min-h-0 flex-1 overflow-hidden">
        {#key `${user?._id}:${generation._id}:${generation.summaryVersionId}`}
          <SeedSummaryReview
            generationId={generation._id}
            userId={user?._id ?? "anonymous"}
            versionId={generation.summaryVersionId}
            readOnly
            recovery
            canRecover={generation.seedCanEdit}
          />
        {/key}
      </div>
    {/if}

    <!-- Iterative mode: section-by-section review stepper -->
    {#if generation && showIterativeStepper}
      <div class="min-h-0 flex-1 overflow-y-auto">
        <div class="mx-auto w-full max-w-[var(--container-shell)] px-6 py-8">
          <LazyModule load={() => import("$lib/components/generation/IterativeStepper.svelte")} label="section review">
            {#snippet children(IterativeStepper)}
              <IterativeStepper generationId={generation._id} />
            {/snippet}
          </LazyModule>
        </div>
      </div>
    {/if}

    <!-- BNH-15: choose between candidate drafts before they become the report -->
    {#if generation && awaitingSelection}
      <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
        <LazyModule load={() => import("$lib/components/generation/CandidateSelection.svelte")} label="candidate selection">
          {#snippet children(CandidateSelection)}
            <CandidateSelection generationId={generation._id} bind:maximized={candidateMaximized} />
          {/snippet}
        </LazyModule>
      </div>
    {/if}
    {#if generationError}
      <p class="mx-auto mt-4 w-full max-w-3xl px-6 text-sm text-red-700" role="alert">
        {generationError}
      </p>
    {/if}

    <!-- Report surface (ui-design-final.md section 8, row 5): a centred
         660px reading column, or full width with 48px side padding beside a
         side panel and 96px when the report is alone. -->
    {#if reportActionsVisible && report}
      <div data-project-workspace class="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
        <div class="[container-type:inline-size] flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-y-auto">
            <div
              data-report-surface
              data-report-width={workspaceMaximized ? "full" : "reading"}
              class={`w-full pt-11 pb-10 transition-[padding,max-width] duration-[325ms] ease-out motion-reduce:transition-none ${workspaceMaximized ? (sidePanelOpen ? "px-6 lg:px-12" : "px-6 lg:px-24") : "mx-auto max-w-[708px] px-6"}`}
            >
              <!-- Board 2.1: the report opens on its serif title. The top bar
                   holds the page h1; the document's own title heading stays
                   hidden in the editor. -->
              <h2 data-report-title class="mb-0.5 font-serif text-[28px] leading-9 font-normal text-ink [text-wrap:balance]">
                {project.title}
              </h2>
              {#if notDraftedSections.length > 0}
                <!-- A stopped Step-by-step draft (FR-43, owner decision 20). -->
                <div class="mt-6">
                  <NotDraftedBanner
                    missingSections={notDraftedSections}
                    onDraftRest={draftTheRest}
                    pending={reportReadOnly}
                    errorMessage={redraftError}
                    failedAttempt={redraftFailure}
                    disabled={!reportGenerationQ.data?.seedCanEdit}
                  />
                </div>
              {:else if reportReadOnly}
                <p class="mt-4 text-[13px] leading-5 text-ink-secondary" role="status" data-redraft-status>
                  Drafting the missing sections. Editing resumes when they are in.
                </p>
              {/if}
              <!-- Editor column -->
              <Editor
                bind:this={editorRef}
                content={report.content}
                onUpdate={handleEditorUpdate}
                onComment={handleComment}
                onAskAI={handleAskAI}
                onResearch={handleResearch}
                editable={true}
                readOnly={reportReadOnly}
                {commentRanges}
                onHoverComment={(id) => (hoveredCommentId = id)}
                presentation="reading"
              />

              <!-- Supporting panels (QA lives in the side panel, BNH-47) -->
              <div class="mt-8 mb-12">
                <!-- 2026-08-11 (second) amendment: review-mode projects keep
                     the AI feedback visible ALONGSIDE the PD in the editor. -->
                {#if project.mode === "review" && pdReview}
                  <div class="mb-4">
                    <PdReviewReport
                      review={pdReview}
                      hasTranscript={transcripts.length > 0}
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
      </div>
    {/if}
    <!-- No report, not generating: the INTAKE WORKBENCH (2026-08-08
         Obvious-parity amendment). Desktop ≥lg mirrors the report
         workbench's split anatomy: a persistent left CONTEXT pane (files
         evidence + interview transcript, the project's conversation-like
         source material) beside the primary intake/generation work surface,
         each owning its own vertical scroll, with the same resizable
         separator grammar. This replaces the single 768px long-scroll
         column whose transcript drove a ~27k-px page. Narrow screens use
         explicit Work/Context switches with one pane visible at a time.
         The state stays HONEST: no report and no chat exist here; the
         left pane is source context, never a fabricated conversation. -->
    {#if showIntakeWorkbench}
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
                hasTranscript={transcripts.length > 0}
                onGenerate={handleGenerateFromReview}
              />
            {:else if project.mode === "review" && pdReviewQ.data === null}
              <!-- Stranded review project (2026-08-07 flag): no review row
                   exists, so the report block renders nothing and the writer
                   had no recovery path. Offer start/upload here. -->
              <PdReviewStart projectId={project._id} />
            {/if}

            {#if canGenerate}
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
                        { id: "iterative", label: "Step by step" },
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
               (assistant-rail grammar). Desktop only; narrow screens close
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
            <!-- Reachable later: a project with no report still has to show
                 what happened to its uploads. -->
            <FilesPanel {projectId} />

            {#if transcripts.length > 0}
              <div class="mt-6">
                <h2 class="text-sm font-medium uppercase tracking-wide text-gray-400">
                  {transcripts.length === 1 ? "Transcript" : "Transcripts"}
                </h2>
                <!-- One disclosure per transcript, one body loaded at a time:
                     the open row subscribes its content, the rest cost their
                     metadata only. -->
                {#each transcripts as transcriptRow (transcriptRow._id)}
                  {@const bodyId = `${transcriptBodyIdPrefix}-${transcriptRow._id}`}
                  {@const open = openTranscriptId === transcriptRow._id}
                  <h3 class="m-0 mt-1">
                    <button
                      type="button"
                      onclick={() => toggleTranscript(transcriptRow._id)}
                      aria-expanded={open}
                      aria-controls={bodyId}
                      class="flex min-h-9 w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-primary-wash focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-navy motion-reduce:transition-none"
                    >
                      <span class="truncate text-sm text-ink">
                        {transcriptRow.label}
                      </span>
                      {#if transcriptRow.wordCount > 0}
                        <span class="ml-1 flex-shrink-0 text-xs text-gray-400">
                          {transcriptRow.wordCount.toLocaleString()} words
                        </span>
                      {/if}
                      <span class="ml-auto flex items-center" aria-hidden="true">
                        <DisclosureChevron {open} />
                      </span>
                    </button>
                  </h3>
                  <Disclosure id={bodyId} {open}>
                    <div class="pt-1">
                      {#if openTranscript?._id === transcriptRow._id}
                        <div class="rounded-lg border border-gray-200 bg-white p-4">
                          <p class="whitespace-pre-wrap font-serif text-sm leading-relaxed text-gray-700">
                            {normalizeExtractedText(openTranscript.content)}
                          </p>
                        </div>
                      {:else}
                        <p class="text-sm text-gray-400">
                          Loading transcript...
                        </p>
                      {/if}
                    </div>
                  </Disclosure>
                {/each}
              </div>
            {/if}
          </div>
        </aside>
      </div>
    {/if}

          </div>
        </div>

        <!-- Twenty-style hairline resize divider between the page and the
             side panel (pointer and keyboard). -->
        {#if sidePanelOpen && !assistantFull}
          <button
            type="button"
            onmousedown={startDrag}
            role="slider"
            aria-label="Resize assistant panel"
            aria-orientation="vertical"
            aria-valuemin={SIDE_PANEL_MIN}
            aria-valuemax={SIDE_PANEL_MAX}
            aria-valuenow={sidePanelWidth}
            aria-valuetext={`${sidePanelWidth} pixels`}
            onkeydown={(event) => {
              if (event.key === "ArrowLeft") adjustRail(16);
              else if (event.key === "ArrowRight") adjustRail(-16);
              else if (event.key === "Home") sidePanelWidth = SIDE_PANEL_MIN;
              else if (event.key === "End") sidePanelWidth = SIDE_PANEL_MAX;
              else return;
              event.preventDefault();
            }}
            title="Drag or use arrow keys to resize"
            data-side-panel-divider
            class="group relative hidden w-px flex-none cursor-col-resize bg-line-soft focus-visible:outline-none lg:block"
          >
            <span aria-hidden="true" class={`absolute inset-y-0 -left-[3px] w-[7px] transition-colors group-hover:bg-primary/25 group-focus-visible:bg-primary/40 ${dragging ? "bg-primary/40" : ""}`}></span>
            <span aria-hidden="true" class={`absolute inset-y-0 left-0 w-px transition-colors group-hover:bg-primary-selected group-focus-visible:bg-primary-selected ${dragging ? "bg-primary-selected" : ""}`}></span>
          </button>
        {/if}

        <!-- Side slot: Assistant, QA or Details, 400px by default. The chat
             stays mounted so its state survives close and reopen; in
             Assistant full screen it takes the page and centres the
             conversation in a 720px column. -->
        <aside
          data-side-panel={sidePanelOpen ? railView : undefined}
          aria-label="Side panel"
          class={`relative min-h-0 flex-col overflow-hidden bg-surface ${sidePanelOpen && (mobileWorkspaceView === "assistant" || assistantFull) ? "flex w-full flex-1" : "hidden"} lg:flex lg:flex-none lg:w-[var(--side-panel-width)] ${dragging ? "" : "lg:transition-[width] lg:duration-[325ms] lg:ease-out motion-reduce:transition-none"}`}
          style={`--side-panel-width: ${assistantFull ? "100%" : sidePanelOpen ? `${sidePanelWidth}px` : "0px"}`}
        >
          {#if detailsOpen && railView === "details"}
            <div class="h-full" style={`min-width: ${SIDE_PANEL_MIN}px`}>
              <DetailsPanel
                bind:this={detailsPanel}
                data={details.data}
                error={details.error}
                bind:view={detailsView}
                {handOffStage}
                team={details.team}
                teamLoading={details.teamLoading}
                teamError={details.teamError}
                changeStageReason={details.changeStageReason}
                handOffReason={details.handOffReason}
                canCreateIndustry={user?.role === "admin"}
                onChangeStage={details.changeStage}
                onHandOff={details.handOff}
                onSaveIndustry={details.saveIndustry}
                onSaveFiscalYear={details.saveFiscalYear}
                onSaveScienceCode={details.saveScienceCode}
                onSaveProjectNumber={details.saveProjectNumber}
                onSuggestScienceCode={details.data?.permissions.canEditDetails ? details.suggestScienceCode : undefined}
                onClose={closeSidePanel}
              >
                {#snippet more()}
                  <DetailsMore {projectId} {project} {canEditDetails} {details} />
                {/snippet}
              </DetailsPanel>
            </div>
          {/if}
          {#if report && user && reportActionsVisible}
            <!-- BNH-47: QA review (exactly one side surface in flow at a time) -->
            {#if railView === "qa"}
              <div class="h-full" style={`min-width: ${SIDE_PANEL_MIN}px`}>
                <LazyModule load={() => import("$lib/components/qa/QARailPanel.svelte")} label="QA score">
                  {#snippet children(QARailPanel)}
                    <QARailPanel
                      variant="side"
                      title="QA score"
                      lastRunAt={generation?.postQaStatus === "failed"
                        ? null
                        : (generation?.postQaCompletedAt ?? generation?.completedAt ?? null)}
                      open={qaOpen}
                      onClose={closeSidePanel}
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
                  {/snippet}
                </LazyModule>
              </div>
            {/if}
            <div
              class={`chat-rise relative flex h-full origin-bottom flex-col overflow-hidden bg-surface ${chatOpen ? "" : "is-closed"} ${railView !== "chat" ? "hidden" : ""}`}
              role="dialog"
              aria-label="AI assistant"
              inert={!chatOpen}
            >
              <div class={assistantFull ? "mx-auto flex h-full w-full max-w-[720px] flex-col" : "flex h-full flex-col"} data-assistant-column={assistantFull ? "full" : "side"}>
                <LazyModule load={() => import("$lib/components/chat/AgentChatPanel.svelte")} label="assistant" active={chatPreferencesReady && chatOpen && railView === "chat" && (desktopAssistant || mobileWorkspaceView === "assistant" || assistantFull)}>
                  {#snippet children(AgentChatPanel)}
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
                        closeInset={false}
                        bind:composerHeight={assistantComposerHeight}
                        isFull={assistantFull}
                        onToggleFull={() => {
                          openSidePanel("chat");
                          chatFocus = !chatFocus;
                        }}
                      />
                  {/snippet}
                </LazyModule>
              </div>
            </div>
          {/if}
        </aside>
      </div>
    </div>
    <!-- BNH-30: one-by-one replace stepper, Word-style "replace & find next" -->
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
              Replace and next
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

    {#snippet qaFinishedNotice()}
      {#if qaScores}
        <QaFinishedNotice
          overallScore={qaScores.overall}
          sections={qaScores.sections}
          completedAt={qaCompletedAt}
          onOpen={openQaFromNotice}
          onLater={dismissQaNotice}
          onDismiss={dismissQaNotice}
        />
      {/if}
    {/snippet}
    <!-- QA finished while the report pane is off screen (Assistant full
         screen, or the side panel on a phone): the window corner instead. -->
    {#if showQaFinished && qaScores && !mainPaneVisible}
      <!-- Over the Assistant (full screen, or the phone side panel) it sits
           above the composer so it never covers Send (review g2 B7). -->
      <div
        class="fixed bottom-6 right-6 z-[85] max-h-[calc(100dvh-3rem)] overflow-y-auto max-sm:inset-x-4 max-sm:bottom-4"
        style={noticeAboveComposer
          ? `bottom: calc(${assistantComposerHeight}px + 1.5rem); max-height: calc(100dvh - ${assistantComposerHeight}px - 3rem)`
          : undefined}
        data-qa-finished-host
      >
        {@render qaFinishedNotice()}
      </div>
    {/if}

    <!-- BNH-30: transient notice (e.g. text not found to replace) -->
    {#if replaceNotice}
      <div class="fixed bottom-6 left-1/2 z-[85] -translate-x-1/2 rounded-lg bg-navy px-4 py-2 text-sm text-white shadow-xl">
        {replaceNotice}
      </div>
    {/if}

    <!-- Comment authoring + hover overlay (single view) -->
    {#if !awaitingSelection && !showIterativeStepper && !showSeedSummary && !showSeedWorkspace && !showSeedRecovery && !showSeedDrafting && report && user}
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
                  Re-running plans the report idea by idea. You sign off the plan,
                  then it is drafted and added as a new report version.
                {:else}
                  Re-running generates two fresh candidate drafts and adds a new
                  report version after you select one.
                {/if}
                Previous results are preserved in version history; nothing is deleted.
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
      <LazyModule load={() => import("$lib/components/history/VersionHistory.svelte")} label="version history">
        {#snippet children(VersionHistory)}
          <VersionHistory
            reportId={report._id}
            beforeSnapshot={flushEditor}
            onClose={() => (showHistory = false)}
          />
        {/snippet}
      </LazyModule>
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
            Cancel this generation?
          </h3>
          <p class="mt-1.5 text-sm leading-relaxed text-gray-600">
            Approved steps, approved sections and drafts in progress are discarded, and the
            project returns to its previous state. This cannot be undone.
          </p>
          <div class="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onclick={() => (confirmCancelIterative = false)}
              class="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-chrome"
            >
              Keep working
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
              Cancel generation
            </button>
          </div>
        </div>
      </div>
    {/if}
  </div>
  </WorkspaceShell>
{/if}

{#snippet transcriptSpeakersChip(row: { _id: string; label: string; speakerStatus?: "unchecked" | "needs_check" | "confirmed" })}
  <TranscriptSpeakersPopover
    transcriptId={row._id}
    transcriptLabel={row.label}
    status={row.speakerStatus}
    speakers={speakersOpenFor === row._id ? (speakersQ.data ?? undefined) : undefined}
    busy={speakersBusy}
    onOpenChange={(open) => {
      if (open) speakersOpenFor = row._id;
      else if (speakersOpenFor === row._id) speakersOpenFor = null;
    }}
    onSetRole={(label, role) => setSpeakerRole(row._id, label, role)}
    onConfirm={() => confirmSpeakers(row._id)}
  />
{/snippet}
